import { BasisClient } from '../BasisClient';
import { Address } from 'viem';
export declare class OrderBookModule {
    private client;
    private marketTradingAddress;
    constructor(client: BasisClient, marketTradingAddress: Address);
    private approveUsdbIfNeeded;
    /**
     * Creates a limit order.
     * @param amount - shares in wei (18 decimals)
     * @param pricePerShare - USDB per share in wei (18 decimals)
     */
    listOrder(marketToken: Address, outcomeId: number, amount: bigint, pricePerShare: bigint): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Cancels an active order.
     */
    cancelOrder(marketToken: Address, orderId: bigint): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Executes against a specific order.
     * @param fill - shares to fill in wei (18 decimals)
     */
    buyOrder(marketToken: Address, orderId: bigint, fill: bigint): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Sweeps multiple orders.
     * @param usdbAmount - USDB amount in wei (18 decimals)
     */
    buyMultipleOrders(marketToken: Address, orderIds: bigint[], usdbAmount: bigint): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Syncs an order transaction to the backend database.
     * Called automatically after listOrder, cancelOrder, buyOrder, buyMultipleOrders.
     */
    private syncOrder;
    /**
     * Retrieves exact cost including taxes before buying.
     * @param fill - shares to fill in wei (18 decimals)
     */
    getBuyOrderCost(marketToken: Address, orderId: bigint, fill: bigint): Promise<unknown>;
    /**
     * Preview how many shares can be bought for a given USDB amount on a P2P order.
     * @param usdbAmount - USDB amount in wei (18 decimals)
     */
    getBuyOrderAmountsOut(marketToken: Address, orderId: bigint, usdbAmount: bigint): Promise<unknown>;
}
