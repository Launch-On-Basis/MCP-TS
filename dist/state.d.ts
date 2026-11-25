import type { Config } from "./config.js";
export interface PendingRegistration {
    hash: `0x${string}`;
    savedAt: number;
}
interface WalletState {
    apiKey?: string;
    pendingRegistration?: PendingRegistration;
}
export declare function readWalletState(config: Config, wallet: string): WalletState;
export declare function saveApiKey(config: Config, wallet: string, apiKey: string): void;
export declare function savePendingRegistration(config: Config, wallet: string, hash: `0x${string}` | undefined): void;
export declare function syncQueueFile(config: Config, wallet: string): string;
export {};
