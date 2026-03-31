import { createPublicClient, createWalletClient, http, PublicClient, WalletClient, Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';
import { SiweMessage } from 'siwe';

import { BasisAPI } from './api';
import { FactoryModule } from './modules/Factory';
import { TradingModule } from './modules/Trading';
import { PredictionMarketsModule } from './modules/PredictionMarkets';
import { OrderBookModule } from './modules/OrderBook';
import { LoansModule } from './modules/Loans';
import { VestingModule } from './modules/Vesting';
import { StakingModule } from './modules/Staking';
import { MarketResolverModule } from './modules/MarketResolver';
import { PrivateMarketsModule } from './modules/PrivateMarkets';
import { MarketReaderModule } from './modules/MarketReader';
import { LeverageSimulatorModule } from './modules/LeverageSimulator';
import { TaxesModule } from './modules/Taxes';
import { AgentIdentityModule, AgentConfig } from './modules/AgentIdentity';

export interface BasisClientOptions {
  rpcUrl?: string;
  privateKey?: `0x${string}`;
  apiKey?: string;
  apiDomain?: string;

  // Contract Addresses
  factoryAddress?: Address;
  swapAddress?: Address;
  marketTradingAddress?: Address;
  loanHubAddress?: Address;
  vestingAddress?: Address;
  stakingAddress?: Address;
  resolverAddress?: Address;
  privateMarketAddress?: Address;
  readerAddress?: Address;
  leverageAddress?: Address;
  taxesAddress?: Address;

  // Token Addresses
  usdbAddress?: Address;
  mainTokenAddress?: Address;

  // ERC-8004 Agent Identity
  agent?: boolean | AgentConfig;
}

export class BasisClient {
  public publicClient: PublicClient;
  public walletClient?: WalletClient;
  public apiDomain: string;
  public usdbAddress: Address;
  public mainTokenAddress: Address;

  // API wrapper
  public api: BasisAPI;

  // Modules
  public factory: FactoryModule;
  public trading: TradingModule;
  public predictionMarkets: PredictionMarketsModule;
  public orderBook: OrderBookModule;
  public loans: LoansModule;
  public vesting: VestingModule;
  public staking: StakingModule;
  public resolver: MarketResolverModule;
  public privateMarkets: PrivateMarketsModule;
  public marketReader: MarketReaderModule;
  public leverageSimulator: LeverageSimulatorModule;
  public taxes: TaxesModule;
  public agent: AgentIdentityModule;

  // Auth state
  private _sessionCookie: string | null = null;
  private _apiKey: string | null = null;

  /** Session cookie for authenticated API requests. */
  get sessionCookie(): string | null {
    return this._sessionCookie;
  }

  /** API key for v1 data endpoints. */
  get apiKey(): string | null {
    return this._apiKey;
  }

  constructor(options: BasisClientOptions = {}) {
    const rpcUrl = options.rpcUrl || 'https://bsc-dataseed.binance.org/';
    this.apiDomain = options.apiDomain || 'https://launchonbasis.com';

    this.publicClient = createPublicClient({
      chain: bsc,
      transport: http(rpcUrl),
    });

    if (options.privateKey) {
      const account = privateKeyToAccount(options.privateKey);
      this.walletClient = createWalletClient({
        account,
        chain: bsc,
        transport: http(rpcUrl),
      });
    }

    if (options.apiKey) {
      this._apiKey = options.apiKey;
    }

    // Default addresses
    const factoryAddr = options.factoryAddress || '0x13b32CcB24F1fd070cE8Ee5EA83AAC5a60f853DA';
    const swapAddr = options.swapAddress || '0xD9C99E3E92c5Cb303371223FAaA3C8f5FeE39399';
    const marketTradingAddr = options.marketTradingAddress || '0xcf8368E674A13662BA55F98bdb9A6FBC6aCEbEeE';
    const loanHubAddr = options.loanHubAddress || '0x4d3ca2DA5F77FA8c0D0CA53b4078D025519b6d8f';
    const vestingAddr = options.vestingAddress || '0xd27d9999b360f1D9c1Fb88F91d038D9d674f127b';
    this.usdbAddress = options.usdbAddress || '0x1b2b5D36e5F07BD6a272F95079590B70AdB776b1';
    this.mainTokenAddress = options.mainTokenAddress || '0x4B01013aC1F3501c64DFC7bC08aE5E23F391b5EA';

    this.api = new BasisAPI(this);
    this.factory = new FactoryModule(this, factoryAddr);
    this.trading = new TradingModule(this, swapAddr);
    this.predictionMarkets = new PredictionMarketsModule(this, marketTradingAddr);
    this.orderBook = new OrderBookModule(this, marketTradingAddr);
    this.loans = new LoansModule(this, loanHubAddr);
    this.vesting = new VestingModule(this, vestingAddr);

    const stakingAddr = options.stakingAddress || '0xb956d467D95a16f660aaBF25c5dE81A897254332';
    this.staking = new StakingModule(this, stakingAddr);

    const resolverAddr = options.resolverAddress || '0xDCE6daaE48Ec55977D22BB9D855BF7ef222077cf';
    this.resolver = new MarketResolverModule(this, resolverAddr);

    const privateMarketAddr = options.privateMarketAddress || '0xe9aA86286bE3b353241091910FB11Fd62CC88bd3';
    this.privateMarkets = new PrivateMarketsModule(this, privateMarketAddr);

    const readerAddr = options.readerAddress || '0x320C73CD00Dd484b53140795F9eD1C875A5A6D99';
    this.marketReader = new MarketReaderModule(this, readerAddr);

    const leverageAddr = options.leverageAddress || '0xD10B597d2B5CDAf965f7AC29339866513311e84d';
    this.leverageSimulator = new LeverageSimulatorModule(this, leverageAddr);

    const taxesAddr = options.taxesAddress || '0xb65Ff977fFb0ABa34c28e8b571D29DFb1a3416a4';
    this.taxes = new TaxesModule(this, taxesAddr);
    this.agent = new AgentIdentityModule(this);
  }

  /**
   * Async factory method that creates a fully initialized BasisClient.
   *
   * - Validates custom RPC URL by checking chainId === 56 (BSC).
   * - If a privateKey is provided and no apiKey: authenticates via SIWE and auto-provisions an API key.
   * - If an apiKey is provided: stores it directly.
   */
  static async create(options: BasisClientOptions = {}): Promise<BasisClient> {
    const client = new BasisClient(options);

    // Validate custom RPC if provided
    if (options.rpcUrl) {
      try {
        const chainId = await client.publicClient.getChainId();
        if (chainId !== 56) {
          throw new Error(
            `RPC endpoint returned chainId ${chainId}, expected 56 (BSC Mainnet). ` +
            `Ensure your RPC URL points to BSC Mainnet.`
          );
        }
      } catch (err: any) {
        if (err.message && err.message.includes('chainId')) {
          throw err;
        }
        throw new Error(
          `Failed to validate RPC endpoint "${options.rpcUrl}": ${err.message || err}. ` +
          `Check that the URL is correct and the node is reachable.`
        );
      }
    }

    // If privateKey provided and no apiKey, do SIWE auth + auto-provision key
    if (options.privateKey && !options.apiKey) {
      if (!client.walletClient?.account) {
        throw new Error('WalletClient was not initialized despite privateKey being provided.');
      }
      const address = client.walletClient.account.address;
      await client.authenticate(address);
      await client.ensureApiKey();
    }

    // ERC-8004 Agent Identity registration
    if (options.agent && options.privateKey) {
      const agentConfig = typeof options.agent === 'object' ? options.agent : undefined;
      try {
        await client.agent.registerAndSync(agentConfig);
      } catch (err) {
        console.warn('Agent registration warning:', err instanceof Error ? err.message : err);
      }
    }

    return client;
  }

  /**
   * Authenticates with the Basis API using Sign-In with Ethereum (SIWE).
   *
   * 1. Fetches a nonce from the server
   * 2. Constructs and signs a SIWE message
   * 3. Submits the signed message for verification
   * 4. Stores the session cookie for subsequent authenticated requests
   */
  async authenticate(address: `0x${string}`): Promise<void> {
    if (!this.walletClient) {
      throw new Error('WalletClient must be initialized to authenticate. Provide a privateKey.');
    }

    // 1. Fetch nonce
    const nonceRes = await fetch(
      `${this.apiDomain}/api/auth/nonce?address=${address}`
    );
    if (!nonceRes.ok) {
      throw new Error(`Failed to fetch nonce: ${nonceRes.status} ${nonceRes.statusText}`);
    }
    const nonceData = await nonceRes.json();
    const nonce: string = nonceData.nonce;

    // 2. Build SIWE message
    const domain = new URL(this.apiDomain).host;
    const message = new SiweMessage({
      domain,
      address,
      statement: 'Sign in to Basis API.',
      uri: this.apiDomain,
      version: '1',
      chainId: 56,
      nonce,
    });
    const preparedMessage = message.prepareMessage();

    // 3. Sign the message
    const signature = await this.walletClient.signMessage({
      account: this.walletClient.account!,
      message: preparedMessage,
    });

    // 4. Verify with backend
    const verifyRes = await fetch(`${this.apiDomain}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: preparedMessage, signature }),
    });

    if (!verifyRes.ok) {
      const body = await verifyRes.text().catch(() => '');
      throw new Error(
        `SIWE verification failed: ${verifyRes.status} ${verifyRes.statusText}. ${body}`
      );
    }

    // 5. Extract session cookie from Set-Cookie header
    const setCookie = verifyRes.headers.get('set-cookie');
    if (setCookie) {
      this._sessionCookie = setCookie;
    }
  }

  /**
   * Ensures an API key exists for the authenticated session.
   * Fetches existing keys or creates one labeled "basis-sdk-auto".
   */
  async ensureApiKey(): Promise<void> {
    if (!this._sessionCookie) {
      throw new Error('No session cookie. Call authenticate() first.');
    }

    // Check for existing keys
    const listRes = await fetch(`${this.apiDomain}/api/v1/auth/keys`, {
      headers: { Cookie: this._sessionCookie },
    });
    if (!listRes.ok) {
      throw new Error(`Failed to list API keys: ${listRes.status} ${listRes.statusText}`);
    }
    const listData = await listRes.json();

    if (listData.keys && listData.keys.length > 0 && listData.keys[0].key) {
      this._apiKey = listData.keys[0].key;
      return;
    }

    // Delete existing key with null value before creating a new one
    if (listData.keys && listData.keys.length > 0 && !listData.keys[0].key) {
      await fetch(`${this.apiDomain}/api/v1/auth/keys/${listData.keys[0].id}`, {
        method: 'DELETE',
        headers: { Cookie: this._sessionCookie },
      });
    }

    // No usable keys — create one
    const createRes = await fetch(`${this.apiDomain}/api/v1/auth/keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: this._sessionCookie,
      },
      body: JSON.stringify({ label: 'basis-sdk-auto' }),
    });
    if (!createRes.ok) {
      const body = await createRes.text().catch(() => '');
      throw new Error(
        `Failed to create API key: ${createRes.status} ${createRes.statusText}. ${body}`
      );
    }
    const createData = await createRes.json();
    this._apiKey = createData.key;
  }

  /**
   * Returns the current session status.
   * Optionally checks for a specific address.
   */
  async getSession(address?: string): Promise<{
    isLoggedIn: boolean;
    address?: string;
    addresses?: string[];
    allAddresses?: string[];
  }> {
    const params = address ? `?address=${address}` : '';
    const headers: Record<string, string> = {};
    if (this._sessionCookie) {
      headers['Cookie'] = this._sessionCookie;
    }
    const res = await fetch(`${this.apiDomain}/api/auth/me${params}`, { headers });
    if (!res.ok) {
      throw new Error(`Failed to get session: ${res.status} ${res.statusText}`);
    }
    return res.json();
  }

  /**
   * Logs out the specified address, removing it from the session.
   */
  async logout(address: string): Promise<{ ok: boolean; message: string }> {
    if (!this._sessionCookie) {
      throw new Error('No session cookie. Not logged in.');
    }
    const res = await fetch(`${this.apiDomain}/api/auth/me?address=${address}`, {
      method: 'DELETE',
      headers: { Cookie: this._sessionCookie },
    });
    if (!res.ok) {
      throw new Error(`Logout failed: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    this._sessionCookie = null;
    this._apiKey = null;
    return data;
  }

  /**
   * Claims 10,000 test USDB from the faucet. One claim per wallet, ever.
   * USDB from faucet is non-transferable except to Basis protocol contracts.
   * Optionally pass a referrer address for the referral system.
   */
  async claimFaucet(referrer: `0x${string}` = '0x0000000000000000000000000000000000000000'): Promise<{ hash: string; receipt: any }> {
    if (!this.walletClient || !this.walletClient.account) {
      throw new Error('Wallet (privateKey) is required to claim faucet.');
    }

    const faucetAbi = [{ inputs: [{ name: '_referrer', type: 'address' }], name: 'faucet', outputs: [], stateMutability: 'nonpayable', type: 'function' }] as const;

    const { request } = await this.publicClient.simulateContract({
      account: this.walletClient.account,
      address: this.usdbAddress,
      abi: faucetAbi,
      functionName: 'faucet',
      args: [referrer],
    });

    const hash = await this.walletClient.writeContract(request);
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

    return { hash, receipt };
  }
}
