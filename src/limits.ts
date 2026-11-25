
import { formatUnits, zeroAddress, type Address } from "viem";
import { AuthRequiredError, type BasisClient } from "basis-sdk";
import { getConfig } from "./client.js";
import { GuidedError } from "./errors.js";

const PRICE_TTL_MS = 30_000;
const cache = new Map<string, { usdE18: bigint; at: number }>();

/** The token's dollar price x 1e18, null when it can't be read, "auth" when this server can't read prices at all yet. */
async function usdPriceE18(client: BasisClient, token: Address): Promise<bigint | null | "auth"> {
  const key = token.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < PRICE_TTL_MS) return hit.usdE18;
  let price: string | null | undefined;
  try {
    const all = await client.api.getPrices();
    const isNative = key === zeroAddress;
    const row = (all.data ?? []).find((r) =>
      isNative ? (r.role ?? []).includes("native") : (r.asset ?? "").toLowerCase() === key,
    );
    price = row?.priceUsdE18;
    if (!price && !isNative) {
      const t = await client.api.getTokenPrices([token]);
      const tr = (t.data ?? []).find((r) => (r.address ?? "").toLowerCase() === key && r.found !== false);
      price = tr?.priceUsdE18;
    }
  } catch (e) {
    return e instanceof AuthRequiredError ? "auth" : null;
  }
  if (!price || !/^\d+$/.test(price)) return null;
  const usdE18 = BigInt(price);
  cache.set(key, { usdE18, at: Date.now() });
  return usdE18;
}

/** One amount leaving the wallet: the token (zero address = native ETH) and its raw amount. */
export interface Spend {
  token: Address;
  raw: bigint;
}

/**
 * Refuses a write whose spends, added up in dollars, are over BASIS_MAX_SPEND (e.g. a market's seed plus its ETH
 * creation fee). No cap set: does nothing.
 */
export async function checkSpendTotal(client: BasisClient, spends: readonly Spend[]): Promise<void> {
  const cap = getConfig().maxSpendUsd;
  const items = spends.filter((s) => s.raw > 0n);
  if (cap === undefined || !items.length) return;
  let usd = 0;
  for (const { token, raw } of items) {
    const decimals = token.toLowerCase() === zeroAddress ? 18 : (await client.mains.tokenMeta(token)).decimals;
    const price = await usdPriceE18(client, token);
    if (price === "auth") {
      throw new GuidedError(
        "BASIS_MAX_SPEND is set, and prices come from the BASIS site, which this wallet can't sign in to yet: nothing was sent. Register it with register_agent (or link it on the website), or remove BASIS_MAX_SPEND.",
      );
    }
    if (price === null) {
      throw new GuidedError(
        "BASIS_MAX_SPEND is set, and the dollar price of a token this spends can't be read right now, so nothing was sent. Try again in a minute; a token BASIS has no price for can't be spent or sold through this server while the cap is set.",
      );
    }
    usd += Number(formatUnits(raw * price, decimals + 18));
  }
  if (usd > cap) {
    throw new GuidedError(
      `This would spend about $${usd.toFixed(2)}${items.length > 1 ? " in all" : ""}, over this server's cap of $${cap} per transaction (BASIS_MAX_SPEND). Nothing was sent. Spend less, or raise BASIS_MAX_SPEND.`,
    );
  }
}

/** Refuses a write that would spend more than BASIS_MAX_SPEND: one token leaving the wallet (zero address = native ETH). */
export async function checkSpend(client: BasisClient, token: Address, raw: bigint): Promise<void> {
  return checkSpendTotal(client, [{ token, raw }]);
}
