
import { z } from "zod";
import { formatUnits, getAddress, zeroAddress, type Address } from "viem";
import {
  CLAIM_PERIOD_SECONDS,
  ERC20Abi,
  ValidationError,
  mainAmount,
  pairAmount,
  toAmount,
  type Amount,
  type BasisClient,
  type HubLoanDetails,
  type LiquidationBlock,
  type MainInfo,
  type VaultLoan,
  type VaultPosition,
} from "basis-sdk";
import { p, tool, type ToolDef } from "../registry.js";
import { addr, resolveMain, resolveToken, slippageToBps, to18, toPairRaw, toTokenRaw, uint, walletOrSelf } from "../units.js";
import { explorerUrl, span, txOut } from "../present.js";
import { errorText } from "../errors.js";
import { checkSpend } from "../limits.js";


const DAY = 86_400n;
const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const NOT_SENT = "Nothing was sent. Call again with confirm: true to send.";
const REFUSED_NOW = "It would be refused now (see whyNot). Nothing was sent.";

/** A loan preview for a write without confirm: true. */
function preview(view: Record<string, unknown>): Record<string, unknown> {
  return { status: "preview only", ...view, message: view.possible === false ? REFUSED_NOW : NOT_SENT };
}

/** `amount: "all"` (any case). */
function isAll(v: string | number | undefined): boolean {
  return typeof v === "string" && v.trim().toLowerCase() === "all";
}

/** A repay amount of 0 is refused here: the chain's own answer to it is misleading. */
function notZero(raw: bigint, field = "amount"): bigint {
  if (raw === 0n) throw new ValidationError(field, `${field} must be more than 0. Pass "all" to repay everything owed.`);
  return raw;
}

/** What the wallet lacks of `token` for `need` (the loan quotes don't check balances), or null when it holds enough. */
async function shortOf(client: BasisClient, token: Address, who: Address | undefined, need: bigint): Promise<string | null> {
  if (!who || need === 0n) return null;
  const [have, meta] = await Promise.all([
    client.publicClient.readContract({ address: token, abi: ERC20Abi, functionName: "balanceOf", args: [who] }),
    client.mains.tokenMeta(token),
  ]);
  if (have >= need) return null;
  return `Not enough ${meta.symbol} in the wallet: it has ${formatUnits(have, meta.decimals)}, this needs ${formatUnits(need, meta.decimals)}.`;
}

/** "12.5 USDG". */
const show = (a: Amount) => `${a.formatted} ${a.symbol}`;

/** Unix seconds to ISO time; 0 or missing gives null. */
function iso(sec: bigint | number | null | undefined): string | null {
  if (sec === null || sec === undefined) return null;
  const n = Number(sec);
  return n > 0 ? new Date(n * 1000).toISOString() : null;
}


/** Basis points as a percent string ("0.6%"). */
function percent(bps: bigint | number): string {
  return `${Number(bps) / 100}%`;
}

/** `part / whole` as a percent string, from a quote's own figures. */
function shareOf(part: bigint, whole: bigint): string | null {
  if (whole === 0n) return null;
  return `${Number((part * 1_000_000n) / whole) / 10_000}%`;
}

async function chainNow(client: BasisClient): Promise<bigint> {
  return (await client.publicClient.getBlock()).timestamp;
}

/** Formatters for one loan: its main's pair asset and its collateral token. */
interface Units {
  info: MainInfo;
  pair: (raw: bigint) => Amount;
  col: (raw: bigint) => Amount;
  colSymbol: string;
}

async function unitsOf(client: BasisClient, main: Address, token: Address): Promise<Units> {
  const info = await client.mains.get(main);
  const pair = (raw: bigint): Amount => pairAmount(raw, info);
  if (eq(token, info.main)) return { info, pair, col: (raw: bigint): Amount => mainAmount(raw, info), colSymbol: info.symbol };
  const meta = await client.mains.tokenMeta(token);
  const asset = getAddress(token);
  return { info, pair, col: (raw: bigint): Amount => toAmount(raw, meta.decimals, "token", asset, meta.symbol), colSymbol: meta.symbol };
}

/** Formatter for any ERC-20 by its own decimals. */
async function tokenUnits(client: BasisClient, token: Address): Promise<(raw: bigint) => Amount> {
  const meta = await client.mains.tokenMeta(token);
  const asset = getAddress(token);
  return (raw: bigint): Amount => toAmount(raw, meta.decimals, "token", asset, meta.symbol);
}

/** A wallet's loan by id, with a plain error for an id it doesn't have (the chain only says "does not exist"). */
async function hubLoan(client: BasisClient, who: Address, id: bigint): Promise<HubLoanDetails> {
  const count = await client.loans.getUserLoanCount(who);
  if (id < 1n || id > count) {
    throw new ValidationError(
      "loan_id",
      count === 0n ? "This wallet has no loans." : `No loan ${id} for this wallet: its loan ids run 1 to ${count} (list them with get_loans).`,
    );
  }
  return client.loans.getUserLoanDetails(who, id);
}

type LoanLike = { active: boolean; isLiquidated: boolean; liquidationTime: bigint; liquidationClaim: bigint };
type StatusCode = "open" | "past_end_date" | "liquidated_leftover_to_claim" | "liquidated" | "closed";

function statusOf(l: LoanLike, now: bigint): StatusCode {
  if (l.active) return l.liquidationTime < now ? "past_end_date" : "open";
  if (l.isLiquidated) return l.liquidationClaim > 0n ? "liquidated_leftover_to_claim" : "liquidated";
  return "closed";
}

const STATUS_MEANING: Record<StatusCode, string> = {
  open: "Open. Repay by the end date to get the collateral back.",
  past_end_date: "Past its end date: it can be liquidated at any time. Repay or extend it now.",
  liquidated_leftover_to_claim: "Liquidated. Claim what is left with claim_loan_leftover.",
  liquidated: "Liquidated, nothing left to claim.",
  closed: "Closed (repaid or sold).",
};

function hubEndText(owed: Amount, end: string | null, colSymbol: string): string {
  return (
    `Repay ${show(owed)} by ${end ?? "the end date"} to get your ${colSymbol} back. After that date the loan can be ` +
    "liquidated: part of the collateral clears what you owe, and what is left (less a fee) can be claimed with claim_loan_leftover."
  );
}

function vaultEndText(owed: Amount, end: string | null): string {
  return (
    `Repay ${show(owed)} by ${end ?? "the end date"} with vault_repay to free the pledged stake. After that date the loan ` +
    "can be liquidated: the loss comes off your stake, then off your unclaimed rewards."
  );
}

/** A loan (from get_loans) for output: amounts with their units, dates as ISO, a status code. */
function loanView(d: HubLoanDetails, u: Units, now: bigint, closedAt: bigint): Record<string, unknown> {
  const status = statusOf(d, now);
  const v: Record<string, unknown> = {
    loanId: d.hubId,
    status,
    main: u.info.symbol,
    collateralToken: { symbol: u.colSymbol, address: d.collateralToken },
  };
  if (d.active) {
    v.collateral = u.col(d.collateralAmount);
    v.owed = u.pair(d.fullAmount);
  }
  v.borrowed = u.pair(d.borrowedAmount);
  v.started = iso(d.creationTime);
  v.endDate = iso(d.liquidationTime);
  if (d.active) v.timeLeft = d.liquidationTime > now ? span(d.liquidationTime - now) : "none, past the end date";
  if (!d.active && closedAt > 0n) v.closedAt = iso(closedAt);
  if (d.isLiquidated) {
    v.collateralLiquidated = u.col(d.liquidatedAmount);
    v.leftoverToClaim = u.col(d.liquidationClaim);
    if (closedAt > 0n && d.liquidationClaim > 0n) {
      const by = closedAt + CLAIM_PERIOD_SECONDS;
      v.claimBy = iso(by);
      if (now > by) v.claimDatePassed = true;
    }
  }
  return v;
}

function positionView(pos: VaultPosition): Record<string, unknown> {
  return {
    main: pos.staked.symbol,
    mainAddress: pos.main,
    staked: pos.staked,
    unclaimedRewards: pos.earned,
    pledgedToLoan: pos.pledged,
    freeToUnstake: pos.freeToUnstake,
    availableToBorrowAgainst: pos.availableStasis,
    hasLoan: pos.hasActiveLoan,
  };
}

function vaultLoanView(l: VaultLoan, now: bigint): Record<string, unknown> {
  const v: Record<string, unknown> = {
    loanId: l.hubId,
    status: statusOf({ ...l, liquidationClaim: l.liquidationClaim.raw }, now),
    stakePledged: l.collateralAmount,
    owed: l.fullAmount,
    borrowed: l.borrowedAmount,
    started: iso(l.creationTime),
    endDate: iso(l.liquidationTime),
  };
  if (l.active) {
    v.timeLeft = l.liquidationTime > now ? span(l.liquidationTime - now) : "none, past the end date";
    v.atTheEnd = vaultEndText(l.fullAmount, iso(l.liquidationTime));
  }
  return v;
}

/** Rewards that can be claimed now: with a loan open, only the part the loan doesn't need. */
function rewardsView(pos: VaultPosition): Record<string, unknown> {
  const earned = pos.earned.raw;
  const total = pos.staked.raw + earned;
  const free = total > pos.pledged.raw ? total - pos.pledged.raw : 0n;
  const claimable = earned < free ? earned : free;
  const m = (raw: bigint) => toAmount(raw, 18, "main", pos.main, pos.staked.symbol);
  const v: Record<string, unknown> = { main: pos.staked.symbol, unclaimedRewards: pos.earned, claimableNow: m(claimable) };
  if (claimable < earned) v.backingTheLoan = m(earned - claimable);
  return v;
}

type FeeFrom = "wallet" | "debt" | "refinance";

const feeFromParam = () =>
  z
    .enum(["wallet", "debt", "refinance"])
    .optional()
    .describe(
      "How the extension fee is paid. wallet (default): now, in the pair asset. debt: added to what you owe. " +
        "refinance: also borrows out the value the collateral gained since, the fee comes out of it (days may be 0).",
    );

function feeMode(f?: FeeFrom): { pay: boolean; refi: boolean } {
  const m = f ?? "wallet";
  return { pay: m === "wallet", refi: m === "refinance" };
}

const FEE_PAID: Record<FeeFrom, string> = {
  wallet: "from the wallet now",
  debt: "added to what you owe",
  refinance: "out of the refinance",
};

/** Turns an SDK refusal into words an agent can act on (tool names, human units). */
type Hint = string | (() => Promise<string>);

async function explain(hints: Record<string, Hint>, rule: string | null): Promise<string | null> {
  if (rule === null) return null;
  const h = hints[rule];
  if (h === undefined) return rule;
  if (typeof h === "string") return h;
  try {
    return await h();
  } catch {
    return rule;
  }
}

/** The SDK's "Balance of X is 123, below the 456 needed" in the token's own units. */
async function balanceError(client: BasisClient, e: ValidationError): Promise<Error> {
  const m = /Balance of (\S+) is (\d+), below the (\d+)/.exec(e.message);
  if (!m) return e;
  try {
    const token = await resolveToken(client, m[1]);
    const { decimals, symbol } = await client.mains.tokenMeta(token);
    return new ValidationError(
      "balance",
      `Not enough ${symbol} in the wallet: it has ${formatUnits(BigInt(m[2]), decimals)}, this needs ${formatUnits(BigInt(m[3]), decimals)}.`,
    );
  } catch {
    return e;
  }
}

/** Runs an SDK call; a refusal with a hint is re-thrown in plain words, every other error as it is. */
async function guided<T>(client: BasisClient, call: () => Promise<T>, hints: Record<string, Hint>): Promise<T> {
  try {
    return await call();
  } catch (e) {
    if (!(e instanceof ValidationError)) throw e;
    if (e.rule === "balance" && hints.balance === undefined) throw await balanceError(client, e);
    const text = await explain(hints, e.rule);
    if (text === null || text === e.rule) throw e;
    throw new ValidationError(e.rule, text);
  }
}

const EXTEND_TEXT: Record<string, string> = {
  "Must be refinance if not extending time": "0 days only works with fee_from: refinance.",
  "Not enough collateral to cover fees": "The collateral isn't worth enough to add the fee to what you owe: pay it from the wallet (fee_from: wallet).",
  "No equity": "The collateral is worth no more than what you owe, so there is nothing to refinance.",
  "Minimum surplus not met": "The value the collateral gained is below the minimum for a refinance.",
  "Fees exceed surplus value": "The refinance fees would take all of the value the collateral gained.",
  "Time remaining too short": "Too few days are left on the loan for a refinance that adds no days: pass days (1 or more).",
};

/** "pair not active" on a write: the SDK's own text names the main by its 0x address. */
const PAUSED_TEXT = "Trading on this main is paused: new loans, top-ups, extensions and partial sells wait until it reopens. Repaying still works.";

const HUB_TEXT: Record<string, string> = {
  ...EXTEND_TEXT,
  "pair not active": PAUSED_TEXT,
  "Open loan: increase it": "This wallet already has an open loan on this token: add to it with increase_loan (its loan_id is in get_loans).",
  "No stable received": "The fees would take the whole value: borrow for fewer days or against more tokens. Check quote_loan.",
  "Ecosystem inactive": "Loans aren't open on this main right now.",
  "Unauthorized caller": "New loans aren't open on this main right now.",
  "Not an Ecosystem token": "That isn't a BASIS token, so it can't be borrowed against.",
  "Core loan inactive": "This loan is already closed (repaid, sold or liquidated).",
  "Loan not active": "This loan is already closed (repaid, sold or liquidated).",
  "Duration too short": "The loan needs more than the minimum loan length left before you can add to it: extend it first with extend_loan.",
  "No borrowing power": "Adding that much adds no borrowing power: the collateral would still be worth no more than what you owe. Check quote_increase_loan.",
  "Fees exceed value": "The fees for the days left would take all of the added value. Add more, or check quote_increase_loan.",
  "No swap for ecosystem": "That isn't available on this main.",
  "no executor": "Paying with another token isn't available on this main: repay in the pair asset.",
  "no route": "There's no route from that token to the pair asset: repay in the pair asset, or pay with a token get_swap_routes lists. Nothing was sent.",
  "above cap": "The conversion can't take that much right now: wait a few seconds and try again, repay part of it, or repay in the pair asset.",
  "Not enough to close": 'That amount converts to less than what you owe. Pass amount: "all" to size it to repay everything.',
  quote: "The conversion couldn't be sized to repay everything right now: pass an amount of that token, or repay in the pair asset.",
  "Loan is still active": "This loan is still open, so there is nothing to claim. Repay it by the end date to get your collateral back.",
  "Nothing to claim":
    "Nothing to claim on this loan: it wasn't liquidated, the leftover was already claimed, or it went unclaimed for more than a year after the liquidation.",
};

const VAULT_TEXT: Record<string, string> = {
  ...EXTEND_TEXT,
  "pair not active": PAUSED_TEXT,
  "Main not on this vault": "This main has no vault to stake in.",
  "Position active. Use addToLoan": "This vault position already has a loan: add to it with vault_add_to_loan.",
  "Hook not registered": "Borrowing isn't available on this vault right now.",
  "Contract low on liquidity": "The vault doesn't have that much free to pledge right now: try a smaller amount.",
  "Ecosystem inactive": "Loans aren't open on this main right now.",
  "Unauthorized caller": "New loans aren't open on this vault right now.",
  "No stable received": "The fees would take the whole value: borrow for fewer days or against more stake. Check vault_quote_borrow.",
  "No active loan": "This vault position has no loan (borrow with vault_borrow).",
  "Core loan inactive": "This vault loan is already closed.",
  "Loan not active": "This vault loan is already closed.",
  "Duration too short": "Not enough days left on the loan to add to it: extend it first with vault_extend_loan.",
  "No borrowing power": "Adding that much adds no borrowing power. Check vault_quote_add_to_loan.",
  "Fees exceed value": "The fees for the days left would take all of the added value. Check vault_quote_add_to_loan.",
  "unknown pair": "Trading on this main is paused, so the vault can't sell it now: unstake without to_pair_asset to get the main back 1:1.",
  "Only STAKING": "This stake can't be sold from its vault: unstake without to_pair_asset.",
};

/** Quote refusals whose write-side message is already plain (writes keep the SDK's exact figures). */
const QUOTE_TEXT: Record<string, string> = {
  "incorrect loan duration": "The days are outside this main's loan range (see get_loan_terms).",
  "Minimum loan amount not met": "The collateral is worth less than the minimum loan (see get_loan_terms).",
  "cannot be zero": "The amount must be more than 0.",
  "Zero amount": "The amount must be more than 0.",
  "pair asset paused": "The pair asset of this main (e.g. USDG) is paused by its issuer right now, so no loan can pay it out. Try again once it resumes.",
};

/** Vault refusals that need the position's figures to explain. */
function vaultHints(client: BasisClient, info: MainInfo, who: Address | undefined): Record<string, Hint> {
  const opts = { main: info.main };
  return {
    ...VAULT_TEXT,
    "Insufficient collateral value": async () => `Only ${show(await client.vault.getAvailableStasis(who, opts))} of the stake can still be borrowed against.`,
    "Insufficient stake": async () => `This wallet has ${show((await client.vault.getPosition(who, opts)).staked)} staked on this main.`,
    "Collateral in use": async () =>
      `Only ${show((await client.vault.getPosition(who, opts)).freeToUnstake)} can be unstaked now: the rest backs your vault loan (repay it with vault_repay first).`,
    "Below min stake": async () => `The minimum stake is ${show(await client.vault.getMinStake(opts))}.`,
    "Minimum loan amount not met": async () =>
      `The pledge is worth less than the minimum loan of ${show((await client.loans.getLoanTerms(info.main)).minimumLoan)}: pledge more.`,
  };
}

const BLOCK_TEXT: Record<LiquidationBlock, string> = {
  "no liquidator": "Liquidations aren't set up on this main yet.",
  "pair not active": "Trading on this main is paused: nothing on it is liquidated until it reopens. You can still repay, but not extend.",
  "pair asset paused": "The pair asset's issuer has paused it: nothing on this main is liquidated, and you can't repay or extend, until it resumes.",
};

const loanIdParam = () => p.id("Loan id (from get_loans).");

/** A vault write's main: required, never the default main (each main has its own vault, stake and vault loan). */
const vaultMainParam = () =>
  z
    .string()
    .min(1)
    .describe(
      "The main whose vault this is: key (e.g. stasis-usdg), address or symbol (e.g. STASIS). Required: each main has its own vault, stake and vault loan. get_mains lists the mains.",
    );

async function vaultMain(client: BasisClient, main: string): Promise<MainInfo> {
  if (!main.trim()) {
    throw new ValidationError("main", "Pass main (the main whose vault this is): each main has its own vault, stake and vault loan. get_mains lists the mains.");
  }
  return resolveMain(client, main);
}

const LEVERAGE_MAIN_TEXT =
  "Pass main (the main the position is on): position ids are per main. get_leverage_positions shows each position's main.";

const sellPercentParam = () =>
  z.number().int().min(10).max(100).multipleOf(10).describe("Percent of the collateral to sell: 10, 20, ... 100. 100 closes the loan.");


/** take_loan's figures for `raw` of `token` over `days`, checked as take_loan checks them (the balance included). */
async function loanPreview(client: BasisClient, token: Address, raw: bigint, days: number, who: Address | undefined): Promise<Record<string, unknown>> {
  const [q, meta, now, short] = await Promise.all([
    guided(client, () => client.loans.quoteLoan(token, raw, days, who), HUB_TEXT),
    client.mains.tokenMeta(token),
    chainNow(client),
    shortOf(client, token, who, raw),
  ]);
  const end = iso(now + BigInt(days) * DAY);
  return {
    possible: q.possible && short === null,
    whyNot: (await explain({ ...QUOTE_TEXT, ...HUB_TEXT }, q.refusal)) ?? short,
    collateral: `${formatUnits(raw, meta.decimals)} ${meta.symbol}`,
    collateralValue: q.collateralValue,
    fee: q.fee,
    feePercentOfValue: shareOf(q.fee.raw, q.collateralValue.raw),
    youReceive: q.borrowed,
    youWillOwe: q.collateralValue,
    meetsMinimum: q.meetsMinimum,
    endDateIfTakenNow: end,
    atTheEnd: hubEndText(q.collateralValue, end, meta.symbol),
  };
}

/** increase_loan's figures for adding `raw` collateral to loan `id` (details `d`), checked as increase_loan checks them. */
async function increasePreview(client: BasisClient, id: bigint, d: HubLoanDetails, raw: bigint, who: Address): Promise<Record<string, unknown>> {
  const [q, u, short] = await Promise.all([
    guided(client, () => client.loans.quoteIncreaseLoan(id, raw, who), HUB_TEXT),
    unitsOf(client, d.ecosystem, d.collateralToken),
    shortOf(client, d.collateralToken, who, raw),
  ]);
  const owedAfter = u.pair(d.fullAmount + q.addedValue);
  const end = iso(d.liquidationTime);
  return {
    loanId: id,
    possible: q.possible && short === null,
    whyNot: (await explain({ ...QUOTE_TEXT, ...HUB_TEXT }, q.refusal)) ?? short,
    collateralAdded: u.col(raw),
    addedToWhatYouOwe: u.pair(q.addedValue),
    fee: u.pair(q.fee),
    youReceive: u.pair(q.borrowed),
    owedAfter,
    daysLeft: q.daysLeft,
    endDate: end,
    atTheEnd: hubEndText(owedAfter, end, u.colSymbol),
  };
}

/** vault_borrow's figures for pledging `raw` of the stake over `days`, checked as vault_borrow checks them. */
async function vaultBorrowPreview(client: BasisClient, info: MainInfo, raw: bigint, days: number, who: Address): Promise<Record<string, unknown>> {
  const hints = vaultHints(client, info, who);
  const [q, now] = await Promise.all([
    guided(client, () => client.vault.quoteBorrow(raw, days, { main: info.main, user: who }), hints),
    chainNow(client),
  ]);
  const end = iso(now + BigInt(days) * DAY);
  return {
    possible: q.possible,
    whyNot: await explain({ ...QUOTE_TEXT, ...hints }, q.refusal),
    stakePledged: mainAmount(raw, info),
    pledgeValue: q.collateralValue,
    fee: q.fee,
    feePercentOfValue: shareOf(q.fee.raw, q.collateralValue.raw),
    youReceive: q.borrowed,
    youWillOwe: q.collateralValue,
    meetsMinimum: q.meetsMinimum,
    endDateIfTakenNow: end,
    atTheEnd: vaultEndText(q.collateralValue, end),
  };
}

/** vault_add_to_loan's figures for pledging `raw` more of the stake, checked as vault_add_to_loan checks them. */
async function vaultAddPreview(client: BasisClient, info: MainInfo, raw: bigint, who: Address): Promise<Record<string, unknown>> {
  const hints = vaultHints(client, info, who);
  const [q, loan] = await Promise.all([
    guided(client, () => client.vault.quoteAddToLoan(raw, { main: info.main, user: who }), hints),
    client.vault.getVaultLoan(who, { main: info.main }),
  ]);
  const out: Record<string, unknown> = {
    loanId: q.hubId,
    possible: q.possible,
    whyNot: await explain({ ...QUOTE_TEXT, ...hints }, q.refusal),
    morePledged: mainAmount(raw, info),
    addedToWhatYouOwe: q.addedValue,
    fee: q.fee,
    youReceive: q.borrowed,
    valueOfWholePledgeAfter: q.newCollateralValue,
    daysLeft: q.daysLeft,
  };
  if (loan) {
    const owedAfter = pairAmount(loan.fullAmount.raw + q.addedValue.raw, info);
    const end = iso(loan.liquidationTime);
    out.owedNow = loan.fullAmount;
    out.owedAfter = owedAfter;
    out.endDate = end;
    out.atTheEnd = vaultEndText(owedAfter, end);
  }
  return out;
}


export const loansTools: ToolDef[] = [

  tool({
    name: "get_loan_terms",
    toolset: "loans",
    title: "Loan terms",
    description:
      "A main's loan settings, for loans and vault loans: the day range, the minimum loan, and the opening and daily fee " +
      "rates as the chain has them now. quote_loan and vault_quote_borrow give the exact figures for an amount.",
    input: { main: p.main() },
    run: async ({ main }, ctx) => {
      const client = await ctx.client();
      const info = await resolveMain(client, main);
      const t = await client.loans.getLoanTerms(info.main);
      return {
        main: info.symbol,
        pairAsset: info.pairSymbol,
        minDays: t.minDays,
        maxDays: t.maxDays,
        minimumLoan: t.minimumLoan,
        openingFee: `${percent(t.staticFeeBps)} of the collateral value`,
        dailyFee: `${Number(t.dynamicFeePercentage) / 1000}% of the collateral value per day`,
        howItWorks:
          "Loans are made by the protocol. You owe the collateral value and receive it minus both fees. Repay by the end " +
          "date to get the collateral back; after it the loan can be liquidated.",
      };
    },
  }),

  tool({
    name: "quote_loan",
    toolset: "loans",
    title: "Preview a loan",
    description:
      "Preview take_loan: what the collateral is worth (what you will owe), the fee, what you receive in the pair asset of " +
      "the token's main (e.g. USDG), the end date, and whether it would go through now (the wallet's balance included). " +
      "take_loan without confirm: true shows the same preview for this server's wallet.",
    input: {
      token: p.token("Collateral: a main (e.g. STASIS) by symbol or address, or a token on a main by 0x address."),
      amount: p.amount("Collateral to borrow against, in tokens."),
      days: p.days("Loan length in days (the range is in get_loan_terms)."),
      wallet: p.wallet("Wallet that would borrow (checks its balance and that it has no open loan on this token). Default: this server's wallet."),
    },
    run: async ({ token, amount, days, wallet }, ctx) => {
      const client = await ctx.client();
      const t = await resolveToken(client, token);
      const raw = await toTokenRaw(client, t, amount);
      const who = wallet ? addr(wallet, "wallet") : client.account;
      return loanPreview(client, t, raw, days, who);
    },
  }),

  tool({
    name: "get_loans",
    toolset: "loans",
    title: "Loans",
    description:
      "The wallet's loans, newest first, a page at a time: status, collateral, what is owed, the end date and any " +
      "leftover to claim. Repay by the end date to get the collateral back. get_loan shows one in full; vault loans are " +
      "in vault_get_position, vesting loans in get_vesting_details.",
    input: {
      wallet: p.wallet(),
      active_only: p.bool("Only open loans. Default false (closed and liquidated ones too)."),
      limit: p.limit(100, 20),
      page: p.page(),
    },
    run: async ({ wallet, active_only, limit, page }, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, wallet);
      const [rows, now] = await Promise.all([client.loans.getUserLoans(who, { activeOnly: active_only ?? false }), chainNow(client)]);
      const size = limit ?? 20;
      const pageNo = page ?? 1;
      const from = (pageNo - 1) * size;
      const picked = rows.slice().reverse().slice(from, from + size);
      const cache = new Map<string, Promise<Units>>();
      const units = (main: Address, token: Address) => {
        const k = `${main}:${token}`.toLowerCase();
        let u = cache.get(k);
        if (!u) {
          u = unitsOf(client, main, token);
          cache.set(k, u);
        }
        return u;
      };
      const loans: Record<string, unknown>[] = [];
      for (const r of picked) loans.push(loanView(r, await units(r.ecosystem, r.collateralToken), now, r.timeOfClosure));
      return {
        wallet: who,
        total: rows.length,
        page: pageNo,
        shown: loans.length,
        hasMore: from + size < rows.length,
        statusMeaning: STATUS_MEANING,
        loans,
      };
    },
  }),

  tool({
    name: "get_loan",
    toolset: "loans",
    title: "Loan",
    description:
      "One loan in full: status, collateral, what is owed, the end date and what happens at it, the largest partial " +
      "repay, and any leftover to claim after a liquidation. get_loans lists them all; get_liquidation_status says " +
      "whether it can be liquidated right now.",
    input: { loan_id: loanIdParam(), wallet: p.wallet() },
    run: async ({ loan_id, wallet }, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, wallet);
      const id = uint(loan_id, "loan_id");
      const d = await hubLoan(client, who, id);
      const [u, now, core] = await Promise.all([
        unitsOf(client, d.ecosystem, d.collateralToken),
        chainNow(client),
        d.active ? Promise.resolve(null) : client.loans.getCoreLoan(who, id),
      ]);
      const v = loanView(d, u, now, core?.timeOfClosure ?? 0n);
      const status = v.status as StatusCode;
      v.wallet = who;
      v.note = STATUS_MEANING[status];
      if (d.active) {
        const pv = await client.loans.getRepayPreview(id, undefined, who);
        v.atTheEnd = hubEndText(u.pair(d.fullAmount), iso(d.liquidationTime), u.colSymbol);
        v.largestPartialRepay = u.pair(pv.maxPartial);
        v.minimumLeftOwedAfterPartialRepay = u.pair(pv.minimumLoan);
      }
      return v;
    },
  }),

  tool({
    name: "quote_repay_loan",
    toolset: "loans",
    title: "Preview a repay",
    description:
      "Preview repay_loan: what it takes, the collateral you get back and what is left owed. Without pay_with the amount " +
      "is in the pair asset of the loan's main (e.g. USDG); with pay_with it is in that token, converted on the way.",
    input: {
      loan_id: loanIdParam(),
      amount: p.optAmount(
        'Amount to repay, or "all". Default: everything owed (with pay_with: the amount of that token that repays everything).',
      ),
      pay_with: z.string().optional().describe("The token you pay with, instead of the pair asset: symbol of a main or pair asset, or 0x address."),
      wallet: p.wallet(),
    },
    run: async ({ loan_id, amount, pay_with, wallet }, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, wallet);
      const id = uint(loan_id, "loan_id");
      const d = await hubLoan(client, who, id);
      const u = await unitsOf(client, d.ecosystem, d.collateralToken);
      const everything = amount === undefined || isAll(amount);
      if (!pay_with) {
        const raw = everything ? undefined : notZero(toPairRaw(u.info, amount as string | number));
        const pv = await client.loans.getRepayPreview(id, raw, who);
        return {
          loanId: id,
          possible: pv.allowed,
          whyNot: !pv.active
            ? HUB_TEXT["Core loan inactive"]
            : pv.allowed
              ? null
              : pv.maxPartial === 0n
                ? `What you owe (${show(u.pair(pv.debt))}) is at the minimum loan, so it can only be repaid in full ("all").`
                : `That would leave ${show(u.pair(pv.debtLeft))} owed, under the minimum loan of ${show(u.pair(pv.minimumLoan))}. Repay at most ${show(u.pair(pv.maxPartial))}, or "all".`,
          owedNow: u.pair(pv.debt),
          youPay: u.pair(pv.amount),
          closesLoan: pv.full,
          collateralBack: u.col(pv.collateralReleased),
          collateralLeft: u.col(pv.collateralLeft),
          owedAfter: u.pair(pv.debtLeft),
          largestPartialRepay: u.pair(pv.maxPartial),
        };
      }
      const tokenIn = await resolveToken(client, pay_with, "pay_with");
      const rawIn = everything ? undefined : notZero(await toTokenRaw(client, tokenIn, amount as string | number));
      const q = await guided(client, () => client.loans.quoteRepayLoanWith(id, tokenIn, { amountIn: rawIn, user: who }), HUB_TEXT);
      const inAmt = await tokenUnits(client, tokenIn);
      return {
        loanId: id,
        owedNow: u.pair(q.debt),
        youPay: inAmt(q.amountIn),
        convertsTo: u.pair(q.stableOut),
        closesLoan: q.covers,
        refund: u.pair(q.refund),
        collateralBack: u.col(q.collateralReleased),
        note: "The conversion price can move before you send: repay_loan sets a minimum from your slippage.",
      };
    },
  }),


  tool({
    name: "take_loan",
    toolset: "loans",
    title: "Take a loan",
    description:
      "Borrow the pair asset of the token's main (e.g. USDG) against a main or a token you hold, for a number of days. " +
      "Loans are made by the protocol: repay by the end date to get your tokens back; after it the loan can be liquidated " +
      "and only a leftover comes back (claim_loan_leftover). One open loan per token (add with increase_loan). Without " +
      "confirm: true it only shows the preview (what you receive, the fee, what you owe and by when), as quote_loan does.",
    input: {
      token: p.token("Collateral: a main (e.g. STASIS) by symbol or address, or a token on a main by 0x address."),
      amount: p.amount("Collateral to borrow against, in tokens."),
      days: p.days("Loan length in days (the range is in get_loan_terms)."),
      confirm: p.confirm(),
    },
    write: true,
    run: async ({ token, amount, days, confirm }, ctx) => {
      const client = await ctx.client();
      const me = walletOrSelf(client);
      const t = await resolveToken(client, token);
      const raw = await toTokenRaw(client, t, amount);
      if (confirm !== true) return preview(await loanPreview(client, t, raw, days, me));
      const r = await guided(client, () => client.loans.takeLoan(t, raw, days), HUB_TEXT);
      const { coreLoanId: _core, hubId, ...rest } = r;
      const extra: Record<string, unknown> = { loanId: hubId };
      if (hubId !== null) {
        try {
          const d = await client.loans.getUserLoanDetails(me, hubId);
          const u = await unitsOf(client, d.ecosystem, d.collateralToken);
          extra.owed = u.pair(d.fullAmount);
          extra.endDate = iso(d.liquidationTime);
          extra.atTheEnd = hubEndText(u.pair(d.fullAmount), iso(d.liquidationTime), u.colSymbol);
        } catch {
          extra.endDate = "Check it with get_loan.";
        }
      }
      return txOut(client, rest, extra);
    },
  }),

  tool({
    name: "repay_loan",
    toolset: "loans",
    title: "Repay a loan",
    description:
      "Repay a loan, in full or in part, in the pair asset of its main (e.g. USDG): in full it closes the loan and returns " +
      "all the collateral, a part returns the same share. With pay_with you pay in another token, which is sold for the " +
      'pair asset on the way (amount in that token; "all" sizes it to repay everything, any extra is refunded). Preview ' +
      "with quote_repay_loan. For a vault loan use vault_repay, for a loan on a vesting repay_loan_on_vesting.",
    input: {
      loan_id: loanIdParam(),
      amount: p.amount('Amount to repay, or "all" for everything owed. Without pay_with it is in the pair asset; with pay_with, in that token.'),
      pay_with: z.string().optional().describe("The token you pay with, instead of the pair asset: symbol of a main or pair asset, or 0x address. It is sold on the way."),
      slippage_percent: p.slippage(),
    },
    write: true,
    destructive: true,
    run: async ({ loan_id, amount, pay_with, slippage_percent }, ctx) => {
      const client = await ctx.client();
      const me = walletOrSelf(client);
      const id = uint(loan_id, "loan_id");
      const d = await hubLoan(client, me, id);
      const u = await unitsOf(client, d.ecosystem, d.collateralToken);
      const everything = isAll(amount);
      if (!pay_with) {
        const raw = everything ? undefined : notZero(toPairRaw(u.info, amount));
        const r = await guided(client, () => client.loans.repayLoan(id, { amount: raw }), {
          ...HUB_TEXT,
          "Repay in full": async () => {
            const pv = await client.loans.getRepayPreview(id, raw, me);
            if (pv.maxPartial === 0n) return `What you owe (${show(u.pair(pv.debt))}) is at the minimum loan, so it can only be repaid in full: pass amount "all".`;
            return (
              `That would leave ${show(u.pair(pv.debtLeft))} owed, under the minimum loan of ${show(u.pair(pv.minimumLoan))}. ` +
              `Repay at most ${show(u.pair(pv.maxPartial))}, or pass amount "all" to repay everything (${show(u.pair(pv.debt))}).`
            );
          },
        });
        return txOut(client, r);
      }
      const tokenIn = await resolveToken(client, pay_with, "pay_with");
      const rawIn = everything ? undefined : notZero(await toTokenRaw(client, tokenIn, amount));
      const r = await guided(
        client,
        () => client.loans.repayLoanWith(id, tokenIn, { amountIn: rawIn, slippageBps: slippageToBps(slippage_percent) }),
        {
          ...HUB_TEXT,
          "Repay in full":
            'Converted, that amount could leave less than the minimum loan owed. Pay a smaller amount, or pass amount "all" to repay everything (the extra is refunded).',
        },
      );
      return txOut(client, r);
    },
  }),

  tool({
    name: "quote_extend_loan",
    toolset: "loans",
    title: "Preview a loan extension",
    description:
      "Preview extend_loan: the fee in the pair asset of the loan's main, how it is paid, the new end date and, for a " +
      "refinance, what you receive.",
    input: {
      loan_id: loanIdParam(),
      days: z.number().int().min(0).describe("Days to add (the range is in get_loan_terms). 0 only with fee_from: refinance."),
      fee_from: feeFromParam(),
      wallet: p.wallet(),
    },
    run: async ({ loan_id, days, fee_from, wallet }, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, wallet);
      const id = uint(loan_id, "loan_id");
      const d = await hubLoan(client, who, id);
      const { pay, refi } = feeMode(fee_from);
      const [q, u, now] = await Promise.all([
        client.loans.getExtensionQuote(id, days, pay, refi, who),
        unitsOf(client, d.ecosystem, d.collateralToken),
        chainNow(client),
      ]);
      const from = d.liquidationTime > now ? d.liquidationTime : now;
      const out: Record<string, unknown> = {
        loanId: id,
        possible: q.possible,
        fee: u.pair(q.fee),
        feePaid: FEE_PAID[fee_from ?? "wallet"],
        owedNow: u.pair(d.fullAmount),
        currentEndDate: iso(d.liquidationTime),
        newEndDate: iso(from + BigInt(days) * DAY),
      };
      if (refi) out.youReceive = u.pair(q.extraOut);
      if (!q.possible) {
        out.whyNot = !d.active
          ? HUB_TEXT["Loan not active"]
          : "Not possible with these settings now: try fee_from wallet, or a day count in the range from get_loan_terms (trading on this main or its pair asset may also be paused). extend_loan gives the exact reason.";
      }
      return out;
    },
  }),

  tool({
    name: "extend_loan",
    toolset: "loans",
    title: "Extend a loan",
    description:
      "Add days to a loan: from its end date, or from now when it is past the end date and not yet liquidated. The fee " +
      "is paid from the wallet (default), added to what you owe, or taken from a refinance. Preview with quote_extend_loan.",
    input: {
      loan_id: loanIdParam(),
      days: z.number().int().min(0).describe("Days to add (the range is in get_loan_terms). 0 only with fee_from: refinance."),
      fee_from: feeFromParam(),
    },
    write: true,
    run: async ({ loan_id, days, fee_from }, ctx) => {
      const client = await ctx.client();
      const id = uint(loan_id, "loan_id");
      const { pay, refi } = feeMode(fee_from);
      const r = await guided(client, () => client.loans.extendLoan(id, days, pay, refi), HUB_TEXT);
      const { newLiquidationTime, ...rest } = r;
      return txOut(client, rest, { newEndDate: iso(newLiquidationTime) });
    },
  }),

  tool({
    name: "quote_increase_loan",
    toolset: "loans",
    title: "Preview adding to a loan",
    description:
      "Preview increase_loan: what adding collateral adds to what you owe, the fee for the days left, what you " +
      "receive in the pair asset, and whether it would go through now (the wallet's balance included). The end date " +
      "stays. increase_loan without confirm: true shows the same preview for this server's wallet.",
    input: {
      loan_id: loanIdParam(),
      amount: p.amount("Collateral to add, in tokens of the loan's collateral."),
      wallet: p.wallet(),
    },
    run: async ({ loan_id, amount, wallet }, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, wallet);
      const id = uint(loan_id, "loan_id");
      const d = await hubLoan(client, who, id);
      const raw = await toTokenRaw(client, d.collateralToken, amount);
      return increasePreview(client, id, d, raw, who);
    },
  }),

  tool({
    name: "increase_loan",
    toolset: "loans",
    title: "Add to a loan",
    description:
      "Add more of a loan's collateral token and borrow the added value in the pair asset, minus the fees for the days " +
      "left. The end date stays, and the loan needs more than the minimum loan length left. Repay by the end date to get " +
      "all the collateral back; after it the loan can be liquidated. Without confirm: true it only shows the preview " +
      "(what you receive, the fee, what you will owe), as quote_increase_loan does.",
    input: {
      loan_id: loanIdParam(),
      amount: p.amount("Collateral to add, in tokens of the loan's collateral."),
      confirm: p.confirm(),
    },
    write: true,
    run: async ({ loan_id, amount, confirm }, ctx) => {
      const client = await ctx.client();
      const me = walletOrSelf(client);
      const id = uint(loan_id, "loan_id");
      const d = await hubLoan(client, me, id);
      const raw = await toTokenRaw(client, d.collateralToken, amount);
      if (confirm !== true) return preview(await increasePreview(client, id, d, raw, me));
      return txOut(client, await guided(client, () => client.loans.increaseLoan(id, raw), HUB_TEXT));
    },
  }),

  tool({
    name: "quote_partial_loan_sell",
    toolset: "loans",
    title: "Preview selling loan collateral",
    description:
      "Preview partial_loan_sell: the collateral sold, the debt it clears, your sell fee and what you receive in the pair " +
      "asset of the loan's main, and what is left of the loan.",
    input: {
      loan_id: loanIdParam(),
      percent: sellPercentParam(),
      wallet: p.wallet(),
    },
    run: async ({ loan_id, percent: pct, wallet }, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, wallet);
      const id = uint(loan_id, "loan_id");
      const d = await hubLoan(client, who, id);
      const u = await unitsOf(client, d.ecosystem, d.collateralToken);
      const q = await guided(client, () => client.loans.quotePartialSellLoan(id, pct, who), HUB_TEXT);
      return {
        loanId: id,
        percent: pct,
        collateralSold: u.col(q.collateralSold),
        debtCleared: u.pair(q.debtRepaid),
        saleValue: u.pair(q.gross),
        sellFee: u.pair(q.fee),
        sellFeePercent: percent(q.taxBps),
        youReceive: u.pair(q.net),
        collateralLeft: u.col(d.collateralAmount - q.collateralSold),
        owedAfter: u.pair(d.fullAmount - q.debtRepaid),
        closesLoan: pct === 100,
        note: "Exact when the collateral is a main or a Stable+ token; for other tokens the payout can come out a little higher, never lower.",
      };
    },
  }),

  tool({
    name: "partial_loan_sell",
    toolset: "loans",
    title: "Sell part of a loan's collateral",
    description:
      "Sell 10 to 100% (steps of 10) of a loan's collateral: the same share of what you owe is cleared and the rest of " +
      "the sale is paid to you in the pair asset, after your sell fee. 100% closes the loan. Preview with quote_partial_loan_sell.",
    input: {
      loan_id: loanIdParam(),
      percent: sellPercentParam(),
      slippage_percent: p.slippage(),
    },
    write: true,
    destructive: true,
    run: async ({ loan_id, percent: pct, slippage_percent }, ctx) => {
      const client = await ctx.client();
      const id = uint(loan_id, "loan_id");
      const r = await guided(
        client,
        () => client.loans.partialSellLoan(id, pct, { slippageBps: slippageToBps(slippage_percent) }),
        HUB_TEXT,
      );
      return txOut(client, r);
    },
  }),

  tool({
    name: "claim_loan_leftover",
    toolset: "loans",
    title: "Claim a loan leftover",
    description:
      "After a loan from get_loans was liquidated, claim the collateral left over (paid in the collateral token). Claim " +
      "within a year of the liquidation: after that it can be lost. get_loans shows what is left on each loan. Not for " +
      "other loans: a vesting loan's leftover goes back to the vesting with repay_loan_on_vesting, a vault loan leaves " +
      "nothing to claim, and a leverage position's leftover is claimed with claim_leverage_leftover.",
    input: { loan_id: loanIdParam() },
    write: true,
    run: async ({ loan_id }, ctx) => {
      const client = await ctx.client();
      const id = uint(loan_id, "loan_id");
      return txOut(client, await guided(client, () => client.loans.claimLiquidation(id), HUB_TEXT));
    },
  }),


  tool({
    name: "get_liquidation_status",
    toolset: "loans",
    title: "Liquidation status",
    description:
      "Whether a loan can be liquidated right now (past its end date, and nothing paused on its main) and, after a " +
      "liquidation, what is left to claim and by when. For a loan (loan_id), a vault loan (main) or a leverage position " +
      "(main and loan_id). A loan on a vesting is in get_vesting_details.",
    input: {
      kind: z
        .enum(["loan", "vault", "leverage"])
        .optional()
        .describe("loan (default): a loan from get_loans. vault: the wallet's vault loan on a main. leverage: a leverage position."),
      loan_id: p.optId("Loan id from get_loans (kind loan), or the leverage position id (kind leverage)."),
      main: p.main(
        "Main of the vault loan or leverage position: key, address or symbol (e.g. STASIS). Required for kind leverage (position ids are per main); for kind vault the default main when left out. Not needed for kind loan.",
      ),
      wallet: p.wallet(),
    },
    run: async ({ kind, loan_id, main, wallet }, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, wallet);
      const k = kind ?? "loan";
      const isLeverage = k === "leverage";
      let mainAddr: Address;
      let user: Address;
      let id: bigint;
      let shownId: bigint;
      if (k === "vault") {
        const info = await resolveMain(client, main);
        const l = await client.vault.getVaultLoan(who, { main: info.main });
        if (!l) return { kind: k, wallet: who, main: info.symbol, hasLoan: false, note: "This wallet has no vault loan on this main." };
        mainAddr = l.ecosystem;
        user = l.hub;
        id = l.coreLoanId;
        shownId = l.hubId;
      } else {
        if (isLeverage && (!main || !main.trim())) throw new ValidationError("main", LEVERAGE_MAIN_TEXT);
        if (loan_id === undefined) throw new ValidationError("loan_id", `Pass loan_id (${isLeverage ? "the leverage position id" : "from get_loans"}).`);
        shownId = uint(loan_id, "loan_id");
        if (isLeverage) {
          mainAddr = (await resolveMain(client, main)).main;
          user = who;
          id = shownId;
        } else {
          const d = await hubLoan(client, who, shownId);
          mainAddr = d.ecosystem;
          user = client.addresses.loanHub;
          id = d.coreLoanId;
        }
      }
      const [loan, claim, blocked, now] = await Promise.all([
        client.liquidation.getLoan(mainAddr, user, id, isLeverage),
        client.liquidation.getClaimStatus(mainAddr, user, id, isLeverage),
        client.liquidation.getLiquidationBlock(mainAddr),
        chainNow(client),
      ]);
      if (eq(loan.token, zeroAddress)) {
        throw new ValidationError("loan_id", `No leverage position ${shownId} for this wallet on this main.`);
      }
      const u = await unitsOf(client, mainAddr, loan.token);
      const past = loan.liquidationTime < now;
      const out: Record<string, unknown> = {
        kind: k,
        wallet: who,
        loanId: shownId,
        main: u.info.symbol,
        status: statusOf(loan, now),
        endDate: iso(loan.liquidationTime),
      };
      if (loan.active) {
        out.owed = u.pair(loan.fullAmount);
        out.collateral = u.col(loan.collateralAmount);
        out.pastEndDate = past;
        out.canBeLiquidatedNow = past && blocked === null;
        out.timeLeft = past ? "none, past the end date" : span(loan.liquidationTime - now);
      }
      out.liquidationsPaused = blocked ? BLOCK_TEXT[blocked] : null;
      if (claim.isLiquidated) {
        out.liquidatedAt = iso(claim.liquidatedAt);
        out.leftoverToClaim = u.col(claim.claimable);
        if (claim.claimable > 0n) {
          out.claimBy = iso(claim.claimDeadline);
          out.claimDatePassed = claim.claimExpired;
        }
        out.howToClaim =
          k === "vault"
            ? "Nothing to claim: a vault liquidation is settled into the stake in the same transaction."
            : isLeverage
              ? "claim_leverage_leftover"
              : "claim_loan_leftover";
      }
      return out;
    },
  }),


  tool({
    name: "vault_get_position",
    toolset: "loans",
    title: "Vault position",
    description:
      "A wallet's vault stake: staked, unclaimed rewards, what is free to unstake or borrow against, and its vault loan " +
      "(what is owed, the end date). Without main: every main where the wallet has a stake, rewards or a loan. " +
      "vault_get_rewards shows how much of the rewards can be claimed now.",
    input: {
      wallet: p.wallet(),
      main: p.main("Main: key, address or symbol (e.g. STASIS). Default: every main the wallet has a position on."),
    },
    run: async ({ wallet, main }, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, wallet);
      const [positions, now] = await Promise.all([
        main
          ? resolveMain(client, main).then(async (info) => [await client.vault.getPosition(who, { main: info.main })])
          : client.vault.getPositions(who),
        chainNow(client),
      ]);
      const out: Record<string, unknown>[] = [];
      for (const pos of positions) {
        const loan = pos.hasActiveLoan ? await client.vault.getVaultLoan(who, { main: pos.main }) : null;
        out.push({ ...positionView(pos), loan: loan ? vaultLoanView(loan, now) : null });
      }
      return out.length ? { wallet: who, positions: out } : { wallet: who, positions: out, note: "No stake, rewards or vault loan." };
    },
  }),

  tool({
    name: "vault_get_rewards",
    toolset: "loans",
    title: "Vault rewards",
    description:
      "A wallet's unclaimed vault rewards (paid in the main) and how much can be claimed now: with a vault loan open, the " +
      "part that backs the loan stays. Without main: every main with a position. The whole position is in vault_get_position.",
    input: {
      wallet: p.wallet(),
      main: p.main("Main: key, address or symbol (e.g. STASIS). Default: every main the wallet has a position on."),
    },
    run: async ({ wallet, main }, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, wallet);
      const positions = main
        ? [await client.vault.getPosition(who, { main: (await resolveMain(client, main)).main })]
        : await client.vault.getPositions(who);
      return {
        wallet: who,
        rewards: positions.map(rewardsView),
        howToClaim: "vault_claim_rewards pays them out; vault_compound adds them to the stake.",
      };
    },
  }),

  tool({
    name: "vault_get_info",
    toolset: "loans",
    title: "Vault",
    description:
      "A main's vault: total staked, how much backs loans, unclaimed rewards of all stakers, the minimum stake, and the " +
      "recent rewards the BASIS site reports (past figures, not a promise). The loan day range and fees are in get_loan_terms.",
    input: { main: p.main() },
    run: async ({ main }, ctx) => {
      const client = await ctx.client();
      const info = await resolveMain(client, main);
      const [t, min] = await Promise.all([client.vault.getVaultTotals({ main: info.main }), client.vault.getMinStake({ main: info.main })]);
      let recentRewards: unknown = null;
      try {
        const { data } = await client.api.getVaults({ main: info.key ?? info.main });
        const s = data.find((r) => eq(r.main, info.main)) ?? null;
        if (s) {
          recentRewards = {
            last7Days: `${formatUnits(BigInt(s.yield7d), 18)} ${info.symbol}`,
            last30Days: `${formatUnits(BigInt(s.yield30d), 18)} ${info.symbol}`,
            last7DaysInPairAsset: `${formatUnits(BigInt(s.yield7dPair), s.pairDecimals)} ${s.pairSymbol}`,
            yearlyRateFromRecentRewards: s.aprBps === null ? null : percent(s.aprBps),
          };
        }
      } catch (e) {
        recentRewards = `Not available right now (${errorText(e, explorerUrl(client))}).`;
      }
      return {
        main: info.symbol,
        totalStaked: t.totalStaked,
        pledgedToLoans: t.totalPledged,
        unclaimedRewardsAllStakers: t.rewardsHeld,
        freeToPledge: t.totalStasisAvailable,
        minimumStake: min,
        recentRewards,
      };
    },
  }),

  tool({
    name: "vault_quote_borrow",
    toolset: "loans",
    title: "Preview a vault loan",
    description:
      "Preview vault_borrow: what the pledged stake is worth (what you will owe), the fee, what you receive in the pair " +
      "asset (e.g. USDG), the end date, and whether it would go through now. vault_borrow without confirm: true shows " +
      "the same preview for this server's wallet.",
    input: {
      amount: p.amount("Staked main tokens to borrow against (e.g. STASIS)."),
      days: p.days("Loan length in days (the range is in get_loan_terms)."),
      main: p.main(),
      wallet: p.wallet(),
    },
    run: async ({ amount, days, main, wallet }, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, wallet);
      const info = await resolveMain(client, main);
      return vaultBorrowPreview(client, info, to18(amount), days, who);
    },
  }),

  tool({
    name: "vault_quote_add_to_loan",
    toolset: "loans",
    title: "Preview adding to a vault loan",
    description:
      "Preview vault_add_to_loan: what pledging more stake adds to what you owe, the fee for the days left, what you " +
      "receive in the pair asset, and what you will owe by the end date (it stays). vault_add_to_loan without confirm: " +
      "true shows the same preview for this server's wallet.",
    input: {
      amount: p.amount("More staked main tokens to pledge (e.g. STASIS)."),
      main: p.main(),
      wallet: p.wallet(),
    },
    run: async ({ amount, main, wallet }, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, wallet);
      const info = await resolveMain(client, main);
      return vaultAddPreview(client, info, to18(amount), who);
    },
  }),

  tool({
    name: "vault_quote_extend_loan",
    toolset: "loans",
    title: "Preview a vault loan extension",
    description:
      "Preview vault_extend_loan: the fee in the pair asset, how it is paid, the new end date and, for a refinance, what " +
      "you receive.",
    input: {
      days: z.number().int().min(0).describe("Days to add (the range is in get_loan_terms). 0 only with fee_from: refinance."),
      fee_from: feeFromParam(),
      main: p.main(),
      wallet: p.wallet(),
    },
    run: async ({ days, fee_from, main, wallet }, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, wallet);
      const info = await resolveMain(client, main);
      const { pay, refi } = feeMode(fee_from);
      const hints = vaultHints(client, info, who);
      const [q, loan, now] = await Promise.all([
        guided(client, () => client.vault.getExtensionQuote(days, pay, refi, { main: info.main, user: who }), hints),
        client.vault.getVaultLoan(who, { main: info.main }),
        chainNow(client),
      ]);
      const out: Record<string, unknown> = { possible: q.possible, fee: q.fee, feePaid: FEE_PAID[fee_from ?? "wallet"] };
      if (refi) out.youReceive = q.extraOut;
      if (loan) {
        const from = loan.liquidationTime > now ? loan.liquidationTime : now;
        out.loanId = loan.hubId;
        out.owedNow = loan.fullAmount;
        out.currentEndDate = iso(loan.liquidationTime);
        out.newEndDate = iso(from + BigInt(days) * DAY);
      }
      if (!q.possible) {
        out.whyNot =
          "Not possible with these settings now: try fee_from wallet, or a day count in the range from get_loan_terms (trading on this main or its pair asset may also be paused). vault_extend_loan gives the exact reason.";
      }
      return out;
    },
  }),


  tool({
    name: "vault_stake",
    toolset: "loans",
    title: "Stake in a vault",
    description:
      "Stake main tokens the wallet holds (e.g. STASIS) in that main's vault, 1:1. The stake earns vault rewards paid " +
      "in the main, and you can borrow against it with vault_borrow. The minimum stake is in vault_get_info.",
    input: { amount: p.amount("Main tokens to stake (e.g. STASIS)."), main: vaultMainParam() },
    write: true,
    run: async ({ amount, main }, ctx) => {
      const client = await ctx.client();
      const info = await vaultMain(client, main);
      const raw = to18(amount);
      await checkSpend(client, info.main, raw);
      return txOut(client, await guided(client, () => client.vault.stake(raw, { main: info.main }), vaultHints(client, info, client.account)));
    },
  }),

  tool({
    name: "vault_unstake",
    toolset: "loans",
    title: "Unstake from a vault",
    description:
      "Take main tokens out of the vault stake, 1:1, or sell them for the pair asset (to_pair_asset, at your own sell " +
      "fee). With a vault loan open, only the part not backing it is free. Rewards stay: claim them with vault_claim_rewards.",
    input: {
      amount: p.amount('Main tokens to unstake (e.g. STASIS), or "all" for everything free to unstake now.'),
      main: vaultMainParam(),
      to_pair_asset: p.bool("Sell the unstaked tokens and receive the pair asset (e.g. USDG). Default false: get the main back."),
      slippage_percent: p.slippage(),
    },
    write: true,
    destructive: true,
    run: async ({ amount, main, to_pair_asset, slippage_percent }, ctx) => {
      const client = await ctx.client();
      const me = walletOrSelf(client);
      const info = await vaultMain(client, main);
      let raw: bigint;
      if (isAll(amount)) {
        const pos = await client.vault.getPosition(me, { main: info.main });
        raw = pos.freeToUnstake.raw;
        if (raw === 0n) {
          throw new ValidationError(
            "amount",
            pos.staked.raw === 0n ? "Nothing is staked on this main." : "Nothing is free to unstake: the stake backs your vault loan (repay it with vault_repay first).",
          );
        }
      } else {
        raw = to18(amount);
      }
      const sell = to_pair_asset ?? false;
      const r = await guided(
        client,
        () => client.vault.unstake(raw, { main: info.main, toPairAsset: sell, slippageBps: sell ? slippageToBps(slippage_percent) : undefined }),
        vaultHints(client, info, me),
      );
      return txOut(client, r);
    },
  }),

  tool({
    name: "vault_claim_rewards",
    toolset: "loans",
    title: "Claim vault rewards",
    description:
      "Pay out the unclaimed vault rewards of a main's stake, in the main (e.g. STASIS). With a vault loan open, only the " +
      "part not backing the loan. vault_get_rewards shows how much.",
    input: { main: vaultMainParam() },
    write: true,
    run: async ({ main }, ctx) => {
      const client = await ctx.client();
      const info = await vaultMain(client, main);
      return txOut(client, await guided(client, () => client.vault.claim({ main: info.main }), VAULT_TEXT));
    },
  }),

  tool({
    name: "vault_compound",
    toolset: "loans",
    title: "Compound vault rewards",
    description: "Add the unclaimed vault rewards of a main's stake to the stake itself (nothing leaves the vault).",
    input: { main: vaultMainParam() },
    write: true,
    run: async ({ main }, ctx) => {
      const client = await ctx.client();
      const info = await vaultMain(client, main);
      return txOut(client, await guided(client, () => client.vault.compound({ main: info.main }), VAULT_TEXT));
    },
  }),

  tool({
    name: "vault_borrow",
    toolset: "loans",
    title: "Borrow against a vault stake",
    description:
      "Borrow the pair asset (e.g. USDG) against part of your vault stake for a number of days; the pledged stake keeps " +
      "earning. Loans are made by the protocol: repay by the end date (vault_repay) to free the stake; after it the loan " +
      "can be liquidated and the loss comes off your stake. One loan per position (add with vault_add_to_loan). Without " +
      "confirm: true it only shows the preview (what you receive, the fee, what you owe and by when), as vault_quote_borrow does.",
    input: {
      amount: p.amount("Staked main tokens to borrow against (e.g. STASIS)."),
      days: p.days("Loan length in days (the range is in get_loan_terms)."),
      main: vaultMainParam(),
      confirm: p.confirm(),
    },
    write: true,
    run: async ({ amount, days, main, confirm }, ctx) => {
      const client = await ctx.client();
      const me = walletOrSelf(client);
      const info = await vaultMain(client, main);
      const raw = to18(amount);
      if (confirm !== true) return preview(await vaultBorrowPreview(client, info, raw, days, me));
      const r = await guided(client, () => client.vault.borrow(raw, days, { main: info.main }), vaultHints(client, info, me));
      const { hub: _hub, hubId, ...rest } = r;
      const extra: Record<string, unknown> = { loanId: hubId };
      try {
        const loan = await client.vault.getVaultLoan(me, { main: info.main });
        if (loan) {
          extra.owed = loan.fullAmount;
          extra.endDate = iso(loan.liquidationTime);
          extra.atTheEnd = vaultEndText(loan.fullAmount, iso(loan.liquidationTime));
        }
      } catch {
        extra.endDate = "Check it with vault_get_position.";
      }
      return txOut(client, rest, extra);
    },
  }),

  tool({
    name: "vault_add_to_loan",
    toolset: "loans",
    title: "Add to a vault loan",
    description:
      "Pledge more of your vault stake to the open vault loan and receive the added value in the pair asset, minus the " +
      "fees for the days left. The end date stays: repay by then (vault_repay) to free the stake; after it the loan can " +
      "be liquidated and the loss comes off your stake. Without confirm: true it only shows the preview (what you " +
      "receive, the fee, what you will owe), as vault_quote_add_to_loan does.",
    input: { amount: p.amount("More staked main tokens to pledge (e.g. STASIS)."), main: vaultMainParam(), confirm: p.confirm() },
    write: true,
    run: async ({ amount, main, confirm }, ctx) => {
      const client = await ctx.client();
      const me = walletOrSelf(client);
      const info = await vaultMain(client, main);
      const raw = to18(amount);
      if (confirm !== true) return preview(await vaultAddPreview(client, info, raw, me));
      return txOut(client, await guided(client, () => client.vault.addToLoan(raw, { main: info.main }), vaultHints(client, info, me)));
    },
  }),

  tool({
    name: "vault_repay",
    toolset: "loans",
    title: "Repay a vault loan",
    description:
      "Repay the vault loan of a main in full, in its pair asset (e.g. USDG); this frees the pledged stake. There is no " +
      "partial repay for a vault loan. vault_get_position shows what is owed. Loans from get_loans are repaid with repay_loan.",
    input: { main: vaultMainParam() },
    write: true,
    run: async ({ main }, ctx) => {
      const client = await ctx.client();
      const info = await vaultMain(client, main);
      const r = await guided(client, () => client.vault.repay({ main: info.main }), VAULT_TEXT);
      const { hubId, ...rest } = r;
      return txOut(client, rest, { loanId: hubId });
    },
  }),

  tool({
    name: "vault_extend_loan",
    toolset: "loans",
    title: "Extend a vault loan",
    description:
      "Add days to the vault loan of a main: from its end date, or from now when it is past the end date and not yet " +
      "liquidated. The fee is paid from the wallet (default), added to what you owe, or taken from a refinance. Preview with vault_quote_extend_loan.",
    input: {
      days: z.number().int().min(0).describe("Days to add (the range is in get_loan_terms). 0 only with fee_from: refinance."),
      fee_from: feeFromParam(),
      main: vaultMainParam(),
    },
    write: true,
    run: async ({ days, fee_from, main }, ctx) => {
      const client = await ctx.client();
      const info = await vaultMain(client, main);
      const { pay, refi } = feeMode(fee_from);
      const r = await guided(client, () => client.vault.extendLoan(days, pay, refi, { main: info.main }), VAULT_TEXT);
      const { newLiquidationTime, ...rest } = r;
      return txOut(client, rest, { newEndDate: iso(newLiquidationTime) });
    },
  }),
];
