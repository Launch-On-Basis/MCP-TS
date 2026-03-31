import { BasisClient } from '../BasisClient';
import ALoanHubArtifact from '../abis/ALOAN_HUB.json';
import IERC20Artifact from '../abis/IERC20.json';
import { Address } from 'viem';

export class LoansModule {
  private client: BasisClient;
  private loanHubAddress: Address;

  constructor(client: BasisClient, loanHubAddress: Address) {
    this.client = client;
    this.loanHubAddress = loanHubAddress;
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
   * Takes a loan. Auto-approves the collateral token to the LoanHub.
   */
  async takeLoan(ecosystem: Address, collateral: Address, amount: bigint, daysCount: bigint) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    // Auto-approve collateral to the LoanHub
    await this.approveIfNeeded(collateral, this.loanHubAddress, amount);

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.loanHubAddress,
      abi: ALoanHubArtifact.abi,
      functionName: 'takeLoan',
      args: [ecosystem, collateral, amount, daysCount],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    this._syncTx(hash);
    return { hash, receipt };
  }

  /**
   * Repays a loan to release collateral.
   * Auto-approves the borrowed token (USDB) to the LoanHub.
   */
  async repayLoan(hubId: bigint) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    // Read loan details to get the repayment amount, then approve USDB
    const loanDetails = await this.getUserLoanDetails(
      this.client.walletClient.account.address, hubId
    ) as any;
    const fullAmount = loanDetails.fullAmount ?? loanDetails[7] ?? 0n;
    if (fullAmount > 0n) {
      await this.approveIfNeeded(this.client.usdbAddress, this.loanHubAddress, fullAmount);
    }

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.loanHubAddress,
      abi: ALoanHubArtifact.abi,
      functionName: 'repayLoan',
      args: [hubId],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    this._syncTx(hash);
    return { hash, receipt };
  }

  /**
   * Prolongs duration of a loan.
   * When payInStable is true, auto-approves USDB to the LoanHub.
   */
  async extendLoan(hubId: bigint, addDays: bigint, payInStable: boolean, refinance: boolean) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    // If paying in USDB, approve a generous amount to cover the extension fee
    if (payInStable) {
      const usdbBalance = await this.client.publicClient.readContract({
        address: this.client.usdbAddress,
        abi: IERC20Artifact.abi,
        functionName: 'balanceOf',
        args: [this.client.walletClient.account.address],
      }) as bigint;
      if (usdbBalance > 0n) {
        await this.approveIfNeeded(this.client.usdbAddress, this.loanHubAddress, usdbBalance);
      }
    }

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.loanHubAddress,
      abi: ALoanHubArtifact.abi,
      functionName: 'extendLoan',
      args: [hubId, addDays, payInStable, refinance],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    this._syncTx(hash);
    return { hash, receipt };
  }

  /**
   * Executes liquidation on a defaulted loan.
   */
  async claimLiquidation(hubId: bigint) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.loanHubAddress,
      abi: ALoanHubArtifact.abi,
      functionName: 'claimLiquidation',
      args: [hubId],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    this._syncTx(hash);
    return { hash, receipt };
  }

  /**
   * Returns FullLoanDetails struct.
   */
  async getUserLoanDetails(user: Address, hubId: bigint) {
    return this.client.publicClient.readContract({
      address: this.loanHubAddress,
      abi: ALoanHubArtifact.abi,
      functionName: 'getUserLoanDetails',
      args: [user, hubId],
    });
  }

  /**
   * Increases collateral on an existing loan.
   * Reads loan details to find the collateral token, then auto-approves it.
   */
  async increaseLoan(hubId: bigint, amountToAdd: bigint) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    // Read loan details to get collateral token
    const loanDetails = await this.getUserLoanDetails(
      this.client.walletClient.account.address, hubId
    ) as any;
    const collateral = loanDetails.collateralToken ?? loanDetails[3];
    await this.approveIfNeeded(collateral, this.loanHubAddress, amountToAdd);

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.loanHubAddress,
      abi: ALoanHubArtifact.abi,
      functionName: 'increaseLoan',
      args: [hubId, amountToAdd],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    this._syncTx(hash);
    return { hash, receipt };
  }

  /**
   * Returns the number of loans a user has.
   */
  /**
   * Partially sell collateral from a hub loan position.
   */
  async hubPartialLoanSell(hubId: bigint, percentage: bigint, isLeverage: boolean, minOut: bigint) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.loanHubAddress,
      abi: ALoanHubArtifact.abi,
      functionName: 'hubPartialLoanSell',
      args: [hubId, percentage, isLeverage, minOut],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });
    this._syncTx(hash);
    return { hash, receipt };
  }

  async getUserLoanCount(user: Address): Promise<bigint> {
    return this.client.publicClient.readContract({
      address: this.loanHubAddress,
      abi: ALoanHubArtifact.abi,
      functionName: 'userLoanCount',
      args: [user],
    }) as Promise<bigint>;
  }
}
