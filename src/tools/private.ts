
import { z } from "zod";
import { erc20Abi, formatEther, formatUnits, zeroAddress, type Address } from "viem";
import {
  BasisApiError,
  TxNotConfirmedError,
  isZeroAddress,
  pairAmount,
  validateRanking,
  ValidationError,
  WalletRequiredError,
  type BasisClient,
  type CreateMarketWithMetadataResult,
  type MainInfo,
  type MarketApproval,
  type MarketApprovalResponse,
  type MarketApprovalSigned,
  type MarketData,
  type MarketUploadError,
  type PrivateVoteResult,
} from "basis-sdk";
import { p, tool, type ToolDef } from "../registry.js";
import { addr, resolveMain, resolveToken, slippageToBps, to18, toPairRaw, toTokenRaw, walletOrSelf } from "../units.js";
import { txOut, userContent } from "../present.js";
import { errorText, GuidedError } from "../errors.js";
import { outcomeParam, resolveOutcome } from "../outcomes.js";
import { httpsLink, imageFromUrl, readLocalImage } from "../files.js";
import { checkSpend, checkSpendTotal } from "../limits.js";
import { blockText, rewordPredictionRefusal } from "../predict.js";


/** A panel holds the creator plus up to 10 voters. */
const MAX_PANEL = 11;
/** Most wallets one invite or whitelist call takes. */
const MAX_WALLETS = 100;
const MAX_OUTCOMES = 150;

/** The market on the creator-managed host, or a ValidationError that points to the other tools. */
async function privateMarket(client: BasisClient, market: string): Promise<{ m: Address; md: MarketData }> {
  const m = addr(market, "market");
  const md = await client.privateMarkets.getMarketData(m);
  if (isZeroAddress(md.marketToken) || md.marketToken.toLowerCase() !== m.toLowerCase()) {
    throw new ValidationError(
      "market",
      `${m} isn't a creator-managed market. For a BASIS-managed market use predict, quote_prediction and get_market_info.`,
    );
  }
  return { m, md };
}

function iso(sec: bigint): string | null {
  return sec === 0n ? null : new Date(Number(sec) * 1000).toISOString();
}

/** Shares and market tokens are 18 decimals. */
function units18(raw: bigint): string {
  return formatUnits(raw, 18);
}

type Place = { place: number; outcomes: { id: number; name: string }[] };

/** A ranking with its tie bits as finishing places (bit i: entry i tied with entry i-1), outcomes named. */
function places(ranking: readonly number[], tieMask: bigint, names: readonly (string | undefined)[]): Place[] {
  const out: Place[] = [];
  ranking.forEach((id, i) => {
    const o = { id, name: names[id] ?? `outcome ${id}` };
    if (i > 0 && (tieMask & (1n << BigInt(i))) !== 0n) out[out.length - 1].outcomes.push(o);
    else out.push({ place: i + 1, outcomes: [o] });
  });
  return out;
}

interface Ranked {
  ranking: number[];
  tieMask: bigint;
}

/**
 * `ranking` (outcomes in finishing order, each a name or "#id") and `tied` (positions that share a place with the
 * entry before them) to the SDK's ranking and tie bits. Each tied group is put in ascending id order, as the chain
 * needs, so any order the agent writes is accepted.
 */
function readRanking(names: readonly string[], entries: readonly (string | number)[], tied: readonly number[] | undefined): Ranked {
  if (entries.length === 0) {
    throw new ValidationError("ranking", "ranking is empty: list the paid places in finishing order, or vote invalid: true.");
  }
  const ranking = entries.map((e, i) => resolveOutcome(names, e, `ranking[${i}]`));
  let tieMask = 0n;
  for (const i of tied ?? []) {
    if (!Number.isInteger(i) || i < 1 || i >= ranking.length) {
      throw new ValidationError(
        "tied",
        ranking.length < 2
          ? "tied needs a ranking of two or more entries."
          : `tied takes positions 1 to ${ranking.length - 1} of ranking (0 is the first entry: nothing before it to tie with).`,
      );
    }
    tieMask |= 1n << BigInt(i);
  }
  const isTied = (i: number) => (tieMask & (1n << BigInt(i))) !== 0n;
  for (let g0 = 0; g0 < ranking.length; ) {
    let g1 = g0 + 1;
    while (g1 < ranking.length && isTied(g1)) g1++;
    if (g1 - g0 > 1) ranking.splice(g0, g1 - g0, ...ranking.slice(g0, g1).sort((a, b) => a - b));
    g0 = g1;
  }
  return { ranking, tieMask };
}

/** The chain's ranking rules, checked before sending, with the refusal in plain words. */
function checkRanking(r: Ranked, names: readonly string[], paid: number): void {
  try {
    validateRanking(r.ranking, r.tieMask, names.length, paid);
  } catch (e) {
    if (!(e instanceof ValidationError)) throw e;
    if (e.rule === "duplicate") {
      const dup = r.ranking.find((id, i) => r.ranking.indexOf(id) !== i) ?? -1;
      throw new ValidationError("ranking", `ranking lists outcome #${dup} (${names[dup] ?? "?"}) twice. Nothing was sent.`);
    }
    if (e.rule === "rankingLength" || e.rule === "tieBoundary") {
      const paidText = paid === 1 ? "1 place" : `${paid} places`;
      throw new ValidationError(
        "ranking",
        `This market pays ${paidText}: list exactly ${paid} outcome${paid === 1 ? "" : "s"} in finishing order, plus any outcomes ` +
          "tied into the last paid place (mark those with tied). Nothing was sent.",
      );
    }
    throw e;
  }
}

/** Unix seconds, a numeric string or an ISO date; 0 = open-ended. */
function parseEndTime(v: string | number): bigint {
  const bad = () =>
    new ValidationError("end_time", "end_time must be unix seconds, an ISO date like 2026-12-31T18:00:00Z, or 0 for open-ended.");
  let sec: number;
  if (typeof v === "number") {
    sec = v;
  } else {
    const s = v.trim();
    if (/^\d+$/.test(s)) {
      sec = Number(s);
    } else {
      const ms = Date.parse(s);
      if (Number.isNaN(ms)) throw bad();
      sec = Math.floor(ms / 1000);
    }
  }
  if (!Number.isSafeInteger(sec) || sec < 0) throw bad();
  if (sec > 1e11) throw new ValidationError("end_time", "end_time looks like milliseconds: pass unix seconds.");
  return BigInt(sec);
}

/**
 * Payout split in percent ([70, 20, 10]) to basis points ([7000, 2000, 1000]), checked by the market's rules before
 * anything is sent or reviewed: 1 to 10 places, not more than the outcomes, each at least `outcomes` bps, never
 * rising, summing to 100.
 */
function splitToBps(split: number[] | undefined, outcomes: number): number[] | undefined {
  if (!split) return undefined;
  const field = "payout_split_percent";
  if (split.length > outcomes) {
    throw new ValidationError(field, `payout_split_percent has ${split.length} places, but the market has only ${outcomes} outcomes. Nothing was sent.`);
  }
  const out: number[] = [];
  split.forEach((pct, i) => {
    const bps = Math.round(pct * 100);
    if (!Number.isFinite(pct) || Math.abs(bps - pct * 100) > 1e-6) {
      throw new ValidationError(field, `payout_split_percent[${i}] must be a percent with at most 2 decimals; got ${pct}. Nothing was sent.`);
    }
    if (bps < outcomes) {
      throw new ValidationError(
        field,
        `Each place must get at least ${outcomes / 100}% on a market of ${outcomes} outcomes; payout_split_percent[${i}] is ${pct}. Nothing was sent.`,
      );
    }
    if (i > 0 && bps > out[i - 1]) {
      throw new ValidationError(field, `payout_split_percent must never rise: place ${i + 1} (${pct}%) is above place ${i} (${out[i - 1] / 100}%). Nothing was sent.`);
    }
    out.push(bps);
  });
  const sum = out.reduce((a, b) => a + b, 0);
  if (sum !== 10_000) throw new ValidationError(field, `payout_split_percent must add up to 100; it adds up to ${sum / 100}. Nothing was sent.`);
  return out;
}

/**
 * The outcome pictures keyed by the reviewed outcome names. The same names in another order: each picture follows its
 * name; names reworded in place: each picture follows its position; reworded and reordered: refused, since a picture
 * can't be matched to its outcome then.
 */
function moveArt(art: Record<string, string>, given: readonly string[], reviewed: readonly string[]): Record<string, string> {
  const g = given.map((o) => o.trim());
  const r = reviewed.map((o) => o.trim());
  const moved: Record<string, string> = {};
  if (JSON.stringify([...g].sort()) === JSON.stringify([...r].sort())) {
    for (const [label, pic] of Object.entries(art)) moved[label.trim()] = pic;
    return moved;
  }
  if (r.some((o, i) => o !== g[i] && g.includes(o))) {
    throw new GuidedError("BASIS review changed the order of the outcomes: pictures can't be matched. Nothing was sent.");
  }
  for (const [label, pic] of Object.entries(art)) moved[r[g.indexOf(label.trim())]] = pic;
  return moved;
}

const MAX_LINK = 191;
const MAX_RAW_LINK = 2048;
const TG_PATH = /^(?:[A-Za-z0-9_]{4,32}|\+[A-Za-z0-9_-]{6,64}|joinchat\/[A-Za-z0-9_-]{6,64})$/;
const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/;

type LinkField = "website" | "telegram" | "x";

const LINK_TEXT: Record<LinkField, string> = {
  website: "website must be an https link, like https://example.com",
  telegram: "telegram must be a Telegram link or handle, like https://t.me/your_channel or @your_channel",
  x: "x must be an X handle or profile link, like @your_handle or https://x.com/your_handle",
};

/** The link as BASIS stores it, or null when it isn't a valid one. */
function siteLink(field: LinkField, raw: string): string | null {
  if (field === "website") {
    const s = (/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`).trim();
    if (!s || s.length > MAX_RAW_LINK) return null;
    try {
      const url = new URL(s);
      return url.protocol === "https:" && url.hostname.includes(".") ? url.toString() : null;
    } catch {
      return null;
    }
  }
  if (field === "telegram") {
    const handle = /^@([A-Za-z0-9_]{4,32})$/.exec(raw);
    let path: string | null = handle ? handle[1] : null;
    if (!path) {
      const m = /^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/([^?#]+?)\/?(?:[?#].*)?$/i.exec(raw);
      path = m ? m[1] : /^[A-Za-z0-9_]{4,32}$/.test(raw) ? raw : null;
    }
    return path && TG_PATH.test(path) ? `https://t.me/${path}` : null;
  }
  const m = /^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/@?([^/?#]+)\/?(?:[?#].*)?$/i.exec(raw);
  const handle = m ? m[1] : raw.replace(/^@/, "");
  return X_HANDLE.test(handle) ? `https://x.com/${handle}` : null;
}

function checkLinks(links: Partial<Record<LinkField, string>>): void {
  for (const field of ["website", "telegram", "x"] as const) {
    const raw = links[field]?.trim();
    if (!raw) continue;
    if (raw.length > MAX_RAW_LINK) throw new ValidationError(field, `${field} is ${raw.length} characters; at most ${MAX_RAW_LINK}. Nothing was sent.`);
    const link = siteLink(field, raw);
    if (link === null) throw new ValidationError(field, `${LINK_TEXT[field]}; got ${JSON.stringify(links[field])}. Nothing was sent.`);
    if (link.length > MAX_LINK) {
      throw new ValidationError(field, `${field} is too long: ${link.length} characters as BASIS stores it (${link}), at most ${MAX_LINK}. Nothing was sent.`);
    }
  }
}

/** SDK option names in its refusals, as this module's parameter names. */
const FIELD_NAMES: [RegExp, string][] = [
  [/\bhostedImageUrl\b/g, "hosted_image_url"],
  [/\bimageUrl\b/g, "image_url"],
  [/\bimageFile\b/g, "image_file_path"],
  [/\boutcomeArt\b/g, "outcome_art"],
  [/\btwitterx\b/g, "x"],
  [/\bpresaleTokens\b/g, "presale_tokens"],
  [/\bendTime\b/g, "end_time"],
  [/\bThe market approval (takes|needs)\b/g, "A market $1"],
];

function withFieldNames(e: ValidationError): ValidationError {
  let msg = e.message.replace(/\[basis-sdk\]\s*/g, "");
  for (const [re, name] of FIELD_NAMES) msg = msg.replace(re, name);
  return new ValidationError(e.rule, msg);
}

const FROZEN_TEXT = "frozen: true needs presale_tokens above 0 (more than your seed buys). Nothing was sent.";

function feeShort(fee: bigint, held: bigint): ValidationError {
  return new ValidationError("fee", `Not enough ETH for the creation fee: it is ${formatEther(fee)} ETH, and the wallet holds ${formatEther(held)} ETH. Nothing was sent.`);
}

/** A refused, busy or unconfirmed create (or its review), in this tool's words and human units. */
function rewordCreate(e: unknown, outcomeCount: number): unknown {
  if (e instanceof TxNotConfirmedError && e.functionName === "approve") return e;
  if (e instanceof TxNotConfirmedError) {
    return new GuidedError(
      `The market was sent but isn't confirmed yet: ${e.txHash}. Don't create it again. When get_transaction shows it ` +
        "confirmed, find the market with private_get_roles or get_market_list (type private, creator: your wallet) and add " +
        "its picture and details with private_retry_market_metadata.",
      e.txHash,
    );
  }
  if (e instanceof BasisApiError && (e.code === "screening_slow" || e.code === "gate_busy")) {
    const s = e.retryAfter ? Math.ceil(e.retryAfter) : 30;
    return new GuidedError(`BASIS is still reviewing this market. Nothing was sent. Call private_create_market again with the same inputs in about ${s} s.`);
  }
  if (!(e instanceof ValidationError)) return e;
  const n = outcomeCount;
  switch (e.rule) {
    case "insufficient balance": {
      const m = /creation fee is (\d+) wei of the native coin; the wallet holds (\d+)/.exec(e.message);
      return m ? feeShort(BigInt(m[1]), BigInt(m[2])) : e;
    }
    case "market rejected":
      return new ValidationError("market", `${withFieldNames(e).message} Nothing was sent. Change the wording (draft_market can help) and try again.`);
    case "Approval expired":
      return new ValidationError("market", "BASIS's approval of this market ran out before it was sent. Nothing was sent. Call private_create_market again.");
    case "Invalid approval":
      return new ValidationError("market", "BASIS's approval doesn't match this market. Nothing was sent. Call private_create_market again.");
    case "endTime":
      return new ValidationError("end_time", "end_time must be 0 (open-ended), or from about 1 hour to 1825 days ahead. Nothing was sent.");
    case "trancheBP":
      return new ValidationError(
        "payout_split_percent",
        `payout_split_percent takes 1 to 10 places (no more than the ${n} outcomes), each at least ${n / 100}% on a market of ` +
          `${n} outcomes, never rising from one place to the next, summing to 100. Nothing was sent.`,
      );
    case "frozen needs presale":
      return new ValidationError("presale_tokens", FROZEN_TEXT);
    case "host paused":
      return new ValidationError("paused", "New creator-managed markets are paused right now. Nothing was sent. Try again later.");
    case "convert closed":
      return new ValidationError("seed", "New markets can't be seeded right now. Nothing was sent. Try again later.");
    case "pair not active":
      return new ValidationError("main", "Trading on this main is paused right now, so no market can be created on it. Nothing was sent. Try another main (get_mains) or try again later.");
    case "Trading is not enabled":
      return new ValidationError(
        "main",
        "Trading on this main hasn't opened yet, so no seeded market can be created on it. Nothing was sent. Try again once it opens, or use another main (get_mains).",
      );
    case "ecosystem inactive":
    case "asset mismatch":
    case "Signer unset":
      return new ValidationError(
        "main",
        "Creator-managed markets can't be created on this main right now. Nothing was sent. Try another main (get_mains) or try again later.",
      );
    default:
      return withFieldNames(e);
  }
}

const ART_ID = /^(answers|coins|crypto|money|politics|flags|sports|weather|science|tech|entertainment|time|animals|shapes|glyphs)\/[a-z0-9][a-z0-9-]{0,47}$/;

function checkArt(art: Record<string, string>, outcomes: readonly string[]): void {
  const names = new Set(outcomes.map((o) => o.trim()));
  const seenNames = new Set<string>();
  const seenIds = new Set<string>();
  for (const [label, id] of Object.entries(art)) {
    const name = label.trim();
    if (!names.has(name)) throw new ValidationError("outcome_art", `outcome_art names "${label}", which isn't one of the outcomes. Nothing was sent.`);
    if (seenNames.has(name)) throw new ValidationError("outcome_art", `outcome_art names "${label}" twice. Nothing was sent.`);
    seenNames.add(name);
    if (!ART_ID.test(id)) {
      throw new ValidationError("outcome_art", `outcome_art["${label}"] is "${id}", not a picture of BASIS's library (like "answers/yes"). Nothing was sent.`);
    }
    if (seenIds.has(id)) throw new ValidationError("outcome_art", `Picture ${id} is picked twice: each picture can be used once per market. Nothing was sent.`);
    seenIds.add(id);
  }
}

/** The wallet holds the seed (pair asset) and the ETH creation fee. Run before a review, so a short wallet doesn't use one up. */
async function checkFunds(client: BasisClient, info: MainInfo, seed: bigint, fee: bigint): Promise<void> {
  const me = client.account;
  if (!me) throw new WalletRequiredError();
  const [held, eth] = await Promise.all([
    seed > 0n ? client.publicClient.readContract({ address: info.pairAsset, abi: erc20Abi, functionName: "balanceOf", args: [me] }) : Promise.resolve(0n),
    fee > 0n ? client.publicClient.getBalance({ address: me }) : Promise.resolve(0n),
  ]);
  if (held < seed) {
    throw new ValidationError(
      "seed",
      `Not enough ${info.pairSymbol} for the seed: it is ${pairAmount(seed, info).formatted} ${info.pairSymbol}, and the wallet holds ${pairAmount(held, info).formatted}. Nothing was sent.`,
    );
  }
  if (eth < fee) throw feeShort(fee, eth);
}

/** What BASIS review changed (name, symbol, outcomes by id), or null when the market went on chain as written. */
function rewording(given: { name: string; symbol: string; outcomes: readonly string[] }, sent: MarketApprovalSigned): Record<string, unknown> | null {
  const same = (a: string, b: string | undefined) => b !== undefined && (a === b || a === b.trim());
  const changed: Record<string, unknown> = {};
  if (!same(sent.name, given.name)) changed.name = sent.name;
  if (!same(sent.symbol, given.symbol)) changed.symbol = sent.symbol;
  const outs = sent.outcomes.flatMap((o, i) => (same(o, given.outcomes[i]) ? [] : [{ id: i, was: given.outcomes[i] ?? null, now: o }]));
  if (outs.length) changed.outcomes = outs;
  return Object.keys(changed).length ? changed : null;
}

/** A voting or settling refusal in plain words, times as ISO dates. */
function rewordVote(e: unknown): unknown {
  if (!(e instanceof ValidationError)) return e;
  const t = /(?:opens|closes) at (\d+)/.exec(e.message);
  const when = t ? iso(BigInt(t[1])) : null;
  switch (e.rule) {
    case "not a voter":
      return new ValidationError("vote", "This wallet isn't on this market's voter panel, so it can't vote. See the panel with private_get_voter_panel.");
    case "already voted":
      return new ValidationError("vote", "This wallet has already voted on this market: a vote can't be changed.");
    case "voting not open":
      return new ValidationError("vote", `Voting hasn't started yet${when ? `: it starts at ${when}` : ""}.`);
    case "market resolved":
      return new ValidationError("market", "This market is already settled. Holders claim with redeem_market.");
    case "voting window open":
      return new ValidationError("finalize", `Voting is still running${when ? ` until ${when}` : ""}: settle it after that.`);
    case "no votes":
      return new ValidationError("finalize", "Nobody on the panel has voted yet, so there's nothing to settle.");
    case "creator must break the tie":
      return new ValidationError("finalize", "The vote is tied, and only the creator's vote can break it: it can be settled once the creator has voted.");
    default:
      return e;
  }
}

function uploadProblem(e: MarketUploadError | null, imageUrl: string | null): Record<string, unknown> | null {
  if (!e) return null;
  if (e.stage === "market") {
    return {
      stage: "market",
      message: "The new market's address couldn't be read from the transaction.",
      fix:
        "Find the market with private_get_roles or get_market_list (type private, creator: your wallet), then run " +
        "private_retry_market_metadata. Don't create it again.",
    };
  }
  if (e.code === "exists") {
    return { stage: e.stage, message: "This market's details are already set.", fix: "Nothing to do: a market's details can be set only once." };
  }
  return {
    stage: e.stage,
    message: errorText(e.cause ?? e.message),
    fix: imageUrl
      ? "Run private_retry_market_metadata for this market with hosted_image_url set to imageUrl (the picture is already up). Don't create the market again."
      : "Run private_retry_market_metadata for this market, with the picture again. Don't create the market again.",
  };
}

/** The create's upload warnings: uploadProblem already says what failed and what to do. */
const UPLOAD_WARNING = /upload failed|market address is unknown/;

/** A too-small prediction when the smallest one can't be read: still in human units. */
function tooSmall(e: ValidationError): ValidationError {
  const m = /converts to (\d+) market tokens, below the minimum bet of (\d+)/.exec(e.message);
  if (m) {
    return new ValidationError(
      "amount",
      `That's below the smallest prediction on this market: it converts to ${units18(BigInt(m[1]))} market tokens, and the minimum is ${units18(BigInt(m[2]))}. Predict more.`,
    );
  }
  return new ValidationError("amount", "That prediction is too small for this market. Predict more (private_quote_prediction shows what an amount gets).");
}

/**
 * An SDK refusal of a prediction, in prediction words with human amounts: the smallest prediction when the amount is
 * too small, else the shared prediction texts (block reasons, a zero amount). Anything else is passed on as it is.
 */
async function reword(client: BasisClient, e: unknown, market: Address, input: Address, bettor?: Address): Promise<unknown> {
  if (!(e instanceof ValidationError)) return e;
  if (["minBet", "precision", "minShares", "minTokens"].includes(e.rule)) {
    try {
      const [min, meta] = await Promise.all([client.marketReader.minBetInput("private", market, input, bettor), client.mains.tokenMeta(input)]);
      return new ValidationError(
        "amount",
        `That's below the smallest prediction on this market: about ${formatUnits(min.minInput, meta.decimals)} ${meta.symbol}. Predict at least that much.`,
      );
    } catch {
      const shared = rewordPredictionRefusal(e, "private");
      return shared !== e ? shared : tooSmall(e);
    }
  }
  const shared = rewordPredictionRefusal(e, "private");
  if (shared !== e) return shared;
  if (e.rule === "quote") {
    return new ValidationError(
      "amount",
      "This prediction gets no shares: the market may be resolved, the outcome out of range, or the token you pay with can't be converted.",
    );
  }
  if (e.rule === "Buy: need asset/MAIN") {
    return new ValidationError("pay_with", "That token can't pay for a prediction on this network. Pay with the market's pair asset or its main.");
  }
  return e;
}

async function payInput(client: BasisClient, md: MarketData, payWith?: string): Promise<Address> {
  return payWith ? resolveToken(client, payWith, "pay_with") : md.pairAsset;
}


const marketParam = () => p.address("The creator-managed market (its market token address, 0x...).");
const OUTCOME_TEXT = 'The outcome: its name, or its id as "#0" (0 is the first). See the outcomes with private_get_market.';
const optOutcomeParam = (desc: string) => outcomeParam(desc).optional().describe(desc);
const payWithParam = () =>
  z
    .string()
    .optional()
    .describe("Token you pay with: an address, or a main or pair-asset symbol (e.g. USDG, STASIS). Default: the market's pair asset.");
const walletsParam = (desc: string) => z.array(z.string()).min(1).max(MAX_WALLETS).describe(`${desc} Up to ${MAX_WALLETS} per call.`);
const outcomeArtParam = (note = "") =>
  z
    .record(z.string(), z.string())
    .optional()
    .describe(
      'Pictures for outcomes from the BASIS picture library: { "<outcome label>": "<category>/<name>" }, e.g. { "Yes": "answers/yes" }. ' +
        "Categories: answers, coins, crypto, money, politics, flags, sports, weather, science, tech, entertainment, time, animals, " +
        `shapes, glyphs. Each picture once. Set once, with the other details.${note}`,
    );
const linkParams = () => ({
  website: z.string().optional().describe("https link for the market."),
  telegram: z.string().optional().describe("Telegram link or handle (t.me/...)."),
  x: z.string().optional().describe("X handle or profile link."),
});


export const privateTools: ToolDef[] = [
  tool({
    name: "private_create_market",
    toolset: "private",
    title: "Create a creator-managed market",
    description:
      "Create a creator-managed prediction market: you write the question and outcomes, and a voter panel you pick (you plus " +
      "up to 10 wallets) decides the result. BASIS may review the market first and refuse it (it says why, and nothing is " +
      "sent) or adjust its wording. Costs the seed plus gas, and an ETH creation fee where one applies (ETH is real on paper " +
      "too; see private_get_min_seed). For a public market settled by BASIS use create_market.",
    input: {
      name: z.string().describe("The question or title, up to 200 characters."),
      symbol: z.string().describe("Market token symbol, 1 to 16 letters or digits."),
      outcomes: z
        .array(z.string())
        .min(2)
        .max(MAX_OUTCOMES)
        .describe("Outcome labels in order, 2 to 150, each up to 120 characters. The first is outcome #0."),
      end_time: z
        .union([z.string(), z.number()])
        .describe(
          "When predictions close: unix seconds or an ISO date (e.g. 2026-12-31T18:00:00Z), at least an hour ahead. Voting starts " +
            "then. 0 = open-ended: voters can vote any time and the first vote closes predictions.",
        ),
      invite_only: z
        .boolean()
        .describe(
          "true: invite-only for the whole life of the market: only wallets you invite (and you) can predict, and BASIS doesn't " +
            "show it to other wallets. false: anyone can predict. The minimum seed differs, see private_get_min_seed.",
        ),
      description: z
        .string()
        .optional()
        .describe("Resolution rules: what counts as each outcome and which source voters should use. Up to 2000 characters."),
      image_url: z.string().optional().describe("Market picture: an https link (resized to 512x512 when the server can). Give this or image_file_path."),
      image_file_path: p.imageFile(),
      seed: p.optAmount(
        "Your opening stake, in the pair asset of the market's main (e.g. USDG). Default: the minimum (private_get_min_seed). It " +
          "gives you equal shares on every outcome. 0 works only where the minimum is 0.",
      ),
      main: p.main(),
      payout_split_percent: z
        .array(z.number())
        .min(1)
        .max(10)
        .optional()
        .describe(
          "How the pot is split by finishing place, in percent: [70, 20, 10] pays the top three. Up to 10 places, never " +
            "rising, sums to 100. Default [100]: winner takes all.",
        ),
      frozen: p.bool(
        "true: start in a presale phase: only wallets on the market token's whitelist (private_manage_whitelist) can predict " +
          "until the presale fills or you end it with private_disable_freeze. Needs presale_tokens, more than your seed buys. " +
          "Separate from invite_only: an invite-only market stays invite-only after its presale. Default false.",
      ),
      presale_tokens: z.number().int().min(0).optional().describe("Presale size of the market token, in whole tokens (needed with frozen). Default 0: no presale."),
      outcome_art: outcomeArtParam(" If BASIS review rewords the outcomes, each picture stays with its outcome."),
      ...linkParams(),
    },
    write: true,
    run: async (args, ctx) => {
      const client = await ctx.client();
      const pmk = client.privateMarkets;
      if (!!args.image_url === !!args.image_file_path) {
        throw new ValidationError("image_url", "A market needs one picture: give image_url (an https link) or image_file_path (a local image), not both.");
      }
      const imageUrl = args.image_url ? httpsLink(args.image_url, "image_url") : undefined;
      const endTime = parseEndTime(args.end_time);
      const trancheBP = splitToBps(args.payout_split_percent, args.outcomes.length);
      if (args.frozen && !args.presale_tokens) throw new ValidationError("presale_tokens", FROZEN_TEXT);
      checkLinks({ website: args.website, telegram: args.telegram, x: args.x });
      const art = args.outcome_art && Object.keys(args.outcome_art).length ? args.outcome_art : undefined;
      if (art) checkArt(art, args.outcomes);
      const image = args.image_file_path
        ? await readLocalImage(args.image_file_path, "image_file_path")
        : imageUrl
          ? await imageFromUrl(client, imageUrl, "image_url")
          : undefined;
      const info = await resolveMain(client, args.main);
      const seed = args.seed === undefined ? undefined : toPairRaw(info, args.seed, "seed");

      const reviewFirst = art !== undefined && (await pmk.isGatingEnabled());
      if (reviewFirst && (await pmk.isPaused())) {
        throw new GuidedError("New creator-managed markets are paused right now. Nothing was sent.");
      }
      if (reviewFirst || ctx.config.maxSpendUsd !== undefined) {
        const [sizes, fee] = await Promise.all([client.marketReader.marketSizes("private", info.main, args.outcomes.length), pmk.getCreationFee(info.main)]);
        const floor = (args.invite_only ? sizes.minSeedPrivateEvent : sizes.minSeed) ?? sizes.minSeed;
        const seedRaw = seed ?? floor;
        if (reviewFirst) {
          if (seedRaw < floor || (seedRaw !== 0n && sizes.seedStep > 0n && seedRaw % sizes.seedStep !== 0n)) {
            const f = pairAmount(floor, info);
            const st = pairAmount(sizes.seedStep, info);
            throw new ValidationError(
              "seed",
              `seed must be at least ${f.formatted} ${f.symbol} and a multiple of ${st.formatted} ${st.symbol}${floor === 0n ? " (or 0)" : ""}; got ${pairAmount(seedRaw, info).formatted}. Nothing was sent.`,
            );
          }
          await checkFunds(client, info, seedRaw, fee);
        }
        await checkSpendTotal(client, [
          { token: info.pairAsset, raw: seedRaw },
          { token: zeroAddress, raw: fee },
        ]);
      }

      let name = args.name;
      let symbol = args.symbol;
      let outcomes = args.outcomes;
      let outcomeArt = art;
      let approval: MarketApproval | undefined;
      if (reviewFirst && art) {
        const given = args.outcomes.map((o) => o.trim());
        let res: MarketApprovalResponse;
        try {
          res = await client.api.approveMarket({
            marketType: "private",
            name: name.trim(),
            symbol: symbol.trim(),
            description: args.description,
            outcomes: given,
            endTime,
            main: info.main,
            privateEvent: args.invite_only,
            ...(seed !== undefined ? { seedAmount: seed } : {}),
          });
        } catch (e) {
          throw rewordCreate(e, given.length);
        }
        if (!res.approved) {
          throw new GuidedError(
            `BASIS did not approve this market${res.category ? ` (${res.category})` : ""}: ${res.reason ?? "no reason given"}. Nothing was sent. Change the wording (draft_market can help) and try again.`,
          );
        }
        const reviewed = [...res.signed.outcomes];
        if (reviewed.length !== given.length) {
          throw new GuidedError(
            `BASIS review returned ${reviewed.length} outcomes for the ${given.length} you gave, so the market can't be created from it. Nothing was sent. Check the outcomes and try again.`,
          );
        }
        outcomeArt = moveArt(art, given, reviewed);
        approval = { signature: res.signature, deadline: res.deadline, signed: res.signed };
        name = res.signed.name;
        symbol = res.signed.symbol;
        outcomes = reviewed;
      }

      let r: CreateMarketWithMetadataResult;
      try {
        r = await pmk.createMarketWithMetadata({
          name,
          symbol,
          outcomes,
          endTime,
          privateEvent: args.invite_only,
          trancheBP,
          main: info.main,
          frozen: args.frozen ?? false,
          presaleTokens: args.presale_tokens ?? 0,
          seed,
          description: args.description,
          approval,
          imageFile: image?.bytes,
          website: args.website,
          telegram: args.telegram,
          twitterx: args.x,
          outcomeArt,
        });
      } catch (e) {
        throw rewordCreate(e, outcomes.length);
      }
      const { approval: used, uploadError, sharesPerOutcome, sent, ...rest } = r;
      const next: string[] = [];
      if (uploadError) next.push("The market exists: finish its picture and details with private_retry_market_metadata (see uploadProblem). Don't create it again.");
      if (args.invite_only) next.push("Invite wallets with private_set_buyers: only invited wallets (and you) can predict.");
      next.push("Add voters with private_manage_voter before the first vote (you plus up to 10).");
      if (args.frozen) {
        next.push("Presale phase: whitelist wallets with private_manage_whitelist. It ends when the presale fills, or end it early with private_disable_freeze.");
      }
      const changed = rewording(args, sent);
      const extra: Record<string, unknown> = { basisReview: used ? "approved" : "not required" };
      if (changed) {
        extra.rewordedByReview = changed;
        if (art && changed.outcomes) {
          extra.outcomePictures = approval
            ? "Each picture was kept with its outcome under the reviewed name."
            : "Pictures were set for the names you gave; an outcome whose name changed shows no picture.";
        }
      }
      extra.sharesPerOutcome = sharesPerOutcome === null ? null : units18(sharesPerOutcome);
      extra.uploadProblem = uploadProblem(uploadError, r.imageUrl);
      extra.next = next;
      return userContent(txOut(client, { ...rest, warnings: rest.warnings.filter((w) => !UPLOAD_WARNING.test(w)) }, extra));
    },
  }),

  tool({
    name: "private_retry_market_metadata",
    toolset: "private",
    title: "Finish a market's details",
    description:
      "Finish a creator-managed market whose picture or details upload failed after private_create_market (the market " +
      "exists: never create it again). Creator only. Sends no transaction. A market's details can be set only once. " +
      "retry_market_metadata does the same for any market.",
    input: {
      market: marketParam(),
      image_url: z.string().optional().describe("https link to the picture. Give exactly one of image_url, image_file_path, hosted_image_url."),
      image_file_path: p.imageFile(),
      hosted_image_url: z.string().optional().describe("The imageUrl from the create result, when the picture already went up."),
      description: z.string().optional().describe("Resolution rules: what counts as each outcome and which source voters should use."),
      outcome_art: outcomeArtParam(),
      ...linkParams(),
    },
    write: true,
    sendsTx: false,
    run: async (args, ctx) => {
      const client = await ctx.client();
      const sources = [args.image_url, args.image_file_path, args.hosted_image_url].filter((s) => s !== undefined && s !== "").length;
      if (sources !== 1) throw new ValidationError("image_url", "Give exactly one of image_url, image_file_path or hosted_image_url.");
      const { m } = await privateMarket(client, args.market);
      const image = args.image_file_path
        ? await readLocalImage(args.image_file_path, "image_file_path")
        : args.image_url
          ? await imageFromUrl(client, args.image_url, "image_url")
          : undefined;
      const res = await client.privateMarkets
        .retryMarketMetadata(m, {
          imageFile: image?.bytes,
          hostedImageUrl: args.hosted_image_url,
          description: args.description,
          website: args.website,
          telegram: args.telegram,
          twitterx: args.x,
          outcomeArt: args.outcome_art,
        })
        .catch((e: unknown) => {
          throw e instanceof ValidationError ? withFieldNames(e) : e;
        });
      const status = !res.uploadError ? "done" : res.uploadError.code === "exists" ? "already set" : "failed";
      return {
        market: m,
        status,
        imageUrl: res.imageUrl,
        metadata: res.metadata,
        problem: uploadProblem(res.uploadError, res.imageUrl),
      };
    },
  }),

  tool({
    name: "private_quote_prediction",
    toolset: "private",
    title: "Preview a prediction",
    description:
      "Preview a prediction on a creator-managed market: first whether the wallet may predict now, then the shares an amount " +
      "gets, the minimum after slippage, the average price per share and the fee. Nothing is sent. quote_prediction gives " +
      "the same quote for any market.",
    input: {
      market: marketParam(),
      outcome: outcomeParam(OUTCOME_TEXT),
      amount: p.amount("Amount to pay, in the token you pay with (default the market's pair asset, e.g. USDG)."),
      pay_with: payWithParam(),
      wallet: p.wallet("Wallet that would predict (its invite and fee rate apply). Default: this server's wallet."),
      slippage_percent: p.slippage(),
    },
    run: async ({ market, outcome, amount, pay_with, wallet, slippage_percent }, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, wallet);
      const slippageBps = slippageToBps(slippage_percent);
      const { m, md } = await privateMarket(client, market);
      const input = await payInput(client, md, pay_with);
      const [raw, meta, names] = await Promise.all([
        toTokenRaw(client, input, amount),
        client.mains.tokenMeta(input),
        client.privateMarkets.getOptionNames(m),
      ]);
      const id = resolveOutcome(names, outcome, "outcome");
      if (raw <= 0n) throw new ValidationError("amount", "amount must be above 0.");
      const base = {
        market: m,
        wallet: who,
        outcome: { id, name: names[id] ?? null },
        pay: `${formatUnits(raw, meta.decimals)} ${meta.symbol}`,
      };
      const check = await client.privateMarkets.checkBuy(m, id, { buyer: who, input });
      if (!check.canBet) return userContent({ ...base, canPredict: false, why: blockText(check.reason, "private"), note: "Nothing to quote." });
      const q = await client.marketReader
        .quoteBet({ market: m, outcome: id, input, amount: raw, host: "private", bettor: who, slippageBps })
        .catch(async (e: unknown) => {
          throw await reword(client, e, m, input, who);
        });
      if (q.shares <= 0n) throw new ValidationError("amount", "That amount is too small to get any shares. Predict a bigger amount.");
      return userContent({
        ...base,
        canPredict: true,
        shares: units18(q.shares),
        minShares: units18(q.minShares),
        pricePerShare: `${formatUnits((raw * 10n ** 18n) / q.shares, meta.decimals)} ${meta.symbol}`,
        feePercent: q.feeBps / 100,
        next: "Send it with private_predict (same market, outcome and amount).",
      });
    },
  }),

  tool({
    name: "private_predict",
    toolset: "private",
    title: "Predict",
    description:
      "Predict on an outcome of a creator-managed market: pay an amount (default in the market's pair asset, e.g. USDG) and get " +
      "shares of that outcome. The minimum shares come from a fresh quote and your slippage. Preview with " +
      "private_quote_prediction. predict does the same on any market.",
    input: {
      market: marketParam(),
      outcome: outcomeParam(OUTCOME_TEXT),
      amount: p.amount("Amount to pay, in the token you pay with (default the market's pair asset, e.g. USDG)."),
      pay_with: payWithParam(),
      slippage_percent: p.slippage(),
    },
    write: true,
    run: async ({ market, outcome, amount, pay_with, slippage_percent }, ctx) => {
      const client = await ctx.client();
      const slippageBps = slippageToBps(slippage_percent);
      const { m, md } = await privateMarket(client, market);
      const input = await payInput(client, md, pay_with);
      const [raw, names] = await Promise.all([toTokenRaw(client, input, amount), client.privateMarkets.getOptionNames(m)]);
      const id = resolveOutcome(names, outcome, "outcome");
      if (raw <= 0n) throw new ValidationError("amount", "amount must be above 0.");
      await checkSpend(client, input, raw);
      const r = await client.privateMarkets.buy(m, id, raw, { input, slippageBps }).catch(async (e: unknown) => {
        throw await reword(client, e, m, input);
      });
      const { shares, minShares, deadline: _deadline, input: _input, ...rest } = r;
      return userContent(
        txOut(client, rest, {
          outcome: { id, name: names[id] ?? null },
          sharesBought: shares === null ? null : units18(shares),
          minShares: units18(minShares),
        }),
      );
    },
  }),

  tool({
    name: "private_vote",
    toolset: "private",
    title: "Vote on the result",
    description:
      "Cast your vote on the result, if you're on the market's voter panel. Once per voter, and it can't be changed. Voting " +
      "starts at the end time (open-ended markets: any time, and the first vote closes predictions). Give exactly one of " +
      "outcome (markets that pay one place), ranking with tied (markets that pay several places: placesToRank in " +
      "private_get_voter_panel) or invalid: true. For a BASIS-managed market see get_market_resolution_status.",
    input: {
      market: marketParam(),
      outcome: optOutcomeParam(
        'The winning outcome, on a market that pays one place (winner takes all): its name, or its id as "#0".',
      ),
      ranking: z
        .array(z.union([z.string(), z.number().int().min(0)]))
        .min(1)
        .max(MAX_OUTCOMES)
        .optional()
        .describe(
          'Your result in finishing order, first place first: each outcome a name or "#id". List exactly the paid places ' +
            "(placesToRank in private_get_voter_panel), plus any outcomes tied into the last paid place.",
        ),
      tied: z
        .array(z.number().int().min(1))
        .max(MAX_OUTCOMES - 1)
        .optional()
        .describe(
          "With ranking only: positions in ranking (0 = first entry) that share a place with the entry before them. [1] puts " +
            "the first two level (tied first); [2] ties the third with the second. Tied outcomes can be listed in any order.",
        ),
      invalid: p.bool(
        "true votes INVALID: the question can't be settled fairly. If INVALID wins, holders redeem refunds based on what they " +
          "staked instead of winners being paid.",
      ),
    },
    write: true,
    destructive: true,
    run: async ({ market, outcome, ranking, tied, invalid }, ctx) => {
      const client = await ctx.client();
      const modes = [outcome !== undefined, ranking !== undefined, invalid === true].filter(Boolean).length;
      if (modes !== 1) throw new ValidationError("vote", "Give exactly one of outcome, ranking or invalid: true.");
      if (tied?.length && ranking === undefined) throw new ValidationError("tied", "tied goes with ranking only.");
      const { m } = await privateMarket(client, market);
      const [names, bp] = await Promise.all([client.privateMarkets.getOptionNames(m), client.privateMarkets.getTrancheBP(m)]);
      let r: PrivateVoteResult;
      let vote: unknown;
      try {
        if (invalid) {
          r = await client.privateMarkets.voteInvalid(m);
          vote = "INVALID";
        } else if (outcome !== undefined) {
          const id = resolveOutcome(names, outcome, "outcome");
          if (bp.length > 1) {
            throw new ValidationError(
              "outcome",
              `This market pays ${bp.length} places: vote with ranking (the ${bp.length} paid places in finishing order, names ` +
                'or "#id"), plus tied for any shared place. Nothing was sent.',
            );
          }
          r = await client.privateMarkets.voteOutcome(m, id);
          vote = places([id], 0n, names);
        } else {
          const pick = readRanking(names, ranking ?? [], tied);
          checkRanking(pick, names, bp.length);
          r = await client.privateMarkets.vote(m, pick.ranking, pick.tieMask);
          vote = places(pick.ranking, pick.tieMask, names);
        }
      } catch (e) {
        throw rewordVote(e);
      }
      const { key: _key, ...rest } = r;
      return userContent(
        txOut(client, rest, {
          vote,
          next: "When the voting window has passed (see private_get_voter_panel), anyone can settle it with private_finalize.",
        }),
      );
    },
  }),

  tool({
    name: "private_finalize",
    toolset: "private",
    title: "Settle a market",
    description:
      "Settle a creator-managed market once its voting window has passed: the result with the most votes wins. Anyone can call " +
      "it. On a tie the creator's vote decides (it waits until the creator has voted); if the creator picked none of the tied " +
      "results, the market resolves INVALID. BASIS-managed markets settle with finalize_market.",
    input: { market: marketParam() },
    write: true,
    run: async ({ market }, ctx) => {
      const client = await ctx.client();
      const { m } = await privateMarket(client, market);
      const names = await client.privateMarkets.getOptionNames(m);
      const r = await client.privateMarkets.finalize(m).catch((e: unknown) => {
        throw rewordVote(e);
      });
      const { status, finalOutcome: _finalOutcome, ranking, tieMask, swept, ...rest } = r;
      const extra: Record<string, unknown> = {
        result: status === "invalid" ? "INVALID" : status,
        places: status === "resolved" && ranking && tieMask !== null ? places(ranking, tieMask, names) : null,
        next: "Holders claim with redeem_market.",
      };
      if (swept.raw > 0n) {
        extra.sweptToFees = swept;
        extra.note = "No paid outcome had any holders, so the pot went to protocol fees.";
      }
      return userContent(txOut(client, rest, extra));
    },
  }),

  tool({
    name: "private_manage_voter",
    toolset: "private",
    title: "Add or remove a voter",
    description:
      "Creator only: add a wallet to your market's voter panel or remove it. The panel is you plus up to 10 voters, and it " +
      "locks at the first vote. You can't remove yourself.",
    input: {
      market: marketParam(),
      voter: p.address("Wallet to add or remove (0x...)."),
      add: z.boolean().describe("true adds the wallet to the panel, false removes it."),
    },
    write: true,
    run: async ({ market, voter, add }, ctx) => {
      const client = await ctx.client();
      const { m } = await privateMarket(client, market);
      const r = await client.privateMarkets.manageVoter(m, addr(voter, "voter"), add);
      const { status, ...rest } = r;
      return txOut(client, rest, { onPanel: status });
    },
  }),

  tool({
    name: "private_set_buyers",
    toolset: "private",
    title: "Invite or uninvite wallets",
    description:
      "Creator only, invite-only markets: invite wallets so they can predict (allow: true) or take the invite back (allow: " +
      "false). Inviting also puts the wallets on the market token's whitelist with no cap, and taking an invite back takes them " +
      "off it. You can always predict on your own market. For the presale phase whitelist use private_manage_whitelist.",
    input: {
      market: marketParam(),
      wallets: walletsParam("Wallets to invite or uninvite (0x addresses)."),
      allow: z.boolean().describe("true invites them, false takes the invite back."),
    },
    write: true,
    run: async ({ market, wallets, allow }, ctx) => {
      const client = await ctx.client();
      const { m } = await privateMarket(client, market);
      const ws = wallets.map((w, i) => addr(w, `wallets[${i}]`));
      const r = await client.privateMarkets.togglePrivateEventBuyers(m, ws, allow).catch((e: unknown) => {
        if (e instanceof ValidationError && e.rule === "not invite-only") {
          throw new ValidationError(
            "market",
            "This market isn't invite-only: anyone can predict on it, so there is no invite list. For its presale phase use private_manage_whitelist.",
          );
        }
        throw e;
      });
      return txOut(client, r);
    },
  }),

  tool({
    name: "private_manage_whitelist",
    toolset: "private",
    title: "Market token whitelist",
    description:
      "Creator only: put wallets on the market token's whitelist with a presale cap each (add: true), or take them off (add: " +
      "false). Listed wallets can predict during the presale phase, and are invited on an invite-only market. A wallet already " +
      "listed keeps its old cap: take it off first to change the cap. For a public market use whitelist_market_wallets.",
    input: {
      market: marketParam(),
      wallets: walletsParam("Wallets to add or remove (0x addresses)."),
      add: z.boolean().describe("true adds the wallets, false removes them."),
      cap: p.optAmount(
        "Presale cap per wallet, in market tokens: the most each wallet may buy of the market token directly during the " +
          "presale (predictions aren't capped by it). Needed when adding.",
      ),
      tag: z.string().optional().describe('A short note for your records, e.g. "team".'),
    },
    write: true,
    run: async ({ market, wallets, add, cap, tag }, ctx) => {
      const client = await ctx.client();
      const { m } = await privateMarket(client, market);
      const ws = wallets.map((w, i) => addr(w, `wallets[${i}]`));
      let raw = 0n;
      if (add) {
        if (cap === undefined) throw new ValidationError("cap", "Pass cap (market tokens per wallet) when adding wallets.");
        raw = to18(cap, "cap");
      }
      return txOut(client, await client.privateMarkets.manageWhitelist(m, ws, raw, tag ?? "", add));
    },
  }),

  tool({
    name: "private_disable_freeze",
    toolset: "private",
    title: "End the presale phase",
    description:
      "Creator only: end your market token's presale phase now, so predictions are no longer limited to whitelisted wallets " +
      "(an invite-only market stays invite-only). Permanent. For a public market use unfreeze_market.",
    input: { market: marketParam() },
    write: true,
    destructive: true,
    run: async ({ market }, ctx) => {
      const client = await ctx.client();
      const { m } = await privateMarket(client, market);
      return txOut(client, await client.privateMarkets.disableFreeze(m));
    },
  }),

  tool({
    name: "private_get_market",
    toolset: "private",
    title: "Creator-managed market",
    description:
      "A creator-managed market: question, outcomes with their probability now, pot value, payout split by place, end time, " +
      "phase (predicting, voting, settled), invite-only and presale flags, and the result once settled. Also its resolution " +
      "rules from the BASIS site. get_market_info shows the live figures for any market.",
    input: { market: marketParam() },
    run: async ({ market }, ctx) => {
      const client = await ctx.client();
      const { m } = await privateMarket(client, market);
      const [live, bp, firstVote, window, block] = await Promise.all([
        client.marketReader.getMarketLive(m, "private"),
        client.privateMarkets.getTrancheBP(m),
        client.privateMarkets.getFirstVoteTime(m),
        client.privateMarkets.getVotingWindow(),
        client.publicClient.getBlock(),
      ]);
      const now = block.timestamp;
      const info = await client.mains.get(live.main);
      const names: string[] = [];
      for (const o of live.outcomes) names[o.outcomeId] = o.name;

      let phase: string;
      if (live.status === "invalid") phase = "resolved INVALID";
      else if (live.resolved) phase = "resolved";
      else if (firstVote !== 0n) phase = now >= firstVote + window ? "voting over: anyone can settle it with private_finalize" : "voting (predictions closed)";
      else if (live.endTime !== 0n && now >= live.endTime) phase = "predictions closed: waiting for the panel to vote";
      else phase = live.endTime === 0n ? "taking predictions (open-ended: the first vote closes them)" : "taking predictions";

      let result: unknown = null;
      if (live.resolved) {
        const [tie, at] = await Promise.all([client.privateMarkets.getFinalTieMask(m), client.privateMarkets.getResolvedAt(m)]);
        result =
          live.status === "invalid"
            ? { result: "INVALID", resolvedAt: iso(at), note: "Holders can redeem a refund based on what they staked, with redeem_market." }
            : { result: "resolved", resolvedAt: iso(at), places: places(live.finalRanking, tie, names), note: "Holders of paid outcomes redeem with redeem_market." };
      }

      let site: unknown;
      try {
        const d = await client.api.getMarket(m);
        site = { rules: d.description, image: d.image, invitedCount: d.invitedCount };
      } catch {
        site = "Not available from the BASIS site right now.";
      }

      return userContent({
        market: m,
        name: live.marketName,
        creator: live.creator,
        main: info.symbol,
        pairAsset: info.pairSymbol,
        phase,
        paused: live.paused,
        inviteOnly: live.isPrivate,
        presalePhase: live.frozen,
        created: iso(live.creationTime),
        endTime: live.endTime === 0n ? "open-ended" : iso(live.endTime),
        firstVote: iso(firstVote),
        votingEnds: firstVote === 0n ? null : iso(firstVote + window),
        payoutSplitPercent: bp.map((b) => b / 100),
        outcomes: live.outcomes.map((o) => ({
          id: o.outcomeId,
          name: o.name,
          probabilityPercent: o.probability / 100,
          shares: units18(o.circulatingShares),
          ...(live.resolved ? { inResult: o.hasWon } : {}),
        })),
        potValue: live.potValue,
        result,
        site,
      });
    },
  }),

  tool({
    name: "private_get_user_shares",
    toolset: "private",
    title: "Shares in a creator-managed market",
    description:
      "A wallet's shares on each outcome of a creator-managed market. Before the result: what it would get back if the market " +
      "resolved INVALID. After: what it can still redeem (claim with redeem_market). get_my_shares also shows shares listed " +
      "on the order book.",
    input: { market: marketParam(), wallet: p.wallet() },
    run: async ({ market, wallet }, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, wallet);
      const { m, md } = await privateMarket(client, market);
      const [names, held] = await Promise.all([client.privateMarkets.getOptionNames(m), client.marketReader.getAllUserShares("private", m, who)]);
      const holdings = held
        .map((s, i) => ({ id: i, name: names[i] ?? `outcome ${i}`, raw: s }))
        .filter((h) => h.raw > 0n)
        .map((h) => ({ id: h.id, name: h.name, shares: units18(h.raw) }));
      const out: Record<string, unknown> = { market: m, wallet: who, status: md.status, holdings };
      if (md.resolved) {
        const q = await client.marketReader.quoteRedeemValue("private", m, who);
        out.redeemable = q.pairPayout;
        if (q.tokenPayout > 0n) out.next = "Claim it with redeem_market.";
      } else if (holdings.length) {
        out.refundIfInvalid = (await client.marketReader.quoteInvalidRefund("private", m, who)).pairPayout;
      } else {
        out.note = "No shares on this market.";
      }
      return userContent(out);
    },
  }),

  tool({
    name: "private_can_user_buy",
    toolset: "private",
    title: "Can this wallet predict?",
    description:
      "Whether a wallet can predict on a creator-managed market right now, and why not: invite list, presale whitelist, end " +
      "time, voting started, market resolved.",
    input: {
      market: marketParam(),
      wallet: p.wallet(),
      outcome: optOutcomeParam('Outcome to check: its name, or its id as "#0". Default #0.'),
      pay_with: payWithParam(),
    },
    run: async ({ market, wallet, outcome, pay_with }, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, wallet);
      const { m, md } = await privateMarket(client, market);
      const input = pay_with ? await resolveToken(client, pay_with, "pay_with") : undefined;
      let id = 0;
      let names: string[] | null = null;
      if (outcome !== undefined) {
        names = await client.privateMarkets.getOptionNames(m);
        id = resolveOutcome(names, outcome, "outcome");
      }
      const [invited, check] = await Promise.all([
        md.isPrivate ? client.privateMarkets.canUserBuy(m, who) : Promise.resolve(null),
        client.privateMarkets.checkBuy(m, id, { buyer: who, input }),
      ]);
      const out = {
        market: m,
        wallet: who,
        ...(names ? { outcome: { id, name: names[id] ?? null } } : {}),
        inviteOnly: md.isPrivate,
        invited: md.isPrivate ? invited : "not needed (anyone can predict)",
        canPredict: check.canBet,
        why: blockText(check.reason, "private"),
      };
      return names ? userContent(out) : out;
    },
  }),

  tool({
    name: "private_get_voter_panel",
    toolset: "private",
    title: "Voter panel",
    description:
      "The voter panel of a creator-managed market: every voter and their vote, how many have voted, when voting starts and " +
      "ends, whether the panel is locked, the places to rank, and whether anyone can settle it now with private_finalize.",
    input: { market: marketParam() },
    run: async ({ market }, ctx) => {
      const client = await ctx.client();
      const { m, md } = await privateMarket(client, market);
      const [panel, names, bp] = await Promise.all([
        client.privateMarkets.getVoterPanel(m),
        client.privateMarkets.getOptionNames(m),
        client.privateMarkets.getTrancheBP(m),
      ]);
      const locked = panel.firstVoteTime !== 0n;
      return userContent({
        market: m,
        creator: panel.creator,
        voters: panel.voters.map((v) => ({
          wallet: v.voter,
          isCreator: v.isCreator,
          vote: !v.voted ? null : v.invalid ? "INVALID" : places(v.ranking, v.tieMask, names),
        })),
        voted: `${panel.votedCount} of ${panel.voters.length}`,
        panelLocked: locked,
        seatsLeft: locked ? 0 : Math.max(0, MAX_PANEL - panel.voters.length),
        votingStarts: iso(md.endTime === 0n ? md.creationTime : md.endTime),
        firstVote: iso(panel.firstVoteTime),
        votingWindowMinutes: Number(panel.votingWindow) / 60,
        votingEnds: iso(panel.votingEndsAt),
        votingOver: panel.votingOver,
        resolved: panel.resolved,
        canFinalize: panel.votingOver && !panel.resolved,
        placesToRank: bp.length,
      });
    },
  }),

  tool({
    name: "private_get_min_seed",
    toolset: "private",
    title: "Seed rules",
    description:
      "Seed rules for a new creator-managed market on a main: the minimum seed for an open market and for an invite-only one " +
      "(may be 0), the step the seed must be a multiple of, and the ETH creation fee (0 when none applies; ETH is real on " +
      "paper too). Amounts in the main's pair asset. For public markets see get_market_creation_rules.",
    input: { main: p.main() },
    run: async ({ main }, ctx) => {
      const client = await ctx.client();
      const info = await resolveMain(client, main);
      const [open, inviteOnly, sizes, fee] = await Promise.all([
        client.privateMarkets.getMinSeed(info.main, { privateEvent: false }),
        client.privateMarkets.getMinSeed(info.main, { privateEvent: true }),
        client.marketReader.marketSizes("private", info.main, 2),
        client.privateMarkets.getCreationFee(info.main),
      ]);
      return {
        main: info.symbol,
        pairAsset: info.pairSymbol,
        minSeedOpenMarket: open,
        minSeedInviteOnly: inviteOnly,
        seedStep: pairAmount(sizes.seedStep, info),
        creationFee: `${formatEther(fee)} ETH`,
        rule: "The seed must be at least the minimum and a whole multiple of the step. 0 works only where the minimum is 0 (you then hold no shares).",
      };
    },
  }),

  tool({
    name: "private_get_invites",
    toolset: "private",
    title: "Invite list",
    description:
      "The invite list of an invite-only creator-managed market, from the BASIS site. It can lag a few seconds and keeps " +
      "wallets that were later uninvited: check one wallet with private_can_user_buy.",
    input: { market: marketParam(), limit: p.limit(1000, 100) },
    run: async ({ market, limit }, ctx) => {
      const client = await ctx.client();
      const { m, md } = await privateMarket(client, market);
      if (!md.isPrivate) return { market: m, inviteOnly: false, note: "Anyone can predict on this market: it has no invite list." };
      const d = await client.api.getMarket(m);
      const list = d.invited ?? [];
      const n = limit ?? 100;
      return userContent({
        market: m,
        inviteOnly: true,
        creator: md.creator,
        invitedCount: d.invitedCount,
        shown: Math.min(n, list.length),
        invited: list.slice(0, n).map((i) => ({ wallet: i.wallet, username: i.username, invitedAt: i.invitedAt ? new Date(i.invitedAt * 1000).toISOString() : null })),
        note: "The creator can always predict.",
      });
    },
  }),

  tool({
    name: "private_get_roles",
    toolset: "private",
    title: "My creator-managed markets",
    description: "Creator-managed markets where a wallet is on the voter panel or invited to predict, from the BASIS site.",
    input: { wallet: p.wallet(), limit: p.limit(1000, 100) },
    run: async ({ wallet, limit }, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, wallet);
      const r = await client.api.getWalletRoles(who);
      const rows = r.privateMarkets ?? [];
      const n = limit ?? 100;
      return {
        wallet: who,
        total: r.privateMarketsTotal ?? rows.length,
        shown: Math.min(n, rows.length),
        markets: rows.slice(0, n).map((x) => ({ market: x.marketToken ?? null, voter: !!x.voter, invited: !!x.buyer })),
      };
    },
  }),
];
