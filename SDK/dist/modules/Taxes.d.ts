import { BasisClient } from '../BasisClient';
import { Address } from 'viem';
export declare class TaxesModule {
    private client;
    private taxesAddress;
    constructor(client: BasisClient, taxesAddress: Address);
    private _syncTx;
    /**
     * Returns the effective tax rate (in basis points) for a specific token and user.
     * @param token - token contract address
     * @param user - user wallet address
     */
    getTaxRate(token: Address, user: Address): Promise<bigint>;
    /**
     * Returns the current surge tax rate (in basis points) for a token.
     * @param token - token contract address
     */
    getCurrentSurgeTax(token: Address): Promise<bigint>;
    /**
     * Returns the available surge quota for a token.
     * @param token - token contract address
     */
    getAvailableSurgeQuota(token: Address): Promise<bigint>;
    /**
     * Returns all four base tax rates.
     */
    getBaseTaxRates(): Promise<{
        stasis: bigint;
        stable: bigint;
        default: bigint;
        prediction: bigint;
    }>;
    /**
     * Start a decaying surge tax on a factory token. Only callable by the token's DEV.
     * @param startRate - basis points (0-10000)
     * @param endRate - basis points (0-10000)
     * @param duration - duration in seconds
     * @param token - token contract address
     */
    startSurgeTax(startRate: bigint, endRate: bigint, duration: bigint, token: Address): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * End an active surge tax early. Only callable by the token's DEV.
     * @param token - token contract address
     */
    endSurgeTax(token: Address): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Add a developer revenue share wallet for a token. Only callable by the token's DEV.
     * @param token - token contract address
     * @param wallet - revenue share recipient address
     * @param basisPoints - basis points (0-10000)
     */
    addDevShare(token: Address, wallet: Address, basisPoints: bigint): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Remove a developer revenue share wallet. Only callable by the token's DEV.
     * @param token - token contract address
     * @param wallet - revenue share recipient address
     */
    removeDevShare(token: Address, wallet: Address): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
}
