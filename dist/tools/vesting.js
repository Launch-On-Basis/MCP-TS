"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.vestingTools = void 0;
const zod_1 = require("zod");
const viem_1 = require("viem");
const basis_sdk_1 = require("basis-sdk");
const registry_js_1 = require("../registry.js");
const units_js_1 = require("../units.js");
const present_js_1 = require("../present.js");
const errors_js_1 = require("../errors.js");
const limits_js_1 = require("../limits.js");
const DAY = 86400n;
const RELEASE_STEPS = ["second", "minute", "hour", "day"];
const BATCH_MAX = 70;
const MS_GUESS = 10000000000n;
const NOT_SENT = "Nothing was sent. Call again with confirm: true to send.";
const REFUSED_NOW = "It would be refused now (see refusal). Nothing was sent.";
const CLAIM_MAX = 10;
const LIST_MAX = 50;
const DUST_USD_E18 = 10n ** 16n;
const PRICE_BATCH = 100;
const DUST_RULE = "Claimables worth under $0.01 are skipped (for a token with no price, under 0.0001 of one whole token): claiming " +
    "them costs more gas than they are worth, and anyone can create tiny vestings for any wallet. Pass vesting_id to claim one anyway.";
const DUST_RULE_NO_PRICES = "Claimable amounts under 0.0001 of one whole token are skipped: claiming them costs more gas than they are worth, " +
    "and anyone can create tiny vestings for any wallet. Pass vesting_id to claim one anyway.";
const NO_PRICES = "Dollar prices couldn't be read right now, so the vestings were ranked and skipped by token amount instead of dollar " +
    "value: a token worth little can come first. Pass vesting_id to claim a given vesting.";
const SDK_WORDS = [
    [/\brepayLoanOnVesting\b/g, "repay_loan_on_vesting"],
    [/\brepayExtendAndReborrow\b/g, "refinance_vesting_loan"],
    [/\btakeLoanOnVesting\b/g, "take_loan_on_vesting"],
    [/\bquoteLoanOnVesting\b/g, "quote_vesting_loan"],
    [/\bpass repayLoan\b/g, "pass repay_loan: true"],
    [/\brepayLoan\b/g, "repay_loan"],
    [/\btotalAmounts\[(\d+)\]/g, "recipients[$1].amount"],
    [/\buserMemos\[(\d+)\]/g, "recipients[$1].memo"],
    [/\btotalAmount\b/g, "amount"],
    [/\badditionalAmount\b/g, "amount"],
    [/\badditionalDays\b/g, "days"],
    [/\bdurationInDays\b/g, "duration_days"],
    [/\bstartTime\b/g, "start_time"],
    [/\bunlockTime\b/g, "unlock_time"],
    [/\bnewBeneficiary\b/g, "new_beneficiary"],
    [/\bnewCreator\b/g, "new_creator"],
    [/\brenounceOnCreation\b/g, "renounce"],
    [/\bvestingId\b/g, "vesting_id"],
    [/\bloanBuffer\b/g, "the loan buffer"],
    [/\bhub id\b/g, "loan id"],
];
async function vestingPair(client, id) {
    return pairMeta(client, (await client.vesting.getVestingDetails(id)).ecosystem);
}
async function humanRefusal(client, msg, vestingId) {
    try {
        let m = /Needs (\d+) of (0x[0-9a-fA-F]{40}) \(raw\); the wallet holds (\d+)/.exec(msg);
        if (m) {
            const t = await client.mains.tokenMeta((0, units_js_1.addr)(m[2]));
            return `Not enough ${t.symbol} in the wallet: it has ${fmt(BigInt(m[3]), t)}, and this needs ${fmt(BigInt(m[1]), t)}. Nothing was sent.`;
        }
        m = /The vesting fee is (\d+) wei; the wallet holds (\d+)/.exec(msg);
        if (m) {
            return `Not enough ETH for the vesting creation fee: it is ${(0, viem_1.formatEther)(BigInt(m[1]))} ETH, and the wallet holds ${(0, viem_1.formatEther)(BigInt(m[2]))} ETH. Nothing was sent.`;
        }
        if (vestingId === undefined)
            return null;
        m = /worth (\d+), below the minimum loan (\d+) \(raw pair asset\)/.exec(msg);
        if (m) {
            const pm = await vestingPair(client, vestingId);
            return `The unclaimed tokens are worth ${fmt(BigInt(m[1]), pm)}, below the minimum loan of ${fmt(BigInt(m[2]), pm)}. Nothing was sent.`;
        }
        m = /The loan fees (\d+) would take the whole collateral value (\d+) \(raw pair asset\)/.exec(msg);
        if (m) {
            const pm = await vestingPair(client, vestingId);
            return `The loan fees (${fmt(BigInt(m[1]), pm)}) would take the whole value of the unclaimed tokens (${fmt(BigInt(m[2]), pm)}), so the loan would pay nothing out. Nothing was sent.`;
        }
    }
    catch {
    }
    return null;
}
async function sdk(client, call, vestingId) {
    try {
        return await call;
    }
    catch (e) {
        if (e instanceof basis_sdk_1.ValidationError) {
            const human = await humanRefusal(client, e.message, vestingId);
            if (human !== null)
                throw new basis_sdk_1.ValidationError(e.rule, human);
            e.message = SDK_WORDS.reduce((t, [re, w]) => t.replace(re, w), e.message);
        }
        throw e;
    }
}
const LOAN_REFUSAL = {
    "Active loan exists": "This vesting already has a loan: repay it with repay_loan_on_vesting, or refinance it with refinance_vesting_loan.",
    "No unclaimed tokens": "Nothing is left on this vesting to borrow against.",
    "pair not active": "Trading on this main is paused: new loans wait until it reopens.",
    "pair asset paused": "The pair asset of this main (e.g. USDG) is paused by its issuer right now, so no loan can pay it out. Try again once it resumes.",
    "Ecosystem inactive": "Loans aren't open on this main right now.",
    "Unauthorized caller": "New loans aren't open on this main right now.",
    "incorrect loan duration": "The loan would run outside this main's loan day range (it runs for the days left on the vesting plus the buffer days in get_vesting_settings).",
    "Minimum loan amount not met": "The unclaimed tokens are worth less than this main's minimum loan.",
    "No stable received": "The fees would take the whole value, so the loan would pay nothing out.",
    "No active loan": "This vesting has no loan to refinance: borrow with take_loan_on_vesting.",
    "Loan not active": "The loan ended unpaid: settle it with repay_loan_on_vesting first.",
    "insufficient balance": "The wallet doesn't hold enough of the pair asset to repay the open loan first.",
};
const refusalText = (rule) => (rule === null ? null : (LOAN_REFUSAL[rule] ?? rule));
const vid = (v) => (0, units_js_1.uint)(v, "vesting_id");
function fmt(raw, m) {
    return `${(0, viem_1.formatUnits)(raw, m.decimals)} ${m.symbol}`;
}
function at18(raw, decimals) {
    return decimals <= 18 ? raw * 10n ** BigInt(18 - decimals) : raw / 10n ** BigInt(decimals - 18);
}
function dustLine(decimals) {
    return decimals >= 4 ? 10n ** BigInt(decimals - 4) : 1n;
}
function iso(sec) {
    return sec > 0n ? new Date(Number(sec) * 1000).toISOString() : null;
}
function inDays(sec) {
    return Number((sec * 100n) / DAY) / 100;
}
function durationText(sec) {
    const plural = (n, word) => `${n} ${word}${n === 1n ? "" : "s"}`;
    if (sec % DAY === 0n)
        return plural(sec / DAY, "day");
    if (sec % 3600n === 0n)
        return plural(sec / 3600n, "hour");
    return plural(sec, "second");
}
function big(v) {
    if (v === null || v === undefined)
        return null;
    const s = String(v);
    return /^-?\d+$/.test(s) ? BigInt(s) : null;
}
async function chainNow(client) {
    return (await client.publicClient.getBlock()).timestamp;
}
async function pairMeta(client, main) {
    const info = await client.mains.get(main);
    return { decimals: info.pairDecimals, symbol: info.pairSymbol };
}
async function pickTime(client, unix, daysFromNow, unixField, daysField, defaultNow) {
    if (unix !== undefined && daysFromNow !== undefined) {
        throw new basis_sdk_1.ValidationError(unixField, `Pass ${unixField} or ${daysField}, not both.`);
    }
    if (unix !== undefined) {
        const t = (0, units_js_1.uint)(unix, unixField);
        if (t > MS_GUESS)
            throw new basis_sdk_1.ValidationError(unixField, `${unixField} looks like milliseconds: pass unix seconds (${t / 1000n}).`);
        return t;
    }
    if (daysFromNow !== undefined) {
        if (!Number.isFinite(daysFromNow) || daysFromNow < 0)
            throw new basis_sdk_1.ValidationError(daysField, `${daysField} must be a number of days, 0 or more.`);
        return (await chainNow(client)) + BigInt(Math.round(daysFromNow * 86_400));
    }
    if (defaultNow)
        return chainNow(client);
    throw new basis_sdk_1.ValidationError(unixField, `Pass ${unixField} (unix seconds) or ${daysField}.`);
}
async function batchRows(client, token, rows) {
    if (!rows.length)
        throw new basis_sdk_1.ValidationError("recipients", "recipients must list at least one wallet.");
    if (rows.length > BATCH_MAX) {
        throw new basis_sdk_1.ValidationError("recipients", `At most ${BATCH_MAX} recipients per transaction (got ${rows.length}): split them into several calls.`);
    }
    const { decimals } = await client.mains.tokenMeta(token);
    const amounts = rows.map((r, i) => (0, units_js_1.toRaw)(r.amount, decimals, `recipients[${i}].amount`));
    return {
        wallets: rows.map((r, i) => (0, units_js_1.addr)(r.beneficiary, `recipients[${i}].beneficiary`)),
        amounts,
        total: amounts.reduce((a, b) => a + b, 0n),
        memos: rows.map((r) => r.memo ?? ""),
    };
}
function endOf(v) {
    return v.isGradual ? v.startTime + v.durationInDays * DAY : v.unlockTime;
}
async function viewLoan(client, loan, tm, now) {
    const pm = await client.mains.tokenMeta(loan.repayToken);
    const d = loan.details;
    const out = {
        loanId: loan.loanId,
        status: d.active ? (now >= d.liquidationTime ? "open, past its end date" : "open") : d.isLiquidated ? "ended unpaid" : "closed",
        debt: fmt(d.fullAmount, pm),
        borrowed: fmt(d.borrowedAmount, pm),
        pledged: fmt(d.collateralAmount, tm),
        repayBy: iso(d.liquidationTime),
    };
    if (d.active) {
        out.next = "Repay the debt by repayBy with repay_loan_on_vesting to get the tokens back to claiming.";
    }
    else if (d.isLiquidated) {
        out.leftover = fmt(d.liquidationClaim, tm);
        out.next = "Settle it with repay_loan_on_vesting (no payment) to put the leftover back on the schedule, within 365 days of the end.";
    }
    return out;
}
async function viewVesting(client, v, now, live) {
    const [tm, main] = await Promise.all([client.mains.tokenMeta(v.token), client.mains.get(v.ecosystem)]);
    const end = endOf(v);
    const out = {
        vestingId: v.id,
        kind: v.isGradual ? "gradual" : "cliff",
        token: { address: v.token, symbol: tm.symbol },
        main: main.symbol,
        beneficiary: v.beneficiary,
        creator: v.creator,
        total: fmt(v.totalAmount, tm),
        claimed: fmt(v.claimedAmount, tm),
    };
    if (live) {
        out.claimableNow = fmt(live.claimable, tm);
        out.vestedSoFar = fmt(live.vested, tm);
        out.leftToClaim = fmt(live.effectiveTotal > v.claimedAmount ? live.effectiveTotal - v.claimedAmount : 0n, tm);
        if (live.effectiveTotal !== v.totalAmount)
            out.totalAfterUnpaidLoan = fmt(live.effectiveTotal, tm);
    }
    else {
        out.leftToClaim = fmt(v.totalAmount > v.claimedAmount ? v.totalAmount - v.claimedAmount : 0n, tm);
    }
    out.start = iso(v.startTime);
    if (v.isGradual) {
        out.durationDays = v.durationInDays;
        out.releasesEvery = RELEASE_STEPS[v.timeUnit] ?? String(v.timeUnit);
    }
    out.end = iso(end);
    if (v.isGradual)
        out.status = now < v.startTime ? "not started" : now < end ? "vesting" : "fully vested";
    else
        out.status = now < end ? "locked" : "unlocked";
    if (now < end)
        out.daysToEnd = inDays(end - now);
    if (v.memo)
        out.memo = v.memo;
    out.creatorRenounced = v.renounced;
    if (live?.loan)
        out.loan = await viewLoan(client, live.loan, tm, now);
    else if (v.activeLoanId !== 0n)
        out.loan = "open (see get_vesting_details)";
    else
        out.loan = null;
    return out;
}
async function viewQuote(client, q, re) {
    const [tm, pm] = await Promise.all([client.mains.tokenMeta(q.token), pairMeta(client, q.main)]);
    const out = { vestingId: q.vestingId };
    if (re) {
        out.extendByDays = re.additionalDays;
        out.repayFirst = fmt(re.repayAmount, pm);
    }
    out.tokensPledged = fmt(q.tokenAmount, tm);
    out.loanDays = q.loanDurationDays;
    out.youReceive = fmt(q.borrowed, pm);
    out.fee = fmt(q.fee, pm);
    out.debtToRepay = fmt(q.collateralValue, pm);
    out.meetsMinimum = q.meetsMinimum;
    if (re)
        out.net = `${fmt(re.net, pm)} (received minus repaid; negative means you pay in)`;
    out.wouldGoThrough = q.refusal === null;
    out.refusal = refusalText(q.refusal);
    out.ifNotRepaidInTime =
        "After the end date the loan can be liquidated: settle it with repay_loan_on_vesting (no payment), which puts what is left back on the vesting.";
    return out;
}
async function pairMetas(client, events) {
    const out = new Map();
    const mains = [...new Set(events.filter((e) => e.borrowed !== undefined && !!e.main).map((e) => e.main.toLowerCase()))];
    await Promise.all(mains.map(async (m) => {
        try {
            out.set(m, await pairMeta(client, (0, units_js_1.addr)(m)));
        }
        catch {
        }
    }));
    return out;
}
async function metaMap(client, addrs) {
    const out = new Map();
    const uniq = [...new Set(addrs.filter((a) => !!a).map((a) => a.toLowerCase()))];
    await Promise.all(uniq.map(async (a) => {
        try {
            out.set(a, await client.mains.tokenMeta((0, units_js_1.addr)(a)));
        }
        catch {
        }
    }));
    return out;
}
async function usdPrices(client, tokens) {
    const uniq = [...new Set(tokens.map((t) => t.toLowerCase()))];
    const out = new Map();
    try {
        for (let i = 0; i < uniq.length; i += PRICE_BATCH) {
            const res = await client.api.getTokenPrices(uniq.slice(i, i + PRICE_BATCH));
            for (const row of res.data ?? []) {
                const price = row.priceUsdE18;
                if (row.found === false || !row.address || typeof price !== "string" || !/^\d+$/.test(price))
                    continue;
                out.set(row.address.toLowerCase(), BigInt(price));
            }
        }
    }
    catch {
        return null;
    }
    return out;
}
function usdText(usdE18) {
    return usdE18 < DUST_USD_E18 ? "under $0.01" : `about $${Number((0, viem_1.formatUnits)(usdE18, 18)).toFixed(2)}`;
}
function viewEvent(e, metas, pairs) {
    const tm = (e.token && metas.get(e.token.toLowerCase())) || { decimals: 18, symbol: "tokens" };
    const pairToken = e.pairAsset ? metas.get(e.pairAsset.toLowerCase()) : undefined;
    const fromMain = e.main ? pairs.get(e.main.toLowerCase()) : undefined;
    const pairDecimals = e.pairDecimals ?? pairToken?.decimals ?? fromMain?.decimals;
    const pairSymbol = pairToken?.symbol ?? fromMain?.symbol ?? "pair asset";
    const o = { action: e.action, vestingId: e.vestingId, time: e.timestamp };
    if (!e.walletPending)
        o.by = e.wallet;
    if (e.beneficiary)
        o.beneficiary = e.beneficiary;
    if (e.creator)
        o.creator = e.creator;
    if (e.token)
        o.token = { address: e.token, symbol: tm.symbol };
    const amount = big(e.amount);
    if (amount !== null)
        o.amount = fmt(amount, tm);
    const usd = big(e.usdE18);
    if (usd !== null)
        o.usdValue = `$${Number((0, viem_1.formatUnits)(usd, 18)).toFixed(2)}`;
    if (e.additionalDays !== undefined)
        o.daysAdded = e.additionalDays;
    if (e.loanId !== undefined)
        o.loanId = e.loanId;
    const borrowed = big(e.borrowed);
    if (borrowed !== null) {
        o.borrowed =
            pairDecimals === undefined
                ? `${borrowed} in the pair asset's smallest units (its decimals couldn't be read)`
                : fmt(borrowed, { decimals: pairDecimals, symbol: pairSymbol });
    }
    const recovered = big(e.recovered);
    if (recovered !== null)
        o.recovered = fmt(recovered, tm);
    const newTotal = big(e.newTotalAmount);
    if (newTotal !== null)
        o.newTotal = fmt(newTotal, tm);
    if (e.oldBeneficiary)
        o.oldBeneficiary = e.oldBeneficiary;
    if (e.newBeneficiary)
        o.newBeneficiary = e.newBeneficiary;
    if (e.oldCreator)
        o.oldCreator = e.oldCreator;
    if (e.newCreator)
        o.newCreator = e.newCreator;
    o.txHash = e.txHash;
    return o;
}
const vestingIdParam = () => registry_js_1.p.id("Vesting id (a whole number, as get_vestings or the create result shows it).");
const releaseParam = () => zod_1.z
    .enum(RELEASE_STEPS)
    .optional()
    .describe("How often the next share unlocks: second, minute, hour or day. Default: day.");
const memoParam = () => zod_1.z.string().optional().describe("Note stored with the vesting, visible to anyone (up to 256 bytes).");
const renounceParam = () => registry_js_1.p.bool("Give up your creator rights right away and for good: nobody can change the beneficiary, and you can't extend it or " +
    "repay its loan as creator. Default false.");
const startTimeParam = () => zod_1.z
    .union([zod_1.z.number(), zod_1.z.string()])
    .optional()
    .describe("When the release starts, as unix seconds (not milliseconds). At most 7 days ahead; a past time starts now. Default: now.");
const startInDaysParam = () => zod_1.z
    .number()
    .min(0)
    .max(7)
    .optional()
    .describe("Instead of start_time: start this many days from now (decimals allowed, 0.5 = 12 hours). At most 7.");
const durationParam = () => registry_js_1.p.days("How long the release lasts, in whole days (1 to 990). The end must also fall within 990 days from now.");
const unlockTimeParam = () => zod_1.z
    .union([zod_1.z.number(), zod_1.z.string()])
    .optional()
    .describe("Unlock time as unix seconds (not milliseconds): more than 1 hour and at most 990 days from now.");
const unlockInDaysParam = () => zod_1.z
    .number()
    .positive()
    .optional()
    .describe("Instead of unlock_time: unlock this many days from now (decimals allowed, 0.5 = 12 hours). More than 1 hour, at most 990 days.");
const recipientsParam = () => zod_1.z
    .array(zod_1.z.object({
    beneficiary: zod_1.z.string().describe("Wallet that receives this share."),
    amount: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).describe('Tokens for this wallet, in the token\'s own units. Human units, e.g. "12.5".'),
    memo: zod_1.z.string().optional().describe("Note for this vesting (up to 256 bytes)."),
}))
    .min(1)
    .max(BATCH_MAX)
    .describe(`One entry per wallet, 1 to ${BATCH_MAX} per transaction. Each gets its own vesting id.`);
const EVENT_ACTIONS = [
    "created",
    "updated",
    "claimed",
    "extended",
    "beneficiary_changed",
    "renounced",
    "creator_transferred",
    "loan_taken",
    "loan_repaid",
    "loan_liquidated",
];
exports.vestingTools = [
    (0, registry_js_1.tool)({
        name: "create_gradual_vesting",
        toolset: "vesting",
        title: "Create a gradual vesting",
        description: "Lock tokens for a wallet and release them evenly over a number of whole days, a share every second, minute, hour " +
            "or day. Works for mains and BASIS tokens. Once vested the tokens can't be taken back. A creation fee in ETH may " +
            "apply (see get_vesting_settings).",
        input: {
            beneficiary: registry_js_1.p.address("Wallet that receives the tokens as they vest (it can be this server's own)."),
            token: registry_js_1.p.token(),
            amount: registry_js_1.p.amount("Tokens to vest, in the token's own units."),
            duration_days: durationParam(),
            start_time: startTimeParam(),
            start_in_days: startInDaysParam(),
            release_every: releaseParam(),
            memo: memoParam(),
            renounce: renounceParam(),
        },
        write: true,
        destructive: true,
        run: async (args, ctx) => {
            const client = await ctx.client();
            const token = await (0, units_js_1.resolveToken)(client, args.token);
            const amount = await (0, units_js_1.toTokenRaw)(client, token, args.amount, "amount");
            const start = await pickTime(client, args.start_time, args.start_in_days, "start_time", "start_in_days", true);
            await (0, limits_js_1.checkSpend)(client, token, amount);
            return (0, present_js_1.txOut)(client, await sdk(client, client.vesting.createGradualVesting((0, units_js_1.addr)(args.beneficiary, "beneficiary"), token, amount, start, (0, units_js_1.uint)(args.duration_days, "duration_days"), args.release_every ?? "day", args.memo ?? "", undefined, args.renounce ?? false)));
        },
    }),
    (0, registry_js_1.tool)({
        name: "create_cliff_vesting",
        toolset: "vesting",
        title: "Create a cliff vesting",
        description: "Lock tokens for a wallet until one unlock time, after which all of them can be claimed at once. Pass unlock_time " +
            "(unix seconds) or unlock_in_days. Once vested the tokens can't be taken back. A creation fee in ETH may apply " +
            "(see get_vesting_settings).",
        input: {
            beneficiary: registry_js_1.p.address("Wallet that receives the tokens at the unlock (it can be this server's own)."),
            token: registry_js_1.p.token(),
            amount: registry_js_1.p.amount("Tokens to vest, in the token's own units."),
            unlock_time: unlockTimeParam(),
            unlock_in_days: unlockInDaysParam(),
            memo: memoParam(),
            renounce: renounceParam(),
        },
        write: true,
        destructive: true,
        run: async (args, ctx) => {
            const client = await ctx.client();
            const token = await (0, units_js_1.resolveToken)(client, args.token);
            const amount = await (0, units_js_1.toTokenRaw)(client, token, args.amount, "amount");
            const unlock = await pickTime(client, args.unlock_time, args.unlock_in_days, "unlock_time", "unlock_in_days", false);
            await (0, limits_js_1.checkSpend)(client, token, amount);
            return (0, present_js_1.txOut)(client, await sdk(client, client.vesting.createCliffVesting((0, units_js_1.addr)(args.beneficiary, "beneficiary"), token, amount, unlock, args.memo ?? "", undefined, args.renounce ?? false)));
        },
    }),
    (0, registry_js_1.tool)({
        name: "batch_create_gradual_vesting",
        toolset: "vesting",
        title: "Create gradual vestings in bulk",
        description: `Create one gradual vesting per wallet (up to ${BATCH_MAX}) in one transaction and one fee: same token, start, ` +
            "length and release step, each wallet with its own amount and memo. Once vested the tokens can't be taken back.",
        input: {
            token: registry_js_1.p.token(),
            recipients: recipientsParam(),
            duration_days: durationParam(),
            start_time: startTimeParam(),
            start_in_days: startInDaysParam(),
            release_every: releaseParam(),
            renounce: renounceParam(),
        },
        write: true,
        destructive: true,
        run: async (args, ctx) => {
            const client = await ctx.client();
            const token = await (0, units_js_1.resolveToken)(client, args.token);
            const rows = await batchRows(client, token, args.recipients);
            const start = await pickTime(client, args.start_time, args.start_in_days, "start_time", "start_in_days", true);
            await (0, limits_js_1.checkSpend)(client, token, rows.total);
            return (0, present_js_1.txOut)(client, await sdk(client, client.vesting.batchCreateGradualVesting(rows.wallets, token, rows.amounts, rows.memos, start, (0, units_js_1.uint)(args.duration_days, "duration_days"), args.release_every ?? "day", undefined, args.renounce ?? false)));
        },
    }),
    (0, registry_js_1.tool)({
        name: "batch_create_cliff_vesting",
        toolset: "vesting",
        title: "Create cliff vestings in bulk",
        description: `Create one cliff vesting per wallet (up to ${BATCH_MAX}) in one transaction and one fee: same token and unlock ` +
            "time, each wallet with its own amount and memo. Once vested the tokens can't be taken back.",
        input: {
            token: registry_js_1.p.token(),
            recipients: recipientsParam(),
            unlock_time: unlockTimeParam(),
            unlock_in_days: unlockInDaysParam(),
            renounce: renounceParam(),
        },
        write: true,
        destructive: true,
        run: async (args, ctx) => {
            const client = await ctx.client();
            const token = await (0, units_js_1.resolveToken)(client, args.token);
            const rows = await batchRows(client, token, args.recipients);
            const unlock = await pickTime(client, args.unlock_time, args.unlock_in_days, "unlock_time", "unlock_in_days", false);
            await (0, limits_js_1.checkSpend)(client, token, rows.total);
            return (0, present_js_1.txOut)(client, await sdk(client, client.vesting.batchCreateCliffVesting(rows.wallets, token, rows.amounts, unlock, rows.memos, undefined, args.renounce ?? false)));
        },
    }),
    (0, registry_js_1.tool)({
        name: "claim_vested_tokens",
        toolset: "vesting",
        title: "Claim vested tokens",
        description: "Claim the vested tokens you can take now, as the beneficiary. Pass vesting_id for one vesting, or leave it out to " +
            `claim this wallet's vestings worth the most in dollars, at most ${CLAIM_MAX} per call (one transaction each; call ` +
            "again for the next ones). Ones worth under $0.01 are skipped then, and tokens with no price come last. Nothing " +
            "can be claimed while the vesting has a loan open.",
        input: {
            vesting_id: registry_js_1.p.optId(`Vesting id. Leave it out to claim this wallet's claimable vestings worth the most, up to ${CLAIM_MAX} per call.`),
        },
        write: true,
        run: async ({ vesting_id }, ctx) => {
            const client = await ctx.client();
            if (vesting_id !== undefined)
                return (0, present_js_1.txOut)(client, await sdk(client, client.vesting.claimTokens(vid(vesting_id))));
            const me = (0, units_js_1.walletOrSelf)(client, undefined);
            const rows = await client.vesting.getVestingsOf(me, { role: "beneficiary", active: true, includeLoan: false });
            const metas = await metaMap(client, rows.map((r) => r.token));
            const meta = (r) => metas.get(r.token.toLowerCase()) ?? { decimals: 18, symbol: "tokens" };
            const free = rows.filter((r) => r.activeLoanId === 0n && r.claimable > 0n);
            const prices = free.length ? await usdPrices(client, free.map((r) => r.token)) : new Map();
            const valued = free.map((r) => {
                const price = prices?.get(r.token.toLowerCase());
                return { r, usd: price === undefined ? null : (r.claimable * price) / 10n ** BigInt(meta(r).decimals) };
            });
            const isDust = (v) => (v.usd === null ? v.r.claimable < dustLine(meta(v.r).decimals) : v.usd < DUST_USD_E18);
            const desc = (x, y) => (x < y ? 1 : x > y ? -1 : 0);
            const tokens = (v) => at18(v.r.claimable, meta(v.r).decimals);
            const line = (v) => ({
                vestingId: v.r.id,
                token: meta(v.r).symbol,
                claimable: fmt(v.r.claimable, meta(v.r)),
                ...(prices ? { value: v.usd === null ? "no price" : usdText(v.usd) } : {}),
            });
            const dust = valued.filter(isDust);
            const worth = valued
                .filter((v) => !isDust(v))
                .sort((a, b) => {
                if (a.usd !== null && b.usd !== null)
                    return desc(a.usd, b.usd);
                if (a.usd !== null)
                    return -1;
                if (b.usd !== null)
                    return 1;
                return desc(tokens(a), tokens(b));
            });
            const withLoan = rows.filter((r) => r.activeLoanId !== 0n).length;
            const extra = {};
            if (!prices)
                extra.pricing = NO_PRICES;
            if (dust.length) {
                extra.skippedAsDust = { count: dust.length, rule: prices ? DUST_RULE : DUST_RULE_NO_PRICES, vestings: dust.slice(0, LIST_MAX).map(line) };
            }
            if (withLoan)
                extra.withLoanOpen = `${withLoan} of them have a loan open: repay it with repay_loan_on_vesting to claim again.`;
            if (!worth.length)
                return { status: "nothing to claim right now", openVestings: rows.length, ...extra };
            const batch = worth.slice(0, CLAIM_MAX);
            const claims = [];
            let sent = batch.length;
            let unconfirmed = false;
            for (let i = 0; i < batch.length; i++) {
                const { r } = batch[i];
                try {
                    claims.push({ vestingId: r.id, ...(0, present_js_1.txOut)(client, await sdk(client, client.vesting.claimTokens(r.id))) });
                }
                catch (e) {
                    if (e instanceof basis_sdk_1.TxNotConfirmedError) {
                        claims.push({ vestingId: r.id, status: "sent, not confirmed", hash: e.txHash, note: (0, errors_js_1.errorText)(e, (0, present_js_1.explorerUrl)(client)) });
                        sent = i + 1;
                        unconfirmed = true;
                        break;
                    }
                    claims.push({ vestingId: r.id, status: "failed", reason: (0, errors_js_1.errorText)(e, (0, present_js_1.explorerUrl)(client)) });
                }
            }
            const waiting = [...batch.slice(sent), ...worth.slice(CLAIM_MAX)];
            const out = { claims };
            if (waiting.length) {
                out.notClaimedYet = {
                    count: waiting.length,
                    next: unconfirmed
                        ? "A claim above isn't confirmed yet: don't claim that vesting again. Once it confirms, call claim_vested_tokens again for these, or pass vesting_id for one."
                        : `At most ${CLAIM_MAX} claims per call: call claim_vested_tokens again for the next ones, or pass vesting_id for one.`,
                    vestings: waiting.slice(0, LIST_MAX).map(line),
                };
            }
            return (0, present_js_1.userContent)({ ...out, ...extra });
        },
    }),
    (0, registry_js_1.tool)({
        name: "take_loan_on_vesting",
        toolset: "vesting",
        title: "Borrow against a vesting",
        description: "Borrow against a vesting's unclaimed tokens, as the beneficiary. The loan is made by the protocol, pays out in the " +
            "pair asset of the token's main (e.g. USDG) and runs to the vesting's end plus the loan buffer days. Repay by the " +
            "end date with repay_loan_on_vesting to get your tokens back to claiming; until then you can't claim and they earn " +
            "no holder rewards. If it isn't repaid in time it can be liquidated: repay_loan_on_vesting then settles it and puts " +
            "what is left back on the vesting. Without confirm: true it only shows the quote (as quote_vesting_loan does).",
        input: { vesting_id: vestingIdParam(), confirm: registry_js_1.p.confirm() },
        write: true,
        run: async ({ vesting_id, confirm }, ctx) => {
            const client = await ctx.client();
            const id = vid(vesting_id);
            if (!confirm) {
                const q = await sdk(client, client.vesting.quoteLoanOnVesting(id), id);
                return { preview: await viewQuote(client, q), note: q.refusal ? REFUSED_NOW : NOT_SENT };
            }
            const { hub: _hub, ...r } = await sdk(client, client.vesting.takeLoanOnVesting(id), id);
            return (0, present_js_1.txOut)(client, r, {
                next: "Repay by the end date with repay_loan_on_vesting to get the tokens back to claiming (get_vesting_details shows the date and the debt).",
            });
        },
    }),
    (0, registry_js_1.tool)({
        name: "repay_loan_on_vesting",
        toolset: "vesting",
        title: "Repay a vesting loan",
        description: "Repay a vesting's loan in full, in the pair asset of its main (e.g. USDG), so its tokens can be claimed again. If " +
            "the loan already ended unpaid, this settles it instead (no payment) and puts any leftover back on the schedule; do " +
            "that within 365 days. The beneficiary can do it, or the creator while it hasn't renounced.",
        input: { vesting_id: vestingIdParam() },
        write: true,
        run: async ({ vesting_id }, ctx) => {
            const client = await ctx.client();
            return (0, present_js_1.txOut)(client, await sdk(client, client.vesting.repayLoanOnVesting(vid(vesting_id))));
        },
    }),
    (0, registry_js_1.tool)({
        name: "refinance_vesting_loan",
        toolset: "vesting",
        title: "Refinance a vesting loan",
        description: "In one transaction, as the beneficiary: repay the vesting's open loan in full, extend the vesting by whole days " +
            "(permanent), and borrow again against the longer schedule (fees are charged again). Without confirm: true it only " +
            "shows the quote (as quote_vesting_loan with days does): the debt repaid first, the new loan, and the net amount in the pair asset.",
        input: {
            vesting_id: vestingIdParam(),
            days: registry_js_1.p.days("Whole days to extend the vesting by. Permanent."),
            confirm: registry_js_1.p.confirm(),
        },
        write: true,
        destructive: true,
        run: async ({ vesting_id, days, confirm }, ctx) => {
            const client = await ctx.client();
            const id = vid(vesting_id);
            const extra = (0, units_js_1.uint)(days, "days");
            if (!confirm) {
                const q = await sdk(client, client.vesting.quoteRepayExtendAndReborrow(id, extra), id);
                return { preview: await viewQuote(client, q, q), note: q.refusal ? REFUSED_NOW : NOT_SENT };
            }
            const { hub: _hub, ...r } = await sdk(client, client.vesting.repayExtendAndReborrow(id, extra), id);
            return (0, present_js_1.txOut)(client, r, { next: "The new loan's end date and debt are in get_vesting_details." });
        },
    }),
    (0, registry_js_1.tool)({
        name: "change_vesting_beneficiary",
        toolset: "vesting",
        title: "Change a vesting's beneficiary",
        description: "Move a vesting to a new beneficiary, who gets every claim from then on (creator only, and only if the creator hasn't " +
            "renounced). Refused while it has a loan, unless repay_loan: true repays that loan in full from your wallet in the " +
            "same transaction (the old beneficiary keeps what it borrowed).",
        input: {
            vesting_id: vestingIdParam(),
            new_beneficiary: registry_js_1.p.address("The wallet that will receive the vesting."),
            repay_loan: registry_js_1.p.bool("If the vesting has a loan: repay it in full from this wallet in the same transaction, in the pair asset (or settle it " +
                "if it ended unpaid). Default false."),
        },
        write: true,
        destructive: true,
        run: async ({ vesting_id, new_beneficiary, repay_loan }, ctx) => {
            const client = await ctx.client();
            const r = await sdk(client, client.vesting.changeBeneficiary(vid(vesting_id), (0, units_js_1.addr)(new_beneficiary, "new_beneficiary"), { repayLoan: repay_loan ?? false }));
            if (r.loanId === null && r.liquidated === null) {
                const { liquidated: _l, recovered: _r, loanId: _i, ...rest } = r;
                return (0, present_js_1.txOut)(client, rest);
            }
            return (0, present_js_1.txOut)(client, r);
        },
    }),
    (0, registry_js_1.tool)({
        name: "extend_vesting",
        toolset: "vesting",
        title: "Extend a vesting",
        description: "Push a vesting's end back by whole days: a gradual release stretches over the longer time, a cliff unlocks later. " +
            "Permanent. The beneficiary can do it, or the creator unless it renounced. Refused while a loan is open (use " +
            "refinance_vesting_loan) and past 990 days left.",
        input: { vesting_id: vestingIdParam(), days: registry_js_1.p.days("Whole days to add.") },
        write: true,
        destructive: true,
        run: async ({ vesting_id, days }, ctx) => {
            const client = await ctx.client();
            return (0, present_js_1.txOut)(client, await sdk(client, client.vesting.extendVestingPeriod(vid(vesting_id), (0, units_js_1.uint)(days, "days"))));
        },
    }),
    (0, registry_js_1.tool)({
        name: "add_tokens_to_vesting",
        toolset: "vesting",
        title: "Add tokens to a vesting",
        description: "Add more tokens to a running vesting (creator only); they follow the same schedule. Refused after the end or while " +
            "a loan is open. The tokens can't be taken back.",
        input: { vesting_id: vestingIdParam(), amount: registry_js_1.p.amount("Tokens to add, in the vested token's own units.") },
        write: true,
        destructive: true,
        run: async ({ vesting_id, amount }, ctx) => {
            const client = await ctx.client();
            const id = vid(vesting_id);
            const v = await client.vesting.getVestingDetails(id);
            if ((0, basis_sdk_1.isZeroAddress)(v.creator))
                throw new basis_sdk_1.ValidationError("vesting_id", `Vesting ${id} does not exist.`);
            const raw = await (0, units_js_1.toTokenRaw)(client, v.token, amount, "amount");
            await (0, limits_js_1.checkSpend)(client, v.token, raw);
            return (0, present_js_1.txOut)(client, await sdk(client, client.vesting.addTokensToVesting(id, raw)));
        },
    }),
    (0, registry_js_1.tool)({
        name: "transfer_vesting_creator",
        toolset: "vesting",
        title: "Hand over the creator role",
        description: "Hand your creator role on a vesting to another wallet (creator only). From then on only that wallet can change the " +
            "beneficiary, extend it, add tokens or repay its loan as creator. You can't take it back.",
        input: { vesting_id: vestingIdParam(), new_creator: registry_js_1.p.address("The wallet that becomes the creator.") },
        write: true,
        destructive: true,
        run: async ({ vesting_id, new_creator }, ctx) => {
            const client = await ctx.client();
            return (0, present_js_1.txOut)(client, await sdk(client, client.vesting.transferCreatorRole(vid(vesting_id), (0, units_js_1.addr)(new_creator, "new_creator"))));
        },
    }),
    (0, registry_js_1.tool)({
        name: "renounce_vesting",
        toolset: "vesting",
        title: "Renounce creator rights",
        description: "Give up your creator rights on a vesting for good (creator only): nobody can change its beneficiary any more, and " +
            "the creator can no longer extend it or repay its loan (adding tokens still works). Shows the vesting is locked in. " +
            "Can't be undone.",
        input: { vesting_id: vestingIdParam() },
        write: true,
        destructive: true,
        run: async ({ vesting_id }, ctx) => {
            const client = await ctx.client();
            return (0, present_js_1.txOut)(client, await sdk(client, client.vesting.renounceVesting(vid(vesting_id))));
        },
    }),
    (0, registry_js_1.tool)({
        name: "get_vesting_details",
        toolset: "vesting",
        title: "Vesting details",
        description: "One vesting in full: token, beneficiary, creator, amounts (total, claimed, vested so far, claimable now, left to " +
            "claim), start, end and release step, and its loan if one is open (debt in the pair asset and the repay-by date). " +
            "Several by id: get_vesting_details_batch; a wallet's: get_vestings.",
        input: { vesting_id: vestingIdParam() },
        run: async ({ vesting_id }, ctx) => {
            const client = await ctx.client();
            const id = vid(vesting_id);
            const v = await client.vesting.getVestingDetails(id);
            if ((0, basis_sdk_1.isZeroAddress)(v.creator)) {
                throw new basis_sdk_1.ValidationError("vesting_id", `Vesting ${id} does not exist. Ids run from 0 to get_vesting_count minus 1.`);
            }
            const [claimable, vested, effectiveTotal, loan, now] = await Promise.all([
                client.vesting.getClaimableAmount(id),
                client.vesting.getEffectiveVestedAmount(id),
                client.vesting.getEffectiveTotalAmount(id),
                v.activeLoanId !== 0n ? client.vesting.getVestingLoan(id) : Promise.resolve(null),
                chainNow(client),
            ]);
            return (0, present_js_1.userContent)(await viewVesting(client, v, now, { claimable, vested, effectiveTotal, loan }));
        },
    }),
    (0, registry_js_1.tool)({
        name: "get_vesting_details_batch",
        toolset: "vesting",
        title: "Several vestings",
        description: "Several vestings by id in one read (up to 100): token, wallets, total and claimed amounts, dates and status. For " +
            "claimable amounts and loan details use get_vesting_details or get_vestings.",
        input: {
            vesting_ids: zod_1.z
                .array(zod_1.z.union([zod_1.z.string(), zod_1.z.number()]))
                .min(1)
                .max(100)
                .describe("Vesting ids, 1 to 100 of them."),
        },
        run: async ({ vesting_ids }, ctx) => {
            const client = await ctx.client();
            const ids = vesting_ids.map((x, i) => (0, units_js_1.uint)(x, `vesting_ids[${i}]`));
            const count = await client.vesting.getVestingCount();
            const range = count > 0n ? `ids run from 0 to ${count - 1n}` : "no vestings exist on this network yet";
            const found = ids.filter((id) => id < count);
            const notFound = ids.filter((id) => id >= count);
            if (!found.length)
                throw new basis_sdk_1.ValidationError("vesting_ids", `None of these vestings exist (${range}).`);
            const [rows, now] = await Promise.all([client.vesting.getVestingDetailsBatch(found), chainNow(client)]);
            const vestings = await Promise.all(rows.map((v) => viewVesting(client, v, now)));
            return (0, present_js_1.userContent)(notFound.length ? { vestings, notFound, note: `No vesting has these ids (${range}).` } : { vestings });
        },
    }),
    (0, registry_js_1.tool)({
        name: "get_vesting_count",
        toolset: "vesting",
        title: "Vesting count",
        description: "How many vestings exist on this network. Ids run from 0 to this count minus 1.",
        input: {},
        run: async (_args, ctx) => {
            const client = await ctx.client();
            const total = await client.vesting.getVestingCount();
            return { total, ids: total > 0n ? `0 to ${total - 1n}` : "none yet" };
        },
    }),
    (0, registry_js_1.tool)({
        name: "get_vestings",
        toolset: "vesting",
        title: "A wallet's vestings",
        description: "A wallet's vestings, as beneficiary, creator or both, newest start first, with live amounts (claimable now, vested " +
            "so far, left to claim), dates and any open loan. The history of changes is in get_vesting_events.",
        input: {
            wallet: registry_js_1.p.wallet(),
            role: zod_1.z
                .enum(["beneficiary", "creator", "any"])
                .optional()
                .describe("beneficiary (vestings it receives), creator (vestings it made) or any (default)."),
            status: zod_1.z
                .enum(["active", "finished", "all"])
                .optional()
                .describe("active (tokens left to claim), finished (all claimed) or all (default)."),
            include_loans: registry_js_1.p.bool("Read each vesting's open loan (default true)."),
            limit: registry_js_1.p.limit(100, 20),
            page: registry_js_1.p.page(),
        },
        run: async ({ wallet, role, status, include_loans, limit, page }, ctx) => {
            const client = await ctx.client();
            const who = (0, units_js_1.walletOrSelf)(client, wallet);
            const active = status === "active" ? true : status === "finished" ? false : undefined;
            const [rows, now] = await Promise.all([
                client.vesting.getVestingsOf(who, { role: role ?? "any", active, includeLoan: include_loans ?? true }),
                chainNow(client),
            ]);
            const size = limit ?? 20;
            const pageNo = page ?? 1;
            const from = (pageNo - 1) * size;
            const vestings = await Promise.all(rows.slice(from, from + size).map(async (r) => ({
                role: r.isBeneficiary && r.isCreator ? "beneficiary and creator" : r.isBeneficiary ? "beneficiary" : "creator",
                ...(await viewVesting(client, r, now, {
                    claimable: r.claimable,
                    vested: r.vested,
                    effectiveTotal: r.effectiveTotal,
                    loan: r.loan,
                })),
            })));
            return (0, present_js_1.userContent)({ wallet: who, total: rows.length, page: pageNo, hasMore: from + size < rows.length, vestings });
        },
    }),
    (0, registry_js_1.tool)({
        name: "get_token_vesting_ids",
        toolset: "vesting",
        title: "A token's vestings",
        description: "The vestings of one token, newest first: their ids, and with include_details each one's wallets, amounts and dates.",
        input: {
            token: registry_js_1.p.token(),
            include_details: registry_js_1.p.bool("Also return each vesting's details (default false)."),
            limit: registry_js_1.p.limit(100, 20),
            page: registry_js_1.p.page(),
        },
        run: async ({ token, include_details, limit, page }, ctx) => {
            const client = await ctx.client();
            const t = await (0, units_js_1.resolveToken)(client, token);
            const total = await client.vesting.getTokenVestingCount(t);
            const size = BigInt(limit ?? 20);
            const pageNo = page ?? 1;
            const end = total - BigInt(pageNo - 1) * size;
            if (end <= 0n)
                return { token: t, total, page: pageNo, hasMore: false, ids: [] };
            const start = end > size ? end - size : 0n;
            const ids = [...(await client.vesting.getTokenVestingIds(t, start, end))].reverse();
            const out = { token: t, total, page: pageNo, hasMore: start > 0n, ids };
            if (include_details && ids.length) {
                const [rows, now] = await Promise.all([client.vesting.getVestingDetailsBatch(ids), chainNow(client)]);
                out.vestings = await Promise.all(rows.map((v) => viewVesting(client, v, now)));
                return (0, present_js_1.userContent)(out);
            }
            return out;
        },
    }),
    (0, registry_js_1.tool)({
        name: "get_vesting_events",
        toolset: "vesting",
        title: "Vesting history",
        description: "Vesting history from the BASIS site, newest first: creations, claims, top-ups, extensions, beneficiary and creator " +
            "changes, renounces, and loans taken, repaid or ended unpaid. Another wallet's history needs an API key. The " +
            "vestings as they are now: get_vestings.",
        input: {
            wallet: registry_js_1.p.wallet(),
            action: zod_1.z
                .enum(EVENT_ACTIONS)
                .optional()
                .describe("Only this kind: created, updated (tokens added), claimed, extended, beneficiary_changed, renounced, creator_transferred, loan_taken, loan_repaid, loan_liquidated (ended unpaid)."),
            vesting_id: registry_js_1.p.optId("Only events of this vesting."),
            role: zod_1.z
                .enum(["actor", "beneficiary", "creator", "any"])
                .optional()
                .describe("The wallet's side: actor (it sent the transaction), beneficiary, creator or any (default)."),
            limit: registry_js_1.p.limit(100, 20),
            cursor: registry_js_1.p.cursor(),
        },
        run: async ({ wallet, action, vesting_id, role, limit, cursor }, ctx) => {
            const client = await ctx.client();
            const who = (0, units_js_1.walletOrSelf)(client, wallet);
            const params = {
                action,
                vestingId: vesting_id !== undefined ? vid(vesting_id) : undefined,
                role,
                limit: limit ?? 20,
                cursor: cursor ?? undefined,
            };
            const self = client.account;
            const pageData = self && self.toLowerCase() === who.toLowerCase()
                ? await client.api.getMyVestingEvents(params)
                : await client.api.getWalletVestingEvents(who, params);
            const [metas, pairs] = await Promise.all([
                metaMap(client, pageData.data.flatMap((e) => [e.token, e.pairAsset])),
                pairMetas(client, pageData.data),
            ]);
            return {
                wallet: who,
                events: pageData.data.map((e) => viewEvent(e, metas, pairs)),
                hasMore: pageData.pagination.hasMore,
                nextCursor: pageData.pagination.nextCursor ?? null,
            };
        },
    }),
    (0, registry_js_1.tool)({
        name: "quote_vesting_loan",
        toolset: "vesting",
        title: "Quote a vesting loan",
        description: "What a loan on a vesting would give now, without sending anything: tokens pledged, loan length in days, payout and " +
            "fee in the pair asset (e.g. USDG), the debt to repay, and the refusal reason if it wouldn't go through. With days, " +
            "it quotes a refinance instead (repay the open loan, extend by those days, borrow again). take_loan_on_vesting and " +
            "refinance_vesting_loan without confirm: true show the same quotes.",
        input: {
            vesting_id: vestingIdParam(),
            days: zod_1.z.number().int().positive().optional().describe("Quote a refinance: whole days to extend the vesting by before borrowing again."),
        },
        run: async ({ vesting_id, days }, ctx) => {
            const client = await ctx.client();
            const id = vid(vesting_id);
            if (days !== undefined) {
                const q = await sdk(client, client.vesting.quoteRepayExtendAndReborrow(id, (0, units_js_1.uint)(days, "days")));
                return viewQuote(client, q, q);
            }
            return viewQuote(client, await sdk(client, client.vesting.quoteLoanOnVesting(id)));
        },
    }),
    (0, registry_js_1.tool)({
        name: "get_vesting_settings",
        toolset: "vesting",
        title: "Vesting settings",
        description: "The vesting rules on this network: the creation fee this wallet pays (in ETH, can be 0), the shortest and longest " +
            "vesting, and how many buffer days a vesting loan runs past the vesting's end.",
        input: {},
        run: async (_args, ctx) => {
            const client = await ctx.client();
            const [limits, buffer, feeOn, feeAmount] = await Promise.all([
                client.vesting.getDurationLimits(),
                client.vesting.getLoanBuffer(),
                client.vesting.isFeeEnabled(),
                client.vesting.getFeeAmount(),
            ]);
            const maxStartDelay = await client.publicClient.readContract({
                address: client.addresses.vesting,
                abi: basis_sdk_1.VestingAbi,
                functionName: "MAX_START_DELAY",
            });
            const fee = client.account ? await client.vesting.getCreationFee() : feeOn ? feeAmount : 0n;
            return {
                creationFee: `${(0, viem_1.formatEther)(fee)} ETH${client.account ? " (for this wallet)" : ""}`,
                shortestVesting: durationText(limits.min),
                longestVesting: durationText(limits.max),
                gradualStartAtMost: `${durationText(maxStartDelay)} ahead`,
                loanBufferDays: buffer,
            };
        },
    }),
];
