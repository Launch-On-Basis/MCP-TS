import { type BuyBlockReason } from "basis-sdk";
export type MarketKind = "public" | "private";
export declare function isBlockReason(rule: string | null | undefined): rule is BuyBlockReason;
export declare function blockText(reason: BuyBlockReason | null | undefined, kind: MarketKind): string | null;
export declare function rewordPredictionRefusal(e: unknown, kind: MarketKind): unknown;
