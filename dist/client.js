"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initClientConfig = initClientConfig;
exports.getConfig = getConfig;
exports.walletAddress = walletAddress;
exports.getClient = getClient;
exports.retrySignInIfNeeded = retrySignInIfNeeded;
exports.currentClient = currentClient;
exports.walletNeedsOnboarding = walletNeedsOnboarding;
exports.currentSignInProblem = currentSignInProblem;
exports.pendingRegistration = pendingRegistration;
exports.registerAgent = registerAgent;
const accounts_1 = require("viem/accounts");
const viem_1 = require("viem");
const basis_sdk_1 = require("basis-sdk");
const state_js_1 = require("./state.js");
const errors_js_1 = require("./errors.js");
let config;
let clientPromise = null;
let ready;
let notLinked = false;
let signInProblem;
let lastSignInTry = 0;
let generation = 0;
let registering = null;
let pendingMem;
const RECEIPT_TIMEOUT_MS = 40_000;
const SYNC = { attempts: 2, baseDelayMs: 1_000, maxDelayMs: 5_000, timeoutMs: 6_000 };
const PENDING_GIVE_UP_MS = 10 * 60_000;
function initClientConfig(c) {
    config = c;
}
function getConfig() {
    return config;
}
function walletAddress() {
    return config.privateKey ? (0, accounts_1.privateKeyToAccount)(config.privateKey).address : undefined;
}
function baseOptions() {
    const wallet = walletAddress();
    const opts = {
        chain: config.chain,
        contractsCheck: "warn",
        receiptTimeoutMs: RECEIPT_TIMEOUT_MS,
    };
    if (config.rpcUrl)
        opts.rpcUrl = config.rpcUrl;
    if (config.apiDomain)
        opts.apiDomain = config.apiDomain;
    if (config.slippageBps !== undefined)
        opts.slippageBps = { trade: config.slippageBps };
    if (config.privateKey && wallet) {
        opts.privateKey = config.privateKey;
        const stored = config.rotateApiKey ? undefined : (0, state_js_1.readWalletState)(config, wallet).apiKey;
        const apiKey = config.apiKey ?? stored;
        if (apiKey)
            opts.apiKey = apiKey;
        if (config.rotateApiKey)
            opts.rotateApiKey = true;
        opts.onApiKeyCreated = (key) => {
            try {
                (0, state_js_1.saveApiKey)(config, wallet, key);
                console.error(`[basis-mcp] Saved this wallet's new BASIS API key in ${config.stateDir}.`);
            }
            catch {
                console.error(`[basis-mcp] Couldn't save this wallet's new BASIS API key in ${config.stateDir}: check that the folder is writable.`);
            }
        };
        opts.sync = { ...SYNC };
        try {
            opts.sync.queueFile = (0, state_js_1.syncQueueFile)(config, wallet);
        }
        catch {
            console.error(`[basis-mcp] Couldn't use ${config.stateDir} for the sync retry queue: unsent syncs are kept in memory only.`);
        }
    }
    else {
        opts.auth = false;
        if (config.apiKey)
            opts.apiKey = config.apiKey;
        opts.sync = { ...SYNC };
    }
    return opts;
}
function signedIn() {
    config.rotateApiKey = false;
    notLinked = false;
    signInProblem = undefined;
    lastSignInTry = Date.now();
}
function isNotLinked(e) {
    return e instanceof basis_sdk_1.BasisApiError && e.code === "wallet_not_linked";
}
function isSiteProblem(e) {
    const msg = e instanceof Error ? e.message : String(e);
    return e instanceof basis_sdk_1.BasisApiError || e instanceof basis_sdk_1.AuthRequiredError || /already has an api key|api key already exists/i.test(msg);
}
function explainStartFailure(e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/already has an api key|api key already exists/i.test(msg)) {
        return new errors_js_1.GuidedError("This wallet already has a BASIS API key, and this MCP doesn't have it. Put it in BASIS_API_KEY in the MCP config, " +
            "or set BASIS_ROTATE_API_KEY=1 for one start to replace it with a new one (anything still using the old key stops working).");
    }
    if (e instanceof basis_sdk_1.ValidationError) {
        switch (e.rule) {
            case "wallet_in_account":
                return new errors_js_1.GuidedError("This wallet is linked to a person's BASIS account, so it can't be an agent. Use a fresh wallet for the agent, or use this one as a person (it signs in without register_agent).");
            case "agentTxHashRequired":
                return new errors_js_1.GuidedError("This wallet already holds an agent identity that BASIS hasn't recorded. Call register_agent with registration_tx set to the hash of the transaction that made it (the wallet's history on the explorer shows it). Don't register without it.");
            case "agentNotControlled":
                return new errors_js_1.GuidedError("BASIS lists an agent for this wallet that the wallet no longer controls. If you have the hash of a newer registration, pass it as registration_tx.");
            case "agentNotOwned":
                return new errors_js_1.GuidedError("That registration_tx made an agent identity this wallet doesn't own. Check the hash.");
            case "agentIdNotInTx":
                return new errors_js_1.GuidedError("That registration_tx isn't an agent registration. Check the hash.");
            case "agentNotBasis":
                return new errors_js_1.GuidedError("That agent identity isn't marked as a BASIS agent. Update it with update_agent once this wallet can sign in, or register a new one.");
            case "termsVersionUnknown":
            case "agentSignedSyncUnavailable":
                return new errors_js_1.GuidedError("BASIS can't take new agent sign-ups right now. Nothing was sent. Try again later.");
            case "agentsNotSupported":
            case "agentApiWrongChain":
                return new errors_js_1.GuidedError("Agents can't register on this network through this server. Nothing was sent.");
            case "agentNameTooLong":
                return new errors_js_1.GuidedError("The agent name is too long: use at most 100 characters.");
            case "agentDescriptionTooLong":
                return new errors_js_1.GuidedError("The description is too long: use at most 500 characters.");
            case "agentTxPending":
                return new errors_js_1.GuidedError("A transaction from this wallet is still waiting to confirm, and it may be an earlier registration. Nothing was sent: wait for it (get_status shows it), then call register_agent again, so a second identity can't be made.");
            case "agentSignInUnavailable":
                return new errors_js_1.GuidedError("Couldn't reach BASIS to sign in before registering this agent. Nothing was sent. Call register_agent again in a minute.");
            case "siweNonce":
                return new errors_js_1.GuidedError("Signing in to BASIS failed: the site's sign-in answer wasn't valid, so nothing was signed. Try again in a minute; if it keeps happening, check BASIS_API_DOMAIN in the MCP config.");
        }
    }
    return e;
}
function contractOnly() {
    return basis_sdk_1.BasisClient.create({ ...baseOptions(), auth: false });
}
async function start() {
    const gen = ++generation;
    lastSignInTry = Date.now();
    try {
        const c = await basis_sdk_1.BasisClient.create(baseOptions());
        if (gen === generation && config.privateKey)
            signedIn();
        return c;
    }
    catch (e) {
        if (config.privateKey && (isNotLinked(e) || isSiteProblem(e))) {
            if (gen === generation) {
                notLinked = isNotLinked(e);
                signInProblem = notLinked ? undefined : (0, errors_js_1.errorText)(explainStartFailure(e));
            }
            console.error(notLinked
                ? "[basis-mcp] This wallet can't sign in to BASIS yet (register_agent, or link it on the website). Chain tools still work."
                : "[basis-mcp] Signing in to BASIS failed; chain tools still work. get_status says why.");
            return contractOnly();
        }
        throw explainStartFailure(e);
    }
}
function track(p) {
    const tracked = p.then((c) => {
        if (clientPromise === tracked)
            ready = c;
        return c;
    }, (e) => {
        if (clientPromise === tracked)
            clientPromise = null;
        throw e;
    });
    clientPromise = tracked;
    return tracked;
}
function publish(c) {
    generation++;
    ready = c;
    clientPromise = Promise.resolve(c);
}
function getClient() {
    return clientPromise ?? track(start());
}
async function retrySignInIfNeeded() {
    if ((!notLinked && !signInProblem) || registering)
        return signInProblem;
    if (Date.now() - lastSignInTry < 60_000)
        return signInProblem;
    const gen = generation;
    lastSignInTry = Date.now();
    try {
        const c = await basis_sdk_1.BasisClient.create(baseOptions());
        if (gen === generation) {
            signedIn();
            publish(c);
        }
        return undefined;
    }
    catch (e) {
        if (isNotLinked(e)) {
            notLinked = true;
            signInProblem = undefined;
            return undefined;
        }
        signInProblem = (0, errors_js_1.errorText)(explainStartFailure(e));
        return signInProblem;
    }
}
function currentClient() {
    return ready;
}
function walletNeedsOnboarding() {
    return notLinked;
}
function currentSignInProblem() {
    return signInProblem;
}
function pendingRegistration() {
    const wallet = walletAddress();
    if (!wallet)
        return undefined;
    if (pendingMem !== undefined)
        return pendingMem ?? undefined;
    return (0, state_js_1.readWalletState)(config, wallet).pendingRegistration;
}
function rememberPending(hash) {
    const wallet = walletAddress();
    pendingMem = hash ? { hash, savedAt: pendingMem?.hash === hash ? pendingMem.savedAt : Date.now() } : null;
    if (!wallet)
        return;
    try {
        (0, state_js_1.savePendingRegistration)(config, wallet, hash);
    }
    catch {
        console.error(`[basis-mcp] Couldn't save the pending registration in ${config.stateDir}: it is kept in memory for this run.`);
    }
}
function registerAgent(agent, registrationTx) {
    if (!config.privateKey) {
        return Promise.reject(new errors_js_1.GuidedError("Registering an agent needs a wallet: set BASIS_PRIVATE_KEY in the MCP config."));
    }
    if (registering)
        return registering;
    registering = doRegister(agent, registrationTx).finally(() => {
        registering = null;
    });
    return registering;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function signInAfterRecord() {
    for (let i = 0; i < 3; i++) {
        try {
            return await basis_sdk_1.BasisClient.create(baseOptions());
        }
        catch (e) {
            if (!isNotLinked(e))
                throw explainStartFailure(e);
            await sleep(5_000);
        }
    }
    return null;
}
function notFound(e) {
    return e instanceof viem_1.TransactionReceiptNotFoundError || e instanceof viem_1.TransactionNotFoundError;
}
async function doRegister(agent, registrationTx) {
    const remembered = pendingRegistration();
    const tx = registrationTx ?? remembered?.hash;
    const chain = await contractOnly();
    if (tx) {
        const receipt = await chain.publicClient.getTransactionReceipt({ hash: tx }).catch((e) => {
            if (notFound(e))
                return null;
            throw e;
        });
        if (!receipt) {
            const sent = await chain.publicClient.getTransaction({ hash: tx }).catch((e) => {
                if (notFound(e))
                    return null;
                throw e;
            });
            if (sent) {
                throw new errors_js_1.GuidedError(`The registration ${tx} is still waiting to confirm. Don't register again: call register_agent again in a minute and it finishes this one.`, tx);
            }
            if (registrationTx) {
                throw new errors_js_1.GuidedError(`The network doesn't know the transaction ${tx}. Check the hash: nothing was sent.`);
            }
            if (remembered && Date.now() - remembered.savedAt > PENDING_GIVE_UP_MS) {
                rememberPending(undefined);
                throw new errors_js_1.GuidedError(`The earlier registration ${tx} never reached the network (it is unknown more than 10 minutes later), so nothing was registered. Call register_agent again to register.`);
            }
            throw new errors_js_1.GuidedError(`The earlier registration ${tx} isn't visible on the network yet. Don't register again: call register_agent again in a minute and it finishes this one.`, tx);
        }
        if (receipt.status !== "success") {
            if (!registrationTx || registrationTx === remembered?.hash)
                rememberPending(undefined);
            if (registrationTx) {
                throw new errors_js_1.GuidedError("That registration failed on chain, so nothing was registered. Call register_agent without registration_tx to register.");
            }
        }
        else {
            let recovery;
            try {
                recovery = await chain.agent.registerAndSync(agent, tx);
            }
            catch (e) {
                if (e instanceof basis_sdk_1.ValidationError && ["agentIdNotInTx", "agentNotOwned"].includes(e.rule) && !registrationTx) {
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
            if (!client)
                return { client: chain, result: recovery, unfinished: true };
            signedIn();
            publish(client);
            return { client, result: recovery };
        }
    }
    try {
        const client = await basis_sdk_1.BasisClient.create({ ...baseOptions(), agent });
        signedIn();
        publish(client);
        return { client, result: client.agentRegistration };
    }
    catch (e) {
        if (e instanceof basis_sdk_1.TxNotConfirmedError) {
            rememberPending(e.txHash);
            throw new errors_js_1.GuidedError(`The registration was sent but isn't confirmed yet: ${e.txHash}. Don't register again (that would make a second identity). ` +
                "Call register_agent again in a minute: it finishes this one.", e.txHash);
        }
        if (e instanceof basis_sdk_1.AgentOnboardingError) {
            const id = e.agentId !== null ? ` (agent id ${e.agentId})` : "";
            if (e.txHash)
                rememberPending(e.txHash);
            if (e.registration) {
                throw new errors_js_1.GuidedError(`The agent identity is on chain${id}, but BASIS hasn't recorded it yet. Don't register again: call register_agent again in a minute and it finishes this one.`);
            }
            throw new errors_js_1.GuidedError(`BASIS has recorded this agent${id}, but signing in failed. Call register_agent again in a minute: it signs in without registering again.`);
        }
        if (isNotLinked(e)) {
            throw new errors_js_1.GuidedError("BASIS hasn't let this wallet in yet after the registration. Wait a minute and call register_agent again: it finds the agent instead of making a new one.");
        }
        throw explainStartFailure(e);
    }
}
