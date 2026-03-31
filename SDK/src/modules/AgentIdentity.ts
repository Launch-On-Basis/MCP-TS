import { BasisClient } from '../BasisClient';
import IERC20Artifact from '../abis/IERC20.json';
import { Address, decodeEventLog } from 'viem';

// ERC-8004 Identity Registry on BSC
const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as Address;

// Inline ABI for the Identity Registry (external contract, no compiled artifact)
const identityRegistryAbi = [
  {"inputs":[{"name":"agentURI","type":"string"}],"name":"register","outputs":[{"name":"agentId","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},
  {"inputs":[],"name":"register","outputs":[{"name":"agentId","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},
  {"inputs":[{"name":"owner","type":"address"}],"name":"balanceOf","outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"name":"tokenId","type":"uint256"}],"name":"ownerOf","outputs":[{"name":"","type":"address"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"name":"agentId","type":"uint256"}],"name":"getAgentWallet","outputs":[{"name":"","type":"address"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"name":"agentId","type":"uint256"},{"name":"metadataKey","type":"string"}],"name":"getMetadata","outputs":[{"name":"","type":"bytes"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"name":"agentId","type":"uint256"},{"name":"metadataKey","type":"string"},{"name":"metadataValue","type":"bytes"}],"name":"setMetadata","outputs":[],"stateMutability":"nonpayable","type":"function"},
  {"inputs":[{"name":"agentId","type":"uint256"},{"name":"newURI","type":"string"}],"name":"setAgentURI","outputs":[],"stateMutability":"nonpayable","type":"function"},
  {"inputs":[{"name":"spender","type":"address"},{"name":"agentId","type":"uint256"}],"name":"isAuthorizedOrOwner","outputs":[{"name":"","type":"bool"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"name":"agentId","type":"uint256"}],"name":"tokenURI","outputs":[{"name":"","type":"string"}],"stateMutability":"view","type":"function"},
  {"anonymous":false,"inputs":[{"indexed":true,"name":"agentId","type":"uint256"},{"indexed":false,"name":"agentURI","type":"string"},{"indexed":true,"name":"owner","type":"address"}],"name":"Registered","type":"event"},
] as const;

export interface AgentConfig {
  name?: string;
  description?: string;
  image?: string;
  capabilities?: string[];
}

export class AgentIdentityModule {
  private client: BasisClient;
  private registryAddress: Address;

  constructor(client: BasisClient) {
    this.client = client;
    this.registryAddress = IDENTITY_REGISTRY;
  }

  private async _syncTx(txHash: string) {
    try {
      await this.client.api.syncTransaction(txHash);
    } catch (e: any) {
      console.warn('Sync warning:', e.message || e);
    }
  }

  /**
   * Build the on-chain metadata JSON for an agent.
   */
  private buildMetadataUri(wallet: string, config?: AgentConfig): string {
    const metadata = {
      type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
      name: config?.name || 'Basis Agent',
      description: config?.description || null,
      image: config?.image || null,
      website: 'https://launchonbasis.com',
      profile: `https://launchonbasis.com/profile/${wallet}`,
      protocol: 'basis',
      active: true,
      capabilities: config?.capabilities || ['trading'],
      supportedTrust: ['reputation'],
    };
    const json = JSON.stringify(metadata);
    const base64 = Buffer.from(json).toString('base64');
    return `data:application/json;base64,${base64}`;
  }

  /**
   * Check if a wallet has registered an agent on the Identity Registry.
   */
  async isRegistered(wallet: Address): Promise<boolean> {
    const balance = await this.client.publicClient.readContract({
      address: this.registryAddress,
      abi: identityRegistryAbi,
      functionName: 'balanceOf',
      args: [wallet],
    }) as bigint;
    return balance > 0n;
  }

  /**
   * Register the current wallet as an ERC-8004 agent.
   * Returns the agentId.
   *
   * If already registered on-chain, returns null (check via isRegistered first).
   */
  async register(config?: AgentConfig): Promise<{ hash: string; agentId: bigint }> {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error('Wallet required to register as agent.');
    }

    const account = this.client.walletClient.account;
    const uri = this.buildMetadataUri(account.address, config);

    const { request } = await this.client.publicClient.simulateContract({
      account,
      address: this.registryAddress,
      abi: identityRegistryAbi,
      functionName: 'register',
      args: [uri],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });

    this._syncTx(hash);

    // Parse agentId from Registered event
    let agentId = 0n;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() === this.registryAddress.toLowerCase()) {
        try {
          const decoded = decodeEventLog({
            abi: identityRegistryAbi,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === 'Registered') {
            agentId = (decoded.args as any).agentId;
            break;
          }
        } catch {}
      }
    }

    return { hash, agentId };
  }

  /**
   * Full registration flow:
   * 1. Check if already registered on-chain
   * 2. If not, register on-chain
   * 3. Save to backend API
   *
   * Returns the agentId.
   */
  async registerAndSync(config?: AgentConfig): Promise<bigint> {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error('Wallet required to register as agent.');
    }

    const address = this.client.walletClient.account.address;

    // Check if already registered on-chain
    const alreadyRegistered = await this.isRegistered(address);

    let agentId: bigint;

    if (alreadyRegistered) {
      // Try to load from API
      try {
        const apiAgent = await this.lookupFromApi(address);
        if (apiAgent && apiAgent.isAgent) {
          return BigInt(apiAgent.agent.agentId);
        }
      } catch {}
      // Can't determine agentId without API — return 0
      return 0n;
    }

    // Register on-chain
    const result = await this.register(config);
    agentId = result.agentId;

    // Sync to backend API
    try {
      await this.syncToApi(address, agentId, config);
    } catch (err) {
      console.warn('Agent API sync warning:', err instanceof Error ? err.message : err);
    }

    return agentId;
  }

  /**
   * Sync agent registration to the backend API.
   */
  private async syncToApi(wallet: string, agentId: bigint, config?: AgentConfig): Promise<void> {
    const cookie = this.client.sessionCookie;
    if (!cookie) return;

    const body = JSON.stringify({
      wallet,
      agentId: Number(agentId),
      name: config?.name || 'Basis Agent',
      description: config?.description || null,
    });

    const res = await fetch(`${this.client.apiDomain}/api/agents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Agent sync failed [${res.status}]: ${errBody}`);
    }
  }

  /**
   * Look up an agent by wallet address via the API.
   */
  async lookupFromApi(wallet: string): Promise<{ isAgent: boolean; agent: any } | null> {
    try {
      const res = await fetch(`${this.client.apiDomain}/api/agents/${wallet}`);
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  }

  /**
   * List all registered agents via the API.
   */
  async listAgents(page: number = 1, limit: number = 20): Promise<any> {
    const res = await fetch(`${this.client.apiDomain}/api/agents?page=${page}&limit=${limit}`);
    if (!res.ok) throw new Error(`Failed to list agents: ${res.status}`);
    return res.json();
  }

  /**
   * Get the tokenURI for a registered agent (on-chain).
   */
  async getAgentURI(agentId: bigint): Promise<string> {
    return this.client.publicClient.readContract({
      address: this.registryAddress,
      abi: identityRegistryAbi,
      functionName: 'tokenURI',
      args: [agentId],
    }) as Promise<string>;
  }

  /**
   * Get the wallet linked to an agent ID (on-chain).
   */
  async getAgentWallet(agentId: bigint): Promise<Address> {
    return this.client.publicClient.readContract({
      address: this.registryAddress,
      abi: identityRegistryAbi,
      functionName: 'getAgentWallet',
      args: [agentId],
    }) as Promise<Address>;
  }

  /**
   * Get metadata for an agent by key (on-chain).
   */
  async getMetadata(agentId: bigint, key: string): Promise<string> {
    return this.client.publicClient.readContract({
      address: this.registryAddress,
      abi: identityRegistryAbi,
      functionName: 'getMetadata',
      args: [agentId, key],
    }) as Promise<string>;
  }

  /**
   * Update the agent's URI (on-chain). Must be the owner.
   */
  async setAgentURI(agentId: bigint, newURI: string) {
    if (!this.client.walletClient || !this.client.walletClient.account) {
      throw new Error('Wallet required.');
    }

    const { request } = await this.client.publicClient.simulateContract({
      account: this.client.walletClient.account,
      address: this.registryAddress,
      abi: identityRegistryAbi,
      functionName: 'setAgentURI',
      args: [agentId, newURI],
    });

    const hash = await this.client.walletClient.writeContract(request);
    const receipt = await this.client.publicClient.waitForTransactionReceipt({ hash });
    this._syncTx(hash);
    return { hash, receipt };
  }
}
