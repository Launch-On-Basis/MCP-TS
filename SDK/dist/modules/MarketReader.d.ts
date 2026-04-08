import { BasisClient } from '../BasisClient';
import { Address } from 'viem';
export declare class MarketReaderModule {
    private client;
    private readerAddress;
    constructor(client: BasisClient, readerAddress: Address);
    /**
     * Returns outcome info for all outcomes in a market.
     */
    getAllOutcomes(routerAddress: Address, marketToken: Address): Promise<unknown>;
    /**
     * Estimates the number of shares received for a given USDB input,
     * considering both order book fills and AMM.
     * @param usdbAmount - USDB amount in wei (18 decimals)
     */
    estimateSharesOut(routerAddress: Address, marketToken: Address, outcomeId: number, usdbAmount: bigint, orderIds: bigint[], user: Address): Promise<bigint>;
    /**
     * Returns potential payout for holding or selling shares.
     * @param sharesAmount - shares in wei (18 decimals)
     * @param estimatedUsdbToPool - USDB amount in wei (18 decimals)
     */
    getPotentialPayout(routerAddress: Address, marketToken: Address, outcomeId: number, sharesAmount: bigint, estimatedUsdbToPool: bigint): Promise<{
        holdPayout: bigint;
        simulatedAmmPayout: bigint;
    }>;
}
