
import { z } from "zod";
import { ValidationError } from "basis-sdk";

function list(names: readonly string[]): string {
  const shown = names.slice(0, 40).map((n, i) => `#${i} = ${n}`).join(", ");
  return shown + (names.length > 40 ? ", ..." : "");
}

/**
 * The id of an outcome from what an agent typed:
 * - "#2" or "id 2": id 2;
 * - a number (2 or "2"): id 2, unless another outcome is named "2" (refused as ambiguous);
 * - any other text: the outcome with that name (case and spaces ignored).
 * `names` empty (not known): only ids are accepted, unchecked.
 */
export function resolveOutcome(names: readonly string[], value: string | number, field = "outcome"): number {
  const n = names.length;
  const byName = (s: string) => names.findIndex((x) => x.trim().toLowerCase() === s.trim().toLowerCase());
  const validId = (id: number) => Number.isInteger(id) && id >= 0 && (n === 0 || id < n);
  const checkId = (id: number): number => {
    if (!Number.isInteger(id) || id < 0 || (n > 0 && id >= n)) {
      throw new ValidationError(field, `${field}: there is no outcome #${id}. ${n ? `Outcomes: ${list(names)}.` : ""}`.trim());
    }
    return id;
  };

  if (typeof value === "number") {
    if (!Number.isInteger(value)) throw new ValidationError(field, `${field} must be an outcome id (a whole number) or a name.`);
    const named = n ? byName(String(value)) : -1;
    if (named >= 0 && named !== value) {
      if (!validId(value)) return named;
      throw ambiguous(field, names, value, named);
    }
    return checkId(value);
  }

  const s = String(value ?? "").trim();
  if (!s) throw new ValidationError(field, `${field} is empty. ${n ? `Outcomes: ${list(names)}.` : ""}`.trim());
  const named = n ? byName(s) : -1;
  const explicit = /^(?:#|id\s*[:=]?\s*)(\d+)$/i.exec(s);
  if (explicit) {
    const id = Number(explicit[1]);
    if (named >= 0 && named !== id) {
      if (!validId(id)) return named;
      throw new ValidationError(
        field,
        `${field} "${s}" is ambiguous on this market: it is outcome #${id} ("${names[id]}"), and outcome #${named} is named "${names[named]}". ` +
          `Pass the id as a plain number (${id}) for "${names[id]}", or ${named} for "${names[named]}". Nothing was sent.`,
      );
    }
    return checkId(id);
  }

  if (/^\d+$/.test(s)) {
    const id = Number(s);
    if (named >= 0 && named !== id) {
      if (!validId(id)) return named;
      throw ambiguous(field, names, id, named);
    }
    if (named >= 0) return named;
    return checkId(id);
  }
  if (named >= 0) return named;
  throw new ValidationError(field, `${field}: no outcome named "${s}". ${n ? `Outcomes: ${list(names)}.` : "Give the outcome id, e.g. \"#0\"."}`.trim());
}

function ambiguous(field: string, names: readonly string[], id: number, named: number): ValidationError {
  const idName = names[id] !== undefined ? ` ("${names[id]}")` : "";
  return new ValidationError(
    field,
    `${field} ${id} is ambiguous on this market: it is outcome #${id}${idName}, and outcome #${named} is named "${names[named]}". ` +
      `Pass "#${id}" for outcome #${id}, or "#${named}" for the one named "${names[named]}". Nothing was sent.`,
  );
}

/** The schema for an outcome parameter. */
export function outcomeParam(desc = "The outcome: its name, or its id as \"#0\" (0 is the first). See the market's outcomes with get_market_info.") {
  return z.union([z.string(), z.number().int().min(0)]).describe(desc);
}
