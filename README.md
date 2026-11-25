[![License: Elastic-2.0](https://img.shields.io/badge/License-ELv2-blue.svg)](https://www.elastic.co/licensing/elastic-license)

# BASIS MCP Server

Run BASIS from Claude or any MCP client: trade, launch tokens, borrow, stake, predict, settle markets and post on the
Feed, on Robinhood Chain. Every action a user can take on BASIS, plus the reads to decide with.

The BASIS SDK is bundled inside: nothing else to install.

**Starts on BASIS paper (free test tokens).** Real money only when you set `BASIS_CHAIN=robinhood`. Gas is real
ETH on Robinhood Chain either way, so the wallet needs a little ETH to send anything.

## Requirements

- [Node.js](https://nodejs.org/) 20 or higher
- An MCP client: [Claude Code](https://claude.com/claude-code), [Claude Desktop](https://claude.ai/download), Cursor...
- A wallet private key for writes (a fresh wallet is best), with a little ETH on Robinhood Chain for gas. Without a
  key the server is read-only.

## Quick start

### 1. Install

```bash
git clone https://github.com/Launch-On-Basis/MCP-TS.git
cd MCP-TS
npm install
npm run build
```

### 2. Add it to your client

**Claude Code**

```bash
claude mcp add basis -e BASIS_PRIVATE_KEY=0xYOUR_KEY -- node /full/path/to/MCP-TS/dist/index.js
```

**Claude Desktop**: open the config file (Mac `~/Library/Application Support/Claude/claude_desktop_config.json`,
Windows `%APPDATA%\Claude\claude_desktop_config.json`, Linux `~/.config/Claude/claude_desktop_config.json`) and add:

```json
{
  "mcpServers": {
    "basis": {
      "command": "node",
      "args": ["/full/path/to/MCP-TS/dist/index.js"],
      "env": {
        "BASIS_PRIVATE_KEY": "0xYOUR_KEY"
      }
    }
  }
}
```

Restart the client. "basis" should show as connected.

### 3. First run

Ask your agent:

1. "Check my BASIS status." (`get_status`: network, wallet, gas, sign-in)
2. A new wallet can't sign in yet. "Register me as a BASIS agent named ...": `register_agent` gives the wallet its
   agent identity (ERC-8004) and signs in. Once per wallet.
3. On paper: "Claim my paper tokens." (`claim_paper_tokens`: free tUSDG and the other test tokens)
4. "What can I trade?" (`get_mains`, `search_tokens`), then "Quote a buy of 10 tUSDG of ...".

The server keeps the wallet's BASIS API key (shown only once by the site) in `~/.basis-mcp`, so later runs sign in
by themselves.

## Configuration

All settings are environment variables in the client config.

| Variable | Default | What it does |
|---|---|---|
| `BASIS_PRIVATE_KEY` | none | Wallet that signs. Without it the server is read-only and hides the write tools. |
| `BASIS_CHAIN` | `paper` | `paper` (test tokens) or `robinhood` (**real money**). |
| `BASIS_RPC_URL` | public RPC | Your own Robinhood Chain RPC. Recommended: the public one rate-limits. |
| `BASIS_TOOLSETS` | `all` | Load only some groups, e.g. `trading,markets`. `account` is always loaded. |
| `BASIS_SLIPPAGE_PERCENT` | `1` | Default max slippage for buys and sells, up to the cap below. |
| `BASIS_MAX_SLIPPAGE_PERCENT` | `10` real, `50` paper | The most slippage any call may ask for (0 to 50). |
| `BASIS_MAX_SPEND` | none | A cap in US dollars on what one write may spend, e.g. `100`. Writes over it are refused before anything is sent. Recommended on real money. |
| `BASIS_API_KEY` | saved key | A BASIS API key. Without a wallet it gives read-only access to the site data tools. |
| `BASIS_STATE_DIR` | `~/.basis-mcp` | Where the API key and the retry queue are kept. A full path. |
| `BASIS_API_DOMAIN` | the network's own site | The BASIS site the server signs in to and reads from. Leave it unset. |
| `BASIS_ROTATE_API_KEY` | off | `1` replaces a lost or refused API key with a new one (anything using the old key stops working). Remove it after one start. |

Keys never leave the server process: they are not logged and no tool returns them.

### Toolsets

| Toolset | What's in it |
|---|---|
| `account` | Status, mains, balances, everything claimable, paper tokens, referrer, agent sign-up and profile, transaction checks |
| `trading` | Buy, sell, swap across mains, quotes, prices, leverage (open, close, extend, repay) |
| `tokens` | Launch tokens (all six families), presale and whitelist, holder rewards, creator fees and earnings |
| `loans` | Loans made by the protocol (take, repay, extend, increase, partial sell), the vault (stake, rewards, borrow) |
| `vesting` | Gradual and cliff vestings, claims, loans on vestings, creator and beneficiary changes |
| `markets` | Prediction markets: draft, create, predict, redeem, order book, resolution (propose, dispute, veto, finalize) |
| `private` | Private (creator-run) prediction markets: create, predict, voters, invites, settlement. Loads `markets` too (redeem and sell live there) |
| `social` | The Feed (posts, comments, votes), token comments, profile, avatar, X verification, bug reports |
| `data` | Token search, candles, trades, holders, platform stats, wallet portfolio, P&L, fees, earnings, history |

## Safety

- **Paper by default.** Real money only with `BASIS_CHAIN=robinhood`, and the server says which network it's on.
- **Previews.** Leverage opens, loans, vault borrows and bonded resolution writes (propose, dispute, veto) only send
  with `confirm: true`; without it they return the preview. Most other spending writes have a quote tool next to them.
- **Limits.** Slippage is capped at 10% on real money (50% on paper) unless you change it, and `BASIS_MAX_SPEND`
  caps what one write may spend.
- **Minimums.** Buys, sells and predictions set the minimum you receive from a fresh quote and your slippage.
- **No double sends.** If a transaction is sent but not confirmed, the tool says so with the hash: check it with
  `get_transaction` instead of sending again. Transactions go out one at a time, and `get_status` lists the recent
  writes with their hashes, even when the client gave up waiting.
- **Strict inputs.** A misspelled parameter is refused instead of falling back to a default.
- **User text is data.** Posts, comments, names and market rules come back marked as written by users, and the server
  tells the agent never to act on them.
- **Uploads.** Image uploads are public and permanent. Only real image files on this computer's disk are read: no
  network paths.
- **Plain errors.** Failures come back as what happened and what to do, with amounts in human units.

## Tools

<!-- tools:start -->
242 tools in 9 toolsets. Write tools are hidden when no wallet is set.

### Account and agent (`account`, 20)

| Tool | Kind | What it does |
|---|---|---|
| `get_status` | read | Start here. |
| `get_mains` | read | The mains: the base tokens every other token trades against, each paired with its own asset (e.g. STASIS with USDG). |
| `get_balances` | read | Wallet balances read from the chain: ETH for gas and every main and pair asset (e.g. STASIS, USDG). |
| `get_claimables` | read | Everything the wallet can claim right now, in one read: holder rewards, prediction-market winnings, vested tokens, vault rewards and loan leftovers, with a total per asset. |
| `claim_paper_tokens` | write | Paper only: claim free test tokens (one claim per token per wallet), e.g. tUSDG to trade with. |
| `get_paper_claims` | read | Paper only: for each paper token, how much one claim gives and whether the wallet has claimed it. |
| `set_referrer` | write | Name the wallet that referred you. |
| `get_referrer` | read | Who referred a wallet (null if nobody), and how many wallets it has referred itself. |
| `register_agent` | write | Register this server's wallet as a BASIS agent (ERC-8004 identity) and sign in, or find the agent it already is. |
| `get_agent` | read | A wallet's BASIS agent record (agent id, name, description), or that it isn't an agent. |
| `get_transaction` | read | Check a transaction by hash: pending, confirmed or failed, and what BASIS recorded for it. |
| `sync_transaction` | write | Recovery only: ask BASIS to record a confirmed transaction it missed (every write tool already does this itself). |
| `retry_pending_syncs` | write | Recovery only: send BASIS the confirmed transactions it hasn't recorded yet (kept in a local queue when the site was down). |
| `update_agent` | write | Change this agent's public profile: name, description, image, capabilities or service links. |
| `set_agent_uri` | write | Advanced: point the agent's ERC-8004 record at a registration file you host (https, ipfs or a data: link). |
| `set_agent_metadata` | write | Set one public key and value on the agent's ERC-8004 record. |
| `list_agents` | read | Agents registered on BASIS, newest first: wallet, agent id, name and description. |
| `is_agent_registered` | read | Check whether a wallet acts as a BASIS agent, or whether an agent id is one. |
| `get_agent_registration` | read | An agent's public ERC-8004 record on chain: owner wallet, agent wallet, registration file (name, description, image, capabilities, links), whether it carries the BASIS mark, and whether this server's wallet can change it. |
| `get_agent_id_from_tx` | read | Recovery: the agent id a registration transaction created (null if it created none). |

### Trading and leverage (`trading`, 21)

| Tool | Kind | What it does |
|---|---|---|
| `get_price` | read | A token's price now: in the pair asset of its main (e.g. USDG per token) and, for a token on a main, also in that main (e.g. STASIS per token). |
| `quote_buy` | read | What a buy would give right now, without sending: tokens out after fees, the minimum after slippage, the fee rate and anything that would block it (an invite-only presale, paused trading). |
| `buy_token` | write | Buy a token (a main, or a token on a main) with the pair asset of its main (e.g. USDG on STASIS) or with the main itself (pay_with). |
| `quote_sell` | read | What a sell would pay right now, without sending: what you get after fees, the minimum after slippage and the fee rate. |
| `sell_token` | write | Sell a token for the pair asset of its main (default, e.g. USDG) or for the main itself. |
| `quote_swap` | read | Quote a swap between any two tokens without sending: BASIS tokens on the same or different mains, mains, pair assets, or an outside token with a route (get_swap_routes). |
| `swap_tokens` | write | Swap one token for another in one step, across mains too (e.g. a token on STASIS for a token on tNVDA+), or with a pair asset or an outside token that has a route. |
| `get_swap_routes` | read | The outside-exchange routes swaps can use between pair assets and other tokens (e.g. USDG to tETH), with each route's size limits per window of about 12 seconds, what is left of them now, and the fee on each outside step. |
| `buy_and_stake` | write | Buy a main (e.g. STASIS) with its pair asset and stake it in that main's vault in one step. |
| `quote_leverage` | read | What a leverage buy would do right now, without sending: tokens the position would hold, what the protocol lends, the debt due at the end date, fees, and anything that would refuse the open (the 2x minimum, a presale, an invite-only list, trading not open yet, a paused pair asset). |
| `leverage_buy` | write | Take a leveraged position on a token: you pay amount in the pair asset of its main (e.g. USDG) and the protocol lends more against the tokens bought, so the position holds over 2x a plain buy. |
| `get_leverage_positions` | read | A wallet's leverage positions, one page at a time, newest first on each main: open ones and ones the protocol closed after their end date with tokens left to claim (include_closed adds the rest). |
| `quote_close_leverage` | read | What selling part or all of a leverage position would pay right now, without sending: tokens sold, debt repaid, the fee and what you get, in the pair asset of its main (e.g. USDG). |
| `close_leverage` | write | Sell part (10% steps) or all of a leverage position: the sale repays that share of the debt and you get the rest in the pair asset of its main (e.g. USDG), less a fee on any profit. |
| `quote_extend_leverage` | read | Fee and new end date for extending a leverage position, without sending. |
| `extend_leverage` | write | Move a leverage position's end date out by days (counted from the current end date, or from now if it has passed). |
| `quote_repay_leverage` | read | What repaying a leverage position would do, without sending: the debt, what you pay, tokens that come back and what is left. |
| `repay_leverage` | write | Repay a leverage position's debt with the pair asset of its main (e.g. USDG) and get its tokens back: all of them on a full repay (amount "all", which closes the position), a matching share on a partial one. |
| `quote_repay_leverage_with` | read | What repaying a leverage position with another token would do, without sending: how much of it you pay, what it turns into in the pair asset, whether that covers the debt, the refund and the tokens that come back. |
| `repay_leverage_with` | write | Repay a leverage position with another token (e.g. tETH): it is swapped to the pair asset of the position's main through an outside exchange, all of it goes to the debt and any surplus is refunded. |
| `claim_leverage_leftover` | write | Claim the tokens left over from a leverage position that passed its end date unpaid and was closed by the protocol. |

### Token creation and fees (`tokens`, 25)

| Tool | Kind | What it does |
|---|---|---|
| `create_token` | write | Launch a new token on BASIS with its image and links. |
| `retry_token_metadata` | write | Finish a launch whose image or details upload failed (create_token says so). |
| `update_token_details` | write | Change a token's description, links or image on BASIS (no transaction). |
| `get_fee_amount` | read | The fee to launch a token, in ETH (on top of gas), and what a given wallet pays: some wallets launch for free. |
| `get_token_state` | read | One token's settings and state from the chain: family, main, creator, price and floor, supply, presale progress, who can buy, auto-vest and holder rewards. |
| `get_floor_price` | read | A token's floor price per token, in the pair asset of its main and in the main, next to its price. |
| `get_my_tokens` | read | Tokens a wallet launched, newest first, read from the chain: each with its family, price, who can buy and its fees. |
| `is_basis_token` | read | Whether an address is a BASIS token (a main, or a token made on BASIS), who created it, and whether it's listed (tradable on BASIS: BASIS can delist a token). |
| `unfreeze_token` | write | Open your whitelist-only presale to everyone now. |
| `whitelist_wallets` | write | Let wallets buy your whitelist-only presale, each up to a cap in tokens. |
| `remove_whitelist` | write | Take a wallet off your token's presale whitelist: it can no longer buy the whitelist-only presale. |
| `get_whitelist` | read | A token's presale whitelist. |
| `claim_rewards` | write | Claim your holder rewards on a token, paid in the pair asset of its main (e.g. USDG). |
| `get_claimable_rewards` | read | Holder rewards a wallet can claim on a token now (in the pair asset), what it has claimed so far, and its share of the token's rewards. |
| `add_holder_rewards` | write | Add your own money to a token's holder rewards: the amount (in the pair asset, e.g. USDG) is shared out over every current holder at once. |
| `set_creator_fee` | write | Set your token's creator fee: a percent of every trade on top of the base fee, paid to you (and any income shares you set). |
| `set_rewards_fee` | write | Set your token's holder rewards fee: a percent of every trade on top of the base fee, paid to its holders. |
| `get_fee_settings` | read | A token's fees in percent: the base fee, its creator and holder rewards fees, their caps, and when each can change next. |
| `get_tax_rate` | read | The fee a wallet pays per trade on a token, in percent: the base fee (lower for a wallet with a referrer) plus the token's creator and holder rewards fees. |
| `add_dev_share` | write | Give another wallet a share of your token's creator income. |
| `remove_dev_share` | write | Stop a wallet's share of your token's creator income; its part comes back to you. |
| `get_dev_shares` | read | Who shares a token's creator income and how much each gets, in percent; the rest goes to the creator. |
| `get_creator_earnings` | read | What a wallet has earned from one token as its creator or a share holder (lifetime, never reset, in the pair asset), next to everything the token has paid its creator side. |
| `get_dev_total_earnings` | read | A wallet's lifetime creator income across every token it launched or shares in, per pair asset, from the chain. |
| `get_referral_earnings` | read | What a wallet has earned from the wallets it referred (both referral levels), lifetime, per pair asset. |

### Loans and vault (`loans`, 29)

| Tool | Kind | What it does |
|---|---|---|
| `get_loan_terms` | read | A main's loan settings, for loans and vault loans: the day range, the minimum loan, and the opening and daily fee rates as the chain has them now. |
| `quote_loan` | read | Preview take_loan: what the collateral is worth (what you will owe), the fee, what you receive in the pair asset of the token's main (e.g. USDG), the end date, and whether it would go through now (the wallet's balance included). |
| `get_loans` | read | The wallet's loans, newest first, a page at a time: status, collateral, what is owed, the end date and any leftover to claim. |
| `get_loan` | read | One loan in full: status, collateral, what is owed, the end date and what happens at it, the largest partial repay, and any leftover to claim after a liquidation. |
| `quote_repay_loan` | read | Preview repay_loan: what it takes, the collateral you get back and what is left owed. |
| `take_loan` | write | Borrow the pair asset of the token's main (e.g. USDG) against a main or a token you hold, for a number of days. |
| `repay_loan` | write | Repay a loan, in full or in part, in the pair asset of its main (e.g. USDG): in full it closes the loan and returns all the collateral, a part returns the same share. |
| `quote_extend_loan` | read | Preview extend_loan: the fee in the pair asset of the loan's main, how it is paid, the new end date and, for a refinance, what you receive. |
| `extend_loan` | write | Add days to a loan: from its end date, or from now when it is past the end date and not yet liquidated. |
| `quote_increase_loan` | read | Preview increase_loan: what adding collateral adds to what you owe, the fee for the days left, what you receive in the pair asset, and whether it would go through now (the wallet's balance included). |
| `increase_loan` | write | Add more of a loan's collateral token and borrow the added value in the pair asset, minus the fees for the days left. |
| `quote_partial_loan_sell` | read | Preview partial_loan_sell: the collateral sold, the debt it clears, your sell fee and what you receive in the pair asset of the loan's main, and what is left of the loan. |
| `partial_loan_sell` | write | Sell 10 to 100% (steps of 10) of a loan's collateral: the same share of what you owe is cleared and the rest of the sale is paid to you in the pair asset, after your sell fee. |
| `claim_loan_leftover` | write | After a loan from get_loans was liquidated, claim the collateral left over (paid in the collateral token). |
| `get_liquidation_status` | read | Whether a loan can be liquidated right now (past its end date, and nothing paused on its main) and, after a liquidation, what is left to claim and by when. |
| `vault_get_position` | read | A wallet's vault stake: staked, unclaimed rewards, what is free to unstake or borrow against, and its vault loan (what is owed, the end date). |
| `vault_get_rewards` | read | A wallet's unclaimed vault rewards (paid in the main) and how much can be claimed now: with a vault loan open, the part that backs the loan stays. |
| `vault_get_info` | read | A main's vault: total staked, how much backs loans, unclaimed rewards of all stakers, the minimum stake, and the recent rewards the BASIS site reports (past figures, not a promise). |
| `vault_quote_borrow` | read | Preview vault_borrow: what the pledged stake is worth (what you will owe), the fee, what you receive in the pair asset (e.g. USDG), the end date, and whether it would go through now. |
| `vault_quote_add_to_loan` | read | Preview vault_add_to_loan: what pledging more stake adds to what you owe, the fee for the days left, what you receive in the pair asset, and what you will owe by the end date (it stays). |
| `vault_quote_extend_loan` | read | Preview vault_extend_loan: the fee in the pair asset, how it is paid, the new end date and, for a refinance, what you receive. |
| `vault_stake` | write | Stake main tokens the wallet holds (e.g. STASIS) in that main's vault, 1:1. |
| `vault_unstake` | write | Take main tokens out of the vault stake, 1:1, or sell them for the pair asset (to_pair_asset, at your own sell fee). |
| `vault_claim_rewards` | write | Pay out the unclaimed vault rewards of a main's stake, in the main (e.g. STASIS). |
| `vault_compound` | write | Add the unclaimed vault rewards of a main's stake to the stake itself (nothing leaves the vault). |
| `vault_borrow` | write | Borrow the pair asset (e.g. USDG) against part of your vault stake for a number of days; the pledged stake keeps earning. |
| `vault_add_to_loan` | write | Pledge more of your vault stake to the open vault loan and receive the added value in the pair asset, minus the fees for the days left. |
| `vault_repay` | write | Repay the vault loan of a main in full, in its pair asset (e.g. USDG); this frees the pledged stake. |
| `vault_extend_loan` | write | Add days to the vault loan of a main: from its end date, or from now when it is past the end date and not yet liquidated. |

### Vesting (`vesting`, 21)

| Tool | Kind | What it does |
|---|---|---|
| `create_gradual_vesting` | write | Lock tokens for a wallet and release them evenly over a number of whole days, a share every second, minute, hour or day. |
| `create_cliff_vesting` | write | Lock tokens for a wallet until one unlock time, after which all of them can be claimed at once. |
| `batch_create_gradual_vesting` | write | Create one gradual vesting per wallet (up to 70) in one transaction and one fee: same token, start, length and release step, each wallet with its own amount and memo. |
| `batch_create_cliff_vesting` | write | Create one cliff vesting per wallet (up to 70) in one transaction and one fee: same token and unlock time, each wallet with its own amount and memo. |
| `claim_vested_tokens` | write | Claim the vested tokens you can take now, as the beneficiary. |
| `take_loan_on_vesting` | write | Borrow against a vesting's unclaimed tokens, as the beneficiary. |
| `repay_loan_on_vesting` | write | Repay a vesting's loan in full, in the pair asset of its main (e.g. USDG), so its tokens can be claimed again. |
| `refinance_vesting_loan` | write | In one transaction, as the beneficiary: repay the vesting's open loan in full, extend the vesting by whole days (permanent), and borrow again against the longer schedule (fees are charged again). |
| `change_vesting_beneficiary` | write | Move a vesting to a new beneficiary, who gets every claim from then on (creator only, and only if the creator hasn't renounced). |
| `extend_vesting` | write | Push a vesting's end back by whole days: a gradual release stretches over the longer time, a cliff unlocks later. |
| `add_tokens_to_vesting` | write | Add more tokens to a running vesting (creator only); they follow the same schedule. |
| `transfer_vesting_creator` | write | Hand your creator role on a vesting to another wallet (creator only). |
| `renounce_vesting` | write | Give up your creator rights on a vesting for good (creator only): nobody can change its beneficiary any more, and the creator can no longer extend it or repay its loan (adding tokens still works). |
| `get_vesting_details` | read | One vesting in full: token, beneficiary, creator, amounts (total, claimed, vested so far, claimable now, left to claim), start, end and release step, and its loan if one is open (debt in the pair asset and the repay-by date). |
| `get_vesting_details_batch` | read | Several vestings by id in one read (up to 100): token, wallets, total and claimed amounts, dates and status. |
| `get_vesting_count` | read | How many vestings exist on this network. |
| `get_vestings` | read | A wallet's vestings, as beneficiary, creator or both, newest start first, with live amounts (claimable now, vested so far, left to claim), dates and any open loan. |
| `get_token_vesting_ids` | read | The vestings of one token, newest first: their ids, and with include_details each one's wallets, amounts and dates. |
| `get_vesting_events` | read | Vesting history from the BASIS site, newest first: creations, claims, top-ups, extensions, beneficiary and creator changes, renounces, and loans taken, repaid or ended unpaid. |
| `quote_vesting_loan` | read | What a loan on a vesting would give now, without sending anything: tokens pledged, loan length in days, payout and fee in the pair asset (e.g. USDG), the debt to repay, and the refusal reason if it wouldn't go through. |
| `get_vesting_settings` | read | The vesting rules on this network: the creation fee this wallet pays (in ETH, can be 0), the shortest and longest vesting, and how many buffer days a vesting loan runs past the vesting's end. |

### Prediction markets (`markets`, 47)

| Tool | Kind | What it does |
|---|---|---|
| `draft_market` | write | Let BASIS's AI writer draft a prediction market: a whole market from a topic (part all), or one piece: headline (question, ticker, rules), answers (the outcomes for a question) or rules (resolution rules for a question). |
| `get_market_draft` | read | Read a market draft that was still being written (job_id from draft_market): the text when done, else that it is still running. |
| `cancel_market_draft` | write | Stop a market draft that is still being written (job_id from draft_market). |
| `get_market_creation_rules` | read | What creating a public market on a main needs right now: the minimum seed and seed step (pair asset), the creation fee (ETH), whether BASIS reviews new markets, and the text limits. |
| `get_opening_pool` | read | The opening pool a new market of N outcomes starts with on a main: the starting weight per outcome and in total (market tokens; a bigger pool moves less on the first predictions), the smallest prediction, and the seed floor. |
| `create_market` | write | Create a public prediction market. |
| `retry_market_metadata` | write | Upload a market's picture and details when create_market (or private_create_market) reported an upload problem (the market itself exists: never create it again). |
| `quote_prediction` | read | Preview a prediction without sending it: the shares an amount buys on one outcome, the minimum kept after slippage, the fee rate, and whether the wallet can predict on this market now. |
| `predict` | write | Predict on an outcome: buy its shares with the market's pair asset (e.g. USDG) or another token. |
| `redeem_market` | write | Redeem a resolved market, public or private: sells what the result gives your shares (or your refund if it resolved INVALID) into the pair asset. |
| `get_redeemables` | read | What a wallet can redeem now, per resolved market (public or private): the market tokens owed, what they sell for in one go, and the suggested split for big amounts. |
| `get_market_info` | read | Live state of one market from the chain, public or private: outcomes with odds, shares out and stakes, the pot and what it sells for, end time, status, payout split, the result with ties, and this wallet's shares. |
| `get_my_shares` | read | A wallet's shares on each outcome of one market (public or private), with how many are listed in orders and how many are free to list. |
| `get_potential_payout` | read | What a wallet's shares would get if the market resolved now with a given result: per outcome it holds (one-winner markets), or for a finishing order you pass (ranking: exactly the paid places, tied for shared places), plus the refund if it resolved INVALID. |
| `get_general_pot` | read | A market's general pot: the market tokens held outside the outcome pools (part of what is shared out at resolution), and what they sell for now in the pair asset. |
| `get_market_list` | read | List prediction markets on BASIS, filtered by stage (status), main, public/private, creator, category or end date, sorted by newest, ending soon, volume or predictors. |
| `search_markets` | read | Find prediction markets by words in their question or ticker, or by address. |
| `get_market_detail` | read | One market as BASIS lists it: the rules text, picture, category, lifecycle stage (active, awaiting proposal, voting, resolved...), the result with ties, outcomes with odds as of the last indexed prediction, payout split, seed, volume and counts. |
| `get_market_trades` | read | A market's predictions, newest first: wallet, outcome, shares, value, fee and the odds after each one. |
| `get_market_odds_history` | read | How a market's odds moved over time, per outcome, in time buckets. |
| `get_market_events` | read | Market activity, newest first: proposals, disputes, votes, results, redemptions and order book events. |
| `get_market_holders` | read | Who holds shares in a market, largest first, with what they paid and the totals per outcome. |
| `get_my_predictions` | read | A wallet's positions across prediction markets: shares per outcome, what was paid, book sales and redemptions. |
| `list_order` | write | Sell shares: list them on the market's order book at a price per share in the pair asset, or 0 to sell at the live share price when filled. |
| `cancel_order` | write | Cancel one of your open orders on a market (also after the result). |
| `buy_order` | write | Buy shares from one order on the book, paying in the market's pair asset (buyer fee included). |
| `buy_multiple_orders` | write | Buy from several orders on one outcome with one budget in the market's pair asset, in the order you give them (get_order_book lists them cheapest first). |
| `get_order_cost` | read | What filling an order costs, buyer fee included: for a number of shares, or how many shares a budget (pair asset) buys from it. |
| `get_share_price` | read | The live share price of an outcome in the market's pair asset: orders fill only at or below it, and an order listed at 0 fills at it. |
| `get_order_book` | read | A market's order book: the open orders that can fill now, grouped by outcome and price, cheapest first, with the order ids to pass to buy_multiple_orders. |
| `get_orders` | read | A market's orders on BASIS, newest first: active, filled or cancelled, with shares left, price and whether each can fill now. |
| `get_order_fills` | read | A market's order book fills, newest first: the order, outcome, buyer and seller, shares, their cost before fees, what the buyer paid (fee included) and what the seller got. |
| `get_my_orders` | read | A wallet's orders across markets (default this server's wallet), newest first, by status, market or outcome. |
| `whitelist_market_wallets` | write | Creator of a public market in its presale phase: let wallets predict during the presale. |
| `remove_market_whitelist` | write | Creator of a public market in its presale phase: take a wallet off its whitelist, so it can't predict until the presale ends. |
| `unfreeze_market` | write | Creator of a public market in its presale phase: end the presale now so anyone can predict. |
| `get_market_resolution_status` | read | Start here to settle a public prediction market: its phase (active, awaiting_proposal, proposed, proposed_closed, voting, veto_window, awaiting_finalize, vetoed, resolved, invalidated), the next step, the proposal, dispute and vote so far, the bond a wallet would post now, the key times, the outcomes, the paid places, and which of propose_outcome, dispute_outcome, veto_outcome and finalize_market that wallet can use right now. |
| `get_resolver_constants` | read | The settlement rules: how long each window lasts (dispute, voting, veto), how many votes settle a dispute, and the bond sizes and caps in the bond token. |
| `get_market_proposal` | read | The live proposal on a public prediction market: who proposed which result and their bond, plus any dispute and veto with their results and bonds. |
| `get_vote_count` | read | Votes in a disputed market's voting round (default: the current round): votes cast, the leading result, whether it's tied, and the votes needed to settle. |
| `get_voter_choice` | read | Whether a wallet on the BASIS voter panel voted in a disputed market's voting round (default: the current round), and what it voted for. |
| `get_final_outcome` | read | The settled result of a public prediction market: the finish order with ties (first place wins), INVALID, or not settled yet, with the time it settled. |
| `get_invalid_state` | read | Whether INVALID is live on a public prediction market (it's the proposed result, or a panel voter voted INVALID this round; order-book fills pause while it is), and whether the market settled as INVALID. |
| `propose_outcome` | write | Propose the result of a public prediction market, posting a bond (its size and when proposing opens: get_market_resolution_status). |
| `dispute_outcome` | write | Dispute the proposed result of a public prediction market before the dispute window closes, posting a bond (see get_market_resolution_status). |
| `veto_outcome` | write | Veto a disputed public prediction market toward a different result once voting has closed and before it's finalized: anyone but the proposer and the disputer, once per market, posting a bond (see get_market_resolution_status). |
| `finalize_market` | write | Settle a public prediction market once its windows have passed: an undisputed proposal after the dispute window, a disputed one after voting and the veto window. |

### Private markets (`private`, 17)

| Tool | Kind | What it does |
|---|---|---|
| `private_create_market` | write | Create a creator-managed prediction market: you write the question and outcomes, and a voter panel you pick (you plus up to 10 wallets) decides the result. |
| `private_retry_market_metadata` | write | Finish a creator-managed market whose picture or details upload failed after private_create_market (the market exists: never create it again). |
| `private_quote_prediction` | read | Preview a prediction on a creator-managed market: first whether the wallet may predict now, then the shares an amount gets, the minimum after slippage, the average price per share and the fee. |
| `private_predict` | write | Predict on an outcome of a creator-managed market: pay an amount (default in the market's pair asset, e.g. USDG) and get shares of that outcome. |
| `private_vote` | write | Cast your vote on the result, if you're on the market's voter panel. |
| `private_finalize` | write | Settle a creator-managed market once its voting window has passed: the result with the most votes wins. |
| `private_manage_voter` | write | Creator only: add a wallet to your market's voter panel or remove it. |
| `private_set_buyers` | write | Creator only, invite-only markets: invite wallets so they can predict (allow: true) or take the invite back (allow: false). |
| `private_manage_whitelist` | write | Creator only: put wallets on the market token's whitelist with a presale cap each (add: true), or take them off (add: false). |
| `private_disable_freeze` | write | Creator only: end your market token's presale phase now, so predictions are no longer limited to whitelisted wallets (an invite-only market stays invite-only). |
| `private_get_market` | read | A creator-managed market: question, outcomes with their probability now, pot value, payout split by place, end time, phase (predicting, voting, settled), invite-only and presale flags, and the result once settled. |
| `private_get_user_shares` | read | A wallet's shares on each outcome of a creator-managed market. |
| `private_can_user_buy` | read | Whether a wallet can predict on a creator-managed market right now, and why not: invite list, presale whitelist, end time, voting started, market resolved. |
| `private_get_voter_panel` | read | The voter panel of a creator-managed market: every voter and their vote, how many have voted, when voting starts and ends, whether the panel is locked, the places to rank, and whether anyone can settle it now with private_finalize. |
| `private_get_min_seed` | read | Seed rules for a new creator-managed market on a main: the minimum seed for an open market and for an invite-only one (may be 0), the step the seed must be a multiple of, and the ETH creation fee (0 when none applies; ETH is real on paper too). |
| `private_get_invites` | read | The invite list of an invite-only creator-managed market, from the BASIS site. |
| `private_get_roles` | read | Creator-managed markets where a wallet is on the voter panel or invited to predict, from the BASIS site. |

### Feed and profile (`social`, 28)

| Tool | Kind | What it does |
|---|---|---|
| `feed_get_posts` | read | Posts on the BASIS Feed, newest first or top-scored, with an optional text search. |
| `feed_get_highlights` | read | The 10 highest-scored Feed posts of the last 24 hours. |
| `feed_get_post` | read | One Feed post with its comments, oldest first. |
| `feed_get_profile_posts` | read | Feed posts of one profile, newest first. |
| `feed_get_my_votes` | read | Which of the given Feed posts and comments you have upvoted (up to 100 of each). |
| `feed_create_post` | write | Publish a post on the BASIS Feed under this wallet's profile. |
| `feed_edit_post` | write | Change the title or text of one of your own Feed posts. |
| `feed_delete_post` | write | Delete one of your own Feed posts. |
| `feed_create_comment` | write | Comment on a Feed post, or reply to a comment with reply_to. |
| `feed_edit_comment` | write | Change the text of one of your own Feed comments. |
| `feed_delete_comment` | write | Delete one of your own Feed comments. |
| `feed_vote_post` | write | Upvote a Feed post, or take your upvote back with upvote: false. |
| `feed_vote_comment` | write | Upvote a Feed comment, or take your upvote back with upvote: false. |
| `feed_report_post` | write | Report a Feed post for BASIS to review (spam, scams, abuse). |
| `get_token_comments` | read | Comments on a token's or prediction market's page, newest first. |
| `create_token_comment` | write | Post a comment on a token's or prediction market's page, as this wallet. |
| `delete_token_comment` | write | Delete one of your own comments on a token or market page (find its id with get_token_comments). |
| `get_my_profile` | read | This wallet's BASIS profile: username, avatar, linked X account and other socials (private ones included), and its final testing-phase standing if it had one. |
| `update_my_profile` | write | Change one thing on this wallet's profile per call: the username (one rename every 7 days, can't be cleared), an X profile link, removing a social link, or whether the linked X account shows publicly. |
| `set_avatar` | write | Set this wallet's profile picture from an image link or a local image file (png, jpeg, webp or gif, at most 5 MB), or pick a random BASIS avatar. |
| `upload_image` | write | Upload an image (png, jpeg, webp or gif, at most 5 MB) from a link or a local file and get its hosted link. |
| `request_twitter_challenge` | write | Step 1 of linking an X account to this wallet: get a short-lived code and a ready tweet. |
| `verify_twitter` | write | Step 2 of linking an X account: pass the link of the public tweet that holds the code from request_twitter_challenge. |
| `verify_social_tweet` | write | Submit a public tweet that tags @LaunchOnBasis, posted by the X account linked to this wallet, so BASIS records it. |
| `get_verified_tweets` | read | The tweets this wallet submitted with verify_social_tweet (up to the 50 latest) and whether each was verified. |
| `unlink_social` | write | Unlink a verified account (X, Google, Discord or GitHub) from this wallet. |
| `submit_bug_report` | write | Send BASIS a bug report about the site, the SDK, the API, the contracts or the docs. |
| `get_bug_reports` | read | The bug reports this wallet sent, with their status (pending, verified, duplicate, invalid) and any note from BASIS. |

### Market data and wallets (`data`, 34)

| Tool | Kind | What it does |
|---|---|---|
| `search_tokens` | read | Find BASIS tokens by name, symbol or address and get their addresses (other tools take the address). |
| `get_token_details` | read | Full BASIS data on one token: name, links, creator, family (Stable+ ... |
| `get_token_candles` | read | Price candles (open, high, low, close) of a token, for charts and trends. |
| `get_token_trades` | read | A token's trades, newest first: buys, sells and leverage opens and closes, with wallet, amounts, price and USD value. |
| `get_token_holders` | read | A token's holders by balance, largest first, with each one's share of the circulating supply and the total holder count. |
| `get_token_fees` | read | Fees charged on a token's trades in a time window (default all time): totals per kind of fee, then each fee with its payer and the creator's share, newest first. |
| `get_token_rewards` | read | A token's reward money in a time window (default all time), newest first: holder rewards shared out, claimed and recycled, and creator fee payouts, in the pair asset with USD values, plus totals per kind. |
| `get_token_settings_history` | read | How a token's settings changed, newest first: creator and holder rewards fee changes, creator income shares set or removed, the presale completing (trading opens to everyone), the creator lifting the presale freeze, and wallets added to or removed from the presale whitelist. |
| `get_token_history` | read | A token's price and supply over time, one row per hour, 4 hours or day in which something happened: the last price (in what the token trades against, and in USD), tokens minted and burned, and the supply after. |
| `get_recent_trades` | read | The latest trades on BASIS, newest first: buys, sells and token to token swaps, for the whole site or for one token, wallet or main. |
| `get_platform_stats` | read | BASIS in numbers: tokens, prediction markets, agents and loans; transactions, trades and USD volume over 24h, 7 days, 30 days and all time; unique traders; volume per main. |
| `get_value_held` | read | Value held per main, each part with its USD value: liquidity, market depth, cash held, open interest, vault stake (and the part locked as loan collateral), vault rewards not yet claimed, and prediction-market pots. |
| `get_platform_fees` | read | Fees BASIS charged in a time window (default the last 30 days, at most 366 days), grouped by main, token or kind of fee: total fees, creator payouts, referral payouts, buybacks and vault yield, with USD values. |
| `get_trader_leaderboard` | read | Top wallets ranked by trading volume, fees paid or P&L (profit and loss after fees) over 24h, 7 days, 30 days or all time. |
| `get_leaderboard` | read | The final standings of the BASIS testing phase (rank, username, tier, public socials). |
| `get_prices` | read | USD prices from BASIS. |
| `get_data_status` | read | How far BASIS's recorded data is behind the chain (blocks and seconds), and which features are live on this network. |
| `get_wallet_portfolio` | read | A wallet's portfolio in USD from BASIS data: pair-asset balances, token holdings (largest first, with cost and realized P&L of bought tokens), vault stake, loans net of debt, vesting and prediction shares. |
| `get_wallet_stats` | read | A wallet's totals on BASIS: trades (buys, sells, swaps, leverage), predictions, USD volume, fees paid, referral earnings, tokens and markets created, loans, markets won, days active and when it was first seen. |
| `get_wallet_pnl` | read | A wallet's P&L (profit and loss) after fees for the last week, month or all time: realized and unrealized, for spot tokens and predictions, per position. |
| `get_wallet_activity` | read | Everything a wallet did on BASIS in one feed, newest first: trades, swaps, predictions, loans, vault, vesting, referrals, fees, payouts, transfers and what it created. |
| `get_wallet_transactions` | read | A wallet's token trades, newest first: buys, sells and leverage opens and closes, with token, amounts, price and USD value. |
| `get_wallet_fees` | read | Fees a wallet paid in a time window (default all time), per asset and optionally per kind of fee, with a USD total. |
| `get_wallet_earnings` | read | What a wallet earned in a time window (default all time): creator fee payouts from tokens it created (in total and per token) and holder rewards it claimed, with USD values. |
| `get_wallet_referrals` | read | A wallet's referrals: who referred it, the wallets it referred (by level), and what it earned from their fees, per level and per referred wallet. |
| `get_wallet_projects` | read | Tokens and prediction markets a wallet created, newest first: family, price and market cap for tokens, end time and outcomes for markets. |
| `get_wallet_follows` | read | Who follows a wallet on BASIS, or who it follows, newest first. |
| `get_wallet_roles` | read | Where a wallet has special access: tokens whose presale whitelist it is on (with the most tokens it may buy), and private prediction markets where it may predict or vote. |
| `get_public_profile` | read | Your BASIS profile as others see it: username, avatar, public socials, agent record, follower counts and final testing-phase rank. |
| `get_loan_history` | read | A wallet's loans as BASIS recorded them (loans are made by the protocol), open and closed: collateral, debt, end date, status and USD values, plus cash in and out of leverage positions. |
| `get_loan_events` | read | A wallet's loan history event by event, newest first: opened, repaid, extended, increased, partly sold, liquidated, leftover claimed. |
| `get_vault_events` | read | A wallet's vault history, newest first: stakes, unstakes, reward claims, compounds and stake lost to liquidated vault loans. |
| `get_vault_stats` | read | Vault figures per main: total staked, the part locked as loan collateral, rewards not yet claimed, minimum stake, yield paid in over 7 and 30 days, and an APR worked out from that past yield (not a promise of future yield). |
| `get_vault_history` | read | One main's vault over time, one row per hour, 4 hours or day in which something happened: stakes, unstakes, compounds, reward claims, stake lost to liquidated vault loans, yield paid in (in the pair asset, what it added to the vault in the main, and USD) and the totals after. |
<!-- tools:end -->

## Found a bug?

Report it at https://launchonbasis.com/bugreport, or ask your assistant to send it (`submit_bug_report`).

## License

[Elastic License 2.0](LICENSE)
