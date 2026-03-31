import { BasisClient } from '../BasisClient';
import ATokenFactoryArtifact from '../abis/ATokenFactory.json';
import FactoryTokenArtifact from '../abis/FACTORYTOKEN.json';
import { parseEther, getContract, getAddress, keccak256, toBytes, Address, GetContractReturnType } from 'viem';

export class FactoryModule {
  private client: BasisClient;
  private factoryAddress: Address;

  constructor(client: BasisClient, factoryAddress: Address) {
    this.client = client;
    this.factoryAddress = factoryAddress;
  }

  private async _syncTx(txHash: string) {
    try {
      await this.client.api.syncTransaction(txHash);
    } catch (e: any) {
      console.warn('Sync warning:', e.message || e);
    }
  }

  /**
   * Internal: creates a token on-chain. Use createTokenWithMetadata() instead.
   */
  private async createToken(
    symbol: string,
    name: string,
    hybridMultiplier: bigint,
    frozen: boolean,
    usdbForBonding: bigint,
    startLP: bigint,
    autoVest: boolean,
    autoVestDuration: bigint,
    gradualAutovest: boolean
  ) {
    if (!this.client.walletClient) {
      throw new Error("Stateful initialization (walletClient) is required for write methods.");
    }

    const account = this.client.walletClient.account;
    if (!account) throw new Error("Account is required");

    // Get the create fee from the contract
    const feeAmount = await this.client.publicClient.readContract({
      address: this.factoryAddress,
      abi: ATokenFactoryArtifact.abi,
      functionName: 'feeAmount',
    }) as bigint;

    const { request } = await this.client.publicClient.simulateContract({
      account,
      address: this.factoryAddress,
      abi: ATokenFactoryArtifact.abi,
      functionName: 'createToken',
      args: [
        symbol,
        name,
        hybridMultiplier,
        frozen,
        usdbForBonding,
        startLP,
        autoVest,
        autoVestDuration,
        gradualAutovest
      ],
      value: feeAmount,
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    return { hash, receipt };
  }

  /**
   * Creates a token and registers its metadata on IPFS in one call.
   * Requires SIWE authentication (call client.authenticate() first).
   *
   * 1. Creates the token on-chain
   * 2. Parses the new token address from logs
   * 3. Downloads, resizes (512x512 WebP), and uploads the image to IPFS
   * 4. Creates metadata on IPFS (name, symbol, description auto-read from chain)
   *
   * Returns { hash, receipt, tokenAddress, imageUrl, metadata }
   */
  async createTokenWithMetadata(options: {
    symbol: string;
    name: string;
    hybridMultiplier: bigint;
    frozen?: boolean;
    usdbForBonding?: bigint;
    startLP: bigint;
    autoVest?: boolean;
    autoVestDuration?: bigint;
    gradualAutovest?: boolean;
    description?: string;
    imageUrl?: string;
    website?: string;
    telegram?: string;
    twitterx?: string;
  }) {
    // 1. Create token on-chain
    const createResult = await this.createToken(
      options.symbol,
      options.name,
      options.hybridMultiplier,
      options.frozen ?? false,
      options.usdbForBonding ?? 0n,
      options.startLP,
      options.autoVest ?? false,
      options.autoVestDuration ?? 0n,
      options.gradualAutovest ?? false,
    );

    if (createResult.receipt.status === 'reverted') {
      throw new Error(`Token creation reverted (tx: ${createResult.hash})`);
    }

    // 2. Parse token address from TokenCreated event
    const TOKEN_CREATED_TOPIC = keccak256(toBytes('TokenCreated(address,string,string,address)'));
    const tokenCreatedLog = createResult.receipt.logs.find(
      (l: any) => l.address.toLowerCase() === this.factoryAddress.toLowerCase() && l.topics[0] === TOKEN_CREATED_TOPIC
    );

    let tokenAddress: Address;
    if (tokenCreatedLog && tokenCreatedLog.topics[1]) {
      tokenAddress = getAddress('0x' + tokenCreatedLog.topics[1].slice(26)) as Address;
    } else {
      throw new Error('Could not extract token address from creation logs.');
    }

    // 3. Upload image if provided
    let imageUrl: string | undefined;
    if (options.imageUrl) {
      imageUrl = await this.client.api.uploadImageFromUrl(options.imageUrl, tokenAddress);
    }

    // 4. Create metadata on IPFS
    const metadata = await this.client.api.updateMetadata({
      address: tokenAddress,
      description: options.description,
      image: imageUrl,
      website: options.website,
      telegram: options.telegram,
      twitterx: options.twitterx,
    });

    // Sync the creation tx
    this._syncTx(createResult.hash);

    return {
      hash: createResult.hash,
      receipt: createResult.receipt,
      tokenAddress,
      imageUrl,
      metadata,
    };
  }

  async disableFreeze(tokenAddress: Address) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Wallet account is required.");
    }

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: tokenAddress,
      abi: FactoryTokenArtifact.abi,
      functionName: 'DisableFreeze',
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });
    this._syncTx(hash);
    return receipt;
  }

  async setWhitelistedWallet(tokenAddress: Address, wallets: Address[], amount: bigint, tag: string) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Wallet account is required.");
    }

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: tokenAddress,
      abi: FactoryTokenArtifact.abi,
      functionName: 'SetWhitelistedWallet',
      args: [wallets, amount, tag],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });
    this._syncTx(hash);
    return receipt;
  }

  async getTokenState(tokenAddress: Address) {
    // We can bundle requests via multicall for better performance, but here we do simple reads for brevity
    const contract = getContract({
      address: tokenAddress,
      abi: FactoryTokenArtifact.abi,
      client: this.client.publicClient,
    });

    const [frozen, hasBonded, totalSupply, usdPrice] = await Promise.all([
      contract.read.frozen(),
      contract.read.hasBonded(),
      contract.read.totalSupply(),
      contract.read.getUSDPrice()
    ]);

    return {
      frozen: frozen as boolean,
      hasBonded: hasBonded as boolean,
      totalSupply: (totalSupply as bigint).toString(),
      usdPrice: (usdPrice as bigint).toString()
    };
  }

  /**
   * Checks if a token address belongs to the ecosystem.
   */
  async isEcosystemToken(tokenAddress: Address): Promise<boolean> {
    return this.client.publicClient.readContract({
      address: this.factoryAddress,
      abi: ATokenFactoryArtifact.abi,
      functionName: 'isEcosystemToken',
      args: [tokenAddress],
    }) as Promise<boolean>;
  }

  /**
   * Returns all token addresses created by a given creator.
   */
  async getTokensByCreator(creator: Address): Promise<Address[]> {
    return this.client.publicClient.readContract({
      address: this.factoryAddress,
      abi: ATokenFactoryArtifact.abi,
      functionName: 'getTokensByCreator',
      args: [creator],
    }) as Promise<Address[]>;
  }

  /**
   * Returns the current fee amount (in wei) required to create a token.
   */
  async getFeeAmount(): Promise<bigint> {
    return this.client.publicClient.readContract({
      address: this.factoryAddress,
      abi: ATokenFactoryArtifact.abi,
      functionName: 'feeAmount',
    }) as Promise<bigint>;
  }

  /**
   * Removes a wallet from the whitelist on a FACTORYTOKEN contract.
   */
  /**
   * Claim accumulated USDB rewards from presale shares on a factory token.
   */
  async claimRewards(tokenAddress: Address) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Wallet account is required.");
    }
    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: tokenAddress,
      abi: FactoryTokenArtifact.abi,
      functionName: 'claimRewards',
    });
    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });
    this._syncTx(hash);
    return { hash, receipt };
  }

  /**
   * Get claimable USDB rewards for an address on a factory token.
   */
  async getClaimableRewards(tokenAddress: Address, investor: Address): Promise<bigint> {
    return this.client.publicClient.readContract({
      address: tokenAddress,
      abi: FactoryTokenArtifact.abi,
      functionName: 'getClaimableRewards',
      args: [investor],
    }) as Promise<bigint>;
  }

  async removeWhitelist(tokenAddress: Address, wallet: Address) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error("Wallet account is required.");
    }

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: tokenAddress,
      abi: FactoryTokenArtifact.abi,
      functionName: 'RemoveWhitelist',
      args: [wallet],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });
    this._syncTx(hash);
    return receipt;
  }
}
