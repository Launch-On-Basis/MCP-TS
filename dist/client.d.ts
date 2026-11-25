import { BasisClient, type AgentConfig, type AgentRegisterResult } from "basis-sdk";
import type { Config } from "./config.js";
import { type PendingRegistration } from "./state.js";
export declare function initClientConfig(c: Config): void;
export declare function getConfig(): Config;
export declare function walletAddress(): `0x${string}` | undefined;
export declare function getClient(): Promise<BasisClient>;
export declare function retrySignInIfNeeded(): Promise<string | undefined>;
export declare function currentClient(): BasisClient | undefined;
export declare function walletNeedsOnboarding(): boolean;
export declare function currentSignInProblem(): string | undefined;
export declare function pendingRegistration(): PendingRegistration | undefined;
export interface RegisterOutcome {
    client: BasisClient;
    result: AgentRegisterResult | null;
    unfinished?: boolean;
}
export declare function registerAgent(agent: AgentConfig, registrationTx?: `0x${string}`): Promise<RegisterOutcome>;
