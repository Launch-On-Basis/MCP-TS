import { BasisClient } from '../BasisClient';
import { Address } from 'viem';
export declare class LoansModule {
    private client;
    private loanHubAddress;
    constructor(client: BasisClient, loanHubAddress: Address);
    private _syncTx;
    private approveIfNeeded;
    /**
     * Takes a loan. Auto-approves the collateral token to the LoanHub.
     * @param ecosystem - ecosystem contract address
     * @param collateral - collateral token address
     * @param amount - collateral amount in wei (18 decimals)
     * @param daysCount - integer, minimum 10
     */
    takeLoan(ecosystem: Address, collateral: Address, amount: bigint, daysCount: bigint): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Repays a loan to release collateral.
     * Auto-approves the borrowed token (USDB) to the LoanHub.
     */
    repayLoan(hubId: bigint): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Prolongs duration of a loan.
     * When payInStable is true, auto-approves USDB to the LoanHub.
     * @param hubId - loan hub identifier
     * @param addDays - integer, minimum 10
     * @param payInStable - whether to pay extension fee in USDB
     * @param refinance - whether to refinance the loan
     */
    extendLoan(hubId: bigint, addDays: bigint, payInStable: boolean, refinance: boolean): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Executes liquidation on a defaulted loan.
     */
    claimLiquidation(hubId: bigint): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Returns FullLoanDetails struct.
     */
    getUserLoanDetails(user: Address, hubId: bigint): Promise<unknown>;
    /**
     * Increases collateral on an existing loan.
     * Reads loan details to find the collateral token, then auto-approves it.
     * @param hubId - loan hub identifier
     * @param amountToAdd - additional collateral in wei (18 decimals)
     */
    increaseLoan(hubId: bigint, amountToAdd: bigint): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Returns the number of loans a user has.
     */
    /**
     * Partially sell collateral from a hub loan position.
     * @param hubId - loan hub identifier
     * @param percentage - integer 10-100, divisible by 10
     * @param isLeverage - whether this is a leverage position
     * @param minOut - minimum output in wei (18 decimals)
     */
    hubPartialLoanSell(hubId: bigint, percentage: bigint, isLeverage: boolean, minOut: bigint): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    getUserLoanCount(user: Address): Promise<bigint>;
}
