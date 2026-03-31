import { BasisClient } from '../BasisClient';
import AVestingArtifact from '../abis/A_VestingContract.json';
import IERC20Artifact from '../abis/IERC20.json';
import { Address } from 'viem';

export class VestingModule {
  private client: BasisClient;
  private vestingAddress: Address;

  constructor(client: BasisClient, vestingAddress: Address) {
    this.client = client;
    this.vestingAddress = vestingAddress;
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

  private async getFeeAmount(): Promise<bigint> {
    try {
      return await this.client.publicClient.readContract({
        address: this.vestingAddress,
        abi: AVestingArtifact.abi,
        functionName: 'feeAmount',
      }) as bigint;
    } catch {
      return 0n;
    }
  }

  /**
   * Creates a gradual vesting schedule.
   * Auto-approves the token to the vesting contract and attaches the creation fee.
   */
  async createGradualVesting(
    beneficiary: Address,
    token: Address,
    totalAmount: bigint,
    startTime: bigint,
    durationInDays: bigint,
    timeUnit: number,
    memo: string,
    ecosystem: Address
  ) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    // Auto-approve token to the vesting contract
    await this.approveIfNeeded(token, this.vestingAddress, totalAmount);

    // Fetch fee
    const feeAmount = await this.getFeeAmount();

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.vestingAddress,
      abi: AVestingArtifact.abi,
      functionName: 'createGradualVesting',
      args: [beneficiary, token, totalAmount, startTime, durationInDays, timeUnit, memo, ecosystem],
      value: feeAmount,
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    this._syncTx(hash);

    return { hash, receipt };
  }

  /**
   * Creates a cliff vesting schedule.
   */
  async createCliffVesting(
    beneficiary: Address,
    token: Address,
    totalAmount: bigint,
    unlockTime: bigint,
    memo: string,
    ecosystem: Address
  ) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    await this.approveIfNeeded(token, this.vestingAddress, totalAmount);
    const feeAmount = await this.getFeeAmount();

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.vestingAddress,
      abi: AVestingArtifact.abi,
      functionName: 'createCliffVesting',
      args: [beneficiary, token, totalAmount, unlockTime, memo, ecosystem],
      value: feeAmount,
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    this._syncTx(hash);

    return { hash, receipt };
  }

  /**
   * Claims unlocked tokens.
   */
  async claimTokens(vestingId: bigint) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.vestingAddress,
      abi: AVestingArtifact.abi,
      functionName: 'claimTokens',
      args: [vestingId],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    this._syncTx(hash);

    return { hash, receipt };
  }

  /**
   * Leverages locked tokens for a loan.
   */
  async takeLoanOnVesting(vestingId: bigint) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.vestingAddress,
      abi: AVestingArtifact.abi,
      functionName: 'takeLoanOnVesting',
      args: [vestingId],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    this._syncTx(hash);

    return { hash, receipt };
  }

  /**
   * Repays a loan taken on a vesting schedule.
   * Auto-approves the borrowed token (USDB) to the vesting contract.
   */
  async repayLoanOnVesting(vestingId: bigint) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    // Approve USDB (the borrowed token) to the vesting contract for repayment
    const usdbBalance = await this.client.publicClient.readContract({
      address: this.client.usdbAddress,
      abi: IERC20Artifact.abi,
      functionName: 'balanceOf',
      args: [this.client.walletClient.account.address],
    }) as bigint;
    if (usdbBalance > 0n) {
      await this.approveIfNeeded(this.client.usdbAddress, this.vestingAddress, usdbBalance);
    }

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.vestingAddress,
      abi: AVestingArtifact.abi,
      functionName: 'repayLoanOnVesting',
      args: [vestingId],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    this._syncTx(hash);

    return { hash, receipt };
  }

  /**
   * Gets details of a specific vesting schedule.
   */
  async getVestingDetails(vestingId: bigint) {
    return this.client.publicClient.readContract({
      address: this.vestingAddress,
      abi: AVestingArtifact.abi,
      functionName: 'getVestingDetails',
      args: [vestingId],
    });
  }

  /**
   * Gets the current claimable amount for a vesting schedule.
   */
  async getClaimableAmount(vestingId: bigint) {
    return this.client.publicClient.readContract({
      address: this.vestingAddress,
      abi: AVestingArtifact.abi,
      functionName: 'getClaimableAmount',
      args: [vestingId],
    });
  }

  /**
   * Creates gradual vesting schedules for multiple beneficiaries in a single transaction.
   * Auto-approves the sum of all amounts and attaches the creation fee.
   */
  async batchCreateGradualVesting(
    beneficiaries: Address[],
    token: Address,
    totalAmounts: bigint[],
    userMemos: string[],
    startTime: bigint,
    durationInDays: bigint,
    timeUnit: number,
    ecosystem: Address
  ) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    // Sum all amounts for approval
    const totalApproval = totalAmounts.reduce((sum, amt) => sum + amt, 0n);
    await this.approveIfNeeded(token, this.vestingAddress, totalApproval);

    const feeAmount = await this.getFeeAmount();

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.vestingAddress,
      abi: AVestingArtifact.abi,
      functionName: 'batchCreateGradualVesting',
      args: [beneficiaries, token, totalAmounts, userMemos, startTime, durationInDays, timeUnit, ecosystem],
      value: feeAmount,
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    this._syncTx(hash);

    return { hash, receipt };
  }

  /**
   * Creates cliff vesting schedules for multiple beneficiaries in a single transaction.
   * Auto-approves the sum of all amounts and attaches the creation fee.
   */
  async batchCreateCliffVesting(
    beneficiaries: Address[],
    token: Address,
    totalAmounts: bigint[],
    unlockTime: bigint,
    userMemos: string[],
    ecosystem: Address
  ) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    const totalApproval = totalAmounts.reduce((sum, amt) => sum + amt, 0n);
    await this.approveIfNeeded(token, this.vestingAddress, totalApproval);

    const feeAmount = await this.getFeeAmount();

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.vestingAddress,
      abi: AVestingArtifact.abi,
      functionName: 'batchCreateCliffVesting',
      args: [beneficiaries, token, totalAmounts, unlockTime, userMemos, ecosystem],
      value: feeAmount,
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    this._syncTx(hash);

    return { hash, receipt };
  }

  /**
   * Changes the beneficiary of a vesting schedule.
   */
  async changeBeneficiary(vestingId: bigint, newBeneficiary: Address) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.vestingAddress,
      abi: AVestingArtifact.abi,
      functionName: 'changeBeneficiary',
      args: [vestingId, newBeneficiary],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    this._syncTx(hash);

    return { hash, receipt };
  }

  /**
   * Extends the vesting period by additional days.
   */
  async extendVestingPeriod(vestingId: bigint, additionalDays: bigint) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.vestingAddress,
      abi: AVestingArtifact.abi,
      functionName: 'extendVestingPeriod',
      args: [vestingId, additionalDays],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    this._syncTx(hash);

    return { hash, receipt };
  }

  /**
   * Adds more tokens to an existing vesting schedule.
   * Auto-approves the token to the vesting contract.
   */
  async addTokensToVesting(vestingId: bigint, additionalAmount: bigint) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    // Read vesting details to get the token address
    const details = await this.getVestingDetails(vestingId) as any;
    const token = details.token ?? details[2];
    await this.approveIfNeeded(token, this.vestingAddress, additionalAmount);

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.vestingAddress,
      abi: AVestingArtifact.abi,
      functionName: 'addTokensToVesting',
      args: [vestingId, additionalAmount],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    this._syncTx(hash);

    return { hash, receipt };
  }

  /**
   * Transfers the creator role of a vesting schedule to a new address.
   */
  async transferCreatorRole(vestingId: bigint, newCreator: Address) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.vestingAddress,
      abi: AVestingArtifact.abi,
      functionName: 'transferCreatorRole',
      args: [vestingId, newCreator],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    this._syncTx(hash);

    return { hash, receipt };
  }

  /**
   * Returns all vesting IDs for a given beneficiary.
   */
  async getVestingsByBeneficiary(beneficiary: Address): Promise<bigint[]> {
    return this.client.publicClient.readContract({
      address: this.vestingAddress,
      abi: AVestingArtifact.abi,
      functionName: 'getVestingsByBeneficiary',
      args: [beneficiary],
    }) as Promise<bigint[]>;
  }

  /**
   * Returns the total vested amount for a vesting schedule.
   */
  async getVestedAmount(vestingId: bigint): Promise<bigint> {
    return this.client.publicClient.readContract({
      address: this.vestingAddress,
      abi: AVestingArtifact.abi,
      functionName: 'getVestedAmount',
      args: [vestingId],
    }) as Promise<bigint>;
  }

  /**
   * Returns the active loan ID for a vesting schedule.
   */
  async getActiveLoan(vestingId: bigint): Promise<bigint> {
    return this.client.publicClient.readContract({
      address: this.vestingAddress,
      abi: AVestingArtifact.abi,
      functionName: 'getActiveLoan',
      args: [vestingId],
    }) as Promise<bigint>;
  }

  /**
   * Returns vesting IDs for a given token within a specified index range.
   */
  async getTokenVestingIds(token: Address, startIndex: bigint, endIndex: bigint): Promise<bigint[]> {
    return this.client.publicClient.readContract({
      address: this.vestingAddress,
      abi: AVestingArtifact.abi,
      functionName: 'getTokenVestingIds',
      args: [token, startIndex, endIndex],
    }) as Promise<bigint[]>;
  }

  /**
   * Returns vesting details for multiple vesting IDs in a single call.
   */
  async getVestingDetailsBatch(vestingIds: bigint[]) {
    return this.client.publicClient.readContract({
      address: this.vestingAddress,
      abi: AVestingArtifact.abi,
      functionName: 'getVestingDetailsBatch',
      args: [vestingIds],
    });
  }

  /**
   * Returns the total number of vesting schedules created.
   */
  async getVestingCount(): Promise<bigint> {
    return this.client.publicClient.readContract({
      address: this.vestingAddress,
      abi: AVestingArtifact.abi,
      functionName: 'vestingCount',
    }) as Promise<bigint>;
  }

  /**
   * Returns all vesting IDs created by a given creator.
   */
  async getVestingsByCreator(creator: Address): Promise<bigint[]> {
    return this.client.publicClient.readContract({
      address: this.vestingAddress,
      abi: AVestingArtifact.abi,
      functionName: 'getVestingsByCreator',
      args: [creator],
    }) as Promise<bigint[]>;
  }
}
