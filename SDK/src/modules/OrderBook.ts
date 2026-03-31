import { BasisClient } from '../BasisClient';
import AMarketTradingArtifact from '../abis/AMarketTrading.json';
import IERC20Artifact from '../abis/IERC20.json';
import { Address } from 'viem';

export class OrderBookModule {
  private client: BasisClient;
  private marketTradingAddress: Address;

  constructor(client: BasisClient, marketTradingAddress: Address) {
    this.client = client;
    this.marketTradingAddress = marketTradingAddress;
  }

  private async approveUsdbIfNeeded(amount: bigint) {
    if (!this.client.walletClient || !this.client.walletClient.account) return;
    const account = this.client.walletClient.account;
    const allowance = await this.client.publicClient.readContract({
      address: this.client.usdbAddress,
      abi: IERC20Artifact.abi,
      functionName: 'allowance',
      args: [account.address, this.marketTradingAddress],
    }) as bigint;
    if (allowance < amount) {
      const { request } = await this.client.publicClient.simulateContract({
        account,
        address: this.client.usdbAddress,
        abi: IERC20Artifact.abi,
        functionName: 'approve',
        args: [this.marketTradingAddress, amount],
      });
      const hash = await this.client.walletClient.writeContract(request);
      await this.client.publicClient.waitForTransactionReceipt({ hash });
    }
  }

  /**
   * Creates a limit order.
   */
  async listOrder(marketToken: Address, outcomeId: number, amount: bigint, pricePerShare: bigint) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.marketTradingAddress,
      abi: AMarketTradingArtifact.abi,
      functionName: 'listOrder',
      args: [marketToken, outcomeId, amount, pricePerShare],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    // Sync order to backend database
    await this.syncOrder(hash);

    return { hash, receipt };
  }

  /**
   * Cancels an active order.
   */
  async cancelOrder(marketToken: Address, orderId: bigint) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.marketTradingAddress,
      abi: AMarketTradingArtifact.abi,
      functionName: 'cancelOrder',
      args: [marketToken, orderId],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    await this.syncOrder(hash);

    return { hash, receipt };
  }

  /**
   * Executes against a specific order.
   */
  async buyOrder(marketToken: Address, orderId: bigint, fill: bigint) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    // Auto-approve USDB for the order cost
    const costResult = await this.getBuyOrderCost(marketToken, orderId, fill) as any;
    const totalCost = costResult.totalCostToBuyer ?? costResult[2];
    await this.approveUsdbIfNeeded(totalCost as bigint);

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.marketTradingAddress,
      abi: AMarketTradingArtifact.abi,
      functionName: 'buyOrder',
      args: [marketToken, orderId, fill],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    await this.syncOrder(hash);

    return { hash, receipt };
  }

  /**
   * Sweeps multiple orders.
   */
  async buyMultipleOrders(marketToken: Address, orderIds: bigint[], usdbAmount: bigint) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    // Auto-approve USDB for the total input amount
    await this.approveUsdbIfNeeded(usdbAmount);

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.marketTradingAddress,
      abi: AMarketTradingArtifact.abi,
      functionName: 'buyMultipleOrders',
      args: [marketToken, orderIds, usdbAmount],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    await this.syncOrder(hash);

    return { hash, receipt };
  }

  /**
   * Syncs an order transaction to the backend database.
   * Called automatically after listOrder, cancelOrder, buyOrder, buyMultipleOrders.
   */
  private async syncOrder(txHash: string, marketType: string = 'public'): Promise<void> {
    try {
      await this.client.api.syncOrder(txHash, marketType);
    } catch (err) {
      // Non-fatal — log but don't fail the transaction
      console.warn('Order sync warning:', err instanceof Error ? err.message : err);
    }
  }

  /**
   * Retrieves exact cost including taxes before buying.
   */
  async getBuyOrderCost(marketToken: Address, orderId: bigint, fill: bigint) {
    return this.client.publicClient.readContract({
      address: this.marketTradingAddress,
      abi: AMarketTradingArtifact.abi,
      functionName: 'getBuyOrderCost',
      args: [marketToken, orderId, fill],
    });
  }

  /**
   * Preview how many shares can be bought for a given USDB amount on a P2P order.
   */
  async getBuyOrderAmountsOut(marketToken: Address, orderId: bigint, usdbAmount: bigint) {
    return this.client.publicClient.readContract({
      address: this.marketTradingAddress,
      abi: AMarketTradingArtifact.abi,
      functionName: 'getBuyOrderAmountsOut',
      args: [marketToken, orderId, usdbAmount],
    });
  }
}
