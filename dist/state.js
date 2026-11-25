"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readWalletState = readWalletState;
exports.saveApiKey = saveApiKey;
exports.savePendingRegistration = savePendingRegistration;
exports.syncQueueFile = syncQueueFile;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const DEFAULT_SITES = {
    robinhood: "launchonbasis.com",
    robinhoodPaper: "paper.launchonbasis.com",
};
function siteSuffix(config) {
    if (!config.apiDomain)
        return "";
    let host;
    try {
        host = new URL(config.apiDomain).host.toLowerCase();
    }
    catch {
        host = config.apiDomain.replace(/^[a-z]+:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
    }
    if (!host || DEFAULT_SITES[config.chain] === host)
        return "";
    return `-${host.replace(/[^a-z0-9.]+/g, "_")}`;
}
function fileFor(config, wallet, suffix) {
    return (0, node_path_1.join)(config.stateDir, `${config.chain}${siteSuffix(config)}-${wallet.toLowerCase()}${suffix}`);
}
function ensureDir(config) {
    (0, node_fs_1.mkdirSync)(config.stateDir, { recursive: true, mode: 0o700 });
}
function readWalletState(config, wallet) {
    const path = fileFor(config, wallet, ".json");
    if (!(0, node_fs_1.existsSync)(path))
        return {};
    try {
        const s = JSON.parse((0, node_fs_1.readFileSync)(path, "utf8"));
        if (s.pendingRegistrationTx && !s.pendingRegistration)
            s.pendingRegistration = { hash: s.pendingRegistrationTx, savedAt: Date.now() };
        delete s.pendingRegistrationTx;
        return s;
    }
    catch {
        console.error(`[basis-mcp] The state file for this wallet in ${config.stateDir} can't be read: its saved API key is ignored this run.`);
        return {};
    }
}
function saveApiKey(config, wallet, apiKey) {
    writeState(config, wallet, { ...readWalletState(config, wallet), apiKey });
}
function savePendingRegistration(config, wallet, hash) {
    const { pendingRegistration: _old, ...rest } = readWalletState(config, wallet);
    writeState(config, wallet, hash ? { ...rest, pendingRegistration: { hash, savedAt: Date.now() } } : rest);
}
function writeState(config, wallet, state) {
    ensureDir(config);
    const path = fileFor(config, wallet, ".json");
    const tmp = `${path}.${process.pid}.tmp`;
    (0, node_fs_1.writeFileSync)(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    try {
        (0, node_fs_1.chmodSync)(tmp, 0o600);
    }
    catch {
    }
    (0, node_fs_1.renameSync)(tmp, path);
}
function syncQueueFile(config, wallet) {
    ensureDir(config);
    return fileFor(config, wallet, "-sync-queue.jsonl");
}
