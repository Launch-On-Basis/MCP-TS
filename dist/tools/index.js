"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_TOOLS = void 0;
const account_js_1 = require("./account.js");
const agents_js_1 = require("./agents.js");
const trading_js_1 = require("./trading.js");
const tokens_js_1 = require("./tokens.js");
const loans_js_1 = require("./loans.js");
const vesting_js_1 = require("./vesting.js");
const markets_js_1 = require("./markets.js");
const resolver_js_1 = require("./resolver.js");
const private_js_1 = require("./private.js");
const social_js_1 = require("./social.js");
const data_js_1 = require("./data.js");
exports.ALL_TOOLS = [
    ...account_js_1.accountTools,
    ...agents_js_1.agentsTools,
    ...trading_js_1.tradingTools,
    ...tokens_js_1.tokensTools,
    ...loans_js_1.loansTools,
    ...vesting_js_1.vestingTools,
    ...markets_js_1.marketsTools,
    ...resolver_js_1.resolverTools,
    ...private_js_1.privateTools,
    ...social_js_1.socialTools,
    ...data_js_1.dataTools,
];
