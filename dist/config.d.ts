export type NetworkKey = "robinhoodPaper" | "robinhood";
export declare const TOOLSETS: readonly ["account", "trading", "tokens", "loans", "vesting", "markets", "private", "social", "data"];
export type Toolset = (typeof TOOLSETS)[number];
export interface Config {
    chain: NetworkKey;
    networkName: string;
    isPaper: boolean;
    isReal: boolean;
    privateKey?: `0x${string}`;
    apiKey?: string;
    rotateApiKey: boolean;
    rpcUrl?: string;
    apiDomain?: string;
    toolsets: Set<Toolset> | null;
    stateDir: string;
    slippageBps?: number;
    maxSlippagePercent: number;
    maxSpendUsd?: number;
}
export declare class ConfigError extends Error {
    constructor(message: string);
}
export declare function loadConfig(): Config;
