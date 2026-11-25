
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.js";

export interface PendingRegistration {
  hash: `0x${string}`;
  /** Unix ms when it was saved. */
  savedAt: number;
}

interface WalletState {
  apiKey?: string;
  /** An agent registration tx that was sent but not finished: the next register_agent finishes it instead of minting again. */
  pendingRegistration?: PendingRegistration;
}

/** The sites each network uses by default: those keep the plain file names. */
const DEFAULT_SITES: Record<string, string> = {
  robinhood: "launchonbasis.com",
  robinhoodPaper: "paper.launchonbasis.com",
};

/** A custom BASIS_API_DOMAIN gets files of its own (a key is valid on one site only). */
function siteSuffix(config: Config): string {
  if (!config.apiDomain) return "";
  let host: string;
  try {
    host = new URL(config.apiDomain).host.toLowerCase();
  } catch {
    host = config.apiDomain.replace(/^[a-z]+:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
  }
  if (!host || DEFAULT_SITES[config.chain] === host) return "";
  return `-${host.replace(/[^a-z0-9.]+/g, "_")}`;
}

function fileFor(config: Config, wallet: string, suffix: string): string {
  return join(config.stateDir, `${config.chain}${siteSuffix(config)}-${wallet.toLowerCase()}${suffix}`);
}

function ensureDir(config: Config): void {
  mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });
}

export function readWalletState(config: Config, wallet: string): WalletState {
  const path = fileFor(config, wallet, ".json");
  if (!existsSync(path)) return {};
  try {
    const s = JSON.parse(readFileSync(path, "utf8")) as WalletState & { pendingRegistrationTx?: `0x${string}` };
    if (s.pendingRegistrationTx && !s.pendingRegistration) s.pendingRegistration = { hash: s.pendingRegistrationTx, savedAt: Date.now() };
    delete s.pendingRegistrationTx;
    return s;
  } catch {
    console.error(`[basis-mcp] The state file for this wallet in ${config.stateDir} can't be read: its saved API key is ignored this run.`);
    return {};
  }
}

export function saveApiKey(config: Config, wallet: string, apiKey: string): void {
  writeState(config, wallet, { ...readWalletState(config, wallet), apiKey });
}

/** Remembers (or, with undefined, forgets) a registration that was sent but not finished. */
export function savePendingRegistration(config: Config, wallet: string, hash: `0x${string}` | undefined): void {
  const { pendingRegistration: _old, ...rest } = readWalletState(config, wallet);
  writeState(config, wallet, hash ? { ...rest, pendingRegistration: { hash, savedAt: Date.now() } } : rest);
}

function writeState(config: Config, wallet: string, state: WalletState): void {
  ensureDir(config);
  const path = fileFor(config, wallet, ".json");
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  try {
    chmodSync(tmp, 0o600);
  } catch {
  }
  renameSync(tmp, path);
}

export function syncQueueFile(config: Config, wallet: string): string {
  ensureDir(config);
  return fileFor(config, wallet, "-sync-queue.jsonl");
}
