#!/usr/bin/env node
"use strict";
/**
 * Basis MCP Server — 80+ tools across 11 modules
 * Built from BASIS_MCP_TOOL_SPEC.md + full SDK coverage
 * Uses real basis-sdk-js (viem-based)
 */
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const basis_sdk_js_1 = require("basis-sdk-js");
const viem_1 = require("viem");
// ============================================================
// Constants (fallback — overridden by launchonbasis.com/contracts.json on startup)
// ============================================================
const ADDRESSES = {
    USDB: "0x42bcF288e51345c6070F37f30332ee5090fC36BF",
    USDC: "0x42bcF288e51345c6070F37f30332ee5090fC36BF",
    STASIS: "0x3067ce754a36d0a2A1b215C4C00315d9Da49EF15",
    MAINTOKEN: "0x3067ce754a36d0a2A1b215C4C00315d9Da49EF15",
    PREDICTION: "0x396216fc9d2c220afD227B59097cf97B7dEaCb57",
    MARKETTRADING: "0x396216fc9d2c220afD227B59097cf97B7dEaCb57",
};
// ============================================================
// Client setup
// ============================================================
const PRIVATE_KEY = process.env.BASIS_PRIVATE_KEY;
if (!PRIVATE_KEY) {
    console.error("Missing BASIS_PRIVATE_KEY environment variable");
    process.exit(1);
}
let client;
let walletAddress;
let tokenCache = new Map();
async function fetchContractAddresses() {
    try {
        const res = await fetch("https://launchonbasis.com/contracts.json");
        if (!res.ok)
            return;
        const data = await res.json();
        if (data.usdb) {
            ADDRESSES.USDB = data.usdb;
            ADDRESSES.USDC = data.usdb;
        }
        if (data.mainToken) {
            ADDRESSES.STASIS = data.mainToken;
            ADDRESSES.MAINTOKEN = data.mainToken;
        }
        if (data.marketTrading) {
            ADDRESSES.PREDICTION = data.marketTrading;
            ADDRESSES.MARKETTRADING = data.marketTrading;
        }
        console.error("Loaded contract addresses from launchonbasis.com");
    }
    catch {
        console.error("Using fallback contract addresses");
    }
}
async function initClient() {
    await fetchContractAddresses();
    try {
        client = await basis_sdk_js_1.BasisClient.create({
            privateKey: PRIVATE_KEY,
            ...(process.env.BASIS_API_KEY ? { apiKey: process.env.BASIS_API_KEY } : {}),
        });
    }
    catch (e) {
        if (e?.message?.includes("API key already exists") && !process.env.BASIS_API_KEY) {
            console.error("API key exists on server but not provided. Set BASIS_API_KEY env var. Retrying without API key provisioning...");
            // Create without SIWE API key provisioning — session cookie still works for most calls
            client = new basis_sdk_js_1.BasisClient({ privateKey: PRIVATE_KEY });
            await client.authenticate(client.walletClient.account.address);
        }
        else {
            throw e;
        }
    }
    walletAddress = client.walletClient.account.address;
    await refreshTokenCache();
}
async function refreshTokenCache() {
    try {
        const resp = await client.api.getTokens({ limit: 200 });
        for (const t of resp.data) {
            if (t.symbol)
                tokenCache.set(t.symbol.toUpperCase(), t.address);
            if (t.name)
                tokenCache.set(t.name.toUpperCase(), t.address);
        }
    }
    catch { }
}
// ============================================================
// Helpers
// ============================================================
const erc20Abi = (0, viem_1.parseAbi)(["function balanceOf(address) view returns (uint256)"]);
function resolveToken(nameOrAddress) {
    if (nameOrAddress.startsWith("0x") && nameOrAddress.length === 42)
        return (0, viem_1.getAddress)(nameOrAddress);
    const upper = nameOrAddress.toUpperCase();
    // Resolve system tokens using client addresses (authoritative)
    if (upper === "USDB" || upper === "USDC")
        return (0, viem_1.getAddress)(client.usdbAddress);
    if (upper === "STASIS" || upper === "MAINTOKEN")
        return (0, viem_1.getAddress)(client.mainTokenAddress);
    if (ADDRESSES[upper])
        return (0, viem_1.getAddress)(ADDRESSES[upper]);
    throw new Error(`Token symbols are not unique. Use get_token_list to search, then pass the address. Only system tokens (USDB, STASIS) resolve by name.`);
}
function toRaw(amount) { return (0, viem_1.parseUnits)(amount.toString(), 18); }
function fromRaw(raw) { return (0, viem_1.formatUnits)(typeof raw === "string" ? BigInt(raw) : raw, 18); }
function buildBuyPath(t) {
    const usdb = (0, viem_1.getAddress)(client.usdbAddress);
    const main = (0, viem_1.getAddress)(client.mainTokenAddress);
    const target = (0, viem_1.getAddress)(t);
    return (target === main) ? [usdb, main] : [usdb, main, target];
}
function buildSellPath(t) {
    const usdb = (0, viem_1.getAddress)(client.usdbAddress);
    const main = (0, viem_1.getAddress)(client.mainTokenAddress);
    const target = (0, viem_1.getAddress)(t);
    return (target === main) ? [main, usdb] : [target, main, usdb];
}
function getMarketTradingAddress() {
    return client.predictionMarkets.marketTradingAddress;
}
function ok(data) {
    return { content: [{ type: "text", text: JSON.stringify(data, (_, v) => typeof v === "bigint" ? v.toString() : v, 2) }] };
}
function err(message) {
    return { content: [{ type: "text", text: JSON.stringify({ error: true, message }, null, 2) }] };
}
async function resolveOutcomeId(market, outcome) {
    if (!isNaN(Number(outcome)))
        return Number(outcome);
    const names = await client.predictionMarkets.getOptionNames(market);
    const idx = names.findIndex((n) => n.toLowerCase() === outcome.toLowerCase());
    if (idx === -1)
        throw new Error(`Outcome '${outcome}' not found. Available: ${names.join(", ")}`);
    return idx;
}
function txResult(tx, extra) {
    return ok({ hash: tx.hash, status: tx.receipt?.status || "sent", ...extra });
}
// ============================================================
// Tool definitions
// ============================================================
const TOOLS = [
    // ── Module 1: Trading (8) ──────────────────────────────
    { name: "buy_token", description: "Buy a token using USDB. Elastic supply — buying increases price. Previews before executing. NOTE: Floor+ tokens (multiplier 1-99) and prediction market tokens have 1.5% tax, other tokens have 0.5% — account for this in slippage.", inputSchema: { type: "object", properties: { token: { type: "string", description: "Token name (STASIS) or address" }, amount_usdb: { type: "number", description: "USDB to spend" }, slippage_percent: { type: "number", description: "Max slippage % (default: 1)" }, wrap: { type: "boolean", description: "Wrap output to wSTASIS (default: false)" } }, required: ["token", "amount_usdb"] } },
    { name: "sell_token", description: "Sell a token for USDB. Checks balance first. Use percentage to scale out. NOTE: Floor+ tokens (multiplier 1-99) and prediction market tokens have 1.5% tax, other tokens have 0.5% — account for this in slippage.", inputSchema: { type: "object", properties: { token: { type: "string", description: "Token name or address" }, amount: { type: "number", description: "Token amount to sell" }, percentage: { type: "number", description: "1-100, sell this % of balance" }, slippage_percent: { type: "number", description: "Max slippage % (default: 1)" }, to_usdb: { type: "boolean", description: "Swap all the way to USDB (default: true). False stops at MAINTOKEN." } }, required: ["token"] } },
    { name: "get_price", description: "Get current USD price of a token.", inputSchema: { type: "object", properties: { token: { type: "string", description: "Token name or address" } }, required: ["token"] } },
    { name: "get_token_price", description: "Get raw token price (reserve ratio). Different from get_price (USD).", inputSchema: { type: "object", properties: { token: { type: "string", description: "Token address" } }, required: ["token"] } },
    { name: "preview_trade", description: "Preview a buy or sell without executing.", inputSchema: { type: "object", properties: { token: { type: "string", description: "Token name or address" }, amount_usdb: { type: "number", description: "USDB amount (for buys)" }, amount_token: { type: "number", description: "Token amount (for sells)" }, direction: { type: "string", enum: ["buy", "sell"], description: "'buy' or 'sell'" } }, required: ["token", "direction"] } },
    { name: "leverage_buy", description: "Open leveraged position. NO price liquidation — time-based only. Simulates first, requires confirm=true.", inputSchema: { type: "object", properties: { token: { type: "string", description: "Token name or address" }, amount_usdb: { type: "number", description: "USDB collateral" }, days: { type: "number", description: "Loan duration (10-1000)" }, confirm: { type: "boolean", description: "Must be true to execute" } }, required: ["token", "amount_usdb", "days", "confirm"] } },
    { name: "close_leverage", description: "Close (or partially close) a leverage position. 10% increments.", inputSchema: { type: "object", properties: { position_id: { type: "number", description: "Leverage position ID" }, percentage: { type: "number", description: "10-100, divisible by 10 (default: 100)" } }, required: ["position_id"] } },
    { name: "get_leverage_positions", description: "List all leverage positions for the wallet.", inputSchema: { type: "object", properties: {} } },
    // ── Module 2: Token Creation (8) ───────────────────────
    { name: "create_token", description: "Create a new token. You earn 20% of every trade forever. Stable+ = price only up, Floor+ = real movement with protection.", inputSchema: { type: "object", properties: { name: { type: "string", description: "Token full name" }, symbol: { type: "string", description: "Token ticker" }, type: { type: "string", enum: ["stable_plus", "floor_plus"], description: "Token type" }, stability: { type: "number", description: "1-90 for Floor+ (default: 50)" }, start_lp: { type: "number", description: "Starting virtual liquidity 100-10000 (default: 1000)" }, description: { type: "string" }, image_url: { type: "string" }, website: { type: "string" }, telegram: { type: "string" }, twitter: { type: "string" }, frozen: { type: "boolean", description: "Start frozen (default: false)" }, usdb_for_bonding: { type: "number", description: "USDB to seed for frozen tokens" }, auto_vest: { type: "boolean", description: "Enable auto-vesting" }, auto_vest_duration: { type: "number", description: "Auto-vest duration in seconds" } }, required: ["name", "symbol", "type"] } },
    { name: "unfreeze_token", description: "Open frozen token to public trading. Irreversible.", inputSchema: { type: "object", properties: { token: { type: "string", description: "Token address" } }, required: ["token"] } },
    { name: "whitelist_wallets", description: "Add wallets to frozen token's whitelist.", inputSchema: { type: "object", properties: { token: { type: "string", description: "Token address" }, wallets: { type: "array", items: { type: "string" }, description: "Wallet addresses" }, max_buy_usdb: { type: "number", description: "Max USDB per wallet" }, tag: { type: "string" } }, required: ["token", "wallets", "max_buy_usdb"] } },
    { name: "get_token_state", description: "Get token state — frozen, bonded, supply, price.", inputSchema: { type: "object", properties: { token: { type: "string", description: "Token name or address" } }, required: ["token"] } },
    { name: "claim_rewards", description: "Claim accumulated rewards from reward phase.", inputSchema: { type: "object", properties: { token: { type: "string", description: "Token address" } }, required: ["token"] } },
    { name: "get_claimable_rewards", description: "Check claimable rewards amount before claiming.", inputSchema: { type: "object", properties: { token: { type: "string", description: "Token address" }, investor: { type: "string", description: "Investor address (default: your wallet)" } }, required: ["token"] } },
    { name: "get_my_tokens", description: "List all tokens you created with prices and state.", inputSchema: { type: "object", properties: {} } },
    { name: "is_ecosystem_token", description: "Check if a token address is a valid Basis ecosystem token.", inputSchema: { type: "object", properties: { token: { type: "string", description: "Token address" } }, required: ["token"] } },
    { name: "get_fee_amount", description: "Get the factory token creation fee.", inputSchema: { type: "object", properties: {} } },
    { name: "get_floor_price", description: "Get the USDB floor price for a factory token. Does NOT work on STASIS — only factory-created tokens.", inputSchema: { type: "object", properties: { token: { type: "string", description: "Factory token address (not STASIS)" } }, required: ["token"] } },
    // ── Module 3: Prediction Markets (12+) ─────────────────
    { name: "create_market", description: "Create prediction market. Earn 20% of net trading fees forever.", inputSchema: { type: "object", properties: { question: { type: "string", description: "Market question" }, symbol: { type: "string", description: "Market token symbol" }, outcomes: { type: "array", items: { type: "string" }, description: "e.g. ['Yes', 'No']" }, end_time: { type: "string", description: "ISO date or unix timestamp" }, seed_usdb: { type: "number", description: "USDB seed (min 50, default: 50)" }, description: { type: "string" }, image_url: { type: "string" } }, required: ["question", "symbol", "outcomes", "end_time"] } },
    { name: "bet", description: "Buy shares in a prediction market outcome. UNCAPPED payouts — winners split entire losing pool + general pot, NOT $1/share. Before betting: 1) get_my_shares for existing position 2) estimate_shares_out for new shares 3) get_potential_payout(TOTAL shares = existing + new, usdb=bet_amount) → payout_if_win is your TOTAL payout. Profit = payout_if_win - total_invested.", inputSchema: { type: "object", properties: { market: { type: "string", description: "Market token address" }, outcome: { type: "string", description: "Outcome name or index" }, amount_usdb: { type: "number", description: "USDB to bet" } }, required: ["market", "outcome", "amount_usdb"] } },
    { name: "redeem_winnings", description: "Claim winnings from resolved market.", inputSchema: { type: "object", properties: { market: { type: "string", description: "Market token address" } }, required: ["market"] } },
    { name: "get_market_info", description: "Get market data + outcome probabilities.", inputSchema: { type: "object", properties: { market: { type: "string", description: "Market token address" } }, required: ["market"] } },
    { name: "propose_outcome", description: "Propose winning outcome (5 USDB bond).", inputSchema: { type: "object", properties: { market: { type: "string", description: "Market token address" }, outcome: { type: "string", description: "Outcome name or index" } }, required: ["market", "outcome"] } },
    { name: "dispute_outcome", description: "Dispute proposed outcome (5 USDB bond).", inputSchema: { type: "object", properties: { market: { type: "string", description: "Market token address" }, outcome: { type: "string", description: "Alternative outcome" } }, required: ["market", "outcome"] } },
    { name: "vote_on_dispute", description: "Vote during dispute. Requires resolver_stake first. 24h lock.", inputSchema: { type: "object", properties: { market: { type: "string", description: "Market token address" }, outcome: { type: "string", description: "Outcome to vote for" } }, required: ["market", "outcome"] } },
    { name: "finalize_market", description: "Finalize market resolution after challenge period.", inputSchema: { type: "object", properties: { market: { type: "string", description: "Market token address" } }, required: ["market"] } },
    { name: "claim_bounty", description: "Claim resolution bounty.", inputSchema: { type: "object", properties: { market: { type: "string", description: "Market token address" }, round: { type: "number", description: "Round (for early bounties)" } }, required: ["market"] } },
    { name: "get_my_shares", description: "Check shares held in a prediction market. To sell shares, use list_order (order book limit sell) — there is no AMM sell for prediction shares.", inputSchema: { type: "object", properties: { market: { type: "string", description: "Market token address" }, outcome: { type: "string", description: "Specific outcome (omit for all)" } }, required: ["market"] } },
    { name: "resolver_stake", description: "Stake/unstake for dispute voting eligibility.", inputSchema: { type: "object", properties: { action: { type: "string", enum: ["stake", "unstake"] } }, required: ["action"] } },
    { name: "get_market_resolution_status", description: "Full resolution pipeline status.", inputSchema: { type: "object", properties: { market: { type: "string", description: "Market token address" } }, required: ["market"] } },
    { name: "get_bounty_pool", description: "Get bounty pool amount for a prediction market.", inputSchema: { type: "object", properties: { market: { type: "string" } }, required: ["market"] } },
    { name: "get_general_pot", description: "Get general pot amount for a prediction market.", inputSchema: { type: "object", properties: { market: { type: "string" } }, required: ["market"] } },
    { name: "estimate_shares_out", description: "Estimate shares you'd receive for a USDB bet. Add result to existing shares (from get_my_shares) to get total, then pass total to get_potential_payout with estimated_usdb_to_pool=bet_amount.", inputSchema: { type: "object", properties: { market: { type: "string" }, outcome: { type: "number" }, amount_usdb: { type: "number" } }, required: ["market", "outcome", "amount_usdb"] } },
    { name: "get_potential_payout", description: "Calculate prediction market resolution payout: (yourShares / winningCirculatingShares) × totalPool. Two modes: (1) CURRENT: pass existing shares, usdb=0. (2) BET PREVIEW: pass total shares (existing+new), new_shares_from_bet = new shares from estimate_shares_out, usdb = bet amount.", inputSchema: { type: "object", properties: { market: { type: "string" }, outcome: { type: "number" }, shares: { type: "number", description: "Your total shares (existing for current, existing+new for preview)" }, new_shares_from_bet: { type: "number", description: "New shares from estimate_shares_out. Omit or 0 for current position." }, estimated_usdb_to_pool: { type: "number", description: "0 for current. Bet amount for preview." } }, required: ["market", "outcome", "shares"] } },
    // ── Module 4: Staking / Vault (6) ─────────────────────
    { name: "stake_stasis", description: "Buy STASIS and/or wrap→wSTASIS→lock. Multi-step.", inputSchema: { type: "object", properties: { amount_usdb: { type: "number", description: "Buy STASIS with USDB first" }, amount_stasis: { type: "number", description: "Wrap STASIS into wSTASIS" }, lock: { type: "boolean", description: "Lock as collateral" }, lock_existing_wstasis: { type: "number", description: "Lock existing wSTASIS" } } } },
    { name: "unstake_stasis", description: "Unwrap/sell staked STASIS.", inputSchema: { type: "object", properties: { unlock: { type: "boolean", description: "Unlock from collateral first" }, sell_to_usdb: { type: "boolean", description: "Sell all the way to USDB" }, shares: { type: "number", description: "wSTASIS shares to unwrap" } } } },
    { name: "vault_borrow", description: "Borrow USDB against locked wSTASIS. 2% + 0.005%/day.", inputSchema: { type: "object", properties: { amount_stasis: { type: "number", description: "STASIS amount to borrow against" }, days: { type: "number", description: "Loan duration" } }, required: ["amount_stasis", "days"] } },
    { name: "vault_repay", description: "Repay vault loan.", inputSchema: { type: "object", properties: {} } },
    { name: "get_vault_status", description: "Complete vault position status.", inputSchema: { type: "object", properties: {} } },
    { name: "extend_loan", description: "Extend vault or hub loan. ~400x cheaper than new loan.", inputSchema: { type: "object", properties: { loan_type: { type: "string", enum: ["vault", "hub"] }, hub_id: { type: "number", description: "Required for hub" }, days: { type: "number" }, pay_in_stable: { type: "boolean", description: "Pay extension fee in USDB (default: true)" }, refinance: { type: "boolean" } }, required: ["loan_type", "days"] } },
    // ── Module 5: Loans (8) ───────────────────────────────
    { name: "take_loan", description: "Loan against any token. No price liquidation. For STASIS prefer vault_borrow.", inputSchema: { type: "object", properties: { collateral_token: { type: "string", description: "Token name or address" }, amount: { type: "number", description: "Collateral amount" }, days: { type: "number", description: "Duration (min 10)" } }, required: ["collateral_token", "amount", "days"] } },
    { name: "repay_loan", description: "Repay a hub loan.", inputSchema: { type: "object", properties: { hub_id: { type: "number" } }, required: ["hub_id"] } },
    { name: "get_loans", description: "List loans. Monitor expiry — silent auto-liquidation.", inputSchema: { type: "object", properties: { active_only: { type: "boolean", description: "Default: true" } } } },
    { name: "get_user_loan_details", description: "Get on-chain details for a specific loan.", inputSchema: { type: "object", properties: { hub_id: { type: "number" } }, required: ["hub_id"] } },
    { name: "get_user_loan_count", description: "Count of loans for the wallet.", inputSchema: { type: "object", properties: {} } },
    { name: "increase_loan_collateral", description: "Add collateral without new origination fee.", inputSchema: { type: "object", properties: { loan_type: { type: "string", enum: ["hub", "vault"] }, hub_id: { type: "number" }, amount: { type: "number" } }, required: ["loan_type", "amount"] } },
    { name: "claim_liquidation", description: "Claim remaining collateral from expired loan.", inputSchema: { type: "object", properties: { loan_type: { type: "string", enum: ["hub", "vault"] }, hub_id: { type: "number" } }, required: ["loan_type"] } },
    { name: "partial_loan_sell", description: "Partially sell hub loan collateral. 10% increments.", inputSchema: { type: "object", properties: { hub_id: { type: "number" }, percentage: { type: "number", description: "10-100, divisible by 10" } }, required: ["hub_id", "percentage"] } },
    // ── Module 6: Portfolio & Data ──────────────────────────
    { name: "get_balances", description: "Wallet balances — USDB, STASIS, wSTASIS, factory tokens.", inputSchema: { type: "object", properties: {} } },
    { name: "get_market_list", description: "List prediction markets.", inputSchema: { type: "object", properties: { status: { type: "string", enum: ["active", "awaiting_proposal", "resolved"] }, limit: { type: "number" } } } },
    { name: "get_token_list", description: "List/search tokens.", inputSchema: { type: "object", properties: { search: { type: "string" }, limit: { type: "number" } } } },
    { name: "get_token_detail", description: "Get full detail for a single token.", inputSchema: { type: "object", properties: { token: { type: "string", description: "Token address" } }, required: ["token"] } },
    { name: "get_price_history", description: "OHLC candles for a token.", inputSchema: { type: "object", properties: { token: { type: "string" }, interval: { type: "string", enum: ["1m", "5m", "15m", "1h", "4h", "1d"] }, limit: { type: "number" } }, required: ["token"] } },
    { name: "get_trade_history", description: "Recent trades for a token.", inputSchema: { type: "object", properties: { token: { type: "string" }, type: { type: "string", enum: ["buy", "sell", "leverage_buy", "leverage_sell"] }, limit: { type: "number" } }, required: ["token"] } },
    { name: "get_platform_stats", description: "Platform pulse — phase, stats, currency.", inputSchema: { type: "object", properties: {} } },
    { name: "get_my_stats", description: "Your trading stats — trades, tokens created, loans.", inputSchema: { type: "object", properties: {} } },
    { name: "get_my_profile", description: "Your profile — tier, rank, streak.", inputSchema: { type: "object", properties: {} } },
    { name: "remove_whitelist", description: "Remove wallet from frozen token whitelist.", inputSchema: { type: "object", properties: { token: { type: "string" }, wallet: { type: "string" } }, required: ["token", "wallet"] } },
    { name: "get_leaderboard", description: "Get platform leaderboard.", inputSchema: { type: "object", properties: { page: { type: "number" }, limit: { type: "number" } } } },
    { name: "get_public_profile", description: "Get public profile for a wallet.", inputSchema: { type: "object", properties: { wallet: { type: "string" } }, required: ["wallet"] } },
    { name: "get_my_projects", description: "Get your created tokens and markets.", inputSchema: { type: "object", properties: {} } },
    { name: "get_my_referrals", description: "Get your referral data.", inputSchema: { type: "object", properties: {} } },
    { name: "get_whitelist", description: "View whitelist for a frozen token.", inputSchema: { type: "object", properties: { token: { type: "string" }, wallet: { type: "string", description: "Filter by wallet" }, limit: { type: "number" } }, required: ["token"] } },
    { name: "get_token_comments", description: "Get comments on a token.", inputSchema: { type: "object", properties: { token: { type: "string" }, limit: { type: "number" } }, required: ["token"] } },
    { name: "get_loan_events", description: "Get loan event history.", inputSchema: { type: "object", properties: { source: { type: "string" }, action: { type: "string" }, limit: { type: "number" } } } },
    { name: "get_vault_events", description: "Get vault staking event history.", inputSchema: { type: "object", properties: { action: { type: "string" }, limit: { type: "number" } } } },
    { name: "get_market_events", description: "Get prediction market event history.", inputSchema: { type: "object", properties: { action: { type: "string" }, market_token: { type: "string" }, limit: { type: "number" } } } },
    { name: "get_market_liquidity", description: "Get liquidity data for a prediction market.", inputSchema: { type: "object", properties: { market: { type: "string" }, outcome_id: { type: "string" }, limit: { type: "number" } }, required: ["market"] } },
    // ── Module 7: Agent Identity ───────────────────────
    { name: "register_agent", description: "Register as AI agent on-chain (ERC-8004).", inputSchema: { type: "object", properties: { name: { type: "string", description: "Agent display name" }, description: { type: "string", description: "Agent description" }, capabilities: { type: "array", items: { type: "string" } } }, required: ["name"] } },
    { name: "is_agent_registered", description: "Check if a wallet is registered as an agent.", inputSchema: { type: "object", properties: { wallet: { type: "string", description: "Wallet to check (default: yours)" } } } },
    // ── Additional reads ───────────────────────────────────
    { name: "get_final_outcome", description: "Get the resolved outcome of a finalized market.", inputSchema: { type: "object", properties: { market: { type: "string" } }, required: ["market"] } },
    { name: "get_resolver_constants", description: "Get dispute period, proposal period, bond amounts.", inputSchema: { type: "object", properties: {} } },
    { name: "is_resolver_voter", description: "Check if a wallet is an eligible resolver voter.", inputSchema: { type: "object", properties: { wallet: { type: "string", description: "Default: your wallet" } } } },
    { name: "get_resolver_stake", description: "Get your resolver stake amount.", inputSchema: { type: "object", properties: { wallet: { type: "string", description: "Default: your wallet" } } } },
    { name: "get_bounty_per_vote", description: "Get bounty allocation per vote for a market.", inputSchema: { type: "object", properties: { market: { type: "string" } }, required: ["market"] } },
    { name: "get_vote_count", description: "Get vote count for an outcome in a dispute round.", inputSchema: { type: "object", properties: { market: { type: "string" }, round: { type: "number" }, outcome: { type: "number" } }, required: ["market", "round", "outcome"] } },
    { name: "has_betted_on_market", description: "Check if you have bet on a prediction market.", inputSchema: { type: "object", properties: { market: { type: "string" } }, required: ["market"] } },
    { name: "get_outcome", description: "Get data for a single prediction market outcome.", inputSchema: { type: "object", properties: { market: { type: "string" }, outcome: { type: "number" } }, required: ["market", "outcome"] } },
    { name: "get_initial_reserves", description: "Get initial reserves for a number of outcomes.", inputSchema: { type: "object", properties: { num_outcomes: { type: "number" } }, required: ["num_outcomes"] } },
    { name: "convert_to_assets", description: "Convert wSTASIS shares to STASIS value.", inputSchema: { type: "object", properties: { shares: { type: "number" } }, required: ["shares"] } },
    { name: "get_total_vault_assets", description: "Get total assets in the staking vault.", inputSchema: { type: "object", properties: {} } },
    { name: "get_token_vesting_ids", description: "Get vesting schedule IDs for a token.", inputSchema: { type: "object", properties: { token: { type: "string" } }, required: ["token"] } },
    { name: "claim_vesting_tokens", description: "Claim vested tokens from a vesting schedule.", inputSchema: { type: "object", properties: { vesting_id: { type: "number" } }, required: ["vesting_id"] } },
    { name: "take_loan_on_vesting", description: "Take a loan against a vesting schedule.", inputSchema: { type: "object", properties: { vesting_id: { type: "number" } }, required: ["vesting_id"] } },
    { name: "repay_loan_on_vesting", description: "Repay a loan taken against a vesting.", inputSchema: { type: "object", properties: { vesting_id: { type: "number" } }, required: ["vesting_id"] } },
    // ── Module 8: Vesting (10) ─────────────────────────────
    { name: "create_gradual_vesting", description: "Create gradual vesting schedule.", inputSchema: { type: "object", properties: { beneficiary: { type: "string", description: "Recipient wallet" }, token: { type: "string", description: "Token address" }, amount: { type: "number" }, start_time: { type: "number", description: "Unix timestamp" }, duration_days: { type: "number" }, time_unit: { type: "number", description: "0=Second, 1=Minute, 2=Hour, 3=Day" }, memo: { type: "string" }, ecosystem: { type: "string", description: "Ecosystem token address (default: MAINTOKEN)" } }, required: ["beneficiary", "token", "amount", "start_time", "duration_days"] } },
    { name: "create_cliff_vesting", description: "Create cliff vesting — all tokens unlock at once.", inputSchema: { type: "object", properties: { beneficiary: { type: "string" }, token: { type: "string" }, amount: { type: "number" }, unlock_time: { type: "number", description: "Unix timestamp" }, memo: { type: "string" }, ecosystem: { type: "string", description: "Ecosystem token address (default: MAINTOKEN)" } }, required: ["beneficiary", "token", "amount", "unlock_time"] } },
    { name: "get_vesting_details", description: "Get details for a vesting schedule.", inputSchema: { type: "object", properties: { vesting_id: { type: "number" } }, required: ["vesting_id"] } },
    { name: "get_vesting_count", description: "Total vesting schedules created.", inputSchema: { type: "object", properties: {} } },
    { name: "get_claimable_vesting", description: "Check claimable amount for a vesting.", inputSchema: { type: "object", properties: { vesting_id: { type: "number" } }, required: ["vesting_id"] } },
    { name: "get_my_vestings", description: "List vestings where you are beneficiary or creator.", inputSchema: { type: "object", properties: { role: { type: "string", enum: ["beneficiary", "creator"], description: "Default: beneficiary" } } } },
    { name: "change_vesting_beneficiary", description: "Transfer vesting to new beneficiary.", inputSchema: { type: "object", properties: { vesting_id: { type: "number" }, new_beneficiary: { type: "string" } }, required: ["vesting_id", "new_beneficiary"] } },
    { name: "extend_vesting", description: "Extend vesting duration.", inputSchema: { type: "object", properties: { vesting_id: { type: "number" }, days: { type: "number" } }, required: ["vesting_id", "days"] } },
    { name: "add_tokens_to_vesting", description: "Add more tokens to existing vesting.", inputSchema: { type: "object", properties: { vesting_id: { type: "number" }, amount: { type: "number" } }, required: ["vesting_id", "amount"] } },
    { name: "get_vesting_details_batch", description: "Get details for multiple vestings at once.", inputSchema: { type: "object", properties: { vesting_ids: { type: "array", items: { type: "number" } } }, required: ["vesting_ids"] } },
    { name: "get_vesting_events", description: "List vesting events from API.", inputSchema: { type: "object", properties: { action: { type: "string" }, vesting_id: { type: "number" }, limit: { type: "number" } } } },
    // ── Module 9: Order Book (4) ───────────────────────────
    { name: "list_order", description: "Place limit sell order on prediction market outcome. This is the ONLY way to sell prediction market shares — there is no AMM sell, only order book.", inputSchema: { type: "object", properties: { market: { type: "string", description: "Market token address" }, outcome: { type: "number", description: "Outcome index" }, amount: { type: "number", description: "Shares to sell" }, price_per_share: { type: "number", description: "Price per share in USDB" } }, required: ["market", "outcome", "amount", "price_per_share"] } },
    { name: "cancel_order", description: "Cancel an open order.", inputSchema: { type: "object", properties: { market: { type: "string" }, order_id: { type: "number" } }, required: ["market", "order_id"] } },
    { name: "get_order_cost", description: "Get cost to fill an order.", inputSchema: { type: "object", properties: { market: { type: "string" }, order_id: { type: "number" }, fill_amount: { type: "number" } }, required: ["market", "order_id", "fill_amount"] } },
    { name: "get_orders", description: "List orders for a market.", inputSchema: { type: "object", properties: { market: { type: "string" }, status: { type: "string" }, outcome_id: { type: "string" }, limit: { type: "number" } }, required: ["market"] } },
    { name: "get_buy_order_amounts_out", description: "Get amounts out for buying an order with USDB.", inputSchema: { type: "object", properties: { market: { type: "string" }, order_id: { type: "number" }, amount_usdb: { type: "number" } }, required: ["market", "order_id", "amount_usdb"] } },
    // ── Module 10: Taxes (7) ───────────────────────────────
    { name: "get_tax_rate", description: "Get current tax rate for a token+wallet.", inputSchema: { type: "object", properties: { token: { type: "string" }, wallet: { type: "string", description: "Default: your wallet" } }, required: ["token"] } },
    { name: "get_surge_tax", description: "Get current surge tax for a token.", inputSchema: { type: "object", properties: { token: { type: "string" } }, required: ["token"] } },
    { name: "get_base_tax_rates", description: "Get base tax rates for all token types.", inputSchema: { type: "object", properties: {} } },
    { name: "get_available_surge_quota", description: "Get remaining surge tax quota for a token.", inputSchema: { type: "object", properties: { token: { type: "string" } }, required: ["token"] } },
    { name: "start_surge_tax", description: "Start surge tax on your token (creator only).", inputSchema: { type: "object", properties: { token: { type: "string" }, start_rate: { type: "number", description: "Start rate in basis points" }, end_rate: { type: "number", description: "End rate in basis points" }, duration: { type: "number", description: "Duration in seconds" } }, required: ["token", "start_rate", "end_rate", "duration"] } },
    { name: "end_surge_tax", description: "End surge tax on your token.", inputSchema: { type: "object", properties: { token: { type: "string" } }, required: ["token"] } },
    { name: "add_dev_share", description: "Add dev fee share to a wallet for your token.", inputSchema: { type: "object", properties: { token: { type: "string" }, wallet: { type: "string" }, basis_points: { type: "number", description: "Share in basis points" } }, required: ["token", "wallet", "basis_points"] } },
    { name: "remove_dev_share", description: "Remove dev fee share from a wallet.", inputSchema: { type: "object", properties: { token: { type: "string" }, wallet: { type: "string" } }, required: ["token", "wallet"] } },
    // ── Module 11: Utility (2) ─────────────────────────────
    // ── Module 12: Reef (7) ─────────────────────────────
    { name: "get_reef_feed", description: "Get reef posts feed.", inputSchema: { type: "object", properties: { section: { type: "string", description: "Feed section (e.g. 'general')" }, limit: { type: "number" } } } },
    { name: "get_reef_highlights", description: "Get highlighted reef posts.", inputSchema: { type: "object", properties: {} } },
    { name: "create_reef_post", description: "Create a new reef post.", inputSchema: { type: "object", properties: { section: { type: "string" }, title: { type: "string" }, body: { type: "string" } }, required: ["section", "title", "body"] } },
    { name: "get_reef_post", description: "Get a single reef post with comments.", inputSchema: { type: "object", properties: { post_id: { type: "string" } }, required: ["post_id"] } },
    { name: "create_reef_comment", description: "Comment on a reef post.", inputSchema: { type: "object", properties: { post_id: { type: "string" }, body: { type: "string" } }, required: ["post_id", "body"] } },
    { name: "delete_reef_post", description: "Delete your reef post.", inputSchema: { type: "object", properties: { post_id: { type: "string" } }, required: ["post_id"] } },
    { name: "delete_reef_comment", description: "Delete your reef comment.", inputSchema: { type: "object", properties: { comment_id: { type: "string" } }, required: ["comment_id"] } },
    // ── Reef extras ─────────────────────────────────────
    { name: "edit_reef_post", description: "Edit your reef post.", inputSchema: { type: "object", properties: { post_id: { type: "string" }, title: { type: "string" }, body: { type: "string" } }, required: ["post_id"] } },
    { name: "edit_reef_comment", description: "Edit your reef comment.", inputSchema: { type: "object", properties: { comment_id: { type: "string" }, body: { type: "string" } }, required: ["comment_id", "body"] } },
    { name: "vote_reef_post", description: "Upvote/downvote a reef post.", inputSchema: { type: "object", properties: { post_id: { type: "string" }, vote: { type: "number", description: "1 = upvote, -1 = downvote, 0 = remove" } }, required: ["post_id", "vote"] } },
    { name: "vote_reef_comment", description: "Upvote/downvote a reef comment.", inputSchema: { type: "object", properties: { comment_id: { type: "string" }, vote: { type: "number", description: "1 = upvote, -1 = downvote, 0 = remove" } }, required: ["comment_id", "vote"] } },
    { name: "report_reef_post", description: "Report a reef post.", inputSchema: { type: "object", properties: { post_id: { type: "string" }, reason: { type: "string" } }, required: ["post_id"] } },
    { name: "get_reef_feed_by_wallet", description: "Get reef posts by a specific wallet.", inputSchema: { type: "object", properties: { wallet: { type: "string" }, limit: { type: "number" } }, required: ["wallet"] } },
    { name: "get_reef_votes", description: "Get vote data for reef content.", inputSchema: { type: "object", properties: { post_id: { type: "string" } }, required: ["post_id"] } },
    // ── Agent extras ───────────────────────────────────
    { name: "list_agents", description: "List registered AI agents.", inputSchema: { type: "object", properties: { page: { type: "number" }, limit: { type: "number" } } } },
    { name: "lookup_agent", description: "Lookup an agent by wallet address.", inputSchema: { type: "object", properties: { wallet: { type: "string" } }, required: ["wallet"] } },
    { name: "get_agent_uri", description: "Get the metadata URI for an agent.", inputSchema: { type: "object", properties: { agent_id: { type: "number" } }, required: ["agent_id"] } },
    { name: "set_agent_uri", description: "Update your agent's metadata URI.", inputSchema: { type: "object", properties: { agent_id: { type: "number" }, uri: { type: "string" } }, required: ["agent_id", "uri"] } },
    // ── Profile & Social ───────────────────────────────
    { name: "update_my_profile", description: "Update your profile. One action per call.", inputSchema: { type: "object", properties: { username: { type: "string", description: "Set username (null to clear)" }, social: { type: "object", properties: { platform: { type: "string" }, handle: { type: "string" } }, description: "Link a social account" }, remove_social: { type: "string", description: "Platform name to unlink" }, toggle_social_public: { type: "string", description: "Platform name to flip public/private" } } } },
    { name: "get_public_profile_referrals", description: "Get referral data for a wallet.", inputSchema: { type: "object", properties: { wallet: { type: "string" } }, required: ["wallet"] } },
    { name: "get_verified_tweets", description: "Get your verified tweets.", inputSchema: { type: "object", properties: {} } },
    { name: "submit_bug_report", description: "Submit a bug report.", inputSchema: { type: "object", properties: { title: { type: "string" }, description: { type: "string" }, severity: { type: "string", enum: ["critical", "high", "medium", "low"] }, category: { type: "string", enum: ["sdk", "contracts", "api", "frontend", "docs"] }, evidence: { type: "string" } }, required: ["title", "description", "severity", "category"] } },
    { name: "get_bug_reports", description: "Get bug reports.", inputSchema: { type: "object", properties: { status: { type: "string", enum: ["pending", "verified", "duplicate", "invalid"] }, limit: { type: "number" } } } },
    // ── Order Book extras ──────────────────────────────
    { name: "buy_order", description: "Fill a single order on the order book.", inputSchema: { type: "object", properties: { market: { type: "string" }, order_id: { type: "number" }, amount_usdb: { type: "number" } }, required: ["market", "order_id", "amount_usdb"] } },
    { name: "buy_multiple_orders", description: "Sweep multiple orders at once.", inputSchema: { type: "object", properties: { market: { type: "string" }, outcome: { type: "number" }, order_ids: { type: "array", items: { type: "number" } }, total_usdb: { type: "number" }, min_shares: { type: "number", description: "Minimum shares to receive (default: 0)" } }, required: ["market", "outcome", "order_ids", "total_usdb"] } },
    // ── Vesting extras ─────────────────────────────────
    { name: "transfer_vesting_creator", description: "Transfer vesting creator role.", inputSchema: { type: "object", properties: { vesting_id: { type: "number" }, new_creator: { type: "string" } }, required: ["vesting_id", "new_creator"] } },
    // ── Resolver extras ────────────────────────────────
    { name: "get_voter_choice", description: "Get what a voter chose in a dispute round.", inputSchema: { type: "object", properties: { market: { type: "string" }, round: { type: "number" }, voter: { type: "string", description: "Default: your wallet" } }, required: ["market", "round"] } },
    // ── Sync helpers ───────────────────────────────────
    { name: "sync_loan", description: "Sync a loan transaction.", inputSchema: { type: "object", properties: { tx_hash: { type: "string" } }, required: ["tx_hash"] } },
    { name: "sync_order", description: "Sync an order book transaction.", inputSchema: { type: "object", properties: { tx_hash: { type: "string" } }, required: ["tx_hash"] } },
    // ── Module 13: Private Markets ──────────────────────
    { name: "pm_create_market", description: "Create a private prediction market with metadata.", inputSchema: { type: "object", properties: { name: { type: "string" }, symbol: { type: "string" }, outcomes: { type: "array", items: { type: "string" } }, end_time: { type: "string" }, private_event: { type: "boolean", description: "Default: true" }, frozen: { type: "boolean" }, seed_usdb: { type: "number" }, description: { type: "string" }, image_url: { type: "string" }, website: { type: "string" }, telegram: { type: "string" }, twitter: { type: "string" } }, required: ["name", "symbol", "outcomes", "end_time"] } },
    { name: "pm_buy", description: "Buy shares in a private market outcome.", inputSchema: { type: "object", properties: { market: { type: "string" }, outcome: { type: "number" }, amount_usdb: { type: "number" } }, required: ["market", "outcome", "amount_usdb"] } },
    { name: "pm_redeem", description: "Redeem winnings from a private market.", inputSchema: { type: "object", properties: { market: { type: "string" } }, required: ["market"] } },
    { name: "pm_list_order", description: "List sell order on private market.", inputSchema: { type: "object", properties: { market: { type: "string" }, outcome: { type: "number" }, amount: { type: "number" }, price_per_share: { type: "number" } }, required: ["market", "outcome", "amount", "price_per_share"] } },
    { name: "pm_cancel_order", description: "Cancel private market order.", inputSchema: { type: "object", properties: { market: { type: "string" }, order_id: { type: "number" } }, required: ["market", "order_id"] } },
    { name: "pm_buy_order", description: "Fill a private market order.", inputSchema: { type: "object", properties: { market: { type: "string" }, order_id: { type: "number" }, amount_usdb: { type: "number" } }, required: ["market", "order_id", "amount_usdb"] } },
    { name: "pm_buy_multiple_orders", description: "Sweep multiple private market orders.", inputSchema: { type: "object", properties: { market: { type: "string" }, order_ids: { type: "array", items: { type: "number" } }, amount_usdb: { type: "number" } }, required: ["market", "order_ids", "amount_usdb"] } },
    { name: "pm_vote", description: "Vote on private market outcome.", inputSchema: { type: "object", properties: { market: { type: "string" }, outcome: { type: "number" } }, required: ["market", "outcome"] } },
    { name: "pm_finalize", description: "Finalize a private market.", inputSchema: { type: "object", properties: { market: { type: "string" } }, required: ["market"] } },
    { name: "pm_claim_bounty", description: "Claim private market bounty.", inputSchema: { type: "object", properties: { market: { type: "string" } }, required: ["market"] } },
    { name: "pm_manage_voter", description: "Add/remove voter for private market.", inputSchema: { type: "object", properties: { market: { type: "string" }, voter: { type: "string" }, status: { type: "boolean", description: "true=add, false=remove" } }, required: ["market", "voter", "status"] } },
    { name: "pm_manage_whitelist", description: "Manage private market whitelist.", inputSchema: { type: "object", properties: { market: { type: "string" }, wallets: { type: "array", items: { type: "string" } }, max_usdb: { type: "number" }, tag: { type: "string" }, status: { type: "boolean" } }, required: ["market", "wallets", "max_usdb", "status"] } },
    { name: "pm_toggle_buyers", description: "Toggle private event buyer access.", inputSchema: { type: "object", properties: { market: { type: "string" }, buyers: { type: "array", items: { type: "string" } }, status: { type: "boolean" } }, required: ["market", "buyers", "status"] } },
    { name: "pm_buy_orders_and_contract", description: "Buy from private market order book + AMM in one transaction.", inputSchema: { type: "object", properties: { market: { type: "string" }, outcome: { type: "number" }, order_ids: { type: "array", items: { type: "number" } }, amount_usdb: { type: "number" }, min_shares: { type: "number" } }, required: ["market", "outcome", "order_ids", "amount_usdb"] } },
    { name: "pm_disable_freeze", description: "Open private market to public.", inputSchema: { type: "object", properties: { market: { type: "string" } }, required: ["market"] } },
    { name: "pm_get_market_data", description: "Get private market data.", inputSchema: { type: "object", properties: { market: { type: "string" } }, required: ["market"] } },
    { name: "pm_get_user_shares", description: "Get shares in private market.", inputSchema: { type: "object", properties: { market: { type: "string" }, outcome: { type: "number" } }, required: ["market", "outcome"] } },
    { name: "pm_can_user_buy", description: "Check if you can buy on private market.", inputSchema: { type: "object", properties: { market: { type: "string" } }, required: ["market"] } },
    // ── Extra methods ──────────────────────────────────
    { name: "veto_outcome", description: "Veto a proposed market outcome (admin).", inputSchema: { type: "object", properties: { market: { type: "string" }, outcome: { type: "number" } }, required: ["market", "outcome"] } },
    { name: "buy_orders_and_contract", description: "Buy from order book + AMM in one transaction.", inputSchema: { type: "object", properties: { market: { type: "string" }, outcome: { type: "number" }, order_ids: { type: "array", items: { type: "number" } }, amount_usdb: { type: "number" }, min_shares: { type: "number" } }, required: ["market", "outcome", "order_ids", "amount_usdb"] } },
    { name: "get_agent_wallet", description: "Get wallet address for an agent ID.", inputSchema: { type: "object", properties: { agent_id: { type: "number" } }, required: ["agent_id"] } },
    { name: "get_agent_metadata", description: "Get metadata key for an agent.", inputSchema: { type: "object", properties: { agent_id: { type: "number" }, key: { type: "string" } }, required: ["agent_id", "key"] } },
    { name: "batch_create_gradual_vesting", description: "Batch create gradual vesting schedules. All share the same token, start_time, duration, time_unit, ecosystem.", inputSchema: { type: "object", properties: { beneficiaries: { type: "array", items: { type: "string" }, description: "Wallet addresses" }, token: { type: "string" }, amounts: { type: "array", items: { type: "number" }, description: "Amount per beneficiary" }, memos: { type: "array", items: { type: "string" }, description: "Memo per beneficiary" }, start_time: { type: "number" }, duration_days: { type: "number" }, time_unit: { type: "number", description: "0=Sec,1=Min,2=Hr,3=Day" }, ecosystem: { type: "string" } }, required: ["beneficiaries", "token", "amounts", "start_time", "duration_days"] } },
    { name: "batch_create_cliff_vesting", description: "Batch create cliff vestings. All share the same token, unlock_time, ecosystem.", inputSchema: { type: "object", properties: { beneficiaries: { type: "array", items: { type: "string" }, description: "Wallet addresses" }, token: { type: "string" }, amounts: { type: "array", items: { type: "number" }, description: "Amount per beneficiary" }, unlock_time: { type: "number" }, memos: { type: "array", items: { type: "string" }, description: "Memo per beneficiary" }, ecosystem: { type: "string" } }, required: ["beneficiaries", "token", "amounts", "unlock_time"] } },
    { name: "request_twitter_challenge", description: "Get a Twitter verification challenge code.", inputSchema: { type: "object", properties: {} } },
    { name: "verify_twitter", description: "Verify a Twitter challenge tweet for account linking.", inputSchema: { type: "object", properties: { tweet_url: { type: "string" } }, required: ["tweet_url"] } },
    { name: "verify_social_tweet", description: "Submit a tweet tagging @LaunchOnBasis for points. Max 3/day.", inputSchema: { type: "object", properties: { tweet_url: { type: "string" } }, required: ["tweet_url"] } },
    { name: "create_project_comment", description: "Comment on a token project.", inputSchema: { type: "object", properties: { project_id: { type: "number" }, content: { type: "string" } }, required: ["project_id", "content"] } },
    { name: "delete_project_comment", description: "Delete a project comment.", inputSchema: { type: "object", properties: { comment_id: { type: "number" } }, required: ["comment_id"] } },
    { name: "get_project_comments", description: "Get comments on a project.", inputSchema: { type: "object", properties: { project_id: { type: "number" }, limit: { type: "number" } }, required: ["project_id"] } },
    { name: "upload_image_from_url", description: "Upload an image from URL to Basis.", inputSchema: { type: "object", properties: { image_url: { type: "string" }, contract_address: { type: "string" } }, required: ["image_url"] } },
    // ── Utility ────────────────────────────────────────
    { name: "claim_faucet", description: "Claim daily USDB from faucet (up to 600/day based on eligibility signals, capped at 500 per claim). Requires SIWE session. Check get_faucet_status first.", inputSchema: { type: "object", properties: { referrer: { type: "string", description: "Referrer wallet address (optional)" } } } },
    { name: "get_faucet_status", description: "Check faucet eligibility — signals, claimable amount, cooldown timer. Must be authenticated.", inputSchema: { type: "object", properties: {} } },
    // ── Moltbook (5) ───────────────────────────────────
    { name: "link_moltbook", description: "Start linking your Moltbook account. Returns a challenge to post.", inputSchema: { type: "object", properties: { agent_name: { type: "string", description: "Your agent name on Moltbook" } }, required: ["agent_name"] } },
    { name: "verify_moltbook", description: "Verify the Moltbook challenge post to complete account linking.", inputSchema: { type: "object", properties: { agent_name: { type: "string" }, post_id: { type: "string", description: "Post UUID or URL" } }, required: ["agent_name", "post_id"] } },
    { name: "get_moltbook_status", description: "Check Moltbook link status — linked, verified, post count, karma.", inputSchema: { type: "object", properties: {} } },
    { name: "verify_moltbook_post", description: "Submit a Moltbook post for verification (earns points, max 3/day, 7-day lock-in).", inputSchema: { type: "object", properties: { post_id: { type: "string", description: "Post UUID or URL" } }, required: ["post_id"] } },
    { name: "get_verified_moltbook_posts", description: "List all your verified Moltbook posts.", inputSchema: { type: "object", properties: {} } },
    { name: "sync_transaction", description: "Manually sync a transaction to the backend.", inputSchema: { type: "object", properties: { tx_hash: { type: "string" } }, required: ["tx_hash"] } },
];
// ============================================================
// Tool handlers
// ============================================================
async function handleTool(name, args) {
    try {
        switch (name) {
            // ── Module 1: Trading ──────────────────────────────
            case "buy_token": {
                const tokenAddr = resolveToken(args.token);
                const amount = toRaw(args.amount_usdb);
                const slippage = args.slippage_percent || 1;
                const path = buildBuyPath(tokenAddr);
                const preview = await client.trading.getAmountsOut(amount, path);
                const minOut = preview * BigInt(100 - slippage) / BigInt(100);
                const tx = await client.trading.buy(tokenAddr, amount, minOut, args.wrap || false);
                return txResult(tx, { preview: { expected_output: fromRaw(preview), min_output: fromRaw(minOut) } });
            }
            case "sell_token": {
                const tokenAddr = resolveToken(args.token);
                const slippage = args.slippage_percent || 1;
                const balance = await client.publicClient.readContract({ address: tokenAddr, abi: erc20Abi, functionName: "balanceOf", args: [walletAddress] });
                if (balance === 0n)
                    return err("Token balance is zero.");
                const toUsdb = args.to_usdb !== false; // default true
                if (args.percentage) {
                    const tx = await client.trading.sellPercentage(tokenAddr, args.percentage, toUsdb);
                    return txResult(tx, { percentage_sold: args.percentage, balance_before: fromRaw(balance) });
                }
                if (!args.amount)
                    return err("Provide either 'amount' or 'percentage'");
                if (toRaw(args.amount) > balance)
                    return err(`Insufficient balance. Have: ${fromRaw(balance)}, want: ${args.amount}`);
                const amount = toRaw(args.amount);
                const path = buildSellPath(tokenAddr);
                const preview = await client.trading.getAmountsOut(amount, path);
                const minOut = preview * BigInt(100 - slippage) / BigInt(100);
                const tx = await client.trading.sell(tokenAddr, amount, toUsdb, minOut);
                return txResult(tx, { preview: { expected_usdb: fromRaw(preview), min_usdb: fromRaw(minOut) } });
            }
            case "get_price": {
                const tokenAddr = resolveToken(args.token);
                const priceRaw = await client.trading.getUSDPrice(tokenAddr);
                return ok({ token: args.token, price_usd: fromRaw(priceRaw), token_address: tokenAddr });
            }
            case "get_token_price": {
                const priceRaw = await client.trading.getTokenPrice(args.token);
                return ok({ token: args.token, price: fromRaw(priceRaw) });
            }
            case "preview_trade": {
                const tokenAddr = resolveToken(args.token);
                if (args.direction === "buy") {
                    if (!args.amount_usdb)
                        return err("amount_usdb required for buy preview");
                    const amount = toRaw(args.amount_usdb);
                    const output = await client.trading.getAmountsOut(amount, buildBuyPath(tokenAddr));
                    const tokensOut = parseFloat(fromRaw(output));
                    return ok({ direction: "buy", input_usdb: args.amount_usdb, output_tokens: fromRaw(output), effective_price: tokensOut > 0 ? args.amount_usdb / tokensOut : null });
                }
                else {
                    if (!args.amount_token)
                        return err("amount_token required for sell preview");
                    const amount = toRaw(args.amount_token);
                    const output = await client.trading.getAmountsOut(amount, buildSellPath(tokenAddr));
                    const usdbOut = parseFloat(fromRaw(output));
                    return ok({ direction: "sell", input_tokens: args.amount_token, output_usdb: fromRaw(output), effective_price: args.amount_token > 0 ? usdbOut / args.amount_token : null });
                }
            }
            case "leverage_buy": {
                const tokenAddr = resolveToken(args.token);
                const amount = toRaw(args.amount_usdb);
                const path = buildBuyPath(tokenAddr);
                const days = BigInt(args.days);
                const isFactory = tokenAddr !== client.mainTokenAddress;
                const sim = isFactory
                    ? await client.leverageSimulator.simulateLeverageFactory(amount, path, days)
                    : await client.leverageSimulator.simulateLeverage(amount, path, days);
                if (!args.confirm)
                    return ok({ simulation: sim, message: "Set confirm=true to execute after reviewing simulation." });
                const tx = await client.trading.leverageBuy(amount, 0n, path, days);
                return txResult(tx, { simulation: sim });
            }
            case "close_leverage": {
                const pct = args.percentage || 100;
                if (pct % 10 !== 0)
                    return err("Percentage must be divisible by 10");
                const tx = await client.trading.partialLoanSell(BigInt(args.position_id), BigInt(pct), true, 0n);
                return txResult(tx, { position_id: args.position_id, percentage_closed: pct });
            }
            case "get_leverage_positions": {
                const count = await client.trading.getLeverageCount(walletAddress);
                const positions = [];
                for (let i = 0n; i < count; i++) {
                    positions.push(await client.trading.getLeveragePosition(walletAddress, i));
                }
                return ok({ count: Number(count), positions });
            }
            // ── Module 2: Token Creation ────────────────────────
            case "create_token": {
                const hybridMultiplier = args.type === "stable_plus" ? 100n : BigInt(args.stability || 50);
                const tx = await client.factory.createTokenWithMetadata({
                    name: args.name, symbol: args.symbol, hybridMultiplier,
                    startLP: BigInt(args.start_lp || 1000),
                    frozen: args.frozen || false,
                    usdbForBonding: args.usdb_for_bonding ? toRaw(args.usdb_for_bonding) : undefined,
                    autoVest: args.auto_vest, autoVestDuration: args.auto_vest_duration ? BigInt(args.auto_vest_duration) : undefined,
                    description: args.description || "", imageUrl: args.image_url, website: args.website, telegram: args.telegram, twitterx: args.twitter,
                });
                return ok({ hash: tx.hash, status: tx.receipt?.status, token_address: tx.tokenAddress, image_url: tx.imageUrl });
            }
            case "unfreeze_token": {
                const receipt = await client.factory.disableFreeze(args.token);
                return ok({ hash: receipt.transactionHash, message: "Token is now public. Irreversible." });
            }
            case "whitelist_wallets": {
                const receipt = await client.factory.setWhitelistedWallet(args.token, args.wallets, toRaw(args.max_buy_usdb), args.tag || "");
                return ok({ hash: receipt.transactionHash, wallets_added: args.wallets.length });
            }
            case "get_token_state": {
                const tokenAddr = resolveToken(args.token);
                const isSystem = (0, viem_1.getAddress)(tokenAddr) === (0, viem_1.getAddress)(client.mainTokenAddress) || (0, viem_1.getAddress)(tokenAddr) === (0, viem_1.getAddress)(client.usdbAddress);
                if (isSystem) {
                    const tsAbi = (0, viem_1.parseAbi)(["function totalSupply() view returns (uint256)", "function getUSDPrice() view returns (uint256)"]);
                    const [totalSupply, usdPrice] = await Promise.all([
                        client.publicClient.readContract({ address: tokenAddr, abi: tsAbi, functionName: "totalSupply" }),
                        client.publicClient.readContract({ address: tokenAddr, abi: tsAbi, functionName: "getUSDPrice" }),
                    ]);
                    return ok({ system_token: true, total_supply: fromRaw(totalSupply), usd_price: fromRaw(usdPrice) });
                }
                const state = await client.factory.getTokenState(tokenAddr);
                return ok({ frozen: state.frozen, has_bonded: state.hasBonded, total_supply: fromRaw(state.totalSupply), usd_price: fromRaw(state.usdPrice) });
            }
            case "claim_rewards": {
                const tx = await client.factory.claimRewards(args.token);
                return txResult(tx);
            }
            case "get_claimable_rewards": {
                const investor = (args.investor || walletAddress);
                const amount = await client.factory.getClaimableRewards(args.token, investor);
                return ok({ token: args.token, investor, claimable: fromRaw(amount) });
            }
            case "get_my_tokens": {
                const tokens = await client.factory.getTokensByCreator(walletAddress);
                const enriched = [];
                for (const addr of tokens) {
                    try {
                        const state = await client.factory.getTokenState(addr);
                        const priceRaw = await client.trading.getUSDPrice(addr);
                        enriched.push({ address: addr, frozen: state.frozen, has_bonded: state.hasBonded, total_supply: fromRaw(state.totalSupply), price_usd: fromRaw(priceRaw) });
                    }
                    catch {
                        enriched.push({ address: addr, error: "Could not fetch details" });
                    }
                }
                return ok(enriched);
            }
            case "is_ecosystem_token": {
                const result = await client.factory.isEcosystemToken(args.token);
                return ok({ token: args.token, is_ecosystem: result });
            }
            case "get_fee_amount": {
                const fee = await client.factory.getFeeAmount();
                return ok({ fee_raw: fee.toString(), fee_formatted: fromRaw(fee) });
            }
            case "get_floor_price": {
                const addr = resolveToken(args.token);
                if ((0, viem_1.getAddress)(addr) === (0, viem_1.getAddress)(client.mainTokenAddress)) {
                    // STASIS floor = spot price (Stable+ token)
                    const price = await client.trading.getUSDPrice(addr);
                    return ok({ token: args.token, floor_price_usdb: fromRaw(price), note: "STASIS is Stable+ — floor equals spot price." });
                }
                const floor = await client.factory.getFloorPrice(addr);
                return ok({ token: args.token, floor_price_usdb: fromRaw(floor) });
            }
            // ── Module 3: Prediction Markets ────────────────────
            case "create_market": {
                const endTime = BigInt(typeof args.end_time === "string" && isNaN(Number(args.end_time)) ? Math.floor(new Date(args.end_time).getTime() / 1000) : Number(args.end_time));
                const tx = await client.predictionMarkets.createMarketWithMetadata({
                    marketName: args.question, symbol: args.symbol, optionNames: args.outcomes, endTime,
                    maintoken: client.mainTokenAddress, frozen: false, seedAmount: toRaw(args.seed_usdb || 50),
                    description: args.description || "", imageUrl: args.image_url,
                });
                return ok({ hash: tx.hash, status: tx.receipt?.status, market_token_address: tx.marketTokenAddress, outcomes: args.outcomes });
            }
            case "bet": {
                const market = args.market;
                const outcomeId = await resolveOutcomeId(market, args.outcome);
                const tx = await client.predictionMarkets.buy(market, outcomeId, client.usdbAddress, toRaw(args.amount_usdb), 0n, 0n);
                return txResult(tx, { outcome_index: outcomeId });
            }
            case "redeem_winnings": {
                const tx = await client.predictionMarkets.redeem(args.market);
                return txResult(tx);
            }
            case "get_market_info": {
                const m = args.market;
                const [data, outcomes] = await Promise.all([client.predictionMarkets.getMarketData(m), client.marketReader.getAllOutcomes(getMarketTradingAddress(), m)]);
                return ok({ data, outcomes });
            }
            case "propose_outcome": {
                const m = args.market;
                const id = await resolveOutcomeId(m, args.outcome);
                const tx = await client.resolver.proposeOutcome(m, id);
                return txResult(tx, { proposed_outcome: id });
            }
            case "dispute_outcome": {
                const m = args.market;
                const id = await resolveOutcomeId(m, args.outcome);
                const tx = await client.resolver.dispute(m, id);
                return txResult(tx, { disputed_with_outcome: id });
            }
            case "vote_on_dispute": {
                const m = args.market;
                const id = await resolveOutcomeId(m, args.outcome);
                const round = await client.resolver.getCurrentRound(m);
                if (await client.resolver.hasVoted(m, round, walletAddress))
                    return err("Already voted this round.");
                const tx = await client.resolver.vote(m, id);
                return txResult(tx, { voted_for: id, round: Number(round) });
            }
            case "finalize_market": {
                const m = args.market;
                const inDispute = await client.resolver.isInDispute(m);
                const tx = inDispute ? await client.resolver.finalizeMarket(m) : await client.resolver.finalizeUncontested(m);
                return txResult(tx, { method: inDispute ? "finalize_after_vote" : "finalize_uncontested" });
            }
            case "claim_bounty": {
                const m = args.market;
                if (await client.resolver.hasClaimed(m, walletAddress))
                    return err("Already claimed.");
                if (args.round !== undefined) {
                    const tx = await client.resolver.claimEarlyBounty(m, BigInt(args.round));
                    return txResult(tx, { round: args.round });
                }
                const tx = await client.resolver.claimBounty(m);
                return txResult(tx);
            }
            case "get_my_shares": {
                const m = args.market;
                if (args.outcome !== undefined) {
                    const id = await resolveOutcomeId(m, args.outcome);
                    const rawShares = await client.predictionMarkets.getUserShares(m, walletAddress, id);
                    return ok({ market: args.market, outcome_id: id, shares: fromRaw(rawShares) });
                }
                const n = Number(await client.predictionMarkets.getNumOutcomes(m));
                const names = await client.predictionMarkets.getOptionNames(m);
                const results = [];
                for (let i = 0; i < n; i++) {
                    const rawS = await client.predictionMarkets.getUserShares(m, walletAddress, i);
                    results.push({ outcome_id: i, name: names[i], shares: fromRaw(rawS) });
                }
                return ok({ market: args.market, outcomes: results });
            }
            case "resolver_stake": {
                const tx = args.action === "stake" ? await client.resolver.stake(client.mainTokenAddress) : await client.resolver.unstake(client.mainTokenAddress);
                return txResult(tx, { action: args.action, warning: args.action === "stake" ? "Tokens locked 24h after voting" : undefined });
            }
            case "get_market_resolution_status": {
                const m = args.market;
                const [disputeData, resolved, inDispute, inVeto, currentRound] = await Promise.all([
                    client.resolver.getDisputeData(m), client.resolver.isResolved(m), client.resolver.isInDispute(m), client.resolver.isInVeto(m), client.resolver.getCurrentRound(m),
                ]);
                const [hasClaimed, hasVoted] = await Promise.all([
                    client.resolver.hasClaimed(m, walletAddress),
                    client.resolver.hasVoted(m, currentRound, walletAddress).catch(() => false),
                ]);
                return ok({ resolved, in_dispute: inDispute, in_veto: inVeto, current_round: Number(currentRound), dispute_data: disputeData, your_vote: hasVoted, has_claimed: hasClaimed });
            }
            case "get_bounty_pool": {
                return ok({ bounty_pool: await client.predictionMarkets.getBountyPool(args.market) });
            }
            case "get_general_pot": {
                return ok({ general_pot: await client.predictionMarkets.getGeneralPot(args.market) });
            }
            case "estimate_shares_out": {
                const shares = await client.marketReader.estimateSharesOut(getMarketTradingAddress(), args.market, args.outcome, toRaw(args.amount_usdb), [], walletAddress);
                return ok({ market: args.market, outcome: args.outcome, amount_usdb: args.amount_usdb, estimated_shares: fromRaw(shares) });
            }
            case "get_potential_payout": {
                const usdbToPool = args.estimated_usdb_to_pool || 0;
                const newSharesFromBet = args.new_shares_from_bet || 0;
                const m = args.market;
                // Fetch pool and outcome data
                const generalPot = await client.predictionMarkets.getGeneralPot(m);
                const outcomes = await client.marketReader.getAllOutcomes(getMarketTradingAddress(), m);
                let totalCostAll = 0;
                let outcomeCirculating = 0;
                if (Array.isArray(outcomes)) {
                    for (let i = 0; i < outcomes.length; i++) {
                        const cost = parseFloat(fromRaw(outcomes[i].totalCost || outcomes[i][2] || 0n));
                        totalCostAll += cost;
                        if (i === args.outcome) {
                            outcomeCirculating = parseFloat(fromRaw(outcomes[i].circulatingShares || outcomes[i][4] || 0n));
                        }
                    }
                }
                const currentPool = parseFloat(fromRaw(generalPot)) + totalCostAll;
                const poolAfterBet = currentPool + usdbToPool;
                // New circulating = current + new shares minted from this bet
                const newCirculating = outcomeCirculating + newSharesFromBet;
                const yourShares = args.shares;
                // Resolution payout: (yourShares / winningCirculating) × totalPool
                const circForCalc = newSharesFromBet > 0 ? newCirculating : outcomeCirculating;
                const poolForCalc = usdbToPool > 0 ? poolAfterBet : currentPool;
                const payoutIfWin = circForCalc > 0 ? (yourShares / circForCalc) * poolForCalc : poolForCalc;
                return ok({
                    mode: usdbToPool === 0 ? "current_position" : "bet_preview",
                    your_shares: yourShares,
                    outcome_circulating_shares: outcomeCirculating,
                    new_circulating_after_bet: newSharesFromBet > 0 ? newCirculating.toFixed(6) : undefined,
                    total_pool: currentPool.toFixed(2),
                    total_pool_after_bet: usdbToPool > 0 ? poolAfterBet.toFixed(2) : undefined,
                    payout_if_win: payoutIfWin.toFixed(2),
                    profit_if_win: usdbToPool > 0 ? (payoutIfWin - usdbToPool).toFixed(2) : undefined,
                });
            }
            // ── Module 4: Staking / Vault ───────────────────────
            case "stake_stasis": {
                const steps = [];
                if (args.amount_usdb) {
                    const tx = await client.trading.buy(client.mainTokenAddress, toRaw(args.amount_usdb));
                    steps.push({ step: "buy_stasis", hash: tx.hash, status: tx.receipt?.status });
                }
                if (args.amount_stasis) {
                    const tx = await client.staking.buy(toRaw(args.amount_stasis));
                    steps.push({ step: "wrap_to_wstasis", hash: tx.hash, status: tx.receipt?.status });
                }
                if (args.lock && args.amount_stasis) {
                    const shares = await client.staking.convertToShares(toRaw(args.amount_stasis));
                    const tx = await client.staking.lock(shares);
                    steps.push({ step: "lock", hash: tx.hash, status: tx.receipt?.status });
                }
                if (args.lock_existing_wstasis) {
                    const tx = await client.staking.lock(toRaw(args.lock_existing_wstasis));
                    steps.push({ step: "lock_existing", hash: tx.hash, status: tx.receipt?.status });
                }
                if (!steps.length)
                    return err("Provide at least one of: amount_usdb, amount_stasis, lock_existing_wstasis");
                return ok({ steps });
            }
            case "unstake_stasis": {
                const steps = [];
                const shares = args.shares ? toRaw(args.shares) : undefined;
                if (args.unlock) {
                    if (!shares)
                        return err("Provide 'shares' to unlock");
                    const tx = await client.staking.unlock(shares);
                    steps.push({ step: "unlock", hash: tx.hash, status: tx.receipt?.status });
                }
                if (shares) {
                    const tx = await client.staking.sell(shares, args.sell_to_usdb || false, 0n);
                    steps.push({ step: "sell", hash: tx.hash, status: tx.receipt?.status });
                }
                else if (!args.unlock)
                    return err("Provide 'shares' amount");
                return ok({ steps });
            }
            case "vault_borrow": {
                const available = await client.staking.getAvailableStasis(walletAddress);
                const tx = await client.staking.borrow(toRaw(args.amount_stasis), BigInt(args.days));
                return txResult(tx, { available_before: fromRaw(available), fee_info: "2% origination + 0.005%/day (prepaid)" });
            }
            case "vault_repay": {
                const tx = await client.staking.repay();
                return txResult(tx, { message: "Vault loan repaid. Collateral unlocked." });
            }
            case "get_vault_status": {
                const raw = await client.staking.getUserStakeDetails(walletAddress);
                const available = await client.staking.getAvailableStasis(walletAddress);
                return ok({ liquid_shares: fromRaw(raw[0]), locked_shares: fromRaw(raw[1]), total_shares: fromRaw(raw[2]), total_stasis_value: fromRaw(raw[3]), available_to_borrow: fromRaw(available), has_active_loan: raw[1] > 0n });
            }
            case "extend_loan": {
                const refinance = args.refinance || false;
                const payInStable = args.pay_in_stable !== false;
                if (args.loan_type === "vault") {
                    const tx = await client.staking.extendLoan(BigInt(args.days), payInStable, refinance);
                    return txResult(tx, { days_added: args.days });
                }
                if (!args.hub_id)
                    return err("hub_id required for hub loans");
                const tx = await client.loans.extendLoan(BigInt(args.hub_id), BigInt(args.days), payInStable, refinance);
                return txResult(tx, { hub_id: args.hub_id, days_added: args.days });
            }
            // ── Module 5: Loans ─────────────────────────────────
            case "take_loan": {
                const tx = await client.loans.takeLoan(client.mainTokenAddress, resolveToken(args.collateral_token), toRaw(args.amount), BigInt(args.days));
                return txResult(tx, { fee_info: "2% origination + 0.005%/day (prepaid)" });
            }
            case "repay_loan": {
                const tx = await client.loans.repayLoan(BigInt(args.hub_id));
                return txResult(tx, { hub_id: args.hub_id });
            }
            case "get_loans": {
                const resp = await client.api.getLoans({ active: args.active_only !== false });
                return ok(resp.data);
            }
            case "get_user_loan_details": {
                const details = await client.loans.getUserLoanDetails(walletAddress, BigInt(args.hub_id));
                return ok({ hub_id: args.hub_id, details });
            }
            case "get_user_loan_count": {
                const count = await client.loans.getUserLoanCount(walletAddress);
                return ok({ count: Number(count) });
            }
            case "increase_loan_collateral": {
                const amount = toRaw(args.amount);
                if (args.loan_type === "hub") {
                    if (!args.hub_id)
                        return err("hub_id required");
                    const tx = await client.loans.increaseLoan(BigInt(args.hub_id), amount);
                    return txResult(tx);
                }
                const tx = await client.staking.addToLoan(amount);
                return txResult(tx);
            }
            case "claim_liquidation": {
                if (args.loan_type === "hub") {
                    if (!args.hub_id)
                        return err("hub_id required");
                    const tx = await client.loans.claimLiquidation(BigInt(args.hub_id));
                    return txResult(tx);
                }
                const tx = await client.staking.settleLiquidation();
                return txResult(tx);
            }
            case "partial_loan_sell": {
                if (args.percentage % 10 !== 0)
                    return err("Percentage must be divisible by 10");
                const tx = await client.loans.hubPartialLoanSell(BigInt(args.hub_id), BigInt(args.percentage), false, 0n);
                return txResult(tx, { hub_id: args.hub_id, percentage_sold: args.percentage });
            }
            // ── Module 6: Portfolio & Data ─────────────────────
            case "get_balances": {
                const [usdbBal, stasisBal, vaultRaw] = await Promise.all([
                    client.publicClient.readContract({ address: client.usdbAddress, abi: erc20Abi, functionName: "balanceOf", args: [walletAddress] }),
                    client.publicClient.readContract({ address: client.mainTokenAddress, abi: erc20Abi, functionName: "balanceOf", args: [walletAddress] }),
                    client.staking.getUserStakeDetails(walletAddress).catch(() => null),
                ]);
                let wstasis = null, wstasis_value = null;
                if (vaultRaw) {
                    const v = vaultRaw;
                    wstasis = fromRaw(v[2]);
                    wstasis_value = fromRaw(v[3]);
                }
                const tokens = [];
                try {
                    const txResp = await client.api.getWalletTransactions(walletAddress, { limit: 200 });
                    const seen = new Set();
                    for (const t of txResp.data) {
                        const addr = String(t.contractAddress || "");
                        if (!addr || seen.has(addr) || (0, viem_1.getAddress)(addr) === (0, viem_1.getAddress)(client.usdbAddress) || (0, viem_1.getAddress)(addr) === (0, viem_1.getAddress)(client.mainTokenAddress))
                            continue;
                        seen.add(addr);
                        try {
                            const bal = await client.publicClient.readContract({ address: addr, abi: erc20Abi, functionName: "balanceOf", args: [walletAddress] });
                            if (bal > 0n) {
                                let usd = null;
                                try {
                                    const p = await client.trading.getUSDPrice(addr);
                                    usd = (parseFloat(fromRaw(p)) * parseFloat(fromRaw(bal))).toFixed(2);
                                }
                                catch { }
                                let sym = "UNKNOWN";
                                for (const [n, a] of tokenCache)
                                    if (a === addr) {
                                        sym = n;
                                        break;
                                    }
                                tokens.push({ address: addr, symbol: sym, balance: fromRaw(bal), usd_value: usd });
                            }
                        }
                        catch { }
                    }
                }
                catch { }
                return ok({ wallet: walletAddress, usdb: fromRaw(usdbBal), stasis: fromRaw(stasisBal), wstasis, wstasis_value_stasis: wstasis_value, tokens });
            }
            case "get_market_list": {
                return ok((await client.api.getTokens({ isPrediction: true, limit: args.limit || 20 })).data);
            }
            case "get_token_list": {
                return ok((await client.api.getTokens({ search: args.search, limit: args.limit || 20 })).data);
            }
            case "get_token_detail": {
                return ok((await client.api.getToken(args.token)).data);
            }
            case "get_price_history": {
                const r = await client.api.getCandles(resolveToken(args.token), { interval: args.interval || "1h", limit: args.limit || 100 });
                return ok({ token: args.token, interval: args.interval || "1h", candles: r.data });
            }
            case "get_trade_history": {
                return ok((await client.api.getTrades(resolveToken(args.token), { type: args.type, limit: args.limit || 20 })).data);
            }
            case "get_platform_stats": {
                return ok(await client.api.getPulse());
            }
            case "get_my_stats": {
                return ok(await client.api.getMyStats());
            }
            case "get_my_profile": {
                return ok(await client.api.getMyProfile());
            }
            case "remove_whitelist": {
                const r = await client.factory.removeWhitelist(args.token, args.wallet);
                return ok({ hash: r.transactionHash });
            }
            case "get_leaderboard": {
                return ok((await client.api.getLeaderboard({ page: args.page || 1, limit: args.limit || 20 })).data);
            }
            case "get_public_profile": {
                return ok(await client.api.getPublicProfile(args.wallet));
            }
            case "get_my_projects": {
                return ok(await client.api.getMyProjects());
            }
            case "get_my_referrals": {
                return ok(await client.api.getMyReferrals());
            }
            case "get_whitelist": {
                return ok((await client.api.getWhitelist(args.token, { wallet: args.wallet, limit: args.limit || 50 })).data);
            }
            case "get_token_comments": {
                return ok((await client.api.getTokenComments(args.token, { limit: args.limit || 20 })).data);
            }
            case "get_loan_events": {
                return ok((await client.api.getLoanEvents({ source: args.source, action: args.action, limit: args.limit || 20 })).data);
            }
            case "get_vault_events": {
                return ok((await client.api.getVaultEvents({ action: args.action, limit: args.limit || 20 })).data);
            }
            case "get_market_events": {
                return ok((await client.api.getMarketEvents({ action: args.action, marketToken: args.market_token, limit: args.limit || 20 })).data);
            }
            case "get_market_liquidity": {
                return ok((await client.api.getMarketLiquidity(args.market, { outcomeId: args.outcome_id, limit: args.limit || 20 })).data);
            }
            // ── Module 7: Agent Identity ────────────────────────
            case "register_agent": {
                const agentId = await client.agent.registerAndSync({ name: args.name, description: args.description, capabilities: args.capabilities });
                return ok({ agent_id: Number(agentId), message: "Agent registered on-chain (ERC-8004)" });
            }
            case "is_agent_registered": {
                const w = (args.wallet || walletAddress);
                return ok({ wallet: w, registered: await client.agent.isRegistered(w) });
            }
            // ── Additional reads ───────────────────────────────
            case "get_final_outcome": {
                return ok({ outcome: await client.resolver.getFinalOutcome(args.market) });
            }
            case "get_resolver_constants": {
                return ok(await client.resolver.getConstants());
            }
            case "is_resolver_voter": {
                return ok({ voter: await client.resolver.isVoter((args.wallet || walletAddress)) });
            }
            case "get_resolver_stake": {
                return ok({ stake: await client.resolver.getUserStake((args.wallet || walletAddress)) });
            }
            case "get_bounty_per_vote": {
                return ok({ bounty_per_vote: await client.resolver.getBountyPerVote(args.market) });
            }
            case "get_vote_count": {
                return ok({ count: await client.resolver.getVoteCount(args.market, BigInt(args.round), args.outcome) });
            }
            case "has_betted_on_market": {
                return ok({ has_betted: await client.predictionMarkets.hasBettedOnMarket(args.market, walletAddress) });
            }
            case "get_outcome": {
                return ok(await client.predictionMarkets.getOutcome(args.market, args.outcome));
            }
            case "get_initial_reserves": {
                return ok(await client.predictionMarkets.getInitialReserves(BigInt(args.num_outcomes)));
            }
            case "convert_to_assets": {
                return ok({ stasis_value: fromRaw(await client.staking.convertToAssets(toRaw(args.shares))) });
            }
            case "get_total_vault_assets": {
                return ok({ total_assets: fromRaw(await client.staking.totalAssets()) });
            }
            case "get_token_vesting_ids": {
                const events = await client.api.getVestingEvents({ limit: 200 });
                const ids = new Set();
                for (const e of events.data) {
                    const evt = e;
                    if (evt.vestingId !== undefined && (!args.token || evt.token?.toLowerCase() === args.token.toLowerCase())) {
                        ids.add(Number(evt.vestingId));
                    }
                }
                return ok({ vesting_ids: [...ids] });
            }
            case "claim_vesting_tokens": {
                const tx = await client.vesting.claimTokens(BigInt(args.vesting_id));
                return txResult(tx);
            }
            case "take_loan_on_vesting": {
                const tx = await client.vesting.takeLoanOnVesting(BigInt(args.vesting_id));
                return txResult(tx);
            }
            case "repay_loan_on_vesting": {
                const tx = await client.vesting.repayLoanOnVesting(BigInt(args.vesting_id));
                return txResult(tx);
            }
            // ── Module 8: Vesting ──────────────────────────────
            case "create_gradual_vesting": {
                const eco = (args.ecosystem || client.mainTokenAddress);
                const tx = await client.vesting.createGradualVesting(args.beneficiary, args.token, toRaw(args.amount), BigInt(args.start_time), BigInt(args.duration_days), args.time_unit || 3, args.memo || "", eco);
                return txResult(tx);
            }
            case "create_cliff_vesting": {
                const eco = (args.ecosystem || client.mainTokenAddress);
                const tx = await client.vesting.createCliffVesting(args.beneficiary, args.token, toRaw(args.amount), BigInt(args.unlock_time), args.memo || "", eco);
                return txResult(tx);
            }
            case "get_vesting_details": {
                return ok(await client.vesting.getVestingDetails(BigInt(args.vesting_id)));
            }
            case "get_vesting_count": {
                return ok({ count: Number(await client.vesting.getVestingCount()) });
            }
            case "get_claimable_vesting": {
                const [vested, claimable, activeLoan] = await Promise.all([
                    client.vesting.getVestedAmount(BigInt(args.vesting_id)),
                    client.vesting.getClaimableAmount(BigInt(args.vesting_id)),
                    client.vesting.getActiveLoan(BigInt(args.vesting_id)),
                ]);
                return ok({ vesting_id: args.vesting_id, vested: fromRaw(vested), claimable: fromRaw(claimable), active_loan: fromRaw(activeLoan) });
            }
            case "get_my_vestings": {
                const ids = args.role === "creator"
                    ? await client.vesting.getVestingsByCreator(walletAddress)
                    : await client.vesting.getVestingsByBeneficiary(walletAddress);
                return ok({ role: args.role || "beneficiary", vesting_ids: ids.map(Number) });
            }
            case "change_vesting_beneficiary": {
                const tx = await client.vesting.changeBeneficiary(BigInt(args.vesting_id), args.new_beneficiary);
                return txResult(tx);
            }
            case "extend_vesting": {
                const tx = await client.vesting.extendVestingPeriod(BigInt(args.vesting_id), BigInt(args.days));
                return txResult(tx);
            }
            case "add_tokens_to_vesting": {
                const tx = await client.vesting.addTokensToVesting(BigInt(args.vesting_id), toRaw(args.amount));
                return txResult(tx);
            }
            case "get_vesting_details_batch": {
                return ok(await client.vesting.getVestingDetailsBatch(args.vesting_ids.map((id) => BigInt(id))));
            }
            case "get_vesting_events": {
                return ok((await client.api.getVestingEvents({ action: args.action, vestingId: args.vesting_id, limit: args.limit || 20 })).data);
            }
            // ── Module 9: Order Book ───────────────────────────
            case "list_order": {
                const tx = await client.orderBook.listOrder(args.market, args.outcome, toRaw(args.amount), toRaw(args.price_per_share));
                return txResult(tx);
            }
            case "cancel_order": {
                const tx = await client.orderBook.cancelOrder(args.market, BigInt(args.order_id));
                return txResult(tx);
            }
            case "get_order_cost": {
                return ok(await client.orderBook.getBuyOrderCost(args.market, BigInt(args.order_id), toRaw(args.fill_amount)));
            }
            case "get_orders": {
                return ok((await client.api.getOrders(args.market, { status: args.status, outcomeId: args.outcome_id, limit: args.limit || 20 })).data);
            }
            case "get_buy_order_amounts_out": {
                return ok(await client.orderBook.getBuyOrderAmountsOut(args.market, BigInt(args.order_id), toRaw(args.amount_usdb)));
            }
            // ── Module 10: Taxes ───────────────────────────────
            case "get_tax_rate": {
                return ok({ rate: await client.taxes.getTaxRate(args.token, (args.wallet || walletAddress)) });
            }
            case "get_surge_tax": {
                return ok({ surge_tax: await client.taxes.getCurrentSurgeTax(args.token) });
            }
            case "get_base_tax_rates": {
                return ok(await client.taxes.getBaseTaxRates());
            }
            case "get_available_surge_quota": {
                return ok({ quota: await client.taxes.getAvailableSurgeQuota(args.token) });
            }
            case "start_surge_tax": {
                const tx = await client.taxes.startSurgeTax(BigInt(args.start_rate), BigInt(args.end_rate), BigInt(args.duration), args.token);
                return txResult(tx);
            }
            case "end_surge_tax": {
                const tx = await client.taxes.endSurgeTax(args.token);
                return txResult(tx);
            }
            case "add_dev_share": {
                const tx = await client.taxes.addDevShare(args.token, args.wallet, BigInt(args.basis_points));
                return txResult(tx);
            }
            case "remove_dev_share": {
                const tx = await client.taxes.removeDevShare(args.token, args.wallet);
                return txResult(tx);
            }
            // ── Module 11: Utility ─────────────────────────────
            // ── Module 12: Reef ───────────────────────────────
            case "get_reef_feed": {
                return ok((await client.api.getReefFeed({ section: args.section, limit: args.limit || 20 })).data);
            }
            case "get_reef_highlights": {
                return ok((await client.api.getReefHighlights()).data);
            }
            case "create_reef_post": {
                return ok(await client.api.createReefPost({ section: args.section, title: args.title, body: args.body }));
            }
            case "get_reef_post": {
                return ok(await client.api.getReefPost(args.post_id));
            }
            case "create_reef_comment": {
                return ok(await client.api.createReefComment(args.post_id, args.body));
            }
            case "delete_reef_post": {
                return ok(await client.api.deleteReefPost(args.post_id));
            }
            case "delete_reef_comment": {
                return ok(await client.api.deleteReefComment(args.comment_id));
            }
            // ── Reef extras ─────────────────────────────────────
            case "edit_reef_post": {
                return ok(await client.api.editReefPost(args.post_id, { title: args.title, body: args.body }));
            }
            case "edit_reef_comment": {
                return ok(await client.api.editReefComment(args.comment_id, args.body));
            }
            case "vote_reef_post": {
                return ok(await client.api.voteReefPost(args.post_id));
            }
            case "vote_reef_comment": {
                return ok(await client.api.voteReefComment(args.comment_id));
            }
            case "report_reef_post": {
                return ok(await client.api.reportReefPost(args.post_id, args.reason));
            }
            case "get_reef_feed_by_wallet": {
                return ok((await client.api.getReefFeedByWallet(args.wallet, { limit: args.limit || 20 })).data);
            }
            case "get_reef_votes": {
                return ok(await client.api.getReefVotes(args.post_id));
            }
            // ── Agent extras ───────────────────────────────────
            case "list_agents": {
                return ok(await client.agent.listAgents(args.page || 1, args.limit || 20));
            }
            case "lookup_agent": {
                return ok(await client.agent.lookupFromApi(args.wallet));
            }
            case "get_agent_uri": {
                return ok({ uri: await client.agent.getAgentURI(BigInt(args.agent_id)) });
            }
            case "set_agent_uri": {
                const tx = await client.agent.setAgentURI(BigInt(args.agent_id), args.uri);
                return txResult(tx);
            }
            // ── Profile & Social ───────────────────────────────
            case "update_my_profile": {
                const payload = {};
                if (args.username !== undefined)
                    payload.username = args.username;
                if (args.social)
                    payload.social = args.social;
                if (args.remove_social)
                    payload.removeSocial = args.remove_social;
                if (args.toggle_social_public)
                    payload.toggleSocialPublic = args.toggle_social_public;
                return ok(await client.api.updateMyProfile(payload));
            }
            case "get_public_profile_referrals": {
                return ok(await client.api.getPublicProfileReferrals(args.wallet));
            }
            case "get_verified_tweets": {
                return ok(await client.api.getVerifiedTweets());
            }
            case "submit_bug_report": {
                return ok(await client.api.submitBugReport({ title: args.title, description: args.description, severity: args.severity, category: args.category, evidence: args.evidence }));
            }
            case "get_bug_reports": {
                return ok((await client.api.getBugReports({ status: args.status, limit: args.limit || 20 })).data);
            }
            // ── Order Book extras ──────────────────────────────
            case "buy_order": {
                const tx = await client.orderBook.buyOrder(args.market, BigInt(args.order_id), toRaw(args.amount_usdb));
                return txResult(tx);
            }
            case "buy_multiple_orders": {
                const tx = await client.orderBook.buyMultipleOrders(args.market, args.order_ids.map((id) => BigInt(id)), toRaw(args.total_usdb));
                return txResult(tx);
            }
            // ── Vesting extras ─────────────────────────────────
            case "transfer_vesting_creator": {
                const tx = await client.vesting.transferCreatorRole(BigInt(args.vesting_id), args.new_creator);
                return txResult(tx);
            }
            // ── Resolver extras ────────────────────────────────
            case "get_voter_choice": {
                return ok({ choice: await client.resolver.getVoterChoice(args.market, BigInt(args.round), (args.voter || walletAddress)) });
            }
            // ── Sync helpers ───────────────────────────────────
            case "sync_loan": {
                return ok(await client.api.syncLoan(args.tx_hash));
            }
            case "sync_order": {
                return ok(await client.api.syncOrder(args.tx_hash));
            }
            // ── Module 13: Private Markets ──────────────────────
            case "pm_create_market": {
                const endTime = BigInt(typeof args.end_time === "string" && isNaN(Number(args.end_time)) ? Math.floor(new Date(args.end_time).getTime() / 1000) : Number(args.end_time));
                const tx = await client.privateMarkets.createMarketWithMetadata({
                    marketName: args.name, symbol: args.symbol, endTime, optionNames: args.outcomes,
                    maintoken: client.mainTokenAddress, privateEvent: args.private_event !== false,
                    frozen: args.frozen || false, seedAmount: toRaw(args.seed_usdb || 50),
                    description: args.description || "", imageUrl: args.image_url,
                    website: args.website, telegram: args.telegram, twitterx: args.twitter,
                });
                return ok({ hash: tx.hash, status: tx.receipt?.status, market_token_address: tx.marketTokenAddress, image_url: tx.imageUrl });
            }
            case "pm_buy": {
                const tx = await client.privateMarkets.buy(args.market, args.outcome, client.usdbAddress, toRaw(args.amount_usdb), 0n, 0n);
                return txResult(tx);
            }
            case "pm_redeem": {
                const tx = await client.privateMarkets.redeem(args.market);
                return txResult(tx);
            }
            case "pm_list_order": {
                const tx = await client.privateMarkets.listOrder(args.market, args.outcome, toRaw(args.amount), toRaw(args.price_per_share));
                return txResult(tx);
            }
            case "pm_cancel_order": {
                const tx = await client.privateMarkets.cancelOrder(args.market, BigInt(args.order_id));
                return txResult(tx);
            }
            case "pm_buy_order": {
                const tx = await client.privateMarkets.buyOrder(args.market, BigInt(args.order_id), toRaw(args.amount_usdb));
                return txResult(tx);
            }
            case "pm_buy_multiple_orders": {
                const tx = await client.privateMarkets.buyMultipleOrders(args.market, args.order_ids.map((id) => BigInt(id)), toRaw(args.amount_usdb));
                return txResult(tx);
            }
            case "pm_vote": {
                const tx = await client.privateMarkets.vote(args.market, args.outcome);
                return txResult(tx);
            }
            case "pm_finalize": {
                const tx = await client.privateMarkets.finalize(args.market);
                return txResult(tx);
            }
            case "pm_claim_bounty": {
                const tx = await client.privateMarkets.claimBounty(args.market);
                return txResult(tx);
            }
            case "pm_manage_voter": {
                const tx = await client.privateMarkets.manageVoter(args.market, args.voter, args.status);
                return txResult(tx);
            }
            case "pm_manage_whitelist": {
                const tx = await client.privateMarkets.manageWhitelist(args.market, args.wallets, toRaw(args.max_usdb), args.tag || "", args.status);
                return txResult(tx);
            }
            case "pm_toggle_buyers": {
                const tx = await client.privateMarkets.togglePrivateEventBuyers(args.market, args.buyers, args.status);
                return txResult(tx);
            }
            case "pm_buy_orders_and_contract": {
                const tx = await client.privateMarkets.buyOrdersAndContract(args.market, args.outcome, args.order_ids.map((id) => BigInt(id)), client.usdbAddress, toRaw(args.amount_usdb), toRaw(args.min_shares || 0));
                return txResult(tx);
            }
            case "pm_disable_freeze": {
                const tx = await client.privateMarkets.disableFreeze(args.market);
                return txResult(tx);
            }
            case "pm_get_market_data": {
                return ok(await client.privateMarkets.getMarketData(args.market));
            }
            case "pm_get_user_shares": {
                const rawS = await client.privateMarkets.getUserShares(args.market, walletAddress, args.outcome);
                return ok({ shares: fromRaw(rawS) });
            }
            case "pm_can_user_buy": {
                return ok({ can_buy: await client.privateMarkets.canUserBuy(args.market, walletAddress) });
            }
            // ── Extra methods ──────────────────────────────────
            case "veto_outcome": {
                const tx = await client.resolver.veto(args.market, args.outcome);
                return txResult(tx);
            }
            case "buy_orders_and_contract": {
                const tx = await client.predictionMarkets.buyOrdersAndContract(args.market, args.outcome, args.order_ids.map((id) => BigInt(id)), client.usdbAddress, toRaw(args.amount_usdb), toRaw(args.min_shares || 0));
                return txResult(tx);
            }
            case "get_agent_wallet": {
                return ok({ wallet: await client.agent.getAgentWallet(BigInt(args.agent_id)) });
            }
            case "get_agent_metadata": {
                return ok({ value: await client.agent.getMetadata(BigInt(args.agent_id), args.key) });
            }
            case "batch_create_gradual_vesting": {
                const tx = await client.vesting.batchCreateGradualVesting(args.beneficiaries, args.token, args.amounts.map((a) => toRaw(a)), args.memos || args.beneficiaries.map(() => ""), BigInt(args.start_time), BigInt(args.duration_days), args.time_unit || 3, (args.ecosystem || client.mainTokenAddress));
                return txResult(tx);
            }
            case "batch_create_cliff_vesting": {
                const tx = await client.vesting.batchCreateCliffVesting(args.beneficiaries, args.token, args.amounts.map((a) => toRaw(a)), BigInt(args.unlock_time), args.memos || args.beneficiaries.map(() => ""), (args.ecosystem || client.mainTokenAddress));
                return txResult(tx);
            }
            case "request_twitter_challenge": {
                return ok(await client.api.requestTwitterChallenge());
            }
            case "verify_twitter": {
                return ok(await client.api.verifyTwitter(args.tweet_url));
            }
            case "verify_social_tweet": {
                return ok(await client.api.verifySocialTweet(args.tweet_url));
            }
            case "create_project_comment": {
                return ok(await client.api.createComment(args.project_id, args.content, walletAddress));
            }
            case "delete_project_comment": {
                return ok(await client.api.deleteComment(args.comment_id, walletAddress));
            }
            case "get_project_comments": {
                return ok((await client.api.getComments(args.project_id, { limit: args.limit || 20 })).data);
            }
            case "upload_image_from_url": {
                return ok({ url: await client.api.uploadImageFromUrl(args.image_url, args.contract_address) });
            }
            // ── Utility ────────────────────────────────────────
            case "claim_faucet": {
                return ok(await client.claimFaucet(args.referrer));
            }
            case "get_faucet_status": {
                return ok(await client.api.getFaucetStatus());
            }
            // ── Moltbook ───────────────────────────────────────
            case "link_moltbook": {
                return ok(await client.api.linkMoltbook(args.agent_name));
            }
            case "verify_moltbook": {
                return ok(await client.api.verifyMoltbook(args.agent_name, args.post_id));
            }
            case "get_moltbook_status": {
                return ok(await client.api.getMoltbookStatus());
            }
            case "verify_moltbook_post": {
                return ok(await client.api.verifyMoltbookPost(args.post_id));
            }
            case "get_verified_moltbook_posts": {
                return ok(await client.api.getVerifiedMoltbookPosts());
            }
            case "sync_transaction": {
                return ok(await client.api.syncTransaction(args.tx_hash));
            }
            default: return err(`Unknown tool: ${name}`);
        }
    }
    catch (error) {
        return err(error?.message || String(error));
    }
}
// ============================================================
// MCP Server setup
// ============================================================
async function main() {
    await initClient();
    const server = new index_js_1.Server({ name: "basis-mcp-server", version: "1.0.0" }, { capabilities: { tools: {} } });
    server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => ({ tools: TOOLS }));
    server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => handleTool(request.params.name, request.params.arguments || {}));
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
    console.error("Basis MCP Server running on stdio");
}
main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
