"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkSpendTotal = checkSpendTotal;
exports.checkSpend = checkSpend;
const viem_1 = require("viem");
const basis_sdk_1 = require("basis-sdk");
const client_js_1 = require("./client.js");
const errors_js_1 = require("./errors.js");
const PRICE_TTL_MS = 30_000;
const cache = new Map();
async function usdPriceE18(client, token) {
    const key = token.toLowerCase();
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < PRICE_TTL_MS)
        return hit.usdE18;
    let price;
    try {
        const all = await client.api.getPrices();
        const isNative = key === viem_1.zeroAddress;
        const row = (all.data ?? []).find((r) => isNative ? (r.role ?? []).includes("native") : (r.asset ?? "").toLowerCase() === key);
        price = row?.priceUsdE18;
        if (!price && !isNative) {
            const t = await client.api.getTokenPrices([token]);
            const tr = (t.data ?? []).find((r) => (r.address ?? "").toLowerCase() === key && r.found !== false);
            price = tr?.priceUsdE18;
        }
    }
    catch (e) {
        return e instanceof basis_sdk_1.AuthRequiredError ? "auth" : null;
    }
    if (!price || !/^\d+$/.test(price))
        return null;
    const usdE18 = BigInt(price);
    cache.set(key, { usdE18, at: Date.now() });
    return usdE18;
}
async function checkSpendTotal(client, spends) {
    const cap = (0, client_js_1.getConfig)().maxSpendUsd;
    const items = spends.filter((s) => s.raw > 0n);
    if (cap === undefined || !items.length)
        return;
    let usd = 0;
    for (const { token, raw } of items) {
        const decimals = token.toLowerCase() === viem_1.zeroAddress ? 18 : (await client.mains.tokenMeta(token)).decimals;
        const price = await usdPriceE18(client, token);
        if (price === "auth") {
            throw new errors_js_1.GuidedError("BASIS_MAX_SPEND is set, and prices come from the BASIS site, which this wallet can't sign in to yet: nothing was sent. Register it with register_agent (or link it on the website), or remove BASIS_MAX_SPEND.");
        }
        if (price === null) {
            throw new errors_js_1.GuidedError("BASIS_MAX_SPEND is set, and the dollar price of a token this spends can't be read right now, so nothing was sent. Try again in a minute; a token BASIS has no price for can't be spent or sold through this server while the cap is set.");
        }
        usd += Number((0, viem_1.formatUnits)(raw * price, decimals + 18));
    }
    if (usd > cap) {
        throw new errors_js_1.GuidedError(`This would spend about $${usd.toFixed(2)}${items.length > 1 ? " in all" : ""}, over this server's cap of $${cap} per transaction (BASIS_MAX_SPEND). Nothing was sent. Spend less, or raise BASIS_MAX_SPEND.`);
    }
}
async function checkSpend(client, token, raw) {
    return checkSpendTotal(client, [{ token, raw }]);
}
