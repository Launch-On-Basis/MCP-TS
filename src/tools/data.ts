
import { z } from "zod";
import { formatUnits, getAddress, isAddress } from "viem";
import { ValidationError } from "basis-sdk";
import type {
  ActivityRow,
  BasisClient,
  Loan,
  LoanEvent,
  OnchainReferrals,
  Pagination,
  ReferralAssetAmount,
  StatsFeeFlow,
  StatsHeldValue,
  StatsMainsRow,
  SwapTrade,
  TokenEvent,
  TokenEventName,
  TokenFee,
  TokenFeeTotal,
  TokenHolder,
  TokenKind,
  TokenReward,
  TokenRewardTotal,
  TokenSummary,
  TokenWhitelistEntry,
  VaultEvent,
  VaultHistoryBucket,
  VaultSummary,
  WalletEarningRow,
  WalletFeeRow,
  WalletHolding,
  WalletTransaction,
} from "basis-sdk";
import { userContent } from "../present.js";
import { p, tool, type ToolDef } from "../registry.js";
import { addr, resolveMain, resolveToken, walletOrSelf } from "../units.js";


type Meta = { symbol: string; decimals: number };
/** Lower-case address to symbol and decimals: every main, every pair asset, the native coin, plus tokens looked up. */
type Book = Map<string, Meta>;

const ZERO = "0x0000000000000000000000000000000000000000";
const MAX_UINT = 2n ** 256n - 1n;

/** A decimal string cut to `sig` significant digits (at least 2 decimals above 1). Truncates, never rounds up. */
function tidy(s: string, sig = 8): string {
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  const [int, frac = ""] = body.split(".");
  let keep: string;
  if (int !== "0") {
    keep = frac.slice(0, Math.max(2, sig - int.length));
  } else {
    const lead = frac.search(/[1-9]/);
    keep = lead < 0 ? "" : frac.slice(0, lead + sig);
  }
  keep = keep.replace(/0+$/, "");
  const out = keep ? `${int}.${keep}` : int;
  return neg && out !== "0" ? `-${out}` : out;
}

/** A x1e18 value (USD, price, probability) as a short decimal string; null stays null. */
function e18(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  try {
    return tidy(formatUnits(BigInt(String(v)), 18));
  } catch {
    return String(v);
  }
}

/** Raw integer units to an exact decimal string, with the symbol when known. Unknown decimals: marked as raw. */
function amt(raw: unknown, decimals: number | null | undefined, symbol?: string | null): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  let n: bigint;
  try {
    n = BigInt(String(raw));
  } catch {
    return String(raw);
  }
  if (decimals === null || decimals === undefined) return `${n} (raw units)`;
  const s = formatUnits(n, decimals);
  return symbol ? `${s} ${symbol}` : s;
}

/** Raw units of `asset`: decimals as given, else from the book; symbol from the book. */
function amtOf(book: Book, raw: unknown, asset?: string | null, decimals?: number | null): string | null {
  const m = asset ? book.get(asset.toLowerCase()) : undefined;
  return amt(raw, decimals ?? m?.decimals, m?.symbol);
}

function withSym(v: string | null, symbol?: string | null): string | null {
  if (v === null) return null;
  return symbol ? `${v} ${symbol}` : v;
}

function pct(bps: number | null | undefined): number | null {
  return bps === null || bps === undefined ? null : bps / 100;
}

/** Unix seconds (or ms above 1e12) to ISO; null stays null. */
function iso(t: number | null | undefined): string | null {
  if (t === null || t === undefined || !Number.isFinite(t)) return null;
  try {
    return new Date(t > 1e12 ? t : t * 1000).toISOString();
  } catch {
    return null;
  }
}

/** A whitelist buy cap in tokens; the 2^256 - 1 cap is "unlimited". */
function cap(raw: string | null | undefined, unlimited?: boolean | null): string | null {
  if (unlimited) return "unlimited";
  if (raw === null || raw === undefined) return null;
  try {
    if (BigInt(raw) >= MAX_UINT) return "unlimited";
  } catch {
    return raw;
  }
  return amt(raw, 18);
}

/**
 * Deep copy of an API object for reading: `xE18` keys become `x` in whole units (`priceUsdE18` -> `priceUsd`),
 * `xBps` keys become `xPercent`, and the USD-source bookkeeping keys are dropped. Raw amounts are left to the caller.
 */
function human(v: unknown, depth = 0): unknown {
  if (v === null || typeof v !== "object" || depth > 12) return v;
  if (Array.isArray(v)) return v.map((x) => human(x, depth + 1));
  const o = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(o)) {
    if (/usdSources?$/i.test(k)) continue;
    if (k.length > 3 && k.endsWith("E18") && (x === null || typeof x === "string" || typeof x === "number")) {
      const nk = k.slice(0, -3);
      out[nk in o ? k : nk] = e18(x);
    } else if (k.length > 3 && k.endsWith("Bps") && (x === null || typeof x === "number")) {
      const nk = `${k.slice(0, -3)}Percent`;
      out[nk in o ? k : nk] = pct(x as number | null);
    } else {
      out[k] = human(x, depth + 1);
    }
  }
  return out;
}

/** The result without undefined fields (present() would show them as null). */
function done(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)) ?? "null");
}

function pageInfo(pg?: Pagination | null): Record<string, unknown> {
  return pg ? { page: pg.page, hasMore: pg.hasMore, total: pg.total } : {};
}

function cursorInfo(pg?: Pagination | null): Record<string, unknown> {
  return pg ? { hasMore: pg.hasMore, nextCursor: pg.hasMore ? (pg.nextCursor ?? null) : undefined } : {};
}

/** Paging facts of one list the API paged (several lists in one result): shown, total, and the next page. */
function listInfo(shown: number, pg?: Pagination | null): Record<string, unknown> {
  if (!pg) return { shown };
  const page = pg.page ?? 1;
  return { shown, total: pg.total, page, hasMore: pg.hasMore, nextPage: pg.hasMore ? page + 1 : undefined };
}

/**
 * One page of a list the API sends whole: the rows, and how many are shown, the total and the next page (pass it as
 * `page`). `total` is the API's own count when it lists fewer rows than it counts.
 */
function slicePage<T>(all: readonly T[], limit: number, page = 1, total = all.length): { rows: T[]; list: Record<string, unknown> } {
  const start = (page - 1) * limit;
  const rows = all.slice(start, start + limit);
  const hasMore = start + rows.length < all.length;
  return {
    rows,
    list: {
      shown: rows.length,
      total: Math.max(total, all.length),
      page,
      hasMore,
      nextPage: hasMore ? page + 1 : undefined,
      note: total > all.length ? `BASIS lists ${all.length} of these ${total} here.` : undefined,
    },
  };
}

/** The site's six token families from the setting a token was made with (same bands as the tokens tools). */
function familyOf(setting: number, reversed: boolean): { family: string; setting: string } {
  const m = Math.max(1, Math.min(100, Math.round(setting)));
  const family = reversed ? (m >= 100 ? "Yolo" : m <= 50 ? "Meme+" : "Yolo+") : m >= 100 ? "Stable+" : m >= 50 ? "Utility+" : "Floor+";
  return { family, setting: `${reversed ? "R" : "H"}${m}` };
}

/** Family and setting (e.g. Utility+, H70) of a token made on BASIS; nothing for mains and markets. */
function familyFields(kind: string | null | undefined, setting: number | null | undefined, reversed: boolean | null | undefined): Record<string, string> {
  if (kind !== "token" && kind !== "reversed") return {};
  if (setting === null || setting === undefined || !Number.isFinite(setting)) return {};
  return familyOf(setting, reversed === true || kind === "reversed");
}

/**
 * The API's kind in this server's words: both groups of tokens made on BASIS as "token" (the family tells them apart),
 * a private prediction market as "market_private".
 */
function kindOut(kind: string | null | undefined): string | null | undefined {
  if (kind === "reversed") return "token";
  if (kind === "marketPrivate") return "market_private";
  return kind;
}

/** Up/Down (a pool, a fee kind, an activity row): not part of this server, so such rows are left out. */
function isUpDown(v: unknown): boolean {
  return typeof v === "string" && /up_?down/i.test(v);
}

/** An API word in this server's words: "bet" becomes "prediction" (bet_market -> prediction_market). */
function noBet<T extends string | null | undefined>(v: T): T {
  return (typeof v === "string" ? v.replace(/(^|_)bet(?=s?(?:_|$))/gi, "$1prediction") : v) as T;
}

/** search_tokens' kind filter in plain words, to the API's kinds. */
const KIND_FILTERS = ["stable_utility_floor", "meme_yolo", "main", "market", "market_private"] as const;
const KIND_TO_API: Record<(typeof KIND_FILTERS)[number], TokenKind> = {
  stable_utility_floor: "token",
  meme_yolo: "reversed",
  main: "main",
  market: "market",
  market_private: "marketPrivate",
};

/** get_token_settings_history's change names, to the API's event names. */
const SETTING_CHANGES = [
  "creator_fee",
  "holder_rewards_fee",
  "income_share",
  "presale_completed",
  "freeze_lifted",
  "whitelisted",
  "whitelist_removed",
] as const;
const SETTING_TO_API: Record<(typeof SETTING_CHANGES)[number], TokenEventName> = {
  creator_fee: "CreatorFeeSet",
  holder_rewards_fee: "RewardsFeeSet",
  income_share: "DevShareSet",
  presale_completed: "Bonded",
  freeze_lifted: "FreezeLifted",
  whitelisted: "WhiteListedWallet",
  whitelist_removed: "WhitelistRemoved",
};
const API_TO_SETTING: Record<string, string> = Object.fromEntries(Object.entries(SETTING_TO_API).map(([k, v]) => [v, k]));

/** A raw amount, left out when it is zero (history rows list only what moved). */
function nonZero(raw: string | null | undefined, decimals: number | null | undefined, symbol?: string | null): string | undefined {
  return raw && raw !== "0" ? (amt(raw, decimals, symbol) ?? undefined) : undefined;
}

/** Symbols and decimals of every main and pair asset (one cached chain read). Labels only: empty when it fails. */
async function assetBook(client: BasisClient): Promise<Book> {
  const book: Book = new Map([[ZERO, { symbol: "ETH", decimals: 18 }]]);
  try {
    for (const m of await client.mains.list()) {
      book.set(m.main.toLowerCase(), { symbol: m.symbol, decimals: 18 });
      if (!book.has(m.pairAsset.toLowerCase())) book.set(m.pairAsset.toLowerCase(), { symbol: m.pairSymbol, decimals: m.pairDecimals });
    }
  } catch {
  }
  return book;
}

function sym(book: Book, a?: string | null): string | undefined {
  return a ? book.get(a.toLowerCase())?.symbol : undefined;
}

/** Adds the decimals and symbol of tokens the book lacks (cached reads, at most 30 per call). */
async function learn(client: BasisClient, book: Book, addrs: (string | null | undefined)[]): Promise<void> {
  const todo = [...new Set(addrs.filter((a): a is string => !!a && isAddress(a, { strict: false })).map((a) => a.toLowerCase()))]
    .filter((a) => !book.has(a))
    .slice(0, 30);
  await Promise.all(
    todo.map(async (a) => {
      try {
        book.set(a, await client.mains.tokenMeta(getAddress(a)));
      } catch {
      }
    }),
  );
}

/** A time bound from what an agent typed: unix seconds, unix ms or an ISO date. */
function unixArg(v: number | string | undefined, field: string): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 0) throw new ValidationError(field, `${field} must be unix seconds or an ISO date, got ${v}.`);
    return Math.floor(v > 1e12 ? v / 1000 : v);
  }
  const s = v.trim();
  if (!s) return undefined;
  if (/^\d+$/.test(s)) return unixArg(Number(s), field);
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) throw new ValidationError(field, `${field} must be unix seconds or an ISO date (e.g. 2026-11-01), got "${v}".`);
  return Math.floor(ms / 1000);
}

/** A main filter: its address, or undefined for every main. */
async function mainArg(client: BasisClient, ref?: string): Promise<string | undefined> {
  return ref ? (await resolveMain(client, ref)).main : undefined;
}

const timeArg = (what: string) =>
  z.union([z.number(), z.string()]).optional().describe(`${what} Unix seconds or an ISO date (e.g. 2026-11-01).`);
const mainFilter = () =>
  z.string().optional().describe("Only this main: key (e.g. stasis-usdg), address or symbol (STASIS). Default: every main.");


function tokenRow(t: TokenSummary, book: Book) {
  const hasPresale = !!t.presaleTarget && t.presaleTarget !== "0";
  return {
    address: t.address,
    name: t.name,
    symbol: t.symbol,
    kind: kindOut(t.kind),
    ...familyFields(t.kind, t.hybridMultiplier, t.reversed),
    main: sym(book, t.main) ?? t.main,
    price: withSym(e18(t.priceE18), t.pairSymbol),
    priceUsd: e18(t.priceUsdE18),
    change24hPercent: pct(t.change24hBps),
    volume24hUsd: e18(t.volume24hUsdE18),
    mcapUsd: e18(t.mcapUsdE18),
    trades24h: t.trades24h,
    frozen: t.frozen || undefined,
    presaleComplete: hasPresale ? t.presaleComplete : undefined,
    predictionStatus: t.isPrediction ? (t.predictionStatus ?? undefined) : undefined,
    creator: t.dev ?? t.creator ?? undefined,
    createdAt: t.createdAt,
  };
}

/** One AMM leg (a token's trade, or a wallet's). */
function legRow(t: WalletTransaction, book: Book, forWallet: boolean) {
  return {
    time: t.timestamp,
    type: t.type,
    role: t.legRole && t.legRole !== "trade" ? t.legRole : undefined,
    token: forWallet ? t.contractAddress : undefined,
    wallet: forWallet ? undefined : t.user,
    tokens: amt(t.amountToken, 18),
    quoteAmount: amtOf(book, t.amountQuote, t.quoteAsset, t.quoteDecimals),
    price: withSym(e18(t.priceE18), t.pairSymbol),
    valueUsd: e18(t.valueUsdE18),
    presale: t.isPresale || undefined,
    txHash: t.txHash,
  };
}

function swapRow(t: SwapTrade, book: Book) {
  return {
    time: t.blockTime,
    kind: t.kind,
    side: t.side ?? undefined,
    trader: t.trader,
    token: t.token ?? undefined,
    in: amtOf(book, t.amountIn, t.tokenIn),
    out: amtOf(book, t.amountOut, t.tokenOut),
    tokenIn: t.tokenIn,
    tokenOut: t.tokenOut,
    value: amtOf(book, t.valuePair, t.pairAsset, t.pairDecimals),
    valueUsd: e18(t.valueUsdE18),
    fee: t.tax && t.taxToken ? amtOf(book, t.tax, t.taxToken) : undefined,
    presale: t.isPresale || undefined,
    txHash: t.txHash,
  };
}

function holderRow(h: TokenHolder) {
  return { wallet: h.wallet, balance: amt(h.balance, 18), sharePercent: pct(h.shareBps), protocol: h.isProtocol || undefined };
}

function tokenFeeRow(f: TokenFee) {
  return {
    time: iso(f.time),
    category: noBet(f.category),
    payer: f.payer,
    fee: amt(f.amount, f.decimals, f.symbol),
    creatorShare: f.creatorPaid && f.creatorPaid !== "0" ? amt(f.creatorPaid, f.decimals, f.symbol) : undefined,
    feeUsd: e18(f.amountUsdE18),
    txHash: f.txHash,
  };
}

function tokenFeeTotal(t: TokenFeeTotal) {
  return { category: noBet(t.category), fees: amt(t.amount, t.decimals, t.symbol), feesUsd: e18(t.amountUsdE18), count: t.n };
}

function whitelistRow(e: TokenWhitelistEntry) {
  return { wallet: e.walletAddress, maxTokens: cap(e.capTokens, e.unlimited), auto: e.auto || undefined, note: e.note ?? undefined, addedAt: e.timestamp };
}

function activityRow(a: ActivityRow, book: Book) {
  return {
    time: a.time,
    type: a.type,
    action: noBet(a.action),
    token: a.token ?? undefined,
    main: sym(book, a.main) ?? a.main ?? undefined,
    amounts: (a.amounts ?? []).map((x) => ({
      role: x.role,
      amount: amt(x.value, x.decimals, sym(book, x.asset)),
      asset: sym(book, x.asset) ? undefined : (x.asset ?? undefined),
    })),
    valueUsd: e18(a.valueUsdE18),
    details: a.details ? human(plainDetails(a.details)) : undefined,
    txHash: a.txHash,
  };
}

/** Activity details without a token's internal setting fields (get_token_details gives its family). */
function plainDetails(d: Record<string, unknown>): Record<string, unknown> {
  const { hybridMultiplier: _setting, reversed: _reversed, multiplier: _multiplier, ...rest } = d;
  return typeof rest.kind === "string" ? { ...rest, kind: kindOut(rest.kind) } : rest;
}

function walletFeeRow(r: WalletFeeRow) {
  return {
    asset: r.symbol ?? (r.nativeCoin ? "ETH" : r.pairAsset),
    category: noBet(r.category),
    fees: amt(r.fees, r.decimals, r.symbol),
    baseFees: amt(r.baseFees, r.decimals, r.symbol),
    feesUsd: e18(r.feesUsdE18),
    count: r.n,
  };
}

function earningRow(r: WalletEarningRow & { token?: string }) {
  return { token: r.token, asset: r.symbol ?? r.pairAsset, amount: amt(r.amount, r.decimals, r.symbol), amountUsd: e18(r.amountUsdE18), count: r.n };
}

function referralAmount(r: ReferralAssetAmount) {
  return { amount: amt(r.amount, r.pairDecimals, r.symbol), amountUsd: e18(r.amountUsdE18), count: r.n };
}

function onchainReferrals(o: OnchainReferrals | null | undefined): unknown {
  if (!o) return null;
  return {
    referrer: o.referrer ?? null,
    directCount: o.directCount,
    indirectCount: o.indirectCount,
    window: { from: o.from, to: o.to, levels: o.depth },
    earnings: (o.earnings ?? []).map((e) => ({ level: e.level, fromWallets: e.wallets, ...referralAmount(e) })),
    earningsTotal: human(o.earningsTotal),
    redirected: (o.redirected ?? []).map(referralAmount),
    referred: (o.referrals ?? []).map((r) => ({
      wallet: r.wallet,
      level: r.level,
      earned: (r.earned ?? []).map(referralAmount),
      feesTheyPaid: (r.feesGenerated ?? []).map(referralAmount),
    })),
    referredList: listInfo((o.referrals ?? []).length, o.referralsPagination),
  };
}

function loanRow(l: Loan, book: Book) {
  const pd = l.pairDecimals;
  const ps = l.pairSymbol ?? sym(book, l.pairAsset);
  return {
    loanId: l.loanId,
    source: l.source,
    status: l.status,
    main: sym(book, l.main) ?? l.main,
    collateralToken: l.token,
    collateral: amt(l.collateralAmount, 18),
    debt: amt(l.fullAmount, pd, ps),
    borrowed: amt(l.borrowedAmount, pd, ps),
    collateralValue: amt(l.collateralValue, pd, ps),
    collateralUsd: e18(l.collateralUsdE18),
    debtUsd: e18(l.debtUsdE18),
    days: l.daysCount ?? undefined,
    openedAt: iso(l.creationTime),
    endsAt: l.expiresAt ?? iso(l.liquidationTime),
    secondsLeft: l.active ? (l.secondsToLiquidation ?? undefined) : undefined,
    closedAt: l.closedAt ? iso(l.closedAt) : undefined,
    closeReason: l.closeReason ?? undefined,
    leftoverToClaim: l.liquidationClaim && l.liquidationClaim !== "0" ? amt(l.liquidationClaim, 18) : undefined,
    claimBy: l.seizableAfter ? iso(l.seizableAfter) : undefined,
    leverage: l.isLeverage
      ? {
          cashIn: amt(l.levCashIn, pd, ps),
          cashOut: amt(l.levCashOut, pd, ps),
          cashedOutBySells: amt(l.cashedOut, pd, ps),
          collateralReturnedValue: amt(l.levCollateralOut, pd, ps),
        }
      : undefined,
    vestingId: l.vestingId ?? undefined,
    txHash: l.txHash,
  };
}

function loanEventRow(e: LoanEvent, book: Book) {
  return {
    time: e.timestamp,
    action: e.action,
    source: e.source,
    loanId: e.loanId,
    main: sym(book, e.main) ?? e.main ?? undefined,
    valueUsd: e18(e.usdE18),
    pairAsset: e.pairSymbol ?? undefined,
    pairDecimals: e.pairDecimals ?? undefined,
    details: e.details ?? undefined,
    txHash: e.txHash,
  };
}

function vaultEventRow(e: VaultEvent, book: Book) {
  const ms = sym(book, e.main);
  return {
    time: e.timestamp,
    action: e.action,
    main: ms ?? e.main,
    amount: amt(e.amount, 18, ms),
    amountOut:
      e.amountOutUnit === "pair"
        ? amtOf(book, e.amountOut, e.pairAsset, e.pairDecimals)
        : e.amountOutUnit === "main"
          ? amt(e.amountOut, 18, ms)
          : undefined,
    txHash: e.txHash,
  };
}

function rewardRow(r: TokenReward) {
  return {
    time: iso(r.time),
    kind: r.kind,
    wallet: r.account ?? undefined,
    protocol: r.accountIsProtocol || undefined,
    amount: amt(r.amount, r.decimals, r.symbol),
    amountUsd: e18(r.amountUsdE18),
    txHash: r.txHash,
  };
}

function rewardTotal(t: TokenRewardTotal) {
  return { kind: t.kind, amount: amt(t.amount, t.decimals, t.symbol), amountUsd: e18(t.amountUsdE18), count: t.n };
}

function settingRow(e: TokenEvent) {
  const fee = e.event === "CreatorFeeSet" || e.event === "RewardsFeeSet";
  const share = e.event === "DevShareSet";
  const removed = share && (e.removed === true || e.bps === 0);
  return {
    time: iso(e.time),
    change: API_TO_SETTING[e.event] ?? e.event,
    feePercent: fee ? pct(e.bps) : undefined,
    shareOfCreatorFeePercent: share && !removed ? pct(e.bps) : undefined,
    removed: removed || undefined,
    wallet: e.wallet ?? undefined,
    maxTokens: e.event === "WhiteListedWallet" ? cap(e.capTokens) : undefined,
    label: e.tag ?? undefined,
    by: e.actor,
    txHash: e.txHash,
  };
}

function vaultHistoryRow(b: VaultHistoryBucket, mainSym: string, pairDecimals: number | null, pairSym: string | null) {
  const yieldIn = b.yieldPair && b.yieldPair !== "0";
  return {
    time: iso(b.time),
    staked: nonZero(b.staked, 18, mainSym),
    unstaked: nonZero(b.unstaked, 18, mainSym),
    compounded: nonZero(b.compounded, 18, mainSym),
    rewardsClaimed: nonZero(b.claimed, 18, mainSym),
    stakeLostToLiquidations: nonZero(b.liquidationLoss, 18, mainSym),
    yieldReceived: nonZero(b.yieldPair, pairDecimals, pairSym),
    yieldAddedToVault: nonZero(b.yieldMainAdded, 18, mainSym),
    yieldUsd: yieldIn ? e18(b.yieldUsdE18) : undefined,
    totalStakedAfter: amt(b.totalStaked, 18, mainSym),
    totalYieldAddedAfter: amt(b.totalYieldMainAdded, 18, mainSym),
  };
}

function heldValue(h: StatsHeldValue | null | undefined, r: StatsMainsRow, mainSym?: string) {
  if (!h) return undefined;
  const decimals = h.unit === "pair" ? r.pairDecimals : h.unit === "main" ? 18 : null;
  return { amount: amt(h.amount, decimals, h.unit === "pair" ? r.pairSymbol : mainSym), usd: e18(h.usdE18) };
}

function feeFlow(f: StatsFeeFlow | null | undefined, decimals?: number | null, symbol?: string | null) {
  return f ? { amount: amt(f.amount, decimals, symbol), usd: e18(f.usdE18), count: f.n } : undefined;
}

function vaultRow(v: VaultSummary, book: Book) {
  const ms = sym(book, v.main);
  return {
    main: ms ?? v.main,
    pairAsset: v.pairSymbol,
    totalStaked: amt(v.totalStaked, 18, ms),
    lockedAsLoanCollateral: amt(v.totalPledged, 18, ms),
    rewardsNotClaimed: amt(v.rewardsHeld, 18, ms),
    minStake: amt(v.minStake, 18, ms),
    yield7d: { received: amt(v.yield7dPair, v.pairDecimals, v.pairSymbol), mainAdded: amt(v.yield7d, 18, ms), usd: e18(v.yield7dUsdE18), payments: v.injections7d },
    yield30d: { received: amt(v.yield30dPair, v.pairDecimals, v.pairSymbol), mainAdded: amt(v.yield30d, 18, ms), usd: e18(v.yield30dUsdE18), payments: v.injections30d },
    aprPercent: pct(v.aprBps),
    lastLiquidation: v.lastLiquidation
      ? { time: v.lastLiquidation.time, stakeLost: amt(v.lastLiquidation.stakeLost, 18, ms), rewardsLost: amt(v.lastLiquidation.rewardsLost, 18, ms) }
      : null,
  };
}

function usdOf(h: WalletHolding): bigint {
  try {
    return h.valueUsdE18 ? BigInt(h.valueUsdE18) : -1n;
  } catch {
    return -1n;
  }
}


export const dataTools: ToolDef[] = [
  tool({
    name: "search_tokens",
    toolset: "data",
    title: "Search tokens",
    description:
      "Find BASIS tokens by name, symbol or address and get their addresses (other tools take the address). Also lists " +
      "tokens sorted by 24h volume, 24h price change, market cap or 24h trades for top lists. Each row has its family " +
      "(Stable+ ... Yolo), price, 24h change, volume and market cap in USD. Prediction markets by topic: search_markets " +
      "(markets tools).",
    input: {
      query: z.string().optional().describe("Name, symbol or address to look for (not case-sensitive). Default: every token."),
      creator: z.string().optional().describe("Only tokens created by this wallet address."),
      main: mainFilter(),
      kind: z
        .enum(KIND_FILTERS)
        .optional()
        .describe(
          "stable_utility_floor: Stable+, Utility+ and Floor+ tokens. meme_yolo: Meme+, Yolo+ and Yolo tokens. main: the " +
            "mains. market / market_private: public / private prediction markets. Default: all of them. Rows show both " +
            "token groups as kind token, with their family.",
        ),
      sort: z.enum(["newest", "oldest", "volume24h", "change24h", "mcap", "trades24h"]).optional().describe("Order of the list. Default newest."),
      order: z.enum(["desc", "asc"]).optional().describe("Direction of the volume24h, change24h, mcap and trades24h sorts. Default desc (largest first)."),
      page: p.page(),
      limit: p.limit(),
    },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const main = await mainArg(client, args.main);
      const [r, book] = await Promise.all([
        client.api.getTokens({
          search: args.query?.trim() || undefined,
          dev: args.creator ? addr(args.creator, "creator") : undefined,
          main,
          kind: args.kind ? KIND_TO_API[args.kind] : undefined,
          sort: args.sort,
          order: args.order,
          page: args.page,
          limit: args.limit,
        }),
        assetBook(client),
      ]);
      const tokens = r.data.filter((t) => !isUpDown(t.kind)).map((t) => tokenRow(t, book));
      return userContent(done({ tokens, ...pageInfo(r.pagination) }));
    },
  }),

  tool({
    name: "get_token_details",
    toolset: "data",
    title: "Token details",
    description:
      "Full BASIS data on one token: name, links, creator, family (Stable+ ... Yolo), price in its pair asset, in its " +
      "main and in USD, 24h change and volume, market cap, supply, holder count, price floor, liquidity, presale (its " +
      "target in the token itself), fee settings and auto-vesting. From the BASIS site, which can lag the chain by a few " +
      "seconds; get_token_state (tokens tools) reads it live from the chain. Its settings over time: get_token_settings_history.",
    input: { token: p.token() },
    run: async ({ token }, ctx) => {
      const client = await ctx.client();
      const t = await resolveToken(client, token);
      const [{ data: d }, book] = await Promise.all([client.api.getToken(t), assetBook(client)]);
      if (isUpDown(d.kind)) {
        throw new ValidationError("token", `${t} isn't a token or prediction market this server covers. Find tokens with search_tokens.`);
      }
      const mainSym = sym(book, d.main);
      const quoteSym = sym(book, d.quoteAsset);
      const {
        id: _id,
        chainId: _chainId,
        priceSource: _priceSource,
        supplySource: _supplySource,
        quoteAsset: _quoteAsset,
        quoteDecimals: _quoteDecimals,
        pairDecimals: _pairDecimals,
        kind,
        hybridMultiplier: _setting,
        reversed: _reversed,
        multiplier: _multiplier,
        priceE18,
        priceMainE18,
        floorE18,
        floorMainE18,
        totalSupply,
        lockedSupply,
        circulatingSupply,
        liquidity,
        depth,
        presaleTarget: _presaleTarget,
        presale,
        ...rest
      } = d;
      return userContent(done({
        ...(human(rest) as Record<string, unknown>),
        kind: kindOut(kind),
        ...familyFields(kind, d.hybridMultiplier, d.reversed),
        mainSymbol: mainSym,
        price: withSym(e18(priceE18), d.pairSymbol),
        priceInMain: d.kind === "main" ? undefined : withSym(e18(priceMainE18), mainSym),
        floor: withSym(e18(floorE18), d.pairSymbol),
        floorInMain: withSym(e18(floorMainE18), mainSym),
        totalSupply: amt(totalSupply, 18),
        lockedSupply: amt(lockedSupply, 18),
        circulatingSupply: amt(circulatingSupply, 18),
        liquidity: amt(liquidity, d.quoteDecimals, quoteSym),
        depth: amt(depth, d.quoteDecimals, quoteSym),
        presale:
          presale && presale.target !== "0"
            ? { target: amt(presale.target, 18, d.symbol || "tokens"), complete: presale.complete, completedAt: presale.completedAt }
            : undefined,
      }));
    },
  }),

  tool({
    name: "get_token_candles",
    toolset: "data",
    title: "Token price candles",
    description:
      "Price candles (open, high, low, close) of a token, for charts and trends. Gives the newest candles up to limit; " +
      "time is each candle's start in unix seconds. Price with supply, minted and burned over time: get_token_history.",
    input: {
      token: p.token(),
      interval: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]).optional().describe("Candle size. Default 1h."),
      quote: z
        .enum(["usd", "pair", "token"])
        .optional()
        .describe("Price unit: usd, pair (the pair asset, e.g. USDG) or token (the main the token trades against, e.g. STASIS). Default token."),
      from: timeArg("Start. Default 7 days ago."),
      to: timeArg("End. Default now."),
      limit: p.limit(500, 100),
    },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const t = await resolveToken(client, args.token);
      const r = await client.api.getTokenCandles(t, {
        interval: args.interval ?? "1h",
        quote: args.quote,
        from: unixArg(args.from, "from"),
        to: unixArg(args.to, "to"),
        limit: args.limit ?? 100,
      });
      return done({
        token: t,
        interval: r.interval,
        quote: r.quote ? r.quote.symbol : null,
        count: r.count,
        truncated: r.truncated || undefined,
        candles: r.data,
      });
    },
  }),

  tool({
    name: "get_token_trades",
    toolset: "data",
    title: "Token trades",
    description:
      "A token's trades, newest first: buys, sells and leverage opens and closes, with wallet, amounts, price and USD " +
      "value. Page on with cursor. Token to token swaps and site-wide trades: get_recent_trades; one wallet's trades: " +
      "get_wallet_transactions.",
    input: {
      token: p.token(),
      type: z.enum(["buy", "sell", "leverage_buy", "leverage_sell"]).optional().describe("Only this kind of trade. Default all."),
      from: timeArg("Only trades from this time."),
      to: timeArg("Only trades before this time."),
      cursor: p.cursor(),
      limit: p.limit(),
    },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const t = await resolveToken(client, args.token);
      const [r, book] = await Promise.all([
        client.api.getTokenTrades(t, {
          type: args.type,
          from: unixArg(args.from, "from"),
          to: unixArg(args.to, "to"),
          cursor: args.cursor,
          limit: args.limit,
        }),
        assetBook(client),
      ]);
      return done({ token: t, trades: r.data.map((x) => legRow(x, book, false)), ...cursorInfo(r.pagination) });
    },
  }),

  tool({
    name: "get_token_holders",
    toolset: "data",
    title: "Token holders",
    description: "A token's holders by balance, largest first, with each one's share of the circulating supply and the total holder count.",
    input: {
      token: p.token(),
      wallets_only: p.bool("true: leave out BASIS's own contracts (vesting, loans, vault). Default false (they are marked protocol)."),
      page: p.page(),
      limit: p.limit(),
    },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const t = await resolveToken(client, args.token);
      const r = await client.api.getTokenHolders(t, { page: args.page, limit: args.limit, protocol: args.wallets_only ? "exclude" : undefined });
      return done({
        token: r.token,
        holdersCount: r.holdersCount,
        protocolHolders: r.protocolHolders,
        circulatingSupply: amt(r.circulatingSupply, 18),
        holders: r.data.map(holderRow),
        ...pageInfo(r.pagination),
      });
    },
  }),

  tool({
    name: "get_token_fees",
    toolset: "data",
    title: "Token fees",
    description:
      "Fees charged on a token's trades in a time window (default all time): totals per kind of fee, then each fee with " +
      "its payer and the creator's share, newest first. The fee rates now: get_fee_settings (tokens tools); where the " +
      "holder rewards went: get_token_rewards.",
    input: {
      token: p.token(),
      from: timeArg("Window start."),
      to: timeArg("Window end."),
      cursor: p.cursor(),
      limit: p.limit(),
    },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const t = await resolveToken(client, args.token);
      const r = await client.api.getTokenFees(t, { from: unixArg(args.from, "from"), to: unixArg(args.to, "to"), cursor: args.cursor, limit: args.limit });
      return done({
        token: r.token,
        from: iso(r.from),
        to: iso(r.to),
        totals: (r.totals ?? []).filter((x) => !isUpDown(x.category)).map(tokenFeeTotal),
        fees: r.data.filter((x) => !isUpDown(x.category)).map(tokenFeeRow),
        ...cursorInfo(r.pagination),
      });
    },
  }),

  tool({
    name: "get_token_rewards",
    toolset: "data",
    title: "Token rewards history",
    description:
      "A token's reward money in a time window (default all time), newest first: holder rewards shared out, claimed " +
      "and recycled, and creator fee payouts, in the pair asset with USD values, plus totals per kind. Shared-out " +
      "amounts include recycled rewards coming back over time, so never add the kinds up. What a wallet can claim now: " +
      "get_claimable_rewards (tokens tools); a creator's lifetime income: get_creator_earnings (tokens tools).",
    input: {
      token: p.token(),
      kind: z
        .enum(["distributed", "claimed", "recycled", "creator_payout"])
        .optional()
        .describe(
          "distributed: shared out to holders. claimed: taken by a holder (this also happens on every sell). recycled: " +
            "put back to be shared out again over time. creator_payout: creator fee paid out. Default all.",
        ),
      from: timeArg("Window start."),
      to: timeArg("Window end."),
      cursor: p.cursor(),
      limit: p.limit(),
    },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const t = await resolveToken(client, args.token);
      const r = await client.api.getTokenRewards(t, {
        kind: args.kind,
        from: unixArg(args.from, "from"),
        to: unixArg(args.to, "to"),
        cursor: args.cursor,
        limit: args.limit,
      });
      return done({
        token: r.token,
        from: iso(r.from),
        to: iso(r.to),
        totals: (r.totals ?? []).map(rewardTotal),
        rewards: r.data.map(rewardRow),
        ...cursorInfo(r.pagination),
      });
    },
  }),

  tool({
    name: "get_token_settings_history",
    toolset: "data",
    title: "Token settings history",
    description:
      "How a token's settings changed, newest first: creator and holder rewards fee changes, creator income shares " +
      "set or removed, the presale completing (trading opens to everyone), the creator lifting the presale freeze, and " +
      "wallets added to or removed from the presale whitelist. The settings now: get_fee_settings, get_dev_shares and " +
      "get_whitelist (tokens tools).",
    input: {
      token: p.token(),
      change: z
        .enum(SETTING_CHANGES)
        .optional()
        .describe(
          "Only this kind of change. creator_fee / holder_rewards_fee: a fee rate set. income_share: a creator income " +
            "share set or removed. presale_completed: the presale filled and trading opened to everyone. freeze_lifted: " +
            "the creator opened trading to everyone. whitelisted / whitelist_removed: a wallet added to or taken off the " +
            "presale whitelist. Default all.",
        ),
      from: timeArg("Only changes from this time."),
      to: timeArg("Only changes before this time."),
      cursor: p.cursor(),
      limit: p.limit(),
    },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const t = await resolveToken(client, args.token);
      const r = await client.api.getTokenEvents(t, {
        event: args.change ? SETTING_TO_API[args.change] : undefined,
        from: unixArg(args.from, "from"),
        to: unixArg(args.to, "to"),
        cursor: args.cursor,
        limit: args.limit,
      });
      return userContent(done({ token: r.token, from: iso(r.from), to: iso(r.to), changes: r.data.map(settingRow), ...cursorInfo(r.pagination) }));
    },
  }),

  tool({
    name: "get_token_history",
    toolset: "data",
    title: "Token price and supply history",
    description:
      "A token's price and supply over time, one row per hour, 4 hours or day in which something happened: the last " +
      "price (in what the token trades against, and in USD), tokens minted and burned, and the supply after. Oldest " +
      "first. Chart candles: get_token_candles.",
    input: {
      token: p.token(),
      interval: z.enum(["1h", "4h", "1d"]).optional().describe("Row size. Default 1d."),
      from: timeArg("Start. Default: 90 intervals before the end (90 days at 1d, 90 hours at 1h); only intervals with activity are listed."),
      to: timeArg("End. Default now."),
      limit: p.limit(500, 90).describe("How many rows to list, the newest kept (1 to 500, default 90). For older rows, pass an earlier to."),
    },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const t = await resolveToken(client, args.token);
      const [r, book] = await Promise.all([
        client.api.getTokenHistory(t, { interval: args.interval ?? "1d", from: unixArg(args.from, "from"), to: unixArg(args.to, "to") }),
        assetBook(client),
      ]);
      const quoteSym = r.quote?.symbol ?? sym(book, r.quote?.asset) ?? sym(book, r.main);
      const n = args.limit ?? 90;
      const rows = r.data.slice(-n);
      const cut = r.data.length - rows.length;
      return done({
        token: r.token,
        interval: r.interval,
        from: iso(r.from),
        to: iso(r.to),
        shown: rows.length,
        total: r.data.length,
        note: cut > 0 ? `The ${cut} oldest rows of this window are not shown: raise limit, or pass an earlier to.` : undefined,
        rows: rows.map((x) => ({
          time: iso(x.time),
          price: withSym(e18(x.priceE18), quoteSym),
          priceUsd: e18(x.priceUsdE18),
          minted: nonZero(x.minted, 18),
          burned: nonZero(x.burned, 18),
          supply: amt(x.supply, 18),
        })),
      });
    },
  }),

  tool({
    name: "get_recent_trades",
    toolset: "data",
    title: "Recent trades",
    description:
      "The latest trades on BASIS, newest first: buys, sells and token to token swaps, for the whole site or for one " +
      "token, wallet or main. Leverage trades of a token are in get_token_trades.",
    input: {
      token: z.string().optional().describe("Only trades of this token (0x address, or a main / pair-asset symbol)."),
      wallet: z.string().optional().describe("Only trades by this wallet."),
      main: mainFilter(),
      kind: z.enum(["spot", "cross"]).optional().describe("spot: buys and sells. cross: token to token swaps. Default both."),
      from: timeArg("Only trades from this time."),
      to: timeArg("Only trades before this time."),
      cursor: p.cursor(),
      limit: p.limit(),
    },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const token = args.token ? await resolveToken(client, args.token) : undefined;
      const main = await mainArg(client, args.main);
      const [r, book] = await Promise.all([
        client.api.getTrades({
          token,
          trader: args.wallet ? addr(args.wallet, "wallet") : undefined,
          main,
          kind: args.kind,
          from: unixArg(args.from, "from"),
          to: unixArg(args.to, "to"),
          cursor: args.cursor,
          limit: args.limit,
        }),
        assetBook(client),
      ]);
      await learn(client, book, r.data.flatMap((x) => [x.tokenIn, x.tokenOut, x.taxToken]));
      return userContent(done({ trades: r.data.map((x) => swapRow(x, book)), ...cursorInfo(r.pagination) }));
    },
  }),

  tool({
    name: "get_platform_stats",
    toolset: "data",
    title: "Platform stats",
    description:
      "BASIS in numbers: tokens, prediction markets, agents and loans; transactions, trades and USD volume over 24h, 7 " +
      "days, 30 days and all time; unique traders; volume per main. Value held per main is in get_value_held.",
    input: { main: mainFilter() },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const main = await mainArg(client, args.main);
      const [s, book] = await Promise.all([client.api.getStats({ main }), assetBook(client)]);
      const { byMain, volumeByPairAsset, ...rest } = s;
      return done({
        ...(human(rest) as Record<string, unknown>),
        byMain: (byMain ?? []).map((r) => ({
          main: sym(book, r.main) ?? r.main ?? "not attributed",
          pairAsset: r.pairSymbol ?? undefined,
          allTime: human(r.total),
          last24h: human(r.h24),
          volume: amt(r.valuePair, r.pairDecimals, r.pairSymbol),
          volume24h: amt(r.valuePair24h, r.pairDecimals, r.pairSymbol),
        })),
        volumeByPairAsset: (volumeByPairAsset ?? []).map((v) => ({
          asset: v.pairSymbol ?? v.pairAsset,
          volume: amt(v.valuePair, v.pairDecimals, v.pairSymbol),
          volume24h: amt(v.valuePair24h, v.pairDecimals, v.pairSymbol),
        })),
      });
    },
  }),

  tool({
    name: "get_value_held",
    toolset: "data",
    title: "Value held per main",
    description:
      "Value held per main, each part with its USD value: liquidity, market depth, cash held, open interest, vault " +
      "stake (and the part locked as loan collateral), vault rewards not yet claimed, and prediction-market pots. The " +
      "parts overlap: never add them up.",
    input: { main: mainFilter() },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const main = await mainArg(client, args.main);
      const [s, book] = await Promise.all([client.api.getStatsMains({ main }), assetBook(client)]);
      return done({
        asOf: s.asOf,
        note: s.note,
        mains: (s.data ?? []).map((r) => {
          const ms = sym(book, r.main);
          return {
            main: ms ?? r.key ?? r.main,
            key: r.key,
            pairAsset: r.pairSymbol,
            priceUsd: e18(r.priceUsdE18),
            liquidity: heldValue(r.liquidity, r, ms),
            depth: heldValue(r.depth, r, ms),
            cashHeld: heldValue(r.cashHeld, r, ms),
            openInterest: r.openInterest ? { ...heldValue(r.openInterest, r, ms), positions: r.openInterest.positions ?? undefined } : undefined,
            vaultStaked: heldValue(r.vaultStaked, r, ms),
            vaultLockedAsLoanCollateral: heldValue(r.vaultPledged, r, ms),
            vaultRewardsNotClaimed: heldValue(r.vaultRewardsHeld, r, ms),
            predictionPots: r.marketPots
              ? { ...heldValue(r.marketPots, r, ms), markets: r.marketPots.count, unread: r.marketPots.failed || undefined }
              : undefined,
          };
        }),
      });
    },
  }),

  tool({
    name: "get_platform_fees",
    toolset: "data",
    title: "Platform fees",
    description:
      "Fees BASIS charged in a time window (default the last 30 days, at most 366 days), grouped by main, token or kind " +
      "of fee: total fees, creator payouts, referral payouts, buybacks and vault yield, with USD values. Largest first.",
    input: {
      from: timeArg("Window start. Default 30 days ago."),
      to: timeArg("Window end. Default now."),
      group_by: z.enum(["main", "token", "category"]).optional().describe("One row per main, token or kind of fee (and asset). Default main."),
      page: p.page(),
      limit: p.limit(),
    },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const [r, book] = await Promise.all([
        client.api.getStatsFees({
          from: unixArg(args.from, "from"),
          to: unixArg(args.to, "to"),
          groupBy: args.group_by,
          page: args.page,
          limit: args.limit,
        }),
        assetBook(client),
      ]);
      const byCategory = r.groupBy === "category";
      return done({
        groupBy: r.groupBy,
        from: iso(r.from),
        to: iso(r.to),
        rows: (r.data ?? []).filter((x) => !(byCategory && isUpDown(x.group))).map((x) => ({
          group: byCategory ? (noBet(x.group) ?? "none") : ((x.group ? sym(book, x.group) : undefined) ?? x.group ?? "none"),
          asset: x.symbol ?? x.asset,
          fees: feeFlow(x.fees, x.decimals, x.symbol),
          creatorPaid: x.fees?.creatorPaid && x.fees.creatorPaid !== "0" ? amt(x.fees.creatorPaid, x.decimals, x.symbol) : undefined,
          referralPaid: feeFlow(x.referralPaid, x.decimals, x.symbol),
          buyback: feeFlow(x.buyback, x.decimals, x.symbol),
          vaultYield: feeFlow(x.vaultYield, x.decimals, x.symbol),
        })),
        ...pageInfo(r.pagination),
      });
    },
  }),

  tool({
    name: "get_trader_leaderboard",
    toolset: "data",
    title: "Trader leaderboard",
    description:
      "Top wallets ranked by trading volume, fees paid or P&L (profit and loss after fees) over 24h, 7 days, 30 days or " +
      "all time. One row per BASIS account (its wallets added up). The final testing-phase standings: get_leaderboard.",
    input: {
      metric: z.enum(["volume", "fees", "pnl"]).optional().describe("Rank by volume, fees paid or pnl. Default volume."),
      period: z.enum(["24h", "7d", "30d", "all"]).optional().describe("Time window. pnl takes 7d, 30d or all. Default 7d."),
      page: p.page(),
      limit: p.limit(),
    },
    run: async (args, ctx) => {
      const client = await ctx.client();
      if (args.metric === "pnl" && args.period === "24h") {
        throw new ValidationError("period", "The P&L ranking has no 24h window: pass period 7d, 30d or all.");
      }
      const r = await client.api.getStatsLeaderboard({ metric: args.metric, period: args.period, page: args.page, limit: args.limit });
      return done({
        metric: r.metric,
        period: r.period,
        since: iso(r.since),
        rows: (r.data ?? []).map((x) => {
          const { updownUsdE18: _updown, viaRelay: _viaRelay, ...row } = x;
          return human(row);
        }),
        ...pageInfo(r.pagination),
      });
    },
  }),

  tool({
    name: "get_leaderboard",
    toolset: "data",
    title: "Testing-phase standings",
    description:
      "The final standings of the BASIS testing phase (rank, username, tier, public socials). Points were removed, so " +
      "these standings no longer change. Live rankings: get_trader_leaderboard.",
    input: {
      search: z.string().optional().describe("Find a username or public X name."),
      page: p.page(),
      limit: p.limit(),
    },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const r = await client.api.getLeaderboard({ search: args.search?.trim() || undefined, page: args.page, limit: args.limit });
      return userContent(done({
        frozen: r.frozen,
        note: r.frozenReason,
        takenAt: r.takenAt,
        standings: r.data.map((x) => ({
          rank: x.rank,
          username: x.username,
          tier: x.tierEmoji && x.tier ? `${x.tierEmoji} ${x.tier}` : x.tier,
          socials: x.socials?.length ? x.socials.map((s) => ({ platform: s.platform, handle: s.handle, url: s.url ?? undefined })) : undefined,
          profileId: x.profileId,
        })),
        ...pageInfo(r.pagination),
      }));
    },
  }),

  tool({
    name: "get_prices",
    toolset: "data",
    title: "Prices",
    description:
      "USD prices from BASIS. Without tokens: each pair asset (e.g. USDG) and ETH. With tokens (1 to 100): each token's " +
      "latest price in its pair asset, in its main and in USD. One token's price read live from the chain: get_price " +
      "(trading tools).",
    input: {
      tokens: z
        .array(z.string())
        .max(100)
        .optional()
        .describe("Token addresses (or main / pair-asset symbols), up to 100. Default: the pair assets and ETH."),
    },
    run: async (args, ctx) => {
      const client = await ctx.client();
      if (!args.tokens?.length) {
        const r = await client.api.getPrices();
        return done({
          asOf: r.asOf,
          prices: (r.data ?? []).map((x) => ({
            asset: x.symbol ?? x.asset,
            address: x.asset,
            roles: x.role,
            priceUsd: e18(x.priceUsdE18),
            updatedAt: x.updatedAt,
            stale: x.stale || undefined,
          })),
        });
      }
      const list = await Promise.all(args.tokens.map((t, i) => resolveToken(client, t, `tokens[${i}]`)));
      const [r, book] = await Promise.all([client.api.getTokenPrices(list), assetBook(client)]);
      return done({
        prices: (r.data ?? []).map((x) => ({
          token: x.address,
          found: x.found,
          price: withSym(e18(x.priceE18), sym(book, x.pairAsset)),
          priceInMain: x.priceMainE18 ? withSym(e18(x.priceMainE18), sym(book, x.main)) : undefined,
          priceUsd: e18(x.priceUsdE18),
          asOf: x.time ?? undefined,
        })),
      });
    },
  }),

  tool({
    name: "get_data_status",
    toolset: "data",
    title: "Data status",
    description:
      "How far BASIS's recorded data is behind the chain (blocks and seconds), and which features are live on this " +
      "network. Check it when a recent transaction is missing from the other data tools.",
    input: {},
    run: async (_args, ctx) => {
      const client = await ctx.client();
      const s = await client.api.getStatus();
      return done({
        network: s.network,
        chainHead: s.headBlock,
        recordedUpTo: s.lastBackfilledBlock,
        lagBlocks: s.lagBlocks,
        lagSeconds: s.lagSeconds,
        unconfirmedTxs: s.unconfirmedTxs,
        features: s.features,
        checkedAt: iso(s.checkedAt),
      });
    },
  }),

  tool({
    name: "get_wallet_portfolio",
    toolset: "data",
    title: "Wallet portfolio",
    description:
      "A wallet's portfolio in USD from BASIS data: pair-asset balances, token holdings (largest first, with cost and " +
      "realized P&L of bought tokens), vault stake, loans net of debt, vesting and prediction shares. totalUsd leaves " +
      "out vesting and predictions (see get_vestings in the vesting tools and get_my_predictions in the markets tools). " +
      "Long lists page with limit and page. get_balances reads balances from the chain instead.",
    input: {
      wallet: p.wallet(),
      limit: p.limit(200, 50).describe("How many holdings, vestings and prediction positions to list per page (1 to 200, default 50)."),
      page: p.page(),
    },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, args.wallet);
      const [pf, book] = await Promise.all([client.api.getWalletPortfolio(who), assetBook(client)]);
      const n = args.limit ?? 50;
      const pg = args.page ?? 1;
      const sorted = [...(pf.holdings ?? [])].sort((a, b) => {
        const x = usdOf(a);
        const y = usdOf(b);
        return y > x ? 1 : y < x ? -1 : 0;
      });
      const holdings = slicePage(sorted, n, pg, pf.holdingsCount ?? sorted.length);
      const vesting = slicePage(pf.vesting ?? [], n, pg);
      const predictions = slicePage(pf.predictions ?? [], n, pg);
      const predictionsCut = (pf as unknown as { predictionsTruncated?: boolean }).predictionsTruncated === true;
      return userContent(done({
        wallet: who,
        totalUsd: e18(pf.totalUsdE18),
        totalCovers:
          "Pair-asset balances, token holdings, vault stake net of its loan, and loans net of debt, at the latest " +
          "price. Vesting and prediction shares are not in totalUsd: see get_vestings (vesting tools) and get_my_predictions (markets tools).",
        unpricedLines: pf.unpriced || undefined,
        realizedPnlUsd: e18(pf.costBasis?.realizedPnlUsdE18),
        pairBalances: (pf.pairBalances ?? []).map((b) => ({ asset: b.pairSymbol, balance: b.balance, valueUsd: e18(b.valueUsdE18) })),
        holdings: holdings.rows.map((h) => ({
          token: h.address,
          symbol: h.symbol,
          isMain: h.isMain || undefined,
          balance: h.balance,
          price: amtOf(book, h.pricePairRaw, h.pairAsset, h.pairDecimals),
          priceUsd: e18(h.priceUsdE18),
          valueUsd: e18(h.valueUsdE18),
          costBasisUsd: e18(h.costBasisUsdE18),
          realizedPnlUsd: e18(h.realizedPnlUsdE18),
          lockedElsewhere: h.lockedFromTrades && h.lockedFromTrades !== "0" ? amt(h.lockedFromTrades, h.decimals ?? 18) : undefined,
        })),
        holdingsList: holdings.list,
        vaults: (pf.vaults ?? []).map((v) => {
          const ms = sym(book, v.main);
          return {
            main: ms ?? v.main,
            staked: amt(v.staked, 18, ms),
            lockedAsLoanCollateral: amt(v.pledged, 18, ms),
            hasActiveLoan: v.hasActiveLoan,
            debt: amtOf(book, v.debtRaw, v.pairAsset, v.pairDecimals),
            valueUsd: e18(v.valueUsdE18),
          };
        }),
        loans: (pf.loans ?? []).map((l) => ({
          id: l.id,
          source: l.source,
          main: sym(book, l.main) ?? l.main,
          collateralToken: l.token,
          collateral: amt(l.collateralWei, 18),
          debt: amtOf(book, l.fullAmountRaw, l.pairAsset, l.pairDecimals),
          netUsd: e18(l.netUsdE18),
        })),
        vesting: vesting.rows.map((v) => ({
          vestingId: v.vestingId,
          token: v.token,
          remaining: amt(v.remaining, 18),
          onLoan: v.activeLoanId ? v.activeLoanId : undefined,
          valueUsd: e18(v.valueUsdE18),
        })),
        vestingList: vesting.list,
        predictions: predictions.rows.map((m) => ({
          market: m.marketToken,
          private: m.hostKind === "private" || undefined,
          resolved: m.resolved,
          shares: (m.shares ?? []).map((s) => ({ outcomeId: s.outcomeId, shares: amt(s.shares, 18), probability: e18(s.probabilityE18) })),
          valueUsd: e18(m.valueUsdE18),
        })),
        predictionsList: {
          ...predictions.list,
          note: predictionsCut ? "Only the most recently active markets are listed here: get_my_predictions (markets tools) has every position." : undefined,
        },
      }));
    },
  }),

  tool({
    name: "get_wallet_stats",
    toolset: "data",
    title: "Wallet stats",
    description:
      "A wallet's totals on BASIS: trades (buys, sells, swaps, leverage), predictions, USD volume, fees paid, referral " +
      "earnings, tokens and markets created, loans, markets won, days active and when it was first seen. Profit and " +
      "loss: get_wallet_pnl.",
    input: { wallet: p.wallet() },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, args.wallet);
      const { upDownBets: _upDownBets, ...rest } = await client.api.getWalletSummary(who);
      return userContent(done(human(rest)));
    },
  }),

  tool({
    name: "get_wallet_pnl",
    toolset: "data",
    title: "Wallet P&L",
    description:
      "A wallet's P&L (profit and loss) after fees for the last week, month or all time: realized and unrealized, for " +
      "spot tokens and predictions, per position. Counts bought tokens only: tokens received another way (transfers, " +
      "vesting, vault rewards) are left out.",
    input: {
      wallet: p.wallet(),
      period: z.enum(["week", "month", "all"]).optional().describe("Default all."),
      limit: p.limit(100, 20).describe("How many positions and markets to list per page (1 to 100, default 20)."),
      page: p.page(),
    },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, args.wallet);
      const r = await client.api.getWalletPnl(who, { period: args.period });
      const n = args.limit ?? 20;
      const pg = args.page ?? 1;
      const { updown: _updown, positions, markets, ...rest } = r;
      const pos = slicePage(positions ?? [], n, pg);
      const mkts = slicePage(markets ?? [], n, pg);
      return done({
        ...(human(rest) as Record<string, unknown>),
        asOf: iso(r.asOf),
        positions: human(pos.rows),
        positionsList: pos.list,
        markets: human(mkts.rows),
        marketsList: mkts.list,
      });
    },
  }),

  tool({
    name: "get_wallet_activity",
    toolset: "data",
    title: "Wallet activity",
    description:
      "Everything a wallet did on BASIS in one feed, newest first: trades, swaps, predictions, loans, vault, vesting, " +
      "referrals, fees, payouts, transfers and what it created. Filter with types; page on with cursor. Trades only, " +
      "with price: get_wallet_transactions.",
    input: {
      wallet: p.wallet(),
      types: z
        .array(
          z.enum([
            "trade",
            "swap",
            "prediction",
            "book_fill",
            "loan",
            "vault",
            "vesting",
            "market",
            "referral",
            "fee",
            "creator_payout",
            "reward_claim",
            "transfer",
            "create",
          ]),
        )
        .max(14)
        .optional()
        .describe("Only these kinds (book_fill: order-book fills; create: tokens and markets it created). Default all."),
      cursor: p.cursor(),
      limit: p.limit(),
    },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, args.wallet);
      const [r, book] = await Promise.all([
        client.api.getWalletActivity(who, { types: args.types?.length ? args.types : undefined, cursor: args.cursor, limit: args.limit }),
        assetBook(client),
      ]);
      const rows = r.data.filter((a) => !isUpDown(a.type) && !isUpDown(a.action));
      return userContent(done({ wallet: who, activity: rows.map((a) => activityRow(a, book)), ...cursorInfo(r.pagination) }));
    },
  }),

  tool({
    name: "get_wallet_transactions",
    toolset: "data",
    title: "Wallet trades",
    description:
      "A wallet's token trades, newest first: buys, sells and leverage opens and closes, with token, amounts, price and " +
      "USD value. Page on with cursor. Everything else it did (loans, vault, predictions...): get_wallet_activity.",
    input: {
      wallet: p.wallet(),
      type: z.enum(["buy", "sell", "leverage_buy", "leverage_sell"]).optional().describe("Only this kind of trade. Default all."),
      main: mainFilter(),
      cursor: p.cursor(),
      limit: p.limit(),
    },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, args.wallet);
      const main = await mainArg(client, args.main);
      const [r, book] = await Promise.all([
        client.api.getWalletTransactions(who, { type: args.type, main, cursor: args.cursor, limit: args.limit }),
        assetBook(client),
      ]);
      return done({ wallet: who, trades: r.data.map((x) => legRow(x, book, true)), ...cursorInfo(r.pagination) });
    },
  }),

  tool({
    name: "get_wallet_fees",
    toolset: "data",
    title: "Fees a wallet paid",
    description:
      "Fees a wallet paid in a time window (default all time), per asset and optionally per kind of fee, with a USD " +
      "total. The fee it pays now on one token: get_tax_rate (tokens tools).",
    input: {
      wallet: p.wallet(),
      from: timeArg("Window start."),
      to: timeArg("Window end."),
      by_category: p.bool("true: one row per asset and kind of fee. Default: one row per asset."),
    },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, args.wallet);
      const r = await client.api.getWalletFees(who, {
        from: unixArg(args.from, "from"),
        to: unixArg(args.to, "to"),
        byCategory: args.by_category || undefined,
      });
      const fees = (r.data ?? []).filter((x) => !isUpDown(x.category)).map(walletFeeRow);
      return done({ wallet: who, from: r.from, to: r.to, total: human(r.total), fees });
    },
  }),

  tool({
    name: "get_wallet_earnings",
    toolset: "data",
    title: "Wallet earnings",
    description:
      "What a wallet earned in a time window (default all time): creator fee payouts from tokens it created (in total and " +
      "per token) and holder rewards it claimed, with USD values. 'redirected' is creator pay it could not receive " +
      "(sent to the protocol, not earned). Per-token lists page with limit and page. Lifetime creator income read " +
      "from the chain: get_dev_total_earnings (tokens tools); one token's reward history: get_token_rewards.",
    input: {
      wallet: p.wallet(),
      from: timeArg("Window start."),
      to: timeArg("Window end."),
      limit: p.limit(100, 50).describe("How many tokens to list per section and page (1 to 100, default 50)."),
      page: p.page(),
    },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, args.wallet);
      const r = await client.api.getWalletEarnings(who, { from: unixArg(args.from, "from"), to: unixArg(args.to, "to") });
      const n = args.limit ?? 50;
      const pg = args.page ?? 1;
      const byToken = slicePage(r.byToken ?? [], n, pg);
      const rewards = slicePage(r.holderRewards ?? [], n, pg);
      return done({
        wallet: who,
        from: r.from,
        to: r.to,
        creatorPayouts: (r.data ?? []).map(earningRow),
        creatorPayoutsTotal: human(r.total),
        creatorPayoutsByToken: byToken.rows.map(earningRow),
        creatorPayoutsByTokenList: byToken.list,
        holderRewardsClaimed: rewards.rows.map(earningRow),
        holderRewardsClaimedList: rewards.list,
        holderRewardsTotal: human(r.holderRewardsTotal),
        redirected: (r.redirected ?? []).map(earningRow),
      });
    },
  }),

  tool({
    name: "get_wallet_referrals",
    toolset: "data",
    title: "Wallet referrals",
    description:
      "A wallet's referrals: who referred it, the wallets it referred (by level), and what it earned from their fees, " +
      "per level and per referred wallet. 'redirected' is referral pay it could not receive (sent to the protocol, not " +
      "earned). Your own wallet also shows usernames. The wallet lists page with limit and page. Lifetime referral " +
      "earnings read from the chain: get_referral_earnings (tokens tools); who referred a wallet: get_referrer.",
    input: {
      wallet: p.wallet(),
      depth: z.number().int().min(1).max(5).optional().describe("Referral levels to include, 1 to 5. Default 2."),
      from: timeArg("Earnings window start."),
      to: timeArg("Earnings window end."),
      page: p.page(),
      limit: p.limit(),
    },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, args.wallet);
      const n = args.limit ?? 20;
      const pg = args.page ?? 1;
      const params = { depth: args.depth, from: unixArg(args.from, "from"), to: unixArg(args.to, "to"), page: pg, limit: n };
      const self = client.account;
      if (self && who.toLowerCase() === self.toLowerCase()) {
        const r = await client.api.getMyReferrals(params);
        const referred = slicePage(r.referrals ?? [], n, pg);
        return userContent(done({
          wallet: who,
          referrer: r.referrer ?? null,
          directCount: r.directCount,
          indirectCount: r.indirectCount,
          referredWallets: referred.rows.map((x) => ({ wallet: x.wallet, username: x.username, level: x.layer, joinedAt: x.joinedAt })),
          referredWalletsList: referred.list,
          onchain: onchainReferrals(r.onchain),
        }));
      }
      const r = await client.api.getWalletReferrals(who, params);
      return done({
        wallet: who,
        counts: r.points ? { hasReferrer: r.points.hasReferrer, directCount: r.points.directCount, indirectCount: r.points.indirectCount } : undefined,
        onchain: onchainReferrals(r.onchain),
      });
    },
  }),

  tool({
    name: "get_wallet_projects",
    toolset: "data",
    title: "Wallet projects",
    description:
      "Tokens and prediction markets a wallet created, newest first: family, price and market cap for tokens, end time " +
      "and outcomes for markets. Both lists page together with page and limit. The tokens read live from the chain: " +
      "get_my_tokens (tokens tools).",
    input: { wallet: p.wallet(), page: p.page(), limit: p.limit() },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, args.wallet);
      const [r, book] = await Promise.all([client.api.getWalletProjects(who, { page: args.page, limit: args.limit }), assetBook(client)]);
      const tokens = (r.tokens ?? []).filter((t) => !isUpDown(t.kind));
      const markets = r.markets ?? [];
      return userContent(done({
        wallet: who,
        tokens: tokens.map((t) => ({
          address: t.address,
          name: t.name,
          symbol: t.symbol,
          kind: kindOut(t.kind),
          ...familyFields(t.kind, t.hybridMultiplier, t.reversed),
          main: sym(book, t.main) ?? t.main,
          priceUsd: e18(t.priceUsdE18),
          mcapUsd: e18(t.mcapUsdE18),
          supply: amt(t.totalSupply, 18),
          frozen: t.frozen || undefined,
          presaleComplete: t.presaleComplete ?? undefined,
          createdAt: t.createdAt,
        })),
        tokensList: listInfo(tokens.length, r.tokensPagination),
        markets: markets.map((m) => ({
          address: m.address,
          name: m.name,
          symbol: m.symbol,
          private: m.isPrivate || undefined,
          outcomes: m.numOutcomes,
          endsAt: iso(m.endTime),
          createdAt: m.createdAt,
        })),
        marketsList: listInfo(markets.length, r.marketsPagination),
      }));
    },
  }),

  tool({
    name: "get_wallet_follows",
    toolset: "data",
    title: "Followers and following",
    description: "Who follows a wallet on BASIS, or who it follows, newest first.",
    input: {
      wallet: p.wallet(),
      list: z.enum(["followers", "following"]).optional().describe("followers: wallets following this one. following: wallets it follows. Default followers."),
      page: p.page(),
      limit: p.limit(),
    },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, args.wallet);
      const params = { page: args.page, limit: args.limit };
      const r = args.list === "following" ? await client.api.getWalletFollowing(who, params) : await client.api.getWalletFollowers(who, params);
      return done({
        wallet: who,
        list: args.list ?? "followers",
        wallets: r.data.map((f) => ({ wallet: f.wallet, since: iso(f.followedAt) })),
        ...pageInfo(r.pagination),
      });
    },
  }),

  tool({
    name: "get_wallet_roles",
    toolset: "data",
    title: "Wallet access",
    description:
      "Where a wallet has special access: tokens whose presale whitelist it is on (with the most tokens it may buy), " +
      "and private prediction markets where it may predict or vote. Lists page with limit and page. One token's " +
      "whitelist: get_whitelist (tokens tools); creator-managed markets only: private_get_roles (private tools).",
    input: {
      wallet: p.wallet(),
      limit: p.limit(200, 50).describe("How many tokens and markets to list per page (1 to 200, default 50)."),
      page: p.page(),
    },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, args.wallet);
      const r = await client.api.getWalletRoles(who);
      const n = args.limit ?? 50;
      const pg = args.page ?? 1;
      const wl = slicePage(r.whitelists ?? [], n, pg, r.whitelistsTotal ?? undefined);
      const pm = slicePage(r.privateMarkets ?? [], n, pg, r.privateMarketsTotal ?? undefined);
      return userContent(done({
        wallet: who,
        whitelists: wl.rows.map((w) => ({ token: w.token, maxTokens: cap(w.capTokens), auto: w.auto || undefined, note: w.note ?? undefined })),
        whitelistsList: wl.list,
        privateMarkets: pm.rows.map((m) => ({ market: m.marketToken, canPredict: m.buyer, canVote: m.voter })),
        privateMarketsList: pm.list,
      }));
    },
  }),

  tool({
    name: "get_public_profile",
    toolset: "data",
    title: "Your public profile",
    description:
      "Your BASIS profile as others see it: username, avatar, public socials, agent record, follower counts and final " +
      "testing-phase rank. Works for your own wallet only. With private socials too: get_my_profile (social tools).",
    input: { wallet: p.wallet("Your own wallet address (other wallets answer not found). Default: this server's wallet.") },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, args.wallet);
      const { pointsStale: _pointsStale, stats: _stats, ...rest } = await client.api.getPublicProfile(who);
      return userContent(done(human(rest)));
    },
  }),

  tool({
    name: "get_loan_history",
    toolset: "data",
    title: "Loan history",
    description:
      "A wallet's loans as BASIS recorded them (loans are made by the protocol), open and closed: collateral, debt, end " +
      "date, status and USD values, plus cash in and out of leverage positions. Repay by the end date to get your " +
      "tokens back; for live figures before acting use get_loans (loans tools). Event by event: get_loan_events.",
    input: {
      wallet: p.wallet(),
      source: z
        .enum(["hub", "vault", "leverage", "vesting"])
        .optional()
        .describe("hub: loans against tokens. vault: borrowing against vault stake. leverage: leverage positions. vesting: loans against vesting tokens. Default all."),
      status: z
        .enum(["active", "expired", "repaid", "liquidated", "claimable"])
        .optional()
        .describe("active: open. expired: past its end date. repaid. liquidated: not repaid by the end date. claimable: a leftover to claim. Default all."),
      token: z.string().optional().describe("Only loans with this collateral token (0x address, or a main symbol such as STASIS)."),
      main: mainFilter(),
      page: p.page(),
      limit: p.limit(),
    },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, args.wallet);
      const main = await mainArg(client, args.main);
      const token = args.token ? await resolveToken(client, args.token) : undefined;
      const [r, book] = await Promise.all([
        client.api.getWalletLoans(who, {
          source: args.source,
          status: args.status,
          token,
          main,
          page: args.page,
          limit: args.limit,
        }),
        assetBook(client),
      ]);
      return done({ wallet: who, loans: r.data.map((l) => loanRow(l, book)), ...pageInfo(r.pagination) });
    },
  }),

  tool({
    name: "get_loan_events",
    toolset: "data",
    title: "Loan events",
    description:
      "A wallet's loan history event by event, newest first: opened, repaid, extended, increased, partly sold, " +
      "liquidated, leftover claimed. Amounts inside details are raw units: pair-asset amounts use pairDecimals, token " +
      "amounts 18 decimals. One row per loan with its status: get_loan_history.",
    input: {
      wallet: p.wallet(),
      source: z.enum(["hub", "vault", "leverage", "vesting"]).optional().describe("Only this kind of loan. Default all."),
      action: z
        .enum([
          "created",
          "repaid",
          "repaid_partial",
          "extended",
          "increased",
          "added",
          "partial_sell",
          "liquidated",
          "liquidation_claimed",
          "liquidation_settled",
          "refinance_surplus",
        ])
        .optional()
        .describe("Only this kind of event. Default all."),
      main: mainFilter(),
      cursor: p.cursor(),
      limit: p.limit(),
    },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, args.wallet);
      const main = await mainArg(client, args.main);
      const [r, book] = await Promise.all([
        client.api.getWalletLoanEvents(who, { source: args.source, action: args.action, main, cursor: args.cursor, limit: args.limit }),
        assetBook(client),
      ]);
      return done({ wallet: who, events: r.data.map((e) => loanEventRow(e, book)), ...cursorInfo(r.pagination) });
    },
  }),

  tool({
    name: "get_vault_events",
    toolset: "data",
    title: "Vault events",
    description:
      "A wallet's vault history, newest first: stakes, unstakes, reward claims, compounds and stake lost to liquidated " +
      "vault loans. Its stake now: vault_get_position (loans tools); the whole vault over time: get_vault_history.",
    input: {
      wallet: p.wallet(),
      action: z.enum(["stake", "unstake", "claim", "compound", "liquidation_loss"]).optional().describe("Only this kind of event. Default all."),
      main: mainFilter(),
      cursor: p.cursor(),
      limit: p.limit(),
    },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, args.wallet);
      const main = await mainArg(client, args.main);
      const [r, book] = await Promise.all([
        client.api.getWalletVaultEvents(who, { action: args.action, main, cursor: args.cursor, limit: args.limit }),
        assetBook(client),
      ]);
      return done({ wallet: who, events: r.data.map((e) => vaultEventRow(e, book)), ...cursorInfo(r.pagination) });
    },
  }),

  tool({
    name: "get_vault_stats",
    toolset: "data",
    title: "Vault stats",
    description:
      "Vault figures per main: total staked, the part locked as loan collateral, rewards not yet claimed, minimum stake, " +
      "yield paid in over 7 and 30 days, and an APR worked out from that past yield (not a promise of future yield). " +
      "Read live from the chain: vault_get_info (loans tools); over time: get_vault_history.",
    input: { main: mainFilter() },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const main = await mainArg(client, args.main);
      const [r, book] = await Promise.all([client.api.getVaults({ main }), assetBook(client)]);
      return done({ vaults: (r.data ?? []).map((v) => vaultRow(v, book)) });
    },
  }),

  tool({
    name: "get_vault_history",
    toolset: "data",
    title: "Vault history",
    description:
      "One main's vault over time, one row per hour, 4 hours or day in which something happened: stakes, unstakes, " +
      "compounds, reward claims, stake lost to liquidated vault loans, yield paid in (in the pair asset, what it added " +
      "to the vault in the main, and USD) and the totals after. Oldest first. Past figures, not a promise. One wallet's " +
      "vault history: get_vault_events.",
    input: {
      main: p.main(),
      interval: z.enum(["1h", "4h", "1d"]).optional().describe("Row size. Default 1d."),
      from: timeArg("Start. Default: 90 intervals before the end (90 days at 1d, 90 hours at 1h); only intervals with activity are listed."),
      to: timeArg("End. Default now."),
      limit: p.limit(500, 90).describe("How many rows to list, the newest kept (1 to 500, default 90). For older rows, pass an earlier to."),
    },
    run: async (args, ctx) => {
      const client = await ctx.client();
      const info = await resolveMain(client, args.main);
      const r = await client.api.getVaultHistory({
        main: info.main,
        interval: args.interval ?? "1d",
        from: unixArg(args.from, "from"),
        to: unixArg(args.to, "to"),
      });
      const n = args.limit ?? 90;
      const rows = r.data.slice(-n);
      const cut = r.data.length - rows.length;
      const pairDecimals = r.pairDecimals ?? info.pairDecimals;
      const pairSym = r.pairSymbol ?? info.pairSymbol;
      return done({
        main: info.symbol,
        pairAsset: pairSym,
        interval: r.interval,
        from: iso(r.from),
        to: iso(r.to),
        shown: rows.length,
        total: r.data.length,
        note: cut > 0 ? `The ${cut} oldest rows of this window are not shown: raise limit, or pass an earlier to.` : undefined,
        rows: rows.map((b) => vaultHistoryRow(b, info.symbol, pairDecimals, pairSym)),
      });
    },
  }),
];
