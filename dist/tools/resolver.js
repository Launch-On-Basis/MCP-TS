"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolverTools = void 0;
const zod_1 = require("zod");
const viem_1 = require("viem");
const basis_sdk_1 = require("basis-sdk");
const registry_js_1 = require("../registry.js");
const units_js_1 = require("../units.js");
const present_js_1 = require("../present.js");
const outcomes_js_1 = require("../outcomes.js");
const limits_js_1 = require("../limits.js");
const NOT_SENT = "Nothing was sent. Call again with confirm: true to send.";
const MAX_OUTCOMES = 150;
const INVALID_TEXT = "INVALID (the question can't be settled, so the market is void)";
const EARLY_TEXT = "EARLY (the event hasn't happened yet)";
const BOND_TEXT = "A bond is money locked behind a claim about the result. A proposal that stands gets its bond back. When the vote " +
    "goes against a proposal or a dispute, that bond is lost (part of it goes to the side that was right); when the vote " +
    "picks neither, both are lost. A losing veto loses its whole bond.";
const PLACES_HINT = "List exactly the paid places in finish order (placesPaid in get_market_resolution_status), each outcome once, more " +
    "only when a tie spans the last paid place.";
const RULE_TEXT = {
    "Not a ranked market": "not a public prediction market",
    "unknown market": "market not found",
    "Invalid market": "market not found",
    "Already resolved": "already settled",
    "Too early to propose": "too early to propose",
    "Already proposed": "a result is already proposed",
    "No proposal to dispute": "nothing proposed yet",
    "Already in dispute": "already disputed",
    "Dispute period over": "the dispute window has closed",
    "Proposer cannot dispute self": "this wallet made the proposal",
    "Must be different": "the dispute must name a result different from the proposal",
    noProposal: "nothing proposed yet",
    disputed: "the proposal is disputed, so it settles after the vote",
    "Wait more": "too early",
    "Veto only allowed on disputed/voting markets": "only a disputed market can be vetoed",
    "Veto only allowed once": "already vetoed",
    "Already vetoed": "already vetoed",
    "Veto window not started yet": "the veto window hasn't opened",
    "Party to the dispute cannot veto": "the proposer and the disputer can't veto",
    "Cant veto propose dispute outcome": "the veto must name a result different from the dispute",
    "Cannot veto back to the proposal": "the veto must name a result different from the proposal",
    notInDispute: "not disputed",
    inVeto: "a veto was filed, so BASIS settles it",
    "Rules: not qualified": "this wallet doesn't meet the proposal rule on this market (it can still dispute or veto)",
};
const TIMED_RULES = new Set(["Too early to propose", "Wait more", "Veto window not started yet"]);
function ruleText(reason) {
    if (!reason)
        return "not now";
    return RULE_TEXT[reason] ?? reason;
}
function ordinal(n) {
    const teen = n % 100 >= 11 && n % 100 <= 13;
    const end = teen ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
    return `${n}${end}`;
}
function label(id, names) {
    return names[id] !== undefined ? `${names[id]} (#${id})` : `outcome #${id}`;
}
function bit(tieMask, i) {
    return ((tieMask >> BigInt(i)) & 1n) === 1n;
}
function places(ranking, tieMask, names) {
    const tied = (i) => i > 0 && i < ranking.length && bit(tieMask, i);
    let place = 1;
    return ranking.map((id, i) => {
        if (!tied(i))
            place = i + 1;
        return { place, id, name: names[id] ?? null, tied: tied(i) || tied(i + 1) };
    });
}
function resultText(ranking, tieMask, names) {
    if (ranking.length === 0)
        return INVALID_TEXT;
    return places(ranking, tieMask, names)
        .map((e) => `${ordinal(e.place)}${e.tied ? " (tied)" : ""}: ${label(e.id, names)}`)
        .join(", ");
}
function keyText(k, names) {
    if (!k)
        return null;
    switch (k.kind) {
        case "invalid":
            return INVALID_TEXT;
        case "early":
            return EARLY_TEXT;
        case "outcome":
            return k.outcome === undefined ? null : label(k.outcome, names);
        case "ranking":
            return k.ranking ? resultText(k.ranking, k.tieMask ?? 0n, names) : "a ranking whose details aren't on chain";
        default:
            return null;
    }
}
function dur(sec) {
    const s = Math.max(0, Math.round(sec));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const parts = [];
    if (d)
        parts.push(`${d}d`);
    if (h)
        parts.push(`${h}h`);
    if (m)
        parts.push(`${m}m`);
    return parts.length ? parts.join(" ") : `${s}s`;
}
function iso(ts) {
    return new Date(ts * 1000).toISOString().replace(".000Z", "Z");
}
function at(ts, now) {
    if (ts === undefined)
        return undefined;
    return ts > now ? `${iso(ts)} (in ${dur(ts - now)})` : `${iso(ts)} (${dur(now - ts)} ago)`;
}
async function bondFormat(client, c) {
    const meta = await client.mains.tokenMeta(c.BOND_TOKEN);
    const fmt = (raw) => (raw === null || raw === undefined ? null : (0, basis_sdk_1.toAmount)(raw, meta.decimals, "token", c.BOND_TOKEN, meta.symbol));
    const text = (raw) => {
        const a = fmt(raw);
        return a ? `${a.formatted} ${a.symbol}` : "n/a";
    };
    return { fmt, text, symbol: meta.symbol };
}
async function publicMarket(client, market) {
    const m = (0, units_js_1.addr)(market, "market");
    const host = await client.resolver.hostOf(m);
    if ((0, basis_sdk_1.isZeroAddress)(host)) {
        throw new basis_sdk_1.ValidationError("market", `${m} isn't a public prediction market. A private market is settled by its own voters: see private_get_market, then private_vote and private_finalize.`);
    }
    return { market: m, host };
}
async function outcomeNames(client, host, market) {
    const names = await client.publicClient.readContract({ address: host, abi: basis_sdk_1.TrancheMarketAbi, functionName: "getOptionNames", args: [market] });
    return [...names];
}
async function factsOf(client, pm) {
    const pc = client.publicClient;
    const [names, md, split] = await Promise.all([
        outcomeNames(client, pm.host, pm.market),
        pc.readContract({ address: pm.host, abi: basis_sdk_1.TrancheMarketAbi, functionName: "getMarketData", args: [pm.market] }).catch(() => null),
        pc.readContract({ address: pm.host, abi: basis_sdk_1.TrancheMarketAbi, functionName: "getTrancheBP", args: [pm.market] }).catch(() => null),
    ]);
    return { ...pm, question: md ? md.marketName : null, names, split };
}
function filed(d, names, fmt) {
    if (!d)
        return { proposal: null, dispute: null, veto: null };
    return {
        proposal: { by: d.proposer, result: keyText(d.originalKey, names), bond: fmt(d.proposerBond) },
        dispute: (0, basis_sdk_1.isZeroAddress)(d.disputer) ? null : { by: d.disputer, result: keyText(d.disputedKey, names), bond: fmt(d.disputerBond) },
        veto: (0, basis_sdk_1.isZeroAddress)(d.vetoer) ? null : { by: d.vetoer, result: keyText(d.vetoKey, names), bond: fmt(d.vetoBond) },
    };
}
async function withBondHelp(client, market, send) {
    try {
        return await send();
    }
    catch (e) {
        if (!(e instanceof basis_sdk_1.ValidationError) || e.rule !== "bondBalance")
            throw e;
        const c = await client.resolver.getConstants(market).catch(() => null);
        if (!c)
            throw e;
        const { text, symbol } = await bondFormat(client, c);
        const nums = /bond is (\d+) raw .*holds (\d+)/.exec(e.message);
        const figures = nums ? ` The bond is ${text(BigInt(nums[1]))}; this wallet holds ${text(BigInt(nums[2]))}.` : "";
        throw new basis_sdk_1.ValidationError("bond", `This wallet doesn't hold enough ${symbol} for the bond.${figures} Get more ${symbol}, then try again.`);
    }
}
function resolverTxOut(client, r, extra) {
    const { key: _key, bond, bondPosted, ...tx } = r;
    const posted = bondPosted ?? (bond.raw > 0n ? bond : undefined);
    return (0, present_js_1.txOut)(client, tx, { ...extra, ...(posted ? { bondPosted: posted } : {}) });
}
const resultShape = {
    outcome: (0, outcomes_js_1.outcomeParam)("The winning outcome, for markets that pay one winner: its name, or its id as \"#0\" (0 is the first). The outcomes " +
        "are listed by get_market_resolution_status.").optional(),
    ranking: zod_1.z
        .array((0, outcomes_js_1.outcomeParam)("One outcome: its name, or its id as \"#0\"."))
        .max(MAX_OUTCOMES)
        .optional()
        .describe("Finish order, first place first: each entry an outcome name or its id as \"#0\". List exactly the paid places " +
        "(placesPaid in get_market_resolution_status), more only when a tie spans the last paid place."),
    tied: zod_1.z
        .array(zod_1.z.number().int())
        .max(MAX_OUTCOMES - 1)
        .optional()
        .describe("With ranking only: positions in it (0 = first entry) that share a place with the entry before them, e.g. [1] " +
        "puts the first two level. Tied entries can be listed in any order."),
    invalid: registry_js_1.p.bool("true: the question can't be settled (cancelled event, broken question), so the market settles as INVALID (void)."),
};
function givenResults(a) {
    const got = [];
    if (a.outcome !== undefined)
        got.push("outcome");
    if (a.ranking !== undefined)
        got.push("ranking");
    if (a.invalid)
        got.push("invalid");
    if (a.early)
        got.push("early");
    return got;
}
function sortTieGroups(ranking, tieMask) {
    const out = [...ranking];
    for (let g0 = 0; g0 < out.length;) {
        let g1 = g0 + 1;
        while (g1 < out.length && bit(tieMask, g1))
            g1++;
        if (g1 - g0 > 1)
            out.splice(g0, g1 - g0, ...out.slice(g0, g1).sort((x, y) => x - y));
        g0 = g1;
    }
    return out;
}
const twiceText = (who) => `${who} is listed twice: each outcome goes in the ranking once.`;
const outcomeNotRankingText = (paid) => `This market pays ${paid} places: pass ranking (the finish order of the top ${paid}) instead of outcome.`;
const placesText = (n) => `${n} place${n === 1 ? "" : "s"}`;
const pastText = (paid, len) => `This market pays ${paid}, and ranking goes past them (${len} entries). ${PLACES_HINT}`;
function checkShape(f, r, field) {
    const { ranking, tieMask } = r;
    if (ranking.length === 0)
        return;
    const seen = new Set();
    for (const id of ranking) {
        if (seen.has(id))
            throw new basis_sdk_1.ValidationError("ranking", twiceText(label(id, f.names)));
        seen.add(id);
    }
    const paid = f.split ? f.split.length : 0;
    if (paid <= 0)
        return;
    const len = ranking.length;
    if (len < paid) {
        throw new basis_sdk_1.ValidationError(field, field === "outcome" ? outcomeNotRankingText(paid) : `This market pays ${paid} places: ranking needs at least ${paid} outcomes (got ${len}). ${PLACES_HINT}`);
    }
    let slot = 0;
    for (let g0 = 0; g0 < len;) {
        let g1 = g0 + 1;
        while (g1 < len && bit(tieMask, g1))
            g1++;
        if (slot + (g1 - g0) >= paid) {
            if (g1 !== len)
                throw new basis_sdk_1.ValidationError("ranking", pastText(placesText(paid), len));
            return;
        }
        slot += g1 - g0;
        g0 = g1;
    }
}
function readResult(f, a, allowEarly) {
    const options = allowEarly ? "outcome, ranking, invalid: true or early: true" : "outcome, ranking or invalid: true";
    const got = givenResults(a);
    if (got.length !== 1) {
        throw new basis_sdk_1.ValidationError("outcome", got.length ? `Pass only one of ${options} (got ${got.join(", ")}).` : `Name the result with one of ${options}.`);
    }
    if (a.tied?.length && a.ranking === undefined)
        throw new basis_sdk_1.ValidationError("tied", "tied goes with ranking only.");
    if (a.early) {
        if (!allowEarly)
            throw new basis_sdk_1.ValidationError("early", "EARLY can't be used here: name an outcome, a ranking or invalid: true.");
        return "early";
    }
    if (a.invalid)
        return { ranking: [], tieMask: 0n };
    const field = a.outcome !== undefined ? "outcome" : "ranking";
    const ids = a.outcome !== undefined
        ? [(0, outcomes_js_1.resolveOutcome)(f.names, a.outcome, "outcome")]
        : (a.ranking ?? []).map((e, i) => (0, outcomes_js_1.resolveOutcome)(f.names, e, `ranking[${i}]`));
    if (ids.length === 0)
        throw new basis_sdk_1.ValidationError("ranking", "ranking is empty: list the outcomes in finish order, or pass invalid: true.");
    let tieMask = 0n;
    for (const i of a.tied ?? []) {
        if (!Number.isInteger(i) || i < 1 || i >= ids.length) {
            throw new basis_sdk_1.ValidationError("tied", `tied takes positions 1 to ${ids.length - 1} of ranking (0 is the first entry: nothing before it to tie with).`);
        }
        tieMask |= 1n << BigInt(i);
    }
    const r = { ranking: sortTieGroups(ids, tieMask), tieMask };
    checkShape(f, r, field);
    return r;
}
function pickText(r, names) {
    return r === "early" ? EARLY_TEXT : resultText(r.ranking, r.tieMask, names);
}
function rankingRefusal(e, f, r, field) {
    const len = r.ranking.length;
    const num = (re) => {
        const m = re.exec(e.message);
        return m ? Number(m[1]) : undefined;
    };
    const paid = f.split?.length ?? num(/top (\d+) slots/) ?? num(/lists (\d+) to \d+ outcomes/);
    const paidText = paid === undefined ? "a set number of places" : placesText(paid);
    switch (e.rule) {
        case "duplicate": {
            const id = num(/Outcome (\d+)/);
            return twiceText(id === undefined ? "An outcome" : label(id, f.names));
        }
        case "outcomeRange":
        case "rankingEntry":
            return `That result names an outcome this market doesn't have: its outcomes are #0 to #${f.names.length - 1} (see get_market_resolution_status).`;
        case "rankingLength":
            return field === "outcome" && paid !== undefined && paid > 1 ? outcomeNotRankingText(paid) : `This market pays ${paidText}, and ranking lists ${len}. ${PLACES_HINT}`;
        case "tieBoundary":
            return pastText(paidText, len);
        case "tieOrder":
            return "Outcomes that share a place must be listed lowest id first.";
        case "tieMask":
        case "tieMaskBit0":
        case "tieMaskLength":
            return len < 2
                ? "tied goes with a ranking of two or more entries."
                : `tied takes positions 1 to ${len - 1} of ranking (0 is the first entry: nothing before it to tie with).`;
        case "tranches":
            return "This market has no paid places set, so it can't take a result.";
        case "Not a ranked market":
            return "This isn't a public prediction market. A private market is settled by its own voters: see private_get_market.";
        default:
            return `This market doesn't accept that result. ${PLACES_HINT}`;
    }
}
async function checkOnChain(client, f, r, field) {
    if (r.ranking.length === 0)
        return;
    try {
        await client.resolver.checkRanking(f.market, r.ranking, r.tieMask);
    }
    catch (e) {
        if (!(e instanceof basis_sdk_1.ValidationError))
            throw e;
        throw new basis_sdk_1.ValidationError(field, `${rankingRefusal(e, f, r, field)} Nothing was sent.`);
    }
}
function refuse(action, x, when) {
    if (x.allowed)
        return;
    const r = x.reason ?? "";
    throw new basis_sdk_1.ValidationError(action, `Can't ${action} now: ${ruleText(r)}${when && TIMED_RULES.has(r) ? ` (opens ${when})` : ""}. Nothing was sent.`);
}
function sameKey(k, key) {
    return !!k && k.key.toLowerCase() === key.toLowerCase();
}
async function planBonded(client, market, args, action) {
    const me = client.account;
    if (!me)
        throw new basis_sdk_1.WalletRequiredError();
    const pm = await publicMarket(client, market);
    const [f, s] = await Promise.all([factsOf(client, pm), client.resolver.getStatus(pm.market, me)]);
    const pick = readResult(f, args, action === "dispute");
    if (pick !== "early")
        await checkOnChain(client, f, pick, args.outcome !== undefined ? "outcome" : "ranking");
    const u = s.user;
    if (!u)
        throw new basis_sdk_1.WalletRequiredError();
    const d = s.deadlines;
    const t = (ts) => at(ts, s.now);
    const key = pick === "early" ? basis_sdk_1.KEY_EARLY : (0, basis_sdk_1.rankingKey)(pick.ranking, pick.tieMask);
    let bond;
    if (action === "propose") {
        const invalid = pick !== "early" && pick.ranking.length === 0;
        const when = d.proposeFromCreator ? `${t(d.proposeFromCreator)} for the creator, ${t(d.proposeFromOthers)} for everyone else` : undefined;
        refuse(action, invalid ? u.actions.proposeInvalid : u.actions.propose, when);
        bond = s.requiredBond;
    }
    else if (action === "dispute") {
        refuse(action, u.actions.dispute);
        if (sameKey(s.dispute?.originalKey, key)) {
            throw new basis_sdk_1.ValidationError("dispute", "A dispute must name a result different from the proposal (see get_market_proposal). Nothing was sent.");
        }
        bond = s.disputeBond;
    }
    else {
        refuse(action, u.actions.veto, t(d.vetoFrom));
        if (sameKey(s.dispute?.originalKey, key) || sameKey(s.dispute?.disputedKey, key)) {
            throw new basis_sdk_1.ValidationError("veto", "A veto must name a result different from both the proposal and the dispute (see get_market_proposal). Nothing was sent.");
        }
        bond = s.vetoBond;
    }
    if (bond === null)
        throw new basis_sdk_1.ValidationError(action, "Nothing is proposed on this market yet. Nothing was sent.");
    const b = await bondFormat(client, s.constants);
    const token = s.constants.BOND_TOKEN;
    const holds = bond > 0n ? await client.publicClient.readContract({ address: token, abi: viem_1.erc20Abi, functionName: "balanceOf", args: [me] }) : 0n;
    if (holds < bond) {
        throw new basis_sdk_1.ValidationError("bond", `This wallet doesn't hold enough ${b.symbol} for the bond: the bond is ${b.text(bond)}, this wallet holds ${b.text(holds)}. Get more ${b.symbol}, then try again. Nothing was sent.`);
    }
    await (0, limits_js_1.checkSpend)(client, token, bond);
    return { f, pick, s, bond, holds, b };
}
function rankedOnly(pick) {
    if (pick === "early")
        throw new basis_sdk_1.ValidationError("early", "EARLY can't be used here.");
    return pick;
}
const BOND_BACK_PROPOSE = "You get the bond back only if the market settles on this result: undisputed, finalize_market settles it once the " +
    "dispute window closes and returns the bond; disputed, the vote must back it (you then also get part of the disputer's bond).";
const BOND_LOST_PROPOSE = "If the market settles on anything else (another result after a dispute or a veto), or EARLY wins (the event hadn't " +
    "happened), the whole bond is lost; part of it can go to the disputer.";
const BOND_BACK_DISPUTE = "If the market settles on your result, you get the bond back plus part of the proposer's bond.";
const BOND_LOST_DISPUTE = "If the market settles on anything else (the proposal, another result after a veto), or EARLY wins, the whole bond is lost.";
const BOND_BACK_EARLY = "If EARLY wins, you get the bond back plus half the proposer's: the proposal is wiped, predictions reopen and the " +
    "next proposal bond doubles (the market isn't settled).";
const BOND_LOST_EARLY = "If the vote backs a result instead, or a veto wins, the whole bond is lost.";
const BOND_BACK_VETO = "BASIS then settles the market itself. If it settles on your result, you get the bond back plus a share of the proposer's and the disputer's bonds.";
const BOND_LOST_VETO = "If BASIS settles on any other result, the whole bond is lost.";
function bondedPreview(action, plan) {
    const { f, pick, s, bond, holds, b } = plan;
    const c = s.constants;
    const now = s.now;
    const t = (ts) => at(ts, now);
    const fromNow = (sec) => at(now + sec, now);
    const names = f.names;
    const result = pickText(pick, names);
    const finishOrder = pick !== "early" && pick.ranking.length > 1 ? places(pick.ranking, pick.tieMask, names) : undefined;
    const placesPaid = f.split ? f.split.length : undefined;
    const on = filed(s.dispute, names, b.fmt);
    const head = { status: "preview only", market: f.market, question: f.question ?? undefined };
    const money = { bond: b.fmt(bond), walletHolds: b.fmt(holds) };
    const sentNowNote = "ifSentNow times count from now: the real ones start when the transaction confirms.";
    if (action === "propose") {
        return (0, present_js_1.userContent)({
            ...head,
            wouldPropose: result,
            finishOrder,
            placesPaid,
            ...money,
            times: { ifSentNow: { disputeWindowCloses: fromNow(c.PROPOSAL_PERIOD) }, note: sentNowNote },
            whileLive: "Predictions on this market pause while the proposal is live.",
            bondBack: BOND_BACK_PROPOSE,
            bondLost: BOND_LOST_PROPOSE,
            message: NOT_SENT,
        });
    }
    if (action === "dispute") {
        const early = pick === "early";
        return (0, present_js_1.userContent)({
            ...head,
            disputing: on.proposal,
            wouldDisputeWith: result,
            finishOrder,
            placesPaid,
            ...money,
            times: {
                sendBefore: t(s.deadlines.disputeUntil),
                ifSentNow: {
                    votingUntil: fromNow(c.DISPUTE_PERIOD),
                    vetoWindowUntil: fromNow(c.DISPUTE_PERIOD + c.VETO_PERIOD),
                    finalizeFrom: fromNow(c.DISPUTE_PERIOD + c.VETO_PERIOD),
                    earlyFinalizeFrom: early ? fromNow(c.EARLY_FAST_PERIOD) : undefined,
                },
                note: sentNowNote,
            },
            then: "The BASIS voter panel decides. A veto window follows the vote, then finalize_market settles it.",
            bondBack: early ? BOND_BACK_EARLY : BOND_BACK_DISPUTE,
            bondLost: early ? BOND_LOST_EARLY : BOND_LOST_DISPUTE,
            message: NOT_SENT,
        });
    }
    return (0, present_js_1.userContent)({
        ...head,
        proposal: on.proposal,
        dispute: on.dispute,
        voteLeading: keyText(s.tally.leader, names),
        wouldVetoToward: result,
        finishOrder,
        placesPaid,
        ...money,
        times: {
            sendBefore: `anyone settles it with finalize_market (open to anyone from ${t(s.deadlines.finalizeFrom) ?? "the end of the veto window"})`,
            after: "BASIS settles the market itself, at no set time; nobody can finalize it after a veto.",
        },
        bondBack: BOND_BACK_VETO,
        bondLost: BOND_LOST_VETO,
        message: NOT_SENT,
    });
}
function phaseOf(s, t, bond) {
    const d = s.deadlines;
    const c = s.constants;
    const now = s.now;
    if (s.isResolved) {
        return s.finalOutcome === basis_sdk_1.OUTCOME_INVALID
            ? { phase: "invalidated", next: "Settled as INVALID: holders redeem with redeem_market for a refund instead of a winner payout." }
            : { phase: "resolved", next: "Settled: holders collect with redeem_market. get_final_outcome shows the finish order." };
    }
    if (s.inVeto) {
        return { phase: "vetoed", next: "A veto was filed after the vote, so BASIS settles this market itself. Nothing to do until it does." };
    }
    if (s.inDispute) {
        const leader = s.tally.leader;
        const earlyNow = leader?.kind === "early" && !s.tally.tie && s.tally.totalVotes >= c.MIN_QUORUM && d.earlyFastFrom !== undefined && now >= d.earlyFastFrom;
        if (earlyNow) {
            return {
                phase: "awaiting_finalize",
                next: "EARLY leads alone with enough votes, so anyone can close the vote now with finalize_market: the proposal is wiped and predictions reopen (the market isn't settled).",
            };
        }
        if (d.voteUntil !== undefined && now < d.voteUntil) {
            return {
                phase: "voting",
                next: `Disputed: the BASIS voter panel decides by ${t(d.voteUntil)}. A veto window follows, then finalize_market from ${t(d.finalizeFrom)}.`,
            };
        }
        if (d.finalizeFrom !== undefined && now < d.finalizeFrom) {
            return {
                phase: "veto_window",
                next: `Voting has closed. Until ${t(d.finalizeFrom)} anyone except the proposer and the disputer can use veto_outcome toward a different result (bond ${bond(s.vetoBond)}); then finalize_market settles it.`,
            };
        }
        return {
            phase: "awaiting_finalize",
            next: `Anyone can settle it now with finalize_market (veto_outcome is still possible until then). Fewer than ${c.MIN_QUORUM} votes, or a tie, starts a new voting round instead.`,
        };
    }
    if (s.hasProposal) {
        if (d.disputeUntil !== undefined && now < d.disputeUntil) {
            return {
                phase: "proposed",
                next: `A result is proposed and predictions are paused. Anyone else can use dispute_outcome until ${t(d.disputeUntil)} (bond ${bond(s.disputeBond)}); undisputed, finalize_market settles it after that.`,
            };
        }
        return { phase: "proposed_closed", next: "The dispute window closed with no dispute: anyone can settle it with finalize_market, which returns the proposer's bond." };
    }
    if (d.proposeFromCreator === 0) {
        return {
            phase: "active",
            next: `Open-ended market: predictions stay open until someone proposes a result, which anyone can do at any time with propose_outcome (bond ${bond(s.requiredBond)}).`,
        };
    }
    if (now < d.proposeFromCreator) {
        return {
            phase: "active",
            next: `Predictions are open. propose_outcome opens ${t(d.proposeFromCreator)} for the creator and ${t(d.proposeFromOthers)} for everyone else.`,
        };
    }
    const creatorOnly = now < d.proposeFromOthers ? `; until ${t(d.proposeFromOthers)} only the creator can` : "";
    return { phase: "awaiting_proposal", next: `The market has ended with no proposal yet: propose_outcome posts one (bond ${bond(s.requiredBond)})${creatorOnly}.` };
}
function actionsOf(s, t) {
    const u = s.user;
    if (!u)
        return {};
    const d = s.deadlines;
    const why = (x, when) => {
        if (x.allowed)
            return "yes";
        const r = x.reason ?? "";
        return `no: ${ruleText(r)}${when && TIMED_RULES.has(r) ? ` (opens ${when})` : ""}`;
    };
    const proposeWhen = d.proposeFromCreator ? `${t(d.proposeFromCreator)} for the creator, ${t(d.proposeFromOthers)} for others` : undefined;
    const out = { propose_outcome: why(u.actions.propose, proposeWhen) };
    if (u.actions.proposeInvalid.allowed !== u.actions.propose.allowed)
        out["propose_outcome with invalid: true"] = why(u.actions.proposeInvalid, proposeWhen);
    out.dispute_outcome = why(u.actions.dispute);
    out.veto_outcome = why(u.actions.veto, t(d.vetoFrom));
    out.finalize_market = s.inDispute
        ? why(u.actions.finalizeMarket, t(d.finalizeFrom))
        : why(u.actions.finalizeUncontested, t(d.finalizeUncontestedFrom));
    return out;
}
const marketParam = () => registry_js_1.p.address("Public prediction market address (0x...).");
const roundParam = () => registry_js_1.p.optId("Voting round number. Default: the current round.");
const SETTLE_TOOLS = "propose_outcome, dispute_outcome, veto_outcome and finalize_market";
exports.resolverTools = [
    (0, registry_js_1.tool)({
        name: "get_market_resolution_status",
        toolset: "markets",
        title: "Settlement status",
        description: "Start here to settle a public prediction market: its phase (active, awaiting_proposal, proposed, proposed_closed, " +
            "voting, veto_window, awaiting_finalize, vetoed, resolved, invalidated), the next step, the proposal, dispute and " +
            "vote so far, the bond a wallet would post now, the key times, the outcomes, the paid places, and which of " +
            `${SETTLE_TOOLS} that wallet can use right now.`,
        input: {
            market: marketParam(),
            wallet: registry_js_1.p.wallet("Wallet to check bonds and allowed actions for. Default: this server's wallet."),
        },
        run: async ({ market, wallet }, ctx) => {
            const client = await ctx.client();
            const pm = await publicMarket(client, market);
            const who = wallet ? (0, units_js_1.addr)(wallet, "wallet") : client.account;
            const [s, f] = await Promise.all([client.resolver.getStatus(pm.market, who), factsOf(client, pm)]);
            const { names, split } = f;
            const m = f.market;
            const { fmt, text } = await bondFormat(client, s.constants);
            const now = s.now;
            const d = s.deadlines;
            const t = (ts) => at(ts, now);
            const { phase, next } = phaseOf(s, t, text);
            const bondsNow = {};
            if (!s.isResolved && !s.inVeto) {
                if (!s.hasProposal)
                    bondsNow.toPropose = fmt(s.requiredBond);
                else if (!s.inDispute)
                    bondsNow.toDispute = fmt(s.disputeBond);
                else
                    bondsNow.toVeto = fmt(s.vetoBond);
            }
            return (0, present_js_1.userContent)({
                market: m,
                question: f.question ?? undefined,
                phase,
                next,
                chainTime: iso(now),
                invalidLive: s.invalidLive,
                invalidNote: s.invalidLive
                    ? "INVALID is live (it's the proposed result, or a panel voter voted INVALID this round): order-book fills are paused."
                    : undefined,
                result: s.isResolved
                    ? s.finalOutcome === basis_sdk_1.OUTCOME_INVALID
                        ? INVALID_TEXT
                        : `first place: ${label(s.finalOutcome, names)} (get_final_outcome for the full order)`
                    : undefined,
                ...filed(s.dispute, names, fmt),
                voting: s.inDispute
                    ? {
                        round: s.currentRound,
                        votesCast: s.tally.totalVotes,
                        leading: keyText(s.tally.leader, names),
                        leaderVotes: s.tally.leaderCount,
                        tie: s.tally.tie,
                        votesNeededToSettle: s.constants.MIN_QUORUM,
                        panelSize: s.voterCount,
                    }
                    : undefined,
                bondsNow: Object.keys(bondsNow).length ? bondsNow : undefined,
                earlyResets: s.earlyResets
                    ? `${s.earlyResets} (each EARLY win wiped the proposal and doubled the next proposal bond)`
                    : undefined,
                times: {
                    proposeFrom: s.hasProposal || s.isResolved
                        ? undefined
                        : d.proposeFromCreator === 0
                            ? "any time (open-ended market)"
                            : { creator: t(d.proposeFromCreator), others: t(d.proposeFromOthers) },
                    disputeUntil: t(d.disputeUntil),
                    voteUntil: t(d.voteUntil),
                    vetoFrom: t(d.vetoFrom),
                    finalizeFrom: t(d.finalizeUncontestedFrom ?? d.finalizeFrom),
                    earlyFinalizeFrom: t(d.earlyFastFrom),
                },
                outcomes: names.map((name, id) => ({ id, name })),
                outcomesNote: "Name an outcome by its name, or by its id as \"#0\".",
                placesPaid: split ? split.length : undefined,
                poolSplitPercent: split ? split.map((bp) => Number(bp) / 100) : undefined,
                wallet: s.user
                    ? {
                        address: s.user.address,
                        flatBondProposer: s.user.isTrustedProposer,
                        canUseNow: actionsOf(s, t),
                        note: "A dispute must name a result different from the proposal, and a veto one different from both; the preview checks that.",
                    }
                    : `Pass wallet to see which of ${SETTLE_TOOLS} a wallet can use.`,
            });
        },
    }),
    (0, registry_js_1.tool)({
        name: "get_resolver_constants",
        toolset: "markets",
        title: "Settlement rules",
        description: "The settlement rules: how long each window lasts (dispute, voting, veto), how many votes settle a dispute, and " +
            "the bond sizes and caps in the bond token. Pass a market to read the rules it was created with; without one, the " +
            "rules for new markets.",
        input: { market: registry_js_1.p.address("Public prediction market address (0x...). Optional.").optional() },
        run: async ({ market }, ctx) => {
            const client = await ctx.client();
            const m = market ? (await publicMarket(client, market)).market : undefined;
            const c = await client.resolver.getConstants(m);
            const { fmt, symbol } = await bondFormat(client, c);
            return {
                market: m ?? "rules for new markets",
                disputeWindow: dur(c.PROPOSAL_PERIOD),
                votingWindow: dur(c.DISPUTE_PERIOD),
                vetoWindow: dur(c.VETO_PERIOD),
                earlyFinalizeAfter: dur(c.EARLY_FAST_PERIOD),
                votesNeededToSettle: c.MIN_QUORUM,
                bondToken: { symbol, address: c.BOND_TOKEN },
                proposalBond: fmt(c.PROPOSAL_BOND),
                proposalBondMax: fmt(c.BOND_MAX),
                disputeAndVetoBondCap: fmt(c.BOND_CAP),
                vetoBondMin: fmt(c.VETO_FLOOR),
                flatBond: fmt(c.TRUSTED_BOND),
                explained: {
                    disputeWindow: "After a proposal, anyone else can dispute it for this long. Undisputed, it can be finalized once this has passed.",
                    votingWindow: "After a dispute, the BASIS voter panel votes for this long.",
                    vetoWindow: "After voting closes, a veto can be filed for this long; then the market can be finalized.",
                    earlyFinalizeAfter: "If EARLY leads alone with enough votes, the vote can be closed this long after the dispute.",
                    proposalBond: "The base bond to propose. Each EARLY win on a market doubles its next proposal bond, up to proposalBondMax.",
                    disputeBond: "A dispute matches the proposal's bond: at least proposalBond, at most disputeAndVetoBondCap.",
                    vetoBond: "A veto matches the proposal's bond: at least vetoBondMin, at most disputeAndVetoBondCap.",
                    flatBond: "Proposers listed by BASIS post this flat bond to propose or dispute.",
                    bonds: BOND_TEXT,
                },
            };
        },
    }),
    (0, registry_js_1.tool)({
        name: "get_market_proposal",
        toolset: "markets",
        title: "Live proposal",
        description: "The live proposal on a public prediction market: who proposed which result and their bond, plus any dispute and " +
            "veto with their results and bonds. A null part means nothing filed yet.",
        input: { market: marketParam() },
        run: async ({ market }, ctx) => {
            const client = await ctx.client();
            const { market: m, host } = await publicMarket(client, market);
            const [d, c, names] = await Promise.all([client.resolver.getDisputeData(m), client.resolver.getConstants(m), outcomeNames(client, host, m)]);
            const { fmt } = await bondFormat(client, c);
            if (!d)
                return { market: m, proposal: null, note: "Nothing proposed. get_market_resolution_status shows when proposing opens." };
            return (0, present_js_1.userContent)({ market: m, ...filed(d, names, fmt) });
        },
    }),
    (0, registry_js_1.tool)({
        name: "get_vote_count",
        toolset: "markets",
        title: "Vote count",
        description: "Votes in a disputed market's voting round (default: the current round): votes cast, the leading result, whether " +
            "it's tied, and the votes needed to settle. Name a result (outcome, ranking, invalid or early) to also get its count.",
        input: {
            market: marketParam(),
            round: roundParam(),
            ...resultShape,
            early: registry_js_1.p.bool("true: count the votes for EARLY (the event hasn't happened yet)."),
        },
        run: async (args, ctx) => {
            const client = await ctx.client();
            const pm = await publicMarket(client, args.market);
            const m = pm.market;
            const round = args.round !== undefined ? (0, units_js_1.uint)(args.round, "round") : BigInt(await client.resolver.getCurrentRound(m));
            const f = await factsOf(client, pm);
            const pick = givenResults(args).length ? readResult(f, args, true) : null;
            const [tally, c, panel] = await Promise.all([client.resolver.getTally(m, round), client.resolver.getConstants(m), client.resolver.getVoterCount(m)]);
            let forResult;
            if (pick) {
                const key = pick === "early" ? basis_sdk_1.KEY_EARLY : (0, basis_sdk_1.rankingKey)(pick.ranking, pick.tieMask);
                forResult = { result: pickText(pick, f.names), votes: await client.resolver.getVoteCount(m, round, key) };
            }
            return (0, present_js_1.userContent)({
                market: m,
                round,
                votesCast: tally.totalVotes,
                leading: keyText(tally.leader, f.names),
                leaderVotes: tally.leaderCount,
                tie: tally.tie,
                votesNeededToSettle: c.MIN_QUORUM,
                panelSize: panel,
                forResult,
            });
        },
    }),
    (0, registry_js_1.tool)({
        name: "get_voter_choice",
        toolset: "markets",
        title: "Voter's choice",
        description: "Whether a wallet on the BASIS voter panel voted in a disputed market's voting round (default: the current round), and what it voted for.",
        input: {
            market: marketParam(),
            round: roundParam(),
            voter: registry_js_1.p.wallet("Voter wallet. Default: this server's wallet."),
        },
        run: async ({ market, round, voter }, ctx) => {
            const client = await ctx.client();
            const { market: m, host } = await publicMarket(client, market);
            const who = (0, units_js_1.walletOrSelf)(client, voter, "voter");
            const r = round !== undefined ? (0, units_js_1.uint)(round, "round") : BigInt(await client.resolver.getCurrentRound(m));
            const [voted, choice, names] = await Promise.all([
                client.resolver.hasVoted(m, r, who),
                client.resolver.getVoterChoice(m, r, who),
                outcomeNames(client, host, m),
            ]);
            return (0, present_js_1.userContent)({ market: m, round: r, voter: who, voted, choice: keyText(choice, names) });
        },
    }),
    (0, registry_js_1.tool)({
        name: "get_final_outcome",
        toolset: "markets",
        title: "Final result",
        description: "The settled result of a public prediction market: the finish order with ties (first place wins), INVALID, or " +
            "not settled yet, with the time it settled.",
        input: { market: marketParam() },
        run: async ({ market }, ctx) => {
            const client = await ctx.client();
            const { market: m, host } = await publicMarket(client, market);
            if (!(await client.resolver.isResolved(m))) {
                return { market: m, settled: false, next: "Not settled yet: get_market_resolution_status shows where it stands." };
            }
            const pc = client.publicClient;
            const [fo, names, rawRanking, tieMask, resolvedAt] = await Promise.all([
                client.resolver.getFinalOutcome(m),
                outcomeNames(client, host, m),
                pc.readContract({ address: host, abi: basis_sdk_1.TrancheMarketAbi, functionName: "getFinalRanking", args: [m] }),
                pc.readContract({ address: host, abi: basis_sdk_1.TrancheMarketAbi, functionName: "finalTieMask", args: [m] }),
                pc.readContract({ address: host, abi: basis_sdk_1.TrancheMarketAbi, functionName: "resolvedAt", args: [m] }),
            ]);
            const settledAt = resolvedAt > 0n ? iso(Number(resolvedAt)) : null;
            if (fo === basis_sdk_1.OUTCOME_INVALID) {
                return { market: m, settled: true, result: INVALID_TEXT, settledAt, next: "Holders redeem with redeem_market for a refund instead of a winner payout." };
            }
            const ranking = Array.from(rawRanking, Number);
            if (ranking.length === 0) {
                return (0, present_js_1.userContent)({ market: m, settled: true, result: `1st: ${label(fo, names)}`, winners: [label(fo, names)], settledAt, next: "Holders collect with redeem_market." });
            }
            const order = places(ranking, tieMask, names);
            return (0, present_js_1.userContent)({
                market: m,
                settled: true,
                result: resultText(ranking, tieMask, names),
                winners: order.filter((e) => e.place === 1).map((e) => label(e.id, names)),
                finishOrder: order,
                settledAt,
                next: "Holders collect with redeem_market.",
            });
        },
    }),
    (0, registry_js_1.tool)({
        name: "get_invalid_state",
        toolset: "markets",
        title: "INVALID state",
        description: "Whether INVALID is live on a public prediction market (it's the proposed result, or a panel voter voted INVALID " +
            "this round; order-book fills pause while it is), and whether the market settled as INVALID.",
        input: { market: marketParam() },
        run: async ({ market }, ctx) => {
            const client = await ctx.client();
            const { market: m } = await publicMarket(client, market);
            const [live, resolved] = await Promise.all([client.resolver.isInvalidLive(m), client.resolver.isResolved(m)]);
            const settledInvalid = resolved ? (await client.resolver.getFinalOutcome(m)) === basis_sdk_1.OUTCOME_INVALID : false;
            return {
                market: m,
                invalidLive: live,
                settledInvalid,
                meaning: settledInvalid
                    ? "Settled as INVALID: holders redeem with redeem_market for a refund instead of a winner payout."
                    : live
                        ? "INVALID is live: order-book fills are paused until that changes (a new voting round starts clean)."
                        : "INVALID isn't live on this market.",
            };
        },
    }),
    (0, registry_js_1.tool)({
        name: "propose_outcome",
        toolset: "markets",
        title: "Propose a result",
        description: "Propose the result of a public prediction market, posting a bond (its size and when proposing opens: " +
            "get_market_resolution_status). Name it with outcome (one winner), ranking (finish order, for markets that pay " +
            "several places) or invalid: true. Predictions pause while it's live. Undisputed, finalize_market settles it after " +
            "the dispute window and returns your bond; if the market settles on anything else, the bond is lost. Without " +
            "confirm: true it only shows the preview (nothing is sent).",
        input: { market: marketParam(), ...resultShape, confirm: registry_js_1.p.confirm() },
        write: true,
        destructive: true,
        run: async (args, ctx) => {
            const client = await ctx.client();
            const plan = await planBonded(client, args.market, args, "propose");
            if (args.confirm !== true)
                return bondedPreview("propose", plan);
            const { f, s } = plan;
            const r = rankedOnly(plan.pick);
            const res = await withBondHelp(client, f.market, () => client.resolver.propose(f.market, r.ranking, r.tieMask));
            return (0, present_js_1.userContent)(resolverTxOut(client, res, {
                market: f.market,
                question: f.question ?? undefined,
                proposed: pickText(r, f.names),
                next: `Anyone else can dispute it for ${dur(s.constants.PROPOSAL_PERIOD)}. Undisputed, finalize_market then settles it and returns your bond; get_market_resolution_status shows the times.`,
            }));
        },
    }),
    (0, registry_js_1.tool)({
        name: "dispute_outcome",
        toolset: "markets",
        title: "Dispute a result",
        description: "Dispute the proposed result of a public prediction market before the dispute window closes, posting a bond " +
            "(see get_market_resolution_status). Name the result you think is right (outcome, ranking or invalid: true), or " +
            "early: true if the event hasn't happened yet. The BASIS voter panel then decides; a dispute that loses forfeits " +
            "its bond. Without confirm: true it only shows the preview (nothing is sent).",
        input: {
            market: marketParam(),
            ...resultShape,
            early: registry_js_1.p.bool("true: the event hasn't happened yet. If EARLY wins, you get your bond back plus half the proposer's, the " +
                "proposal is wiped, predictions reopen and the next proposal bond doubles."),
            confirm: registry_js_1.p.confirm(),
        },
        write: true,
        destructive: true,
        run: async (args, ctx) => {
            const client = await ctx.client();
            const plan = await planBonded(client, args.market, args, "dispute");
            if (args.confirm !== true)
                return bondedPreview("dispute", plan);
            const { f, s, pick } = plan;
            const m = f.market;
            const res = await withBondHelp(client, m, () => (pick === "early" ? client.resolver.disputeEarly(m) : client.resolver.dispute(m, pick.ranking, pick.tieMask)));
            return (0, present_js_1.userContent)(resolverTxOut(client, res, {
                market: m,
                question: f.question ?? undefined,
                disputedWith: pickText(pick, f.names),
                next: `The BASIS voter panel decides over the next ${dur(s.constants.DISPUTE_PERIOD)}; get_market_resolution_status shows the times.`,
            }));
        },
    }),
    (0, registry_js_1.tool)({
        name: "veto_outcome",
        toolset: "markets",
        title: "Veto the vote",
        description: "Veto a disputed public prediction market toward a different result once voting has closed and before it's " +
            "finalized: anyone but the proposer and the disputer, once per market, posting a bond (see " +
            "get_market_resolution_status). The result must differ from both the proposal and the dispute (outcome, ranking " +
            "or invalid: true; not EARLY). BASIS then settles the market itself: a losing veto loses its whole bond, a winning " +
            "one gets it back plus a share of the other bonds. Without confirm: true it only shows the preview (nothing is sent).",
        input: { market: marketParam(), ...resultShape, confirm: registry_js_1.p.confirm() },
        write: true,
        destructive: true,
        run: async (args, ctx) => {
            const client = await ctx.client();
            const plan = await planBonded(client, args.market, args, "veto");
            if (args.confirm !== true)
                return bondedPreview("veto", plan);
            const { f } = plan;
            const r = rankedOnly(plan.pick);
            const res = await withBondHelp(client, f.market, () => client.resolver.veto(f.market, r.ranking, r.tieMask));
            return (0, present_js_1.userContent)(resolverTxOut(client, res, {
                market: f.market,
                question: f.question ?? undefined,
                vetoedToward: pickText(r, f.names),
                next: "BASIS now settles this market itself.",
            }));
        },
    }),
    (0, registry_js_1.tool)({
        name: "finalize_market",
        toolset: "markets",
        title: "Finalize a market",
        description: "Settle a public prediction market once its windows have passed: an undisputed proposal after the dispute window, " +
            "a disputed one after voting and the veto window. Anyone can call it (gas only); bonds are paid out in the same " +
            "transaction. Too few votes or a tie starts a new voting round instead, and an EARLY win wipes the proposal.",
        input: { market: marketParam() },
        write: true,
        run: async ({ market }, ctx) => {
            const client = await ctx.client();
            const { market: m, host } = await publicMarket(client, market);
            const [s, names] = await Promise.all([client.resolver.getStatus(m), outcomeNames(client, host, m)]);
            const t = (ts) => at(ts, s.now);
            if (s.isResolved)
                throw new basis_sdk_1.ValidationError("market", "This market is already settled. Holders collect with redeem_market.");
            if (s.inVeto)
                throw new basis_sdk_1.ValidationError("market", "A veto was filed, so BASIS settles this market itself: there's nothing to finalize.");
            let path;
            if (s.inDispute) {
                const a = s.user?.actions.finalizeMarket;
                if (a && !a.allowed) {
                    throw new basis_sdk_1.ValidationError("market", a.reason === "Wait more"
                        ? `Not yet: this disputed market can be finalized from ${t(s.deadlines.finalizeFrom)} (after voting and the veto window).`
                        : `Can't finalize: ${ruleText(a.reason)}.`);
                }
                path = "after the vote";
            }
            else if (s.hasProposal) {
                const a = s.user?.actions.finalizeUncontested;
                if (a && !a.allowed) {
                    throw new basis_sdk_1.ValidationError("market", a.reason === "Wait more"
                        ? `Not yet: the dispute window runs until ${t(s.deadlines.finalizeUncontestedFrom)}.`
                        : `Can't finalize: ${ruleText(a.reason)}.`);
                }
                path = "undisputed";
            }
            else {
                throw new basis_sdk_1.ValidationError("market", "Nothing to finalize: no result has been proposed yet (propose_outcome posts one).");
            }
            const r = s.inDispute ? await client.resolver.finalizeMarket(m) : await client.resolver.finalizeUncontested(m);
            const { key, seized, swept, payouts, outcome, round, earlyResets, ...tx } = r;
            const settled = outcome === "resolved" && key ? keyText(await client.resolver.decodeKey(m, key).catch(() => null), names) : null;
            const whatHappened = outcome === "resolved"
                ? `Settled: ${settled ?? "see get_final_outcome"}. Holders collect with redeem_market.`
                : outcome === "reopened"
                    ? `Not settled: too few votes or a tie, so voting round ${round ?? "?"} started.`
                    : outcome === "earlyReset"
                        ? "EARLY won: the proposal is wiped, predictions reopen until the end time, and the next proposal bond doubles."
                        : "Confirmed, but the result wasn't in the logs: check get_market_resolution_status.";
            return (0, present_js_1.userContent)((0, present_js_1.txOut)(client, tx, {
                market: m,
                path,
                outcome,
                whatHappened,
                newRound: outcome === "resolved" ? undefined : round ?? undefined,
                earlyResets: earlyResets ?? undefined,
                bondPayouts: payouts.map((x) => ({
                    to: x.to,
                    amount: x.amount,
                    ...(x.redirected ? { note: "That wallet couldn't receive the token, so it went to the protocol's insurance fund." } : {}),
                })),
                bondsKeptByProtocol: seized.raw > 0n ? seized : undefined,
                potToFees: swept.raw > 0n ? swept : undefined,
                potNote: swept.raw > 0n ? "Nobody held a winning outcome, so the market's pot went to BASIS fees." : undefined,
            }));
        },
    }),
];
