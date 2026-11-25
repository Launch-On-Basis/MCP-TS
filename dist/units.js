"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toRaw = toRaw;
exports.to18 = to18;
exports.addr = addr;
exports.toTokenRaw = toTokenRaw;
exports.mainOfToken = mainOfToken;
exports.toPairRawForToken = toPairRawForToken;
exports.toPairRaw = toPairRaw;
exports.resolveMain = resolveMain;
exports.resolveToken = resolveToken;
exports.walletOrSelf = walletOrSelf;
exports.setSlippageCap = setSlippageCap;
exports.slippageToBps = slippageToBps;
exports.uint = uint;
const viem_1 = require("viem");
const basis_sdk_1 = require("basis-sdk");
function toRaw(value, decimals, field = "amount") {
    return (0, basis_sdk_1.parseAmount)(typeof value === "number" ? String(value) : value, decimals, field);
}
function to18(value, field = "amount") {
    return toRaw(value, 18, field);
}
function addr(value, field = "address") {
    if (typeof value !== "string" || !(0, viem_1.isAddress)(value, { strict: false })) {
        throw new basis_sdk_1.ValidationError(field, `${field} must be a 0x address (40 hex characters), got "${String(value)}".`);
    }
    return (0, viem_1.getAddress)(value.toLowerCase());
}
async function toTokenRaw(client, token, value, field = "amount") {
    const { decimals } = await client.mains.tokenMeta(token);
    return toRaw(value, decimals, field);
}
async function mainOfToken(client, token) {
    return client.mains.infoOfToken(token);
}
async function toPairRawForToken(client, token, value, field = "amount") {
    const info = await client.mains.infoOfToken(token);
    return toRaw(value, info.pairDecimals, field);
}
function toPairRaw(info, value, field = "amount") {
    return toRaw(value, info.pairDecimals, field);
}
async function resolveMain(client, ref) {
    if (!ref)
        return client.mains.default();
    const r = ref.trim();
    if ((0, viem_1.isAddress)(r, { strict: false }))
        return client.mains.get((0, viem_1.getAddress)(r.toLowerCase()));
    const byKey = client.addresses.mains.find((m) => m.key.toLowerCase() === r.toLowerCase());
    if (byKey)
        return client.mains.get(byKey.key);
    const all = await client.mains.list();
    const up = r.toUpperCase();
    const bySymbol = all.find((m) => m.symbol.toUpperCase() === up) ?? all.find((m) => m.pairSymbol.toUpperCase() === up);
    if (bySymbol)
        return bySymbol;
    throw new basis_sdk_1.ValidationError("main", `Unknown main "${ref}". Known: ${all.map((m) => `${m.key ?? m.main} (${m.symbol}/${m.pairSymbol})`).join(", ")}. Use get_mains to list them.`);
}
async function resolveToken(client, ref, field = "token") {
    const r = (ref ?? "").trim();
    if ((0, viem_1.isAddress)(r, { strict: false }))
        return (0, viem_1.getAddress)(r.toLowerCase());
    const all = await client.mains.list();
    const up = r.toUpperCase();
    const main = all.find((m) => m.symbol.toUpperCase() === up || (m.key ?? "").toUpperCase() === up);
    if (main)
        return main.main;
    const pair = all.find((m) => m.pairSymbol.toUpperCase() === up);
    if (pair)
        return pair.pairAsset;
    throw new basis_sdk_1.ValidationError(field, `${field}: "${ref}" isn't an address or a main/pair symbol. Pass the token's 0x address (find it with search_tokens).`);
}
function walletOrSelf(client, wallet, field = "wallet") {
    if (wallet)
        return addr(wallet, field);
    const self = client.account;
    if (!self)
        throw new basis_sdk_1.ValidationError(field, `Pass ${field}: this server has no wallet of its own (no BASIS_PRIVATE_KEY).`);
    return self;
}
let maxSlippagePercent = 50;
let realMoney = false;
function setSlippageCap(maxPercent, isReal) {
    maxSlippagePercent = maxPercent;
    realMoney = isReal;
}
function slippageToBps(percent) {
    if (percent === undefined || percent === null)
        return undefined;
    if (!Number.isFinite(percent) || percent < 0 || percent > maxSlippagePercent) {
        throw new basis_sdk_1.ValidationError("slippage_percent", `slippage_percent must be from 0 to ${maxSlippagePercent}` +
            (realMoney ? " on real money (BASIS_MAX_SLIPPAGE_PERCENT in the MCP config changes the cap)." : "."));
    }
    return percent > 0 ? Math.max(1, Math.round(percent * 100)) : 0;
}
function uint(value, field) {
    const s = typeof value === "number" ? (Number.isInteger(value) ? String(value) : "x") : String(value).trim();
    if (!/^\d+$/.test(s))
        throw new basis_sdk_1.ValidationError(field, `${field} must be a whole number, got "${String(value)}".`);
    return BigInt(s);
}
