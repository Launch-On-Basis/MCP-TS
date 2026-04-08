import { BasisClient } from '../BasisClient';
import { Address } from 'viem';
export declare class LeverageSimulatorModule {
    private client;
    private leverageAddress;
    constructor(client: BasisClient, leverageAddress: Address);
    /**
     * Simulates a leveraged buy and returns the EndResult struct.
     * @param amount - wei (18 decimals)
     * @param path - swap path token addresses
     * @param numberOfDays - integer, number of days
     */
    simulateLeverage(amount: bigint, path: Address[], numberOfDays: bigint): Promise<unknown>;
    /**
     * Simulates a leveraged buy via factory and returns the EndResult struct.
     * @param amount - wei (18 decimals)
     * @param path - swap path token addresses
     * @param numberOfDays - integer, number of days
     */
    simulateLeverageFactory(amount: bigint, path: Address[], numberOfDays: bigint): Promise<unknown>;
    /**
     * Calculates the floor price for a hybrid token.
     * @param hybridMultiplier - raw integer (not wei)
     * @param reserve0 - reserve amount in wei (18 decimals)
     * @param reserve1 - reserve amount in wei (18 decimals)
     * @param baseReserve0 - reserve amount in wei (18 decimals)
     * @param xereserve0 - reserve amount in wei (18 decimals)
     * @param xereserve1 - reserve amount in wei (18 decimals)
     */
    calculateFloor(hybridMultiplier: bigint, reserve0: bigint, reserve1: bigint, baseReserve0: bigint, xereserve0: bigint, xereserve1: bigint): Promise<bigint>;
    /**
     * Returns the token price given reserves.
     * @param reserve0 - reserve amount in wei (18 decimals)
     * @param reserve1 - reserve amount in wei (18 decimals)
     */
    getTokenPrice(reserve0: bigint, reserve1: bigint): Promise<bigint>;
    /**
     * Returns the USD price of a token given reserves.
     * @param reserve0 - reserve amount in wei (18 decimals)
     * @param reserve1 - reserve amount in wei (18 decimals)
     * @param xereserve0 - reserve amount in wei (18 decimals)
     * @param xereserve1 - reserve amount in wei (18 decimals)
     */
    getUSDPrice(reserve0: bigint, reserve1: bigint, xereserve0: bigint, xereserve1: bigint): Promise<bigint>;
    /**
     * Returns the collateral value in USDB for a given token amount.
     * @param tokenAmount - amount in wei (18 decimals)
     * @param reserve0 - reserve amount in wei (18 decimals)
     * @param reserve1 - reserve amount in wei (18 decimals)
     */
    getCollateralValue(tokenAmount: bigint, reserve0: bigint, reserve1: bigint): Promise<bigint>;
    /**
     * Returns the collateral value for a hybrid token.
     * @param tokenAmount - amount in wei (18 decimals)
     * @param reserve0 - reserve amount in wei (18 decimals)
     * @param reserve1 - reserve amount in wei (18 decimals)
     * @param xereserve0 - reserve amount in wei (18 decimals)
     * @param xereserve1 - reserve amount in wei (18 decimals)
     * @param multiplier - raw integer (not wei)
     * @param basereserve0 - reserve amount in wei (18 decimals)
     */
    getCollateralValueHybrid(tokenAmount: bigint, reserve0: bigint, reserve1: bigint, xereserve0: bigint, xereserve1: bigint, multiplier: bigint, basereserve0: bigint): Promise<bigint>;
    /**
     * Calculates how many tokens can be purchased for a given USDB amount.
     * @param usdbAmount - amount in wei (18 decimals)
     * @param reserve0 - reserve amount in wei (18 decimals)
     * @param reserve1 - reserve amount in wei (18 decimals)
     */
    calculateTokensForBuy(usdbAmount: bigint, reserve0: bigint, reserve1: bigint): Promise<bigint>;
    /**
     * Calculates the number of tokens to burn for a given input.
     * @param amountIn - amount in wei (18 decimals)
     * @param multiplier - raw integer (not wei)
     * @param inputreserve0 - reserve amount in wei (18 decimals)
     * @param inputreserve1 - reserve amount in wei (18 decimals)
     * @param splitter - raw integer
     */
    calculateTokensToBurn(amountIn: bigint, multiplier: bigint, inputreserve0: bigint, inputreserve1: bigint, splitter: bigint): Promise<bigint>;
}
