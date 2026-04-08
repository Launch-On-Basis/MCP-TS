import { BasisClient } from '../BasisClient';
import { Address } from 'viem';
export declare class PredictionMarketsModule {
    private client;
    private marketTradingAddress;
    constructor(client: BasisClient, marketTradingAddress: Address);
    private _syncTx;
    /**
     * Helper to approve tokens for the MarketTrading contract
     */
    private approveIfNeeded;
    /**
     * Internal: creates a market on-chain. Use createMarketWithMetadata() instead.
     */
    private createMarket;
    /**
     * Creates a prediction market and registers its metadata on IPFS in one call.
     * Requires SIWE authentication.
     *
     * Returns { hash, receipt, marketTokenAddress, imageUrl, metadata }
     * @param options.endTime - Unix timestamp in seconds
     * @param options.bonding - USDB amount in wei (18 decimals)
     * @param options.seedAmount - USDB amount in wei (18 decimals)
     */
    createMarketWithMetadata(options: {
        marketName: string;
        symbol: string;
        endTime: bigint;
        optionNames: string[];
        maintoken: Address;
        frozen?: boolean;
        bonding?: bigint;
        seedAmount?: bigint;
        description?: string;
        imageUrl?: string;
        imageFile?: Blob | Buffer;
        website?: string;
        telegram?: string;
        twitterx?: string;
    }): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
        marketTokenAddress: `0x${string}`;
        imageUrl: string;
        metadata: {
            url: string;
            cid: string;
        };
    }>;
    /**
     * Executes an AMM buy for a prediction outcome.
     * @param marketToken - market token address
     * @param outcomeId - outcome index
     * @param inputToken - input token address
     * @param inputAmount - input token amount in wei (18 decimals)
     * @param minUsdb - minimum USDB in wei (18 decimals)
     * @param minShares - minimum shares in wei (18 decimals)
     */
    buy(marketToken: Address, outcomeId: number, inputToken: Address, inputAmount: bigint, minUsdb: bigint, minShares: bigint): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Claims winnings after a market resolves.
     */
    redeem(marketToken: Address): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Reads the MarketData struct.
     */
    getMarketData(marketToken: Address): Promise<unknown>;
    /**
     * Reads the Outcome struct.
     */
    getOutcome(marketToken: Address, outcomeId: number): Promise<unknown>;
    /**
     * Reads user balances.
     */
    getUserShares(marketToken: Address, user: Address, outcomeId: number): Promise<unknown>;
    /**
     * Returns the initial reserves required for a given number of outcomes.
     */
    getInitialReserves(numOutcomes: bigint): Promise<readonly [bigint, bigint]>;
    /**
     * Returns the number of outcomes for a market.
     */
    getNumOutcomes(marketToken: Address): Promise<bigint>;
    getOptionNames(marketToken: Address): Promise<string[]>;
    hasBettedOnMarket(marketToken: Address, user: Address): Promise<boolean>;
    getBountyPool(marketToken: Address): Promise<bigint>;
    getGeneralPot(marketToken: Address): Promise<bigint>;
    /**
     * @param usdbAmount - USDB amount in wei (18 decimals)
     */
    getBuyOrderAmountsOut(marketToken: Address, orderId: bigint, usdbAmount: bigint): Promise<unknown>;
    /**
     * Buys from order book and AMM in a single transaction.
     * @param totalInput - input token amount in wei (18 decimals)
     * @param minShares - minimum shares in wei (18 decimals)
     */
    buyOrdersAndContract(marketToken: Address, outcomeId: number, orderIds: bigint[], inputToken: Address, totalInput: bigint, minShares: bigint): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
}
