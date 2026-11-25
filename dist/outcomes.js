"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveOutcome = resolveOutcome;
exports.outcomeParam = outcomeParam;
const zod_1 = require("zod");
const basis_sdk_1 = require("basis-sdk");
function list(names) {
    const shown = names.slice(0, 40).map((n, i) => `#${i} = ${n}`).join(", ");
    return shown + (names.length > 40 ? ", ..." : "");
}
function resolveOutcome(names, value, field = "outcome") {
    const n = names.length;
    const byName = (s) => names.findIndex((x) => x.trim().toLowerCase() === s.trim().toLowerCase());
    const validId = (id) => Number.isInteger(id) && id >= 0 && (n === 0 || id < n);
    const checkId = (id) => {
        if (!Number.isInteger(id) || id < 0 || (n > 0 && id >= n)) {
            throw new basis_sdk_1.ValidationError(field, `${field}: there is no outcome #${id}. ${n ? `Outcomes: ${list(names)}.` : ""}`.trim());
        }
        return id;
    };
    if (typeof value === "number") {
        if (!Number.isInteger(value))
            throw new basis_sdk_1.ValidationError(field, `${field} must be an outcome id (a whole number) or a name.`);
        const named = n ? byName(String(value)) : -1;
        if (named >= 0 && named !== value) {
            if (!validId(value))
                return named;
            throw ambiguous(field, names, value, named);
        }
        return checkId(value);
    }
    const s = String(value ?? "").trim();
    if (!s)
        throw new basis_sdk_1.ValidationError(field, `${field} is empty. ${n ? `Outcomes: ${list(names)}.` : ""}`.trim());
    const named = n ? byName(s) : -1;
    const explicit = /^(?:#|id\s*[:=]?\s*)(\d+)$/i.exec(s);
    if (explicit) {
        const id = Number(explicit[1]);
        if (named >= 0 && named !== id) {
            if (!validId(id))
                return named;
            throw new basis_sdk_1.ValidationError(field, `${field} "${s}" is ambiguous on this market: it is outcome #${id} ("${names[id]}"), and outcome #${named} is named "${names[named]}". ` +
                `Pass the id as a plain number (${id}) for "${names[id]}", or ${named} for "${names[named]}". Nothing was sent.`);
        }
        return checkId(id);
    }
    if (/^\d+$/.test(s)) {
        const id = Number(s);
        if (named >= 0 && named !== id) {
            if (!validId(id))
                return named;
            throw ambiguous(field, names, id, named);
        }
        if (named >= 0)
            return named;
        return checkId(id);
    }
    if (named >= 0)
        return named;
    throw new basis_sdk_1.ValidationError(field, `${field}: no outcome named "${s}". ${n ? `Outcomes: ${list(names)}.` : "Give the outcome id, e.g. \"#0\"."}`.trim());
}
function ambiguous(field, names, id, named) {
    const idName = names[id] !== undefined ? ` ("${names[id]}")` : "";
    return new basis_sdk_1.ValidationError(field, `${field} ${id} is ambiguous on this market: it is outcome #${id}${idName}, and outcome #${named} is named "${names[named]}". ` +
        `Pass "#${id}" for outcome #${id}, or "#${named}" for the one named "${names[named]}". Nothing was sent.`);
}
function outcomeParam(desc = "The outcome: its name, or its id as \"#0\" (0 is the first). See the market's outcomes with get_market_info.") {
    return zod_1.z.union([zod_1.z.string(), zod_1.z.number().int().min(0)]).describe(desc);
}
