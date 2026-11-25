
import { z } from "zod";
import { erc20Abi, formatEther, formatUnits, zeroAddress, type Address } from "viem";
import {
  BasisApiError,
  OUTCOME_INVALID,
  TxNotConfirmedError,
  ValidationError,
  isZeroAddress,
  maxWithSlippage,
  pairAmount,
  validateRanking,
  type BasisClient,
  type BetQuote,
  type BetRoute,
  type BuyOrderResult,
  type BuyOrdersResult,
  type BuyResult,
  type CreateMarketWithMetadataResult,
  type HostKind,
  type ListOrderResult,
  type MainInfo,
  type MarketApproval,
  type MarketApprovalResponse,
  type MarketDetail,
  type MarketEvent,
  type MarketEventAction,
  type MarketEventsParams,
  type MarketFinal,
  type MarketMetadataResult,
  type MarketsBase,
  type MarketSummary,
  type MarketTrade,
  type MarketType,
  type MarketUploadError,
  type Order,
  type OrderStatus,
  type Redeemable,
  type RedeemableRef,
  type RedeemResult,
  type TokenOrderFill,
  type TokenSummary,
  type WalletMarket,
} from "basis-sdk";
import { p, tool, type ToolDef } from "../registry.js";
import { addr, resolveMain, resolveToken, to18, toPairRaw, toTokenRaw, uint, slippageToBps, walletOrSelf } from "../units.js";
import { txOut, userContent } from "../present.js";
import { GuidedError, errorText } from "../errors.js";
import { outcomeParam, resolveOutcome } from "../outcomes.js";
import { httpsLink, imageFromUrl, readLocalImage } from "../files.js";
import { checkSpend, checkSpendTotal } from "../limits.js";
import { blockText, rewordPredictionRefusal } from "../predict.js";


/** A raw integer (bigint or decimal string) in `decimals` as a human string; null/undefined stay null. */
function human(raw: bigint | string | number | null | undefined, decimals = 18): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  try {
    return formatUnits(typeof raw === "bigint" ? raw : BigInt(raw), decimals);
  } catch {
    return String(raw);
  }
}

/** Market tokens (18 decimals) with their unit. */
function tokensText(raw: bigint | string | null | undefined): string | null {
  const h = human(raw);
  return h === null ? null : `${h} market tokens`;
}

/** A raw pair-asset amount from the API (decimals and symbol given beside it). */
function pairText(raw: string | bigint | null | undefined, decimals: number | null | undefined, symbol: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  if (decimals === null || decimals === undefined) return `${String(raw)} (smallest units)`;
  const h = human(raw, decimals);
  return h === null ? null : `${h}${symbol ? ` ${symbol}` : ""}`;
}

/** A ratio x 1e18 as a percent ("42.10%"). */
function pctE18(v: bigint | string | null | undefined): string | null {
  if (v === null || v === undefined || v === "") return null;
  try {
    const b = typeof v === "bigint" ? v : BigInt(v);
    return `${(Number(b / 10n ** 12n) / 1e4).toFixed(2)}%`;
  } catch {
    return null;
  }
}

/** Basis points as a percent ("70%"). */
const pctBps = (bps: number): string => `${bps / 100}%`;

/** USD x 1e18 (API) as "$12.34"; null when unknown. */
function usd(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  try {
    return `$${Number(formatUnits(BigInt(v), 18)).toFixed(2)}`;
  } catch {
    return null;
  }
}

/** Unix seconds as ISO time; null for missing or 0. */
function at(sec: number | bigint | null | undefined): string | null {
  if (sec === null || sec === undefined) return null;
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

/** A market's end time: "open-ended" for 0. */
function ends(sec: number | bigint | null | undefined): string | null {
  if (sec === null || sec === undefined) return null;
  return Number(sec) === 0 ? "open-ended" : at(sec);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A market with its host (public or private) and the SDK module that serves that host. */
interface Mkt {
  market: Address;
  host: Address;
  kind: HostKind;
  main: Address;
  pairAsset: Address;
  resolved: boolean;
  generalPot: bigint;
  mod: MarketsBase;
}

/** Find a market's host the way the SDK does (public host first, then private). Unknown market: ValidationError. */
async function marketOf(client: BasisClient, value: string, field = "market"): Promise<Mkt> {
  const market = addr(value, field);
  const ctx = await client.marketReader.marketContext(market);
  return {
    market,
    host: ctx.host,
    kind: ctx.kind,
    main: ctx.main,
    pairAsset: ctx.pairAsset,
    resolved: ctx.data.resolved,
    generalPot: ctx.data.generalPot,
    mod: ctx.kind === "private" ? client.privateMarkets : client.predictionMarkets,
  };
}

/** A whole-number market close time: ISO date, unix seconds (ms accepted), or 0 / "open" for open-ended. */
function parseEndTime(v: string | number): bigint {
  if (typeof v === "number") {
    if (!Number.isInteger(v) || v < 0) throw new ValidationError("end_time", `end_time must be unix seconds, an ISO date or 0; got ${v}.`);
    return BigInt(v > 1e12 ? Math.floor(v / 1000) : v);
  }
  const s = String(v).trim();
  if (/^(0|open|open-ended|none)$/i.test(s)) return 0n;
  if (/^\d+$/.test(s)) {
    const n = BigInt(s);
    return n > 10n ** 12n ? n / 1000n : n;
  }
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) {
    throw new ValidationError("end_time", `end_time "${s}" is not a date. Use an ISO date like 2026-12-31T23:59:00Z, unix seconds, or 0 for open-ended.`);
  }
  return BigInt(Math.floor(ms / 1000));
}

/**
 * Payout split in percent ([70, 30]) to basis points ([7000, 3000]), checked by the market's rules: 1 to 10 places,
 * not more than the outcomes, each at least `outcomes` bps, never rising, summing to 100.
 */
function splitToBps(split: number[] | undefined, outcomes: number): number[] | undefined {
  if (!split) return undefined;
  const field = "payout_split_percent";
  if (split.length > outcomes) {
    throw new ValidationError(field, `payout_split_percent has ${split.length} places, but the market has only ${outcomes} outcomes.`);
  }
  const out: number[] = [];
  split.forEach((pct, i) => {
    const bps = Math.round(pct * 100);
    if (!Number.isFinite(pct) || Math.abs(bps - pct * 100) > 1e-6) {
      throw new ValidationError(field, `payout_split_percent[${i}] must be a percent with at most 2 decimals; got ${pct}.`);
    }
    if (bps < outcomes) {
      throw new ValidationError(field, `Each place must get at least ${outcomes / 100}% on a market of ${outcomes} outcomes; payout_split_percent[${i}] is ${pct}.`);
    }
    if (i > 0 && bps > out[i - 1]) {
      throw new ValidationError(field, `payout_split_percent must never rise: place ${i + 1} (${pct}%) is above place ${i} (${out[i - 1] / 100}%).`);
    }
    out.push(bps);
  });
  const sum = out.reduce((a, b) => a + b, 0);
  if (sum !== 10_000) throw new ValidationError(field, `payout_split_percent must add up to 100; it adds up to ${sum / 100}.`);
  return out;
}

const ART_ID = /^(answers|coins|crypto|money|politics|flags|sports|weather|science|tech|entertainment|time|animals|shapes|glyphs)\/[a-z0-9][a-z0-9-]{0,47}$/;

function checkArt(art: Record<string, string>, labels: readonly string[]): void {
  const names = new Set(labels.map((l) => l.trim()));
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  for (const [label, id] of Object.entries(art)) {
    const name = label.trim();
    if (!names.has(name)) throw new ValidationError("outcome_art", `outcome_art names "${label}", which isn't one of the outcomes.`);
    if (seenNames.has(name)) throw new ValidationError("outcome_art", `outcome_art names "${label}" twice.`);
    seenNames.add(name);
    if (!ART_ID.test(id)) throw new ValidationError("outcome_art", `outcome_art["${label}"] is "${id}", not a picture of BASIS's library (like "answers/yes").`);
    if (seenIds.has(id)) throw new ValidationError("outcome_art", `Picture ${id} is picked twice: each picture can be used once per market.`);
    seenIds.add(id);
  }
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

const FROZEN_TEXT = "A presale phase (frozen: true) needs presale_tokens above 0, more than your seed buys. Nothing was sent.";

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


/** What creating a public market on a main costs: the seed sent (the one given, or the floor) and the creation fee. */
interface CreateCosts {
  /** Raw pair asset. */
  seed: bigint;
  /** The seed floor and step, raw pair asset. */
  floor: bigint;
  step: bigint;
  /** Native wei (ETH); 0 when no fee is charged on this main. */
  fee: bigint;
}

async function createCosts(client: BasisClient, info: MainInfo, outcomes: number, seedRaw: bigint | undefined): Promise<CreateCosts> {
  const [sizes, fee] = await Promise.all([
    client.marketReader.marketSizes("public", info.main, outcomes),
    client.predictionMarkets.getCreationFee(info.main),
  ]);
  return { seed: seedRaw ?? sizes.minSeed, floor: sizes.minSeed, step: sizes.seedStep, fee };
}

/**
 * The cheap create checks (new markets paused, no result-settling set up yet, the seed's floor and step, the seed and
 * fee balances), run before BASIS review when the review is asked for first, so a refusal doesn't use up a review.
 * Creating checks them again.
 */
async function precheckCreate(client: BasisClient, info: MainInfo, c: CreateCosts): Promise<void> {
  const [paused, resolver] = await Promise.all([client.predictionMarkets.isPaused(), client.predictionMarkets.getResolver()]);
  if (paused) {
    throw new GuidedError("New public markets are paused right now. Nothing was sent. Try again later.");
  }
  if (isZeroAddress(resolver)) {
    throw new GuidedError("New public markets can't be created right now. Nothing was sent. Try again later.");
  }
  if (c.seed < c.floor || (c.seed !== 0n && c.step > 0n && c.seed % c.step !== 0n)) {
    const f = pairAmount(c.floor, info);
    const st = pairAmount(c.step, info);
    throw new ValidationError(
      "seed",
      `seed must be at least ${f.formatted} ${f.symbol} and a multiple of ${st.formatted} ${st.symbol}${c.floor === 0n ? " (or 0)" : ""}; got ${pairAmount(c.seed, info).formatted}. Nothing was sent.`,
    );
  }
  const me = client.account;
  if (!me) return;
  const [held, eth] = await Promise.all([
    c.seed > 0n ? client.publicClient.readContract({ address: info.pairAsset, abi: erc20Abi, functionName: "balanceOf", args: [me] }) : Promise.resolve(0n),
    c.fee > 0n ? client.publicClient.getBalance({ address: me }) : Promise.resolve(0n),
  ]);
  if (held < c.seed) {
    throw new GuidedError(
      `Not enough ${info.pairSymbol} for the seed: it is ${pairAmount(c.seed, info).formatted} ${info.pairSymbol}, and the wallet holds ${pairAmount(held, info).formatted} ${info.pairSymbol}. Nothing was sent.`,
    );
  }
  if (eth < c.fee) {
    throw new GuidedError(`Not enough ETH for the creation fee: it is ${formatEther(c.fee)} ETH, and the wallet holds ${formatEther(eth)} ETH. Nothing was sent.`);
  }
}


interface Units {
  decimals: number;
  symbol: string;
}

/** A token's decimals and symbol, or undefined when the read fails (only used to word an error). */
async function unitsOf(client: BasisClient, token: Address): Promise<Units | undefined> {
  try {
    const t = await client.mains.tokenMeta(token);
    return { decimals: t.decimals, symbol: t.symbol };
  } catch {
    return undefined;
  }
}

/** SDK option names in refusals, as this server's parameter names. */
const FIELD_NAMES: [RegExp, string][] = [
  [/\btrancheBP\b/g, "payout_split_percent"],
  [/\bpresaleTokens\b/g, "presale_tokens"],
  [/\bendTime\b/g, "end_time"],
  [/\boutcomeArt\b/g, "outcome_art"],
  [/\bpricePerShare\b/g, "price_per_share"],
  [/\bhostedImageUrl\b/g, "hosted_image_url"],
  [/\bimageUrl\b/g, "image_url"],
  [/\bimageFile\b/g, "image_file_path"],
  [/\btwitterx\b/g, "x"],
  [/\bminShares\b/g, "min_shares"],
  [/\(see minBetInput\)/g, "(quote_prediction shows the smallest amount)"],
  [/\bminBetInput\b/g, "quote_prediction"],
  [/\bSWAP\b/g, "BASIS"],
];

/**
 * The SDK's market refusals that carry raw units or SDK names ("converts to N market tokens, below the minimum bet
 * of M", "the fill costs N, you hold M (raw)"), reworded in human units. Balance refusals are left to the server's
 * shared rewording. Anything else: `e` itself.
 */
function reword(e: unknown, pair?: Units): unknown {
  if (!(e instanceof ValidationError)) return e;
  const msg = e.message.replace(/\[basis-sdk\]\s*/g, "");
  const sh = (raw: string) => formatUnits(BigInt(raw), 18);
  const pa = (raw: string) => (pair ? `${formatUnits(BigInt(raw), pair.decimals)} ${pair.symbol}` : `${raw} of the smallest unit of the pair asset`);
  const out = (text: string) => new ValidationError(e.rule, text);
  let m: RegExpExecArray | null;

  if ((m = /converts to (\d+) market tokens, below the minimum bet of (\d+)/.exec(msg))) {
    return out(
      `That prediction converts to ${sh(m[1])} market tokens, below this market's smallest prediction of ${sh(m[2])} market tokens. ` +
        "Predict more (quote_prediction shows the smallest amount). Nothing was sent.",
    );
  }
  if (/fee \(\d+ market tokens\) sells for less than one raw unit/.test(msg)) {
    return out("That prediction is too small: its fee would be worth less than the smallest unit of the pair asset. Predict more (quote_prediction shows the smallest amount). Nothing was sent.");
  }
  if (/^\d+ of \S+ converts to nothing/.test(msg)) {
    return out("That amount of the token you pay with converts to nothing here. Try a larger amount. Nothing was sent.");
  }
  if ((m = /With (\d+) slices of (\d+) market tokens/.exec(msg))) {
    return out(`Split into ${m[1]} slices, each slice (${sh(m[2])} market tokens) would sell for nothing. Use fewer slices. Nothing was sent.`);
  }
  if (/^fractionBps \d+ of \d+ rounds to 0/.test(msg)) {
    return out("That percent of what you're owed rounds to nothing. Redeem a larger percent. Nothing was sent.");
  }
  if ((m = /you hold (\d+), (\d+) are already listed, (\d+) requested/.exec(msg))) {
    return out(
      `Not enough free shares on this outcome: the wallet holds ${sh(m[1])}, ${sh(m[2])} are already listed in orders, and ${sh(m[3])} were asked for. ` +
        "See get_my_shares. Nothing was sent.",
    );
  }
  if ((m = /at most the (\d+) shares left on order (\d+)/.exec(msg))) {
    return out(`shares must be above 0 and at most the ${sh(m[1])} shares left on order ${m[2]}. Nothing was sent.`);
  }
  if ((m = /The fill costs (\d+) \(raw pair asset\), above maxCost (\d+)/.exec(msg))) {
    return out(`The fill now costs ${pa(m[1])}, above the most this call would pay (${pa(m[2])}): the price moved. Check get_order_cost and try again. Nothing was sent.`);
  }
  if ((m = /the (fill|sweep) costs (\d+), you hold (\d+) \(raw\)/.exec(msg))) {
    return out(`Not enough ${pair?.symbol ?? "pair asset"} in the wallet: the ${m[1] === "fill" ? "fill" : "purchase"} costs ${pa(m[2])}, and it holds ${pa(m[3])}. Nothing was sent.`);
  }
  if ((m = /The creation fee is (\d+) wei of the native coin; the wallet holds (\d+)/.exec(msg))) {
    return out(`Not enough ETH for the creation fee: it is ${formatEther(BigInt(m[1]))} ETH, and the wallet holds ${formatEther(BigInt(m[2]))} ETH. Nothing was sent.`);
  }
  if (e.rule === "market rejected") return out(`${msg} Nothing was sent. Change the wording (draft_market can help) and try again.`);

  let text = msg;
  for (const [re, name] of FIELD_NAMES) text = text.replace(re, name);
  return text === msg ? e : out(text);
}

/**
 * A create refusal that names the host or carries unix times, in this tool's words (times as ISO dates). Anything
 * else: `e` itself (`refusal` words the rest).
 */
function rewordCreate(e: unknown): unknown {
  if (!(e instanceof ValidationError)) return e;
  const msg = e.message.replace(/\[basis-sdk\]\s*/g, "");
  const out = (text: string) => new ValidationError(e.rule, text);
  switch (e.rule) {
    case "Approval expired": {
      const t = /expired at (\d+)/.exec(msg);
      const when = t ? at(Number(t[1])) : null;
      return out(`BASIS's approval of this market ran out${when ? ` at ${when}` : ""}, before it was sent. Nothing was sent. Call create_market again.`);
    }
    case "Invalid approval":
      return out("BASIS's approval doesn't match this market. Nothing was sent. Call create_market again.");
    case "host paused":
      return out("New public markets are paused right now. Nothing was sent. Try again later.");
    case "frozen needs presale":
      return new ValidationError("presale_tokens", FROZEN_TEXT);
    case "endTime": {
      const far = /within 1825 days \((\d+)\); got (\d+)/.exec(msg);
      if (far) return new ValidationError("end_time", `end_time must be within 1825 days (by ${at(Number(far[1]))}); got ${at(Number(far[2]))}. Nothing was sent.`);
      const soon = /at least (\d+) s ahead[^(]*\((\d+)\); got (\d+)/.exec(msg);
      if (soon) {
        const s = Number(soon[1]);
        const ahead = s >= 3600 && s % 3600 === 0 ? `${s / 3600} hour${s === 3600 ? "" : "s"}` : `${s} s`;
        return new ValidationError(
          "end_time",
          `end_time must be 0 (open-ended) or at least ${ahead} ahead (${at(Number(soon[2]))} or later); got ${at(Number(soon[3])) ?? soon[3]}. Nothing was sent.`,
        );
      }
      return new ValidationError("end_time", "end_time must be 0 (open-ended), or from about 1 hour to 1825 days ahead. Nothing was sent.");
    }
    case "convert closed":
      return out("New markets can't be seeded right now. Nothing was sent. Try again later.");
    case "pair not active":
      return out("Trading on this main is paused right now, so no market can be created on it. Nothing was sent. Try another main (get_mains) or try again later.");
    case "Trading is not enabled":
      return out("Trading on this main hasn't opened yet, so no seeded market can be created on it. Nothing was sent. Try again once it opens, or use another main (get_mains).");
    case "ecosystem inactive":
    case "asset mismatch":
      return out("Public markets can't be created on this main right now. Nothing was sent. Try another main (get_mains) or try again later.");
    case "Signer unset":
    case "resolver unset":
    case "Not an approved host":
      return out("New public markets can't be created right now. Nothing was sent. Try again later.");
    default:
      return e;
  }
}

/** Rethrow a refusal in human units, the pair asset's units read only when needed (never throws a read error). */
async function refusal(client: BasisClient, pairAsset: Address, e: unknown): Promise<never> {
  throw e instanceof ValidationError ? reword(e, await unitsOf(client, pairAsset)) : e;
}

/** Rethrow a "too small" quote as the smallest amount that works, in the token paid. Anything else is reworded. */
async function explainMinimum(client: BasisClient, m: Mkt, input: Address, bettor: Address | undefined, e: unknown): Promise<never> {
  if (e instanceof ValidationError && (e.rule === "minBet" || e.rule === "precision")) {
    let min: string | null = null;
    try {
      const r = await client.marketReader.minBetInput(m.host, m.market, input, bettor);
      const meta = await client.mains.tokenMeta(input);
      min = `${formatUnits(r.minInput, meta.decimals)} ${meta.symbol}`;
    } catch {
      min = null;
    }
    if (min) throw new ValidationError("amount", `That amount is below the smallest prediction on this market: about ${min}. Nothing was sent.`);
  }
  throw reword(rewordPredictionRefusal(e, m.kind));
}

/** How the amount paid reaches the market, in plain words. */
function routeText(route: BetRoute, paid: string): string {
  return route === "direct" ? `paid in ${paid} as it is` : `converted from ${paid} first`;
}


/** The SDK's upload notes in tool names. */
function uploadNote(t: string): string {
  return t
    .replace(/\[basis-sdk\]\s*/g, "")
    .replace(/Finish it with retryMarketMetadata\(market, \.\.\.\); do not create the market again\./g, "Finish it with retry_market_metadata; don't create the market again.")
    .replace(
      /find it with client\.api\.getWalletMarkets or the host's events, then call retryMarketMetadata\./g,
      "find it with get_my_predictions or get_market_list (creator: your wallet), then run retry_market_metadata.",
    )
    .replace(/\(no MarketCreated log in (0x[0-9a-fA-F]{64})\)/g, "(the creation record wasn't found in $1)")
    .replace(/retryMarketMetadata(\([^)]*\))?/g, "retry_market_metadata")
    .replace(/client\.api\.getWalletMarkets/g, "get_my_predictions")
    .replace(/\bhostedImageUrl\b/g, "hosted_image_url")
    .replace(/\bimageUrl\b/g, "image_url")
    .replace(/\bimageFile\b/g, "image_file_path");
}

/** A tx warning in plain words (no contract, event or function names). */
function warningText(w: string): string {
  const t = w
    .replace(/\[basis-sdk\]\s*/g, "")
    .replace(
      /^\w+ \w+ event not found in the logs of 0x[0-9a-fA-F]{64}(?::[^.]*)?\. The transaction is confirmed: do not resend it\./,
      "The transaction is confirmed, but some of its figures couldn't be read from it (they show as empty). Don't send it again.",
    )
    .replace(
      /^Could not read frozen\(\) of the new market (0x[0-9a-fA-F]{40}) after tx 0x[0-9a-fA-F]{64}:.*The transaction is confirmed: do not resend it\.$/s,
      "The market $1 was created, but whether its presale phase is on couldn't be read. Don't create it again.",
    )
    .replace(
      /^(?:[A-Za-z0-9]+\.)?buyOrdersAndContract left out orders? ([\d, ]+): the seller can't receive (\S+) right now[\s\S]*$/,
      (_m, ids: string, symbol: string) =>
        `${ids.includes(",") ? "Orders" : "Order"} ${ids.trim()} ${ids.includes(",") ? "were" : "was"} left out: the seller can't receive ${symbol} right now (see skipped).`,
    );
  return uploadNote(t);
}

/** txOut with the warnings in plain words. */
function marketTxOut(client: BasisClient, r: Parameters<typeof txOut>[1], extra?: Record<string, unknown>): Record<string, unknown> {
  const out = txOut(client, r, extra);
  if (Array.isArray(out.warnings)) out.warnings = (out.warnings as unknown[]).map((w) => (typeof w === "string" ? warningText(w) : w));
  return out;
}

/** What an upload problem means and the next step, with the hosted picture link when the picture went through. */
function uploadOut(u: MarketUploadError, imageUrl: string | null): Record<string, unknown> {
  if (u.code === "exists") {
    return { problem: "This market's details are already set (they can be set only once).", next: "Nothing more to do: the market keeps its first details." };
  }
  const problem = uploadNote(errorText(u.cause ?? u.message));
  if (u.stage === "market") {
    return {
      problem: "The market address couldn't be read from the transaction.",
      next: "Find the market with get_my_predictions or get_market_list (creator: your wallet), then run retry_market_metadata with it. Don't create it again.",
    };
  }
  if (u.stage === "image" || !imageUrl) {
    return { stage: "picture", problem, next: "Run retry_market_metadata with image_url or image_file_path (and the same details). Don't create the market again." };
  }
  return {
    stage: "details",
    problem,
    hostedImageUrl: imageUrl,
    next: `The picture is uploaded. Run retry_market_metadata with hosted_image_url "${imageUrl}" and the same details. Don't create the market again.`,
  };
}


function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const end = teen ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${end}`;
}

/** "1st: Yes (#0)", "1st (tied): A (#2)", "1st (tied): B (#5)", "3rd: C (#1)". Bit i of tieMask ties entry i with i-1. */
function placesText(ranking: readonly number[], tieMask: bigint, nameOf: (id: number) => string): string[] {
  const tied = (i: number) => i > 0 && i < ranking.length && ((tieMask >> BigInt(i)) & 1n) === 1n;
  let place = 1;
  return ranking.map((id, i) => {
    if (!tied(i)) place = i + 1;
    return `${ordinal(place)}${tied(i) || tied(i + 1) ? " (tied)" : ""}: ${nameOf(id)} (#${id})`;
  });
}

function maskOf(v: string | bigint | null | undefined): bigint {
  if (v === null || v === undefined || v === "") return 0n;
  try {
    return typeof v === "bigint" ? v : BigInt(v);
  } catch {
    return 0n;
  }
}

/** Final result of an API market row, ties shown. */
function resultOut(f: MarketFinal | null, nameOf: (id: number) => string): Record<string, unknown> | null {
  if (!f) return null;
  if (f.finalOutcome === OUTCOME_INVALID || (Array.isArray(f.ranking) && f.ranking.length === 0)) {
    return { invalid: true, resolvedAt: at(f.resolvedAt) };
  }
  const ranking = f.ranking ?? (f.finalOutcome !== null ? [f.finalOutcome] : null);
  return {
    ranking: ranking ? placesText(ranking, maskOf(f.tieMask), nameOf) : null,
    ...(f.winners ? { winners: f.winners.map(nameOf) } : {}),
    resolvedAt: at(f.resolvedAt),
  };
}

/**
 * A finishing order from the agent's input, checked by the market's rules before anything is quoted: each entry a
 * name or "#id", `tied` positions sharing a place with the entry before them, exactly the paid places (more only
 * when a tie spans the last paid place). A tie group has no order of its own, so each is sorted by id.
 */
function readRanking(names: readonly string[], entries: readonly (string | number)[], tied: readonly number[] | undefined, places: number): { ranking: number[]; tieMask: bigint } {
  const ranking = entries.map((v, i) => resolveOutcome(names, v, `ranking[${i}]`));
  let tieMask = 0n;
  if (tied?.length) {
    if (ranking.length < 2) throw new ValidationError("tied", "tied needs at least two entries in ranking.");
    for (const i of tied) {
      if (!Number.isInteger(i) || i < 1 || i >= ranking.length) {
        throw new ValidationError("tied", `tied takes positions 1 to ${ranking.length - 1} of ranking (0 is the first entry: nothing before it to tie with).`);
      }
      tieMask |= 1n << BigInt(i);
    }
  }
  for (let s = 0; s < ranking.length; ) {
    let e = s + 1;
    while (e < ranking.length && ((tieMask >> BigInt(e)) & 1n) === 1n) e++;
    const group = ranking.slice(s, e).sort((a, b) => a - b);
    ranking.splice(s, group.length, ...group);
    s = e;
  }
  const paid = `exactly the ${places} paid place${places === 1 ? "" : "s"}`;
  try {
    validateRanking(ranking, tieMask, names.length, places);
  } catch (e) {
    if (!(e instanceof ValidationError)) throw e;
    switch (e.rule) {
      case "rankingLength":
        throw new ValidationError(
          "ranking",
          `ranking must list ${paid} of this market, more only when a tie (tied) spans the last paid place; it lists ${ranking.length}. Nothing was quoted.`,
        );
      case "tieBoundary":
        throw new ValidationError("ranking", `ranking lists more than ${paid}: entries past the last paid place are allowed only when they tie with it (tied). Nothing was quoted.`);
      case "duplicate": {
        const d = /Outcome (\d+)/.exec(e.message);
        const id = d ? Number(d[1]) : -1;
        throw new ValidationError("ranking", `ranking lists ${id >= 0 ? `${names[id] ?? "an outcome"} (#${id})` : "an outcome"} twice. Nothing was quoted.`);
      }
      default:
        throw e;
    }
  }
  return { ranking, tieMask };
}


const MAX_ROW_OUTCOMES = 12;

function marketRow(m: MarketSummary): Record<string, unknown> {
  const outs = m.outcomes ?? [];
  const nameOf = (id: number) => outs.find((o) => o.id === id)?.name ?? `outcome ${id}`;
  return {
    market: m.marketToken,
    name: m.name,
    symbol: m.symbol,
    type: m.hostKind,
    private: m.private,
    status: m.status,
    ends: ends(m.endTime),
    ...(m.deadline ? { stageEnds: at(m.deadline) } : {}),
    category: m.category,
    pairAsset: m.pairSymbol,
    outcomes: outs.slice(0, MAX_ROW_OUTCOMES).map((o) => ({ id: o.id, name: o.name, odds: pctE18(o.probabilityE18) })),
    ...(outs.length > MAX_ROW_OUTCOMES ? { moreOutcomes: outs.length - MAX_ROW_OUTCOMES } : {}),
    predictors: m.bettors,
    predictions: m.bets,
    orderFills: m.fills,
    volumeUsd: usd(m.volumeUsdE18),
    volume24hUsd: usd(m.volume24hUsdE18),
    pot: tokensText(m.pot),
    ...(m.resolved ? { resolution: m.resolution, result: resultOut(m.final, nameOf) } : {}),
    lastActivity: m.lastActivityAt,
  };
}

function orderRow(o: Order, names?: readonly string[], symbol?: string): Record<string, unknown> {
  return {
    orderId: o.orderId,
    market: o.marketToken,
    type: o.hostKind,
    seller: o.seller,
    outcome: o.outcomeId,
    ...(names ? { outcomeName: names[o.outcomeId] ?? null } : {}),
    sharesLeft: human(o.remaining),
    sharesListed: human(o.totalAmount),
    sharesFilled: human(o.filled),
    pricePerShare: o.marketPriced ? "live share price" : `${human(o.pricePerShare)}${symbol ? ` ${symbol}` : ""}`,
    status: o.status,
    fillableNow: o.fillable,
    ...(o.unfillableReason ? { whyNotFillable: o.unfillableReason } : {}),
    created: o.createdAt,
  };
}

function fillRow(f: TokenOrderFill, names: readonly string[], pair: Units): Record<string, unknown> {
  const dec = f.pairDecimals ?? pair.decimals;
  return {
    time: f.blockTime,
    orderId: f.orderId,
    outcome: f.outcomeId,
    outcomeName: names[f.outcomeId] ?? null,
    buyer: f.buyer,
    seller: f.seller,
    shares: human(f.shares),
    baseCost: pairText(f.basePair, dec, pair.symbol),
    buyerPaid: pairText(f.buyerPaid, dec, pair.symbol),
    sellerGot: pairText(f.sellerNet, dec, pair.symbol),
    valueUsd: usd(f.valueUsdE18),
    tx: f.txHash,
  };
}

/** Pair-asset symbols by address, for API rows that carry only the address. */
async function symbolsOf(client: BasisClient, assets: (string | null)[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const a of new Set(assets.filter((x): x is string => !!x).map((x) => x.toLowerCase()))) {
    try {
      out.set(a, (await client.mains.tokenMeta(addr(a))).symbol);
    } catch {
    }
  }
  return out;
}

const STATUSES = [
  "active", "awaiting_proposal", "proposed", "proposed_closed", "voting", "veto_window", "disputed", "vetoed",
  "awaiting_finalize", "resolved", "invalidated",
] as const;

const SORTS = { newest: "newest", ending: "ending", volume24h: "volume24h", volume: "volume", predictors: "bettors" } as const;

const EVENT_ACTIONS = [
  "propose", "dispute", "vote", "veto", "resolve", "invalidate", "ranked_resolved", "resolver_resolved", "redeem",
  "no_winner_swept", "dispute_reset", "bonds_distributed", "bonds_lost", "bond_redirected", "early_reset", "vote_reopened",
  "order_created", "order_cancelled", "order_filled", "prediction_unplaced",
] as const;
type EventActionIn = (typeof EVENT_ACTIONS)[number];
const ACTION_TO_API: Partial<Record<EventActionIn, MarketEventAction>> = { bonds_lost: "bonds_seized", prediction_unplaced: "bet_unplaced" };
const ACTION_FROM_API: Record<string, string> = { bonds_seized: "bonds_lost", bet_unplaced: "prediction_unplaced" };

function eventRow(e: MarketEvent): Record<string, unknown> {
  return {
    time: e.timestamp,
    action: ACTION_FROM_API[e.action] ?? e.action,
    wallet: e.wallet,
    market: e.marketToken,
    ...(e.outcomeId !== null ? { outcome: e.outcomeId } : {}),
    ...(e.ranking ? { ranking: e.ranking } : {}),
    ...(e.round !== null ? { round: e.round } : {}),
    ...(e.amount !== null ? { amount: typeof e.amountDecimals === "number" ? human(e.amount, e.amountDecimals) : `${e.amount} (smallest units)`, amountToken: e.amountAsset } : {}),
    ...(e.data ? { details: e.data } : {}),
    tx: e.txHash,
  };
}

function tradeRow(t: MarketTrade, names: readonly string[]): Record<string, unknown> {
  return {
    time: t.timestamp,
    wallet: t.buyer,
    outcome: t.outcomeId,
    outcomeName: names[t.outcomeId] ?? null,
    shares: human(t.shares),
    paid: t.paid === null ? null : typeof t.inputDecimals !== "number" ? `${t.paid} (smallest units)` : human(t.paid, t.inputDecimals),
    paidWith: t.inputToken,
    value: pairText(t.valuePair, t.pairDecimals, t.pairSymbol),
    valueUsd: usd(t.valueUsdE18),
    fee: tokensText(t.fee),
    oddsAfter: pctE18(t.probabilityE18),
    tx: t.txHash,
  };
}

function positionRow(w: WalletMarket): Record<string, unknown> {
  const nz = (v: string | null | undefined) => v !== null && v !== undefined && v !== "0";
  const dec = w.pairDecimals;
  const sym = w.pairSymbol;
  return {
    market: w.marketToken,
    name: w.name,
    symbol: w.symbol,
    type: w.hostKind,
    status: w.status,
    resolved: w.resolved,
    outcomes: w.outcomes
      .filter((o) => nz(o.shares) || nz(o.cost))
      .map((o) => ({
        id: o.id,
        shares: human(o.shares),
        listedInOrders: human(o.sharesInOrders),
        paid: pairText(o.cost, dec, sym),
        costBasis: pairText(o.costBasis, dec, sym),
        paidUsd: usd(o.costUsdE18),
      })),
    ...(w.seed ? { seed: pairText(w.seed.amount, dec, sym) } : {}),
    soldOnBook: pairText(w.soldPair, dec, sym),
    redeemed: pairText(w.redeemed, dec, sym),
    lastActivity: w.lastActivityAt,
  };
}

function redeemRow(r: Redeemable): Record<string, unknown> {
  const d = r.pairPayout.decimals;
  const s = r.pairPayout.symbol;
  const q = r.quote;
  return {
    market: r.market,
    type: r.kind,
    status: r.status,
    owed: tokensText(r.tokenPayout),
    sellsForInOneGo: r.pairPayout,
    ...(q
      ? {
          plan: {
            recommendedSlices: q.recommendedSlices,
            slicedSellsFor: pairText(q.slicedOut, d, s),
            priceImpactOneGo: pctBps(q.impactSingleBps),
            priceImpactSliced: pctBps(q.impactSlicedBps),
            fitsInOneTransaction: q.fitsInOneTx,
            ...(q.fitsInOneTx ? {} : { suggestedPercentNow: q.suggestedFractionBps / 100 }),
          },
        }
      : {}),
  };
}


/** Total time one tool call follows a background draft before handing back a job id. */
const DRAFT_BUDGET_MS = 45_000;
/** One status check can be held open by the API for about 15 s: never start one with less time left. */
const DRAFT_HOLD_MS = 16_000;

/** Public or private, per draft job this server started (so get_market_draft points to the right create tool). */
const jobTypes = new Map<string, MarketType>();

function rememberJob(id: string, type: MarketType): void {
  jobTypes.set(id, type);
  while (jobTypes.size > 50) {
    const oldest = jobTypes.keys().next().value;
    if (oldest === undefined) break;
    jobTypes.delete(oldest);
  }
}

interface JobLike {
  id: string;
  status: string;
  elapsedMs?: number;
  result?: unknown;
  error?: string;
}

function jobOf(v: unknown): JobLike | null {
  const j = v && typeof v === "object" ? (v as { job?: unknown }).job : undefined;
  if (!j || typeof j !== "object") return null;
  const job = j as JobLike;
  return typeof job.id === "string" && typeof job.status === "string" ? job : null;
}

function createToolFor(type: MarketType | undefined): string {
  if (type === "private") return "private_create_market";
  if (type === "public") return "create_market";
  return "create_market (public market) or private_create_market (private market)";
}

/** A finished drafting answer (a draft or a refusal) as the create tools' field names. */
function draftOut(res: unknown, marketType?: MarketType): Record<string, unknown> {
  const r = (res && typeof res === "object" ? res : {}) as Record<string, unknown>;
  if (r.ok === false || r.refused === true) {
    return {
      status: "refused",
      category: r.category ?? null,
      reason: r.reason ?? null,
      ...(typeof r.cooldownMs === "number" && r.cooldownMs > 0 ? { tryAgainInSeconds: Math.ceil(r.cooldownMs / 1000) } : {}),
      next: "BASIS's writer won't draft this. Change the topic or wording and try again.",
    };
  }
  const type = r.marketType === "public" || r.marketType === "private" ? r.marketType : marketType;
  const out: Record<string, unknown> = { status: "done", ...(type ? { marketType: type } : {}) };
  for (const k of ["draft", "headline"]) {
    const v = r[k];
    if (v && typeof v === "object") Object.assign(out, v);
  }
  if (Array.isArray(r.outcomes)) out.outcomes = r.outcomes;
  if (typeof r.description === "string") out.description = r.description;
  if (typeof r.cooldownMs === "number" && r.cooldownMs > 0) out.nextDraftInSeconds = Math.ceil(r.cooldownMs / 1000);
  out.next =
    `Check and edit the text, then call ${createToolFor(type)} with name, symbol, outcomes and description (plus ` +
    "end_time and an image). BASIS may still review and reword the market when it is created.";
  return out;
}

function jobOut(job: JobLike, marketType?: MarketType): Record<string, unknown> {
  if (job.status === "done") return draftOut(job.result, marketType);
  if (job.status === "running") {
    return {
      status: "running",
      job_id: job.id,
      ...(typeof job.elapsedMs === "number" ? { elapsedSeconds: Math.round(job.elapsedMs / 1000) } : {}),
      next: "Still writing. Call get_market_draft with this job_id in a few seconds (or stop it with cancel_market_draft).",
    };
  }
  if (job.status === "cancelled") throw new GuidedError("That draft was cancelled. Start a new one with draft_market.");
  throw new GuidedError(
    `The AI writer could not finish this draft (${job.error ?? "no reason given"}). Try again, or draft in two shorter ` +
      'steps: part "headline", then part "answers".',
  );
}

/** The drafting routes' errors in plain words (their own hints name SDK calls). job_running is left to the caller. */
async function draftApi<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (e) {
    if (!(e instanceof BasisApiError)) throw e;
    const wait = e.retryAfter ? Math.ceil(e.retryAfter) : undefined;
    switch (e.code) {
      case "drafting_slow":
      case "drafting_unavailable":
        throw new GuidedError('The AI writer is slow or down right now. Try again in a minute, or draft in two shorter steps: part "headline", then part "answers".');
      case "job_not_found":
        throw new GuidedError("That draft is gone (it ended more than 10 minutes ago, or the writer restarted). Start a new one with draft_market.");
      case "cooldown":
        throw new GuidedError(`One draft per wallet every 30 s. Try again in about ${wait ?? 30} s.`);
      case "gate_busy":
        throw new GuidedError(`The AI writer is busy. Try again in about ${wait ?? 5} s.`);
      case "gate_disabled":
        throw new GuidedError("AI drafting is switched off on BASIS right now. Write the market yourself and call create_market (or private_create_market).");
      default:
        throw e;
    }
  }
}

/** Follow a running draft job for up to DRAFT_BUDGET_MS, then report it (done, refused, or still running with its id). */
async function followJob(client: BasisClient, job: JobLike, firstWaitMs: number, marketType?: MarketType): Promise<Record<string, unknown>> {
  const end = Date.now() + DRAFT_BUDGET_MS;
  let current = job;
  if (current.status === "running" && firstWaitMs > 0) await sleep(Math.min(firstWaitMs, 5_000));
  while (current.status === "running" && end - Date.now() >= DRAFT_HOLD_MS) {
    const asked = Date.now();
    const next = jobOf(await draftApi(() => client.api.getDraftJob(current.id)));
    if (!next) break;
    current = next;
    if (current.status === "running" && Date.now() - asked < 1_000) await sleep(1_500);
  }
  return jobOut(current, marketType);
}

type DraftPart = "all" | "headline" | "answers" | "rules";

const draftShape = () =>
  z
    .enum(["binary", "single", "ranked"])
    .optional()
    .describe("binary: two answers; single: one winner among many; ranked: a podium (several places paid).");

const marketTypeParam = () =>
  z.enum(["public", "private"]).optional().describe("public (default) or private market.");


const marketParam = () => z.string().describe("Market address (0x...), the market token. Find one with get_market_list or search_markets.");
const optOutcomeParam = (desc: string) => outcomeParam(desc).optional();
const orderIdParam = () => p.id("Order id on that market (from get_order_book, get_orders or list_order).");

/** Markets checked per get_redeemables call, and how many are read at once. */
const REDEEM_PAGE = 25;
const REDEEM_BATCH = 10;
/** Pages of 100 wallet markets looked at to find the resolved ones. */
const REDEEM_SCAN_PAGES = 10;


export const marketsTools: ToolDef[] = [
  tool({
    name: "draft_market",
    toolset: "markets",
    title: "Draft a market (AI)",
    description:
      "Let BASIS's AI writer draft a prediction market: a whole market from a topic (part all), or one piece: headline " +
      "(question, ticker, rules), answers (the outcomes for a question) or rules (resolution rules for a question). " +
      "Nothing is created: check the text, then pass it to create_market (or private_create_market for a private market). " +
      "Each call uses the wallet's AI drafting allowance (one draft every 30 s). A draft can take a minute or more: if it " +
      "is still being written, read it later with get_market_draft, or stop it with cancel_market_draft.",
    input: {
      part: z.enum(["all", "headline", "answers", "rules"]).optional().describe("What to draft. Default all."),
      topic: z.string().optional().describe("For all and headline: what the market is about, 1 to 400 characters."),
      question: z.string().optional().describe("For answers and rules: the market question, 1 to 200 characters."),
      description: z.string().optional().describe("For answers: the rules so far (optional, up to 2000 characters)."),
      outcomes: z.array(z.string()).max(150).optional().describe("For rules: the answers so far (optional, up to 150)."),
      count: z.number().int().min(1).max(150).optional().describe("For all and answers: how many answers to write (1 to 150)."),
      shape: draftShape(),
      market_type: marketTypeParam(),
    },
    write: true,
    sendsTx: false,
    run: async (args, ctx) => {
      const client = await ctx.client();
      const part: DraftPart = args.part ?? "all";
      const marketType: MarketType = args.market_type ?? "public";
      const need = (v: string | undefined, field: string): string => {
        if (!v || !v.trim()) throw new ValidationError(field, `Pass ${field} for part "${part}".`);
        return v.trim();
      };
      let start: unknown;
      try {
        start = await draftApi((): Promise<unknown> => {
          switch (part) {
            case "headline":
              return client.api.draftMarketHeadline({ topic: need(args.topic, "topic"), marketType, shape: args.shape, async: true });
            case "answers":
              return client.api.draftMarketAnswers({
                name: need(args.question, "question"), description: args.description, marketType, count: args.count, shape: args.shape, async: true,
              });
            case "rules":
              return client.api.draftMarketDescription({ name: need(args.question, "question"), outcomes: args.outcomes, marketType, shape: args.shape, async: true });
            default:
              return client.api.draftMarket({ topic: need(args.topic, "topic"), marketType, outcomeCount: args.count, shape: args.shape, async: true });
          }
        });
      } catch (e) {
        if (e instanceof BasisApiError && e.code === "job_running") {
          const id = (e.body as { jobId?: unknown } | null)?.jobId;
          if (typeof id === "string") {
            return {
              status: "running",
              job_id: id,
              next: "This wallet already has a draft being written. Read it with get_market_draft (or stop it with cancel_market_draft), then start a new one.",
            };
          }
        }
        throw e;
      }
      const job = jobOf(start);
      if (!job) return draftOut(start, marketType);
      rememberJob(job.id, marketType);
      const pollAfter = Number((start as { pollAfterMs?: unknown }).pollAfterMs);
      return followJob(client, job, Number.isFinite(pollAfter) && pollAfter > 0 ? pollAfter : 0, marketType);
    },
  }),

  tool({
    name: "get_market_draft",
    toolset: "markets",
    title: "Read a market draft",
    description:
      "Read a market draft that was still being written (job_id from draft_market): the text when done, else that it is " +
      "still running. Drafts are kept for 10 minutes after they finish. Stop one with cancel_market_draft.",
    input: { job_id: z.string().describe("job_id from draft_market.") },
    run: async ({ job_id }, ctx) => {
      const client = await ctx.client();
      const id = job_id.trim();
      const job = jobOf(await draftApi(() => client.api.getDraftJob(id)));
      if (!job) throw new GuidedError("BASIS answered without the draft. Try again in a few seconds.");
      return followJob(client, job, 0, jobTypes.get(id));
    },
  }),

  tool({
    name: "cancel_market_draft",
    toolset: "markets",
    title: "Cancel a market draft",
    description:
      "Stop a market draft that is still being written (job_id from draft_market). It still counts as one draft and " +
      "starts the 30 s wait before the next. A draft that already finished is shown instead.",
    input: { job_id: z.string().describe("job_id from draft_market.") },
    write: true,
    sendsTx: false,
    destructive: true,
    run: async ({ job_id }, ctx) => {
      const client = await ctx.client();
      const id = job_id.trim();
      const job = jobOf(await draftApi(() => client.api.cancelDraftJob(id)));
      if (!job) throw new GuidedError("BASIS answered without the draft. Try again in a few seconds.");
      if (job.status === "cancelled") {
        jobTypes.delete(id);
        return { status: "cancelled", job_id: id, next: "Start a new draft with draft_market after the 30 s wait." };
      }
      return jobOut(job, jobTypes.get(id));
    },
  }),

  tool({
    name: "get_market_creation_rules",
    toolset: "markets",
    title: "Market creation rules",
    description:
      "What creating a public market on a main needs right now: the minimum seed and seed step (pair asset), the creation " +
      "fee (ETH), whether BASIS reviews new markets, and the text limits. Check it before create_market.",
    input: { main: p.main() },
    run: async ({ main }, ctx) => {
      const client = await ctx.client();
      const info = await resolveMain(client, main);
      const pm = client.predictionMarkets;
      const [minSeed, sizes, fee, review, paused] = await Promise.all([
        pm.getMinSeed(info.main),
        client.marketReader.marketSizes("public", info.main, 2),
        pm.getCreationFee(info.main),
        pm.isGatingEnabled(),
        pm.isPaused(),
      ]);
      return {
        main: info.symbol,
        pairAsset: info.pairSymbol,
        minSeed,
        seedStep: pairAmount(sizes.seedStep, info),
        creationFee: `${formatEther(fee)} ETH`,
        basisReview: review
          ? "on: BASIS reviews each new market before it is created and may reword its text (create_market asks for the review itself)"
          : "off: new markets are created as written",
        newMarketsPaused: paused,
        limits: {
          name: "1 to 200 characters",
          symbol: "1 to 16 letters or digits",
          outcomes: "2 to 150, each up to 120 characters",
          description: "up to 2000 characters",
          endTime: "0 (open-ended), or from about 1 hour to 1825 days ahead",
          payoutSplitPercent: "1 to 10 places in percent, never rising, summing to 100, each at least (outcomes / 100)% (default [100]: one winner)",
          seed: "at least minSeed and a multiple of seedStep",
        },
      };
    },
  }),

  tool({
    name: "get_opening_pool",
    toolset: "markets",
    title: "Opening pool",
    description:
      "The opening pool a new market of N outcomes starts with on a main: the starting weight per outcome and in total " +
      "(market tokens; a bigger pool moves less on the first predictions), the smallest prediction, and the seed floor.",
    input: {
      outcomes: z.number().int().min(2).max(150).describe("Number of outcomes, 2 to 150."),
      main: p.main(),
      market_type: marketTypeParam(),
    },
    run: async ({ outcomes, main, market_type }, ctx) => {
      const client = await ctx.client();
      const info = await resolveMain(client, main);
      const s = await client.marketReader.marketSizes(market_type ?? "public", info.main, outcomes);
      return {
        main: info.symbol,
        pairAsset: info.pairSymbol,
        type: s.kind,
        outcomes,
        perOutcome: tokensText(s.perOutcome),
        totalPool: tokensText(s.totalPool),
        minPrediction: tokensText(s.minBet),
        minSeed: pairAmount(s.minSeed, info),
        seedStep: pairAmount(s.seedStep, info),
        ...(s.minSeedPrivateEvent !== undefined ? { minSeedInviteOnly: pairAmount(s.minSeedPrivateEvent, info) } : {}),
      };
    },
  }),

  tool({
    name: "create_market",
    toolset: "markets",
    title: "Create a public market",
    description:
      "Create a public prediction market. When BASIS review is on (get_market_creation_rules), BASIS reviews the market " +
      "first and may reword it (a refusal says why and nothing is sent); then the market opens with your seed and its " +
      "picture and details are uploaded. You pay the seed in the main's pair asset plus the creation fee in ETH. Draft " +
      "the wording with draft_market if you like; private markets are made with private_create_market. After it closes, " +
      "follow it with get_market_resolution_status: the result is proposed with propose_outcome, challenged with " +
      "dispute_outcome or veto_outcome, and settled with finalize_market.",
    input: {
      name: z.string().describe('The question, e.g. "Will BTC close above $100k on 31 Dec 2026?" (up to 200 characters).'),
      symbol: z.string().describe("Ticker of the market token, 1 to 16 letters or digits."),
      outcomes: z.array(z.string()).min(2).max(150).describe('The possible answers, 2 to 150, each up to 120 characters, e.g. ["Yes", "No"].'),
      end_time: z
        .union([z.string(), z.number()])
        .describe("When predictions close: an ISO date (2026-12-31T23:59:00Z), unix seconds, or 0 for open-ended. At least about 1 hour ahead, at most 1825 days."),
      description: z
        .string()
        .optional()
        .describe("Resolution rules: what decides each answer and which source counts (up to 2000 characters). BASIS may review it."),
      image_url: z.string().optional().describe("Market picture: an https link (resized to 512x512 when the server can). Give this or image_file_path."),
      image_file_path: p.imageFile(),
      seed: p.optAmount(
        "Your opening stake, in the main's pair asset (e.g. USDG). It gives you the same number of shares on every outcome. Default: the minimum (get_market_creation_rules); must be a multiple of the seed step.",
      ),
      main: p.main(),
      payout_split_percent: z
        .array(z.number())
        .min(1)
        .max(10)
        .optional()
        .describe("How the pot is split by finishing place, in percent: e.g. [70, 30] for 1st and 2nd. Never rising, summing to 100. Default [100]: one winning outcome."),
      outcome_art: z
        .record(z.string(), z.string())
        .optional()
        .describe(
          'Optional outcome pictures from BASIS\'s library: { "<outcome>": "<category>/<name>" }, e.g. { "Yes": "answers/yes", "No": "answers/no" }. ' +
            "Categories: answers, coins, crypto, money, politics, flags, sports, weather, science, tech, entertainment, time, animals, shapes, glyphs. " +
            "Each picture once; an unknown picture name just shows no picture. If review rewords the outcomes, each picture stays with its outcome. Set once with the market.",
        ),
      frozen: p.bool(
        "Start with a presale phase: only wallets you whitelist (whitelist_market_wallets) can predict until the presale sells out or you open it with unfreeze_market. Needs presale_tokens, more than your seed buys. Default false.",
      ),
      presale_tokens: z.number().int().min(0).optional().describe("Presale size of the market token in whole tokens (needed with frozen). Default 0."),
      website: z.string().optional().describe("Website link (optional)."),
      telegram: z.string().optional().describe("Telegram link or handle (optional)."),
      x: z.string().optional().describe("X handle or profile link (optional)."),
    },
    write: true,
    run: async (args, ctx) => {
      const client = await ctx.client();
      if (!args.image_url && !args.image_file_path) {
        throw new ValidationError("image_url", "A market needs a picture: give image_url (an https link) or image_file_path (a local png, jpeg, gif or webp).");
      }
      if (args.image_url && args.image_file_path) throw new ValidationError("image_url", "Give image_url or image_file_path, not both.");
      if (args.frozen && !args.presale_tokens) throw new ValidationError("presale_tokens", FROZEN_TEXT);
      checkLinks({ website: args.website, telegram: args.telegram, x: args.x });
      const imageUrl = args.image_url ? httpsLink(args.image_url, "image_url") : undefined;
      const pm = client.predictionMarkets;
      const info = await resolveMain(client, args.main);
      const imageFile = args.image_file_path
        ? (await readLocalImage(args.image_file_path, "image_file_path")).bytes
        : imageUrl
          ? (await imageFromUrl(client, imageUrl, "image_url")).bytes
          : undefined;
      const endTime = parseEndTime(args.end_time);
      const trancheBP = splitToBps(args.payout_split_percent, args.outcomes.length);
      const seedRaw = args.seed === undefined ? undefined : toPairRaw(info, args.seed, "seed");
      const art = args.outcome_art && Object.keys(args.outcome_art).length ? args.outcome_art : undefined;
      if (art) checkArt(art, args.outcomes);

      const reviewFirst = art !== undefined && (await pm.isGatingEnabled());

      const capped = ctx.config.maxSpendUsd !== undefined;
      if (reviewFirst || capped) {
        const costs = await createCosts(client, info, args.outcomes.length, seedRaw);
        if (reviewFirst) await precheckCreate(client, info, costs);
        if (capped) {
          await checkSpendTotal(client, [
            { token: info.pairAsset, raw: costs.seed },
            { token: zeroAddress, raw: costs.fee },
          ]);
        }
      }

      let name = args.name;
      let symbol = args.symbol;
      let outcomes = args.outcomes;
      let outcomeArt = art;
      let approval: MarketApproval | undefined;
      if (art && reviewFirst) {
        let res: MarketApprovalResponse;
        try {
          res = await client.api.approveMarket({
            marketType: "public",
            name: name.trim(),
            symbol: symbol.trim(),
            description: args.description,
            outcomes: outcomes.map((o) => o.trim()),
            endTime,
            main: info.main,
            ...(seedRaw !== undefined ? { seedAmount: seedRaw } : {}),
          });
        } catch (e) {
          if (e instanceof BasisApiError && (e.code === "screening_slow" || e.code === "gate_busy")) {
            const s = e.retryAfter ? Math.ceil(e.retryAfter) : 30;
            throw new GuidedError(`BASIS is still reviewing this market. Nothing was sent. Call create_market again with the same inputs in about ${s} s.`);
          }
          throw e;
        }
        if (!res.approved) {
          throw new GuidedError(
            `BASIS did not approve this market${res.category ? ` (${res.category})` : ""}: ${res.reason ?? "no reason given"}. Nothing was sent. Change the wording (draft_market can help) and try again.`,
          );
        }
        approval = { signature: res.signature, deadline: res.deadline, signed: res.signed };
        name = res.signed.name;
        symbol = res.signed.symbol;
        const given = args.outcomes.map((o) => o.trim());
        const reviewed = [...res.signed.outcomes];
        if (reviewed.length !== given.length) {
          throw new GuidedError(`BASIS review changed the number of outcomes (${given.length} to ${reviewed.length}). Nothing was sent.`);
        }
        outcomeArt = moveArt(art, given, reviewed);
        outcomes = reviewed;
      }

      let r: CreateMarketWithMetadataResult;
      try {
        r = await pm.createMarketWithMetadata({
          name,
          symbol,
          outcomes,
          endTime,
          trancheBP,
          main: info.main,
          frozen: args.frozen,
          presaleTokens: args.presale_tokens,
          seed: seedRaw,
          description: args.description,
          approval,
          imageFile,
          website: args.website,
          telegram: args.telegram,
          twitterx: args.x,
          outcomeArt,
        });
      } catch (e) {
        if (e instanceof TxNotConfirmedError && e.functionName === "approve") throw e;
        if (e instanceof TxNotConfirmedError) {
          throw new GuidedError(
            `The market was sent but isn't confirmed yet: ${e.txHash}. Don't create it again. When get_transaction shows it ` +
              "confirmed, find the market with get_market_list (creator: your wallet) and add its picture and details with retry_market_metadata.",
            e.txHash,
          );
        }
        if (e instanceof BasisApiError && (e.code === "screening_slow" || e.code === "gate_busy")) {
          const s = e.retryAfter ? Math.ceil(e.retryAfter) : 30;
          throw new GuidedError(`BASIS is still reviewing this market. Nothing was sent. Call create_market again with the same inputs in about ${s} s.`);
        }
        const created = rewordCreate(e);
        if (created !== e) throw created;
        return refusal(client, info.pairAsset, e);
      }
      const { approval: used, uploadError, sharesPerOutcome, sent, ...rest } = r;
      const extra: Record<string, unknown> = {
        type: "public",
        basisReview: used ? "approved" : "not required",
        sharesPerOutcome: human(sharesPerOutcome),
      };
      if (sent) {
        const changed: Record<string, unknown> = {};
        if (sent.name !== args.name.trim()) changed.name = sent.name;
        if (sent.symbol !== args.symbol.trim()) changed.symbol = sent.symbol;
        const outs = sent.outcomes.flatMap((o, i) => (o !== (args.outcomes[i] ?? "").trim() ? [{ id: i, was: args.outcomes[i], now: o }] : []));
        if (outs.length) changed.outcomes = outs;
        if (Object.keys(changed).length) {
          extra.rewordedByReview = changed;
          if (art && outs.length) {
            extra.outcomePictures = approval
              ? "Each picture was kept with its outcome under the reviewed name."
              : "Pictures were set for the names you gave; any outcome whose name changed shows no picture.";
          }
        }
      }
      if (uploadError) {
        extra.uploadProblem = uploadOut(uploadError, r.imageUrl);
        extra.next = "The market exists. Finish its picture and details with retry_market_metadata (see uploadProblem); don't create it again.";
      } else {
        extra.next =
          "Share the market address. Predict with predict. After it closes, follow the result with get_market_resolution_status " +
          "(propose_outcome, dispute_outcome, veto_outcome, finalize_market).";
      }
      return userContent(marketTxOut(client, rest, extra));
    },
  }),

  tool({
    name: "retry_market_metadata",
    toolset: "markets",
    title: "Finish a market's picture and details",
    description:
      "Upload a market's picture and details when create_market (or private_create_market) reported an upload problem " +
      "(the market itself exists: never create it again). Creator only, public or private market. Give exactly one " +
      "image source. Details can be set only once per market.",
    input: {
      market: marketParam(),
      image_url: z.string().optional().describe("An https link to the picture."),
      image_file_path: p.imageFile(),
      hosted_image_url: z.string().optional().describe("Or the picture link an earlier upload already made (hostedImageUrl in that result), when only the details failed."),
      description: z.string().optional().describe("Resolution rules text."),
      outcome_art: z.record(z.string(), z.string()).optional().describe('Outcome pictures, as in create_market: { "Yes": "answers/yes" }, keyed by the market\'s outcome names.'),
      website: z.string().optional().describe("Website link."),
      telegram: z.string().optional().describe("Telegram link or handle."),
      x: z.string().optional().describe("X handle or profile link."),
    },
    write: true,
    sendsTx: false,
    run: async (args, ctx) => {
      const client = await ctx.client();
      const sources = [args.image_url, args.image_file_path, args.hosted_image_url].filter((v) => v !== undefined && v !== "");
      if (sources.length !== 1) throw new ValidationError("image_url", "Give exactly one of image_url, image_file_path or hosted_image_url.");
      const m = await marketOf(client, args.market);
      const imageFile = args.image_file_path
        ? (await readLocalImage(args.image_file_path, "image_file_path")).bytes
        : args.image_url
          ? (await imageFromUrl(client, args.image_url, "image_url")).bytes
          : undefined;
      let r: MarketMetadataResult;
      try {
        r = await m.mod.retryMarketMetadata(m.market, {
          imageFile,
          hostedImageUrl: args.hosted_image_url,
          description: args.description,
          outcomeArt: args.outcome_art,
          website: args.website,
          telegram: args.telegram,
          twitterx: args.x,
        });
      } catch (e) {
        throw reword(e);
      }
      if (r.uploadError) {
        return {
          market: m.market,
          status: r.uploadError.code === "exists" ? "already set" : "not finished",
          ...uploadOut(r.uploadError, r.imageUrl),
        };
      }
      return { market: m.market, status: "done", imageUrl: r.imageUrl, metadata: r.metadata };
    },
  }),

  tool({
    name: "quote_prediction",
    toolset: "markets",
    title: "Quote a prediction",
    description:
      "Preview a prediction without sending it: the shares an amount buys on one outcome, the minimum kept after " +
      "slippage, the fee rate, and whether the wallet can predict on this market now. A quote, not a payout: see " +
      "get_potential_payout. Public or private market. Send it with predict.",
    input: {
      market: marketParam(),
      outcome: outcomeParam(),
      amount: p.amount("How much to pay, in the market's pair asset (e.g. USDG), or in pay_with's own units when set."),
      pay_with: z.string().optional().describe("The token you pay with, instead of the pair asset: the market's main, any BASIS token (0x address), or a main/pair symbol."),
      slippage_percent: p.slippage(),
      wallet: p.wallet("Who would predict (fees and invite lists depend on it). Default: this server's wallet."),
    },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const m = await marketOf(client, args.market);
      const names = await m.mod.getOptionNames(m.market);
      const outcome = resolveOutcome(names, args.outcome);
      const input = args.pay_with ? await resolveToken(client, args.pay_with, "pay_with") : m.pairAsset;
      const raw = await toTokenRaw(client, input, args.amount);
      const bettor = args.wallet ? addr(args.wallet, "wallet") : client.account;
      const meta = await client.mains.tokenMeta(input);
      const base = { market: m.market, type: m.kind, outcome: { id: outcome, name: names[outcome] }, pay: `${formatUnits(raw, meta.decimals)} ${meta.symbol}` };
      if (bettor) {
        const check = await m.mod.checkBuy(m.market, outcome, { buyer: bettor, input });
        if (!check.canBet) {
          return userContent({ ...base, canPredictNow: false, reason: blockText(check.reason, m.kind) ?? "Predictions can't be made on this market right now." });
        }
      }
      let q: BetQuote;
      try {
        q = await client.marketReader.quoteBet({ market: m.market, outcome, input, amount: raw, host: m.host, bettor, slippageBps: slippageToBps(args.slippage_percent) });
      } catch (e) {
        return explainMinimum(client, m, input, bettor, e);
      }
      return userContent({
        ...base,
        canPredictNow: bettor ? true : "unknown (no wallet given)",
        shares: human(q.shares),
        minShares: human(q.minShares),
        marketTokensIn: tokensText(q.tokens),
        marketTokensToPot: tokensText(q.netToken),
        feePercent: q.feeBps / 100,
        route: routeText(q.route, meta.symbol),
        note: "A quote at the current state: the shares can change before you send. predict sets its minimum from a fresh quote.",
      });
    },
  }),

  tool({
    name: "predict",
    toolset: "markets",
    title: "Predict",
    description:
      "Predict on an outcome: buy its shares with the market's pair asset (e.g. USDG) or another token. Preview it with " +
      "quote_prediction. The minimum shares come from a fresh quote minus slippage. Public or private market. Before the " +
      "end, shares can be sold only on the order book (list_order); after the result, redeem_market pays out what the " +
      "result gives your shares, if anything.",
    input: {
      market: marketParam(),
      outcome: outcomeParam(),
      amount: p.amount("How much to pay, in the market's pair asset (e.g. USDG), or in pay_with's own units when set."),
      pay_with: z
        .string()
        .optional()
        .describe("The token you pay with, instead of the pair asset: the market's main, any BASIS token (0x address), or a main/pair symbol. It is converted on the way in."),
      slippage_percent: p.slippage(),
    },
    write: true,
    run: async (args, ctx) => {
      const client = await ctx.client();
      const m = await marketOf(client, args.market);
      const names = await m.mod.getOptionNames(m.market);
      const outcome = resolveOutcome(names, args.outcome);
      const input = args.pay_with ? await resolveToken(client, args.pay_with, "pay_with") : m.pairAsset;
      const raw = await toTokenRaw(client, input, args.amount);
      await checkSpend(client, input, raw);
      let r: BuyResult;
      try {
        r = await m.mod.buy(m.market, outcome, raw, { input: args.pay_with ? input : undefined, slippageBps: slippageToBps(args.slippage_percent) });
      } catch (e) {
        return explainMinimum(client, m, input, client.account, e);
      }
      const { input: _paidIn, deadline: _sendBy, ...sent } = r;
      return userContent(
        marketTxOut(client, sent, {
          market: m.market,
          type: m.kind,
          outcome: { id: outcome, name: names[outcome] },
          paidWith: r.amount.symbol,
          shares: human(r.shares),
          minShares: human(r.minShares),
          next: "See the position with get_my_shares. Sell before the end with list_order; after the result, use redeem_market.",
        }),
      );
    },
  }),

  tool({
    name: "redeem_market",
    toolset: "markets",
    title: "Redeem a resolved market",
    description:
      "Redeem a resolved market, public or private: sells what the result gives your shares (or your refund if it " +
      "resolved INVALID) into the pair asset. A big amount may be paid in parts: if some is still owed, call it again. " +
      "Check first with get_redeemables.",
    input: {
      market: marketParam(),
      percent: z
        .number()
        .optional()
        .describe("Share of what you're owed to redeem now, above 0 up to 100. Default: all of it, or the part that fits in one transaction."),
      slices: z.number().int().min(1).max(25).optional().describe("Sell in this many equal steps in one transaction (1 to 25) to soften price impact. Default: the recommended count."),
      slippage_percent: p.slippage(),
    },
    write: true,
    run: async (args, ctx) => {
      const client = await ctx.client();
      const m = await marketOf(client, args.market);
      let fractionBps: number | undefined;
      if (args.percent !== undefined) {
        if (!Number.isFinite(args.percent) || args.percent <= 0 || args.percent > 100) {
          throw new ValidationError("percent", "percent must be above 0 and at most 100.");
        }
        fractionBps = Math.max(1, Math.round(args.percent * 100));
      }
      let r: RedeemResult;
      try {
        r = await m.mod.redeem(m.market, { fractionBps, slices: args.slices, slippageBps: slippageToBps(args.slippage_percent) });
      } catch (e) {
        return refusal(client, m.pairAsset, e);
      }
      const extra: Record<string, unknown> = { market: m.market, type: m.kind, percentRedeemed: r.fractionBps / 100 };
      if (r.remaining && r.remaining.raw > 0n) extra.next = "Part is still owed: call redeem_market again for the rest.";
      return marketTxOut(client, r, extra);
    },
  }),

  tool({
    name: "get_redeemables",
    toolset: "markets",
    title: "Redeemable markets",
    description:
      "What a wallet can redeem now, per resolved market (public or private): the market tokens owed, what they sell for " +
      "in one go, and the suggested split for big amounts. Without markets it checks the wallet's resolved markets on " +
      "BASIS, 25 per page (page), with the total. Redeem with redeem_market; for a market not yet resolved see get_potential_payout.",
    input: {
      wallet: p.wallet(),
      markets: z.array(z.string()).min(1).max(REDEEM_PAGE).optional().describe("Market addresses to check, up to 25. Default: the wallet's resolved markets on BASIS."),
      page: p.page(),
    },
    run: async ({ wallet, markets, page }, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, wallet);
      let refs: RedeemableRef[];
      let total: number | null = null;
      let scanCut = false;
      const pg = page ?? 1;
      if (markets && markets.length) {
        if (page !== undefined) throw new ValidationError("page", "page goes with the default list (without markets).");
        refs = markets.map((v, i) => ({ market: addr(v, `markets[${i}]`) }));
      } else {
        const all: RedeemableRef[] = [];
        for (let n = 1; n <= REDEEM_SCAN_PAGES; n++) {
          const r = await client.api.getWalletMarkets(who, { page: n, limit: 100 });
          for (const w of r.data) {
            if (w.resolved === true || w.status === "resolved" || w.status === "invalidated") {
              all.push({
                market: addr(w.marketToken, "market"),
                ...(w.hostKind === "public" || w.hostKind === "private" ? { host: w.hostKind } : {}),
              });
            }
          }
          if (!r.pagination.hasMore) break;
          if (n === REDEEM_SCAN_PAGES) scanCut = true;
        }
        total = all.length;
        refs = all.slice((pg - 1) * REDEEM_PAGE, pg * REDEEM_PAGE);
        if (!refs.length) {
          return {
            wallet: who,
            redeemable: [],
            totalResolvedMarkets: total,
            note: total ? `There are only ${Math.ceil(total / REDEEM_PAGE)} page(s) of resolved markets.` : "No resolved markets with a position for this wallet.",
          };
        }
      }
      const rows: Redeemable[] = [];
      for (let i = 0; i < refs.length; i += REDEEM_BATCH) {
        rows.push(...(await client.marketReader.getRedeemables(refs.slice(i, i + REDEEM_BATCH), who)));
      }
      const owed = rows.filter((r) => r.tokenPayout > 0n);
      const skipped = rows.filter((r) => r.skipped).map((r) => ({ market: r.market, why: r.skipped }));
      const pages = total !== null ? Math.ceil(total / REDEEM_PAGE) : null;
      return {
        wallet: who,
        redeemable: owed.map(redeemRow),
        checked: rows.length,
        nothingOwed: rows.length - owed.length - skipped.length,
        ...(skipped.length ? { skipped } : {}),
        ...(total !== null ? { page: pg, pages, totalResolvedMarkets: total } : {}),
        ...(pages !== null && pg < pages ? { next: `Call again with page: ${pg + 1} for the next ${REDEEM_PAGE} markets.` } : {}),
        ...(scanCut ? { note: "Only the wallet's latest 1000 markets on BASIS were looked at: pass markets to check older ones." } : {}),
      };
    },
  }),

  tool({
    name: "get_market_info",
    toolset: "markets",
    title: "Market info (live)",
    description:
      "Live state of one market from the chain, public or private: outcomes with odds, shares out and stakes, the pot and " +
      "what it sells for, end time, status, payout split, the result with ties, and this wallet's shares. Rules text, " +
      "volume and counts are in get_market_detail; proposals and disputes on the result are in get_market_resolution_status.",
    input: { market: marketParam() },
    run: async ({ market }, ctx) => {
      const client = await ctx.client();
      const mk = addr(market, "market");
      const live = await client.marketReader.getMarketLive(mk);
      const mod: MarketsBase = live.kind === "private" ? client.privateMarkets : client.predictionMarkets;
      const me = client.account;
      const ranked = live.resolved && live.status !== "invalid";
      const [info, split, mine, tieMask] = await Promise.all([
        client.mains.get(live.main),
        mod.getTrancheBP(mk),
        me ? client.marketReader.getAllUserShares(live.host, mk, me) : Promise.resolve(null),
        ranked ? mod.getFinalTieMask(mk) : Promise.resolve(0n),
      ]);
      const nameOf = (id: number) => live.outcomes.find((o) => o.outcomeId === id)?.name ?? `outcome ${id}`;
      const next = live.resolved
        ? "Redeem with redeem_market (check first with get_redeemables)."
        : live.kind === "private"
          ? "Quote with quote_prediction, then predict. Its voters settle the result with private_vote and private_finalize."
          : "Quote with quote_prediction, then predict. After it closes, see get_market_resolution_status; the result is " +
            "settled with propose_outcome, dispute_outcome, veto_outcome and finalize_market.";
      return userContent({
        market: mk,
        name: live.marketName,
        type: live.kind,
        main: info.symbol,
        pairAsset: info.pairSymbol,
        creator: live.creator,
        created: at(live.creationTime),
        ends: ends(live.endTime),
        status: live.status,
        ...(live.resolved ? { result: live.status === "invalid" ? "INVALID (refunds)" : placesText(live.finalRanking, tieMask, nameOf) } : {}),
        paused: live.paused,
        presalePhase: live.frozen,
        ...(live.kind === "private" ? { inviteOnly: live.isPrivate } : {}),
        payoutSplit: split.map(pctBps),
        outcomes: live.outcomes.map((o) => ({
          id: o.outcomeId,
          name: o.name,
          odds: pctE18(o.oddsE18),
          sharesOut: human(o.circulatingShares),
          staked: tokensText(o.totalCost),
          ...(live.resolved ? { inResult: o.hasWon } : {}),
        })),
        pot: tokensText(live.pot),
        potSellsFor: live.potValue,
        generalPot: tokensText(live.generalPot),
        oneMarketTokenSellsFor: live.tokenSellValue,
        minPrediction: tokensText(live.sizes.minBet),
        ...(mine ? { yourShares: mine.flatMap((s, i) => (s > 0n ? [{ id: i, name: nameOf(i), shares: human(s) }] : [])) } : {}),
        next,
      });
    },
  }),

  tool({
    name: "get_my_shares",
    toolset: "markets",
    title: "Shares in a market",
    description:
      "A wallet's shares on each outcome of one market (public or private), with how many are listed in orders and how " +
      "many are free to list. Shares can't be sold back to the market: sell them with list_order. Positions across every " +
      "market are in get_my_predictions.",
    input: {
      market: marketParam(),
      outcome: optOutcomeParam('One outcome only: its name, or its id as "#0". Default: every outcome with shares.'),
      wallet: p.wallet(),
    },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const m = await marketOf(client, args.market);
      const who = walletOrSelf(client, args.wallet);
      const [names, shares] = await Promise.all([m.mod.getOptionNames(m.market), client.marketReader.getAllUserShares(m.host, m.market, who)]);
      const ids =
        args.outcome !== undefined
          ? [resolveOutcome(names, args.outcome)]
          : shares.flatMap((s, i) => (s > 0n ? [i] : []));
      const locked = await Promise.all(
        ids.map((i) => ((shares[i] ?? 0n) > 0n ? client.orderBook.getLockedShares(m.market, i, who, { host: m.kind }) : Promise.resolve(0n))),
      );
      const rows = ids.map((i, k) => {
        const held = shares[i] ?? 0n;
        const lk = locked[k];
        return { id: i, name: names[i], shares: human(held), listedInOrders: human(lk), freeToList: human(held > lk ? held - lk : 0n) };
      });
      return userContent({
        market: m.market,
        wallet: who,
        type: m.kind,
        resolved: m.resolved,
        outcomes: rows,
        ...(rows.length === 0 ? { note: "No shares on this market." } : {}),
      });
    },
  }),

  tool({
    name: "get_potential_payout",
    toolset: "markets",
    title: "Potential payout",
    description:
      "What a wallet's shares would get if the market resolved now with a given result: per outcome it holds (one-winner " +
      "markets), or for a finishing order you pass (ranking: exactly the paid places, tied for shared places), plus the " +
      "refund if it resolved INVALID. Estimates at today's prices, not a promise. On a resolved market it shows what is " +
      "owed (redeem with redeem_market).",
    input: {
      market: marketParam(),
      outcome: optOutcomeParam('If this outcome wins: its name, or its id as "#0". Default: each outcome the wallet holds.'),
      ranking: z
        .array(outcomeParam())
        .min(1)
        .max(150)
        .optional()
        .describe(
          'A finishing order, first place first: each outcome a name or its id as "#0". List exactly the paid places ' +
            "(payoutSplit in get_market_info), more only when a tie spans the last paid place.",
        ),
      tied: z
        .array(z.number().int())
        .max(149)
        .optional()
        .describe("With ranking only: positions in it (0 = first entry) that share a place with the entry before them, e.g. [1] puts the first two level."),
      wallet: p.wallet(),
    },
    run: async (args, ctx) => {
      const client = await ctx.client();
      if (args.tied?.length && !args.ranking) throw new ValidationError("tied", "tied goes with ranking only.");
      if (args.outcome !== undefined && args.ranking) throw new ValidationError("outcome", "Give outcome or ranking, not both.");
      const m = await marketOf(client, args.market);
      const who = walletOrSelf(client, args.wallet);
      const names = await m.mod.getOptionNames(m.market);
      if (m.resolved) {
        const q = await client.marketReader.quoteRedeemValue(m.host, m.market, who);
        return {
          market: m.market,
          wallet: who,
          status: "resolved",
          owed: tokensText(q.tokenPayout),
          sellsForNow: q.pairPayout,
          next: q.tokenPayout > 0n ? "Redeem it with redeem_market." : "Nothing to redeem on this market for this wallet.",
        };
      }
      const split = await m.mod.getTrancheBP(m.market);
      const nameOf = (id: number) => names[id] ?? `outcome ${id}`;
      const scenarios: Record<string, unknown>[] = [];
      if (args.ranking) {
        const { ranking, tieMask } = readRanking(names, args.ranking, args.tied, split.length);
        const q = await client.marketReader.quoteScenario(m.host, m.market, ranking, tieMask, who);
        scenarios.push({ ifResult: placesText(ranking, tieMask, nameOf), marketTokens: tokensText(q.tokenPayout), sellsForNow: q.pairPayout });
      } else {
        if (split.length > 1) {
          throw new ValidationError(
            "ranking",
            `This market pays ${split.length} places (${split.map(pctBps).join(", ")}). Pass ranking: exactly ${split.length} outcomes in finishing order (with tied for shared places).`,
          );
        }
        let ids: number[];
        if (args.outcome !== undefined) {
          ids = [resolveOutcome(names, args.outcome)];
        } else {
          const shares = await client.marketReader.getAllUserShares(m.host, m.market, who);
          ids = shares.flatMap((s, i) => (s > 0n ? [i] : []));
        }
        const quotes = await Promise.all(ids.map((i) => client.marketReader.quoteScenario(m.host, m.market, [i], 0n, who)));
        ids.forEach((i, k) => scenarios.push({ ifWins: `${nameOf(i)} (#${i})`, marketTokens: tokensText(quotes[k].tokenPayout), sellsForNow: quotes[k].pairPayout }));
      }
      const invalid = await client.marketReader.quoteInvalidRefund(m.host, m.market, who);
      return userContent({
        market: m.market,
        wallet: who,
        payoutSplit: split.map(pctBps),
        scenarios,
        ifInvalid: { marketTokens: tokensText(invalid.tokenPayout), sellsForNow: invalid.pairPayout },
        ...(scenarios.length === 0 ? { note: "This wallet holds no shares here: pass outcome to see what an outcome would pay its current shares." } : {}),
        caveat: "If the market resolved now, at today's prices. These move with later predictions and with the market token's price; not a promise.",
      });
    },
  }),

  tool({
    name: "get_general_pot",
    toolset: "markets",
    title: "General pot",
    description:
      "A market's general pot: the market tokens held outside the outcome pools (part of what is shared out at " +
      "resolution), and what they sell for now in the pair asset. The whole pot is in get_market_info.",
    input: { market: marketParam() },
    run: async ({ market }, ctx) => {
      const client = await ctx.client();
      const m = await marketOf(client, market);
      const value =
        m.generalPot > 0n
          ? await client.marketReader.valueInPairAsset(m.host, m.market, m.generalPot)
          : pairAmount(0n, await client.mains.get(m.main));
      return { market: m.market, type: m.kind, generalPot: tokensText(m.generalPot), sellsForNow: value };
    },
  }),

  tool({
    name: "get_market_list",
    toolset: "markets",
    title: "List markets",
    description:
      "List prediction markets on BASIS, filtered by stage (status), main, public/private, creator, category or end " +
      "date, sorted by newest, ending soon, volume or predictors. Paged. To find markets by words, use search_markets.",
    input: {
      status: z.enum(STATUSES).optional().describe("Stage: active, awaiting_proposal, proposed, voting, resolved, invalidated, ..."),
      type: z.enum(["public", "private"]).optional().describe("public or private markets only."),
      main: p.main("Only markets on this main (key, address or symbol)."),
      creator: z.string().optional().describe("Only markets made by this wallet (0x...)."),
      category: z.string().optional().describe("Only this category."),
      resolved: p.bool("true: only resolved or invalidated; false: only the rest."),
      ends_before: z.union([z.string(), z.number()]).optional().describe("Ends before this time (ISO date or unix seconds)."),
      ends_after: z.union([z.string(), z.number()]).optional().describe("Ends after this time (ISO date or unix seconds)."),
      sort: z.enum(["newest", "ending", "volume24h", "volume", "predictors"]).optional().describe("Default newest."),
      page: p.page(),
      limit: p.limit(100, 20),
    },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const r = await client.api.getMarkets({
        status: args.status,
        host: args.type,
        main: args.main ? (await resolveMain(client, args.main)).main : undefined,
        creator: args.creator ? addr(args.creator, "creator") : undefined,
        category: args.category,
        resolved: args.resolved,
        endsBefore: args.ends_before,
        endsAfter: args.ends_after,
        sort: args.sort ? SORTS[args.sort] : undefined,
        page: args.page,
        limit: args.limit,
      });
      return userContent({ markets: r.data.map(marketRow), pagination: r.pagination });
    },
  }),

  tool({
    name: "search_markets",
    toolset: "markets",
    title: "Search markets",
    description: "Find prediction markets by words in their question or ticker, or by address. Paged. To filter and sort, use get_market_list.",
    input: {
      query: z.string().describe("Words from the question or ticker, or an address."),
      status: z.enum(STATUSES).optional().describe("Only markets at this stage."),
      page: p.page(),
      limit: p.limit(100, 20),
    },
    run: async ({ query, status, page, limit }, ctx) => {
      const client = await ctx.client();
      if (!query.trim()) throw new ValidationError("query", "query must not be empty.");
      const r = await client.api.getTokens({ search: query.trim(), isPrediction: true, predictionStatus: status, page, limit });
      const rows = r.data
        .filter((t: TokenSummary) => t.kind === null || t.kind === "market" || t.kind === "marketPrivate")
        .map((t: TokenSummary) => ({
          market: t.address,
          name: t.name,
          symbol: t.symbol,
          type: t.kind === "marketPrivate" ? "private" : t.kind === "market" ? "public" : null,
          status: t.predictionStatus,
          pairAsset: t.pairSymbol,
          image: t.image,
          created: t.createdAt,
          lastActivity: t.lastActivityAt,
          trades24h: t.trades24h,
          volume24hUsd: usd(t.volume24hUsdE18),
        }));
      return userContent({ markets: rows, pagination: r.pagination });
    },
  }),

  tool({
    name: "get_market_detail",
    toolset: "markets",
    title: "Market detail",
    description:
      "One market as BASIS lists it: the rules text, picture, category, lifecycle stage (active, awaiting proposal, " +
      "voting, resolved...), the result with ties, outcomes with odds as of the last indexed prediction, payout split, " +
      "seed, volume and counts. The live chain state is in get_market_info.",
    input: { market: marketParam() },
    run: async ({ market }, ctx) => {
      const client = await ctx.client();
      const d: MarketDetail = await client.api.getMarket(addr(market, "market"));
      const nameOf = (id: number) => d.options.find((o) => o.id === id)?.name ?? d.outcomes.find((o) => o.id === id)?.name ?? `outcome ${id}`;
      return userContent({
        market: d.marketToken,
        name: d.name,
        symbol: d.symbol,
        type: d.hostKind,
        private: d.private,
        category: d.category,
        image: d.image,
        rules: d.description,
        creator: d.creator,
        pairAsset: d.pairSymbol,
        created: at(d.creationTime),
        ends: ends(d.endTime),
        status: d.status,
        ...(d.deadline ? { stageEnds: at(d.deadline) } : {}),
        resolved: d.resolved,
        ...(d.resolved ? { resolution: d.resolution, result: resultOut(d.final, nameOf) } : {}),
        payoutSplit: d.trancheBP ? d.trancheBP.map(pctBps) : null,
        outcomes: d.outcomes.map((o) => ({
          id: o.id,
          name: o.name,
          odds: pctE18(o.probabilityE18),
          sharesOut: human(o.circulatingShares),
          staked: tokensText(o.totalCost),
          ...(d.resolved ? { inResult: o.hasWon } : {}),
        })),
        pot: tokensText(d.pot),
        generalPot: tokensText(d.generalPot),
        seed: {
          amount: pairText(d.seed.amount, d.pairDecimals, d.pairSymbol),
          marketTokens: tokensText(d.seed.token),
          sharesPerOutcome: human(d.seed.sharesPerOutcome),
          usd: usd(d.seedUsdE18),
        },
        volumeUsd: usd(d.volumeUsdE18),
        volume24hUsd: usd(d.volume24hUsdE18),
        predictors: d.bettors,
        predictions: d.bets,
        orderFills: d.fills,
        ...(d.invitedCount !== null && d.invitedCount !== undefined ? { invitedCount: d.invitedCount } : {}),
      });
    },
  }),

  tool({
    name: "get_market_trades",
    toolset: "markets",
    title: "Market predictions",
    description:
      "A market's predictions, newest first: wallet, outcome, shares, value, fee and the odds after each one. " +
      "Cursor-paged. Order book fills are in get_order_fills; every kind of market activity is in get_market_events.",
    input: {
      market: marketParam(),
      outcome: optOutcomeParam('Only this outcome: its name, or its id as "#0".'),
      limit: p.limit(100, 20),
      cursor: p.cursor(),
    },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const m = await marketOf(client, args.market);
      const names = await m.mod.getOptionNames(m.market);
      const outcomeId = args.outcome !== undefined ? resolveOutcome(names, args.outcome) : undefined;
      const r = await client.api.getMarketTrades(m.market, { outcomeId, limit: args.limit, cursor: args.cursor });
      return userContent({ market: m.market, trades: r.data.map((t) => tradeRow(t, names)), pagination: r.pagination });
    },
  }),

  tool({
    name: "get_market_odds_history",
    toolset: "markets",
    title: "Odds history",
    description: "How a market's odds moved over time, per outcome, in time buckets. Returns the latest points. The odds now are in get_market_info.",
    input: {
      market: marketParam(),
      interval: z.enum(["raw", "5m", "15m", "1h", "4h", "1d"]).optional().describe("Bucket size; raw = every prediction. Default 1h."),
      from: z.union([z.string(), z.number()]).optional().describe("Start (ISO date or unix seconds)."),
      to: z.union([z.string(), z.number()]).optional().describe("End (ISO date or unix seconds)."),
      points: z.number().int().min(1).max(1000).optional().describe("How many of the latest points to return (default 100)."),
    },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const m = await marketOf(client, args.market);
      const [names, r] = await Promise.all([
        m.mod.getOptionNames(m.market),
        client.api.getMarketOdds(m.market, { interval: args.interval, from: args.from, to: args.to }),
      ]);
      const label = (id: number) => `${id}: ${names[id] ?? "?"}`;
      const series = r.series.slice(-(args.points ?? 100)).map((s) => ({
        time: at(s.time),
        odds: Object.fromEntries(s.probabilities.map((x) => [label(x.outcomeId), pctE18(x.probabilityE18)])),
      }));
      return userContent({
        market: m.market,
        interval: r.interval,
        ...(r.initial ? { opening: Object.fromEntries(r.initial.map((x) => [label(x.outcomeId), pctE18(x.probabilityE18)])) } : {}),
        points: series,
        ...(r.truncated || r.series.length > series.length ? { note: "Only the latest points are shown: narrow from/to or use a bigger interval." } : {}),
      });
    },
  }),

  tool({
    name: "get_market_events",
    toolset: "markets",
    title: "Market activity",
    description:
      "Market activity, newest first: proposals, disputes, votes, results, redemptions and order book events. For one " +
      "market, one wallet, every market (all_markets), or with none of them this wallet. Cursor-paged. Predictions alone " +
      "are in get_market_trades, fills alone in get_order_fills.",
    input: {
      market: z.string().optional().describe("Only this market (0x...)."),
      wallet: z.string().optional().describe("Only this wallet's actions (0x...)."),
      all_markets: p.bool("Every market's events (not with market or wallet)."),
      action: z.enum(EVENT_ACTIONS).optional().describe("Only this kind of event."),
      limit: p.limit(100, 20),
      cursor: p.cursor(),
    },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const params: MarketEventsParams = { limit: args.limit, cursor: args.cursor };
      if (args.action) params.action = ACTION_TO_API[args.action] ?? (args.action as MarketEventAction);
      if (args.all_markets) {
        if (args.market || args.wallet) throw new ValidationError("all_markets", "all_markets can't be combined with market or wallet.");
        params.scope = "all";
      }
      if (args.market) params.marketToken = addr(args.market, "market");
      if (args.wallet) params.wallet = addr(args.wallet, "wallet");
      const r = await client.api.getMarketEvents(params);
      return userContent({ mode: r.mode, events: r.data.map(eventRow), pagination: r.pagination });
    },
  }),

  tool({
    name: "get_market_holders",
    toolset: "markets",
    title: "Market holders",
    description: "Who holds shares in a market, largest first, with what they paid and the totals per outcome. Paged.",
    input: {
      market: marketParam(),
      outcome: optOutcomeParam('Only this outcome: its name, or its id as "#0".'),
      page: p.page(),
      limit: p.limit(100, 20),
    },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const m = await marketOf(client, args.market);
      const names = await m.mod.getOptionNames(m.market);
      const outcomeId = args.outcome !== undefined ? resolveOutcome(names, args.outcome) : undefined;
      const h = await client.api.getMarketHolders(m.market, { outcomeId, page: args.page, limit: args.limit });
      return userContent({
        market: m.market,
        perOutcome: h.outcomes.map((o) => ({ id: o.outcomeId, name: names[o.outcomeId] ?? null, holders: o.holders, totalShares: human(o.totalShares) })),
        holders: h.data.map((d) => ({
          wallet: d.wallet,
          outcome: d.outcomeId,
          outcomeName: names[d.outcomeId] ?? null,
          shares: human(d.shares),
          paid: pairText(d.costPair, h.pairDecimals, h.pairSymbol),
          paidUsd: usd(d.costUsdE18),
        })),
        pagination: h.pagination,
      });
    },
  }),

  tool({
    name: "get_my_predictions",
    toolset: "markets",
    title: "Prediction positions",
    description:
      "A wallet's positions across prediction markets: shares per outcome, what was paid, book sales and redemptions. " +
      "Latest activity first, paged. One market in detail (free to list, outcome names): get_my_shares.",
    input: {
      wallet: p.wallet(),
      status: z.enum(STATUSES).optional().describe("Only markets at this stage."),
      page: p.page(),
      limit: p.limit(100, 20),
    },
    run: async ({ wallet, status, page, limit }, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, wallet);
      const r = await client.api.getWalletMarkets(who, { status, page, limit });
      return userContent({ wallet: who, positions: r.data.map(positionRow), pagination: r.pagination });
    },
  }),

  tool({
    name: "list_order",
    toolset: "markets",
    title: "Sell shares (list an order)",
    description:
      "Sell shares: list them on the market's order book at a price per share in the pair asset, or 0 to sell at the live " +
      "share price when filled. The shares stay yours but locked until filled or cancelled (cancel_order). This is the " +
      "only way to sell shares before the result. Public or private market. Price it with get_share_price.",
    input: {
      market: marketParam(),
      outcome: outcomeParam(),
      shares: p.amount("Shares to sell."),
      price_per_share: z
        .union([z.string(), z.number()])
        .describe("Price per share in the market's pair asset (e.g. 0.42 USDG), 0.001 to 1,000,000; or 0 for the live share price at fill time. See get_share_price."),
    },
    write: true,
    destructive: true,
    run: async (args, ctx) => {
      const client = await ctx.client();
      const m = await marketOf(client, args.market);
      const [names, meta] = await Promise.all([m.mod.getOptionNames(m.market), client.mains.tokenMeta(m.pairAsset)]);
      const outcome = resolveOutcome(names, args.outcome);
      let r: ListOrderResult;
      try {
        r = await client.orderBook.listOrder(m.market, outcome, to18(args.shares, "shares"), String(args.price_per_share), { host: m.kind });
      } catch (e) {
        throw reword(e, { decimals: meta.decimals, symbol: meta.symbol });
      }
      return userContent(
        marketTxOut(client, r, {
          market: m.market,
          outcome: { id: outcome, name: names[outcome] },
          amount: `${human(r.amount)} shares`,
          pricePerShare: r.pricePerShare === 0n ? "live share price at fill time" : `${human(r.pricePerShare)} ${meta.symbol}`,
          next: "Cancel it any time with cancel_order (the orderId above).",
        }),
      );
    },
  }),

  tool({
    name: "cancel_order",
    toolset: "markets",
    title: "Cancel an order",
    description: "Cancel one of your open orders on a market (also after the result). The unfilled shares are unlocked. Your orders: get_my_orders.",
    input: { market: marketParam(), order_id: orderIdParam() },
    write: true,
    destructive: true,
    run: async ({ market, order_id }, ctx) => {
      const client = await ctx.client();
      const m = await marketOf(client, market);
      return marketTxOut(client, await client.orderBook.cancelOrder(m.market, uint(order_id, "order_id"), { host: m.kind }));
    },
  }),

  tool({
    name: "buy_order",
    toolset: "markets",
    title: "Buy from one order",
    description:
      "Buy shares from one order on the book, paying in the market's pair asset (buyer fee included). The most you pay is " +
      "set from a fresh quote plus slippage. Orders fill only at or below the live share price. Check with get_order_cost; " +
      "to sweep several orders with one budget, use buy_multiple_orders.",
    input: {
      market: marketParam(),
      order_id: orderIdParam(),
      shares: p.amount("Shares to buy from this order."),
      slippage_percent: p.slippage(),
    },
    write: true,
    run: async (args, ctx) => {
      const client = await ctx.client();
      const m = await marketOf(client, args.market);
      const id = uint(args.order_id, "order_id");
      const fill = to18(args.shares, "shares");
      const slippageBps = slippageToBps(args.slippage_percent);
      let r: BuyOrderResult;
      try {
        let maxCost: bigint | undefined;
        if (ctx.config.maxSpendUsd !== undefined) {
          const c = await client.orderBook.getBuyOrderCost(m.market, id, fill, client.account, { host: m.kind });
          if (c.totalCostToBuyer.raw > 0n) {
            maxCost = maxWithSlippage(c.totalCostToBuyer.raw, slippageBps ?? client.slippageBps.trade);
            await checkSpend(client, m.pairAsset, maxCost);
          }
        }
        r = await client.orderBook.buyOrder(m.market, id, fill, { host: m.kind, slippageBps, maxCost });
      } catch (e) {
        return refusal(client, m.pairAsset, e);
      }
      return marketTxOut(client, r, { market: m.market, fill: r.fill ? { ...r.fill, amount: `${human(r.fill.amount)} shares` } : null });
    },
  }),

  tool({
    name: "buy_multiple_orders",
    toolset: "markets",
    title: "Buy from several orders",
    description:
      "Buy from several orders on one outcome with one budget in the market's pair asset, in the order you give them " +
      "(get_order_book lists them cheapest first). Optionally predict with what the orders leave. Orders that can't fill " +
      "(other outcome, your own, priced above the live share price, closed) are skipped. One order: buy_order.",
    input: {
      market: marketParam(),
      outcome: outcomeParam('The outcome the orders are on: its name, or its id as "#0".'),
      order_ids: z.array(z.union([z.string(), z.number()])).min(1).max(100).describe("Order ids to fill, in order (up to 100)."),
      budget: p.amount("Most to spend, in the market's pair asset (e.g. USDG)."),
      min_shares: p.optAmount("Least shares to end up with; the purchase fails below it. Default: from fresh quotes minus slippage."),
      predict_with_rest: p.bool("Also predict with whatever the orders leave of the budget, at the live odds. Default false: the rest stays in your wallet."),
      slippage_percent: p.slippage(),
    },
    write: true,
    run: async (args, ctx) => {
      const client = await ctx.client();
      const m = await marketOf(client, args.market);
      const names = await m.mod.getOptionNames(m.market);
      const outcome = resolveOutcome(names, args.outcome);
      const ids = args.order_ids.map((v, i) => uint(v, `order_ids[${i}]`));
      const budget = await toTokenRaw(client, m.pairAsset, args.budget, "budget");
      await checkSpend(client, m.pairAsset, budget);
      let r: BuyOrdersResult;
      try {
        r = await client.orderBook.buyOrders(m.market, outcome, ids, budget, {
          host: m.kind,
          amm: args.predict_with_rest ?? false,
          minShares: args.min_shares === undefined ? undefined : to18(args.min_shares, "min_shares"),
          slippageBps: slippageToBps(args.slippage_percent),
        });
      } catch (e) {
        return refusal(client, m.pairAsset, args.predict_with_rest ? rewordPredictionRefusal(e, m.kind) : e);
      }
      const { ammShares, amm, ammAmount, skipped, ...rest } = r;
      const pairSymbol = r.quotedCost.symbol;
      return userContent(
        marketTxOut(client, rest, {
          market: m.market,
          outcome: { id: outcome, name: names[outcome] },
          ...(skipped.length
            ? {
                skipped: skipped.map((s) => ({
                  orderId: s.orderId,
                  seller: s.seller,
                  why: `The seller can't receive ${pairSymbol} right now, so this order was left out.`,
                })),
              }
            : {}),
          minShares: human(r.minShares),
          quotedShares: human(r.quotedShares),
          sharesBought: human(r.sharesBought),
          fills: r.fills.map((f) => ({ ...f, amount: `${human(f.amount)} shares` })),
          ...(args.predict_with_rest
            ? {
                leftForPrediction: ammAmount,
                quotedPredictionShares: human(ammShares),
                prediction: amm ? { ...amm, shares: human(amm.shares) } : null,
              }
            : {}),
        }),
      );
    },
  }),

  tool({
    name: "get_order_cost",
    toolset: "markets",
    title: "Order cost",
    description:
      "What filling an order costs, buyer fee included: for a number of shares, or how many shares a budget (pair asset) " +
      "buys from it. Give shares or budget. Buy it with buy_order.",
    input: {
      market: marketParam(),
      order_id: orderIdParam(),
      shares: p.optAmount("Shares to fill."),
      budget: p.optAmount("Or: how much to spend, in the market's pair asset."),
      wallet: p.wallet("Buyer (the fee depends on the wallet). Default: this server's wallet."),
    },
    run: async (args, ctx) => {
      const client = await ctx.client();
      if (args.shares !== undefined && args.budget !== undefined) throw new ValidationError("shares", "Give shares or budget, not both.");
      const m = await marketOf(client, args.market);
      const id = uint(args.order_id, "order_id");
      const buyer = args.wallet ? addr(args.wallet, "wallet") : client.account;
      try {
        if (args.shares !== undefined) {
          const fill = to18(args.shares, "shares");
          const c = await client.orderBook.getBuyOrderCost(m.market, id, fill, buyer, { host: m.kind });
          return {
            market: m.market,
            orderId: id,
            shares: human(fill),
            baseCost: c.baseCost,
            buyerFee: c.buyerTax,
            totalCost: c.totalCostToBuyer,
            sellerGets: c.netToSeller,
          };
        }
        if (args.budget === undefined) throw new ValidationError("shares", "Give shares (to price a fill) or budget (to see what it buys).");
        const raw = await toTokenRaw(client, m.pairAsset, args.budget, "budget");
        const q = await client.orderBook.getBuyOrderAmountsOut(m.market, id, raw, buyer, { host: m.kind });
        return {
          market: m.market,
          orderId: id,
          sharesFilled: human(q.fill),
          baseCost: q.baseCost,
          buyerFee: q.buyerTax,
          totalCost: q.totalCostToBuyer,
          ...(q.fill === 0n
            ? { note: "Fills nothing: the order is filled, cancelled, your own, priced above the live share price, or the budget is too small." }
            : {}),
        };
      } catch (e) {
        return refusal(client, m.pairAsset, e);
      }
    },
  }),

  tool({
    name: "get_share_price",
    toolset: "markets",
    title: "Live share price",
    description:
      "The live share price of an outcome in the market's pair asset: orders fill only at or below it, and an order " +
      "listed at 0 fills at it. It moves with predictions and the market token's price. Use it to price list_order.",
    input: { market: marketParam(), outcome: outcomeParam() },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const m = await marketOf(client, args.market);
      const names = await m.mod.getOptionNames(m.market);
      const outcome = resolveOutcome(names, args.outcome);
      const [price, meta] = await Promise.all([
        client.orderBook.getSharePrice(m.market, outcome, { host: m.kind }),
        client.mains.tokenMeta(m.pairAsset),
      ]);
      return userContent({ market: m.market, outcome: { id: outcome, name: names[outcome] }, sharePrice: `${human(price)} ${meta.symbol} per share` });
    },
  }),

  tool({
    name: "get_order_book",
    toolset: "markets",
    title: "Order book",
    description:
      "A market's order book: the open orders that can fill now, grouped by outcome and price, cheapest first, with the " +
      "order ids to pass to buy_multiple_orders. Every order with its status: get_orders; past fills: get_order_fills.",
    input: { market: marketParam(), outcome: optOutcomeParam('Only this outcome: its name, or its id as "#0".') },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const m = await marketOf(client, args.market);
      const names = await m.mod.getOptionNames(m.market);
      const outcomeId = args.outcome !== undefined ? resolveOutcome(names, args.outcome) : undefined;
      const [book, meta] = await Promise.all([
        client.api.getMarketOrders(m.market, { view: "book", outcomeId }),
        client.mains.tokenMeta(m.pairAsset),
      ]);
      return userContent({
        market: m.market,
        levels: book.levels.map((l) => ({
          outcome: l.outcomeId,
          outcomeName: names[l.outcomeId] ?? null,
          pricePerShare: l.marketPriced ? "live share price" : `${human(l.pricePerShare)} ${meta.symbol}`,
          shares: human(l.remaining),
          orders: l.orders,
          orderIds: l.orderIds,
        })),
        ...(book.levels.length === 0 ? { note: "No order can fill right now." } : {}),
        ...(book.paused ? { paused: "Trading on this market is paused: no order fills until it resumes." } : {}),
        ...(book.invalidProposed ? { invalidProposed: "INVALID is proposed or backed by a vote: no order fills until that is settled." } : {}),
        ...(book.truncated ? { truncated: true } : {}),
      });
    },
  }),

  tool({
    name: "get_orders",
    toolset: "markets",
    title: "Market orders",
    description:
      "A market's orders on BASIS, newest first: active, filled or cancelled, with shares left, price and whether each " +
      "can fill now. Paged. Only what can fill now, by price: get_order_book; one wallet's orders: get_my_orders.",
    input: {
      market: marketParam(),
      status: z.enum(["active", "filled", "cancelled"]).optional().describe("Only orders with this status."),
      outcome: optOutcomeParam('Only this outcome: its name, or its id as "#0".'),
      page: p.page(),
      limit: p.limit(100, 20),
    },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const m = await marketOf(client, args.market);
      const names = await m.mod.getOptionNames(m.market);
      const outcomeId = args.outcome !== undefined ? resolveOutcome(names, args.outcome) : undefined;
      const [r, meta] = await Promise.all([
        client.api.getMarketOrders(m.market, {
          view: "list",
          status: args.status ? (args.status.toUpperCase() as OrderStatus) : undefined,
          outcomeId,
          page: args.page,
          limit: args.limit,
        }),
        client.mains.tokenMeta(m.pairAsset),
      ]);
      return userContent({ market: m.market, orders: r.data.map((o) => orderRow(o, names, meta.symbol)), pagination: r.pagination });
    },
  }),

  tool({
    name: "get_order_fills",
    toolset: "markets",
    title: "Order book fills",
    description:
      "A market's order book fills, newest first: the order, outcome, buyer and seller, shares, their cost before fees, " +
      "what the buyer paid (fee included) and what the seller got. Filter by order, outcome, buyer or seller. Cursor-paged. Open " +
      "orders: get_orders.",
    input: {
      market: marketParam(),
      order_id: p.optId("Only fills of this order id."),
      outcome: optOutcomeParam('Only fills on this outcome: its name, or its id as "#0".'),
      buyer: z.string().optional().describe("Only fills bought by this wallet (0x...)."),
      seller: z.string().optional().describe("Only fills sold by this wallet (0x...)."),
      limit: p.limit(100, 20),
      cursor: p.cursor(),
    },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const m = await marketOf(client, args.market);
      const [names, meta] = await Promise.all([m.mod.getOptionNames(m.market), client.mains.tokenMeta(m.pairAsset)]);
      const r = await client.api.getTokenFills(m.market, {
        orderId: args.order_id !== undefined ? uint(args.order_id, "order_id") : undefined,
        outcomeId: args.outcome !== undefined ? resolveOutcome(names, args.outcome) : undefined,
        buyer: args.buyer ? addr(args.buyer, "buyer") : undefined,
        seller: args.seller ? addr(args.seller, "seller") : undefined,
        cursor: args.cursor,
        limit: args.limit,
      });
      return userContent({
        market: m.market,
        fills: r.data.map((f) => fillRow(f, names, { decimals: meta.decimals, symbol: meta.symbol })),
        pagination: r.pagination,
      });
    },
  }),

  tool({
    name: "get_my_orders",
    toolset: "markets",
    title: "My orders",
    description:
      "A wallet's orders across markets (default this server's wallet), newest first, by status, market or outcome. " +
      "Paged. Cancel one with cancel_order.",
    input: {
      wallet: p.wallet(),
      status: z.enum(["active", "filled", "cancelled"]).optional().describe("Only orders with this status."),
      market: z.string().optional().describe("Only this market (0x...)."),
      outcome: optOutcomeParam('Only this outcome (needs market): its name, or its id as "#0".'),
      page: p.page(),
      limit: p.limit(100, 20),
    },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, args.wallet);
      let marketToken: Address | undefined;
      let outcomeId: number | undefined;
      if (args.market) marketToken = addr(args.market, "market");
      if (args.outcome !== undefined) {
        if (!args.market) throw new ValidationError("outcome", "outcome needs market: pass the market the orders are on.");
        const m = await marketOf(client, args.market);
        outcomeId = resolveOutcome(await m.mod.getOptionNames(m.market), args.outcome);
      }
      const params = {
        status: args.status ? (args.status.toUpperCase() as OrderStatus) : undefined,
        marketToken,
        outcomeId,
        page: args.page,
        limit: args.limit,
      };
      const self = client.account;
      const r = self && self.toLowerCase() === who.toLowerCase() ? await client.api.getMyOrders(params) : await client.api.getWalletOrders(who, params);
      const symbols = await symbolsOf(client, r.data.map((o) => o.pairAsset));
      return {
        wallet: who,
        orders: r.data.map((o) => orderRow(o, undefined, o.pairAsset ? symbols.get(o.pairAsset.toLowerCase()) : undefined)),
        pagination: r.pagination,
      };
    },
  }),

  tool({
    name: "whitelist_market_wallets",
    toolset: "markets",
    title: "Whitelist wallets for a market's presale",
    description:
      "Creator of a public market in its presale phase: let wallets predict during the presale. cap is how many market " +
      "tokens each may buy directly; predictions only need the wallet listed. Wallets already listed keep their old cap. " +
      "For private markets use private_manage_whitelist.",
    input: {
      market: marketParam(),
      wallets: z.array(z.string()).min(1).max(100).describe("Wallet addresses to whitelist (0x...), up to 100."),
      cap: p.amount("Most market tokens each wallet may buy directly in the presale."),
      tag: z.string().optional().describe("Optional label for this group."),
    },
    write: true,
    run: async ({ market, wallets, cap, tag }, ctx) => {
      const client = await ctx.client();
      const mk = addr(market, "market");
      const list = wallets.map((w, i) => addr(w, `wallets[${i}]`));
      return marketTxOut(client, await client.predictionMarkets.setWhitelistedWallet(mk, list, to18(cap, "cap"), tag ?? ""));
    },
  }),

  tool({
    name: "remove_market_whitelist",
    toolset: "markets",
    title: "Remove a wallet from a market's presale",
    description: "Creator of a public market in its presale phase: take a wallet off its whitelist, so it can't predict until the presale ends.",
    input: { market: marketParam(), wallet: p.address("Wallet to remove (0x...).") },
    write: true,
    destructive: true,
    run: async ({ market, wallet }, ctx) => {
      const client = await ctx.client();
      return marketTxOut(client, await client.predictionMarkets.removeWhitelist(addr(market, "market"), addr(wallet, "wallet")));
    },
  }),

  tool({
    name: "unfreeze_market",
    toolset: "markets",
    title: "End a market's presale",
    description:
      "Creator of a public market in its presale phase: end the presale now so anyone can predict. Can't be undone. For " +
      "private markets use private_disable_freeze.",
    input: { market: marketParam() },
    write: true,
    destructive: true,
    run: async ({ market }, ctx) => {
      const client = await ctx.client();
      return marketTxOut(client, await client.predictionMarkets.disableFreeze(addr(market, "market")));
    },
  }),
];
