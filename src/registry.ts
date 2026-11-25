
import { z } from "zod";
import type { BasisClient } from "basis-sdk";
import type { Config, Toolset } from "./config.js";
import { IMAGE_FILE_TEXT } from "./files.js";

export interface ToolContext {
  /** The shared client (signed in when a wallet is set). Made on first use. */
  client: () => Promise<BasisClient>;
  config: Config;
}

export interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
  /** snake_case, unique across the server. */
  name: string;
  toolset: Toolset;
  /** Short title for clients that show one. */
  title?: string;
  /** What it does and when to use it. Plain words, amounts with their unit, no internal names. */
  description: string;
  input: S;
  /** Sends a transaction or changes something on the site. Writes are hidden when no wallet is set. */
  write?: boolean;
  /** Can lose funds or can't be undone (sells, burns, irreversible settings). */
  destructive?: boolean;
  /** Sends a transaction: runs one at a time with the other transaction writes (no two share a nonce). Default: same as write. */
  sendsTx?: boolean;
  /** Listed only on these networks (e.g. the paper faucet). Default: every network. */
  networks?: Config["chain"][];
  run: (args: z.infer<z.ZodObject<S>>, ctx: ToolContext) => Promise<unknown>;
}

/** Typed helper: keeps the handler's args in step with the schema. */
export function tool<S extends z.ZodRawShape>(def: ToolDef<S>): ToolDef {
  return def as unknown as ToolDef;
}


export const p = {
  address: (desc: string) => z.string().describe(desc),
  token: (desc = "Token address (0x...). Mains and pair assets can also be given by symbol, e.g. STASIS or USDG.") =>
    z.string().describe(desc),
  wallet: (desc = "Wallet address. Default: this server's wallet.") => z.string().optional().describe(desc),
  main: (desc = "Main: key (e.g. stasis-usdg), address or symbol (STASIS). Default: the default main. List them with get_mains.") =>
    z.string().optional().describe(desc),
  amount: (desc: string) => z.union([z.string(), z.number()]).describe(`${desc} Human units, e.g. "12.5".`),
  optAmount: (desc: string) => z.union([z.string(), z.number()]).optional().describe(`${desc} Human units, e.g. "12.5".`),
  id: (desc: string) => z.union([z.string(), z.number()]).describe(desc),
  optId: (desc: string) => z.union([z.string(), z.number()]).optional().describe(desc),
  days: (desc = "Number of days.") => z.number().int().positive().describe(desc),
  percent: (desc: string) => z.number().describe(desc),
  slippage: () =>
    z
      .number()
      .min(0)
      .max(50)
      .optional()
      .describe(
        "Max slippage in percent. Default: the server's setting (1% unless BASIS_SLIPPAGE_PERCENT changes it). At most 10% on real money " +
          "and 50% on paper, unless BASIS_MAX_SLIPPAGE_PERCENT sets another cap. The minimum you receive is set from a fresh quote.",
      ),
  limit: (max = 100, def = 20) => z.number().int().min(1).max(max).optional().describe(`How many items (1 to ${max}, default ${def}).`),
  page: () => z.number().int().min(1).optional().describe("Page number, from 1."),
  cursor: () => z.string().optional().describe("Cursor from the previous page's result, for the next page."),
  bool: (desc: string) => z.boolean().optional().describe(desc),
  imageFile: () => z.string().optional().describe(IMAGE_FILE_TEXT),
  confirm: () =>
    z.boolean().optional().describe("Set true to send. Without it the tool only shows the preview (nothing is sent)."),
};
