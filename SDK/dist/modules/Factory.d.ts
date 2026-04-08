import { BasisClient } from '../BasisClient';
import { Address } from 'viem';
export declare class FactoryModule {
    private client;
    private factoryAddress;
    constructor(client: BasisClient, factoryAddress: Address);
    private _syncTx;
    /**
     * Internal: creates a token on-chain. Use createTokenWithMetadata() instead.
     */
    private createToken;
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
     *
     * @param options.hybridMultiplier - raw integer (not wei) — controls floor price rise speed
     * @param options.usdbForBonding - USDB amount in wei (18 decimals)
     * @param options.startLP - initial liquidity in wei (18 decimals)
     * @param options.imageUrl - URL of the token image (provide imageUrl or imageFile, not both)
     * @param options.imageFile - raw image data as Buffer or Blob (alternative to imageUrl)
     */
    createTokenWithMetadata(options: {
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
        imageFile?: Blob | Buffer;
        website?: string;
        telegram?: string;
        twitterx?: string;
    }): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
        tokenAddress: `0x${string}`;
        imageUrl: string;
        metadata: {
            url: string;
            cid: string;
        };
    }>;
    disableFreeze(tokenAddress: Address): Promise<import("viem").TransactionReceipt>;
    /**
     * @param amount - token amount in wei (18 decimals)
     */
    setWhitelistedWallet(tokenAddress: Address, wallets: Address[], amount: bigint, tag: string): Promise<import("viem").TransactionReceipt>;
    getTokenState(tokenAddress: Address): Promise<{
        frozen: boolean;
        hasBonded: boolean;
        totalSupply: string;
        usdPrice: string;
    }>;
    /**
     * Checks if a token address belongs to the ecosystem.
     */
    isEcosystemToken(tokenAddress: Address): Promise<boolean>;
    /**
     * Returns all token addresses created by a given creator.
     */
    getTokensByCreator(creator: Address): Promise<Address[]>;
    /**
     * Returns the current fee amount (in wei) required to create a token.
     */
    getFeeAmount(): Promise<bigint>;
    /**
     * Removes a wallet from the whitelist on a FACTORYTOKEN contract.
     */
    /**
     * Claim accumulated USDB rewards from presale shares on a factory token.
     */
    claimRewards(tokenAddress: Address): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
    /**
     * Returns the floor price of a factory token in USDB.
     * Only available on factory tokens, not STASIS.
     */
    getFloorPrice(tokenAddress: Address): Promise<bigint>;
    /**
     * Get claimable USDB rewards for an address on a factory token.
     */
    getClaimableRewards(tokenAddress: Address, investor: Address): Promise<bigint>;
    removeWhitelist(tokenAddress: Address, wallet: Address): Promise<import("viem").TransactionReceipt>;
}
