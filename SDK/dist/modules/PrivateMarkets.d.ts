import { BasisClient } from '../BasisClient';
import { Address } from 'viem';
export declare class PrivateMarketsModule {
    private client;
    private privateMarketAddress;
    constructor(client: BasisClient, privateMarketAddress: Address);
    private approveIfNeeded;
    private _syncTx;
    private syncOrder;
    /**
     * Internal: creates a private market on-chain. Use createMarketWithMetadata() instead.
     */
    private createMarket;
    /**
     * Creates a private prediction market and registers its metadata on IPFS in one call.
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
        privateEvent?: boolean;
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
     * Executes an AMM buy for a private market outcome.
     * Auto-approves the input token.
     * @param inputAmount - input token amount in wei (18 decimals)
     * @param minUsdb - minimum USDB in wei (18 decimals)
     * @param minShares - minimum shares in wei (18 decimals)
     */
    buy(marketToken: Address, outcomeId: number, inputToken: Address, inputAmount: bigint, minUsdb: bigint, minShares: bigint): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Redeems winnings after a market resolves.
     */
    redeem(marketToken: Address): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Creates a limit order on a private market.
     * @param amount - shares in wei (18 decimals)
     * @param pricePerShare - USDB per share in wei (18 decimals)
     */
    listOrder(marketToken: Address, outcomeId: number, amount: bigint, pricePerShare: bigint): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Cancels an active order on a private market.
     */
    cancelOrder(marketToken: Address, orderId: bigint): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Fills a specific order on a private market.
     * Auto-approves USDB for the order cost.
     * @param fill - shares to fill in wei (18 decimals)
     */
    buyOrder(marketToken: Address, orderId: bigint, fill: bigint): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Sweeps multiple orders on a private market.
     * @param usdbAmount - USDB amount in wei (18 decimals)
     */
    buyMultipleOrders(marketToken: Address, orderIds: bigint[], usdbAmount: bigint): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Buys from order book and AMM in a single transaction.
     * Auto-approves the input token.
     * @param totalInput - input token amount in wei (18 decimals)
     * @param minShares - minimum shares in wei (18 decimals)
     */
    buyOrdersAndContract(marketToken: Address, outcomeId: number, orderIds: bigint[], inputToken: Address, totalInput: bigint, minShares: bigint): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Casts a vote on a private market outcome.
     */
    vote(marketToken: Address, outcomeId: number): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Finalizes a private market after voting is complete.
     */
    finalize(marketToken: Address): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Claims the bounty reward for voting correctly.
     */
    claimBounty(marketToken: Address): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Manages voter status for a private market.
     */
    manageVoter(marketToken: Address, voter: Address, status: boolean): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Toggles whether specific addresses can buy in a private event market.
     */
    togglePrivateEventBuyers(marketToken: Address, buyers: Address[], status: boolean): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Disables the freeze on a private market.
     */
    disableFreeze(marketToken: Address): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Manages the whitelist for a private market.
     * @param amount - token amount in wei (18 decimals)
     */
    manageWhitelist(marketToken: Address, wallets: Address[], amount: bigint, tag: string, status: boolean): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Returns the MarketData struct for a private market.
     */
    getMarketData(marketToken: Address): Promise<unknown>;
    /**
     * Returns the number of outcomes for a market.
     */
    getNumOutcomes(marketToken: Address): Promise<bigint>;
    /**
     * Returns the Outcome struct for a specific outcome.
     */
    getOutcome(marketToken: Address, outcomeId: bigint): Promise<unknown>;
    /**
     * Returns user shares for a specific outcome.
     */
    getUserShares(marketToken: Address, user: Address, outcomeId: number): Promise<bigint>;
    /**
     * Returns whether a user has bet on a market.
     */
    hasBetted(marketToken: Address, user: Address): Promise<boolean>;
    /**
     * Returns the bounty pool amount for a market.
     */
    getBountyPool(marketToken: Address): Promise<bigint>;
    /**
     * Returns the cost to buy an order.
     * @param fill - shares to fill in wei (18 decimals)
     */
    getBuyOrderCost(marketToken: Address, orderId: bigint, fill: bigint): Promise<unknown>;
    /**
     * Returns the amounts out when buying an order with a specific USDB amount.
     * @param usdbAmount - USDB amount in wei (18 decimals)
     */
    getBuyOrderAmountsOut(marketToken: Address, orderId: bigint, usdbAmount: bigint): Promise<unknown>;
    /**
     * Returns an order by market and order ID.
     */
    getMarketOrders(marketToken: Address, orderId: bigint): Promise<unknown>;
    /**
     * Returns the next order ID for a market.
     */
    getNextOrderId(marketToken: Address): Promise<bigint>;
    /**
     * Returns whether an address is a voter for a market.
     */
    isMarketVoter(marketToken: Address, voter: Address): Promise<boolean>;
    /**
     * Returns the outcome a voter chose for a market.
     */
    getVoterChoice(marketToken: Address, voter: Address): Promise<number>;
    /**
     * Returns the first vote time for a market.
     */
    getFirstVoteTime(marketToken: Address): Promise<bigint>;
    /**
     * Returns whether a user can buy in a private event market.
     */
    canUserBuy(marketToken: Address, user: Address): Promise<boolean>;
    /**
     * Returns the bounty per correct vote for a market.
     */
    getBountyPerVote(marketToken: Address): Promise<bigint>;
    /**
     * Returns whether a voter has claimed the bounty for a market.
     */
    hasClaimed(marketToken: Address, voter: Address): Promise<boolean>;
    /**
     * Returns the initial reserves required for a given number of outcomes.
     */
    getInitialReserves(numOutcomes: bigint): Promise<readonly [bigint, bigint]>;
}
