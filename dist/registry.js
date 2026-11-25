"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.p = void 0;
exports.tool = tool;
const zod_1 = require("zod");
const files_js_1 = require("./files.js");
function tool(def) {
    return def;
}
exports.p = {
    address: (desc) => zod_1.z.string().describe(desc),
    token: (desc = "Token address (0x...). Mains and pair assets can also be given by symbol, e.g. STASIS or USDG.") => zod_1.z.string().describe(desc),
    wallet: (desc = "Wallet address. Default: this server's wallet.") => zod_1.z.string().optional().describe(desc),
    main: (desc = "Main: key (e.g. stasis-usdg), address or symbol (STASIS). Default: the default main. List them with get_mains.") => zod_1.z.string().optional().describe(desc),
    amount: (desc) => zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).describe(`${desc} Human units, e.g. "12.5".`),
    optAmount: (desc) => zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).optional().describe(`${desc} Human units, e.g. "12.5".`),
    id: (desc) => zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).describe(desc),
    optId: (desc) => zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).optional().describe(desc),
    days: (desc = "Number of days.") => zod_1.z.number().int().positive().describe(desc),
    percent: (desc) => zod_1.z.number().describe(desc),
    slippage: () => zod_1.z
        .number()
        .min(0)
        .max(50)
        .optional()
        .describe("Max slippage in percent. Default: the server's setting (1% unless BASIS_SLIPPAGE_PERCENT changes it). At most 10% on real money " +
        "and 50% on paper, unless BASIS_MAX_SLIPPAGE_PERCENT sets another cap. The minimum you receive is set from a fresh quote."),
    limit: (max = 100, def = 20) => zod_1.z.number().int().min(1).max(max).optional().describe(`How many items (1 to ${max}, default ${def}).`),
    page: () => zod_1.z.number().int().min(1).optional().describe("Page number, from 1."),
    cursor: () => zod_1.z.string().optional().describe("Cursor from the previous page's result, for the next page."),
    bool: (desc) => zod_1.z.boolean().optional().describe(desc),
    imageFile: () => zod_1.z.string().optional().describe(files_js_1.IMAGE_FILE_TEXT),
    confirm: () => zod_1.z.boolean().optional().describe("Set true to send. Without it the tool only shows the preview (nothing is sent)."),
};
