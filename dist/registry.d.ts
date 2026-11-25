import { z } from "zod";
import type { BasisClient } from "basis-sdk";
import type { Config, Toolset } from "./config.js";
export interface ToolContext {
    client: () => Promise<BasisClient>;
    config: Config;
}
export interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
    name: string;
    toolset: Toolset;
    title?: string;
    description: string;
    input: S;
    write?: boolean;
    destructive?: boolean;
    sendsTx?: boolean;
    networks?: Config["chain"][];
    run: (args: z.infer<z.ZodObject<S>>, ctx: ToolContext) => Promise<unknown>;
}
export declare function tool<S extends z.ZodRawShape>(def: ToolDef<S>): ToolDef;
export declare const p: {
    address: (desc: string) => z.ZodString;
    token: (desc?: string) => z.ZodString;
    wallet: (desc?: string) => z.ZodOptional<z.ZodString>;
    main: (desc?: string) => z.ZodOptional<z.ZodString>;
    amount: (desc: string) => z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
    optAmount: (desc: string) => z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>>;
    id: (desc: string) => z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
    optId: (desc: string) => z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>>;
    days: (desc?: string) => z.ZodNumber;
    percent: (desc: string) => z.ZodNumber;
    slippage: () => z.ZodOptional<z.ZodNumber>;
    limit: (max?: number, def?: number) => z.ZodOptional<z.ZodNumber>;
    page: () => z.ZodOptional<z.ZodNumber>;
    cursor: () => z.ZodOptional<z.ZodString>;
    bool: (desc: string) => z.ZodOptional<z.ZodBoolean>;
    imageFile: () => z.ZodOptional<z.ZodString>;
    confirm: () => z.ZodOptional<z.ZodBoolean>;
};
