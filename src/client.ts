
import { privateKeyToAccount } from "viem/accounts";
import { TransactionNotFoundError, TransactionReceiptNotFoundError } from "viem";
import {
  AgentOnboardingError,
  AuthRequiredError,
  BasisApiError,
  BasisClient,
  TxNotConfirmedError,
  ValidationError,
  type AgentConfig,
  type AgentRegisterResult,
  type BasisClientOptions,
} from "basis-sdk";
import type { Config } from "./config.js";
import { readWalletState, saveApiKey, savePendingRegistration, syncQueueFile, type PendingRegistration } from "./state.js";
import { errorText, GuidedError } from "./errors.js";

let config: Config;
let clientPromise: Promise<BasisClient> | null = null;
/** The last client that finished starting (for sync lookups such as the explorer URL in error text). */
let ready: BasisClient | undefined;
/** Set once the server learns this wallet must register as an agent (or be linked) before it can sign in. */
let notLinked = false;
/** Why the last sign-in failed for another reason (site down, key refused...), in plain words; undefined when fine. */
let signInProblem: string | undefined;
/** When the last full start (with sign-in) was tried, to retry now and then. */
let lastSignInTry = 0;
/** Bumped by every start and registration: an older start finishing late never overrides a newer state. */
let generation = 0;
/** One registration at a time: a second call waits for the first instead of minting a second identity. */
let registering: Promise<RegisterOutcome> | null = null;
/** A registration sent but not finished, also kept in memory (the state file can fail to save). */
let pendingMem: PendingRegistration | null | undefined;

/**
 * MCP clients often give up on a call after about 60 s. A write waits for its receipt (40 s at most) and then for the
 * site sync (2 tries of 6 s); what is still undelivered is queued for retry_pending_syncs.
 */
const RECEIPT_TIMEOUT_MS = 40_000;
const SYNC = { attempts: 2, baseDelayMs: 1_000, maxDelayMs: 5_000, timeoutMs: 6_000 };
/** A remembered registration the chain still doesn't know after this long never went out. */
const PENDING_GIVE_UP_MS = 10 * 60_000;

export function initClientConfig(c: Config): void {
  config = c;
}

export function getConfig(): Config {
  return config;
}

/** The signer's address, without any network call. Undefined in read-only mode (no BASIS_PRIVATE_KEY). */
export function walletAddress(): `0x${string}` | undefined {
  return config.privateKey ? privateKeyToAccount(config.privateKey).address : undefined;
}

function baseOptions(): BasisClientOptions {
  const wallet = walletAddress();
  const opts: BasisClientOptions = {
    chain: config.chain,
    contractsCheck: "warn",
    receiptTimeoutMs: RECEIPT_TIMEOUT_MS,
  };
  if (config.rpcUrl) opts.rpcUrl = config.rpcUrl;
  if (config.apiDomain) opts.apiDomain = config.apiDomain;
  if (config.slippageBps !== undefined) opts.slippageBps = { trade: config.slippageBps };
  if (config.privateKey && wallet) {
    opts.privateKey = config.privateKey;
    const stored = config.rotateApiKey ? undefined : readWalletState(config, wallet).apiKey;
    const apiKey = config.apiKey ?? stored;
    if (apiKey) opts.apiKey = apiKey;
    if (config.rotateApiKey) opts.rotateApiKey = true;
    opts.onApiKeyCreated = (key: string) => {
      try {
        saveApiKey(config, wallet, key);
        console.error(`[basis-mcp] Saved this wallet's new BASIS API key in ${config.stateDir}.`);
      } catch {
        console.error(`[basis-mcp] Couldn't save this wallet's new BASIS API key in ${config.stateDir}: check that the folder is writable.`);
      }
    };
    opts.sync = { ...SYNC };
    try {
      opts.sync.queueFile = syncQueueFile(config, wallet);
    } catch {
      console.error(`[basis-mcp] Couldn't use ${config.stateDir} for the sync retry queue: unsent syncs are kept in memory only.`);
    }
  } else {
    opts.auth = false;
    if (config.apiKey) opts.apiKey = config.apiKey;
    opts.sync = { ...SYNC };
  }
  return opts;
}

/** After a signed-in start: BASIS_ROTATE_API_KEY has done its job (a second rotation would revoke the new key). */
function signedIn(): void {
  config.rotateApiKey = false;
  notLinked = false;
  signInProblem = undefined;
  lastSignInTry = Date.now();
}

function isNotLinked(e: unknown): boolean {
  return e instanceof BasisApiError && e.code === "wallet_not_linked";
}

/** A sign-in failure on the site's side (down, rate limit, key refused): the chain still works. */
function isSiteProblem(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return e instanceof BasisApiError || e instanceof AuthRequiredError || /already has an api key|api key already exists/i.test(msg);
}

/** Start and sign-in failures the SDK words for its own API, in MCP terms. Anything else is returned as it is. */
function explainStartFailure(e: unknown): unknown {
  const msg = e instanceof Error ? e.message : String(e);
  if (/already has an api key|api key already exists/i.test(msg)) {
    return new GuidedError(
      "This wallet already has a BASIS API key, and this MCP doesn't have it. Put it in BASIS_API_KEY in the MCP config, " +
        "or set BASIS_ROTATE_API_KEY=1 for one start to replace it with a new one (anything still using the old key stops working).",
    );
  }
  if (e instanceof ValidationError) {
    switch (e.rule) {
      case "wallet_in_account":
        return new GuidedError(
          "This wallet is linked to a person's BASIS account, so it can't be an agent. Use a fresh wallet for the agent, or use this one as a person (it signs in without register_agent).",
        );
      case "agentTxHashRequired":
        return new GuidedError(
          "This wallet already holds an agent identity that BASIS hasn't recorded. Call register_agent with registration_tx set to the hash of the transaction that made it (the wallet's history on the explorer shows it). Don't register without it.",
        );
      case "agentNotControlled":
        return new GuidedError(
          "BASIS lists an agent for this wallet that the wallet no longer controls. If you have the hash of a newer registration, pass it as registration_tx.",
        );
      case "agentNotOwned":
        return new GuidedError("That registration_tx made an agent identity this wallet doesn't own. Check the hash.");
      case "agentIdNotInTx":
        return new GuidedError("That registration_tx isn't an agent registration. Check the hash.");
      case "agentNotBasis":
        return new GuidedError(
          "That agent identity isn't marked as a BASIS agent. Update it with update_agent once this wallet can sign in, or register a new one.",
        );
      case "termsVersionUnknown":
      case "agentSignedSyncUnavailable":
        return new GuidedError("BASIS can't take new agent sign-ups right now. Nothing was sent. Try again later.");
      case "agentsNotSupported":
      case "agentApiWrongChain":
        return new GuidedError("Agents can't register on this network through this server. Nothing was sent.");
      case "agentNameTooLong":
        return new GuidedError("The agent name is too long: use at most 100 characters.");
      case "agentDescriptionTooLong":
        return new GuidedError("The description is too long: use at most 500 characters.");
      case "agentTxPending":
        return new GuidedError(
          "A transaction from this wallet is still waiting to confirm, and it may be an earlier registration. Nothing was sent: wait for it (get_status shows it), then call register_agent again, so a second identity can't be made.",
        );
      case "agentSignInUnavailable":
        return new GuidedError("Couldn't reach BASIS to sign in before registering this agent. Nothing was sent. Call register_agent again in a minute.");
      case "siweNonce":
        return new GuidedError(
          "Signing in to BASIS failed: the site's sign-in answer wasn't valid, so nothing was signed. Try again in a minute; if it keeps happening, check BASIS_API_DOMAIN in the MCP config.",
        );
    }
  }
  return e;
}

/** A client that doesn't sign in (chain only). */
function contractOnly(): Promise<BasisClient> {
  return BasisClient.create({ ...baseOptions(), auth: false });
}

/**
 * A full start (signs in when a wallet is set). When the sign-in fails (the wallet isn't linked yet, or the site is
 * down or refuses the key), the server still gets a contract-only client and says why in get_status.
 */
async function start(): Promise<BasisClient> {
  const gen = ++generation;
  lastSignInTry = Date.now();
  try {
    const c = await BasisClient.create(baseOptions());
    if (gen === generation && config.privateKey) signedIn();
    return c;
  } catch (e) {
    if (config.privateKey && (isNotLinked(e) || isSiteProblem(e))) {
      if (gen === generation) {
        notLinked = isNotLinked(e);
        signInProblem = notLinked ? undefined : errorText(explainStartFailure(e));
      }
      console.error(
        notLinked
          ? "[basis-mcp] This wallet can't sign in to BASIS yet (register_agent, or link it on the website). Chain tools still work."
          : "[basis-mcp] Signing in to BASIS failed; chain tools still work. get_status says why.",
      );
      return contractOnly();
    }
    throw explainStartFailure(e);
  }
}

function track(p: Promise<BasisClient>): Promise<BasisClient> {
  const tracked: Promise<BasisClient> = p.then(
    (c) => {
      if (clientPromise === tracked) ready = c;
      return c;
    },
    (e) => {
      if (clientPromise === tracked) clientPromise = null;
      throw e;
    },
  );
  clientPromise = tracked;
  return tracked;
}

/** Makes `c` the client every tool uses. */
function publish(c: BasisClient): void {
  generation++;
  ready = c;
  clientPromise = Promise.resolve(c);
}

/** The client for every tool. Created on first use; signs in when a private key is set. */
export function getClient(): Promise<BasisClient> {
  return clientPromise ?? track(start());
}

/**
 * When the last sign-in failed: try the full start again (the wallet may have been linked, the site may be back), at
 * most once a minute. Returns what still stops the sign-in, in plain words, or undefined.
 */
export async function retrySignInIfNeeded(): Promise<string | undefined> {
  if ((!notLinked && !signInProblem) || registering) return signInProblem;
  if (Date.now() - lastSignInTry < 60_000) return signInProblem;
  const gen = generation;
  lastSignInTry = Date.now();
  try {
    const c = await BasisClient.create(baseOptions());
    if (gen === generation) {
      signedIn();
      publish(c);
    }
    return undefined;
  } catch (e) {
    if (isNotLinked(e)) {
      notLinked = true;
      signInProblem = undefined;
      return undefined;
    }
    signInProblem = errorText(explainStartFailure(e));
    return signInProblem;
  }
}

/** The client if it has started, without waiting. */
export function currentClient(): BasisClient | undefined {
  return ready;
}

export function walletNeedsOnboarding(): boolean {
  return notLinked;
}

/** Why the last sign-in failed (other than "not linked yet"), or undefined. */
export function currentSignInProblem(): string | undefined {
  return signInProblem;
}


/** The registration sent but not finished, if any. */
export function pendingRegistration(): PendingRegistration | undefined {
  const wallet = walletAddress();
  if (!wallet) return undefined;
  if (pendingMem !== undefined) return pendingMem ?? undefined;
  return readWalletState(config, wallet).pendingRegistration;
}

/** Remembers (or forgets) a registration in memory and in the state file; a failed save never hides the answer. */
function rememberPending(hash: `0x${string}` | undefined): void {
  const wallet = walletAddress();
  pendingMem = hash ? { hash, savedAt: pendingMem?.hash === hash ? pendingMem.savedAt : Date.now() } : null;
  if (!wallet) return;
  try {
    savePendingRegistration(config, wallet, hash);
  } catch {
    console.error(`[basis-mcp] Couldn't save the pending registration in ${config.stateDir}: it is kept in memory for this run.`);
  }
}

export interface RegisterOutcome {
  client: BasisClient;
  /** What the registration did: the start's own (create with `agent`) or the recovery's (registerAndSync with a tx). */
  result: AgentRegisterResult | null;
  /** True when the agent is on chain but BASIS hasn't recorded it or let it sign in yet: call register_agent again later. */
  unfinished?: boolean;
}

/**
 * Registers the signer as a BASIS agent (ERC-8004) and signs in, or finds the agent it already is. The shared client
 * is replaced only once the new one is signed in: other tools keep working meanwhile. Calls made while one is running
 * wait for it, and a registration that was sent but not finished is remembered (also across restarts), so the next
 * call finishes it instead of minting a second identity.
 */
export function registerAgent(agent: AgentConfig, registrationTx?: `0x${string}`): Promise<RegisterOutcome> {
  if (!config.privateKey) {
    return Promise.reject(new GuidedError("Registering an agent needs a wallet: set BASIS_PRIVATE_KEY in the MCP config."));
  }
  if (registering) return registering;
  registering = doRegister(agent, registrationTx).finally(() => {
    registering = null;
  });
  return registering;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A signed-in client right after the agent was recorded (the site can answer "not linked" for a few seconds). */
async function signInAfterRecord(): Promise<BasisClient | null> {
  for (let i = 0; i < 3; i++) {
    try {
      return await BasisClient.create(baseOptions());
    } catch (e) {
      if (!isNotLinked(e)) throw explainStartFailure(e);
      await sleep(5_000);
    }
  }
  return null;
}

function notFound(e: unknown): boolean {
  return e instanceof TransactionReceiptNotFoundError || e instanceof TransactionNotFoundError;
}

async function doRegister(agent: AgentConfig, registrationTx?: `0x${string}`): Promise<RegisterOutcome> {
  const remembered = pendingRegistration();
  const tx = registrationTx ?? remembered?.hash;
  const chain = await contractOnly();

  if (tx) {
    const receipt = await chain.publicClient.getTransactionReceipt({ hash: tx }).catch((e) => {
      if (notFound(e)) return null;
      throw e;
    });
    if (!receipt) {
      const sent = await chain.publicClient.getTransaction({ hash: tx }).catch((e) => {
        if (notFound(e)) return null;
        throw e;
      });
      if (sent) {
        throw new GuidedError(
          `The registration ${tx} is still waiting to confirm. Don't register again: call register_agent again in a minute and it finishes this one.`,
          tx,
        );
      }
      if (registrationTx) {
        throw new GuidedError(`The network doesn't know the transaction ${tx}. Check the hash: nothing was sent.`);
      }
      if (remembered && Date.now() - remembered.savedAt > PENDING_GIVE_UP_MS) {
        rememberPending(undefined);
        throw new GuidedError(
          `The earlier registration ${tx} never reached the network (it is unknown more than 10 minutes later), so nothing was registered. Call register_agent again to register.`,
        );
      }
      throw new GuidedError(
        `The earlier registration ${tx} isn't visible on the network yet. Don't register again: call register_agent again in a minute and it finishes this one.`,
        tx,
      );
    }
    if (receipt.status !== "success") {
      if (!registrationTx || registrationTx === remembered?.hash) rememberPending(undefined);
      if (registrationTx) {
        throw new GuidedError("That registration failed on chain, so nothing was registered. Call register_agent without registration_tx to register.");
      }
    } else {
      let recovery: AgentRegisterResult;
      try {
        recovery = await chain.agent.registerAndSync(agent, tx);
      } catch (e) {
        if (e instanceof ValidationError && ["agentIdNotInTx", "agentNotOwned"].includes(e.rule) && !registrationTx) {
          rememberPending(undefined);
        }
        throw explainStartFailure(e);
      }
      if (recovery.registration && !recovery.registration.ok) {
        rememberPending(tx);
        return { client: chain, result: recovery, unfinished: true };
      }
      rememberPending(undefined);
      const client = await signInAfterRecord();
      if (!client) return { client: chain, result: recovery, unfinished: true };
      signedIn();
      publish(client);
      return { client, result: recovery };
    }
  }

  try {
    const client = await BasisClient.create({ ...baseOptions(), agent });
    signedIn();
    publish(client);
    return { client, result: client.agentRegistration };
  } catch (e) {
    if (e instanceof TxNotConfirmedError) {
      rememberPending(e.txHash);
      throw new GuidedError(
        `The registration was sent but isn't confirmed yet: ${e.txHash}. Don't register again (that would make a second identity). ` +
          "Call register_agent again in a minute: it finishes this one.",
        e.txHash,
      );
    }
    if (e instanceof AgentOnboardingError) {
      const id = e.agentId !== null ? ` (agent id ${e.agentId})` : "";
      if (e.txHash) rememberPending(e.txHash);
      if (e.registration) {
        throw new GuidedError(
          `The agent identity is on chain${id}, but BASIS hasn't recorded it yet. Don't register again: call register_agent again in a minute and it finishes this one.`,
        );
      }
      throw new GuidedError(`BASIS has recorded this agent${id}, but signing in failed. Call register_agent again in a minute: it signs in without registering again.`);
    }
    if (isNotLinked(e)) {
      throw new GuidedError("BASIS hasn't let this wallet in yet after the registration. Wait a minute and call register_agent again: it finds the agent instead of making a new one.");
    }
    throw explainStartFailure(e);
  }
}
