
import { z } from "zod";
import {
  erc20Abi,
  formatEther,
  formatUnits,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
} from "viem";
import { readSyncQueueFile, TxNotConfirmedError, ValidationError } from "basis-sdk";
import { p, tool, type ToolDef } from "../registry.js";
import { addr, resolveToken, walletOrSelf } from "../units.js";
import { explorerUrl, plainWarnings, txOut, userContent } from "../present.js";
import { pendingRegistration, registerAgent, retrySignInIfNeeded, walletAddress, walletNeedsOnboarding } from "../client.js";
import { errorText } from "../errors.js";
import { RECENT_WRITES_NOTE, recentWrites } from "../activity.js";
import { syncQueueFile } from "../state.js";
import { VERSION_TEXT } from "../version.js";

/** viem's "no such transaction / receipt yet" (any other failure is an RPC problem, not an answer). */
function isNotFound(e: unknown): boolean {
  return e instanceof TransactionReceiptNotFoundError || e instanceof TransactionNotFoundError;
}

export const accountTools: ToolDef[] = [
  tool({
    name: "get_status",
    toolset: "account",
    title: "Status",
    description:
      "Start here. Network (paper or real money), this server's wallet, its ETH for gas, whether it's signed in to BASIS " +
      "and registered as an agent, and the mains you can trade on.",
    input: {},
    run: async (_args, ctx) => {
      const { config } = ctx;
      const wallet = walletAddress();
      const base: Record<string, unknown> = {
        server: VERSION_TEXT,
        network: config.networkName,
        chainId: 4663,
        wallet: wallet ?? null,
        mode: wallet ? "read and write" : "read-only (no BASIS_PRIVATE_KEY)",
        limits: {
          maxSlippage: `${config.maxSlippagePercent}%`,
          maxSpendPerWrite: config.maxSpendUsd !== undefined ? `$${config.maxSpendUsd}` : "none (BASIS_MAX_SPEND not set)",
        },
      };
      const writes = recentWrites();
      if (writes.length) {
        base.recentWrites = writes;
        base.recentWritesNote = RECENT_WRITES_NOTE;
      }
      const signInProblem = await retrySignInIfNeeded();
      if (signInProblem) base.signInProblem = signInProblem;
      const pendingReg = wallet ? pendingRegistration() : undefined;
      if (pendingReg) {
        base.pendingRegistration = {
          hash: pendingReg.hash,
          since: new Date(pendingReg.savedAt).toISOString(),
          next: "Call register_agent again: it finishes this registration (it never makes a second identity).",
        };
      }
      let client;
      try {
        client = await ctx.client();
      } catch (e) {
        base.signedIn = false;
        base.problem = errorText(e);
        return base;
      }
      base.chainId = client.chainId;
      base.site = client.apiDomain;
      const unread = "couldn't be read right now";
      try {
        const mains = await client.mains.list();
        base.mains = mains.map((m) => ({ key: m.key, main: m.symbol, pairAsset: m.pairSymbol, tradingOpen: m.active && m.tradingEnabled }));
      } catch {
        base.mains = unread;
      }
      if (!wallet) return base;

      try {
        const eth = await client.publicClient.getBalance({ address: wallet });
        base.ethForGas = `${formatEther(eth)} ETH`;
        if (eth === 0n) base.gasNote = "This wallet has no ETH on Robinhood Chain, so it can't send transactions yet.";
      } catch {
        base.ethForGas = unread;
      }
      try {
        const [sent, pending] = await Promise.all([
          client.publicClient.getTransactionCount({ address: wallet, blockTag: "latest" }),
          client.publicClient.getTransactionCount({ address: wallet, blockTag: "pending" }),
        ]);
        base.transactionsPending = Math.max(0, pending - sent);
        if (pending > sent) base.pendingNote = "A transaction from this wallet is still waiting to confirm: wait for it before sending the same thing again.";
      } catch {
        base.transactionsPending = unread;
      }
      base.signedIn = client.hasSession;
      base.apiKey = client.apiKey ? "set" : "none";
      const notLinked = walletNeedsOnboarding();
      if (notLinked) {
        base.next =
          "This wallet can't sign in to BASIS yet: call register_agent with a name and a short description (or link it on the website). Chain tools work meanwhile.";
      } else {
        try {
          const a = await client.agent.lookupFromApi(wallet);
          base.agent = a.isAgent && a.agent ? { agentId: a.agent.agentId, name: a.agent.name } : null;
        } catch {
          base.agent = client.agentRegistration ? { agentId: client.agentRegistration.agentId } : unread;
        }
      }
      let queued = client.pendingSyncs.length;
      try {
        queued = Math.max(queued, (await readSyncQueueFile(syncQueueFile(config, wallet))).length);
      } catch {
      }
      base.pendingSyncs = queued;
      if (queued) {
        base.syncNote = notLinked
          ? "Some confirmed transactions aren't recorded by BASIS yet. They go through once this wallet can sign in (register_agent), then run retry_pending_syncs."
          : "Some confirmed transactions aren't recorded by BASIS yet: run retry_pending_syncs.";
      }
      return base;
    },
  }),

  tool({
    name: "get_mains",
    toolset: "account",
    title: "Mains",
    description:
      "The mains: the base tokens every other token trades against, each paired with its own asset (e.g. STASIS with " +
      "USDG). Shows each main's key, symbols, pair-asset decimals, vault and whether trading is open.",
    input: {},
    run: async (_args, ctx) => {
      const client = await ctx.client();
      const mains = await client.mains.list();
      return mains.map((m) => ({
        key: m.key,
        main: { symbol: m.symbol, name: m.name, address: m.main },
        pairAsset: { symbol: m.pairSymbol, address: m.pairAsset, decimals: m.pairDecimals },
        vault: m.vault,
        isDefault: m.isDefault,
        tradingOpen: m.active && m.tradingEnabled,
        newTokensAllowed: m.registered,
      }));
    },
  }),

  tool({
    name: "get_balances",
    toolset: "account",
    title: "Balances",
    description:
      "Wallet balances read from the chain: ETH for gas and every main and pair asset (e.g. STASIS, USDG). For every " +
      "other token the wallet holds, with values, use get_wallet_portfolio.",
    input: { wallet: p.wallet() },
    run: async ({ wallet }, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, wallet);
      const mains = await client.mains.list();
      const eth = await client.publicClient.getBalance({ address: who });
      const reads: { symbol: string; address: Address; decimals: number }[] = [];
      for (const m of mains) {
        reads.push({ symbol: m.symbol, address: m.main, decimals: 18 });
        if (!reads.some((r) => r.address === m.pairAsset)) reads.push({ symbol: m.pairSymbol, address: m.pairAsset, decimals: m.pairDecimals });
      }
      const raws = await Promise.all(
        reads.map((r) => client.publicClient.readContract({ address: r.address, abi: erc20Abi, functionName: "balanceOf", args: [who] })),
      );
      const onChain = reads.map((r, i) => ({ symbol: r.symbol, address: r.address, balance: formatUnits(raws[i], r.decimals) }));
      return { wallet: who, eth: `${formatEther(eth)} ETH`, mainsAndPairAssets: onChain };
    },
  }),

  tool({
    name: "get_claimables",
    toolset: "account",
    title: "Everything claimable",
    description:
      "Everything the wallet can claim right now, in one read: holder rewards, prediction-market winnings, vested " +
      "tokens, vault rewards and loan leftovers, with a total per asset. Each item names the tool that claims it.",
    input: { wallet: p.wallet() },
    run: async ({ wallet }, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, wallet);
      const c = await client.getClaimables(who, { upDownRounds: [] });
      const leftoverTool = (kind: string) =>
        kind === "hubLoan"
          ? "claim_loan_leftover (loan_id = id)"
          : kind === "leverage"
            ? "claim_leverage_leftover (position_id = id, with its main)"
            : "repay_loan_on_vesting (vesting_id = id): it settles the loan and returns the leftover to the vesting";
      return {
        wallet: c.user,
        totals: c.totals,
        holderRewards: c.holderRewards.length ? { claimWith: "claim_rewards (per token)", items: c.holderRewards } : [],
        markets: c.markets.length
          ? {
              claimWith: "redeem_market (per market)",
              items: c.markets.map((m) => ({
                market: m.market,
                kind: m.kind,
                status: m.status,
                marketTokensOwed: formatUnits(m.tokenPayout, 18),
                sellsFor: m.pairPayout,
                slicesRecommended: m.quote?.recommendedSlices,
                fitsInOneTransaction: m.quote?.fitsInOneTx,
              })),
            }
          : [],
        vesting: c.vesting.length ? { claimWith: "claim_vested_tokens (vesting_id)", items: c.vesting } : [],
        vault: c.vault.length ? { claimWith: "vault_claim_rewards", items: c.vault } : [],
        liquidations: c.liquidations.map((l) => ({ ...l, claimWith: leftoverTool(l.kind) })),
        skippedTokens: c.skippedTokens.length ? c.skippedTokens : undefined,
        skippedMarkets: c.skippedMarkets.length ? c.skippedMarkets : undefined,
        couldNotRead: c.failed.length ? c.failed : undefined,
      };
    },
  }),

  tool({
    name: "claim_paper_tokens",
    toolset: "account",
    title: "Claim paper tokens",
    description:
      "Paper only: claim free test tokens (one claim per token per wallet), e.g. tUSDG to trade with. Without a " +
      "token it claims every paper token this wallet hasn't claimed yet.",
    input: { token: z.string().optional().describe("Paper token symbol (e.g. tUSDG) or address. Default: all of them.") },
    write: true,
    networks: ["robinhoodPaper"],
    run: async ({ token }, ctx) => {
      const client = await ctx.client();
      if (token) {
        const t = await resolveToken(client, token);
        return txOut(client, await client.paper.claim(t));
      }
      const mains = await client.mains.list();
      const seen = new Set<string>();
      const results: unknown[] = [];
      for (const m of mains) {
        if (seen.has(m.pairAsset.toLowerCase())) continue;
        seen.add(m.pairAsset.toLowerCase());
        if (await client.paper.hasClaimed(m.pairAsset)) {
          results.push({ token: m.pairSymbol, status: "already claimed" });
          continue;
        }
        try {
          results.push({ token: m.pairSymbol, ...txOut(client, await client.paper.claim(m.pairAsset)) });
        } catch (e) {
          if (e instanceof TxNotConfirmedError) {
            results.push({ token: m.pairSymbol, status: "sent, not confirmed yet", hash: e.txHash, note: "Don't claim it again: check it with get_transaction." });
            results.push({ status: "stopped", note: "The other paper tokens weren't claimed: call claim_paper_tokens again once that one confirms." });
            break;
          } else {
            results.push({ token: m.pairSymbol, status: "failed", reason: errorText(e, explorerUrl(client)) });
          }
        }
      }
      return results;
    },
  }),

  tool({
    name: "get_paper_claims",
    toolset: "account",
    title: "Paper token claims",
    description: "Paper only: for each paper token, how much one claim gives and whether the wallet has claimed it.",
    input: { wallet: p.wallet() },
    networks: ["robinhoodPaper"],
    run: async ({ wallet }, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, wallet);
      const mains = await client.mains.list();
      const seen = new Set<string>();
      const out: unknown[] = [];
      for (const m of mains) {
        if (seen.has(m.pairAsset.toLowerCase())) continue;
        seen.add(m.pairAsset.toLowerCase());
        const [claimed, amount] = await Promise.all([client.paper.hasClaimed(m.pairAsset, who), client.paper.getClaimAmount(m.pairAsset)]);
        out.push({ token: m.pairSymbol, address: m.pairAsset, perClaim: amount, claimed });
      }
      return out;
    },
  }),

  tool({
    name: "set_referrer",
    toolset: "account",
    title: "Set referrer",
    description:
      "Name the wallet that referred you. Permanent: it can be set once and never changed. You then pay a lower base " +
      "fee on every trade, and your referrer earns a share of your fees.",
    input: { referrer: p.address("The referrer's wallet address.") },
    write: true,
    destructive: true,
    run: async ({ referrer }, ctx) => {
      const client = await ctx.client();
      return txOut(client, await client.referrals.setReferrer(addr(referrer, "referrer")));
    },
  }),

  tool({
    name: "get_referrer",
    toolset: "account",
    title: "Referrer",
    description: "Who referred a wallet (null if nobody), and how many wallets it has referred itself.",
    input: { wallet: p.wallet() },
    run: async ({ wallet }, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, wallet);
      const [referrer, referred] = await Promise.all([client.referrals.getReferrer(who), client.referrals.getReferralCount(who)]);
      return { wallet: who, referrer, walletsReferred: referred };
    },
  }),

  tool({
    name: "register_agent",
    toolset: "account",
    title: "Register as an agent",
    description:
      "Register this server's wallet as a BASIS agent (ERC-8004 identity) and sign in, or find the agent it already is. " +
      "Needed once for a new wallet before it can use the site features. Accepts the BASIS Terms. Costs a little ETH " +
      "for gas. Calling it again finds the existing agent instead of making a second one.",
    input: {
      name: z.string().describe("Agent name (becomes its username on BASIS)."),
      description: z.string().optional().describe("What the agent does, one or two sentences."),
      image_url: z.string().optional().describe("https link to an avatar image."),
      registration_tx: z
        .string()
        .optional()
        .describe(
          "Recovery only: the hash of an earlier registration that was sent but not finished. It finishes that one " +
            "instead of registering again (which would make a second identity).",
        ),
    },
    write: true,
    destructive: true,
    run: async ({ name, description, image_url, registration_tx }) => {
      if (!name.trim()) throw new ValidationError("name", "name must not be empty.");
      if (image_url && !/^(https|ipfs):\/\/\S+$/i.test(image_url.trim())) {
        throw new ValidationError("image_url", "image_url must be an https or ipfs link: it goes into the agent's public, on-chain registration.");
      }
      if (registration_tx && !/^0x[0-9a-fA-F]{64}$/.test(registration_tx)) {
        throw new ValidationError("registration_tx", "registration_tx must be 0x followed by 64 hex characters.");
      }
      const { client, result: r, unfinished } = await registerAgent(
        { name: name.trim(), description, image: image_url },
        registration_tx as `0x${string}` | undefined,
      );
      const wallet = client.account as Address;
      const recorded = !unfinished && (!r?.registration || r.registration.ok);
      let status: string;
      if (unfinished || !client.hasSession) {
        status = "on chain, not finished yet";
      } else if (!recorded) {
        status = "registered on chain and signed in; BASIS hasn't recorded the agent yet";
      } else if (r?.hash) {
        status = "registered and signed in";
      } else {
        let isAgent = false;
        try {
          const a = await client.agent.lookupFromApi(wallet);
          isAgent = !!(a.isAgent && a.agent);
        } catch {
        }
        status = isAgent ? "already an agent: signed in" : "signed in; BASIS doesn't list this wallet as an agent yet";
      }
      const out: Record<string, unknown> = {
        status,
        wallet,
        agentId: r?.agentId ?? null,
        hash: r?.hash ?? null,
        profile: r?.applied ?? null,
      };
      if (unfinished || !client.hasSession) {
        out.next = "Call register_agent again in a minute: it finishes this registration (it never makes a second identity).";
      } else if (!recorded) {
        out.next = "Run retry_pending_syncs in a minute so BASIS records the agent. Don't register again.";
      }
      if (r?.warnings?.length) out.warnings = plainWarnings(r.warnings);
      return userContent(out);
    },
  }),

  tool({
    name: "get_agent",
    toolset: "account",
    title: "Agent profile",
    description: "A wallet's BASIS agent record (agent id, name, description), or that it isn't an agent.",
    input: { wallet: p.wallet() },
    run: async ({ wallet }, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, wallet);
      return userContent(await client.agent.lookupFromApi(who));
    },
  }),

  tool({
    name: "get_transaction",
    toolset: "account",
    title: "Transaction status",
    description:
      "Check a transaction by hash: pending, confirmed or failed, and what BASIS recorded for it. Use it after a tool " +
      "says a transaction was sent but not confirmed, instead of sending it again.",
    input: { hash: z.string().describe("Transaction hash (0x...).") },
    run: async ({ hash }, ctx) => {
      const client = await ctx.client();
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new ValidationError("hash", "hash must be 0x followed by 64 hex characters.");
      const h = hash as Hex;
      const receipt = await client.publicClient.getTransactionReceipt({ hash: h }).catch((e) => {
        if (isNotFound(e)) return null;
        throw e;
      });
      if (!receipt) {
        const tx = await client.publicClient.getTransaction({ hash: h }).catch((e) => {
          if (isNotFound(e)) return null;
          throw e;
        });
        if (tx) return { hash: h, status: "pending", next: "It's waiting to confirm. Don't send it again: check again in a minute." };
        return {
          hash: h,
          status: "not seen yet",
          next:
            "The RPC doesn't know this hash yet. Check again in a minute before sending anything again: a transaction just sent can take a moment to show up.",
        };
      }
      let indexed: unknown = null;
      try {
        indexed = await client.api.getTx(h);
      } catch {
        indexed = "not recorded by BASIS yet";
      }
      return { hash: h, status: receipt.status === "success" ? "confirmed" : "failed", block: receipt.blockNumber, basis: indexed };
    },
  }),

  tool({
    name: "sync_transaction",
    toolset: "account",
    title: "Resend a transaction to BASIS",
    description:
      "Recovery only: ask BASIS to record a confirmed transaction it missed (every write tool already does this " +
      "itself). Never sends anything on chain.",
    input: { hash: z.string().describe("Transaction hash (0x...).") },
    write: true,
    sendsTx: false,
    run: async ({ hash }, ctx) => {
      const client = await ctx.client();
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new ValidationError("hash", "hash must be 0x followed by 64 hex characters.");
      return client.syncTx(hash);
    },
  }),

  tool({
    name: "retry_pending_syncs",
    toolset: "account",
    title: "Retry queued syncs",
    description:
      "Recovery only: send BASIS the confirmed transactions it hasn't recorded yet (kept in a local queue when the site " +
      "was down). Never sends anything on chain.",
    input: {},
    write: true,
    sendsTx: false,
    run: async (_args, ctx) => {
      const client = await ctx.client();
      return client.flushPendingSyncs();
    },
  }),
];

