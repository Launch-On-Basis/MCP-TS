import { BasisClient } from '../BasisClient';
import { Address } from 'viem';
export interface AgentConfig {
    name?: string;
    description?: string;
    image?: string;
    capabilities?: string[];
}
export declare class AgentSyncError extends Error {
    hash: string;
    agentId: bigint;
    constructor(message: string, hash: string, agentId: bigint);
}
export declare class AgentIdentityModule {
    private client;
    private registryAddress;
    constructor(client: BasisClient);
    private _syncTx;
    /**
     * Build the on-chain metadata JSON for an agent.
     */
    private buildMetadataUri;
    /**
     * Check if a wallet has registered an agent on the Identity Registry.
     */
    isRegistered(wallet: Address): Promise<boolean>;
    /**
     * Look up the agentId for a wallet by scanning Registered events on-chain.
     * Returns the agentId or null if not found.
     */
    getAgentIdFromChain(wallet: Address): Promise<bigint | null>;
    /**
     * Register the current wallet as an ERC-8004 agent.
     * Returns the agentId. Always syncs to backend — throws on sync failure.
     */
    register(config?: AgentConfig): Promise<{
        hash: string;
        agentId: bigint;
    }>;
    /**
     * Full registration flow:
     * 1. Check if already registered on-chain
     * 2. If not, register on-chain
     * 3. Save to backend API
     *
     * Returns the agentId.
     */
    registerAndSync(config?: AgentConfig): Promise<bigint>;
    /**
     * Sync agent registration to the backend API.
     */
    syncToApi(wallet: string, agentId: bigint, config?: AgentConfig): Promise<void>;
    /**
     * Look up an agent by wallet address via the API.
     */
    lookupFromApi(wallet: string): Promise<{
        isAgent: boolean;
        agent: any;
    } | null>;
    /**
     * List all registered agents via the API.
     */
    listAgents(page?: number, limit?: number): Promise<any>;
    /**
     * Get the tokenURI for a registered agent (on-chain).
     */
    getAgentURI(agentId: bigint): Promise<string>;
    /**
     * Get the wallet linked to an agent ID (on-chain).
     */
    getAgentWallet(agentId: bigint): Promise<Address>;
    /**
     * Get metadata for an agent by key (on-chain).
     */
    getMetadata(agentId: bigint, key: string): Promise<string>;
    /**
     * Update the agent's URI (on-chain). Must be the owner.
     */
    setAgentURI(agentId: bigint, newURI: string): Promise<{
        hash: `0x${string}`;
        receipt: import("viem").TransactionReceipt;
    }>;
}
