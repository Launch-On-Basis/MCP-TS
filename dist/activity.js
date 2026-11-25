"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RECENT_WRITES_NOTE = void 0;
exports.writeQueued = writeQueued;
exports.writeRunning = writeRunning;
exports.writeDone = writeDone;
exports.writeFailed = writeFailed;
exports.recentWrites = recentWrites;
const MAX = 20;
const records = [];
const SUMMARY_KEYS = [
    "token", "token_in", "token_out", "market", "main", "amount", "percent", "outcome", "days", "loan_id", "position_id",
    "vesting_id", "order_id", "name", "symbol", "registration_tx",
];
function summary(args) {
    if (!args || typeof args !== "object")
        return undefined;
    const a = args;
    const out = {};
    for (const k of SUMMARY_KEYS) {
        const v = a[k];
        if (v === undefined || v === null)
            continue;
        out[k] = typeof v === "string" && v.length > 80 ? `${v.slice(0, 80)}...` : v;
    }
    return Object.keys(out).length ? out : undefined;
}
function writeQueued(tool, args) {
    const r = { tool, inputs: summary(args), started: new Date().toISOString(), status: "queued" };
    records.unshift(r);
    if (records.length > MAX)
        records.length = MAX;
    return r;
}
function writeRunning(r) {
    r.status = "running";
}
const HASH = /^0x[0-9a-fA-F]{64}$/;
function hashOf(v) {
    if (!v || typeof v !== "object")
        return undefined;
    const o = v;
    if (typeof o.hash === "string" && HASH.test(o.hash))
        return o.hash;
    for (const k of ["result", "tx", "transaction"]) {
        const x = o[k];
        if (x && typeof x === "object" && typeof x.hash === "string")
            return x.hash;
    }
    return undefined;
}
function unconfirmedIn(v) {
    const items = Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v).find(Array.isArray) : undefined;
    if (!Array.isArray(items))
        return [];
    const out = [];
    for (const it of items) {
        if (!it || typeof it !== "object")
            continue;
        const o = it;
        if (typeof o.status === "string" && /not confirmed/i.test(o.status) && typeof o.hash === "string")
            out.push(o.hash);
    }
    return out;
}
function notSent(v) {
    if (!v || typeof v !== "object")
        return null;
    const o = v;
    const status = typeof o.status === "string" ? o.status : "";
    if (/preview/i.test(status) || (typeof o.message === "string" && /^nothing was sent|nothing was sent\./i.test(o.message) && !o.hash)) {
        return "preview only, not sent";
    }
    if (/not finished/i.test(status))
        return "unfinished";
    return null;
}
function writeDone(r, result) {
    r.finished = new Date().toISOString();
    r.hash = hashOf(result);
    const pending = unconfirmedIn(result);
    const idle = r.hash ? null : notSent(result);
    if (idle) {
        r.status = idle;
    }
    else if (pending.length) {
        r.status = "partly sent, some not confirmed";
        r.hashes = pending;
    }
    else {
        r.status = "done";
    }
}
function writeFailed(r, e, cancelled = false) {
    r.finished = new Date().toISOString();
    if (cancelled) {
        r.status = "cancelled, not sent";
        return;
    }
    const h = e && typeof e === "object" ? e.txHash : undefined;
    const fn = e && typeof e === "object" ? e.functionName : undefined;
    if (typeof h === "string" && HASH.test(h)) {
        r.status = fn === "approve" ? "approval sent, action not sent" : "sent, not confirmed";
        r.hash = h;
    }
    else {
        r.status = "failed";
    }
}
function recentWrites() {
    return records.slice(0, 10).map((r) => ({ ...r }));
}
exports.RECENT_WRITES_NOTE = "queued / running: it is still going and will finish on its own; sent, not confirmed: check the hash with get_transaction. " +
    "Don't send either again. approval sent, action not sent: once that approval confirms, call the tool again.";
