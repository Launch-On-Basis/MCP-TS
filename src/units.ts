
import { getAddress, isAddress, type Address } from "viem";
import { parseAmount, ValidationError, type BasisClient, type MainInfo } from "basis-sdk";

/** Human amount ("12.5", 12.5, "1e-6") to raw units with `decimals`. Truncates extra digits toward zero. */
export function toRaw(value: string | number, decimals: number, field = "amount"): bigint {
  return parseAmount(typeof value === "number" ? String(value) : value, decimals, field);
}

/** 18-decimal amounts: main tokens, factory tokens, market shares. */
export function to18(value: string | number, field = "amount"): bigint {
  return toRaw(value, 18, field);
}

/** A checksummed address, or ValidationError(field). */
export function addr(value: string, field = "address"): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) {
    throw new ValidationError(field, `${field} must be a 0x address (40 hex characters), got "${String(value)}".`);
  }
  return getAddress(value.toLowerCase());
}

/** Raw units of any ERC-20, from its own decimals. */
export async function toTokenRaw(client: BasisClient, token: Address, value: string | number, field = "amount"): Promise<bigint> {
  const { decimals } = await client.mains.tokenMeta(token);
  return toRaw(value, decimals, field);
}

/** The main a token trades against (the token itself for a main). */
export async function mainOfToken(client: BasisClient, token: Address): Promise<MainInfo> {
  return client.mains.infoOfToken(token);
}

/** Raw units of the pair asset (e.g. USDG) of the main `token` trades against. */
export async function toPairRawForToken(client: BasisClient, token: Address, value: string | number, field = "amount"): Promise<bigint> {
  const info = await client.mains.infoOfToken(token);
  return toRaw(value, info.pairDecimals, field);
}

/** Raw units of a main's pair asset. */
export function toPairRaw(info: MainInfo, value: string | number, field = "amount"): bigint {
  return toRaw(value, info.pairDecimals, field);
}

/**
 * A main from what an agent typed: an address-book key ("stasis-usdg"), a main address, the main's symbol ("STASIS")
 * or its pair asset's symbol ("USDG"). Empty: the default main.
 */
export async function resolveMain(client: BasisClient, ref?: string | null): Promise<MainInfo> {
  if (!ref) return client.mains.default();
  const r = ref.trim();
  if (isAddress(r, { strict: false })) return client.mains.get(getAddress(r.toLowerCase()));
  const byKey = client.addresses.mains.find((m) => m.key.toLowerCase() === r.toLowerCase());
  if (byKey) return client.mains.get(byKey.key);
  const all = await client.mains.list();
  const up = r.toUpperCase();
  const bySymbol = all.find((m) => m.symbol.toUpperCase() === up) ?? all.find((m) => m.pairSymbol.toUpperCase() === up);
  if (bySymbol) return bySymbol;
  throw new ValidationError(
    "main",
    `Unknown main "${ref}". Known: ${all.map((m) => `${m.key ?? m.main} (${m.symbol}/${m.pairSymbol})`).join(", ")}. Use get_mains to list them.`,
  );
}

/**
 * A token from what an agent typed: a 0x address, or the symbol of a main or of a main's pair asset (STASIS, USDG,
 * tNVDA+...). Factory tokens and markets share symbols, so those must be passed by address.
 */
export async function resolveToken(client: BasisClient, ref: string, field = "token"): Promise<Address> {
  const r = (ref ?? "").trim();
  if (isAddress(r, { strict: false })) return getAddress(r.toLowerCase());
  const all = await client.mains.list();
  const up = r.toUpperCase();
  const main = all.find((m) => m.symbol.toUpperCase() === up || (m.key ?? "").toUpperCase() === up);
  if (main) return main.main;
  const pair = all.find((m) => m.pairSymbol.toUpperCase() === up);
  if (pair) return pair.pairAsset;
  throw new ValidationError(
    field,
    `${field}: "${ref}" isn't an address or a main/pair symbol. Pass the token's 0x address (find it with search_tokens).`,
  );
}

/** The wallet a read is about: the one given, else the signer, else an error saying to pass one. */
export function walletOrSelf(client: BasisClient, wallet?: string | null, field = "wallet"): Address {
  if (wallet) return addr(wallet, field);
  const self = client.account;
  if (!self) throw new ValidationError(field, `Pass ${field}: this server has no wallet of its own (no BASIS_PRIVATE_KEY).`);
  return self;
}

let maxSlippagePercent = 50;
let realMoney = false;

/** The slippage cap from the config (10% on real money unless BASIS_MAX_SLIPPAGE_PERCENT says otherwise). */
export function setSlippageCap(maxPercent: number, isReal: boolean): void {
  maxSlippagePercent = maxPercent;
  realMoney = isReal;
}

/** Percent to basis points, within the server's cap. Anything above 0 is at least 1 bps (0.01%). */
export function slippageToBps(percent?: number | null): number | undefined {
  if (percent === undefined || percent === null) return undefined;
  if (!Number.isFinite(percent) || percent < 0 || percent > maxSlippagePercent) {
    throw new ValidationError(
      "slippage_percent",
      `slippage_percent must be from 0 to ${maxSlippagePercent}` +
        (realMoney ? " on real money (BASIS_MAX_SLIPPAGE_PERCENT in the MCP config changes the cap)." : "."),
    );
  }
  return percent > 0 ? Math.max(1, Math.round(percent * 100)) : 0;
}

/** A whole number (id, day count) as bigint, or ValidationError. */
export function uint(value: string | number, field: string): bigint {
  const s = typeof value === "number" ? (Number.isInteger(value) ? String(value) : "x") : String(value).trim();
  if (!/^\d+$/.test(s)) throw new ValidationError(field, `${field} must be a whole number, got "${String(value)}".`);
  return BigInt(s);
}
