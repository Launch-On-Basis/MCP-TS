import sharp from 'sharp';
import { BasisClient } from './BasisClient';

// ---------------------------------------------------------------------------
// Response / payload type interfaces
// ---------------------------------------------------------------------------

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface CursorPagination {
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
}

export interface Token {
  id: number;
  address: string;
  name: string;
  symbol: string;
  description?: string;
  dev: string;
  image?: string;
  multiplier: number;
  isPrediction: boolean;
  predictionType?: string | null;
  predictionStatus?: string | null;
  endTime?: string | null;
  eventType?: string | null;
  website?: string | null;
  telegram?: string | null;
  twitterx?: string | null;
  createdAt: string;
  lastActivityAt?: string;
  predictionOptions?: Array<{ index: number; name: string }>;
  [key: string]: unknown;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface Trade {
  id: number;
  type: string;
  amountToken: string;
  amountUSDC: string;
  user: string;
  price: string;
  txHash: string;
  blockNumber: number;
  timestamp: string;
  [key: string]: unknown;
}

export interface Order {
  id: string;
  orderId: number;
  seller: string;
  outcomeId: number;
  amount: string;
  pricePerShare: string;
  status: string;
  createdAt: string;
  [key: string]: unknown;
}

export interface Comment {
  id: number;
  projectId: number;
  content: string;
  author: string;
  tradeType?: string;
  txHash?: string;
  createdAt: string;
  deletedAt?: string | null;
  [key: string]: unknown;
}

export interface ApiKeyInfo {
  id: string;
  key: string;
  label: string;
  createdAt: string;
  lastUsedAt?: string;
}

export interface MetadataPayload {
  address: string;
  description?: string;
  website?: string;
  telegram?: string;
  twitterx?: string;
  image?: string;
}

export interface ProjectUpdatePayload {
  [key: string]: unknown;
}

export interface LiquidityEntry {
  id: number;
  buyer: string;
  outcomeId: number;
  shares: string;
  usdcSpent: string;
  tradeType: string;
  newReserve: string;
  newTotalReserve: string;
  txHash: string;
  blockNumber: number;
  timestamp: string;
  [key: string]: unknown;
}

export interface WalletTransaction {
  id: number;
  contractAddress: string;
  type: string;
  amountToken: string;
  amountUSDC: string;
  price: string;
  txHash: string;
  blockNumber: number;
  timestamp: string;
  [key: string]: unknown;
}

export interface WhitelistEntry {
  walletAddress: string;
  buyAmount: string;
  note: string | null;
  txHash: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface MyStats {
  totalTrades: number;
  buys: number;
  sells: number;
  totalPredictions: number;
  tokensCreated: number;
  marketsCreated: number;
  totalLoans: number;
  activeLoans: number;
  marketWins: number;
  daysActive: number;
  agent: { agentId: number; name: string } | null;
}

export interface MyProjectItem {
  address: string;
  name: string;
  symbol: string;
  image: string;
  createdAt: string;
}

export interface MyProjects {
  tokens: MyProjectItem[];
  markets: MyProjectItem[];
}

export interface MySocial {
  platform: string;
  handle: string;
  url: string | null;
  isPublic: boolean;
}

export interface MyXAccount {
  username: string;
  displayName: string;
  profileImage: string;
  isPublic: boolean;
}

export interface MyProfile {
  wallet: string;
  username: string | null;
  avatarUrl: string | null;
  tier: string;
  tierEmoji: string;
  rank: number;
  rankDelta: number;
  streak: number;
  acsScore?: number;
  socials: MySocial[];
  xAccount: MyXAccount | null;
  stale: boolean;
  lastUpdated: string;
}

export interface UpdateProfilePayload {
  username?: string | null;
  social?: { platform: string; handle: string };
  removeSocial?: string;
  toggleSocialPublic?: string;
}

export interface UpdateProfileResult {
  success: boolean;
  action: string;
  [key: string]: unknown;
}

export interface ReferralUser {
  wallet: string;
  username: string | null;
  tier: string;
  tierEmoji: string;
  rank: number;
  joinedAt?: string;
  layer?: number;
}

export interface MyReferrals {
  referrer: ReferralUser | null;
  tier: string;
  tierEmoji: string;
  directCount: number;
  indirectCount: number;
  referrals: ReferralUser[];
}

// ---------------------------------------------------------------------------
// BasisAPI — full off-chain API client
// ---------------------------------------------------------------------------

export class BasisAPI {
  private client: BasisClient;

  constructor(client: BasisClient) {
    this.client = client;
  }

  // -----------------------------------------------------------------------
  // Internal fetch helpers
  // -----------------------------------------------------------------------

  /**
   * Fetch helper that attaches the session cookie for endpoints requiring
   * an authenticated session (auth, metadata, comments write, images, etc.).
   */
  private async fetchWithSession(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<Response> {
    const cookie = this.client.sessionCookie;
    if (!cookie) {
      throw new Error(
        'No session cookie available. Authenticate first via BasisClient.authenticate().',
      );
    }

    const url = this.buildUrl(endpoint);
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string> | undefined),
      Cookie: cookie,
    };

    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `API request failed [${res.status}] ${res.statusText}: ${body}`,
      );
    }
    return res;
  }

  /**
   * Fetch helper that attaches the X-API-Key header for /api/v1 data endpoints.
   */
  private async fetchWithApiKey(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<Response> {
    const apiKey = this.client.apiKey;
    if (!apiKey) {
      throw new Error(
        'No API key available. Provide one via BasisClientOptions.apiKey or use BasisClient.create() with a privateKey to auto-provision.',
      );
    }

    const url = this.buildUrl(endpoint);
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string> | undefined),
      'X-API-Key': apiKey,
    };

    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `API request failed [${res.status}] ${res.statusText}: ${body}`,
      );
    }
    return res;
  }

  private buildUrl(endpoint: string): string {
    // endpoint should start with /api
    const base = this.client.apiDomain.replace(/\/+$/, '');
    return `${base}${endpoint}`;
  }

  // -----------------------------------------------------------------------
  // Auth endpoints (session-based)
  // -----------------------------------------------------------------------

  /** GET /api/auth/me — get current session info. */
  async getSession(address?: string): Promise<{
    isLoggedIn: boolean;
    address?: string;
    addresses?: string[];
    allAddresses?: string[];
  }> {
    const params = address ? `?address=${encodeURIComponent(address)}` : '';
    const res = await this.fetchWithSession(`/api/auth/me${params}`, {
      method: 'GET',
    });
    return res.json();
  }

  /** DELETE /api/auth/me — log out a specific address. */
  async logout(address: string): Promise<{ ok: boolean; message: string }> {
    const res = await this.fetchWithSession(
      `/api/auth/me?address=${encodeURIComponent(address)}`,
      { method: 'DELETE' },
    );
    return res.json();
  }

  // -----------------------------------------------------------------------
  // API key management (session-based)
  // -----------------------------------------------------------------------

  /** POST /api/v1/auth/keys — create a new API key. */
  async createApiKey(label: string): Promise<ApiKeyInfo> {
    const res = await this.fetchWithSession('/api/v1/auth/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
    });
    return res.json();
  }

  /** GET /api/v1/auth/keys — list API keys for the session wallet. */
  async listApiKeys(): Promise<{ keys: ApiKeyInfo[] }> {
    const res = await this.fetchWithSession('/api/v1/auth/keys', {
      method: 'GET',
    });
    return res.json();
  }

  /** DELETE /api/v1/auth/keys/:id — revoke an API key. */
  async deleteApiKey(id: string): Promise<{ ok: boolean; message: string }> {
    const res = await this.fetchWithSession(
      `/api/v1/auth/keys/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
    return res.json();
  }

  // -----------------------------------------------------------------------
  // Image upload (session-based)
  // -----------------------------------------------------------------------

  /**
   * POST /api/images — upload an image file.
   *
   * Accepts Blob, Buffer, or a File-like object. Returns the hosted URL string.
   */
  async uploadImage(
    file: Blob | Buffer,
    filename: string = 'image.png',
  ): Promise<string> {
    const formData = new FormData();

    if (Buffer.isBuffer(file)) {
      // Infer MIME type from filename extension
      const ext = filename.split('.').pop()?.toLowerCase();
      const mimeMap: Record<string, string> = {
        webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg',
        jpeg: 'image/jpeg', gif: 'image/gif',
      };
      const mime = mimeMap[ext || ''] || 'image/png';
      const blob = new Blob([new Uint8Array(file)], { type: mime });
      formData.append('file', blob, filename);
    } else {
      formData.append('file', file, filename);
    }

    // Do NOT set Content-Type header — fetch/FormData sets the correct
    // multipart boundary automatically.
    const res = await this.fetchWithSession('/api/images', {
      method: 'POST',
      body: formData,
    });

    // Response is a URL string
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  /**
   * Downloads an image from a URL, resizes it to 512x512 (center-crop),
   * converts to WebP, and uploads it to IPFS via /api/images.
   *
   * Returns the hosted IPFS URL string.
   */
  async uploadImageFromUrl(imageUrl: string, contractAddress?: string): Promise<string> {
    // 1. Download the image
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to download image from ${imageUrl}: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const inputBuffer = Buffer.from(arrayBuffer);

    // 2. Resize to 512x512 center-crop and convert to WebP
    const webpBuffer = await sharp(inputBuffer)
      .resize(512, 512, { fit: 'cover', position: 'centre' })
      .webp({ quality: 90 })
      .toBuffer();

    // 3. Upload — name file after contract address if provided
    const filename = contractAddress ? `${contractAddress}.webp` : `image_${Date.now()}.webp`;
    return this.uploadImage(webpBuffer, filename);
  }

  // -----------------------------------------------------------------------
  // Metadata (session-based, must be creator)
  // -----------------------------------------------------------------------

  /**
   * POST /api/metadata — publish or update project metadata.
   * Requires session and the caller must be the token creator.
   */
  async updateMetadata(
    payload: MetadataPayload,
  ): Promise<{ url: string; cid: string }> {
    const res = await this.fetchWithSession('/api/metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.json();
  }

  // -----------------------------------------------------------------------
  // Project updates (session-based, must be dev)
  // -----------------------------------------------------------------------

  /**
   * POST /api/projects/:address — update project info.
   * Accepts either a plain JSON payload or a payload with an image Blob/Buffer.
   */
  async updateProject(
    address: string,
    payload: ProjectUpdatePayload,
    image?: Blob | Buffer,
    imageFilename?: string,
  ): Promise<{ success: boolean; project: Record<string, unknown> }> {
    let body: BodyInit;
    const headers: Record<string, string> = {};

    if (image) {
      const formData = new FormData();
      for (const [key, value] of Object.entries(payload)) {
        if (value !== undefined && value !== null) {
          formData.append(key, String(value));
        }
      }
      if (Buffer.isBuffer(image)) {
        formData.append('image', new Blob([new Uint8Array(image)]), imageFilename || 'image.png');
      } else {
        formData.append('image', image, imageFilename || 'image.png');
      }
      body = formData;
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(payload);
    }

    const res = await this.fetchWithSession(
      `/api/projects/${encodeURIComponent(address)}`,
      { method: 'POST', headers, body },
    );
    return res.json();
  }

  // -----------------------------------------------------------------------
  // Comments
  // -----------------------------------------------------------------------

  /** GET /api/comments — list comments for a project. */
  async getComments(
    projectId: number,
    options: { page?: number; limit?: number } = {},
  ): Promise<{ data: Comment[]; pagination: Pagination }> {
    const params = new URLSearchParams();
    params.set('projectId', String(projectId));
    if (options.page !== undefined) params.set('page', String(options.page));
    if (options.limit !== undefined) params.set('limit', String(options.limit));

    const url = `${this.client.apiDomain}/api/comments?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch comments: ${res.status} ${res.statusText}`);
    }
    return res.json();
  }

  /** POST /api/comments — create a comment (session required). */
  async createComment(
    projectId: number,
    content: string,
    authorAddress: string,
  ): Promise<Comment> {
    const res = await this.fetchWithSession('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, content, authorAddress }),
    });
    return res.json();
  }

  /** DELETE /api/comments — soft-delete a comment (session required). */
  async deleteComment(
    commentId: number,
    authorAddress: string,
  ): Promise<{ ok: boolean }> {
    const params = new URLSearchParams();
    params.set('id', String(commentId));
    params.set('authorAddress', authorAddress);

    const res = await this.fetchWithSession(
      `/api/comments?${params.toString()}`,
      { method: 'DELETE' },
    );
    return res.json();
  }

  // -----------------------------------------------------------------------
  // v1 Data endpoints (API-key authenticated)
  // -----------------------------------------------------------------------

  /**
   * GET /api/v1/tokens — list / search tokens.
   */
  async getTokens(options: {
    search?: string;
    isPrediction?: boolean;
    sort?: string;
    page?: number;
    limit?: number;
  } = {}): Promise<{ data: Token[]; pagination: Pagination }> {
    const params = new URLSearchParams();
    if (options.search !== undefined) params.set('search', options.search);
    if (options.isPrediction !== undefined) params.set('isPrediction', String(options.isPrediction));
    if (options.sort !== undefined) params.set('sort', options.sort);
    if (options.page !== undefined) params.set('page', String(options.page));
    if (options.limit !== undefined) params.set('limit', String(options.limit));

    const qs = params.toString();
    const endpoint = `/api/v1/tokens${qs ? `?${qs}` : ''}`;
    const res = await this.fetchWithApiKey(endpoint);
    return res.json();
  }

  /** GET /api/v1/tokens/:address — get a single token's details. */
  async getToken(address: string): Promise<{ data: Token }> {
    const res = await this.fetchWithApiKey(
      `/api/v1/tokens/${encodeURIComponent(address)}`,
    );
    return res.json();
  }

  /**
   * GET /api/v1/tokens/:address/candles — OHLCV candle data.
   */
  async getCandles(
    address: string,
    options: {
      interval?: string;
      from?: string | number;
      to?: string | number;
      limit?: number;
    } = {},
  ): Promise<{ data: Candle[]; interval: string; count: number }> {
    const params = new URLSearchParams();
    if (options.interval !== undefined) params.set('interval', options.interval);
    if (options.from !== undefined) params.set('from', String(options.from));
    if (options.to !== undefined) params.set('to', String(options.to));
    if (options.limit !== undefined) params.set('limit', String(options.limit));

    const qs = params.toString();
    const endpoint = `/api/v1/tokens/${encodeURIComponent(address)}/candles${qs ? `?${qs}` : ''}`;
    const res = await this.fetchWithApiKey(endpoint);
    return res.json();
  }

  /**
   * GET /api/v1/tokens/:address/trades — trade history for a token.
   */
  async getTrades(
    address: string,
    options: { cursor?: string; limit?: number; type?: string } = {},
  ): Promise<{ data: Trade[]; pagination: CursorPagination }> {
    const params = new URLSearchParams();
    if (options.cursor !== undefined) params.set('cursor', options.cursor);
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.type !== undefined) params.set('type', options.type);

    const qs = params.toString();
    const endpoint = `/api/v1/tokens/${encodeURIComponent(address)}/trades${qs ? `?${qs}` : ''}`;
    const res = await this.fetchWithApiKey(endpoint);
    return res.json();
  }

  /**
   * GET /api/v1/tokens/:address/orders — order book entries for a token.
   */
  async getOrders(
    address: string,
    options: {
      status?: string;
      outcomeId?: string;
      page?: number;
      limit?: number;
    } = {},
  ): Promise<{ data: Order[]; pagination: Pagination }> {
    const params = new URLSearchParams();
    if (options.status !== undefined) params.set('status', options.status);
    if (options.outcomeId !== undefined) params.set('outcomeId', options.outcomeId);
    if (options.page !== undefined) params.set('page', String(options.page));
    if (options.limit !== undefined) params.set('limit', String(options.limit));

    const qs = params.toString();
    const endpoint = `/api/v1/tokens/${encodeURIComponent(address)}/orders${qs ? `?${qs}` : ''}`;
    const res = await this.fetchWithApiKey(endpoint);
    return res.json();
  }

  /**
   * GET /api/v1/tokens/:address/comments — comments for a token (via API key).
   */
  async getTokenComments(
    address: string,
    options: { page?: number; limit?: number } = {},
  ): Promise<{ data: Comment[]; pagination: Pagination }> {
    const params = new URLSearchParams();
    if (options.page !== undefined) params.set('page', String(options.page));
    if (options.limit !== undefined) params.set('limit', String(options.limit));

    const qs = params.toString();
    const endpoint = `/api/v1/tokens/${encodeURIComponent(address)}/comments${qs ? `?${qs}` : ''}`;
    const res = await this.fetchWithApiKey(endpoint);
    return res.json();
  }

  /**
   * GET /api/v1/tokens/:address/whitelist — whitelist data for a token.
   */
  async getWhitelist(
    address: string,
    options: { wallet?: string; page?: number; limit?: number } = {},
  ): Promise<{ data: WhitelistEntry[]; pagination?: Pagination }> {
    const params = new URLSearchParams();
    if (options.wallet !== undefined) params.set('wallet', options.wallet);
    if (options.page !== undefined) params.set('page', String(options.page));
    if (options.limit !== undefined) params.set('limit', String(options.limit));

    const qs = params.toString();
    const endpoint = `/api/v1/tokens/${encodeURIComponent(address)}/whitelist${qs ? `?${qs}` : ''}`;
    const res = await this.fetchWithApiKey(endpoint);
    return res.json();
  }

  /**
   * GET /api/v1/wallet/:address/transactions — transaction history for a wallet.
   */
  async getWalletTransactions(
    address: string,
    options: { cursor?: string; limit?: number; type?: string } = {},
  ): Promise<{ data: WalletTransaction[]; pagination: CursorPagination }> {
    const params = new URLSearchParams();
    if (options.cursor !== undefined) params.set('cursor', options.cursor);
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.type !== undefined) params.set('type', options.type);

    const qs = params.toString();
    const endpoint = `/api/v1/wallet/${encodeURIComponent(address)}/transactions${qs ? `?${qs}` : ''}`;
    const res = await this.fetchWithApiKey(endpoint);
    return res.json();
  }

  /**
   * GET /api/v1/markets/:address/liquidity — liquidity events for a prediction market.
   */
  async getMarketLiquidity(
    address: string,
    options: { cursor?: string; limit?: number; outcomeId?: string } = {},
  ): Promise<{ data: LiquidityEntry[]; pagination: CursorPagination }> {
    const params = new URLSearchParams();
    if (options.cursor !== undefined) params.set('cursor', options.cursor);
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.outcomeId !== undefined) params.set('outcomeId', options.outcomeId);

    const qs = params.toString();
    const endpoint = `/api/v1/markets/${encodeURIComponent(address)}/liquidity${qs ? `?${qs}` : ''}`;
    const res = await this.fetchWithApiKey(endpoint);
    return res.json();
  }

  /**
   * POST /api/v1/orders/sync — sync an on-chain order event to the database.
   * Call after listOrder, cancelOrder, or buyOrder transactions.
   * Accepts either session cookie or API key for auth.
   */
  async syncOrder(
    txHash: string,
    marketType: string = 'public',
  ): Promise<{ success: boolean; message: string }> {
    const body = JSON.stringify({ txHash, marketType });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    // Prefer API key, fall back to session
    const apiKey = this.client.apiKey;
    const cookie = this.client.sessionCookie;

    if (apiKey) {
      const url = `${this.client.apiDomain}/api/v1/orders/sync`;
      headers['X-API-Key'] = apiKey;
      const res = await fetch(url, { method: 'POST', headers, body });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`Order sync failed [${res.status}]: ${errBody}`);
      }
      return res.json();
    } else if (cookie) {
      const res = await this.fetchWithSession('/api/v1/orders/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      return res.json();
    } else {
      throw new Error('syncOrder requires either an API key or session cookie.');
    }
  }

  // -----------------------------------------------------------------------
  // Platform Pulse (public, no auth required)
  // -----------------------------------------------------------------------

  /**
   * GET /api/pulse — live platform statistics.
   * No authentication required. Cached for 60 seconds.
   */
  async getPulse(): Promise<{
    phase: string;
    chain: string;
    currency: string;
    stats: {
      agents: number;
      tokens: number;
      predictionMarkets: number;
      trades24h: number;
      uniqueTraders24h: number;
      totalLoans: number;
      activeLoans: number;
      vaultEvents: number;
      leaderboardParticipants: number;
    };
    timestamp: string;
  }> {
    const url = `${this.client.apiDomain}/api/pulse`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Pulse failed [${res.status}]: ${body}`);
    }
    return res.json();
  }

  // -----------------------------------------------------------------------
  // Leaderboard (public, no auth required)
  // -----------------------------------------------------------------------

  async getLeaderboard(options?: { page?: number; limit?: number }): Promise<{
    data: Array<{
      rank: number;
      wallet: string;
      username: string | null;
      avatarUrl: string | null;
      tier: string;
      tierEmoji: string;
      socials: Array<{ platform: string; handle: string; url: string }>;
    }>;
    pagination: { total: number; page: number; limit: number; pages: number };
  }> {
    const params = new URLSearchParams();
    if (options?.page != null) params.set('page', String(options.page));
    if (options?.limit != null) params.set('limit', String(options.limit));
    const qs = params.toString();
    const url = `${this.client.apiDomain}/api/v1/leaderboard${qs ? `?${qs}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Leaderboard failed [${res.status}]: ${body}`);
    }
    return res.json();
  }

  // -----------------------------------------------------------------------
  // Public profile (public, no auth required)
  // -----------------------------------------------------------------------

  async getPublicProfile(wallet: string): Promise<{
    wallet: string;
    username: string | null;
    avatarUrl: string | null;
    tier: string;
    tierEmoji: string;
    rank: number;
    acsScore: number;
    socials: Array<{ platform: string; handle: string; url: string }>;
    xHandle: string | null;
    stale: boolean;
    lastUpdated: string;
  }> {
    const url = `${this.client.apiDomain}/api/v1/profile/${wallet}`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Public profile failed [${res.status}]: ${body}`);
    }
    return res.json();
  }

  async getPublicProfileReferrals(wallet: string): Promise<{
    wallet: string;
    hasReferrer: boolean;
    directReferrals: number;
    indirectReferrals: number;
    totalReferrals: number;
  }> {
    const res = await this.fetchWithAuth(`/api/v1/profile/${wallet}/referrals`);
    return res.json();
  }

  // -----------------------------------------------------------------------
  // Transaction sync (public, no auth required)
  // -----------------------------------------------------------------------

  /**
   * POST /api/v1/sync — sync an on-chain transaction to the database.
   * Handles all event types: trades, loans, vault staking, vesting,
   * prediction markets, resolver events, and more.
   * No authentication required (public on-chain data). Rate limited to 20 req/min.
   * Idempotent — submitting the same txHash twice is safe.
   */
  async syncTransaction(
    txHash: string,
  ): Promise<{ success: boolean; events?: unknown[]; loan?: Record<string, unknown>; error?: string }> {
    const url = `${this.client.apiDomain}/api/v1/sync`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txHash }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Sync failed [${res.status}]: ${body}`);
    }
    return res.json();
  }

  /**
   * POST /api/v1/sync/faucet — sync a faucet claim transaction for referral tracking.
   * No authentication required. Rate limited to 20 req/min.
   */
  async syncFaucet(
    txHash: string,
  ): Promise<{ success: boolean; events?: { faucetClaimed?: boolean; referrerSet?: boolean }; error?: string }> {
    const url = `${this.client.apiDomain}/api/v1/sync/faucet`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txHash }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Faucet sync failed [${res.status}]: ${body}`);
    }
    return res.json();
  }

  /** @deprecated Use syncTransaction() instead */
  async syncLoan(txHash: string) {
    return this.syncTransaction(txHash);
  }

  // -----------------------------------------------------------------------
  // Loans, Vault & Vesting read endpoints (session or API key)
  // -----------------------------------------------------------------------

  /**
   * Internal helper: fetch with API key or session cookie.
   */
  private async fetchWithAuth(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<Response> {
    const apiKey = this.client.apiKey;
    const cookie = this.client.sessionCookie;
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string> | undefined),
    };

    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    } else if (cookie) {
      headers['Cookie'] = cookie;
    } else {
      throw new Error('Authentication required (API key or session cookie).');
    }

    const url = this.buildUrl(endpoint);
    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`API request failed [${res.status}] ${res.statusText}: ${body}`);
    }
    return res;
  }

  /**
   * GET /api/v1/loans — list loans for the authenticated wallet.
   */
  async getLoans(options: {
    source?: string;
    active?: boolean;
    page?: number;
    limit?: number;
  } = {}): Promise<{ data: unknown[]; pagination: Pagination }> {
    const params = new URLSearchParams();
    if (options.source !== undefined) params.set('source', options.source);
    if (options.active !== undefined) params.set('active', String(options.active));
    if (options.page !== undefined) params.set('page', String(options.page));
    if (options.limit !== undefined) params.set('limit', String(options.limit));

    const qs = params.toString();
    const endpoint = `/api/v1/loans${qs ? `?${qs}` : ''}`;
    const res = await this.fetchWithAuth(endpoint);
    return res.json();
  }

  /**
   * GET /api/v1/loans/events — list loan lifecycle events for the authenticated wallet.
   */
  async getLoanEvents(options: {
    source?: string;
    action?: string;
    page?: number;
    limit?: number;
  } = {}): Promise<{ data: unknown[]; pagination: Pagination }> {
    const params = new URLSearchParams();
    if (options.source !== undefined) params.set('source', options.source);
    if (options.action !== undefined) params.set('action', options.action);
    if (options.page !== undefined) params.set('page', String(options.page));
    if (options.limit !== undefined) params.set('limit', String(options.limit));

    const qs = params.toString();
    const endpoint = `/api/v1/loans/events${qs ? `?${qs}` : ''}`;
    const res = await this.fetchWithAuth(endpoint);
    return res.json();
  }

  /**
   * GET /api/v1/vault/events — list vault staking events for the authenticated wallet.
   */
  async getVaultEvents(options: {
    action?: string;
    page?: number;
    limit?: number;
  } = {}): Promise<{ data: unknown[]; pagination: Pagination }> {
    const params = new URLSearchParams();
    if (options.action !== undefined) params.set('action', options.action);
    if (options.page !== undefined) params.set('page', String(options.page));
    if (options.limit !== undefined) params.set('limit', String(options.limit));

    const qs = params.toString();
    const endpoint = `/api/v1/vault/events${qs ? `?${qs}` : ''}`;
    const res = await this.fetchWithAuth(endpoint);
    return res.json();
  }

  /**
   * GET /api/v1/vesting/events — list vesting events for the authenticated wallet.
   */
  async getVestingEvents(options: {
    action?: string;
    vestingId?: number;
    page?: number;
    limit?: number;
  } = {}): Promise<{ data: unknown[]; pagination: Pagination }> {
    const params = new URLSearchParams();
    if (options.action !== undefined) params.set('action', options.action);
    if (options.vestingId !== undefined) params.set('vestingId', String(options.vestingId));
    if (options.page !== undefined) params.set('page', String(options.page));
    if (options.limit !== undefined) params.set('limit', String(options.limit));

    const qs = params.toString();
    const endpoint = `/api/v1/vesting/events${qs ? `?${qs}` : ''}`;
    const res = await this.fetchWithAuth(endpoint);
    return res.json();
  }

  /**
   * GET /api/v1/markets/events — list prediction market resolution events
   * for the authenticated wallet (proposals, disputes, votes, vetos, etc.).
   */
  async getMarketEvents(options: {
    action?: string;
    marketToken?: string;
    page?: number;
    limit?: number;
  } = {}): Promise<{ data: unknown[]; pagination: Pagination }> {
    const params = new URLSearchParams();
    if (options.action !== undefined) params.set('action', options.action);
    if (options.marketToken !== undefined) params.set('marketToken', options.marketToken);
    if (options.page !== undefined) params.set('page', String(options.page));
    if (options.limit !== undefined) params.set('limit', String(options.limit));

    const qs = params.toString();
    const endpoint = `/api/v1/markets/events${qs ? `?${qs}` : ''}`;
    const res = await this.fetchWithAuth(endpoint);
    return res.json();
  }

  // -----------------------------------------------------------------------
  // Twitter / X Verification
  // -----------------------------------------------------------------------

  /**
   * POST /api/auth/twitter/challenge — request a verification code.
   * Returns a code to include in a tweet and a pre-built tweet template.
   */
  async requestTwitterChallenge(): Promise<{
    code: string;
    expiresAt: string;
    expiresIn: number;
    tweetTemplate: string;
  }> {
    const apiKey = this.client.apiKey;
    const cookie = this.client.sessionCookie;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['X-API-Key'] = apiKey;
    else if (cookie) headers['Cookie'] = cookie;
    else throw new Error('Twitter challenge requires authentication (API key or session).');

    const url = `${this.client.apiDomain}/api/auth/twitter/challenge`;
    const res = await fetch(url, { method: 'POST', headers });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Twitter challenge failed [${res.status}]: ${body}`);
    }
    return res.json();
  }

  /**
   * POST /api/auth/twitter/verify-tweet — verify a tweet containing the challenge code.
   * Links the X account to the authenticated wallet.
   */
  async verifyTwitter(tweetUrl: string): Promise<{
    success: boolean;
    method: string;
    username: string;
    displayName: string;
    tweetId: string;
  }> {
    const apiKey = this.client.apiKey;
    const cookie = this.client.sessionCookie;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['X-API-Key'] = apiKey;
    else if (cookie) headers['Cookie'] = cookie;
    else throw new Error('Twitter verification requires authentication (API key or session).');

    const url = `${this.client.apiDomain}/api/auth/twitter/verify-tweet`;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tweetUrl }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Twitter verification failed [${res.status}]: ${body}`);
    }
    return res.json();
  }

  // -----------------------------------------------------------------------
  // Social Activity (tweet verification for points)
  // -----------------------------------------------------------------------

  /**
   * POST /api/v1/social/verify-tweet — submit a tweet for points verification.
   * Tweet must tag @LaunchOnBasis, be public, and be authored by the linked X account.
   * Max 3 attempts per day per wallet.
   */
  async verifySocialTweet(tweetUrl: string): Promise<{
    success: boolean;
    activity: {
      id: number;
      tweetId: string;
      username: string;
      verified: boolean;
      createdAt: string;
    };
  }> {
    const res = await this.fetchWithAuth('/api/v1/social/verify-tweet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tweetUrl }),
    });
    return res.json();
  }

  /**
   * GET /api/v1/social/verified-tweets — list verified tweets for the authenticated wallet.
   */
  async getVerifiedTweets(): Promise<{
    tweets: Array<{
      tweetId: string;
      tweetUrl: string;
      username: string;
      tweetText: string;
      verified: boolean;
      createdAt: string;
    }>;
  }> {
    const res = await this.fetchWithAuth('/api/v1/social/verified-tweets');
    return res.json();
  }

  // -----------------------------------------------------------------------
  // Bug Reports
  // -----------------------------------------------------------------------

  /**
   * POST /api/v1/bugs/reports — submit a bug report.
   * Max 5 per day per wallet. Blocked wallets get 403.
   *
   * Validation:
   * - title: required, max 200 chars
   * - description: required, max 5000 chars
   * - severity: required, one of 'critical' | 'high' | 'medium' | 'low'
   * - category: required, one of 'sdk' | 'contracts' | 'api' | 'frontend' | 'docs'
   * - evidence: optional, max 1000 chars, must be https:// URL or tx hash (0x + 64 hex)
   */
  async submitBugReport(report: {
    title: string;
    description: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    category: 'sdk' | 'contracts' | 'api' | 'frontend' | 'docs';
    evidence?: string;
  }): Promise<{ success: boolean; report: Record<string, unknown> }> {
    const res = await this.fetchWithAuth('/api/v1/bugs/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    });
    return res.json();
  }

  /**
   * GET /api/v1/bugs/reports — list bug reports for the authenticated wallet.
   * Admins can filter by wallet.
   */
  async getBugReports(options: {
    status?: 'pending' | 'verified' | 'duplicate' | 'invalid';
    wallet?: string;
    page?: number;
    limit?: number;
  } = {}): Promise<{ data: unknown[]; pagination: Pagination }> {
    const params = new URLSearchParams();
    if (options.status !== undefined) params.set('status', options.status);
    if (options.wallet !== undefined) params.set('wallet', options.wallet);
    if (options.page !== undefined) params.set('page', String(options.page));
    if (options.limit !== undefined) params.set('limit', String(options.limit));

    const qs = params.toString();
    const endpoint = `/api/v1/bugs/reports${qs ? `?${qs}` : ''}`;
    const res = await this.fetchWithAuth(endpoint);
    return res.json();
  }

  // -----------------------------------------------------------------------
  // Me
  // -----------------------------------------------------------------------

  /**
   * GET /api/v1/me/stats — wallet activity statistics for the authenticated user.
   * Returns trade counts, prediction market activity, token/market creation counts,
   * loan info, and agent identity.
   */
  async getMyStats(): Promise<MyStats> {
    const res = await this.fetchWithAuth('/api/v1/me/stats');
    return res.json();
  }

  /**
   * GET /api/v1/me/projects — tokens and prediction markets created by the
   * authenticated user. Both lists are ordered by creation date descending.
   */
  async getMyProjects(): Promise<MyProjects> {
    const res = await this.fetchWithAuth('/api/v1/me/projects');
    return res.json();
  }

  /**
   * GET /api/v1/me/profile — full profile for the authenticated wallet,
   * including private socials, tier, leaderboard rank, and linked X account.
   * If `stale: true`, a background recompute has been triggered — poll again
   * in ~10-15 seconds for fresh data.
   */
  async getMyProfile(): Promise<MyProfile> {
    const res = await this.fetchWithAuth('/api/v1/me/profile');
    return res.json();
  }

  /**
   * POST /api/v1/me/profile — update profile fields. Each request performs
   * one action based on which key is present in the body:
   * - `{ username }` — set or clear username
   * - `{ social: { platform, handle } }` — link a social account
   * - `{ removeSocial: platform }` — unlink a social account
   * - `{ toggleSocialPublic: platform }` — flip public/private on a social
   */
  async updateMyProfile(payload: UpdateProfilePayload): Promise<UpdateProfileResult> {
    const res = await this.fetchWithAuth('/api/v1/me/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.json();
  }

  /**
   * GET /api/v1/me/referrals — referral overview for the authenticated user.
   * Returns who referred you, your tier rate, and direct + indirect referrals
   * sorted by rank.
   */
  async getMyReferrals(): Promise<MyReferrals> {
    const res = await this.fetchWithAuth('/api/v1/me/referrals');
    return res.json();
  }

  // -----------------------------------------------------------------------
  // Reef — public reads (no auth required)
  // -----------------------------------------------------------------------

  /** GET /api/reef/feed — paginated social feed. */
  async getReefFeed(options?: {
    section?: string;
    sort?: string;
    period?: string;
    q?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ data: unknown[]; pagination: { total: number; limit: number; offset: number } }> {
    const params = new URLSearchParams();
    if (options?.section) params.set('section', options.section);
    if (options?.sort) params.set('sort', options.sort);
    if (options?.period) params.set('period', options.period);
    if (options?.q) params.set('q', options.q);
    if (options?.limit != null) params.set('limit', String(options.limit));
    if (options?.offset != null) params.set('offset', String(options.offset));
    const qs = params.toString();
    const url = `${this.client.apiDomain}/api/reef/feed${qs ? `?${qs}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Reef feed failed [${res.status}]: ${body}`);
    }
    return res.json();
  }

  /** GET /api/reef/feed/{wallet} — posts by a specific wallet. */
  async getReefFeedByWallet(wallet: string, options?: {
    section?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ data: unknown[]; pagination: { total: number; limit: number; offset: number } }> {
    const params = new URLSearchParams();
    if (options?.section) params.set('section', options.section);
    if (options?.limit != null) params.set('limit', String(options.limit));
    if (options?.offset != null) params.set('offset', String(options.offset));
    const qs = params.toString();
    const url = `${this.client.apiDomain}/api/reef/feed/${wallet}${qs ? `?${qs}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Reef feed by wallet failed [${res.status}]: ${body}`);
    }
    return res.json();
  }

  /** GET /api/reef/post/{postId} — single post with comments. */
  async getReefPost(postId: string): Promise<{ post: unknown; comments: unknown[] }> {
    const url = `${this.client.apiDomain}/api/reef/post/${encodeURIComponent(postId)}`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Reef post failed [${res.status}]: ${body}`);
    }
    return res.json();
  }

  /** GET /api/reef/highlights — top 10 posts by score in last 24h. */
  async getReefHighlights(section?: string): Promise<{ data: unknown[] }> {
    const params = new URLSearchParams();
    if (section) params.set('section', section);
    const qs = params.toString();
    const url = `${this.client.apiDomain}/api/reef/highlights${qs ? `?${qs}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Reef highlights failed [${res.status}]: ${body}`);
    }
    return res.json();
  }

  // -----------------------------------------------------------------------
  // Reef — authenticated endpoints (session or API key)
  // -----------------------------------------------------------------------

  /** POST /api/reef/post — create a new Reef post. */
  async createReefPost(options: {
    section: string;
    title: string;
    body?: string;
  }): Promise<{ success: boolean; post: Record<string, unknown> }> {
    const res = await this.fetchWithAuth('/api/reef/post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
    return res.json();
  }

  /** PATCH /api/reef/post/{postId}/manage — edit your own post. */
  async editReefPost(
    postId: string,
    options: { title?: string; body?: string },
  ): Promise<{ success: boolean; post: Record<string, unknown> }> {
    const res = await this.fetchWithAuth(
      `/api/reef/post/${encodeURIComponent(postId)}/manage`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options),
      },
    );
    return res.json();
  }

  /** DELETE /api/reef/post/{postId}/manage — soft-delete a post. */
  async deleteReefPost(
    postId: string,
  ): Promise<{ success: boolean; message: string }> {
    const res = await this.fetchWithAuth(
      `/api/reef/post/${encodeURIComponent(postId)}/manage`,
      { method: 'DELETE' },
    );
    return res.json();
  }

  /** POST /api/reef/post/{postId}/comment — add a comment to a post. */
  async createReefComment(
    postId: string,
    message: string,
    parentId?: string,
  ): Promise<{ success: boolean; comment: Record<string, unknown> }> {
    const payload: Record<string, string> = { message };
    if (parentId !== undefined) payload.parentId = parentId;

    const res = await this.fetchWithAuth(
      `/api/reef/post/${encodeURIComponent(postId)}/comment`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );
    return res.json();
  }

  /** PATCH /api/reef/comment/{commentId}/manage — edit your own comment. */
  async editReefComment(
    commentId: string,
    message: string,
  ): Promise<{ success: boolean; comment: Record<string, unknown> }> {
    const res = await this.fetchWithAuth(
      `/api/reef/comment/${encodeURIComponent(commentId)}/manage`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      },
    );
    return res.json();
  }

  /** DELETE /api/reef/comment/{commentId}/manage — soft-delete a comment. */
  async deleteReefComment(
    commentId: string,
  ): Promise<{ success: boolean; message: string }> {
    const res = await this.fetchWithAuth(
      `/api/reef/comment/${encodeURIComponent(commentId)}/manage`,
      { method: 'DELETE' },
    );
    return res.json();
  }

  /** POST /api/reef/vote/{postId} — toggle upvote on a post. */
  async voteReefPost(
    postId: string,
  ): Promise<{ success: boolean; newScore: number; voted: boolean }> {
    const res = await this.fetchWithAuth(
      `/api/reef/vote/${encodeURIComponent(postId)}`,
      { method: 'POST' },
    );
    return res.json();
  }

  /** POST /api/reef/vote/comment/{commentId} — toggle upvote on a comment. */
  async voteReefComment(
    commentId: string,
  ): Promise<{ success: boolean; newScore: number; voted: boolean }> {
    const res = await this.fetchWithAuth(
      `/api/reef/vote/comment/${encodeURIComponent(commentId)}`,
      { method: 'POST' },
    );
    return res.json();
  }

  /** GET /api/reef/votes — check which posts/comments the user has voted on. */
  async getReefVotes(options: {
    postIds?: string;
    commentIds?: string;
  } = {}): Promise<{ votedPostIds: string[]; votedCommentIds: string[] }> {
    const params = new URLSearchParams();
    if (options.postIds !== undefined) params.set('postIds', options.postIds);
    if (options.commentIds !== undefined) params.set('commentIds', options.commentIds);

    const qs = params.toString();
    const endpoint = `/api/reef/votes${qs ? `?${qs}` : ''}`;
    const res = await this.fetchWithAuth(endpoint);
    return res.json();
  }

  /** POST /api/reef/report/{postId} — report a post for moderation. */
  async reportReefPost(
    postId: string,
    reason?: string,
  ): Promise<{ success: boolean; reportCount: number }> {
    const payload: Record<string, string> = {};
    if (reason !== undefined) payload.reason = reason;

    const res = await this.fetchWithAuth(
      `/api/reef/report/${encodeURIComponent(postId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );
    return res.json();
  }
}
