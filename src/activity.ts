
export type WriteStatus =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "sent, not confirmed"
  | "cancelled, not sent"
  | "partly sent, some not confirmed"
  | "approval sent, action not sent"
  | "preview only, not sent"
  | "unfinished";

export interface WriteRecord {
  tool: string;
  /** The main inputs, so two writes of the same tool can be told apart (amounts, tokens, ids; never keys). */
  inputs?: Record<string, unknown>;
  started: string;
  status: WriteStatus;
  hash?: string;
  hashes?: string[];
  finished?: string;
}

const MAX = 20;
const records: WriteRecord[] = [];
const SUMMARY_KEYS = [
  "token", "token_in", "token_out", "market", "main", "amount", "percent", "outcome", "days", "loan_id", "position_id",
  "vesting_id", "order_id", "name", "symbol", "registration_tx",
];

function summary(args: unknown): Record<string, unknown> | undefined {
  if (!args || typeof args !== "object") return undefined;
  const a = args as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of SUMMARY_KEYS) {
    const v = a[k];
    if (v === undefined || v === null) continue;
    out[k] = typeof v === "string" && v.length > 80 ? `${v.slice(0, 80)}...` : v;
  }
  return Object.keys(out).length ? out : undefined;
}

export function writeQueued(tool: string, args: unknown): WriteRecord {
  const r: WriteRecord = { tool, inputs: summary(args), started: new Date().toISOString(), status: "queued" };
  records.unshift(r);
  if (records.length > MAX) records.length = MAX;
  return r;
}

export function writeRunning(r: WriteRecord): void {
  r.status = "running";
}

const HASH = /^0x[0-9a-fA-F]{64}$/;

function hashOf(v: unknown): string | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o.hash === "string" && HASH.test(o.hash)) return o.hash;
  for (const k of ["result", "tx", "transaction"]) {
    const x = o[k];
    if (x && typeof x === "object" && typeof (x as Record<string, unknown>).hash === "string") return (x as Record<string, unknown>).hash as string;
  }
  return undefined;
}

/** Entries of a result list (claim-all tools) that were sent but aren't confirmed. */
function unconfirmedIn(v: unknown): string[] {
  const items = Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v as Record<string, unknown>).find(Array.isArray) : undefined;
  if (!Array.isArray(items)) return [];
  const out: string[] = [];
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    if (typeof o.status === "string" && /not confirmed/i.test(o.status) && typeof o.hash === "string") out.push(o.hash);
  }
  return out;
}

/** A result that sent nothing: a confirm preview, or a registration that must be called again. */
function notSent(v: unknown): "preview only, not sent" | "unfinished" | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const status = typeof o.status === "string" ? o.status : "";
  if (/preview/i.test(status) || (typeof o.message === "string" && /^nothing was sent|nothing was sent\./i.test(o.message) && !o.hash)) {
    return "preview only, not sent";
  }
  if (/not finished/i.test(status)) return "unfinished";
  return null;
}

export function writeDone(r: WriteRecord, result: unknown): void {
  r.finished = new Date().toISOString();
  r.hash = hashOf(result);
  const pending = unconfirmedIn(result);
  const idle = r.hash ? null : notSent(result);
  if (idle) {
    r.status = idle;
  } else if (pending.length) {
    r.status = "partly sent, some not confirmed";
    r.hashes = pending;
  } else {
    r.status = "done";
  }
}

/** A failed write. Any error carrying `txHash` (the SDK's not-confirmed error, or a GuidedError made from it) means it WAS sent. */
export function writeFailed(r: WriteRecord, e: unknown, cancelled = false): void {
  r.finished = new Date().toISOString();
  if (cancelled) {
    r.status = "cancelled, not sent";
    return;
  }
  const h = e && typeof e === "object" ? (e as { txHash?: unknown }).txHash : undefined;
  const fn = e && typeof e === "object" ? (e as { functionName?: unknown }).functionName : undefined;
  if (typeof h === "string" && HASH.test(h)) {
    r.status = fn === "approve" ? "approval sent, action not sent" : "sent, not confirmed";
    r.hash = h;
  } else {
    r.status = "failed";
  }
}

export function recentWrites(): WriteRecord[] {
  return records.slice(0, 10).map((r) => ({ ...r }));
}

export const RECENT_WRITES_NOTE =
  "queued / running: it is still going and will finish on its own; sent, not confirmed: check the hash with get_transaction. " +
  "Don't send either again. approval sent, action not sent: once that approval confirms, call the tool again.";
