import type { ToolDef } from "../registry.js";
import { accountTools } from "./account.js";
import { agentsTools } from "./agents.js";
import { tradingTools } from "./trading.js";
import { tokensTools } from "./tokens.js";
import { loansTools } from "./loans.js";
import { vestingTools } from "./vesting.js";
import { marketsTools } from "./markets.js";
import { resolverTools } from "./resolver.js";
import { privateTools } from "./private.js";
import { socialTools } from "./social.js";
import { dataTools } from "./data.js";

export const ALL_TOOLS: ToolDef[] = [
  ...accountTools,
  ...agentsTools,
  ...tradingTools,
  ...tokensTools,
  ...loansTools,
  ...vestingTools,
  ...marketsTools,
  ...resolverTools,
  ...privateTools,
  ...socialTools,
  ...dataTools,
];
