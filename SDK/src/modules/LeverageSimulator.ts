import { BasisClient } from '../BasisClient';
import ALeverageArtifact from '../abis/ALEVERAGE.json';
import { Address } from 'viem';

export class LeverageSimulatorModule {
  private client: BasisClient;
  private leverageAddress: Address;

  constructor(client: BasisClient, leverageAddress: Address) {
    this.client = client;
    this.leverageAddress = leverageAddress;
  }

  /**
   * Simulates a leveraged buy and returns the EndResult struct.
   */
  async simulateLeverage(amount: bigint, path: Address[], numberOfDays: bigint) {
    return this.client.publicClient.readContract({
      address: this.leverageAddress,
      abi: ALeverageArtifact.abi,
      functionName: 'simulateLeverage',
      args: [amount, path, numberOfDays],
    });
  }

  /**
   * Simulates a leveraged buy via factory and returns the EndResult struct.
   */
  async simulateLeverageFactory(amount: bigint, path: Address[], numberOfDays: bigint) {
    return this.client.publicClient.readContract({
      address: this.leverageAddress,
      abi: ALeverageArtifact.abi,
      functionName: 'simulateLeverageFactory',
      args: [amount, path, numberOfDays],
    });
  }

  /**
   * Calculates the floor price for a hybrid token.
   */
  async calculateFloor(
    hybridMultiplier: bigint,
    reserve0: bigint,
    reserve1: bigint,
    baseReserve0: bigint,
    xereserve0: bigint,
    xereserve1: bigint
  ): Promise<bigint> {
    return this.client.publicClient.readContract({
      address: this.leverageAddress,
      abi: ALeverageArtifact.abi,
      functionName: 'calculateFloor',
      args: [hybridMultiplier, reserve0, reserve1, baseReserve0, xereserve0, xereserve1],
    }) as Promise<bigint>;
  }

  /**
   * Returns the token price given reserves.
   */
  async getTokenPrice(reserve0: bigint, reserve1: bigint): Promise<bigint> {
    return this.client.publicClient.readContract({
      address: this.leverageAddress,
      abi: ALeverageArtifact.abi,
      functionName: 'getTokenPrice',
      args: [reserve0, reserve1],
    }) as Promise<bigint>;
  }

  /**
   * Returns the USD price of a token given reserves.
   */
  async getUSDPrice(reserve0: bigint, reserve1: bigint, xereserve0: bigint, xereserve1: bigint): Promise<bigint> {
    return this.client.publicClient.readContract({
      address: this.leverageAddress,
      abi: ALeverageArtifact.abi,
      functionName: 'getUSDPrice',
      args: [reserve0, reserve1, xereserve0, xereserve1],
    }) as Promise<bigint>;
  }

  /**
   * Returns the collateral value in USDB for a given token amount.
   */
  async getCollateralValue(tokenAmount: bigint, reserve0: bigint, reserve1: bigint): Promise<bigint> {
    return this.client.publicClient.readContract({
      address: this.leverageAddress,
      abi: ALeverageArtifact.abi,
      functionName: 'getColleteralValue',
      args: [tokenAmount, reserve0, reserve1],
    }) as Promise<bigint>;
  }

  /**
   * Returns the collateral value for a hybrid token.
   */
  async getCollateralValueHybrid(
    tokenAmount: bigint,
    reserve0: bigint,
    reserve1: bigint,
    xereserve0: bigint,
    xereserve1: bigint,
    multiplier: bigint,
    basereserve0: bigint
  ): Promise<bigint> {
    return this.client.publicClient.readContract({
      address: this.leverageAddress,
      abi: ALeverageArtifact.abi,
      functionName: 'getColleteralValueHybrid',
      args: [tokenAmount, reserve0, reserve1, xereserve0, xereserve1, multiplier, basereserve0],
    }) as Promise<bigint>;
  }

  /**
   * Calculates how many tokens can be purchased for a given USDB amount.
   */
  async calculateTokensForBuy(usdbAmount: bigint, reserve0: bigint, reserve1: bigint): Promise<bigint> {
    return this.client.publicClient.readContract({
      address: this.leverageAddress,
      abi: ALeverageArtifact.abi,
      functionName: 'calculateTokensForBuy',
      args: [usdbAmount, reserve0, reserve1],
    }) as Promise<bigint>;
  }

  /**
   * Calculates the number of tokens to burn for a given input.
   */
  async calculateTokensToBurn(
    amountIn: bigint,
    multiplier: bigint,
    inputreserve0: bigint,
    inputreserve1: bigint,
    splitter: bigint
  ): Promise<bigint> {
    return this.client.publicClient.readContract({
      address: this.leverageAddress,
      abi: ALeverageArtifact.abi,
      functionName: 'calculateTokensToBurn',
      args: [amountIn, multiplier, inputreserve0, inputreserve1, splitter],
    }) as Promise<bigint>;
  }
}
