"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isBlockReason = isBlockReason;
exports.blockText = blockText;
exports.rewordPredictionRefusal = rewordPredictionRefusal;
const basis_sdk_1 = require("basis-sdk");
function text(reason, kind) {
    switch (reason) {
        case "host paused":
            return kind === "private"
                ? "Predictions on creator-managed markets are paused right now. Try again later."
                : "Predictions on BASIS markets are paused right now. Try again later.";
        case "market resolved":
            return "This market is resolved, so predictions are over.";
        case "Betting closed":
            return "Predictions on this market closed at its end time.";
        case "Outcome proposed":
            return "A result has been proposed, so predictions are closed.";
        case "voting started":
            return "Voting has started on this open-ended market, so predictions are closed.";
        case "outcome":
            return `That outcome isn't on this market. See its outcomes with ${kind === "private" ? "private_get_market" : "get_market_info"}.`;
        case "not whitelisted":
            return "This market is in its presale phase and the wallet isn't on its whitelist. Ask the creator to add it.";
        case "not invited":
            return "This market is invite-only and the wallet isn't invited. Ask the creator to invite it.";
        case "convert closed":
            return "Predictions can't be processed right now. Try again later.";
        case "pair not active":
            return "Trading on the main this market runs on is paused right now, so predictions can't go through. Try again once it reopens.";
        case "Trading is not enabled":
            return "Trading on the main this market runs on hasn't opened yet, so predictions can't go through. Try again once it opens.";
        case "pair asset paused":
            return "The pair asset this market pays in (e.g. USDG) is paused by its issuer right now, so nothing can be paid in or out. Try again once it resumes.";
    }
}
function isBlockReason(rule) {
    return !!rule && basis_sdk_1.BUY_BLOCK_REASONS.includes(rule);
}
function blockText(reason, kind) {
    return reason ? text(reason, kind) : null;
}
function rewordPredictionRefusal(e, kind) {
    if (!(e instanceof basis_sdk_1.ValidationError))
        return e;
    if (isBlockReason(e.rule))
        return new basis_sdk_1.ValidationError(e.rule, text(e.rule, kind));
    if (/must be above 0/i.test(e.message))
        return new basis_sdk_1.ValidationError(e.rule, "The amount must be more than 0.");
    if ((e.rule === "minShares" || e.rule === "minTokens" || e.rule === "MinSharesNotMet") && /is above .* now/.test(e.message)) {
        return new basis_sdk_1.ValidationError(e.rule, "The minimum you asked for is more than this prediction gets right now, so it would be refused. Lower it, or leave it out.");
    }
    if (e.rule === "minShares" || /gives 0 shares/i.test(e.message)) {
        return new basis_sdk_1.ValidationError(e.rule, "That amount is too small to get any shares. Predict a bigger amount.");
    }
    return e;
}
