import { BasisClient } from '../BasisClient';
import { Address } from 'viem';
export declare class TradingModule {
    private client;
    private swapAddress;
    constructor(client: BasisClient, swapAddress: Address);
    private _syncTx;
    /**
     * Automatically approves the token to be spent by the SWAP contract.
     * Internal helper function.
     */
    private approveIfNeeded;
    /**
     * Buys tokens during the bonding curve phase.
     * Calls buyTokens on SWAP.sol.
     * @param amount — input token amount in wei (18 decimals)
     * @param minOut — minimum output amount in wei (18 decimals)
     * @param path — ordered list of token addresses for the swap route
     * @param wrapTokens — whether to wrap output tokens
     */
    buyBondingTokens(amount: bigint, minOut: bigint, path: Address[], wrapTokens: boolean): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Sells tokens during the bonding curve phase.
     * Calls sellTokens on SWAP.sol.
     * @param amount — token amount to sell in wei (18 decimals)
     * @param minOut — minimum output amount in wei (18 decimals)
     * @param path — ordered list of token addresses for the swap route
     * @param swapToETH — whether to unwrap output to native ETH
     */
    sellBondingTokens(amount: bigint, minOut: bigint, path: Address[], swapToETH: boolean): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * General buy tokens function.
     * @param amount — input token amount in wei (18 decimals)
     * @param minOut — minimum output amount in wei (18 decimals)
     * @param path — ordered list of token addresses for the swap route
     * @param wrapTokens — whether to wrap output tokens
     */
    buyTokens(amount: bigint, minOut: bigint, path: Address[], wrapTokens: boolean): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * General sell tokens function.
     * @param amount — token amount to sell in wei (18 decimals)
     * @param minOut — minimum output amount in wei (18 decimals)
     * @param path — ordered list of token addresses for the swap route
     * @param swapToETH — whether to unwrap output to native ETH
     */
    sellTokens(amount: bigint, minOut: bigint, path: Address[], swapToETH: boolean): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Simplified buy: purchases the target token using USDB.
     * Automatically builds the correct swap path.
     * @param tokenAddress — address of the token to buy
     * @param usdbAmount — USDB amount in wei (18 decimals)
     * @param minOut — minimum output amount in wei (18 decimals)
     * @param wrapTokens — whether to wrap output tokens
     */
    buy(tokenAddress: Address, usdbAmount: bigint, minOut?: bigint, wrapTokens?: boolean): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Simplified sell: sells a token.
     * For factory tokens, set toUsdb=true to swap all the way to USDB (3-hop),
     * or false to stop at MAINTOKEN (2-hop). Ignored when selling MAINTOKEN.
     * @param tokenAddress — address of the token to sell
     * @param amount — token amount to sell in wei (18 decimals)
     * @param toUsdb — whether to swap all the way to USDB
     * @param minOut — minimum output amount in wei (18 decimals)
     * @param swapToETH — whether to unwrap output to native ETH
     */
    sell(tokenAddress: Address, amount: bigint, toUsdb?: boolean, minOut?: bigint, swapToETH?: boolean): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    private buildBuyPath;
    private buildSellPath;
    /**
     * Leveraged buy: purchases tokens with leverage (creates a loan position).
     * @param amount — USDB collateral amount in wei (18 decimals)
     * @param minOut — minimum output amount in wei (18 decimals)
     * @param path — ordered list of token addresses for the swap route
     * @param numberOfDays — loan duration in days, integer, minimum 10
     */
    leverageBuy(amount: bigint, minOut: bigint, path: Address[], numberOfDays: bigint): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Partially sells collateral from a loan/leverage position.
     * percentage must be divisible by 10 (10-100).
     * @param loanId — ID of the loan/leverage position
     * @param percentage — integer 10-100, divisible by 10
     * @param isLeverage — true if leverage position, false if loan
     * @param minOut — minimum output amount in wei (18 decimals)
     */
    partialLoanSell(loanId: bigint, percentage: bigint, isLeverage: boolean, minOut: bigint): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Sells a percentage of the user's token balance.
     * @param tokenAddress — address of the token to sell
     * @param percentage — integer 1-100
     * @param toUsdb — whether to swap all the way to USDB
     * @param minOut — minimum output amount in wei (18 decimals)
     * @param swapToETH — whether to unwrap output to native ETH
     */
    sellPercentage(tokenAddress: Address, percentage: number, toUsdb?: boolean, minOut?: bigint, swapToETH?: boolean): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Gets the leverage position count for a user from MAINTOKEN.
     */
    getLeverageCount(user: Address): Promise<bigint>;
    /**
     * Gets a specific leverage position from MAINTOKEN.
     */
    getLeveragePosition(user: Address, loanId: bigint): Promise<readonly [user: `0x${string}`, token: `0x${string}`, collateralAmount: bigint, bigint, bigint, bigint, bigint, bigint, boolean, active: boolean, bigint, bigint, leverage: {
        leverageBuyAmount: bigint;
        cashedOut: bigint;
    }]>;
    /**
     * Fetches the token price from the token's contract.
     */
    getTokenPrice(tokenAddress: Address): Promise<string>;
    /**
     * Fetches the USD price of the token from the token's contract.
     */
    getUSDPrice(tokenAddress: Address): Promise<string>;
    /**
     * Returns the expected output amounts for a given input amount and swap path.
     * @param amount — input token amount in wei (18 decimals)
     * @param path — ordered list of token addresses for the swap route
     */
    getAmountsOut(amount: bigint, path: Address[]): Promise<bigint>;
}
