import { BasisClient } from '../BasisClient';
import APrivateTradingMarketArtifact from '../abis/APrivateTradingMarket.json';
import ATokenFactoryArtifact from '../abis/ATokenFactory.json';
import IERC20Artifact from '../abis/IERC20.json';
import { Address } from 'viem';

export class PrivateMarketsModule {
  private client: BasisClient;
  private privateMarketAddress: Address;

  constructor(client: BasisClient, privateMarketAddress: Address) {
    this.client = client;
    this.privateMarketAddress = privateMarketAddress;
  }

  private async approveIfNeeded(tokenAddress: Address, spender: Address, amount: bigint) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Wallet account is required for approval.");
    }
    const account = this.client.walletClient.account;
    const allowance = await this.client.publicClient.readContract({
      address: tokenAddress,
      abi: IERC20Artifact.abi,
      functionName: 'allowance',
      args: [account.address, spender],
    }) as bigint;

    if (allowance < amount) {
      const { request } = await this.client.publicClient.simulateContract({
        account,
        address: tokenAddress,
        abi: IERC20Artifact.abi,
        functionName: 'approve',
        args: [spender, amount],
      });
      const hash = await this.client.walletClient.writeContract(request);
      await this.client.publicClient.waitForTransactionReceipt({ hash });
    }
  }

  private async _syncTx(txHash: string) {
    try {
      await this.client.api.syncTransaction(txHash);
    } catch (e: any) {
      console.warn('Sync warning:', e.message || e);
    }
  }

  private async syncOrder(txHash: string): Promise<void> {
    try {
      await this.client.api.syncOrder(txHash, 'private');
    } catch (err) {
      console.warn('Order sync warning:', err instanceof Error ? err.message : err);
    }
  }

  // -----------------------------------------------------------------------
  // Write methods
  // -----------------------------------------------------------------------

  /**
   * Creates a new private prediction market.
   * Fetches the ecosystem factory fee and attaches it.
   */
  async createMarket(
    marketName: string,
    symbol: string,
    endTime: bigint,
    optionNames: string[],
    maintoken: Address,
    privateEvent: boolean,
    frozen: boolean,
    bonding: bigint,
    seedAmount: bigint = 0n
  ) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    // Get the ecosystem's factory address, then fetch the fee
    const ecoData = await this.client.publicClient.readContract({
      address: this.privateMarketAddress,
      abi: APrivateTradingMarketArtifact.abi,
      functionName: 'ecosystems',
      args: [maintoken],
    }) as any;
    const factoryAddress = ecoData.factory ?? ecoData[0];
    const feeAmount = await this.client.publicClient.readContract({
      address: factoryAddress,
      abi: ATokenFactoryArtifact.abi,
      functionName: 'feeAmount',
    }) as bigint;

    // Auto-approve USDB for seed amount if needed
    if (seedAmount > 0n) {
      await this.approveIfNeeded(this.client.usdbAddress, this.privateMarketAddress, seedAmount);
    }

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.privateMarketAddress,
      abi: APrivateTradingMarketArtifact.abi,
      functionName: 'createMarket',
      args: [marketName, symbol, endTime, optionNames, maintoken, privateEvent, frozen, bonding, seedAmount],
      value: feeAmount,
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    await this._syncTx(hash);

    return { hash, receipt };
  }

  /**
   * Executes an AMM buy for a private market outcome.
   * Auto-approves the input token.
   */
  async buy(
    marketToken: Address,
    outcomeId: number,
    inputToken: Address,
    inputAmount: bigint,
    minUsdb: bigint,
    minShares: bigint
  ) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    await this.approveIfNeeded(inputToken, this.privateMarketAddress, inputAmount);

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.privateMarketAddress,
      abi: APrivateTradingMarketArtifact.abi,
      functionName: 'buy',
      args: [marketToken, outcomeId, inputToken, inputAmount, minUsdb, minShares],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    await this._syncTx(hash);

    return { hash, receipt };
  }

  /**
   * Redeems winnings after a market resolves.
   */
  async redeem(marketToken: Address) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.privateMarketAddress,
      abi: APrivateTradingMarketArtifact.abi,
      functionName: 'redeem',
      args: [marketToken],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    await this._syncTx(hash);

    return { hash, receipt };
  }

  /**
   * Creates a limit order on a private market.
   */
  async listOrder(marketToken: Address, outcomeId: number, amount: bigint, pricePerShare: bigint) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.privateMarketAddress,
      abi: APrivateTradingMarketArtifact.abi,
      functionName: 'listOrder',
      args: [marketToken, outcomeId, amount, pricePerShare],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    await this.syncOrder(hash);

    return { hash, receipt };
  }

  /**
   * Cancels an active order on a private market.
   */
  async cancelOrder(marketToken: Address, orderId: bigint) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.privateMarketAddress,
      abi: APrivateTradingMarketArtifact.abi,
      functionName: 'cancelOrder',
      args: [marketToken, orderId],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    await this.syncOrder(hash);

    return { hash, receipt };
  }

  /**
   * Fills a specific order on a private market.
   */
  async buyOrder(marketToken: Address, orderId: bigint, fill: bigint) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.privateMarketAddress,
      abi: APrivateTradingMarketArtifact.abi,
      functionName: 'buyOrder',
      args: [marketToken, orderId, fill],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    await this.syncOrder(hash);

    return { hash, receipt };
  }

  /**
   * Sweeps multiple orders on a private market.
   */
  async buyMultipleOrders(marketToken: Address, orderIds: bigint[], usdbAmount: bigint) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.privateMarketAddress,
      abi: APrivateTradingMarketArtifact.abi,
      functionName: 'buyMultipleOrders',
      args: [marketToken, orderIds, usdbAmount],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    await this.syncOrder(hash);

    return { hash, receipt };
  }

  /**
   * Buys from order book and AMM in a single transaction.
   * Auto-approves the input token.
   */
  async buyOrdersAndContract(
    marketToken: Address,
    outcomeId: number,
    orderIds: bigint[],
    inputToken: Address,
    totalInput: bigint,
    minShares: bigint
  ) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    await this.approveIfNeeded(inputToken, this.privateMarketAddress, totalInput);

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.privateMarketAddress,
      abi: APrivateTradingMarketArtifact.abi,
      functionName: 'buyOrdersAndContract',
      args: [marketToken, outcomeId, orderIds, inputToken, totalInput, minShares],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    await this.syncOrder(hash);

    return { hash, receipt };
  }

  /**
   * Casts a vote on a private market outcome.
   */
  async vote(marketToken: Address, outcomeId: number) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.privateMarketAddress,
      abi: APrivateTradingMarketArtifact.abi,
      functionName: 'vote',
      args: [marketToken, outcomeId],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    await this._syncTx(hash);

    return { hash, receipt };
  }

  /**
   * Finalizes a private market after voting is complete.
   */
  async finalize(marketToken: Address) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.privateMarketAddress,
      abi: APrivateTradingMarketArtifact.abi,
      functionName: 'finalize',
      args: [marketToken],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    await this._syncTx(hash);

    return { hash, receipt };
  }

  /**
   * Claims the bounty reward for voting correctly.
   */
  async claimBounty(marketToken: Address) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.privateMarketAddress,
      abi: APrivateTradingMarketArtifact.abi,
      functionName: 'claimBounty',
      args: [marketToken],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    await this._syncTx(hash);

    return { hash, receipt };
  }

  /**
   * Manages voter status for a private market.
   */
  async manageVoter(marketToken: Address, voter: Address, status: boolean) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.privateMarketAddress,
      abi: APrivateTradingMarketArtifact.abi,
      functionName: 'manageVoter',
      args: [marketToken, voter, status],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    await this._syncTx(hash);

    return { hash, receipt };
  }

  /**
   * Toggles whether specific addresses can buy in a private event market.
   */
  async togglePrivateEventBuyers(marketToken: Address, buyers: Address[], status: boolean) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.privateMarketAddress,
      abi: APrivateTradingMarketArtifact.abi,
      functionName: 'togglePrivateEventBuyers',
      args: [marketToken, buyers, status],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    await this._syncTx(hash);

    return { hash, receipt };
  }

  /**
   * Disables the freeze on a private market.
   */
  async disableFreeze(marketToken: Address) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.privateMarketAddress,
      abi: APrivateTradingMarketArtifact.abi,
      functionName: 'DisableFreeze',
      args: [marketToken],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    await this._syncTx(hash);

    return { hash, receipt };
  }

  /**
   * Manages the whitelist for a private market.
   */
  async manageWhitelist(marketToken: Address, wallets: Address[], amount: bigint, tag: string, status: boolean) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.privateMarketAddress,
      abi: APrivateTradingMarketArtifact.abi,
      functionName: 'manageWhitelist',
      args: [marketToken, wallets, amount, tag, status],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    await this._syncTx(hash);

    return { hash, receipt };
  }

  // -----------------------------------------------------------------------
  // Read methods
  // -----------------------------------------------------------------------

  /**
   * Returns the MarketData struct for a private market.
   */
  async getMarketData(marketToken: Address) {
    return this.client.publicClient.readContract({
      address: this.privateMarketAddress,
      abi: APrivateTradingMarketArtifact.abi,
      functionName: 'getMarketData',
      args: [marketToken],
    });
  }

  /**
   * Returns the number of outcomes for a market.
   */
  async getNumOutcomes(marketToken: Address): Promise<bigint> {
    return this.client.publicClient.readContract({
      address: this.privateMarketAddress,
      abi: APrivateTradingMarketArtifact.abi,
      functionName: 'getNumOutcomes',
      args: [marketToken],
    }) as Promise<bigint>;
  }

  /**
   * Returns the Outcome struct for a specific outcome.
   */
  async getOutcome(marketToken: Address, outcomeId: bigint) {
    return this.client.publicClient.readContract({
      address: this.privateMarketAddress,
      abi: APrivateTradingMarketArtifact.abi,
      functionName: 'outcomes',
      args: [marketToken, outcomeId],
    });
  }

  /**
   * Returns user shares for a specific outcome.
   */
  async getUserShares(marketToken: Address, user: Address, outcomeId: number): Promise<bigint> {
    return this.client.publicClient.readContract({
      address: this.privateMarketAddress,
      abi: APrivateTradingMarketArtifact.abi,
      functionName: 'userShares',
      args: [marketToken, user, outcomeId],
    }) as Promise<bigint>;
  }

  /**
   * Returns whether a user has bet on a market.
   */
  async hasBetted(marketToken: Address, user: Address): Promise<boolean> {
    return this.client.publicClient.readContract({
      address: this.privateMarketAddress,
      abi: APrivateTradingMarketArtifact.abi,
      functionName: 'hasBetted',
      args: [marketToken, user],
    }) as Promise<boolean>;
  }

  /**
   * Returns the bounty pool amount for a market.
   */
  async getBountyPool(marketToken: Address): Promise<bigint> {
    return this.client.publicClient.readContract({
      address: this.privateMarketAddress,
      abi: APrivateTradingMarketArtifact.abi,
      functionName: 'bountyPool',
      args: [marketToken],
    }) as Promise<bigint>;
  }

  /**
   * Returns the cost to buy an order.
   */
  async getBuyOrderCost(marketToken: Address, orderId: bigint, fill: bigint) {
    return this.client.publicClient.readContract({
      address: this.privateMarketAddress,
      abi: APrivateTradingMarketArtifact.abi,
      functionName: 'getBuyOrderCost',
      args: [marketToken, orderId, fill],
    });
  }

  /**
   * Returns the amounts out when buying an order with a specific USDB amount.
   */
  async getBuyOrderAmountsOut(marketToken: Address, orderId: bigint, usdbAmount: bigint) {
    return this.client.publicClient.readContract({
      address: this.privateMarketAddress,
      abi: APrivateTradingMarketArtifact.abi,
      functionName: 'getBuyOrderAmountsOut',
      args: [marketToken, orderId, usdbAmount],
    });
  }

  /**
   * Returns an order by market and order ID.
   */
  async getMarketOrders(marketToken: Address, orderId: bigint) {
    return this.client.publicClient.readContract({
      address: this.privateMarketAddress,
      abi: APrivateTradingMarketArtifact.abi,
      functionName: 'marketOrders',
      args: [marketToken, orderId],
    });
  }

  /**
   * Returns the next order ID for a market.
   */
  async getNextOrderId(marketToken: Address): Promise<bigint> {
    return this.client.publicClient.readContract({
      address: this.privateMarketAddress,
      abi: APrivateTradingMarketArtifact.abi,
      functionName: 'nextOrderId',
      args: [marketToken],
    }) as Promise<bigint>;
  }

  /**
   * Returns whether an address is a voter for a market.
   */
  async isMarketVoter(marketToken: Address, voter: Address): Promise<boolean> {
    return this.client.publicClient.readContract({
      address: this.privateMarketAddress,
      abi: APrivateTradingMarketArtifact.abi,
      functionName: 'isMarketVoter',
      args: [marketToken, voter],
    }) as Promise<boolean>;
  }

  /**
   * Returns the outcome a voter chose for a market.
   */
  async getVoterChoice(marketToken: Address, voter: Address): Promise<number> {
    return this.client.publicClient.readContract({
      address: this.privateMarketAddress,
      abi: APrivateTradingMarketArtifact.abi,
      functionName: 'voterChoice',
      args: [marketToken, voter],
    }) as Promise<number>;
  }

  /**
   * Returns the first vote time for a market.
   */
  async getFirstVoteTime(marketToken: Address): Promise<bigint> {
    return this.client.publicClient.readContract({
      address: this.privateMarketAddress,
      abi: APrivateTradingMarketArtifact.abi,
      functionName: 'firstVoteTime',
      args: [marketToken],
    }) as Promise<bigint>;
  }

  /**
   * Returns whether a user can buy in a private event market.
   */
  async canUserBuy(marketToken: Address, user: Address): Promise<boolean> {
    return this.client.publicClient.readContract({
      address: this.privateMarketAddress,
      abi: APrivateTradingMarketArtifact.abi,
      functionName: 'userCanBuyEvent',
      args: [marketToken, user],
    }) as Promise<boolean>;
  }

  /**
   * Returns the bounty per correct vote for a market.
   */
  async getBountyPerVote(marketToken: Address): Promise<bigint> {
    return this.client.publicClient.readContract({
      address: this.privateMarketAddress,
      abi: APrivateTradingMarketArtifact.abi,
      functionName: 'bountyPerCorrectVote',
      args: [marketToken],
    }) as Promise<bigint>;
  }

  /**
   * Returns whether a voter has claimed the bounty for a market.
   */
  async hasClaimed(marketToken: Address, voter: Address): Promise<boolean> {
    return this.client.publicClient.readContract({
      address: this.privateMarketAddress,
      abi: APrivateTradingMarketArtifact.abi,
      functionName: 'bountyClaimed',
      args: [marketToken, voter],
    }) as Promise<boolean>;
  }

  /**
   * Returns the initial reserves required for a given number of outcomes.
   */
  async getInitialReserves(numOutcomes: bigint): Promise<readonly [bigint, bigint]> {
    return this.client.publicClient.readContract({
      address: this.privateMarketAddress,
      abi: APrivateTradingMarketArtifact.abi,
      functionName: 'getInitialReserves',
      args: [numOutcomes],
    }) as Promise<readonly [bigint, bigint]>;
  }
}
