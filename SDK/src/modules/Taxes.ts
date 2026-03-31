import { BasisClient } from '../BasisClient';
import ATaxesArtifact from '../abis/ATaxes.json';
import { Address } from 'viem';

export class TaxesModule {
  private client: BasisClient;
  private taxesAddress: Address;

  constructor(client: BasisClient, taxesAddress: Address) {
    this.client = client;
    this.taxesAddress = taxesAddress;
  }

  private async _syncTx(txHash: string) {
    try {
      await this.client.api.syncTransaction(txHash);
    } catch (e: any) {
      console.warn('Sync warning:', e.message || e);
    }
  }

  /**
   * Returns the effective tax rate (in basis points) for a specific token and user.
   */
  async getTaxRate(token: Address, user: Address): Promise<bigint> {
    return this.client.publicClient.readContract({
      address: this.taxesAddress,
      abi: ATaxesArtifact.abi,
      functionName: 'getTaxRate',
      args: [token, user],
    }) as Promise<bigint>;
  }

  /**
   * Returns the current surge tax rate (in basis points) for a token.
   */
  async getCurrentSurgeTax(token: Address): Promise<bigint> {
    return this.client.publicClient.readContract({
      address: this.taxesAddress,
      abi: ATaxesArtifact.abi,
      functionName: 'getCurrentSurgeTax',
      args: [token],
    }) as Promise<bigint>;
  }

  /**
   * Returns the available surge quota for a token.
   */
  async getAvailableSurgeQuota(token: Address): Promise<bigint> {
    return this.client.publicClient.readContract({
      address: this.taxesAddress,
      abi: ATaxesArtifact.abi,
      functionName: 'availableSurgeQuota',
      args: [token],
    }) as Promise<bigint>;
  }

  /**
   * Returns all four base tax rates.
   */
  async getBaseTaxRates() {
    const [stasis, stable, defaultRate, prediction] = await Promise.all([
      this.client.publicClient.readContract({
        address: this.taxesAddress,
        abi: ATaxesArtifact.abi,
        functionName: '_taxRateStasis',
      }) as Promise<bigint>,
      this.client.publicClient.readContract({
        address: this.taxesAddress,
        abi: ATaxesArtifact.abi,
        functionName: '_taxRateStable',
      }) as Promise<bigint>,
      this.client.publicClient.readContract({
        address: this.taxesAddress,
        abi: ATaxesArtifact.abi,
        functionName: '_taxRateDefault',
      }) as Promise<bigint>,
      this.client.publicClient.readContract({
        address: this.taxesAddress,
        abi: ATaxesArtifact.abi,
        functionName: '_taxRatePrediction',
      }) as Promise<bigint>,
    ]);

    return { stasis, stable, default: defaultRate, prediction };
  }

  /**
   * Start a decaying surge tax on a factory token. Only callable by the token's DEV.
   */
  async startSurgeTax(startRate: bigint, endRate: bigint, duration: bigint, token: Address) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required.");
    }
    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.taxesAddress,
      abi: ATaxesArtifact.abi,
      functionName: 'startSurgeTax',
      args: [startRate, endRate, duration, token],
    });
    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });
    this._syncTx(hash);
    return { hash, receipt };
  }

  /**
   * End an active surge tax early. Only callable by the token's DEV.
   */
  async endSurgeTax(token: Address) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required.");
    }
    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.taxesAddress,
      abi: ATaxesArtifact.abi,
      functionName: 'endSurgeTax',
      args: [token],
    });
    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });
    this._syncTx(hash);
    return { hash, receipt };
  }

  /**
   * Add a developer revenue share wallet for a token. Only callable by the token's DEV.
   */
  async addDevShare(token: Address, wallet: Address, basisPoints: bigint) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required.");
    }
    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.taxesAddress,
      abi: ATaxesArtifact.abi,
      functionName: 'addDevShare',
      args: [token, wallet, basisPoints],
    });
    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });
    this._syncTx(hash);
    return { hash, receipt };
  }

  /**
   * Remove a developer revenue share wallet. Only callable by the token's DEV.
   */
  async removeDevShare(token: Address, wallet: Address) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Stateful initialization (walletClient) is required.");
    }
    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.taxesAddress,
      abi: ATaxesArtifact.abi,
      functionName: 'removeDevShare',
      args: [token, wallet],
    });
    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });
    this._syncTx(hash);
    return { hash, receipt };
  }
}
