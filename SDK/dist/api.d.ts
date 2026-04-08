import { BasisClient } from './BasisClient';
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
    predictionOptions?: Array<{
        index: number;
        name: string;
    }>;
    liquidityUSD?: number;
    startingLiquidityUSD?: number;
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
    agent: {
        agentId: number;
        name: string;
    } | null;
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
    social?: {
        platform: string;
        handle: string;
    };
    removeSocial?: string;
    toggleSocialPublic?: string;
    avatar?: string | null;
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
export declare class BasisAPI {
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
     *
     * @param purpose - "token" (requires address) or "avatar"
     * @param address - token/market contract address (required when purpose is "token")
     */
    uploadImage(file: Blob | Buffer, filename?: string, purpose?: 'token' | 'avatar', address?: string): Promise<string>;
    /**
     * Downloads an image from a URL, resizes it to 512x512 (center-crop),
     * converts to WebP, and uploads it to IPFS via /api/images.
     *
     * Returns the hosted IPFS URL string.
     */
    uploadImageFromUrl(imageUrl: string, contractAddress?: string, purpose?: 'token' | 'avatar'): Promise<string>;
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
        dev?: string;
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
    /** @deprecated Use syncTransaction() instead */
    syncLoan(txHash: string): Promise<{
        success: boolean;
        events?: unknown[];
        loan?: Record<string, unknown>;
        error?: string;
    }>;
    /**
     * GET /api/v1/faucet/status — check faucet eligibility and signal breakdown.
     * Requires SIWE session. The wallet is determined from the session.
     */
    getFaucetStatus(): Promise<{
        eligible: boolean;
        canClaim: boolean;
        dailyAmount: number;
        signals: {
            base: boolean;
            twitter: boolean;
            active: boolean;
            hatchling: boolean;
            tidal: boolean;
        };
        cooldownRemaining: number;
        nextClaimAt: string | null;
        hasReferrer: boolean;
    }>;
    /**
     * POST /api/v1/faucet/claim — claim daily USDB from the treasury.
     * Requires SIWE session. Amount is based on active signals (max 500 USDB/day).
     * 24-hour cooldown between claims.
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
     * - `{ avatar: url }` — set avatar (must be HTTPS URL)
     * - `{ avatar: null }` — clear avatar
     */
    updateMyProfile(payload: UpdateProfilePayload): Promise<UpdateProfileResult>;
    /**
     * Upload an avatar image and set it on the profile in one call.
     * Accepts a raw file (Blob/Buffer) or an image URL to download and resize.
     * Returns the hosted avatar URL.
     */
    setAvatar(source: string | Blob | Buffer, filename?: string): Promise<string>;
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
    /**
     * POST /api/moltbook/link — start linking a Moltbook agent to your wallet.
     * Returns a challenge code that the agent must post in m/basis on Moltbook.
     */
    linkMoltbook(moltbookName: string): Promise<{
        challenge: string;
        instructions: string;
    }>;
    /**
     * POST /api/moltbook/verify — complete linking by providing the Moltbook
     * post containing the challenge code. The challenge post counts as the
     * first verified post.
     *
     * @param moltbookName - The Moltbook agent/username being linked.
     * @param postId - Post ID (UUID) or full URL of the challenge post.
     */
    verifyMoltbook(moltbookName: string, postId: string): Promise<{
        success: boolean;
        moltbookName: string;
        message: string;
    }>;
    /**
     * GET /api/moltbook/status — check if your wallet has a linked Moltbook
     * account, post count, total karma, and pending challenges.
     */
    getMoltbookStatus(): Promise<{
        linked: boolean;
        moltbookName: string | null;
        verified: boolean;
        postCount: number;
        totalKarma: number;
        pendingChallenge?: {
            challenge: string;
        };
    }>;
    /**
     * POST /api/v1/social/verify-moltbook-post — submit a Moltbook post for
     * points. Post must be by your linked agent, in m/basis or mentioning Basis.
     * Max 3 per day, 7-day lock-in (post must stay up or verification is revoked).
     *
     * @param postId - Post ID (UUID) or full URL.
     */
    verifyMoltbookPost(postId: string): Promise<{
        success: boolean;
        post: {
            id: string;
            postUrl: string;
            karma: number;
            submolt: string;
            mentionsBasis: boolean;
            createdAt: string;
        };
    }>;
    /**
     * GET /api/v1/social/verified-moltbook-posts — list your submitted Moltbook
     * posts with karma, verification status, and submission dates.
     */
    getVerifiedMoltbookPosts(): Promise<{
        posts: Array<{
            id: string;
            postUrl: string;
            karma: number;
            submolt: string;
            mentionsBasis: boolean;
            verified: boolean;
            lastVerifiedAt: string | null;
            createdAt: string;
        }>;
    }>;
}
