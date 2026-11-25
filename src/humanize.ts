
import { formatEther, formatUnits, getAddress, isAddress, type Address } from "viem";
import { ValidationError, type BasisClient } from "basis-sdk";

async function tokenText(client: BasisClient, ref: string): Promise<{ symbol: string; decimals: number } | null> {
  try {
    if (isAddress(ref, { strict: false })) {
      const m = await client.mains.tokenMeta(getAddress(ref.toLowerCase()) as Address);
      return { symbol: m.symbol, decimals: m.decimals };
    }
    const mains = await client.mains.list();
    const up = ref.toUpperCase();
    const main = mains.find((x) => x.symbol.toUpperCase() === up);
    if (main) return { symbol: main.symbol, decimals: 18 };
    const pair = mains.find((x) => x.pairSymbol.toUpperCase() === up);
    if (pair) return { symbol: pair.pairSymbol, decimals: pair.pairDecimals };
  } catch {
  }
  return null;
}

/** The same error in human units when it is one of the SDK's raw-unit refusals, else `e` itself. */
export async function humanize(e: unknown, client: BasisClient | undefined): Promise<unknown> {
  if (!client || !(e instanceof ValidationError)) return e;
  const msg = e.message.replace(/\[basis-sdk\]\s*/g, "");

  let m = /Balance of (\S+) is (\d+), below the (\d+)(?: (needed|to repay|fee))?/.exec(msg);
  if (m) {
    const t = await tokenText(client, m[1]);
    if (!t) return e;
    const what = m[4] === "to repay" ? "to repay this" : m[4] === "fee" ? "for the fee" : "for this";
    return new ValidationError(
      e.rule,
      `Not enough ${t.symbol} in the wallet: it has ${formatUnits(BigInt(m[2]), t.decimals)} ${t.symbol}, and ${what} it needs ${formatUnits(BigInt(m[3]), t.decimals)} ${t.symbol}. Nothing was sent.`,
    );
  }

  m = /Native balance (\d+) is below (\d+)/.exec(msg);
  if (m) {
    return new ValidationError(
      e.rule,
      `Not enough ETH in the wallet: it has ${formatEther(BigInt(m[1]))} ETH, and this needs ${formatEther(BigInt(m[2]))} ETH. Nothing was sent.`,
    );
  }

  m = /The bet needs (\d+) raw units of (\S+?);? the wallet holds (\d+)/.exec(msg);
  if (m) {
    const t = await tokenText(client, m[2].replace(/[;.,]$/, ""));
    if (!t) return e;
    return new ValidationError(
      e.rule,
      `Not enough ${t.symbol} for this prediction: it needs ${formatUnits(BigInt(m[1]), t.decimals)} ${t.symbol}, and the wallet holds ${formatUnits(BigInt(m[3]), t.decimals)}. Nothing was sent.`,
    );
  }
  return e;
}
