
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export type NetworkKey = "robinhoodPaper" | "robinhood";

export const TOOLSETS = [
  "account",
  "trading",
  "tokens",
  "loans",
  "vesting",
  "markets",
  "private",
  "social",
  "data",
] as const;
export type Toolset = (typeof TOOLSETS)[number];

export interface Config {
  chain: NetworkKey;
  /** Human name of the network, for text: "BASIS paper (test tokens)" / "BASIS (real money)". */
  networkName: string;
  isPaper: boolean;
  isReal: boolean;
  privateKey?: `0x${string}`;
  apiKey?: string;
  rotateApiKey: boolean;
  rpcUrl?: string;
  apiDomain?: string;
  /** null = every toolset. */
  toolsets: Set<Toolset> | null;
  stateDir: string;
  slippageBps?: number;
  /** Highest slippage a tool call may ask for, in percent: 10 on real money, 50 elsewhere, unless BASIS_MAX_SLIPPAGE_PERCENT says otherwise. */
  maxSlippagePercent: number;
  /** Optional cap on what one write may spend, in US dollars (BASIS_MAX_SPEND). Unset: no cap. */
  maxSpendUsd?: number;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const CHAIN_ALIASES: Record<string, NetworkKey> = {
  paper: "robinhoodPaper",
  robinhoodpaper: "robinhoodPaper",
  "robinhood-paper": "robinhoodPaper",
  robinhood: "robinhood",
  real: "robinhood",
  mainnet: "robinhood",
  live: "robinhood",
};

function env(name: string): string | undefined {
  const v = process.env[name];
  if (v === undefined) return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}

function flag(name: string): boolean {
  const v = env(name)?.toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function loadConfig(): Config {
  const chainRaw = env("BASIS_CHAIN") ?? "paper";
  const chain = CHAIN_ALIASES[chainRaw.toLowerCase()];
  if (!chain) {
    throw new ConfigError(`BASIS_CHAIN must be "paper" (default) or "robinhood" (real money), got "${chainRaw}".`);
  }

  let privateKey: `0x${string}` | undefined;
  const pk = env("BASIS_PRIVATE_KEY");
  if (pk) {
    const hex = pk.startsWith("0x") || pk.startsWith("0X") ? pk.slice(2) : pk;
    const n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
    if (!/^[0-9a-fA-F]{64}$/.test(hex) || BigInt(`0x${hex}`) === 0n || BigInt(`0x${hex}`) >= n) {
      throw new ConfigError("BASIS_PRIVATE_KEY is not a valid private key (64 hex characters, with or without 0x).");
    }
    privateKey = `0x${hex.toLowerCase()}`;
  }

  let toolsets: Set<Toolset> | null = null;
  const ts = env("BASIS_TOOLSETS");
  if (ts && ts.toLowerCase() !== "all") {
    toolsets = new Set();
    for (const part of ts.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)) {
      if (!(TOOLSETS as readonly string[]).includes(part)) {
        throw new ConfigError(`BASIS_TOOLSETS: unknown toolset "${part}". Known: ${TOOLSETS.join(", ")}.`);
      }
      toolsets.add(part as Toolset);
    }
    toolsets.add("account");
    if (toolsets.has("private")) toolsets.add("markets");
    if (toolsets.has("markets")) toolsets.add("private");
  }

  const isPaper = chain === "robinhoodPaper";
  const isReal = chain === "robinhood";

  let maxSlippagePercent = isReal ? 10 : 50;
  const maxSl = env("BASIS_MAX_SLIPPAGE_PERCENT");
  if (maxSl) {
    const m = Number(maxSl);
    if (!Number.isFinite(m) || m < 0 || m > 50) throw new ConfigError("BASIS_MAX_SLIPPAGE_PERCENT must be a number from 0 to 50.");
    maxSlippagePercent = m;
  }

  let slippageBps: number | undefined;
  const sl = env("BASIS_SLIPPAGE_PERCENT");
  if (sl) {
    const p = Number(sl);
    if (!Number.isFinite(p) || p < 0 || p > maxSlippagePercent) {
      throw new ConfigError(
        `BASIS_SLIPPAGE_PERCENT must be a number from 0 to ${maxSlippagePercent}` +
          (isReal && !maxSl ? " on real money (BASIS_MAX_SLIPPAGE_PERCENT raises the cap)." : "."),
      );
    }
    slippageBps = p > 0 ? Math.max(1, Math.round(p * 100)) : 0;
  } else if (maxSlippagePercent < 1) {
    slippageBps = Math.round(maxSlippagePercent * 100);
  }

  let maxSpendUsd: number | undefined;
  const ms = env("BASIS_MAX_SPEND");
  if (ms) {
    const v = Number(ms.replace(/^\$/, ""));
    if (!Number.isFinite(v) || v <= 0) throw new ConfigError("BASIS_MAX_SPEND must be a dollar amount above 0, e.g. 100.");
    maxSpendUsd = v;
  }

  const apiKey = env("BASIS_API_KEY");
  const rotateApiKey = flag("BASIS_ROTATE_API_KEY");
  if (apiKey && rotateApiKey) {
    throw new ConfigError("Set BASIS_API_KEY or BASIS_ROTATE_API_KEY, not both: rotating makes a new key and replaces the one given.");
  }

  const stateDirRaw = env("BASIS_STATE_DIR");
  if (stateDirRaw && !isAbsolute(stateDirRaw)) {
    throw new ConfigError("BASIS_STATE_DIR must be a full path (it would otherwise depend on the folder the MCP client starts in).");
  }
  return {
    chain,
    networkName: isPaper ? "BASIS paper (test tokens; gas is real ETH)" : "BASIS (real money)",
    isPaper,
    isReal,
    privateKey,
    apiKey,
    rotateApiKey,
    rpcUrl: env("BASIS_RPC_URL"),
    apiDomain: env("BASIS_API_DOMAIN"),
    toolsets,
    stateDir: stateDirRaw ?? join(homedir(), ".basis-mcp"),
    slippageBps,
    maxSlippagePercent,
    maxSpendUsd,
  };
}
