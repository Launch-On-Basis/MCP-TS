import { BasisClient } from '../BasisClient';
import { Address } from 'viem';
export declare class StakingModule {
    private client;
    private stakingAddress;
    constructor(client: BasisClient, stakingAddress: Address);
    private _syncTx;
    private approveIfNeeded;
    /**
     * Wraps STASIS (MAINTOKEN) into wSTASIS.
     * Approves the staking contract to spend MAINTOKEN if needed.
     * @param amount - STASIS amount in wei (18 decimals)
     */
    buy(amount: bigint): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Unwraps wSTASIS back to STASIS, optionally converting to USDB.
     * @param shares - wSTASIS shares in wei (18 decimals)
     * @param claimUSDB - whether to convert to USDB
     * @param minUSDB - minimum USDB output in wei (18 decimals)
     */
    sell(shares: bigint, claimUSDB?: boolean, minUSDB?: bigint): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Locks wSTASIS as collateral for borrowing.
     * @param shares - wSTASIS shares in wei (18 decimals)
     */
    lock(shares: bigint): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Unlocks wSTASIS collateral.
     * @param shares - wSTASIS shares in wei (18 decimals)
     */
    unlock(shares: bigint): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Pledges STASIS as collateral and borrows USDB against it.
     * The stasisAmountToBorrow parameter is the STASIS amount to pledge — USDB received is collateral value minus fees.
     * @param stasisAmountToBorrow - STASIS collateral amount in wei (18 decimals)
     * @param days - integer, minimum 10
     */
    borrow(stasisAmountToBorrow: bigint, days: bigint): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Repays the active staking loan. Auto-approves USDB to the staking contract.
     */
    repay(): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Extends the active staking loan.
     * @param daysToAdd - integer, minimum 10
     * @param payInUSDB - whether to pay extension fee in USDB
     * @param refinance - whether to refinance the loan
     */
    extendLoan(daysToAdd: bigint, payInUSDB: boolean, refinance: boolean): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Gets staking details for a user.
     * Returns [liquidShares, lockedShares, totalShares, totalAssetValue].
     */
    getUserStakeDetails(user: Address): Promise<unknown>;
    /**
     * Gets the available STASIS (collateral value minus pledged).
     */
    getAvailableStasis(user: Address): Promise<bigint>;
    /**
     * Converts STASIS amount to wSTASIS shares.
     * @param assets - STASIS amount in wei (18 decimals)
     */
    convertToShares(assets: bigint): Promise<bigint>;
    /**
     * Converts wSTASIS shares to STASIS amount.
     * @param shares - wSTASIS shares in wei (18 decimals)
     */
    convertToAssets(shares: bigint): Promise<bigint>;
    /**
     * Returns total STASIS held by the vault (available + pledged).
     */
    totalAssets(): Promise<bigint>;
    /**
     * Borrows additional STASIS against locked wSTASIS collateral on an existing loan.
     * @param additionalStasisToBorrow - STASIS collateral amount in wei (18 decimals)
     */
    addToLoan(additionalStasisToBorrow: bigint): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Settles a liquidated staking loan position.
     */
    settleLiquidation(): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
}
