"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.agentsTools = void 0;
const zod_1 = require("zod");
const viem_1 = require("viem");
const basis_sdk_1 = require("basis-sdk");
const registry_js_1 = require("../registry.js");
const units_js_1 = require("../units.js");
const present_js_1 = require("../present.js");
const ZERO = /^0x0{40}$/i;
const agentIdParam = () => registry_js_1.p.optId("Agent id (a number). Default: this server's own agent.");
function given(v) {
    return v !== undefined && v !== null && String(v).trim() !== "";
}
async function agentIdOfWallet(client, wallet, field) {
    const r = await client.agent.lookupFromApi(wallet);
    if (r.isAgent && r.agent)
        return BigInt(r.agent.agentId);
    const self = client.account && client.account.toLowerCase() === wallet.toLowerCase();
    throw new basis_sdk_1.ValidationError(field, self
        ? "This wallet isn't a BASIS agent yet. Register it with register_agent, or pass agent_id."
        : `${wallet} isn't a BASIS agent. Pass agent_id to read any agent by its id.`);
}
async function resolveAgentId(client, agentId, wallet) {
    if (given(agentId))
        return (0, units_js_1.uint)(agentId, "agent_id");
    if (!wallet) {
        const own = client.agentRegistration?.agentId;
        if (own !== null && own !== undefined)
            return own;
    }
    const field = wallet ? "wallet" : "agent_id";
    return agentIdOfWallet(client, (0, units_js_1.walletOrSelf)(client, wallet, field), field);
}
async function ownerOf(client, id) {
    try {
        return await client.agent.ownerOf(id);
    }
    catch (e) {
        if ((0, basis_sdk_1.isRevertNamed)(e, "ERC721NonexistentToken"))
            throw new basis_sdk_1.ValidationError("agent_id", `No agent has id ${id} on this network.`);
        throw e;
    }
}
function registrationFile(uri) {
    if (!uri)
        return null;
    return (0, basis_sdk_1.parseAgentMetadataUri)(uri) ?? { link: uri };
}
function metadataValue(value) {
    if (!value || value === "0x")
        return { text: null, hex: value };
    try {
        const s = (0, viem_1.hexToString)(value);
        return { text: /[\u0000-\u0008\u000E-\u001F�]/.test(s) ? null : s, hex: value };
    }
    catch {
        return { text: null, hex: value };
    }
}
const str = (v) => (typeof v === "string" && v.trim() ? v : undefined);
function capabilitiesOf(v) {
    return Array.isArray(v) && v.length && v.every((c) => typeof c === "string") ? v : undefined;
}
function servicesOf(v) {
    if (!Array.isArray(v))
        return undefined;
    const out = [];
    for (const s of v) {
        if (!s || typeof s !== "object")
            continue;
        const e = s;
        if (typeof e.name !== "string" || !e.name || typeof e.endpoint !== "string" || !e.endpoint)
            continue;
        out.push(typeof e.version === "string" && e.version ? { name: e.name, endpoint: e.endpoint, version: e.version } : { name: e.name, endpoint: e.endpoint });
    }
    return out.length ? out : undefined;
}
const MARK_NOTE = "The new registration file has no BASIS mark, so BASIS may stop recognising this agent. Write one with the mark " +
    'with update_agent, or mark the agent with set_agent_metadata (key "basis", any value).';
function markWarnings(list) {
    return list.map((w) => (/carries no BASIS mark/.test(w) ? MARK_NOTE : w));
}
function profileSync(reg) {
    if (reg.ok)
        return "updated";
    if (reg.queued)
        return "not updated yet: it's queued, retry_pending_syncs sends it";
    const head = "not updated (the on-chain record did change, so don't send it again)";
    if (reg.code === "not_branded")
        return `${head}: BASIS refused it because the record has no BASIS mark. ${MARK_NOTE}`;
    if (reg.code === "rate_limited" || reg.httpStatus === 429)
        return `${head}: BASIS is rate-limiting this wallet right now.`;
    if (reg.httpStatus === 409)
        return `${head}: BASIS has this agent id recorded for another wallet.`;
    if (reg.httpStatus === 401 || reg.httpStatus === 403)
        return `${head}: BASIS refused to record it for this wallet.`;
    if (reg.httpStatus === 0)
        return `${head}: BASIS couldn't be reached.`;
    return `${head}: BASIS didn't accept the update.`;
}
function agentWriteOut(client, r) {
    const base = (0, present_js_1.explorerUrl)(client);
    const reg = r.registration;
    const out = { status: "confirmed", hash: r.hash };
    if (base && r.hash)
        out.explorer = `${base.replace(/\/$/, "")}/tx/${r.hash}`;
    out.agentId = r.agentId;
    out.registration = registrationFile(r.uri);
    out.basisProfile = reg ? profileSync(reg) : null;
    if (r.applied)
        out.applied = r.applied;
    if (r.txSyncQueued)
        out.txSyncQueued = true;
    if (r.warnings.length)
        out.warnings = (0, present_js_1.plainWarnings)(markWarnings(r.warnings));
    return (0, present_js_1.userContent)(out);
}
function unreadFields(config, passed) {
    const lost = [];
    if (config.name === undefined)
        lost.push("name");
    if (config.description === undefined)
        lost.push("description");
    if (!passed.image)
        lost.push("image_url");
    if (!passed.capabilities)
        lost.push("capabilities");
    if (!passed.services)
        lost.push("services (they would become just the BASIS site link)");
    return lost;
}
exports.agentsTools = [
    (0, registry_js_1.tool)({
        name: "update_agent",
        toolset: "account",
        title: "Update agent profile",
        description: "Change this agent's public profile: name, description, image, capabilities or service links. Fields you leave " +
            "out keep their current value; an empty value removes a description, image or list. Rewrites the agent's whole " +
            "ERC-8004 record (costs a little ETH for gas) and updates its BASIS profile. Only the agent's owner wallet can do " +
            "it. set_agent_uri points the record at a file you host instead.",
        input: {
            agent_id: agentIdParam(),
            name: zod_1.z.string().optional().describe("Agent name, at most 100 characters."),
            description: zod_1.z.string().optional().describe("What the agent does, at most 500 characters."),
            image_url: zod_1.z.string().optional().describe("https or ipfs link to the agent's image (upload_image in the social tools gives one). Empty removes it."),
            capabilities: zod_1.z
                .array(zod_1.z.string())
                .max(32)
                .optional()
                .describe('What the agent does, as short tags, e.g. ["trading", "predictions"]. Replaces the list; [] clears it.'),
            services: zod_1.z
                .array(zod_1.z.object({
                name: zod_1.z.string().describe('Service name, e.g. "web", "MCP" or "A2A".'),
                endpoint: zod_1.z.string().describe("Its link."),
                version: zod_1.z.string().optional().describe("Its version, if any."),
            }))
                .max(16)
                .optional()
                .describe("Links where the agent can be reached. Replaces the list."),
            clear_missing: registry_js_1.p.bool("Only matters when the agent's current registration file is hosted elsewhere (https or ipfs) and can't be read " +
                "here: then every field must be passed, or set this true to leave out the ones you don't pass."),
        },
        write: true,
        destructive: true,
        run: async ({ agent_id, name, description, image_url, capabilities, services, clear_missing }, ctx) => {
            if ([name, description, image_url, capabilities, services].every((v) => v === undefined)) {
                throw new basis_sdk_1.ValidationError("name", "Pass at least one of name, description, image_url, capabilities, services.");
            }
            if (name !== undefined && !name.trim())
                throw new basis_sdk_1.ValidationError("name", "name must not be empty.");
            const image = image_url?.trim();
            if (image && !/^(https|ipfs):\/\//i.test(image))
                throw new basis_sdk_1.ValidationError("image_url", "image_url must be an https or ipfs link.");
            const client = await ctx.client();
            const id = await resolveAgentId(client, agent_id);
            await ownerOf(client, id);
            const uriNow = ((await client.agent.getAgentURI(id)) ?? "").trim();
            const parsed = uriNow ? (0, basis_sdk_1.parseAgentMetadataUri)(uriNow) : null;
            const current = parsed ?? {};
            let fallback = {};
            if (!parsed && client.account) {
                const row = await client.agent.lookupFromApi(client.account);
                if (row.agent && BigInt(row.agent.agentId) === id)
                    fallback = { name: row.agent.name ?? undefined, description: row.agent.description ?? undefined };
            }
            const config = {
                name: name !== undefined ? name.trim() : str(current.name) ?? fallback.name,
                description: description !== undefined ? description.trim() : str(current.description) ?? fallback.description,
                image: image !== undefined ? image : str(current.image),
                capabilities: capabilities ?? capabilitiesOf(current.capabilities),
                services: services ?? servicesOf(current.services),
            };
            if (uriNow && !parsed && !clear_missing) {
                const lost = unreadFields(config, { image: image !== undefined, capabilities: capabilities !== undefined, services: services !== undefined });
                if (lost.length) {
                    throw new basis_sdk_1.ValidationError(lost[0].split(" ")[0], "This agent's current registration file can't be read here (it is hosted elsewhere, e.g. https or ipfs), and " +
                        `the new record replaces it whole. These would be lost: ${lost.join(", ")}. Pass them too (an empty value ` +
                        "clears one), or set clear_missing: true to leave them out. Nothing was sent.");
                }
            }
            return agentWriteOut(client, await client.agent.update(id, config));
        },
    }),
    (0, registry_js_1.tool)({
        name: "set_agent_uri",
        toolset: "account",
        title: "Set agent registration link",
        description: "Advanced: point the agent's ERC-8004 record at a registration file you host (https, ipfs or a data: link). " +
            "update_agent is the simple way. A file without the BASIS mark (protocol \"basis\") can make BASIS stop " +
            "recognising the agent. Costs a little ETH for gas.",
        input: {
            agent_id: agentIdParam(),
            uri: zod_1.z.string().describe("Link to the new registration file."),
        },
        write: true,
        destructive: true,
        run: async ({ agent_id, uri }, ctx) => {
            const link = (uri ?? "").trim();
            if (!link)
                throw new basis_sdk_1.ValidationError("uri", "uri must not be empty.");
            const client = await ctx.client();
            const id = await resolveAgentId(client, agent_id);
            await ownerOf(client, id);
            const r = await client.agent.setAgentURI(id, link);
            const { uri: _raw, ...rest } = r;
            return (0, present_js_1.userContent)((0, present_js_1.txOut)(client, { ...rest, warnings: markWarnings(rest.warnings) }, { registration: registrationFile(r.uri) }));
        },
    }),
    (0, registry_js_1.tool)({
        name: "set_agent_metadata",
        toolset: "account",
        title: "Set agent metadata",
        description: "Set one public key and value on the agent's ERC-8004 record. For example key \"basis\" with any value marks an " +
            "agent registered elsewhere as a BASIS agent. Costs a little ETH for gas.",
        input: {
            agent_id: agentIdParam(),
            key: zod_1.z.string().describe('The key, e.g. "basis".'),
            value: zod_1.z.string().describe("The value: text, or 0x hex for raw bytes."),
        },
        write: true,
        run: async ({ agent_id, key, value }, ctx) => {
            const k = (key ?? "").trim();
            if (!k)
                throw new basis_sdk_1.ValidationError("key", "key must not be empty.");
            const client = await ctx.client();
            const id = await resolveAgentId(client, agent_id);
            await ownerOf(client, id);
            const r = await client.agent.setMetadata(id, k, value);
            const { value: raw, ...rest } = r;
            return (0, present_js_1.userContent)((0, present_js_1.txOut)(client, rest, { value: raw ? metadataValue(raw) : null }));
        },
    }),
    (0, registry_js_1.tool)({
        name: "list_agents",
        toolset: "account",
        title: "BASIS agents",
        description: "Agents registered on BASIS, newest first: wallet, agent id, name and description. One wallet's agent: get_agent.",
        input: { page: registry_js_1.p.page(), limit: registry_js_1.p.limit(100, 20) },
        run: async ({ page, limit }, ctx) => {
            const client = await ctx.client();
            return (0, present_js_1.userContent)(await client.agent.listAgents(page ?? 1, limit ?? 20));
        },
    }),
    (0, registry_js_1.tool)({
        name: "is_agent_registered",
        toolset: "account",
        title: "Is it a BASIS agent?",
        description: "Check whether a wallet acts as a BASIS agent, or whether an agent id is one. Checked on chain (the wallet must " +
            "own the agent or be its declared agent wallet) and against the BASIS records. The agent's name and profile: " +
            "get_agent (BASIS record) or get_agent_registration (on-chain record).",
        input: {
            wallet: registry_js_1.p.wallet("Wallet to check. Default: this server's wallet (unless only agent_id is given)."),
            agent_id: registry_js_1.p.optId("Agent id to check. With wallet: whether that wallet acts as this agent."),
        },
        run: async ({ wallet, agent_id }, ctx) => {
            const client = await ctx.client();
            if (given(agent_id) && !wallet) {
                const id = (0, units_js_1.uint)(agent_id, "agent_id");
                const owner = await ownerOf(client, id);
                const [mark, agentWallet] = await Promise.all([client.agent.isBasisAgent(id), client.agent.getAgentWallet(id)]);
                const holders = [owner, agentWallet].filter((w, i, all) => !ZERO.test(w) && all.findIndex((x) => x.toLowerCase() === w.toLowerCase()) === i);
                const rows = await Promise.all(holders.map((w) => client.agent.lookupFromApi(w)));
                const recordedFor = holders.find((_w, i) => rows[i].isAgent && rows[i].agent && BigInt(rows[i].agent.agentId) === id) ?? null;
                return {
                    agentId: id,
                    isBasisAgent: mark || recordedFor !== null,
                    basisMarkOnChain: mark,
                    recordedByBasisFor: recordedFor,
                    owner,
                    agentWallet: ZERO.test(agentWallet) ? null : agentWallet,
                };
            }
            const who = (0, units_js_1.walletOrSelf)(client, wallet);
            const id = given(agent_id) ? (0, units_js_1.uint)(agent_id, "agent_id") : undefined;
            if (id !== undefined)
                await ownerOf(client, id);
            const [registered, anyIdentity, record] = await Promise.all([
                client.agent.isRegistered(who, id),
                client.agent.hasIdentity(who),
                client.agent.lookupFromApi(who),
            ]);
            return {
                wallet: who,
                isBasisAgent: registered,
                agentId: id ?? (record.isAgent && record.agent ? record.agent.agentId : null),
                ownsAnyAgentIdentity: anyIdentity,
            };
        },
    }),
    (0, registry_js_1.tool)({
        name: "get_agent_registration",
        toolset: "account",
        title: "Agent record",
        description: "An agent's public ERC-8004 record on chain: owner wallet, agent wallet, registration file (name, description, " +
            "image, capabilities, links), whether it carries the BASIS mark, and whether this server's wallet can change it. " +
            "What BASIS has on record for a wallet: get_agent.",
        input: {
            agent_id: registry_js_1.p.optId("Agent id. Default: the agent of wallet."),
            wallet: registry_js_1.p.wallet("Wallet whose agent to read when agent_id isn't given. Default: this server's wallet."),
            metadata_key: zod_1.z.string().optional().describe('Also read this public key on the record, e.g. "basis".'),
        },
        run: async ({ agent_id, wallet, metadata_key }, ctx) => {
            const client = await ctx.client();
            const id = await resolveAgentId(client, agent_id, wallet);
            const owner = await ownerOf(client, id);
            const [uri, agentWallet, mark] = await Promise.all([client.agent.getAgentURI(id), client.agent.getAgentWallet(id), client.agent.isBasisAgent(id)]);
            const out = {
                agentId: id,
                owner,
                agentWallet: ZERO.test(agentWallet) ? null : agentWallet,
                registration: registrationFile(uri),
                basisMarkOnChain: mark,
            };
            if (client.account)
                out.thisWalletCanEdit = await client.agent.isAuthorizedOrOwner(client.account, id);
            const key = metadata_key?.trim();
            if (key)
                out.metadata = { key, ...metadataValue(await client.agent.getMetadata(id, key)) };
            return (0, present_js_1.userContent)(out);
        },
    }),
    (0, registry_js_1.tool)({
        name: "get_agent_id_from_tx",
        toolset: "account",
        title: "Agent id from a transaction",
        description: "Recovery: the agent id a registration transaction created (null if it created none).",
        input: { tx_hash: zod_1.z.string().describe("Transaction hash (0x...).") },
        run: async ({ tx_hash }, ctx) => {
            const h = (tx_hash ?? "").trim();
            if (!/^0x[0-9a-fA-F]{64}$/.test(h))
                throw new basis_sdk_1.ValidationError("tx_hash", "tx_hash must be 0x followed by 64 hex characters.");
            const client = await ctx.client();
            const agentId = await client.agent.getAgentIdFromTx(h);
            return { txHash: h, agentId };
        },
    }),
];
