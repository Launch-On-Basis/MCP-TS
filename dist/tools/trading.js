"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tradingTools = void 0;
const zod_1 = require("zod");
const viem_1 = require("viem");
const basis_sdk_1 = require("basis-sdk");
const registry_js_1 = require("../registry.js");
const units_js_1 = require("../units.js");
const present_js_1 = require("../present.js");
const errors_js_1 = require("../errors.js");
const limits_js_1 = require("../limits.js");
const DAY = 86400n;
const BATCH = 10;
const NOT_SENT = "Nothing was sent. Call again with confirm: true to send.";
const REFUSED_NOW = "It would be refused now (see blocked). Nothing was sent.";
const eq = (a, b) => a.toLowerCase() === b.toLowerCase();
const isZero = (a) => /^0x0{40}$/i.test(a);
const nowSec = () => BigInt(Math.floor(Date.now() / 1000));
const isAll = (v) => typeof v === "string" && v.trim().toLowerCase() === "all";
const show = (raw, decimals, symbol) => `${(0, viem_1.formatUnits)(raw, decimals)} ${symbol}`;
const showPair = (info, raw) => show(raw, info.pairDecimals, info.pairSymbol);
const bpsText = (bps) => `${Number(bps) / 100}%`;
const iso = (secs) => (secs > 0n ? new Date(Number(secs) * 1000).toISOString() : null);
const mainName = (info) => info.key ?? info.symbol;
async function showToken(client, token, raw) {
    const m = await client.mains.tokenMeta(token);
    return show(raw, m.decimals, m.symbol);
}
async function routeText(client, path) {
    const metas = await Promise.all(path.map((t) => client.mains.tokenMeta(t)));
    return metas.map((m) => m.symbol).join(" > ");
}
async function inBatches(items, fn, size = BATCH) {
    const out = [];
    for (let i = 0; i < items.length; i += size) {
        const part = items.slice(i, i + size);
        out.push(...(await Promise.all(part.map((x) => fn(x)))));
    }
    return out;
}
const BLOCKED = {
    "no route": "There is no route between these two tokens.",
    "pair paused": "Trading on a main on this route is paused right now.",
    "trading not enabled": "Trading on this main hasn't opened yet.",
    "pair asset paused": "A pair asset this trade would move (e.g. USDG, on the route, as its fee, or as holder rewards a sale pays out) is paused by its issuer right now. Try again once it resumes.",
    "no executor": "Swaps through an outside exchange aren't available on this network yet.",
    "autovest presale": "The token you want is in an auto-vest presale: buy it with buy_token (with its main's pair asset or the main), not by swapping from another token.",
    "not whitelisted": "The token you want is in an invite-only presale and this wallet isn't on its list.",
    "Overcapped on WL buying": "This is more than what's left of this wallet's presale allowance for the token: use a smaller amount.",
    "above cap": "The outside-exchange step is over its size limit right now: use a smaller amount, or wait about 12 seconds and quote again.",
    "too small": "The amount is too small to trade.",
};
const blockedText = (b) => (b === null ? null : (BLOCKED[b] ?? `The chain would refuse it right now (${b}).`));
const KIND = {
    buy: "buy",
    sell: "sell",
    cross: "swap across mains",
    hop: "swap through an outside exchange",
};
async function metaOf(client, t) {
    if (!t)
        return null;
    try {
        return await client.mains.tokenMeta(t);
    }
    catch {
        return null;
    }
}
const PATH_RULES = new Set(["Bad path", "Alien output", "Bad pair", "Not pair asset", "Not ecosystem", "Wrong token", "Not MAIN", "wrong path"]);
async function plainError(client, e, c) {
    if (!(e instanceof basis_sdk_1.ValidationError))
        return e;
    const rule = e.rule;
    const msg = e.message.replace(/\[basis-sdk\]\s*/g, "");
    const done = c.write ? " Nothing was sent." : "";
    const say = (text) => new basis_sdk_1.ValidationError(rule, text + done);
    const info = c.info;
    const sym = info?.symbol ?? "this main";
    const pairSym = info?.pairSymbol ?? "the pair asset";
    const P = info ? (s) => showPair(info, BigInt(s)) : null;
    const pos = c.id !== undefined ? `Position ${c.id} on ${sym}` : "This position";
    const amountOf = async (t, s) => {
        const m = await metaOf(client, t);
        return m ? show(BigInt(s), m.decimals, m.symbol) : null;
    };
    let m;
    if (PATH_RULES.has(rule))
        return say("Those tokens can't be traded this way. Check the token addresses, or quote it with quote_swap.");
    switch (rule) {
        case "same token":
            return say("token_in and token_out are the same token.");
        case "Under 2x": {
            m = /collateral (\d+) vs spot (\d+)/.exec(msg);
            const [col, spot] = m ? await Promise.all([amountOf(c.token, m[1]), amountOf(c.token, m[2])]) : [null, null];
            const figures = col && spot ? `: the position would hold ${col}, not over 2x the ${spot} a plain buy gets` : "";
            return say(`This is under the 2x minimum for leverage${figures}. Try more days, a higher leverage_percent or a different amount (check with quote_leverage).`);
        }
        case "Repay in full": {
            m = /Repaying (\d+) of (\d+) would leave (\d+), under the minimum loan (\d+): repay at most (\d+)/.exec(msg);
            if (m && P) {
                return say(`Repaying ${P(m[1])} of the ${P(m[2])} debt would leave ${P(m[3])}, under the ${P(m[4])} that must stay owed on an open position. ` +
                    `Repay at most ${P(m[5])}, or "all" to repay in full (check with quote_repay_leverage).`);
            }
            m = /(\d+) of (\S+) converts to (\d+) \(up to (\d+) after slippage\), which could leave under the minimum loan (\d+) of the (\d+) debt: repay at most (\d+)/.exec(msg);
            if (m && P) {
                const paid = (await amountOf(c.tokenIn, m[1])) ?? "That amount";
                return say(`${paid} converts to about ${P(m[3])} (up to ${P(m[4])} after slippage), which could leave less than the ${P(m[5])} that must stay owed on the ${P(m[6])} debt. ` +
                    `Pay less (converting to at most ${P(m[7])}, less the slippage), or "all" to repay in full (check with quote_repay_leverage_with).`);
            }
            return say(`A partial repay must leave at least the main's minimum debt: repay less, or "all" to repay in full (check with quote_repay_leverage).`);
        }
        case "Not enough to close": {
            m = /(\d+) of (\S+) converts to (\d+), under the (\d+) debt/.exec(msg);
            const paid = m ? await amountOf(c.tokenIn, m[1]) : null;
            const figures = m && P && paid ? ` (${paid} converts to about ${P(m[3])}, under the ${P(m[4])} debt)` : "";
            return say(`The most the outside route takes right now doesn't cover the whole debt${figures}. Repay part of it with an amount, wait about 12 seconds and try again, or repay in ${pairSym} with repay_leverage.`);
        }
        case "above cap": {
            m = /Repaying (\d+) of (\S+) is above the route's (\d+) cap/.exec(msg);
            if (m && P) {
                return say(`The debt (${P(m[1])}) is over the outside route's size limit (${P(m[3])}), so it can't be repaid in full with this token in one go. Repay part of it with an amount, or repay in ${pairSym} with repay_leverage.`);
            }
            m = /Repaying (\d+) of (\S+) is above what the route has left now \((\d+) of (\S+) in, (\d+) of (\S+) out\)/.exec(msg);
            if (m && P) {
                return say(`The debt (${P(m[1])}) is over what the outside route has left in this window (about ${P(m[5])}). Wait about 12 seconds and try again, repay part of it with an amount, or repay in ${pairSym} with repay_leverage.`);
            }
            return say(`The outside route can't take that much right now: wait about 12 seconds and try again, use a smaller amount, or repay in ${pairSym} with repay_leverage.`);
        }
        case "quote": {
            const t = await metaOf(client, c.tokenIn);
            return say(`Couldn't work out from the outside route's quotes how much ${t?.symbol ?? "of that token"} repays the debt right now. Pass an amount, wait about 12 seconds and try again, or repay in ${pairSym} with repay_leverage.`);
        }
        case "Below min stake": {
            m = /(\d+) raw \S+ buys (\d+) raw \S+, under the vault's minimum stake (\d+)/.exec(msg);
            if (m && info) {
                const main = (s) => show(BigInt(s), 18, info.symbol);
                return say(`${showPair(info, BigInt(m[1]))} buys about ${main(m[2])}, under the vault's minimum stake of ${main(m[3])}: spend more.`);
            }
            return say("That buys less than the vault's minimum stake: spend more.");
        }
        case "balance": {
            if (/Nothing to sell/.test(msg))
                return say("Nothing to sell: this wallet holds none of this token, or the share asked for rounds to 0.");
            return e;
        }
        case "WL cap": {
            m = /takes (\d+) tokens, over what is left of the wallet's presale cap \((\d+) of (\d+)\)/.exec(msg);
            const [a, left] = m ? await Promise.all([amountOf(c.token, m[1]), amountOf(c.token, m[2])]) : [null, null];
            const figures = a && left ? ` (it would hold ${a}, and ${left} of the allowance is left)` : "";
            return say(`This position is more than what is left of this wallet's presale allowance on the token${figures}: use a smaller amount.`);
        }
        case "No WL for freeze":
            return say("This token is in an invite-only presale and this wallet isn't on its list, so it can't take leverage on it yet.");
        case "In presale":
            return say("This token is in an auto-vest presale: leverage on it opens once the presale is complete (buy it with buy_token meanwhile).");
        case "Extend first": {
            m = /open position (\d+) on this token has (\d+) days left, under the minimum (\d+)/.exec(msg);
            if (m) {
                const where = info ? `main ${mainName(info)}, ` : "";
                return say(`Your open position ${m[1]} on this token has ${m[2]} days left, under the minimum of ${m[3]}: extend it first with extend_leverage (${where}position_id ${m[1]}), then add to it.`);
            }
            return say("Your open position on this token has too few days left to add to: extend it first with extend_leverage, then add to it.");
        }
        case "Trading is not enabled":
            return say(`Trading on ${sym} hasn't opened yet: no leverage until it does.`);
        case "unknown pair":
        case "pair not active":
            return say(`Trading on ${info ? info.symbol : "a main on this route"} is paused right now: buys, sells, leverage opens, position sales and extensions wait until it reopens. Repaying with repay_leverage still works.`);
        case "no executor":
            return say(`Paying with another token isn't available on this network yet: repay in ${pairSym} with repay_leverage.`);
        case "no route": {
            const t = await metaOf(client, c.tokenIn);
            return say(`There is no outside route from ${t?.symbol ?? "that token"} to ${pairSym}: repay in ${pairSym} with repay_leverage, or pay with a token get_swap_routes lists.`);
        }
        case "Loan not active":
        case "Not user":
            return say(`${pos} isn't open for this wallet (repaid, sold, closed by the protocol after its end date, or never opened on this main). Position ids are per main: find yours and their mains with get_leverage_positions.`);
        case "Loan is still active":
            return say(`${pos} is still open, so there is no leftover to claim: repay it with repay_leverage or sell it with close_leverage.`);
        case "Nothing to claim":
            return say(`${pos} has no leftover to claim for this wallet (already claimed, nothing was left, or no such position on this main). Leftovers show as leftoverToClaim in get_leverage_positions.`);
        case "% by 10":
        case "% range":
            return say("percent must be 10 to 100 in steps of 10 (100 sells the whole position).");
        case "Range":
            return say("leverage_percent must be a whole number from 1 to 100.");
        case "Zero amount":
            return say("amount must be more than 0.");
        case "incorrect loan duration": {
            m = /Days must be (\d+)-(\d+)/.exec(msg);
            return say(m ? `days must be ${m[1]} to ${m[2]} on ${sym}.` : `days is outside the range ${sym} allows.`);
        }
        case "Must be refinance if not extending time":
            return say("0 days only works with fee_from refinance.");
        case "Not enough collateral to cover fees": {
            m = /Debt (\d+) \+ fee (\d+) is not below the collateral value (\d+)/.exec(msg);
            const figures = m && P ? ` (debt ${P(m[1])} plus fee ${P(m[2])}, against a position worth ${P(m[3])})` : "";
            return say(`Adding the fee to the debt would reach what the position is worth${figures}: pay the fee from the wallet instead (fee_from wallet).`);
        }
        case "No equity": {
            m = /worth (\d+), not above the debt (\d+)/.exec(msg);
            const figures = m && P ? ` (worth ${P(m[1])}, debt ${P(m[2])})` : "";
            return say(`The position is worth no more than its debt${figures}, so there is nothing to refinance: use fee_from wallet or debt.`);
        }
        case "Minimum surplus not met": {
            m = /surplus (\d+) is below the minimum (\d+)/.exec(msg);
            const figures = m && P ? ` (${P(m[1])}, the minimum is ${P(m[2])})` : "";
            return say(`What the position is worth above its debt is under the minimum for a refinance${figures}: use fee_from wallet or debt.`);
        }
        case "Time remaining too short": {
            m = /Only (\d+) days left \(minimum (\d+)\)/.exec(msg);
            return say(m
                ? `Only ${m[1]} days are left, and a refinance with 0 days needs at least ${m[2]}: add days.`
                : "Too few days are left for a refinance with 0 days: add days.");
        }
        case "Fees exceed surplus value": {
            m = /fees (\d+) take the whole surplus (\d+)/.exec(msg);
            const figures = m && P ? ` (fee ${P(m[1])}, worth above the debt ${P(m[2])})` : "";
            return say(`The fee would take all of what the position is worth above its debt${figures}: use fee_from wallet or debt, or fewer days.`);
        }
    }
    return e;
}
async function sdk(client, c, call) {
    try {
        return await call();
    }
    catch (e) {
        throw await plainError(client, e, c);
    }
}
async function presentSwapQuote(client, q) {
    const [mIn, mOut] = await Promise.all([client.mains.tokenMeta(q.tokenIn), client.mains.tokenMeta(q.tokenOut)]);
    const fees = await Promise.all(q.taxes.map(async (t) => ({ side: t.side, rate: bpsText(t.taxBps), amount: await showToken(client, t.asset, t.amount) })));
    const out = {
        tokenIn: { symbol: mIn.symbol, address: q.tokenIn },
        tokenOut: { symbol: mOut.symbol, address: q.tokenOut },
        pay: show(q.amountIn, mIn.decimals, mIn.symbol),
    };
    if (q.blocked === null) {
        out.receive = show(q.amountOut, mOut.decimals, mOut.symbol);
        out.minimumReceived = show(q.minOut, mOut.decimals, mOut.symbol);
    }
    if (q.path.length)
        out.route = await routeText(client, q.path);
    if (q.kind)
        out.kind = KIND[q.kind] ?? q.kind;
    out.fees = fees;
    out.canSend = q.blocked === null;
    if (q.blocked !== null)
        out.blocked = blockedText(q.blocked);
    if (q.outsideHop) {
        const h = q.outsideHop;
        const [a, b] = await Promise.all([client.mains.tokenMeta(h.tokenIn), client.mains.tokenMeta(h.tokenOut)]);
        out.outsideStep = {
            from: a.symbol,
            to: b.symbol,
            limitIn: show(h.caps.maxIn, a.decimals, a.symbol),
            limitOut: show(h.caps.maxOut, b.decimals, b.symbol),
            inLeftNow: show(h.capsLeft.inLeft, a.decimals, a.symbol),
            outLeftNow: show(h.capsLeft.outLeft, b.decimals, b.symbol),
        };
    }
    if (q.whitelist) {
        const w = q.whitelist;
        const unlimited = w.maxBuy === viem_1.maxUint256;
        out.presaleAllowance = {
            onList: w.whitelisted,
            allowance: unlimited ? "no limit" : show(w.maxBuy, mOut.decimals, mOut.symbol),
            bought: show(w.bought, mOut.decimals, mOut.symbol),
            left: unlimited ? "no limit" : show(w.remaining, mOut.decimals, mOut.symbol),
        };
    }
    return out;
}
async function leverageBlocks(client, q) {
    const main = q.path[1];
    const token = q.path[q.path.length - 1];
    const noWallet = isZero(q.trader);
    const out = [];
    for (const b of q.blocked) {
        switch (b) {
            case "In presale":
                out.push("This token is in an auto-vest presale: leverage on it opens once the presale is complete (buy it with buy_token meanwhile).");
                break;
            case "No WL for freeze":
                out.push(noWallet
                    ? "This token is in an invite-only presale: only wallets on its list can take leverage on it. Pass wallet to check one."
                    : "This token is in an invite-only presale and this wallet isn't on its list.");
                break;
            case "WL cap": {
                const [m, wl] = await Promise.all([client.mains.tokenMeta(token), client.factory.getWhitelistStatus(token, q.trader).catch(() => null)]);
                const left = wl ? ` (${show(wl.remaining, m.decimals, m.symbol)})` : "";
                out.push(`This position would hold ${show(q.sim.totalCollateral, m.decimals, m.symbol)}, more than what is left of this wallet's presale allowance on the token${left}: use a smaller amount.`);
                break;
            }
            case "Under 2x":
                out.push("It is under the 2x minimum: try more days, a higher leverage_percent or a different amount.");
                break;
            case "Trading is not enabled":
                out.push(`Trading on ${(await client.mains.get(main)).symbol} hasn't opened yet: no leverage until it does.`);
                break;
            case "pair asset paused": {
                const info = await client.mains.get(main);
                out.push(`${info.pairSymbol} is paused by its issuer right now, so no leverage buy can be paid in it. Try again once it resumes.`);
                break;
            }
            default:
                out.push(`The open would be refused right now (${b}).`);
        }
    }
    return out;
}
async function leverageSendBlocks(client, info, raw, slippagePercent) {
    const out = [];
    try {
        (0, units_js_1.slippageToBps)(slippagePercent);
    }
    catch (e) {
        out.push((0, errors_js_1.errorText)(e));
    }
    const who = client.account;
    const [spend, bal] = await Promise.all([
        (0, limits_js_1.checkSpend)(client, info.pairAsset, raw).then(() => null, (e) => (0, errors_js_1.errorText)(e)),
        who ? client.publicClient.readContract({ address: info.pairAsset, abi: viem_1.erc20Abi, functionName: "balanceOf", args: [who] }) : Promise.resolve(null),
    ]);
    if (spend !== null)
        out.push(spend);
    if (bal !== null && bal < raw) {
        out.push(`Not enough ${info.pairSymbol} in the wallet: it has ${(0, viem_1.formatUnits)(bal, info.pairDecimals)}, this needs ${(0, viem_1.formatUnits)(raw, info.pairDecimals)}.`);
    }
    return out;
}
async function presentLeverageQuote(client, q, amount, blocks) {
    const info = await client.mains.get(q.path[1]);
    const token = q.path[q.path.length - 1];
    const m = await client.mains.tokenMeta(token);
    const tok = (raw) => show(raw, m.decimals, m.symbol);
    const s = q.sim;
    const out = {
        token: { symbol: m.symbol, address: token },
        main: mainName(info),
        mainSymbol: info.symbol,
        pay: showPair(info, amount),
        leveragePercent: q.leveragePct,
        days: q.days,
        positionTokens: tok(s.totalCollateral),
        plainBuyBeforeFees: tok(q.spot),
        borrowed: showPair(info, s.totalBorrowed),
        debtDueAtEndDate: showPair(info, s.totalRepay),
        totalFees: showPair(info, s.totalFees),
        tradeFees: showPair(info, s.totalDexTax),
        tradeFeeRate: bpsText(q.taxBps),
        passesTwoXMinimum: !q.blocked.includes("Under 2x"),
        pricedFor: isZero(q.trader) ? "list rate (no wallet)" : q.trader,
        canSend: blocks.length === 0,
    };
    if (blocks.length)
        out.blocked = blocks;
    if (q.openLoanId > 0n) {
        out.addsToPosition = q.openLoanId;
        out.note = `Adds to your open position ${q.openLoanId} on this token: it keeps that position's end date and is priced on its ${q.days} days left.`;
    }
    else {
        out.endDateIfSentNow = iso(nowSec() + q.days * DAY);
    }
    return out;
}
async function presentPosition(client, info, id, pos, now) {
    const m = await client.mains.tokenMeta(pos.token);
    const tok = (raw) => show(raw, m.decimals, m.symbol);
    const out = {
        main: mainName(info),
        mainSymbol: info.symbol,
        positionId: id,
        token: { symbol: m.symbol, address: pos.token },
        status: pos.active ? "open" : pos.isLiquidated ? "liquidated" : "closed",
        tokensHeld: tok(pos.collateralAmount),
        debt: showPair(info, pos.fullAmount),
        borrowed: showPair(info, pos.borrowedAmount),
        paidIn: showPair(info, pos.leverageBuyAmount),
        cashedOut: showPair(info, pos.cashedOut),
        opened: iso(pos.creationTime),
        endDate: iso(pos.liquidationTime),
    };
    if (pos.active) {
        out.timeLeft = pos.liquidationTime > now ? (0, present_js_1.span)(pos.liquidationTime - now) : "none, past the end date";
        if (pos.liquidationTime <= now)
            out.pastEndDate = "The end date has passed: the protocol can close this position at any time.";
    }
    else if (pos.timeOfClosure > 0n) {
        out.closedAt = iso(pos.timeOfClosure);
    }
    if (pos.isLiquidated && pos.liquidationClaim > 0n)
        out.leftoverToClaim = `${tok(pos.liquidationClaim)} (claim_leverage_leftover)`;
    return out;
}
async function positionRef(client, main, positionId) {
    if (!main || !main.trim()) {
        throw new basis_sdk_1.ValidationError("main", "Pass main (the main the position is on): position ids are per main. get_leverage_positions shows each position's main.");
    }
    const info = await (0, units_js_1.resolveMain)(client, main);
    const id = (0, units_js_1.uint)(positionId, "position_id");
    if (id === 0n)
        throw new basis_sdk_1.ValidationError("position_id", "Position ids start at 1. Find yours and their mains with get_leverage_positions.");
    return { info, id };
}
async function readPosition(client, info, who, id, open = true) {
    const pos = await client.trading.getLeveragePosition(info.main, who, id);
    if (isZero(pos.token)) {
        throw new basis_sdk_1.ValidationError("position_id", `There is no position ${id} on ${info.symbol} for this wallet (never opened on this main, or cleared after it closed). Position ids are per main, each starting at 1: find yours and their mains with get_leverage_positions.`);
    }
    if (open && !pos.active) {
        const how = pos.isLiquidated
            ? `was closed by the protocol after its end date${pos.liquidationClaim > 0n ? " (its leftover tokens can be claimed with claim_leverage_leftover)" : ""}`
            : "is closed (repaid or sold)";
        throw new basis_sdk_1.ValidationError("position_id", `Position ${id} on ${info.symbol} ${how}, so there is nothing to quote on it. get_leverage_positions lists the open ones.`);
    }
    return pos;
}
const payWith = () => zod_1.z
    .string()
    .optional()
    .describe("The token you pay with: the pair asset of the token's main (default, e.g. USDG) or the main itself (e.g. STASIS), by symbol or address; " +
    "the words pair_asset and main work too. A main is always bought with its pair asset. To pay with any other token, use swap_tokens.");
const receive = () => zod_1.z
    .enum(["pair_asset", "main"])
    .optional()
    .describe("For a token on a main: get its main's pair asset (default, e.g. USDG) or stop at the main (e.g. STASIS). A main always sells for its pair asset.");
const percentOfWallet = () => zod_1.z.number().int().min(1).max(100).optional().describe("Sell this percent (1 to 100) of this wallet's balance instead of an amount.");
const leveragePercent = () => zod_1.z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("100 (default): borrow against the whole first buy, the most leverage. 1 to 99: borrow against only that share of it; the rest stays in the position debt-free. Either way the position must pass the 2x minimum.");
const positionId = () => registry_js_1.p.id("Leverage position id on that main (from get_leverage_positions). Ids start at 1 on every main, so the same id can exist on several mains: always pass main too.");
const positionMain = () => zod_1.z
    .string()
    .min(1)
    .describe("The main the position is on: key (e.g. stasis-usdg), address or symbol (e.g. STASIS). Required: position ids are per main (get_leverage_positions shows each position's main).");
const feeFrom = () => zod_1.z
    .enum(["wallet", "debt", "refinance"])
    .optional()
    .describe("How the extension fee (in the pair asset) is paid: wallet (default, from this wallet), debt (added to the position's debt), or refinance (taken from what the position is worth above its debt, with the rest of that paid out to you; adds debt; allows 0 days).");
function feeFlags(v) {
    const mode = v ?? "wallet";
    return { payIn: mode === "wallet", refinance: mode === "refinance", mode };
}
function payWithSide(info, v) {
    const s = v.trim();
    const low = s.toLowerCase();
    if (low === "pair_asset" || eq(s, info.pairSymbol) || ((0, viem_1.isAddress)(s, { strict: false }) && eq(s, info.pairAsset)))
        return "pairAsset";
    if (low === "main" || eq(s, info.symbol) || (info.key !== null && eq(s, info.key)) || ((0, viem_1.isAddress)(s, { strict: false }) && eq(s, info.main)))
        return "main";
    return null;
}
async function buyInput(client, token, amount, pay) {
    const info = await client.mains.infoOfToken(token);
    let side = pay === undefined || !pay.trim() ? "pairAsset" : payWithSide(info, pay);
    if (side === null && pay !== undefined) {
        const t = await (0, units_js_1.resolveToken)(client, pay, "pay_with").catch(() => null);
        side = t && eq(t, info.pairAsset) ? "pairAsset" : t && eq(t, info.main) ? "main" : null;
    }
    if (side === null) {
        throw new basis_sdk_1.ValidationError("pay_with", `pay_with must be the pair asset of the token's main (${info.pairSymbol}) or the main itself (${info.symbol}). To pay with another token, use swap_tokens.`);
    }
    if (side === "main") {
        if (eq(info.main, token))
            throw new basis_sdk_1.ValidationError("pay_with", `A main is bought with its pair asset (${info.pairSymbol}), not with itself: leave pay_with out.`);
        return { info, tokenIn: info.main, raw: (0, units_js_1.to18)(amount, "amount"), input: "main" };
    }
    return { info, tokenIn: info.pairAsset, raw: (0, units_js_1.toPairRaw)(info, amount, "amount"), input: "pairAsset" };
}
async function percentOfBalance(client, token, percent) {
    const who = client.account;
    if (!who)
        throw new basis_sdk_1.ValidationError("percent", "percent needs this server's wallet: pass amount instead.");
    const bal = await client.publicClient.readContract({ address: token, abi: viem_1.erc20Abi, functionName: "balanceOf", args: [who] });
    const raw = (bal * BigInt(percent)) / 100n;
    if (raw === 0n) {
        throw new basis_sdk_1.ValidationError("percent", bal === 0n ? "Nothing to sell: this wallet holds none of this token." : `Nothing to sell: ${percent}% of this wallet's balance rounds to 0.`);
    }
    return raw;
}
async function sellAmount(client, token, amount, percent) {
    if (amount !== undefined && percent !== undefined)
        throw new basis_sdk_1.ValidationError("amount", "Pass amount or percent, not both.");
    if (amount !== undefined)
        return (0, units_js_1.toTokenRaw)(client, token, amount, "amount");
    if (percent !== undefined)
        return percentOfBalance(client, token, percent);
    throw new basis_sdk_1.ValidationError("amount", "Pass amount (in tokens) or percent (1 to 100).");
}
function sellPercent(v) {
    if (!Number.isInteger(v) || v < 10 || v > 100 || v % 10 !== 0) {
        throw new basis_sdk_1.ValidationError("percent", "percent must be 10 to 100 in steps of 10 (100 sells the whole position).");
    }
    return v;
}
const sellPercentParam = (desc) => zod_1.z.number().int().min(10).max(100).describe(desc);
exports.tradingTools = [
    (0, registry_js_1.tool)({
        name: "get_price",
        toolset: "trading",
        title: "Token price",
        description: "A token's price now: in the pair asset of its main (e.g. USDG per token) and, for a token on a main, also in " +
            "that main (e.g. STASIS per token). Mains are priced in their pair asset.",
        input: { token: registry_js_1.p.token() },
        run: async ({ token }, ctx) => {
            const client = await ctx.client();
            const t = await (0, units_js_1.resolveToken)(client, token);
            const all = await client.mains.list();
            if (all.some((m) => eq(m.pairAsset, t) && !eq(m.main, t))) {
                throw new basis_sdk_1.ValidationError("token", "That's a pair asset: pass a main (e.g. STASIS) or a token on a main.");
            }
            const info = await client.mains.infoOfToken(t);
            const isMain = eq(info.main, t);
            const [inPair, inMain, m] = await Promise.all([
                client.trading.getPairPrice(t),
                isMain ? Promise.resolve(null) : client.trading.getTokenPrice(t),
                client.mains.tokenMeta(t),
            ]);
            const out = { token: { symbol: m.symbol, address: t }, main: info.symbol, per: `1 ${m.symbol}`, priceInPairAsset: inPair };
            if (inMain)
                out.priceInMain = inMain;
            return out;
        },
    }),
    (0, registry_js_1.tool)({
        name: "quote_buy",
        toolset: "trading",
        title: "Quote a buy",
        description: "What a buy would give right now, without sending: tokens out after fees, the minimum after slippage, the fee " +
            "rate and anything that would block it (an invite-only presale, paused trading). Amount in the token you pay with: " +
            "the pair asset of the token's main (e.g. USDG, 6 decimals on STASIS) or the main (pay_with). Send it with buy_token.",
        input: {
            token: registry_js_1.p.token("Token to buy: a main by symbol (e.g. STASIS) or address, or a token on a main by 0x address."),
            amount: registry_js_1.p.amount("Amount to spend, in the token you pay with (default the pair asset of the token's main, e.g. USDG)."),
            pay_with: payWith(),
            slippage_percent: registry_js_1.p.slippage(),
        },
        run: async ({ token, amount, pay_with, slippage_percent }, ctx) => {
            const client = await ctx.client();
            const t = await (0, units_js_1.resolveToken)(client, token);
            const { info, tokenIn, raw } = await buyInput(client, t, amount, pay_with);
            const q = await sdk(client, { info, token: t }, () => client.trading.quoteSwap(tokenIn, t, raw, { slippageBps: (0, units_js_1.slippageToBps)(slippage_percent) }));
            return presentSwapQuote(client, q);
        },
    }),
    (0, registry_js_1.tool)({
        name: "buy_token",
        toolset: "trading",
        title: "Buy a token",
        description: "Buy a token (a main, or a token on a main) with the pair asset of its main (e.g. USDG on STASIS) or with the " +
            "main itself (pay_with). Amount in the token you pay with. Check it first with quote_buy; the minimum you receive " +
            "comes from a fresh quote and slippage_percent. A buy during an auto-vest presale goes into a vesting for you. To " +
            "pay with any other token, use swap_tokens; to buy a main and stake it in one step, use buy_and_stake.",
        input: {
            token: registry_js_1.p.token("Token to buy: a main by symbol (e.g. STASIS) or address, or a token on a main by 0x address."),
            amount: registry_js_1.p.amount("Amount to spend, in the token you pay with (default the pair asset of the token's main, e.g. USDG, 6 decimals on STASIS)."),
            pay_with: payWith(),
            slippage_percent: registry_js_1.p.slippage(),
        },
        write: true,
        run: async ({ token, amount, pay_with, slippage_percent }, ctx) => {
            const client = await ctx.client();
            const t = await (0, units_js_1.resolveToken)(client, token);
            const { info, tokenIn, raw, input } = await buyInput(client, t, amount, pay_with);
            const slippageBps = (0, units_js_1.slippageToBps)(slippage_percent);
            await (0, limits_js_1.checkSpend)(client, tokenIn, raw);
            const r = await sdk(client, { info, token: t, write: true }, () => client.trading.buy(t, raw, { input, slippageBps }));
            const extra = {};
            if (r.autoVested)
                extra.note = "These tokens went into a vesting for you (auto-vest presale): claim them with claim_vested_tokens as they unlock.";
            return (0, present_js_1.txOut)(client, r, extra);
        },
    }),
    (0, registry_js_1.tool)({
        name: "quote_sell",
        toolset: "trading",
        title: "Quote a sell",
        description: "What a sell would pay right now, without sending: what you get after fees, the minimum after slippage and the " +
            "fee rate. Give amount (in tokens) or percent of this wallet's balance. A token on a main sells for its main's " +
            "pair asset by default (receive main to stop at the main). Send it with sell_token.",
        input: {
            token: registry_js_1.p.token("Token to sell: a main by symbol (e.g. STASIS) or address, or a token on a main by 0x address."),
            amount: registry_js_1.p.optAmount("Tokens to sell (in the token's own units, 18 decimals for BASIS tokens). Or use percent."),
            percent: percentOfWallet(),
            receive: receive(),
            slippage_percent: registry_js_1.p.slippage(),
        },
        run: async ({ token, amount, percent, receive: to, slippage_percent }, ctx) => {
            const client = await ctx.client();
            const t = await (0, units_js_1.resolveToken)(client, token);
            const info = await client.mains.infoOfToken(t);
            const isMain = eq(info.main, t);
            if (isMain && to === "main")
                throw new basis_sdk_1.ValidationError("receive", "A main always sells for its pair asset: leave receive out.");
            const tokenOut = isMain || to !== "main" ? info.pairAsset : info.main;
            const raw = await sellAmount(client, t, amount, percent);
            const q = await sdk(client, { info, token: t }, () => client.trading.quoteSwap(t, tokenOut, raw, { slippageBps: (0, units_js_1.slippageToBps)(slippage_percent) }));
            return presentSwapQuote(client, q);
        },
    }),
    (0, registry_js_1.tool)({
        name: "sell_token",
        toolset: "trading",
        title: "Sell a token",
        description: "Sell a token for the pair asset of its main (default, e.g. USDG) or for the main itself. Give amount (in tokens) " +
            "or percent (1 to 100) of the wallet's balance. Check it first with quote_sell. Selling a token on a main also " +
            "pays out your pending holder rewards on it in the same step. To get any other token, use swap_tokens.",
        input: {
            token: registry_js_1.p.token("Token to sell: a main by symbol (e.g. STASIS) or address, or a token on a main by 0x address."),
            amount: registry_js_1.p.optAmount("Tokens to sell (in the token's own units, 18 decimals for BASIS tokens). Or use percent."),
            percent: percentOfWallet(),
            receive: receive(),
            slippage_percent: registry_js_1.p.slippage(),
        },
        write: true,
        destructive: true,
        run: async ({ token, amount, percent, receive: to, slippage_percent }, ctx) => {
            const client = await ctx.client();
            const t = await (0, units_js_1.resolveToken)(client, token);
            const info = await client.mains.infoOfToken(t);
            if (eq(info.main, t) && to === "main")
                throw new basis_sdk_1.ValidationError("receive", "A main always sells for its pair asset: leave receive out.");
            const raw = await sellAmount(client, t, amount, percent);
            const opts = { toPairAsset: to !== "main", slippageBps: (0, units_js_1.slippageToBps)(slippage_percent) };
            await (0, limits_js_1.checkSpend)(client, t, raw);
            const r = await sdk(client, { info, token: t, write: true }, () => client.trading.sell(t, raw, opts));
            return (0, present_js_1.txOut)(client, r, percent !== undefined ? { percentSold: percent } : undefined);
        },
    }),
    (0, registry_js_1.tool)({
        name: "quote_swap",
        toolset: "trading",
        title: "Quote a swap",
        description: "Quote a swap between any two tokens without sending: BASIS tokens on the same or different mains, mains, pair " +
            "assets, or an outside token with a route (get_swap_routes). Shows the route, what you get after fees, the " +
            "minimum, each side's fee and anything that would block it. Amount in token_in's own units. Send it with swap_tokens.",
        input: {
            token_in: registry_js_1.p.token("Token to pay with: 0x address, or a main / pair asset symbol (e.g. USDG, STASIS)."),
            token_out: registry_js_1.p.token("Token to get: 0x address, or a main / pair asset symbol."),
            amount: registry_js_1.p.amount("Amount of token_in to swap, in token_in's own units (e.g. USDG has 6 decimals on STASIS)."),
            slippage_percent: registry_js_1.p.slippage(),
        },
        run: async ({ token_in, token_out, amount, slippage_percent }, ctx) => {
            const client = await ctx.client();
            const a = await (0, units_js_1.resolveToken)(client, token_in, "token_in");
            const b = await (0, units_js_1.resolveToken)(client, token_out, "token_out");
            const raw = await (0, units_js_1.toTokenRaw)(client, a, amount, "amount");
            const q = await sdk(client, {}, () => client.trading.quoteSwap(a, b, raw, { slippageBps: (0, units_js_1.slippageToBps)(slippage_percent) }));
            return presentSwapQuote(client, q);
        },
    }),
    (0, registry_js_1.tool)({
        name: "swap_tokens",
        toolset: "trading",
        title: "Swap tokens",
        description: "Swap one token for another in one step, across mains too (e.g. a token on STASIS for a token on tNVDA+), or " +
            "with a pair asset or an outside token that has a route. Amount in token_in's own units. Check it first with " +
            "quote_swap; the minimum you receive comes from a fresh quote and slippage_percent. A plain buy or sell of one " +
            "token with its own main or pair asset is also buy_token / sell_token.",
        input: {
            token_in: registry_js_1.p.token("Token to pay with: 0x address, or a main / pair asset symbol (e.g. USDG, STASIS)."),
            token_out: registry_js_1.p.token("Token to get: 0x address, or a main / pair asset symbol."),
            amount: registry_js_1.p.amount("Amount of token_in to swap, in token_in's own units (e.g. USDG has 6 decimals on STASIS)."),
            slippage_percent: registry_js_1.p.slippage(),
        },
        write: true,
        destructive: true,
        run: async ({ token_in, token_out, amount, slippage_percent }, ctx) => {
            const client = await ctx.client();
            const a = await (0, units_js_1.resolveToken)(client, token_in, "token_in");
            const b = await (0, units_js_1.resolveToken)(client, token_out, "token_out");
            const raw = await (0, units_js_1.toTokenRaw)(client, a, amount, "amount");
            const slippageBps = (0, units_js_1.slippageToBps)(slippage_percent);
            const ec = { write: true };
            const q = await sdk(client, ec, () => client.trading.quoteSwap(a, b, raw, { slippageBps }));
            if (q.blocked !== null || !q.engine)
                throw new basis_sdk_1.ValidationError("swap", `Can't swap now: ${blockedText(q.blocked ?? "no route")} Nothing was sent.`);
            const extra = { route: await routeText(client, q.path) };
            await (0, limits_js_1.checkSpend)(client, a, raw);
            if (q.engine === "buyTokens")
                return (0, present_js_1.txOut)(client, await sdk(client, ec, () => client.trading.buyTokens(raw, undefined, q.path, false, slippageBps)), extra);
            if (q.engine === "sellTokens")
                return (0, present_js_1.txOut)(client, await sdk(client, ec, () => client.trading.sellTokens(raw, undefined, q.path, slippageBps)), extra);
            return (0, present_js_1.txOut)(client, await sdk(client, ec, () => client.trading.swapCross(q.path, raw, { slippageBps })), extra);
        },
    }),
    (0, registry_js_1.tool)({
        name: "get_swap_routes",
        toolset: "trading",
        title: "Outside swap routes",
        description: "The outside-exchange routes swaps can use between pair assets and other tokens (e.g. USDG to tETH), with each " +
            "route's size limits per window of about 12 seconds, what is left of them now, and the fee on each outside step. " +
            "quote_swap prices a swap over them; repay_leverage_with pays a position with one of these tokens.",
        input: {},
        run: async (_args, ctx) => {
            const client = await ctx.client();
            const exec = await client.trading.getHopExecutor();
            if (isZero(exec))
                return { routes: [], note: "Swaps through an outside exchange aren't available on this network yet." };
            const pc = client.publicClient;
            const [count, feePpm] = await Promise.all([
                pc.readContract({ address: exec, abi: basis_sdk_1.HopExecutorAbi, functionName: "routeCount" }),
                pc.readContract({ address: exec, abi: basis_sdk_1.HopExecutorAbi, functionName: "feePpm" }),
            ]);
            const total = Number(count);
            const idx = Array.from({ length: Math.min(total, 100) }, (_, i) => i);
            const list = await inBatches(idx, async (i) => {
                const [tokenIn, tokenOut, hops, maxIn, maxOut] = await pc.readContract({ address: exec, abi: basis_sdk_1.HopExecutorAbi, functionName: "routeAt", args: [BigInt(i)] });
                const [a, b, left] = await Promise.all([
                    client.mains.tokenMeta(tokenIn),
                    client.mains.tokenMeta(tokenOut),
                    pc.readContract({ address: exec, abi: basis_sdk_1.HopExecutorAbi, functionName: "capsLeft", args: [tokenIn, tokenOut] }).catch(() => null),
                ]);
                const row = {
                    from: { symbol: a.symbol, address: tokenIn },
                    to: { symbol: b.symbol, address: tokenOut },
                    steps: hops.length,
                    limitIn: show(maxIn, a.decimals, a.symbol),
                    limitOut: show(maxOut, b.decimals, b.symbol),
                };
                if (left) {
                    row.inLeftNow = show(left[0], a.decimals, a.symbol);
                    row.outLeftNow = show(left[1], b.decimals, b.symbol);
                }
                return row;
            });
            const out = {
                outsideStepFee: `${Number(feePpm) / 10_000}% of each outside step's output`,
                routes: list,
                note: "Limits apply per window of about 12 seconds; a swap over what is left now has to wait for the next window.",
            };
            if (total > list.length)
                out.more = `Showing ${list.length} of ${total} routes.`;
            return out;
        },
    }),
    (0, registry_js_1.tool)({
        name: "buy_and_stake",
        toolset: "trading",
        title: "Buy a main and stake it",
        description: "Buy a main (e.g. STASIS) with its pair asset and stake it in that main's vault in one step. Amount in the pair " +
            "asset (e.g. USDG, 6 decimals on STASIS). The vault has a minimum stake: a smaller buy is refused. To buy without " +
            "staking, use buy_token.",
        input: {
            main: zod_1.z
                .string()
                .min(1)
                .describe("The main to buy and stake: key (e.g. stasis-usdg), address or symbol (e.g. STASIS). Required: each main has its own vault. get_mains lists the mains."),
            amount: registry_js_1.p.amount("Pair asset to spend (e.g. USDG on the STASIS main)."),
            slippage_percent: registry_js_1.p.slippage(),
        },
        write: true,
        run: async ({ main, amount, slippage_percent }, ctx) => {
            const client = await ctx.client();
            if (!main.trim())
                throw new basis_sdk_1.ValidationError("main", "Pass main (the main to buy and stake): each main has its own vault. get_mains lists the mains.");
            const info = await (0, units_js_1.resolveMain)(client, main);
            const raw = (0, units_js_1.toPairRaw)(info, amount, "amount");
            const slippageBps = (0, units_js_1.slippageToBps)(slippage_percent);
            await (0, limits_js_1.checkSpend)(client, info.pairAsset, raw);
            return (0, present_js_1.txOut)(client, await sdk(client, { info, write: true }, () => client.trading.buyAndStake(info.main, raw, { slippageBps })));
        },
    }),
    (0, registry_js_1.tool)({
        name: "quote_leverage",
        toolset: "trading",
        title: "Quote a leverage buy",
        description: "What a leverage buy would do right now, without sending: tokens the position would hold, what the protocol " +
            "lends, the debt due at the end date, fees, and anything that would refuse the open (the 2x minimum, a presale, " +
            "an invite-only list, trading not open yet, a paused pair asset). Amount in the pair asset of the token's main (e.g. USDG). With an " +
            "open position on the token, the buy adds to it on its days left. Open it with leverage_buy.",
        input: {
            token: registry_js_1.p.token("Token for the position: a main by symbol (e.g. STASIS) or address, or a token on a main by 0x address."),
            amount: registry_js_1.p.amount("Pair asset you put in (e.g. USDG on the STASIS main)."),
            days: registry_js_1.p.days("Loan length in days (the main's allowed range applies). Ignored when adding to your open position on the token."),
            leverage_percent: leveragePercent(),
            wallet: registry_js_1.p.wallet("Quote at this wallet's own fee rate and presale list. Default: this server's wallet (the list rate when there is none)."),
        },
        run: async ({ token, amount, days, leverage_percent, wallet }, ctx) => {
            const client = await ctx.client();
            const t = await (0, units_js_1.resolveToken)(client, token);
            const info = await client.mains.infoOfToken(t);
            const raw = (0, units_js_1.toPairRaw)(info, amount, "amount");
            const who = wallet ? (0, units_js_1.addr)(wallet, "wallet") : undefined;
            const q = await sdk(client, { info, token: t }, () => client.trading.quoteLeverage(t, raw, (0, units_js_1.uint)(days, "days"), leverage_percent ?? 100, who));
            return presentLeverageQuote(client, q, raw, await leverageBlocks(client, q));
        },
    }),
    (0, registry_js_1.tool)({
        name: "leverage_buy",
        toolset: "trading",
        title: "Leverage buy",
        description: "Take a leveraged position on a token: you pay amount in the pair asset of its main (e.g. USDG) and the protocol " +
            "lends more against the tokens bought, so the position holds over 2x a plain buy. Repay or close it by the end " +
            "date to keep the tokens; a second buy on the same token adds to the open position. Without confirm: true it only " +
            "shows the preview (the same as quote_leverage).",
        input: {
            token: registry_js_1.p.token("Token for the position: a main by symbol (e.g. STASIS) or address, or a token on a main by 0x address."),
            amount: registry_js_1.p.amount("Pair asset you put in (e.g. USDG, 6 decimals on the STASIS main)."),
            days: registry_js_1.p.days("Loan length in days (the main's allowed range applies). Ignored when adding to your open position on the token."),
            leverage_percent: leveragePercent(),
            slippage_percent: registry_js_1.p.slippage(),
            confirm: registry_js_1.p.confirm(),
        },
        write: true,
        run: async ({ token, amount, days, leverage_percent, slippage_percent, confirm }, ctx) => {
            const client = await ctx.client();
            const t = await (0, units_js_1.resolveToken)(client, token);
            const info = await client.mains.infoOfToken(t);
            const raw = (0, units_js_1.toPairRaw)(info, amount, "amount");
            const d = (0, units_js_1.uint)(days, "days");
            const pct = leverage_percent ?? 100;
            if (confirm !== true) {
                const q = await sdk(client, { info, token: t }, () => client.trading.quoteLeverage(t, raw, d, pct));
                const [quoteBlocks, sendBlocks] = await Promise.all([leverageBlocks(client, q), leverageSendBlocks(client, info, raw, slippage_percent)]);
                const blocks = [...quoteBlocks, ...sendBlocks];
                return { status: "preview only", ...(await presentLeverageQuote(client, q, raw, blocks)), message: blocks.length ? REFUSED_NOW : NOT_SENT };
            }
            const slippageBps = (0, units_js_1.slippageToBps)(slippage_percent);
            await (0, limits_js_1.checkSpend)(client, info.pairAsset, raw);
            const r = await sdk(client, { info, token: t, write: true }, () => pct === 100 ? client.trading.leverageBuy(t, raw, d, { slippageBps }) : client.trading.mixedBuy(t, raw, d, pct, { slippageBps }));
            const extra = { main: mainName(info), loanId: undefined, liquidationTime: undefined };
            if (r.loanId !== null)
                extra.positionId = r.loanId;
            if (r.liquidationTime !== null)
                extra.endDate = iso(r.liquidationTime);
            return (0, present_js_1.txOut)(client, r, extra);
        },
    }),
    (0, registry_js_1.tool)({
        name: "get_leverage_positions",
        toolset: "trading",
        title: "Leverage positions",
        description: "A wallet's leverage positions, one page at a time, newest first on each main: open ones and ones the protocol " +
            "closed after their end date with tokens left to claim (include_closed adds the rest). Each shows its main and " +
            "position id (ids are per main), tokens held, debt, end date and days left. Filter by main or token. The result " +
            "gives the total ever opened and the next page.",
        input: {
            wallet: registry_js_1.p.wallet(),
            main: registry_js_1.p.main("Only positions on this main: key (e.g. stasis-usdg), address or symbol. Default: every main."),
            token: zod_1.z.string().optional().describe("Only positions on this token (0x address, or a main symbol)."),
            include_closed: registry_js_1.p.bool("Also list closed positions (default false)."),
            limit: zod_1.z
                .number()
                .int()
                .min(1)
                .max(50)
                .optional()
                .describe("Positions per page (1 to 50, default 20). A page covers that many of the positions ever opened, newest first; closed ones in it are left out unless include_closed."),
            page: registry_js_1.p.page(),
        },
        run: async ({ wallet, main, token, include_closed, limit, page }, ctx) => {
            const client = await ctx.client();
            const who = (0, units_js_1.walletOrSelf)(client, wallet);
            const size = limit ?? 20;
            const pg = page ?? 1;
            const sources = [];
            if (token) {
                const t = await (0, units_js_1.resolveToken)(client, token);
                const info = await client.mains.infoOfToken(t);
                if (main) {
                    const m = await (0, units_js_1.resolveMain)(client, main);
                    if (!eq(m.main, info.main))
                        throw new basis_sdk_1.ValidationError("main", `That token trades on ${info.symbol}, not on ${m.symbol}.`);
                }
                const n = Number(await client.mainLens.getLeverageCountForUserAndToken(info.main, who, t));
                sources.push({
                    info,
                    count: n,
                    idAt: (i) => client.publicClient.readContract({ address: info.main, abi: basis_sdk_1.MainTokenAbi, functionName: "userTokenLeverageIds", args: [who, t, BigInt(n - 1 - i)] }),
                });
            }
            else {
                const mains = main ? [await (0, units_js_1.resolveMain)(client, main)] : await client.mains.list();
                const counts = await inBatches(mains, (m) => client.trading.getLeverageCount(m.main, who));
                mains.forEach((info, k) => {
                    const n = Number(counts[k]);
                    sources.push({ info, count: n, idAt: async (i) => BigInt(n - i) });
                });
            }
            const total = sources.reduce((s, x) => s + x.count, 0);
            const start = (pg - 1) * size;
            const slice = [];
            let skip = start;
            for (const src of sources) {
                if (slice.length >= size)
                    break;
                if (skip >= src.count) {
                    skip -= src.count;
                    continue;
                }
                for (let i = skip; i < src.count && slice.length < size; i++)
                    slice.push({ src, i });
                skip = 0;
            }
            const now = nowSec();
            const rows = await inBatches(slice, async ({ src, i }) => {
                const id = await src.idAt(i);
                const pos = await client.trading.getLeveragePosition(src.info.main, who, id);
                return { info: src.info, id, pos };
            });
            const kept = rows.filter((r) => r.pos.active || (r.pos.isLiquidated && r.pos.liquidationClaim > 0n) || include_closed === true);
            const positions = await inBatches(kept, (r) => presentPosition(client, r.info, r.id, r.pos, now));
            const pages = Math.max(1, Math.ceil(total / size));
            const out = {
                wallet: who,
                positionsEverOpened: total,
                byMain: sources.map((s) => ({ main: mainName(s.info), mainSymbol: s.info.symbol, count: s.count })),
                page: pg,
                pages,
                positions,
            };
            if (slice.length)
                out.covers = `Positions ${start + 1} to ${start + slice.length} of ${total} ever opened (newest first on each main).`;
            else if (total > 0)
                out.note = `Page ${pg} is past the last page (${pages}).`;
            const hidden = rows.length - kept.length;
            if (hidden > 0)
                out.closedHidden = `${hidden} closed position(s) on this page are left out (include_closed true shows them).`;
            if (start + slice.length < total)
                out.nextPage = pg + 1;
            return out;
        },
    }),
    (0, registry_js_1.tool)({
        name: "quote_close_leverage",
        toolset: "trading",
        title: "Quote closing leverage",
        description: "What selling part or all of a leverage position would pay right now, without sending: tokens sold, debt repaid, " +
            "the fee and what you get, in the pair asset of its main (e.g. USDG). The fee is charged on profit only. Send it " +
            "with close_leverage.",
        input: {
            main: positionMain(),
            position_id: positionId(),
            percent: sellPercentParam("Share to sell: 10 to 100 in steps of 10 (100 sells the whole position).").optional(),
            wallet: registry_js_1.p.wallet(),
        },
        run: async ({ main, position_id, percent, wallet }, ctx) => {
            const client = await ctx.client();
            const { info, id } = await positionRef(client, main, position_id);
            const who = (0, units_js_1.walletOrSelf)(client, wallet);
            const share = sellPercent(percent ?? 100);
            const pos = await readPosition(client, info, who, id);
            const q = await sdk(client, { info, id, token: pos.token }, () => client.trading.quotePartialSellLeverage(info.main, id, share, who));
            const m = await client.mains.tokenMeta(pos.token);
            return {
                positionId: id,
                main: mainName(info),
                mainSymbol: info.symbol,
                token: { symbol: m.symbol, address: pos.token },
                percent: share,
                tokensSold: show(q.collateralSold, m.decimals, m.symbol),
                debtRepaid: showPair(info, q.debtRepaid),
                beforeFee: showPair(info, q.gross),
                profitPart: showPair(info, q.taxable),
                feeRate: bpsText(q.taxBps),
                fee: showPair(info, q.fee),
                youGet: showPair(info, q.net),
                closesPosition: share === 100,
                note: "The fee is charged only on what the sale brings in above what you put in (less what you already took out), so a sale at a loss pays none.",
            };
        },
    }),
    (0, registry_js_1.tool)({
        name: "close_leverage",
        toolset: "trading",
        title: "Close leverage",
        description: "Sell part (10% steps) or all of a leverage position: the sale repays that share of the debt and you get the rest " +
            "in the pair asset of its main (e.g. USDG), less a fee on any profit. percent 100 closes it. Check it first with " +
            "quote_close_leverage. To keep the tokens instead, pay the debt with repay_leverage.",
        input: {
            main: positionMain(),
            position_id: positionId(),
            percent: sellPercentParam("Share to sell: 10 to 100 in steps of 10. 100 sells the whole position and closes it."),
            slippage_percent: registry_js_1.p.slippage(),
        },
        write: true,
        destructive: true,
        run: async ({ main, position_id, percent, slippage_percent }, ctx) => {
            const client = await ctx.client();
            const { info, id } = await positionRef(client, main, position_id);
            const share = sellPercent(percent);
            const slippageBps = (0, units_js_1.slippageToBps)(slippage_percent);
            const r = await sdk(client, { info, id, write: true }, () => client.trading.partialSellLeverage(info.main, id, share, { slippageBps }));
            return (0, present_js_1.txOut)(client, r, { main: mainName(info), positionId: id, percentSold: share });
        },
    }),
    (0, registry_js_1.tool)({
        name: "quote_extend_leverage",
        toolset: "trading",
        title: "Quote extending leverage",
        description: "Fee and new end date for extending a leverage position, without sending. The fee is in the pair asset of its " +
            "main: paid from the wallet, added to the debt, or (refinance) taken from what the position is worth above its " +
            "debt, with the rest paid out to you. Send it with extend_leverage.",
        input: {
            main: positionMain(),
            position_id: positionId(),
            days: zod_1.z.number().int().min(0).describe("Days to add (the main's allowed range applies). 0 only with fee_from refinance."),
            fee_from: feeFrom(),
            wallet: registry_js_1.p.wallet(),
        },
        run: async ({ main, position_id, days, fee_from, wallet }, ctx) => {
            const client = await ctx.client();
            const { info, id } = await positionRef(client, main, position_id);
            const who = (0, units_js_1.walletOrSelf)(client, wallet);
            const d = (0, units_js_1.uint)(days, "days");
            const { payIn, refinance, mode } = feeFlags(fee_from);
            if (d === 0n && !refinance)
                throw new basis_sdk_1.ValidationError("days", "days must be at least 1 (0 only with fee_from refinance).");
            const pos = await readPosition(client, info, who, id);
            const q = await sdk(client, { info, id }, () => client.trading.getLeverageExtensionQuote(info.main, id, d, payIn, refinance, who));
            const now = nowSec();
            const from = pos.liquidationTime > now ? pos.liquidationTime : now;
            const out = {
                positionId: id,
                main: mainName(info),
                mainSymbol: info.symbol,
                days: d,
                feeFrom: mode,
                possible: q.possible,
                fee: showPair(info, q.fee),
                currentEndDate: iso(pos.liquidationTime),
                newEndDate: iso(from + d * DAY),
            };
            if (refinance)
                out.paidOutToYou = showPair(info, q.extraOut);
            if (!q.possible) {
                out.why = "Not possible with these settings: check the day range, or pay the fee from the wallet (fee_from wallet). Trading on this main or its pair asset may also be paused.";
            }
            return out;
        },
    }),
    (0, registry_js_1.tool)({
        name: "extend_leverage",
        toolset: "trading",
        title: "Extend leverage",
        description: "Move a leverage position's end date out by days (counted from the current end date, or from now if it has " +
            "passed). The fee is in the pair asset of its main: from the wallet (default), added to the debt, or refinance. " +
            "Check it first with quote_extend_leverage.",
        input: {
            main: positionMain(),
            position_id: positionId(),
            days: zod_1.z.number().int().min(0).describe("Days to add (the main's allowed range applies). 0 only with fee_from refinance."),
            fee_from: feeFrom(),
        },
        write: true,
        run: async ({ main, position_id, days, fee_from }, ctx) => {
            const client = await ctx.client();
            const { info, id } = await positionRef(client, main, position_id);
            const d = (0, units_js_1.uint)(days, "days");
            const { payIn, refinance } = feeFlags(fee_from);
            if (d === 0n && !refinance)
                throw new basis_sdk_1.ValidationError("days", "days must be at least 1 (0 only with fee_from refinance).");
            const r = await sdk(client, { info, id, write: true }, () => client.trading.extendLeverage(info.main, id, d, payIn, refinance));
            const extra = { main: mainName(info), positionId: id, newLiquidationTime: undefined };
            if (r.newLiquidationTime !== null)
                extra.newEndDate = iso(r.newLiquidationTime);
            return (0, present_js_1.txOut)(client, r, extra);
        },
    }),
    (0, registry_js_1.tool)({
        name: "quote_repay_leverage",
        toolset: "trading",
        title: "Quote a leverage repay",
        description: "What repaying a leverage position would do, without sending: the debt, what you pay, tokens that come back and " +
            "what is left. Amount in the pair asset of its main (e.g. USDG), or \"all\" (the default) to repay in full. A " +
            "partial repay must leave at least the main's minimum debt. Send it with repay_leverage.",
        input: {
            main: positionMain(),
            position_id: positionId(),
            amount: registry_js_1.p.optAmount('Pair asset to repay (e.g. USDG), or "all" for the whole debt. Default: "all".'),
            wallet: registry_js_1.p.wallet(),
        },
        run: async ({ main, position_id, amount, wallet }, ctx) => {
            const client = await ctx.client();
            const { info, id } = await positionRef(client, main, position_id);
            const who = (0, units_js_1.walletOrSelf)(client, wallet);
            const raw = amount === undefined || isAll(amount) ? undefined : (0, units_js_1.toPairRaw)(info, amount, "amount");
            const pos = await readPosition(client, info, who, id);
            const r = await sdk(client, { info, id }, () => client.trading.getLeverageRepayPreview(info.main, id, raw, who));
            const m = await client.mains.tokenMeta(pos.token);
            const tok = (x) => show(x, m.decimals, m.symbol);
            const out = {
                positionId: id,
                main: mainName(info),
                mainSymbol: info.symbol,
                token: { symbol: m.symbol, address: pos.token },
                debt: showPair(info, r.debt),
                youPay: showPair(info, r.amount),
                repaysInFull: r.full,
                tokensBack: tok(r.collateralReleased),
                tokensLeft: tok(r.collateralLeft),
                debtLeft: showPair(info, r.debtLeft),
                minimumDebtLeft: showPair(info, r.minimumLoan),
                largestPartialRepay: showPair(info, r.maxPartial),
                allowed: r.allowed,
            };
            if (!r.allowed) {
                out.why =
                    r.amount === 0n
                        ? "amount must be more than 0."
                        : `A partial repay must leave at least ${showPair(info, r.minimumLoan)} of debt: repay at most ${showPair(info, r.maxPartial)}, or "all" to repay in full.`;
            }
            return out;
        },
    }),
    (0, registry_js_1.tool)({
        name: "repay_leverage",
        toolset: "trading",
        title: "Repay leverage",
        description: "Repay a leverage position's debt with the pair asset of its main (e.g. USDG) and get its tokens back: all of them " +
            "on a full repay (amount \"all\", which closes the position), a matching share on a partial one. Nothing is sold. " +
            "Check it first with quote_repay_leverage. To pay with another token use repay_leverage_with; to sell the " +
            "position instead, close_leverage.",
        input: {
            main: positionMain(),
            position_id: positionId(),
            amount: registry_js_1.p.amount('Pair asset to repay (e.g. USDG, 6 decimals on the STASIS main), or "all" for the whole debt (closes the position).'),
        },
        write: true,
        destructive: true,
        run: async ({ main, position_id, amount }, ctx) => {
            const client = await ctx.client();
            const { info, id } = await positionRef(client, main, position_id);
            const raw = isAll(amount) ? undefined : (0, units_js_1.toPairRaw)(info, amount, "amount");
            const r = await sdk(client, { info, id, write: true }, () => client.trading.repayLeverage(info.main, id, { amount: raw }));
            return (0, present_js_1.txOut)(client, r, { main: mainName(info), positionId: id });
        },
    }),
    (0, registry_js_1.tool)({
        name: "quote_repay_leverage_with",
        toolset: "trading",
        title: "Quote repaying leverage with another token",
        description: "What repaying a leverage position with another token would do, without sending: how much of it you pay, what it " +
            "turns into in the pair asset, whether that covers the debt, the refund and the tokens that come back. Amount in " +
            "token_in's own units, or \"all\" (the default) to size a full repay. Send it with repay_leverage_with.",
        input: {
            main: positionMain(),
            position_id: positionId(),
            token_in: registry_js_1.p.token("Token to pay with: one with an outside route to the main's pair asset (see get_swap_routes), e.g. tETH. 0x address or symbol."),
            amount: registry_js_1.p.optAmount('Amount of token_in to pay, in its own units, or "all": enough to repay the whole debt (with a small margin, refunded). Default: "all".'),
            wallet: registry_js_1.p.wallet(),
        },
        run: async ({ main, position_id, token_in, amount, wallet }, ctx) => {
            const client = await ctx.client();
            const { info, id } = await positionRef(client, main, position_id);
            const who = (0, units_js_1.walletOrSelf)(client, wallet);
            const tokenIn = await (0, units_js_1.resolveToken)(client, token_in, "token_in");
            const amountIn = amount === undefined || isAll(amount) ? undefined : await (0, units_js_1.toTokenRaw)(client, tokenIn, amount, "amount");
            const pos = await readPosition(client, info, who, id);
            const q = await sdk(client, { info, id, tokenIn }, () => client.trading.quoteRepayLeverageWith(info.main, id, tokenIn, { amountIn, user: who }));
            const [m, pay] = await Promise.all([client.mains.tokenMeta(pos.token), showToken(client, tokenIn, q.amountIn)]);
            return {
                positionId: id,
                main: mainName(info),
                mainSymbol: info.symbol,
                pay,
                turnsInto: showPair(info, q.pairOut),
                debt: showPair(info, q.debt),
                repaysInFull: q.covers,
                refund: showPair(info, q.refund),
                tokensBack: show(q.collateralReleased, m.decimals, m.symbol),
            };
        },
    }),
    (0, registry_js_1.tool)({
        name: "repay_leverage_with",
        toolset: "trading",
        title: "Repay leverage with another token",
        description: "Repay a leverage position with another token (e.g. tETH): it is swapped to the pair asset of the position's main " +
            "through an outside exchange, all of it goes to the debt and any surplus is refunded. Amount in token_in's units, " +
            "or \"all\" to repay in full. Check it first with quote_repay_leverage_with. To pay in the pair asset itself, use " +
            "repay_leverage.",
        input: {
            main: positionMain(),
            position_id: positionId(),
            token_in: registry_js_1.p.token("Token to pay with: one with an outside route to the main's pair asset (see get_swap_routes), e.g. tETH. 0x address or symbol."),
            amount: registry_js_1.p.amount('Amount of token_in to pay, in its own units, or "all": enough to repay the whole debt (with a small margin, refunded).'),
            slippage_percent: registry_js_1.p.slippage(),
        },
        write: true,
        destructive: true,
        run: async ({ main, position_id, token_in, amount, slippage_percent }, ctx) => {
            const client = await ctx.client();
            const { info, id } = await positionRef(client, main, position_id);
            const tokenIn = await (0, units_js_1.resolveToken)(client, token_in, "token_in");
            const amountIn = isAll(amount) ? undefined : await (0, units_js_1.toTokenRaw)(client, tokenIn, amount, "amount");
            const slippageBps = (0, units_js_1.slippageToBps)(slippage_percent);
            const r = await sdk(client, { info, id, tokenIn, write: true }, () => client.trading.repayLeverageWith(info.main, id, tokenIn, { amountIn, slippageBps }));
            return (0, present_js_1.txOut)(client, r, { main: mainName(info), positionId: id });
        },
    }),
    (0, registry_js_1.tool)({
        name: "claim_leverage_leftover",
        toolset: "trading",
        title: "Claim a leverage leftover",
        description: "Claim the tokens left over from a leverage position that passed its end date unpaid and was closed by the " +
            "protocol. Find them with get_leverage_positions (leftoverToClaim) or get_claimables.",
        input: {
            main: positionMain(),
            position_id: positionId(),
        },
        write: true,
        run: async ({ main, position_id }, ctx) => {
            const client = await ctx.client();
            const { info, id } = await positionRef(client, main, position_id);
            const r = await sdk(client, { info, id, write: true }, () => client.trading.claimLeverageLiquidation(info.main, id));
            return (0, present_js_1.txOut)(client, r, { main: mainName(info), positionId: id });
        },
    }),
];
