import * as viem from 'viem';
import { Address, PublicClient, WalletClient } from 'viem';

interface Pagination {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
}
interface CursorPagination {
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
}
interface Token {
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
    predictionOptions?: Array<{
        index: number;
        name: string;
    }>;
    [key: string]: unknown;
}
interface Candle {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
}
interface Trade {
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
interface Order {
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
interface Comment {
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
interface ApiKeyInfo {
    id: string;
    key: string;
    label: string;
    createdAt: string;
    lastUsedAt?: string;
}
interface MetadataPayload {
    address: string;
    description?: string;
    website?: string;
    telegram?: string;
    twitterx?: string;
    image?: string;
}
interface ProjectUpdatePayload {
    [key: string]: unknown;
}
interface LiquidityEntry {
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
interface WalletTransaction {
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
interface WhitelistEntry {
    walletAddress: string;
    buyAmount: string;
    note: string | null;
    txHash: string;
    timestamp: string;
    [key: string]: unknown;
}
interface MyStats {
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
    agent: {
        agentId: number;
        name: string;
    } | null;
}
interface MyProjectItem {
    address: string;
    name: string;
    symbol: string;
    image: string;
    createdAt: string;
}
interface MyProjects {
    tokens: MyProjectItem[];
    markets: MyProjectItem[];
}
interface MySocial {
    platform: string;
    handle: string;
    url: string | null;
    isPublic: boolean;
}
interface MyXAccount {
    username: string;
    displayName: string;
    profileImage: string;
    isPublic: boolean;
}
interface MyProfile {
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
interface UpdateProfilePayload {
    username?: string | null;
    social?: {
        platform: string;
        handle: string;
    };
    removeSocial?: string;
    toggleSocialPublic?: string;
}
interface UpdateProfileResult {
    success: boolean;
    action: string;
    [key: string]: unknown;
}
interface ReferralUser {
    wallet: string;
    username: string | null;
    tier: string;
    tierEmoji: string;
    rank: number;
    joinedAt?: string;
    layer?: number;
}
interface MyReferrals {
    referrer: ReferralUser | null;
    tier: string;
    tierEmoji: string;
    directCount: number;
    indirectCount: number;
    referrals: ReferralUser[];
}
declare class BasisAPI {
    private client;
    constructor(client: BasisClient);
    /**
     * Fetch helper that attaches the session cookie for endpoints requiring
     * an authenticated session (auth, metadata, comments write, images, etc.).
     */
    private fetchWithSession;
    /**
     * Fetch helper that attaches the X-API-Key header for /api/v1 data endpoints.
     */
    private fetchWithApiKey;
    private buildUrl;
    /** GET /api/auth/me — get current session info. */
    getSession(address?: string): Promise<{
        isLoggedIn: boolean;
        address?: string;
        addresses?: string[];
        allAddresses?: string[];
    }>;
    /** DELETE /api/auth/me — log out a specific address. */
    logout(address: string): Promise<{
        ok: boolean;
        message: string;
    }>;
    /** POST /api/v1/auth/keys — create a new API key. */
    createApiKey(label: string): Promise<ApiKeyInfo>;
    /** GET /api/v1/auth/keys — list API keys for the session wallet. */
    listApiKeys(): Promise<{
        keys: ApiKeyInfo[];
    }>;
    /** DELETE /api/v1/auth/keys/:id — revoke an API key. */
    deleteApiKey(id: string): Promise<{
        ok: boolean;
        message: string;
    }>;
    /**
     * POST /api/images — upload an image file.
     *
     * Accepts Blob, Buffer, or a File-like object. Returns the hosted URL string.
     */
    uploadImage(file: Blob | Buffer, filename?: string): Promise<string>;
    /**
     * Downloads an image from a URL, resizes it to 512x512 (center-crop),
     * converts to WebP, and uploads it to IPFS via /api/images.
     *
     * Returns the hosted IPFS URL string.
     */
    uploadImageFromUrl(imageUrl: string, contractAddress?: string): Promise<string>;
    /**
     * POST /api/metadata — publish or update project metadata.
     * Requires session and the caller must be the token creator.
     */
    updateMetadata(payload: MetadataPayload): Promise<{
        url: string;
        cid: string;
    }>;
    /**
     * POST /api/projects/:address — update project info.
     * Accepts either a plain JSON payload or a payload with an image Blob/Buffer.
     */
    updateProject(address: string, payload: ProjectUpdatePayload, image?: Blob | Buffer, imageFilename?: string): Promise<{
        success: boolean;
        project: Record<string, unknown>;
    }>;
    /** GET /api/comments — list comments for a project. */
    getComments(projectId: number, options?: {
        page?: number;
        limit?: number;
    }): Promise<{
        data: Comment[];
        pagination: Pagination;
    }>;
    /** POST /api/comments — create a comment (session required). */
    createComment(projectId: number, content: string, authorAddress: string): Promise<Comment>;
    /** DELETE /api/comments — soft-delete a comment (session required). */
    deleteComment(commentId: number, authorAddress: string): Promise<{
        ok: boolean;
    }>;
    /**
     * GET /api/v1/tokens — list / search tokens.
     */
    getTokens(options?: {
        search?: string;
        isPrediction?: boolean;
        sort?: string;
        page?: number;
        limit?: number;
    }): Promise<{
        data: Token[];
        pagination: Pagination;
    }>;
    /** GET /api/v1/tokens/:address — get a single token's details. */
    getToken(address: string): Promise<{
        data: Token;
    }>;
    /**
     * GET /api/v1/tokens/:address/candles — OHLCV candle data.
     */
    getCandles(address: string, options?: {
        interval?: string;
        from?: string | number;
        to?: string | number;
        limit?: number;
    }): Promise<{
        data: Candle[];
        interval: string;
        count: number;
    }>;
    /**
     * GET /api/v1/tokens/:address/trades — trade history for a token.
     */
    getTrades(address: string, options?: {
        cursor?: string;
        limit?: number;
        type?: string;
    }): Promise<{
        data: Trade[];
        pagination: CursorPagination;
    }>;
    /**
     * GET /api/v1/tokens/:address/orders — order book entries for a token.
     */
    getOrders(address: string, options?: {
        status?: string;
        outcomeId?: string;
        page?: number;
        limit?: number;
    }): Promise<{
        data: Order[];
        pagination: Pagination;
    }>;
    /**
     * GET /api/v1/tokens/:address/comments — comments for a token (via API key).
     */
    getTokenComments(address: string, options?: {
        page?: number;
        limit?: number;
    }): Promise<{
        data: Comment[];
        pagination: Pagination;
    }>;
    /**
     * GET /api/v1/tokens/:address/whitelist — whitelist data for a token.
     */
    getWhitelist(address: string, options?: {
        wallet?: string;
        page?: number;
        limit?: number;
    }): Promise<{
        data: WhitelistEntry[];
        pagination?: Pagination;
    }>;
    /**
     * GET /api/v1/wallet/:address/transactions — transaction history for a wallet.
     */
    getWalletTransactions(address: string, options?: {
        cursor?: string;
        limit?: number;
        type?: string;
    }): Promise<{
        data: WalletTransaction[];
        pagination: CursorPagination;
    }>;
    /**
     * GET /api/v1/markets/:address/liquidity — liquidity events for a prediction market.
     */
    getMarketLiquidity(address: string, options?: {
        cursor?: string;
        limit?: number;
        outcomeId?: string;
    }): Promise<{
        data: LiquidityEntry[];
        pagination: CursorPagination;
    }>;
    /**
     * POST /api/v1/orders/sync — sync an on-chain order event to the database.
     * Call after listOrder, cancelOrder, or buyOrder transactions.
     * No authentication required (public endpoint).
     */
    syncOrder(txHash: string, marketType?: string): Promise<{
        success: boolean;
        message: string;
    }>;
    /**
     * GET /api/pulse — live platform statistics.
     * No authentication required. Cached for 60 seconds.
     */
    getPulse(): Promise<{
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
    }>;
    getLeaderboard(options?: {
        page?: number;
        limit?: number;
    }): Promise<{
        data: Array<{
            rank: number;
            wallet: string;
            username: string | null;
            avatarUrl: string | null;
            tier: string;
            tierEmoji: string;
            socials: Array<{
                platform: string;
                handle: string;
                url: string;
            }>;
        }>;
        pagination: {
            total: number;
            page: number;
            limit: number;
            pages: number;
        };
    }>;
    getPublicProfile(wallet: string): Promise<{
        wallet: string;
        username: string | null;
        avatarUrl: string | null;
        tier: string;
        tierEmoji: string;
        rank: number;
        acsScore: number;
        socials: Array<{
            platform: string;
            handle: string;
            url: string;
        }>;
        xHandle: string | null;
        stale: boolean;
        lastUpdated: string;
    }>;
    getPublicProfileReferrals(wallet: string): Promise<{
        wallet: string;
        hasReferrer: boolean;
        directReferrals: number;
        indirectReferrals: number;
        totalReferrals: number;
    }>;
    /**
     * POST /api/v1/sync — sync an on-chain transaction to the database.
     * Handles all event types: trades, loans, vault staking, vesting,
     * prediction markets, resolver events, and more.
     * No authentication required (public on-chain data). Rate limited to 20 req/min.
     * Idempotent — submitting the same txHash twice is safe.
     */
    syncTransaction(txHash: string): Promise<{
        success: boolean;
        events?: unknown[];
        loan?: Record<string, unknown>;
        error?: string;
    }>;
    /**
     * POST /api/v1/sync/faucet — sync a faucet claim transaction for referral tracking.
     * No authentication required. Rate limited to 20 req/min.
     */
    syncFaucet(txHash: string): Promise<{
        success: boolean;
        events?: {
            faucetClaimed?: boolean;
            referrerSet?: boolean;
        };
        error?: string;
    }>;
    /** @deprecated Use syncTransaction() instead */
    syncLoan(txHash: string): Promise<{
        success: boolean;
        events?: unknown[];
        loan?: Record<string, unknown>;
        error?: string;
    }>;
    /**
     * Internal helper: fetch with API key or session cookie.
     */
    private fetchWithAuth;
    /**
     * GET /api/v1/loans — list loans for the authenticated wallet.
     */
    getLoans(options?: {
        source?: string;
        active?: boolean;
        page?: number;
        limit?: number;
    }): Promise<{
        data: unknown[];
        pagination: Pagination;
    }>;
    /**
     * GET /api/v1/loans/events — list loan lifecycle events for the authenticated wallet.
     */
    getLoanEvents(options?: {
        source?: string;
        action?: string;
        page?: number;
        limit?: number;
    }): Promise<{
        data: unknown[];
        pagination: Pagination;
    }>;
    /**
     * GET /api/v1/vault/events — list vault staking events for the authenticated wallet.
     */
    getVaultEvents(options?: {
        action?: string;
        page?: number;
        limit?: number;
    }): Promise<{
        data: unknown[];
        pagination: Pagination;
    }>;
    /**
     * GET /api/v1/vesting/events — list vesting events for the authenticated wallet.
     */
    getVestingEvents(options?: {
        action?: string;
        vestingId?: number;
        page?: number;
        limit?: number;
    }): Promise<{
        data: unknown[];
        pagination: Pagination;
    }>;
    /**
     * GET /api/v1/markets/events — list prediction market resolution events
     * for the authenticated wallet (proposals, disputes, votes, vetos, etc.).
     */
    getMarketEvents(options?: {
        action?: string;
        marketToken?: string;
        page?: number;
        limit?: number;
    }): Promise<{
        data: unknown[];
        pagination: Pagination;
    }>;
    /**
     * POST /api/auth/twitter/challenge — request a verification code.
     * Returns a code to include in a tweet and a pre-built tweet template.
     */
    requestTwitterChallenge(): Promise<{
        code: string;
        expiresAt: string;
        expiresIn: number;
        tweetTemplate: string;
    }>;
    /**
     * POST /api/auth/twitter/verify-tweet — verify a tweet containing the challenge code.
     * Links the X account to the authenticated wallet.
     */
    verifyTwitter(tweetUrl: string): Promise<{
        success: boolean;
        method: string;
        username: string;
        displayName: string;
        tweetId: string;
    }>;
    /**
     * POST /api/v1/social/verify-tweet — submit a tweet for points verification.
     * Tweet must tag @LaunchOnBasis, be public, and be authored by the linked X account.
     * Max 3 attempts per day per wallet.
     */
    verifySocialTweet(tweetUrl: string): Promise<{
        success: boolean;
        activity: {
            id: number;
            tweetId: string;
            username: string;
            verified: boolean;
            createdAt: string;
        };
    }>;
    /**
     * GET /api/v1/social/verified-tweets — list verified tweets for the authenticated wallet.
     */
    getVerifiedTweets(): Promise<{
        tweets: Array<{
            tweetId: string;
            tweetUrl: string;
            username: string;
            tweetText: string;
            verified: boolean;
            createdAt: string;
        }>;
    }>;
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
    submitBugReport(report: {
        title: string;
        description: string;
        severity: 'critical' | 'high' | 'medium' | 'low';
        category: 'sdk' | 'contracts' | 'api' | 'frontend' | 'docs';
        evidence?: string;
    }): Promise<{
        success: boolean;
        report: Record<string, unknown>;
    }>;
    /**
     * GET /api/v1/bugs/reports — list bug reports for the authenticated wallet.
     * Admins can filter by wallet.
     */
    getBugReports(options?: {
        status?: 'pending' | 'verified' | 'duplicate' | 'invalid';
        wallet?: string;
        page?: number;
        limit?: number;
    }): Promise<{
        data: unknown[];
        pagination: Pagination;
    }>;
    /**
     * GET /api/v1/me/stats — wallet activity statistics for the authenticated user.
     * Returns trade counts, prediction market activity, token/market creation counts,
     * loan info, and agent identity.
     */
    getMyStats(): Promise<MyStats>;
    /**
     * GET /api/v1/me/projects — tokens and prediction markets created by the
     * authenticated user. Both lists are ordered by creation date descending.
     */
    getMyProjects(): Promise<MyProjects>;
    /**
     * GET /api/v1/me/profile — full profile for the authenticated wallet,
     * including private socials, tier, leaderboard rank, and linked X account.
     * If `stale: true`, a background recompute has been triggered — poll again
     * in ~10-15 seconds for fresh data.
     */
    getMyProfile(): Promise<MyProfile>;
    /**
     * POST /api/v1/me/profile — update profile fields. Each request performs
     * one action based on which key is present in the body:
     * - `{ username }` — set or clear username
     * - `{ social: { platform, handle } }` — link a social account
     * - `{ removeSocial: platform }` — unlink a social account
     * - `{ toggleSocialPublic: platform }` — flip public/private on a social
     */
    updateMyProfile(payload: UpdateProfilePayload): Promise<UpdateProfileResult>;
    /**
     * GET /api/v1/me/referrals — referral overview for the authenticated user.
     * Returns who referred you, your tier rate, and direct + indirect referrals
     * sorted by rank.
     */
    getMyReferrals(): Promise<MyReferrals>;
    /** GET /api/reef/feed — paginated social feed. */
    getReefFeed(options?: {
        section?: string;
        sort?: string;
        period?: string;
        q?: string;
        limit?: number;
        offset?: number;
    }): Promise<{
        data: unknown[];
        pagination: {
            total: number;
            limit: number;
            offset: number;
        };
    }>;
    /** GET /api/reef/feed/{wallet} — posts by a specific wallet. */
    getReefFeedByWallet(wallet: string, options?: {
        section?: string;
        limit?: number;
        offset?: number;
    }): Promise<{
        data: unknown[];
        pagination: {
            total: number;
            limit: number;
            offset: number;
        };
    }>;
    /** GET /api/reef/post/{postId} — single post with comments. */
    getReefPost(postId: string): Promise<{
        post: unknown;
        comments: unknown[];
    }>;
    /** GET /api/reef/highlights — top 10 posts by score in last 24h. */
    getReefHighlights(section?: string): Promise<{
        data: unknown[];
    }>;
    /** POST /api/reef/post — create a new Reef post. */
    createReefPost(options: {
        section: string;
        title: string;
        body?: string;
    }): Promise<{
        success: boolean;
        post: Record<string, unknown>;
    }>;
    /** PATCH /api/reef/post/{postId}/manage — edit your own post. */
    editReefPost(postId: string, options: {
        title?: string;
        body?: string;
    }): Promise<{
        success: boolean;
        post: Record<string, unknown>;
    }>;
    /** DELETE /api/reef/post/{postId}/manage — soft-delete a post. */
    deleteReefPost(postId: string): Promise<{
        success: boolean;
        message: string;
    }>;
    /** POST /api/reef/post/{postId}/comment — add a comment to a post. */
    createReefComment(postId: string, message: string, parentId?: string): Promise<{
        success: boolean;
        comment: Record<string, unknown>;
    }>;
    /** PATCH /api/reef/comment/{commentId}/manage — edit your own comment. */
    editReefComment(commentId: string, message: string): Promise<{
        success: boolean;
        comment: Record<string, unknown>;
    }>;
    /** DELETE /api/reef/comment/{commentId}/manage — soft-delete a comment. */
    deleteReefComment(commentId: string): Promise<{
        success: boolean;
        message: string;
    }>;
    /** POST /api/reef/vote/{postId} — toggle upvote on a post. */
    voteReefPost(postId: string): Promise<{
        success: boolean;
        newScore: number;
        voted: boolean;
    }>;
    /** POST /api/reef/vote/comment/{commentId} — toggle upvote on a comment. */
    voteReefComment(commentId: string): Promise<{
        success: boolean;
        newScore: number;
        voted: boolean;
    }>;
    /** GET /api/reef/votes — check which posts/comments the user has voted on. */
    getReefVotes(options?: {
        postIds?: string;
        commentIds?: string;
    }): Promise<{
        votedPostIds: string[];
        votedCommentIds: string[];
    }>;
    /** POST /api/reef/report/{postId} — report a post for moderation. */
    reportReefPost(postId: string, reason?: string): Promise<{
        success: boolean;
        reportCount: number;
    }>;
}

declare class FactoryModule {
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
        website?: string;
        telegram?: string;
        twitterx?: string;
    }): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
        tokenAddress: `0x${string}`;
        imageUrl: string | undefined;
        metadata: {
            url: string;
            cid: string;
        };
    }>;
    disableFreeze(tokenAddress: Address): Promise<viem.TransactionReceipt>;
    setWhitelistedWallet(tokenAddress: Address, wallets: Address[], amount: bigint, tag: string): Promise<viem.TransactionReceipt>;
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
        receipt: viem.TransactionReceipt;
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
    removeWhitelist(tokenAddress: Address, wallet: Address): Promise<viem.TransactionReceipt>;
}

declare class TradingModule {
    private client;
    private swapAddress;
    constructor(client: BasisClient, swapAddress: Address);
    private _syncTx;
    /**
     * Automatically approves the token to be spent by the SWAP contract.
     * Internal helper function.
     */
    private approveIfNeeded;
    /**
     * Buys tokens during the bonding curve phase.
     * Calls buyTokens on SWAP.sol.
     */
    buyBondingTokens(amount: bigint, minOut: bigint, path: Address[], wrapTokens: boolean): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Sells tokens during the bonding curve phase.
     * Calls sellTokens on SWAP.sol.
     */
    sellBondingTokens(amount: bigint, minOut: bigint, path: Address[], swapToETH: boolean): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * General buy tokens function.
     */
    buyTokens(amount: bigint, minOut: bigint, path: Address[], wrapTokens: boolean): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * General sell tokens function.
     */
    sellTokens(amount: bigint, minOut: bigint, path: Address[], swapToETH: boolean): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Simplified buy: purchases the target token using USDB.
     * Automatically builds the correct swap path.
     */
    buy(tokenAddress: Address, usdbAmount: bigint, minOut?: bigint, wrapTokens?: boolean): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Simplified sell: sells a token.
     * For factory tokens, set toUsdb=true to swap all the way to USDB (3-hop),
     * or false to stop at MAINTOKEN (2-hop). Ignored when selling MAINTOKEN.
     */
    sell(tokenAddress: Address, amount: bigint, toUsdb?: boolean, minOut?: bigint, swapToETH?: boolean): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    private buildBuyPath;
    private buildSellPath;
    /**
     * Leveraged buy: purchases tokens with leverage (creates a loan position).
     */
    leverageBuy(amount: bigint, minOut: bigint, path: Address[], numberOfDays: bigint): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Partially sells collateral from a loan/leverage position.
     * percentage must be divisible by 10 (10-100).
     */
    partialLoanSell(loanId: bigint, percentage: bigint, isLeverage: boolean, minOut: bigint): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Sells a percentage of the user's token balance.
     * percentage: 1-100
     */
    sellPercentage(tokenAddress: Address, percentage: number, toUsdb?: boolean, minOut?: bigint, swapToETH?: boolean): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Gets the leverage position count for a user from MAINTOKEN.
     */
    getLeverageCount(user: Address): Promise<bigint>;
    /**
     * Gets a specific leverage position from MAINTOKEN.
     */
    getLeveragePosition(user: Address, loanId: bigint): Promise<readonly [user: `0x${string}`, token: `0x${string}`, collateralAmount: bigint, bigint, bigint, bigint, bigint, bigint, boolean, active: boolean, bigint, bigint, leverage: {
        leverageBuyAmount: bigint;
        cashedOut: bigint;
    }]>;
    /**
     * Fetches the token price from the token's contract.
     */
    getTokenPrice(tokenAddress: Address): Promise<string>;
    /**
     * Fetches the USD price of the token from the token's contract.
     */
    getUSDPrice(tokenAddress: Address): Promise<string>;
    /**
     * Returns the expected output amounts for a given input amount and swap path.
     */
    getAmountsOut(amount: bigint, path: Address[]): Promise<bigint>;
}

declare class PredictionMarketsModule {
    private client;
    private marketTradingAddress;
    constructor(client: BasisClient, marketTradingAddress: Address);
    private _syncTx;
    /**
     * Helper to approve tokens for the MarketTrading contract
     */
    private approveIfNeeded;
    /**
     * Internal: creates a market on-chain. Use createMarketWithMetadata() instead.
     */
    private createMarket;
    /**
     * Creates a prediction market and registers its metadata on IPFS in one call.
     * Requires SIWE authentication.
     *
     * Returns { hash, receipt, marketTokenAddress, imageUrl, metadata }
     */
    createMarketWithMetadata(options: {
        marketName: string;
        symbol: string;
        endTime: bigint;
        optionNames: string[];
        maintoken: Address;
        frozen?: boolean;
        bonding?: bigint;
        seedAmount?: bigint;
        description?: string;
        imageUrl?: string;
        website?: string;
        telegram?: string;
        twitterx?: string;
    }): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
        marketTokenAddress: `0x${string}`;
        imageUrl: string | undefined;
        metadata: {
            url: string;
            cid: string;
        };
    }>;
    /**
     * Executes an AMM buy for a prediction outcome.
     */
    buy(marketToken: Address, outcomeId: number, inputToken: Address, inputAmount: bigint, minUsdb: bigint, minShares: bigint): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Claims winnings after a market resolves.
     */
    redeem(marketToken: Address): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Reads the MarketData struct.
     */
    getMarketData(marketToken: Address): Promise<unknown>;
    /**
     * Reads the Outcome struct.
     */
    getOutcome(marketToken: Address, outcomeId: number): Promise<unknown>;
    /**
     * Reads user balances.
     */
    getUserShares(marketToken: Address, user: Address, outcomeId: number): Promise<unknown>;
    /**
     * Returns the initial reserves required for a given number of outcomes.
     */
    getInitialReserves(numOutcomes: bigint): Promise<readonly [bigint, bigint]>;
    /**
     * Returns the number of outcomes for a market.
     */
    getNumOutcomes(marketToken: Address): Promise<bigint>;
    getOptionNames(marketToken: Address): Promise<string[]>;
    hasBettedOnMarket(marketToken: Address, user: Address): Promise<boolean>;
    getBountyPool(marketToken: Address): Promise<bigint>;
    getGeneralPot(marketToken: Address): Promise<bigint>;
    getBuyOrderAmountsOut(marketToken: Address, orderId: bigint, usdbAmount: bigint): Promise<unknown>;
    buyOrdersAndContract(marketToken: Address, outcomeId: number, orderIds: bigint[], inputToken: Address, totalInput: bigint, minShares: bigint): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
}

declare class OrderBookModule {
    private client;
    private marketTradingAddress;
    constructor(client: BasisClient, marketTradingAddress: Address);
    private approveUsdbIfNeeded;
    /**
     * Creates a limit order.
     */
    listOrder(marketToken: Address, outcomeId: number, amount: bigint, pricePerShare: bigint): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Cancels an active order.
     */
    cancelOrder(marketToken: Address, orderId: bigint): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Executes against a specific order.
     */
    buyOrder(marketToken: Address, orderId: bigint, fill: bigint): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Sweeps multiple orders.
     */
    buyMultipleOrders(marketToken: Address, orderIds: bigint[], usdbAmount: bigint): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Syncs an order transaction to the backend database.
     * Called automatically after listOrder, cancelOrder, buyOrder, buyMultipleOrders.
     */
    private syncOrder;
    /**
     * Retrieves exact cost including taxes before buying.
     */
    getBuyOrderCost(marketToken: Address, orderId: bigint, fill: bigint): Promise<unknown>;
    /**
     * Preview how many shares can be bought for a given USDB amount on a P2P order.
     */
    getBuyOrderAmountsOut(marketToken: Address, orderId: bigint, usdbAmount: bigint): Promise<unknown>;
}

declare class LoansModule {
    private client;
    private loanHubAddress;
    constructor(client: BasisClient, loanHubAddress: Address);
    private _syncTx;
    private approveIfNeeded;
    /**
     * Takes a loan. Auto-approves the collateral token to the LoanHub.
     */
    takeLoan(ecosystem: Address, collateral: Address, amount: bigint, daysCount: bigint): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Repays a loan to release collateral.
     * Auto-approves the borrowed token (USDB) to the LoanHub.
     */
    repayLoan(hubId: bigint): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Prolongs duration of a loan.
     * When payInStable is true, auto-approves USDB to the LoanHub.
     */
    extendLoan(hubId: bigint, addDays: bigint, payInStable: boolean, refinance: boolean): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Executes liquidation on a defaulted loan.
     */
    claimLiquidation(hubId: bigint): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Returns FullLoanDetails struct.
     */
    getUserLoanDetails(user: Address, hubId: bigint): Promise<unknown>;
    /**
     * Increases collateral on an existing loan.
     * Reads loan details to find the collateral token, then auto-approves it.
     */
    increaseLoan(hubId: bigint, amountToAdd: bigint): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Returns the number of loans a user has.
     */
    /**
     * Partially sell collateral from a hub loan position.
     */
    hubPartialLoanSell(hubId: bigint, percentage: bigint, isLeverage: boolean, minOut: bigint): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    getUserLoanCount(user: Address): Promise<bigint>;
}

declare class VestingModule {
    private client;
    private vestingAddress;
    constructor(client: BasisClient, vestingAddress: Address);
    private _syncTx;
    private approveIfNeeded;
    private getFeeAmount;
    /**
     * Creates a gradual vesting schedule.
     * Auto-approves the token to the vesting contract and attaches the creation fee.
     */
    createGradualVesting(beneficiary: Address, token: Address, totalAmount: bigint, startTime: bigint, durationInDays: bigint, timeUnit: number, memo: string, ecosystem: Address): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Creates a cliff vesting schedule.
     */
    createCliffVesting(beneficiary: Address, token: Address, totalAmount: bigint, unlockTime: bigint, memo: string, ecosystem: Address): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Claims unlocked tokens.
     */
    claimTokens(vestingId: bigint): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Leverages locked tokens for a loan.
     */
    takeLoanOnVesting(vestingId: bigint): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Repays a loan taken on a vesting schedule.
     * Auto-approves the borrowed token (USDB) to the vesting contract.
     */
    repayLoanOnVesting(vestingId: bigint): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Gets details of a specific vesting schedule.
     */
    getVestingDetails(vestingId: bigint): Promise<unknown>;
    /**
     * Gets the current claimable amount for a vesting schedule.
     */
    getClaimableAmount(vestingId: bigint): Promise<unknown>;
    /**
     * Creates gradual vesting schedules for multiple beneficiaries in a single transaction.
     * Auto-approves the sum of all amounts and attaches the creation fee.
     */
    batchCreateGradualVesting(beneficiaries: Address[], token: Address, totalAmounts: bigint[], userMemos: string[], startTime: bigint, durationInDays: bigint, timeUnit: number, ecosystem: Address): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Creates cliff vesting schedules for multiple beneficiaries in a single transaction.
     * Auto-approves the sum of all amounts and attaches the creation fee.
     */
    batchCreateCliffVesting(beneficiaries: Address[], token: Address, totalAmounts: bigint[], unlockTime: bigint, userMemos: string[], ecosystem: Address): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Changes the beneficiary of a vesting schedule.
     */
    changeBeneficiary(vestingId: bigint, newBeneficiary: Address): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Extends the vesting period by additional days.
     */
    extendVestingPeriod(vestingId: bigint, additionalDays: bigint): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Adds more tokens to an existing vesting schedule.
     * Auto-approves the token to the vesting contract.
     */
    addTokensToVesting(vestingId: bigint, additionalAmount: bigint): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Transfers the creator role of a vesting schedule to a new address.
     */
    transferCreatorRole(vestingId: bigint, newCreator: Address): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Returns all vesting IDs for a given beneficiary.
     */
    getVestingsByBeneficiary(beneficiary: Address): Promise<bigint[]>;
    /**
     * Returns the total vested amount for a vesting schedule.
     */
    getVestedAmount(vestingId: bigint): Promise<bigint>;
    /**
     * Returns the active loan ID for a vesting schedule.
     */
    getActiveLoan(vestingId: bigint): Promise<bigint>;
    /**
     * Returns vesting IDs for a given token within a specified index range.
     */
    getTokenVestingIds(token: Address, startIndex: bigint, endIndex: bigint): Promise<bigint[]>;
    /**
     * Returns vesting details for multiple vesting IDs in a single call.
     */
    getVestingDetailsBatch(vestingIds: bigint[]): Promise<unknown>;
    /**
     * Returns the total number of vesting schedules created.
     */
    getVestingCount(): Promise<bigint>;
    /**
     * Returns all vesting IDs created by a given creator.
     */
    getVestingsByCreator(creator: Address): Promise<bigint[]>;
}

declare class StakingModule {
    private client;
    private stakingAddress;
    constructor(client: BasisClient, stakingAddress: Address);
    private _syncTx;
    private approveIfNeeded;
    /**
     * Wraps STASIS (MAINTOKEN) into wSTASIS.
     * Approves the staking contract to spend MAINTOKEN if needed.
     */
    buy(amount: bigint): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Unwraps wSTASIS back to STASIS, optionally converting to USDB.
     */
    sell(shares: bigint, claimUSDB?: boolean, minUSDB?: bigint): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Locks wSTASIS as collateral for borrowing.
     */
    lock(shares: bigint): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Unlocks wSTASIS collateral.
     */
    unlock(shares: bigint): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Pledges STASIS as collateral and borrows USDB against it.
     * The stasisAmountToBorrow parameter is the STASIS amount to pledge — USDB received is collateral value minus fees.
     */
    borrow(stasisAmountToBorrow: bigint, days: bigint): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Repays the active staking loan. Auto-approves USDB to the staking contract.
     */
    repay(): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Extends the active staking loan.
     */
    extendLoan(daysToAdd: bigint, payInUSDB: boolean, refinance: boolean): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Gets staking details for a user.
     * Returns [liquidShares, lockedShares, totalShares, totalAssetValue].
     */
    getUserStakeDetails(user: Address): Promise<unknown>;
    /**
     * Gets the available STASIS (collateral value minus pledged).
     */
    getAvailableStasis(user: Address): Promise<bigint>;
    /**
     * Converts STASIS amount to wSTASIS shares.
     */
    convertToShares(assets: bigint): Promise<bigint>;
    /**
     * Converts wSTASIS shares to STASIS amount.
     */
    convertToAssets(shares: bigint): Promise<bigint>;
    /**
     * Returns total STASIS held by the vault (available + pledged).
     */
    totalAssets(): Promise<bigint>;
    /**
     * Borrows additional STASIS against locked wSTASIS collateral on an existing loan.
     */
    addToLoan(additionalStasisToBorrow: bigint): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Settles a liquidated staking loan position.
     */
    settleLiquidation(): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
}

declare class MarketResolverModule {
    private client;
    private resolverAddress;
    constructor(client: BasisClient, resolverAddress: Address);
    private _syncTx;
    private approveIfNeeded;
    /**
     * Proposes an outcome for a market.
     * Auto-approves USDB to the resolver for the PROPOSAL_BOND amount.
     */
    proposeOutcome(marketToken: Address, outcomeId: number): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Disputes a proposed outcome.
     * Auto-approves USDB to the resolver for the PROPOSAL_BOND amount.
     */
    dispute(marketToken: Address, newOutcomeId: number): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Casts a vote on a disputed market outcome.
     */
    vote(marketToken: Address, outcomeId: number): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Stakes tokens to become a resolver voter.
     * Auto-approves the token to the resolver for MIN_STAKE_AMOUNT.
     */
    stake(token: Address): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Unstakes tokens, removing resolver voter status.
     */
    unstake(token: Address): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Finalizes an uncontested market (proposal period expired without dispute).
     */
    finalizeUncontested(marketToken: Address): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Finalizes a disputed market after the dispute period.
     */
    finalizeMarket(marketToken: Address): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Vetoes a proposed outcome.
     * Auto-approves USDB to the resolver for the PROPOSAL_BOND amount.
     */
    veto(marketToken: Address, proposedOutcome: number): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Claims the bounty reward for voting correctly on a resolved market.
     */
    claimBounty(marketToken: Address): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Claims an early bounty reward for a specific dispute round.
     */
    claimEarlyBounty(marketToken: Address, round: bigint): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Returns the dispute data struct for a market.
     */
    getDisputeData(marketToken: Address): Promise<unknown>;
    /**
     * Returns whether a market has been resolved.
     */
    isResolved(marketToken: Address): Promise<boolean>;
    /**
     * Returns the final outcome of a resolved market.
     */
    getFinalOutcome(marketToken: Address): Promise<number>;
    /**
     * Returns whether a market is currently in a dispute.
     */
    isInDispute(marketToken: Address): Promise<boolean>;
    /**
     * Returns whether a market is currently in a veto period.
     */
    isInVeto(marketToken: Address): Promise<boolean>;
    /**
     * Returns the current dispute round for a market.
     */
    getCurrentRound(marketToken: Address): Promise<bigint>;
    /**
     * Returns the vote count for a specific outcome in a specific round.
     */
    getVoteCount(marketToken: Address, round: bigint, outcomeId: number): Promise<bigint>;
    /**
     * Returns whether a voter has already voted in a specific round.
     */
    hasVoted(marketToken: Address, round: bigint, voter: Address): Promise<boolean>;
    /**
     * Returns the outcome a voter chose in a specific round.
     */
    getVoterChoice(marketToken: Address, round: bigint, voter: Address): Promise<number>;
    /**
     * Returns the bounty amount per correct vote for a resolved market.
     */
    getBountyPerVote(marketToken: Address): Promise<bigint>;
    /**
     * Returns whether a voter has already claimed the bounty for a market.
     */
    hasClaimed(marketToken: Address, voter: Address): Promise<boolean>;
    /**
     * Returns the staked amount for a voter.
     */
    getUserStake(voter: Address): Promise<bigint>;
    /**
     * Returns whether an address is a registered voter.
     */
    isVoter(voter: Address): Promise<boolean>;
    /**
     * Returns all system configuration constants.
     */
    getConstants(): Promise<{
        disputePeriod: bigint;
        proposalPeriod: bigint;
        proposalBond: bigint;
        minStakeAmount: bigint;
    }>;
}

declare class PrivateMarketsModule {
    private client;
    private privateMarketAddress;
    constructor(client: BasisClient, privateMarketAddress: Address);
    private approveIfNeeded;
    private _syncTx;
    private syncOrder;
    /**
     * Internal: creates a private market on-chain. Use createMarketWithMetadata() instead.
     */
    private createMarket;
    /**
     * Creates a private prediction market and registers its metadata on IPFS in one call.
     * Requires SIWE authentication.
     *
     * Returns { hash, receipt, marketTokenAddress, imageUrl, metadata }
     */
    createMarketWithMetadata(options: {
        marketName: string;
        symbol: string;
        endTime: bigint;
        optionNames: string[];
        maintoken: Address;
        privateEvent?: boolean;
        frozen?: boolean;
        bonding?: bigint;
        seedAmount?: bigint;
        description?: string;
        imageUrl?: string;
        website?: string;
        telegram?: string;
        twitterx?: string;
    }): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
        marketTokenAddress: `0x${string}`;
        imageUrl: string | undefined;
        metadata: {
            url: string;
            cid: string;
        };
    }>;
    /**
     * Executes an AMM buy for a private market outcome.
     * Auto-approves the input token.
     */
    buy(marketToken: Address, outcomeId: number, inputToken: Address, inputAmount: bigint, minUsdb: bigint, minShares: bigint): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Redeems winnings after a market resolves.
     */
    redeem(marketToken: Address): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Creates a limit order on a private market.
     */
    listOrder(marketToken: Address, outcomeId: number, amount: bigint, pricePerShare: bigint): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Cancels an active order on a private market.
     */
    cancelOrder(marketToken: Address, orderId: bigint): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Fills a specific order on a private market.
     * Auto-approves USDB for the order cost.
     */
    buyOrder(marketToken: Address, orderId: bigint, fill: bigint): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Sweeps multiple orders on a private market.
     */
    buyMultipleOrders(marketToken: Address, orderIds: bigint[], usdbAmount: bigint): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Buys from order book and AMM in a single transaction.
     * Auto-approves the input token.
     */
    buyOrdersAndContract(marketToken: Address, outcomeId: number, orderIds: bigint[], inputToken: Address, totalInput: bigint, minShares: bigint): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Casts a vote on a private market outcome.
     */
    vote(marketToken: Address, outcomeId: number): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Finalizes a private market after voting is complete.
     */
    finalize(marketToken: Address): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Claims the bounty reward for voting correctly.
     */
    claimBounty(marketToken: Address): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Manages voter status for a private market.
     */
    manageVoter(marketToken: Address, voter: Address, status: boolean): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Toggles whether specific addresses can buy in a private event market.
     */
    togglePrivateEventBuyers(marketToken: Address, buyers: Address[], status: boolean): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Disables the freeze on a private market.
     */
    disableFreeze(marketToken: Address): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Manages the whitelist for a private market.
     */
    manageWhitelist(marketToken: Address, wallets: Address[], amount: bigint, tag: string, status: boolean): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Returns the MarketData struct for a private market.
     */
    getMarketData(marketToken: Address): Promise<unknown>;
    /**
     * Returns the number of outcomes for a market.
     */
    getNumOutcomes(marketToken: Address): Promise<bigint>;
    /**
     * Returns the Outcome struct for a specific outcome.
     */
    getOutcome(marketToken: Address, outcomeId: bigint): Promise<unknown>;
    /**
     * Returns user shares for a specific outcome.
     */
    getUserShares(marketToken: Address, user: Address, outcomeId: number): Promise<bigint>;
    /**
     * Returns whether a user has bet on a market.
     */
    hasBetted(marketToken: Address, user: Address): Promise<boolean>;
    /**
     * Returns the bounty pool amount for a market.
     */
    getBountyPool(marketToken: Address): Promise<bigint>;
    /**
     * Returns the cost to buy an order.
     */
    getBuyOrderCost(marketToken: Address, orderId: bigint, fill: bigint): Promise<unknown>;
    /**
     * Returns the amounts out when buying an order with a specific USDB amount.
     */
    getBuyOrderAmountsOut(marketToken: Address, orderId: bigint, usdbAmount: bigint): Promise<unknown>;
    /**
     * Returns an order by market and order ID.
     */
    getMarketOrders(marketToken: Address, orderId: bigint): Promise<unknown>;
    /**
     * Returns the next order ID for a market.
     */
    getNextOrderId(marketToken: Address): Promise<bigint>;
    /**
     * Returns whether an address is a voter for a market.
     */
    isMarketVoter(marketToken: Address, voter: Address): Promise<boolean>;
    /**
     * Returns the outcome a voter chose for a market.
     */
    getVoterChoice(marketToken: Address, voter: Address): Promise<number>;
    /**
     * Returns the first vote time for a market.
     */
    getFirstVoteTime(marketToken: Address): Promise<bigint>;
    /**
     * Returns whether a user can buy in a private event market.
     */
    canUserBuy(marketToken: Address, user: Address): Promise<boolean>;
    /**
     * Returns the bounty per correct vote for a market.
     */
    getBountyPerVote(marketToken: Address): Promise<bigint>;
    /**
     * Returns whether a voter has claimed the bounty for a market.
     */
    hasClaimed(marketToken: Address, voter: Address): Promise<boolean>;
    /**
     * Returns the initial reserves required for a given number of outcomes.
     */
    getInitialReserves(numOutcomes: bigint): Promise<readonly [bigint, bigint]>;
}

declare class MarketReaderModule {
    private client;
    private readerAddress;
    constructor(client: BasisClient, readerAddress: Address);
    /**
     * Returns outcome info for all outcomes in a market.
     */
    getAllOutcomes(routerAddress: Address, marketToken: Address): Promise<unknown>;
    /**
     * Estimates the number of shares received for a given USDB input,
     * considering both order book fills and AMM.
     */
    estimateSharesOut(routerAddress: Address, marketToken: Address, outcomeId: number, usdbAmount: bigint, orderIds: bigint[], user: Address): Promise<bigint>;
    /**
     * Returns potential payout for holding or selling shares.
     */
    getPotentialPayout(routerAddress: Address, marketToken: Address, outcomeId: number, sharesAmount: bigint, estimatedUsdbToPool: bigint): Promise<{
        holdPayout: bigint;
        simulatedAmmPayout: bigint;
    }>;
}

declare class LeverageSimulatorModule {
    private client;
    private leverageAddress;
    constructor(client: BasisClient, leverageAddress: Address);
    /**
     * Simulates a leveraged buy and returns the EndResult struct.
     */
    simulateLeverage(amount: bigint, path: Address[], numberOfDays: bigint): Promise<unknown>;
    /**
     * Simulates a leveraged buy via factory and returns the EndResult struct.
     */
    simulateLeverageFactory(amount: bigint, path: Address[], numberOfDays: bigint): Promise<unknown>;
    /**
     * Calculates the floor price for a hybrid token.
     */
    calculateFloor(hybridMultiplier: bigint, reserve0: bigint, reserve1: bigint, baseReserve0: bigint, xereserve0: bigint, xereserve1: bigint): Promise<bigint>;
    /**
     * Returns the token price given reserves.
     */
    getTokenPrice(reserve0: bigint, reserve1: bigint): Promise<bigint>;
    /**
     * Returns the USD price of a token given reserves.
     */
    getUSDPrice(reserve0: bigint, reserve1: bigint, xereserve0: bigint, xereserve1: bigint): Promise<bigint>;
    /**
     * Returns the collateral value in USDB for a given token amount.
     */
    getCollateralValue(tokenAmount: bigint, reserve0: bigint, reserve1: bigint): Promise<bigint>;
    /**
     * Returns the collateral value for a hybrid token.
     */
    getCollateralValueHybrid(tokenAmount: bigint, reserve0: bigint, reserve1: bigint, xereserve0: bigint, xereserve1: bigint, multiplier: bigint, basereserve0: bigint): Promise<bigint>;
    /**
     * Calculates how many tokens can be purchased for a given USDB amount.
     */
    calculateTokensForBuy(usdbAmount: bigint, reserve0: bigint, reserve1: bigint): Promise<bigint>;
    /**
     * Calculates the number of tokens to burn for a given input.
     */
    calculateTokensToBurn(amountIn: bigint, multiplier: bigint, inputreserve0: bigint, inputreserve1: bigint, splitter: bigint): Promise<bigint>;
}

declare class TaxesModule {
    private client;
    private taxesAddress;
    constructor(client: BasisClient, taxesAddress: Address);
    private _syncTx;
    /**
     * Returns the effective tax rate (in basis points) for a specific token and user.
     */
    getTaxRate(token: Address, user: Address): Promise<bigint>;
    /**
     * Returns the current surge tax rate (in basis points) for a token.
     */
    getCurrentSurgeTax(token: Address): Promise<bigint>;
    /**
     * Returns the available surge quota for a token.
     */
    getAvailableSurgeQuota(token: Address): Promise<bigint>;
    /**
     * Returns all four base tax rates.
     */
    getBaseTaxRates(): Promise<{
        stasis: bigint;
        stable: bigint;
        default: bigint;
        prediction: bigint;
    }>;
    /**
     * Start a decaying surge tax on a factory token. Only callable by the token's DEV.
     */
    startSurgeTax(startRate: bigint, endRate: bigint, duration: bigint, token: Address): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * End an active surge tax early. Only callable by the token's DEV.
     */
    endSurgeTax(token: Address): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Add a developer revenue share wallet for a token. Only callable by the token's DEV.
     */
    addDevShare(token: Address, wallet: Address, basisPoints: bigint): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
    /**
     * Remove a developer revenue share wallet. Only callable by the token's DEV.
     */
    removeDevShare(token: Address, wallet: Address): Promise<{
        hash: `0x${string}`;
        receipt: viem.TransactionReceipt;
    }>;
}

interface AgentConfig {
    name?: string;
    description?: string;
    image?: string;
    capabilities?: string[];
}
declare class AgentIdentityModule {
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
     * Register the current wallet as an ERC-8004 agent.
     * Returns the agentId.
     *
     * If already registered on-chain, returns null (check via isRegistered first).
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
    private syncToApi;
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
        receipt: viem.TransactionReceipt;
    }>;
}

interface BasisClientOptions {
    rpcUrl?: string;
    privateKey?: `0x${string}`;
    apiKey?: string;
    apiDomain?: string;
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
declare class BasisClient {
    publicClient: PublicClient;
    walletClient?: WalletClient;
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
     * Ensures an API key exists for the authenticated session.
     * Fetches existing keys or creates one labeled "basis-sdk-auto".
     */
    ensureApiKey(): Promise<void>;
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
     * Claims 10,000 test USDB from the faucet. One claim per wallet, ever.
     * USDB from faucet is non-transferable except to Basis protocol contracts.
     * Optionally pass a referrer address for the referral system.
     */
    claimFaucet(referrer?: `0x${string}`): Promise<{
        hash: string;
        receipt: any;
    }>;
    /**
     * Sets a referrer for the current wallet. One-time only — reverts if already set.
     * Use this if you didn't pass a referrer during claimFaucet().
     */
    setReferrer(referrer: `0x${string}`): Promise<{
        hash: string;
        receipt: any;
    }>;
}

export { type AgentConfig, AgentIdentityModule, type ApiKeyInfo, BasisAPI, BasisClient, type BasisClientOptions, type Candle, type Comment, type CursorPagination, FactoryModule, LeverageSimulatorModule, type LiquidityEntry, LoansModule, MarketReaderModule, MarketResolverModule, type MetadataPayload, type MyProfile, type MyProjectItem, type MyProjects, type MyReferrals, type MySocial, type MyStats, type MyXAccount, type Order, OrderBookModule, type Pagination, PredictionMarketsModule, PrivateMarketsModule, type ProjectUpdatePayload, type ReferralUser, StakingModule, TaxesModule, type Token, type Trade, TradingModule, type UpdateProfilePayload, type UpdateProfileResult, VestingModule, type WalletTransaction, type WhitelistEntry };
