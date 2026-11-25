"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotSentError = exports.GuidedError = void 0;
exports.redactUrls = redactUrls;
exports.clean = clean;
exports.ruleText = ruleText;
exports.errorText = errorText;
const basis_sdk_1 = require("basis-sdk");
const config_js_1 = require("./config.js");
class GuidedError extends Error {
    txHash;
    constructor(message, txHash) {
        super(message);
        this.txHash = txHash;
        this.name = "GuidedError";
    }
}
exports.GuidedError = GuidedError;
class NotSentError extends GuidedError {
    constructor(message) {
        super(message);
        this.name = "NotSentError";
    }
}
exports.NotSentError = NotSentError;
function redactUrls(text) {
    return text.replace(/\b([a-z][a-z0-9+.-]*):\/\/([^\s/?#"'<>]+)[^\s"'<>]*/gi, (_m, scheme, host) => {
        const bare = host.includes("@") ? host.slice(host.lastIndexOf("@") + 1) : host;
        return `${scheme}://${bare}`;
    });
}
function clean(text) {
    return (redactUrls(text)
        .replace(/\[basis-sdk\]\s*/g, "")
        .replace(/\s+at\s+(?:\S+\s+){0,2}\(?(?:file:\/\/|node:|[A-Za-z]:\\|\/)[^\s()]*:\d+:\d+\)?/g, "")
        .trim());
}
function explorerTx(hash, explorerUrl) {
    return explorerUrl ? ` (${explorerUrl.replace(/\/$/, "")}/tx/${hash})` : "";
}
function followUp(note) {
    if (!note)
        return "";
    if (/registerAndSync/.test(note)) {
        return " The agent isn't recorded by BASIS yet: once it confirms, call register_agent again with registration_tx set to this hash. Don't register without it (that would make a second identity).";
    }
    if (/retryTokenMetadata/.test(note)) {
        return " The token's image and details weren't uploaded yet: once it confirms, find the token with get_my_tokens and run retry_token_metadata. Don't create the token again.";
    }
    if (/retryMarketMetadata/.test(note)) {
        return " The market's image and details weren't uploaded yet: once it confirms, find the market with get_my_predictions or get_market_list and run retry_market_metadata (private_retry_market_metadata for a creator-managed private market). Don't create the market again.";
    }
    if (/flushPendingSyncs/.test(note)) {
        return " BASIS will record it once it confirms: run retry_pending_syncs then.";
    }
    return ` ${clean(note)}`;
}
const ADDR = /0x[0-9a-fA-F]{40}/;
const NOT_SENT = "Nothing was sent.";
function noAddresses(text) {
    return text
        .replace(new RegExp(` \\(${ADDR.source}\\)`, "g"), "")
        .replace(new RegExp(`\\b(?:[Mm]ain|[Mm]arket|[Tt]oken) ${ADDR.source}`, "g"), (m) => `this ${m.split(" ")[0].toLowerCase()}`)
        .replace(new RegExp(ADDR.source, "g"), "it");
}
function pausedEffect(effect) {
    return effect
        .replace(/no bet paid in \S+ can be placed: the bet sells it for this asset/, "no prediction paid in that token can be made (it is sold for this asset first)")
        .replace(/no bet that pays in or converts through it can be placed/, "no prediction that pays in it or converts through it can be made")
        .replace(/\bbets\b/g, "predictions")
        .replace(/\bbet\b/g, "prediction");
}
const RULES = {
    "pair asset paused": {
        sdk: /is paused by its issuer: it cannot move until it is unpaused/,
        text: (msg) => {
            const m = /^(.*?) is paused by its issuer: it cannot move until it is unpaused, so (.+?)\.(?: Nothing was sent\.)?$/.exec(msg);
            const who = m ? noAddresses(m[1]).replace(/^The pair asset it$/, "The pair asset") : "The pair asset";
            const effect = m ? pausedEffect(m[2]) : "nothing can pay it in or out";
            return `${who} is paused by its issuer right now, so ${effect}. ${NOT_SENT} Try again once it resumes.`;
        },
    },
    "Trading is not enabled": {
        sdk: /has not opened yet/,
        text: (msg) => {
            const m = /^Trading on main (\S+)(?: \(0x[0-9a-fA-F]{40}\))? has not opened yet: (.+?)\.?$/.exec(msg);
            const main = m && !ADDR.test(m[1]) ? m[1] : "this main";
            return `Trading on ${main} hasn't opened yet${m ? `: ${pausedEffect(m[2])}` : ""}. ${NOT_SENT}`;
        },
    },
    "pair not active": {
        sdk: /is on a paused pair/,
        text: (msg) => {
            const m = /is on a paused pair: (.+?)\.?$/.exec(msg);
            return `Trading on this main is paused right now${m ? `: ${pausedEffect(noAddresses(m[1]))}` : ""}. ${NOT_SENT} Try again once it reopens.`;
        },
    },
    "convert closed": {
        sdk: /\bhost\b/,
        text: (msg) => /order fill/.test(msg)
            ? `Order fills that carry a fee can't go through right now. ${NOT_SENT} Try again later.`
            : /seed/.test(msg)
                ? `New markets can't be seeded right now. ${NOT_SENT} Try again later.`
                : `Predictions can't be processed right now. ${NOT_SENT} Try again later.`,
    },
    "nothing to claim": { text: () => `This wallet has no holder rewards to claim on this token right now. ${NOT_SENT}` },
    "not frozen": {
        sdk: /is not frozen \(/,
        text: (msg) => /nothing to lift/.test(msg)
            ? `This token isn't invite-only (it never was, its presale target was reached, or trading was already opened to everyone), so there is nothing to open up. ${NOT_SENT}`
            : `This token isn't invite-only (it never was, or trading was opened to everyone), so a whitelist has no effect. ${NOT_SENT}`,
    },
    "BASIS contract": {
        text: (msg) => `That address belongs to BASIS itself (one of its contracts or tokens), not to a wallet: ` +
            `${/vested there/.test(msg) ? "tokens vested to it could never be claimed" : "it could never act as the creator"}. Pass a wallet address. ${NOT_SENT}`,
    },
    "same beneficiary": {
        text: () => `That wallet is already this vesting's beneficiary and no loan is linked to it, so there is nothing to change. ${NOT_SENT}`,
    },
    batchSize: {
        text: (msg) => {
            const m = /at most (\d+) vestings; got (\d+)/.exec(msg);
            return m
                ? `One transaction takes at most ${m[1]} vestings, and this has ${m[2]}. Split it: send the other ${Number(m[2]) - Number(m[1])} in a second call. ${NOT_SENT}`
                : `Too many vestings for one transaction: split them over two calls. ${NOT_SENT}`;
        },
    },
    apiKey: {
        text: (msg) => /belongs to/.test(msg)
            ? "The BASIS API key this server holds isn't this wallet's own, so the token's picture and details couldn't be uploaded " +
                `after the create. ${NOT_SENT} Put this wallet's own key in BASIS_API_KEY (or remove it, so the server signs in and makes one), then restart the server.`
            : /already exists|already has/i.test(msg)
                ? "This wallet already has a BASIS API key, and this MCP doesn't have it. Put it in BASIS_API_KEY in the MCP config, " +
                    "or set BASIS_ROTATE_API_KEY=1 for one start to replace it with a new one (anything still using the old key stops working)."
                : "The BASIS API key in the MCP config isn't usable. Check BASIS_API_KEY.",
    },
    options: {
        text: () => `${NOT_SENT} This server passed BASIS a setting it doesn't take, which is a bug in this server. Please report it with ` +
            "submit_bug_report, naming the tool you called.",
    },
    outcomeArtUnreachable: {
        text: () => `Couldn't reach the BASIS picture library to check the outcome pictures. ${NOT_SENT} Try again in a minute, or leave outcome_art out.`,
    },
    "Min out": {
        text: () => `The minimum you asked for is more than this gives right now, so it would be refused. ${NOT_SENT} Lower it, or leave it out to use a fresh quote and slippage_percent.`,
    },
    minShares: {
        sdk: /is above .* now \(|A zero minShares|gives 0 shares/,
        text: (msg) => /A zero/.test(msg)
            ? "min_shares must be more than 0."
            : /gives 0/.test(msg)
                ? `That amount is too small to get any shares. ${NOT_SENT} Use a bigger amount.`
                : `min_shares is more than this gets right now, so it would be refused. ${NOT_SENT} Lower it, or leave it out to use a fresh quote and slippage_percent.`,
    },
    minTokens: {
        sdk: /is above .* now \(|A zero minTokens|gives 0 market tokens/,
        text: (msg) => /gives 0/.test(msg)
            ? `That amount is too small for this market. ${NOT_SENT} Predict a bigger amount.`
            : `The minimum you asked for is more than this prediction gets right now, so it would be refused. ${NOT_SENT} Lower it, or leave it out.`,
    },
    MinSharesNotMet: {
        text: () => `The minimum you asked for is more than this prediction gets right now, so it would be refused. ${NOT_SENT} Lower it, or leave it out.`,
    },
    symbol: {
        sdk: /^symbol (?:\(the ticker\) must be|is required)/,
        text: () => `The ticker must be 1 to 10 letters or digits (A-Z, 0-9); lower case is sent as upper case. ${NOT_SENT}`,
    },
    name: {
        sdk: /^name is required/,
        text: () => `The name can't be empty (spaces at either end are trimmed off). ${NOT_SENT}`,
    },
    siweNonce: {
        text: () => "Signing in to BASIS failed: the site's sign-in answer wasn't valid, so nothing was signed. Try again in a minute; if it " +
            "keeps happening, check BASIS_API_DOMAIN in the MCP config.",
    },
    agentSignInUnavailable: {
        text: () => `Couldn't reach BASIS to sign in before registering this agent. ${NOT_SENT} Call register_agent again in a minute.`,
    },
    agentTxPending: {
        text: () => `A transaction from this wallet is still waiting to confirm, and it may be an earlier registration. ${NOT_SENT} Wait for it ` +
            "(get_status shows it), then call register_agent again, so a second identity can't be made.",
    },
    agentTxHashRequired: {
        text: () => "This wallet already holds an agent identity that BASIS hasn't recorded. Call register_agent with registration_tx set to the " +
            "hash of the transaction that made it (the wallet's history on the explorer shows it). Don't register without it.",
    },
    agentNameTooLong: { text: () => `The agent name is too long: use at most 100 characters. ${NOT_SENT}` },
    agentDescriptionTooLong: { text: () => `The description is too long: use at most 500 characters. ${NOT_SENT}` },
    gas: {
        text: () => `This needs more gas than one transaction can carry. ${NOT_SENT} Do less in one call: use a smaller amount, or split a batch over several calls.`,
    },
};
function ruleText(e) {
    const r = Object.prototype.hasOwnProperty.call(RULES, e.rule) ? RULES[e.rule] : undefined;
    if (!r)
        return null;
    const msg = e.message.replace(/\[basis-sdk\]\s*/g, "").trim();
    if (r.sdk && !r.sdk.test(msg))
        return null;
    return r.text(msg);
}
function serverWords(e) {
    const b = e.body;
    let s = b && typeof b === "object" && typeof b.error === "string" ? clean(b.error) : "";
    if (!s)
        return "";
    if (/^No active challenge\b/i.test(s))
        return "No active X challenge for this wallet: get a code with request_twitter_challenge, post it, then call verify_twitter.";
    s = s.replace(/\s*(?:via|with|at) (?:GET|POST|PUT|PATCH|DELETE) \/api\/\S+/g, "").replace(/\s*on \/[a-z][\w/-]*(?=[.!?]?$)/i, "").trim();
    return /[.!?]$/.test(s) ? s : `${s}.`;
}
function retryWait(seconds) {
    if (seconds >= 3600)
        return `about ${Math.ceil(seconds / 3600)} h`;
    if (seconds >= 90)
        return `about ${Math.ceil(seconds / 60)} min`;
    return `about ${Math.max(1, Math.ceil(seconds))} s`;
}
function errorText(e, ctx = {}) {
    const c = typeof ctx === "string" ? { explorerUrl: ctx } : ctx;
    if (e instanceof GuidedError || e instanceof config_js_1.ConfigError)
        return clean(e.message);
    if (e instanceof basis_sdk_1.TxNotConfirmedError) {
        if (e.functionName === "approve") {
            return (`A token approval this needs was sent but isn't confirmed yet: ${e.txHash}${explorerTx(e.txHash, c.explorerUrl)}. ` +
                "The action itself was NOT sent. Once the approval confirms (check it with get_transaction), call the same tool again.");
        }
        return (`The transaction was sent but isn't confirmed yet: ${e.txHash}${explorerTx(e.txHash, c.explorerUrl)}. ` +
            "Don't send it again. Check it with get_transaction in a minute." +
            followUp(e.note));
    }
    if (e instanceof basis_sdk_1.TxReplacedError) {
        const how = e.reason === "cancelled"
            ? "was cancelled in the wallet before it confirmed"
            : e.reason === "repriced"
                ? "was sent again with another gas price"
                : "was replaced in the wallet by another transaction";
        return (`The transaction ${e.originalHash} ${how}, so it did not go through: ${e.replacementHash} confirmed in its place` +
            `${explorerTx(e.replacementHash, c.explorerUrl)}. Check your balances before trying again.`);
    }
    if (e instanceof basis_sdk_1.AgentOnboardingError) {
        const id = e.agentId !== null ? ` (agent id ${e.agentId})` : "";
        return e.txHash
            ? `The agent identity is on chain${id}, but BASIS hasn't recorded it yet. Don't register again: call register_agent with registration_tx: "${e.txHash}".`
            : `BASIS has this agent${id}, but signing in failed. Try register_agent again in a minute.`;
    }
    if (e instanceof basis_sdk_1.WalletRequiredError) {
        return "This needs a wallet: set BASIS_PRIVATE_KEY in the MCP config.";
    }
    if (e instanceof basis_sdk_1.NotDeployedError) {
        return "That part of BASIS isn't live on this network yet.";
    }
    if (e instanceof basis_sdk_1.ValidationError)
        return clean(ruleText(e) ?? e.message);
    if (e instanceof basis_sdk_1.BasisContractError) {
        const why = e.hint ?? e.reason;
        return why ? `The transaction would fail: ${clean(why)}` : "The transaction would fail, and the chain gave no reason.";
    }
    if (e instanceof basis_sdk_1.BasisRpcError) {
        switch (e.kind) {
            case "insufficient_funds":
                return `${clean(e.message)} Send some ETH on Robinhood Chain to this wallet for gas, then try again.`;
            case "rate_limited":
                return "The RPC is rate-limiting this wallet. Wait a bit, or set BASIS_RPC_URL to your own Robinhood Chain RPC.";
            case "network":
            case "timeout":
            case "server_error":
                return "Couldn't reach the Robinhood Chain RPC. Try again, or set BASIS_RPC_URL to another RPC.";
            case "nonce_used":
                return "A transaction from this wallet already used that slot. Check your latest transactions before trying again.";
            default:
                return clean(e.message);
        }
    }
    if (e instanceof basis_sdk_1.AuthRequiredError) {
        if (c.signInProblem) {
            return `This needs a BASIS sign-in, and signing in failed: ${c.signInProblem} Chain tools still work.`;
        }
        if (c.notLinked) {
            return "This needs a BASIS sign-in, and this wallet can't sign in yet. Register it with register_agent (a name and a short description), or link it to your BASIS account on the website.";
        }
        return ("This needs a BASIS sign-in or API key, and this server has neither right now. Set BASIS_PRIVATE_KEY " +
            "(the server signs in and makes an API key), or BASIS_API_KEY for read-only data.");
    }
    if (e instanceof basis_sdk_1.BasisApiError) {
        const said = serverWords(e);
        if (e.code === "wallet_not_linked") {
            return "This wallet can't sign in to BASIS yet. Register it with register_agent, or link it to your BASIS account on the website.";
        }
        if (e.code === "not_linked") {
            return "No X account is linked to this wallet. Link one with request_twitter_challenge and verify_twitter.";
        }
        if (e.code === "rate_limited" || e.status === 429) {
            const wait = e.retryAfter !== undefined
                ? ` Try again in ${retryWait(e.retryAfter)}.`
                : said
                    ? ` ${said}`
                    : " Try again later: this may be a daily limit.";
            return `The BASIS API is rate-limiting this wallet.${wait}`;
        }
        if (e.status === 401 && e.code !== "invalid_signature") {
            return ("BASIS refused this server's sign-in or API key (401). Try again once: the server signs in again. If it keeps " +
                "happening, the API key may have been revoked or replaced elsewhere: set BASIS_ROTATE_API_KEY=1 for one start to " +
                "make a new key (remove it again after), or put the current key in BASIS_API_KEY.");
        }
        if (e.code === "timeout")
            return "The BASIS API took too long to answer. Try again.";
        if (said && e.status >= 400 && e.status < 500)
            return `BASIS refused this: ${said}`;
        if (said && e.status >= 500)
            return `The BASIS API failed (${e.status}): ${said} Try again later.`;
        return clean(e.message);
    }
    if (e instanceof Error)
        return clean(e.message) || "Something went wrong.";
    return clean(String(e));
}
