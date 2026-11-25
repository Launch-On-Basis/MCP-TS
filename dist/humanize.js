"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.humanize = humanize;
const viem_1 = require("viem");
const basis_sdk_1 = require("basis-sdk");
async function tokenText(client, ref) {
    try {
        if ((0, viem_1.isAddress)(ref, { strict: false })) {
            const m = await client.mains.tokenMeta((0, viem_1.getAddress)(ref.toLowerCase()));
            return { symbol: m.symbol, decimals: m.decimals };
        }
        const mains = await client.mains.list();
        const up = ref.toUpperCase();
        const main = mains.find((x) => x.symbol.toUpperCase() === up);
        if (main)
            return { symbol: main.symbol, decimals: 18 };
        const pair = mains.find((x) => x.pairSymbol.toUpperCase() === up);
        if (pair)
            return { symbol: pair.pairSymbol, decimals: pair.pairDecimals };
    }
    catch {
    }
    return null;
}
async function humanize(e, client) {
    if (!client || !(e instanceof basis_sdk_1.ValidationError))
        return e;
    const msg = e.message.replace(/\[basis-sdk\]\s*/g, "");
    let m = /Balance of (\S+) is (\d+), below the (\d+)(?: (needed|to repay|fee))?/.exec(msg);
    if (m) {
        const t = await tokenText(client, m[1]);
        if (!t)
            return e;
        const what = m[4] === "to repay" ? "to repay this" : m[4] === "fee" ? "for the fee" : "for this";
        return new basis_sdk_1.ValidationError(e.rule, `Not enough ${t.symbol} in the wallet: it has ${(0, viem_1.formatUnits)(BigInt(m[2]), t.decimals)} ${t.symbol}, and ${what} it needs ${(0, viem_1.formatUnits)(BigInt(m[3]), t.decimals)} ${t.symbol}. Nothing was sent.`);
    }
    m = /Native balance (\d+) is below (\d+)/.exec(msg);
    if (m) {
        return new basis_sdk_1.ValidationError(e.rule, `Not enough ETH in the wallet: it has ${(0, viem_1.formatEther)(BigInt(m[1]))} ETH, and this needs ${(0, viem_1.formatEther)(BigInt(m[2]))} ETH. Nothing was sent.`);
    }
    m = /The bet needs (\d+) raw units of (\S+?);? the wallet holds (\d+)/.exec(msg);
    if (m) {
        const t = await tokenText(client, m[2].replace(/[;.,]$/, ""));
        if (!t)
            return e;
        return new basis_sdk_1.ValidationError(e.rule, `Not enough ${t.symbol} for this prediction: it needs ${(0, viem_1.formatUnits)(BigInt(m[1]), t.decimals)} ${t.symbol}, and the wallet holds ${(0, viem_1.formatUnits)(BigInt(m[3]), t.decimals)}. Nothing was sent.`);
    }
    return e;
}
