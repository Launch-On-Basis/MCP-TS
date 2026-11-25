import { z } from "zod";
export declare function resolveOutcome(names: readonly string[], value: string | number, field?: string): number;
export declare function outcomeParam(desc?: string): z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
