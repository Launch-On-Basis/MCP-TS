import { BasisClient } from '../BasisClient';
import AStasisVaultArtifact from '../abis/AStasisVault.json';
import IERC20Artifact from '../abis/IERC20.json';
import { Address } from 'viem';

export class StakingModule {
  private client: BasisClient;
  private stakingAddress: Address;

  constructor(client: BasisClient, stakingAddress: Address) {
    this.client = client;
    this.stakingAddress = stakingAddress;
  }

  private async _syncTx(txHash: string) {
    try {
      await this.client.api.syncTransaction(txHash);
    } catch (e: any) {
      console.warn('Sync warning:', e.message || e);
    }
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

  /**
   * Wraps STASIS (MAINTOKEN) into wSTASIS.
   * Approves the staking contract to spend MAINTOKEN if needed.
   */
  async buy(amount: bigint) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    // Approve MAINTOKEN for staking contract
    await this.approveIfNeeded(this.client.mainTokenAddress, this.stakingAddress, amount);

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.stakingAddress,
      abi: AStasisVaultArtifact.abi,
      functionName: 'buy',
      args: [amount],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    this._syncTx(hash);
    return { hash, receipt };
  }

  /**
   * Unwraps wSTASIS back to STASIS, optionally converting to USDB.
   */
  async sell(shares: bigint, claimUSDB: boolean = false, minUSDB: bigint = 0n) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.stakingAddress,
      abi: AStasisVaultArtifact.abi,
      functionName: 'sell',
      args: [shares, claimUSDB, minUSDB],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    this._syncTx(hash);
    return { hash, receipt };
  }

  /**
   * Locks wSTASIS as collateral for borrowing.
   */
  async lock(shares: bigint) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    // Approve staking contract to transfer wSTASIS (the staking contract IS the wSTASIS token)
    await this.approveIfNeeded(this.stakingAddress, this.stakingAddress, shares);

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.stakingAddress,
      abi: AStasisVaultArtifact.abi,
      functionName: 'lock',
      args: [shares],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    this._syncTx(hash);
    return { hash, receipt };
  }

  /**
   * Unlocks wSTASIS collateral.
   */
  async unlock(shares: bigint) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.stakingAddress,
      abi: AStasisVaultArtifact.abi,
      functionName: 'unlock',
      args: [shares],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    this._syncTx(hash);
    return { hash, receipt };
  }

  /**
   * Pledges STASIS as collateral and borrows USDB against it.
   * The stasisAmountToBorrow parameter is the STASIS amount to pledge — USDB received is collateral value minus fees.
   */
  async borrow(stasisAmountToBorrow: bigint, days: bigint) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.stakingAddress,
      abi: AStasisVaultArtifact.abi,
      functionName: 'borrow',
      args: [stasisAmountToBorrow, days],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    this._syncTx(hash);
    return { hash, receipt };
  }

  /**
   * Repays the active staking loan. Auto-approves USDB to the staking contract.
   */
  async repay() {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    // Approve USDB to the staking contract for repayment
    const usdbBalance = await this.client.publicClient.readContract({
      address: this.client.usdbAddress,
      abi: IERC20Artifact.abi,
      functionName: 'balanceOf',
      args: [this.client.walletClient.account.address],
    }) as bigint;
    if (usdbBalance > 0n) {
      await this.approveIfNeeded(this.client.usdbAddress, this.stakingAddress, usdbBalance);
    }

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.stakingAddress,
      abi: AStasisVaultArtifact.abi,
      functionName: 'repay',
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    this._syncTx(hash);
    return { hash, receipt };
  }

  /**
   * Extends the active staking loan.
   */
  async extendLoan(daysToAdd: bigint, payInUSDB: boolean, refinance: boolean) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    // If paying in USDB, approve a generous amount to cover the extension fee
    if (payInUSDB) {
      const usdbBalance = await this.client.publicClient.readContract({
        address: this.client.usdbAddress,
        abi: IERC20Artifact.abi,
        functionName: 'balanceOf',
        args: [this.client.walletClient.account.address],
      }) as bigint;
      if (usdbBalance > 0n) {
        await this.approveIfNeeded(this.client.usdbAddress, this.stakingAddress, usdbBalance);
      }
    }

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.stakingAddress,
      abi: AStasisVaultArtifact.abi,
      functionName: 'extendLoan',
      args: [daysToAdd, payInUSDB, refinance],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    this._syncTx(hash);
    return { hash, receipt };
  }

  /**
   * Gets staking details for a user.
   * Returns [liquidShares, lockedShares, totalShares, totalAssetValue].
   */
  async getUserStakeDetails(user: Address) {
    return this.client.publicClient.readContract({
      address: this.stakingAddress,
      abi: AStasisVaultArtifact.abi,
      functionName: 'getUserStakeDetails',
      args: [user],
    });
  }

  /**
   * Gets the available STASIS (collateral value minus pledged).
   */
  async getAvailableStasis(user: Address) {
    return this.client.publicClient.readContract({
      address: this.stakingAddress,
      abi: AStasisVaultArtifact.abi,
      functionName: 'getAvailableStasis',
      args: [user],
    }) as Promise<bigint>;
  }

  /**
   * Converts STASIS amount to wSTASIS shares.
   */
  async convertToShares(assets: bigint) {
    return this.client.publicClient.readContract({
      address: this.stakingAddress,
      abi: AStasisVaultArtifact.abi,
      functionName: 'convertToShares',
      args: [assets],
    }) as Promise<bigint>;
  }

  /**
   * Converts wSTASIS shares to STASIS amount.
   */
  async convertToAssets(shares: bigint) {
    return this.client.publicClient.readContract({
      address: this.stakingAddress,
      abi: AStasisVaultArtifact.abi,
      functionName: 'convertToAssets',
      args: [shares],
    }) as Promise<bigint>;
  }

  /**
   * Returns total STASIS held by the vault (available + pledged).
   */
  async totalAssets(): Promise<bigint> {
    return this.client.publicClient.readContract({
      address: this.stakingAddress,
      abi: AStasisVaultArtifact.abi,
      functionName: 'totalAssets',
    }) as Promise<bigint>;
  }

  /**
   * Borrows additional STASIS against locked wSTASIS collateral on an existing loan.
   */
  async addToLoan(additionalStasisToBorrow: bigint) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.stakingAddress,
      abi: AStasisVaultArtifact.abi,
      functionName: 'addToLoan',
      args: [additionalStasisToBorrow],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    this._syncTx(hash);
    return { hash, receipt };
  }

  /**
   * Settles a liquidated staking loan position.
   */
  async settleLiquidation() {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.stakingAddress,
      abi: AStasisVaultArtifact.abi,
      functionName: 'settleLiquidation',
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    this._syncTx(hash);
    return { hash, receipt };
  }
}
