import { BasisClient } from '../BasisClient';
import AMarketReaderArtifact from '../abis/AMarketReader.json';
import { Address } from 'viem';

export class MarketReaderModule {
  private client: BasisClient;
  private readerAddress: Address;

  constructor(client: BasisClient, readerAddress: Address) {
    this.client = client;
    this.readerAddress = readerAddress;
  }

  /**
   * Returns outcome info for all outcomes in a market.
   */
  async getAllOutcomes(routerAddress: Address, marketToken: Address) {
    return this.client.publicClient.readContract({
      address: this.readerAddress,
      abi: AMarketReaderArtifact.abi,
      functionName: 'getAllOutcomes',
      args: [routerAddress, marketToken],
    });
  }

  /**
   * Estimates the number of shares received for a given USDB input,
   * considering both order book fills and AMM.
   */
  async estimateSharesOut(
    routerAddress: Address,
    marketToken: Address,
    outcomeId: number,
    usdbAmount: bigint,
    orderIds: bigint[],
    user: Address
  ): Promise<bigint> {
    return this.client.publicClient.readContract({
      address: this.readerAddress,
      abi: AMarketReaderArtifact.abi,
      functionName: 'estimateSharesOut',
      args: [routerAddress, marketToken, outcomeId, usdbAmount, orderIds, user],
    }) as Promise<bigint>;
  }

  /**
   * Returns potential payout for holding or selling shares.
   */
  async getPotentialPayout(
    routerAddress: Address,
    marketToken: Address,
    outcomeId: number,
    sharesAmount: bigint,
    estimatedUsdbToPool: bigint
  ) {
    const result = await this.client.publicClient.readContract({
      address: this.readerAddress,
      abi: AMarketReaderArtifact.abi,
      functionName: 'getPotentialPayout',
      args: [routerAddress, marketToken, outcomeId, sharesAmount, estimatedUsdbToPool],
    }) as [bigint, bigint];

    return {
      holdPayout: result[0],
      simulatedAmmPayout: result[1],
    };
  }
}
