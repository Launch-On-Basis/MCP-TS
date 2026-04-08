import { BasisClient } from '../BasisClient';
import { Address } from 'viem';
export declare class VestingModule {
    private client;
    private vestingAddress;
    constructor(client: BasisClient, vestingAddress: Address);
    private _syncTx;
    private approveIfNeeded;
    private getFeeAmount;
    /**
     * Creates a gradual vesting schedule.
     * Auto-approves the token to the vesting contract and attaches the creation fee.
     *
     * @param totalAmount - token amount in wei (18 decimals)
     * @param startTime - Unix timestamp in seconds
     * @param durationInDays - integer, number of days
     * @param timeUnit - enum: 0=Second, 1=Minute, 2=Hour, 3=Day
     */
    createGradualVesting(beneficiary: Address, token: Address, totalAmount: bigint, startTime: bigint, durationInDays: bigint, timeUnit: number, memo: string, ecosystem: Address): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Creates a cliff vesting schedule.
     *
     * @param totalAmount - token amount in wei (18 decimals)
     * @param unlockTime - Unix timestamp in seconds
     */
    createCliffVesting(beneficiary: Address, token: Address, totalAmount: bigint, unlockTime: bigint, memo: string, ecosystem: Address): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Claims unlocked tokens.
     */
    claimTokens(vestingId: bigint): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Leverages locked tokens for a loan.
     */
    takeLoanOnVesting(vestingId: bigint): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Repays a loan taken on a vesting schedule.
     * Auto-approves the borrowed token (USDB) to the vesting contract.
     */
    repayLoanOnVesting(vestingId: bigint): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Gets details of a specific vesting schedule.
     */
    getVestingDetails(vestingId: bigint): Promise<unknown>;
    /**
     * Gets the current claimable amount for a vesting schedule.
     */
    getClaimableAmount(vestingId: bigint): Promise<unknown>;
    /**
     * Creates gradual vesting schedules for multiple beneficiaries in a single transaction.
     * Auto-approves the sum of all amounts and attaches the creation fee.
     *
     * @param totalAmounts - token amounts in wei (18 decimals)
     * @param startTime - Unix timestamp in seconds
     * @param durationInDays - integer, number of days
     * @param timeUnit - enum: 0=Second, 1=Minute, 2=Hour, 3=Day
     */
    batchCreateGradualVesting(beneficiaries: Address[], token: Address, totalAmounts: bigint[], userMemos: string[], startTime: bigint, durationInDays: bigint, timeUnit: number, ecosystem: Address): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Creates cliff vesting schedules for multiple beneficiaries in a single transaction.
     * Auto-approves the sum of all amounts and attaches the creation fee.
     *
     * @param totalAmounts - token amounts in wei (18 decimals)
     * @param unlockTime - Unix timestamp in seconds
     */
    batchCreateCliffVesting(beneficiaries: Address[], token: Address, totalAmounts: bigint[], unlockTime: bigint, userMemos: string[], ecosystem: Address): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Changes the beneficiary of a vesting schedule.
     */
    changeBeneficiary(vestingId: bigint, newBeneficiary: Address): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Extends the vesting period by additional days.
     *
     * @param additionalDays - integer, number of days
     */
    extendVestingPeriod(vestingId: bigint, additionalDays: bigint): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Adds more tokens to an existing vesting schedule.
     * Auto-approves the token to the vesting contract.
     *
     * @param additionalAmount - token amount in wei (18 decimals)
     */
    addTokensToVesting(vestingId: bigint, additionalAmount: bigint): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Transfers the creator role of a vesting schedule to a new address.
     */
    transferCreatorRole(vestingId: bigint, newCreator: Address): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Returns all vesting IDs for a given beneficiary.
     */
    getVestingsByBeneficiary(beneficiary: Address): Promise<bigint[]>;
    /**
     * Returns the total vested amount for a vesting schedule.
     */
    getVestedAmount(vestingId: bigint): Promise<bigint>;
    /**
     * Returns the active loan ID for a vesting schedule.
     */
    getActiveLoan(vestingId: bigint): Promise<bigint>;
    /**
     * Returns vesting IDs for a given token within a specified index range.
     *
     * @param startIndex - array index
     * @param endIndex - array index
     */
    getTokenVestingIds(token: Address, startIndex: bigint, endIndex: bigint): Promise<bigint[]>;
    /**
     * Returns vesting details for multiple vesting IDs in a single call.
     */
    getVestingDetailsBatch(vestingIds: bigint[]): Promise<unknown>;
    /**
     * Returns the total number of vesting schedules created.
     */
    getVestingCount(): Promise<bigint>;
    /**
     * Returns all vesting IDs created by a given creator.
     */
    getVestingsByCreator(creator: Address): Promise<bigint[]>;
}
