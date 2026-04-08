import { PublicClient, WalletClient, Address } from 'viem';
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
    /** If true (default), transactions try BSC Megafuel (zero gas) first, falling back to regular RPC. */
    gasless?: boolean;
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
    usdbAddress?: Address;
    mainTokenAddress?: Address;
    agent?: boolean | AgentConfig;
}
export declare class BasisClient {
    publicClient: PublicClient;
    walletClient?: WalletClient;
    private _fallbackWalletClient?;
    apiDomain: string;
    usdbAddress: Address;
    mainTokenAddress: Address;
    api: BasisAPI;
    factory: FactoryModule;
    trading: TradingModule;
    predictionMarkets: PredictionMarketsModule;
    orderBook: OrderBookModule;
    loans: LoansModule;
    vesting: VestingModule;
    staking: StakingModule;
    resolver: MarketResolverModule;
    privateMarkets: PrivateMarketsModule;
    marketReader: MarketReaderModule;
    leverageSimulator: LeverageSimulatorModule;
    taxes: TaxesModule;
    agent: AgentIdentityModule;
    private _sessionCookie;
    private _apiKey;
    /**
     * Write a contract call with automatic gasless fallback.
     * Tries megafuel (gasless) first. If rejected, retries with regular RPC.
     */
    writeContract(request: any): Promise<`0x${string}`>;
    /** Session cookie for authenticated API requests. */
    get sessionCookie(): string | null;
    /** API key for v1 data endpoints. */
    get apiKey(): string | null;
    constructor(options?: BasisClientOptions);
    /**
     * Async factory method that creates a fully initialized BasisClient.
     *
     * - Validates custom RPC URL by checking chainId === 56 (BSC).
     * - If a privateKey is provided and no apiKey: authenticates via SIWE and auto-provisions an API key.
     * - If an apiKey is provided: stores it directly.
     */
    static create(options?: BasisClientOptions): Promise<BasisClient>;
    /**
     * Authenticates with the Basis API using Sign-In with Ethereum (SIWE).
     *
     * 1. Fetches a nonce from the server
     * 2. Constructs and signs a SIWE message
     * 3. Submits the signed message for verification
     * 4. Stores the session cookie for subsequent authenticated requests
     */
    authenticate(address: `0x${string}`): Promise<void>;
    /**
     * Ensures an API key is available.
     *
     * - If an API key was already provided via the constructor, this is a no-op.
     * - If the server reports an existing key, the SDK cannot retrieve the
     *   plaintext (only a masked hint is returned). In that case an error is
     *   thrown instructing the operator to supply the key.
     * - If no keys exist yet, a new one is created. The key is only returned
     *   **once** at creation time — store it securely for future runs.
     *
     * @returns The API key string.
     */
    ensureApiKey(): Promise<string>;
    /**
     * Returns the current session status.
     * Optionally checks for a specific address.
     */
    getSession(address?: string): Promise<{
        isLoggedIn: boolean;
        address?: string;
        addresses?: string[];
        allAddresses?: string[];
    }>;
    /**
     * Logs out the specified address, removing it from the session.
     */
    logout(address: string): Promise<{
        ok: boolean;
        message: string;
    }>;
    /**
     * Claims daily USDB from the faucet via the server API.
     * Amount depends on active signals (max 500 USDB/day, 24h cooldown).
     * Requires SIWE session — call authenticate() first.
     *
     * Convenience wrapper around `client.api.claimFaucet()`.
     *
     * @param referrer - Optional referrer wallet address for the referral system.
     */
    claimFaucet(referrer?: string): Promise<{
        success: boolean;
        amount: number;
        txHash: string;
        signals: {
            base: boolean;
            twitter: boolean;
            active: boolean;
            hatchling: boolean;
            tidal: boolean;
        };
    }>;
}
