
import { z } from "zod";
import { erc20Abi, formatEther, formatUnits, maxUint256, zeroAddress, type Address } from "viem";
import { FactoryTokenAbi, MainTokenAbi, TaxesAbi, TxNotConfirmedError, ValidationError, isZeroAddress } from "basis-sdk";
import type { BasisClient, MainInfo, TokenUploadError } from "basis-sdk";
import { p, tool, type ToolDef } from "../registry.js";
import { addr, resolveMain, resolveToken, to18, toPairRaw, walletOrSelf } from "../units.js";
import { explorerUrl, txOut, userContent } from "../present.js";
import { GuidedError, errorText } from "../errors.js";
import { imageFromUrl, readLocalImage } from "../files.js";
import { checkSpend } from "../limits.js";


/** The site's six token families: the setting range each covers and its default. */
const FAMILY_NAMES = ["Stable+", "Utility+", "Floor+", "Meme+", "Yolo+", "Yolo"] as const;
type FamilyName = (typeof FAMILY_NAMES)[number];
const FAMILIES: Record<FamilyName, { reversed: boolean; min: number; max: number; def: number }> = {
  "Stable+": { reversed: false, min: 100, max: 100, def: 100 },
  "Utility+": { reversed: false, min: 50, max: 90, def: 70 },
  "Floor+": { reversed: false, min: 1, max: 40, def: 1 },
  "Meme+": { reversed: true, min: 10, max: 50, def: 20 },
  "Yolo+": { reversed: true, min: 60, max: 90, def: 80 },
  Yolo: { reversed: true, min: 100, max: 100, def: 100 },
};

/**
 * A live token's family as the site names it: settings between the dial's stops fall in the band around them
 * (H41-49 Floor+, H91-99 Utility+, R1-9 Meme+, R51-59 and R91-99 Yolo+).
 */
function familyOf(multiplier: number, reversed: boolean): { family: FamilyName; setting: string } {
  const m = Math.max(1, Math.min(100, Math.round(multiplier)));
  const family: FamilyName = reversed
    ? m >= 100 ? "Yolo" : m <= 50 ? "Meme+" : "Yolo+"
    : m >= 100 ? "Stable+" : m >= 50 ? "Utility+" : "Floor+";
  return { family, setting: `${reversed ? "R" : "H"}${m}` };
}

const TOKEN_DESC = "Token address (0x...) of a token made on BASIS. Find it with search_tokens or get_my_tokens.";

/** 18-decimal token wei as a human amount. */
const tok = (raw: bigint): string => formatUnits(raw, 18);
/** Unix seconds as ISO time; null for 0. */
const iso = (sec: number | bigint): string | null => (Number(sec) > 0 ? new Date(Number(sec) * 1000).toISOString() : null);

/** A percent with at most 2 decimals as basis points, within [minBps, maxBps]. */
function toBps(value: number, field: string, minBps: number, maxBps: number): number {
  const bps = Math.round(value * 100);
  if (!Number.isFinite(value) || Math.abs(value * 100 - bps) > 1e-6 || bps < minBps || bps > maxBps) {
    throw new ValidationError(field, `${field} must be ${minBps / 100} to ${maxBps / 100} (steps of 0.01), got ${value}.`);
  }
  return bps;
}

/** A token made on BASIS (not a main, not an outside token), from what the agent typed. */
async function factoryToken(client: BasisClient, ref: string, field = "token"): Promise<Address> {
  const t = await resolveToken(client, ref, field);
  if (await client.mains.isMain(t)) {
    throw new ValidationError(field, `${ref} is a main (a base token other tokens trade against). This tool works on tokens made on BASIS: pass one by address.`);
  }
  await assertMadeOnBasis(client, t, field);
  return t;
}

async function assertMadeOnBasis(client: BasisClient, t: Address, field = "token"): Promise<void> {
  const creator = await client.factory.creatorOf(t);
  if (isZeroAddress(creator)) {
    throw new ValidationError(field, `${t} isn't a token made on BASIS. Find token addresses with search_tokens or get_my_tokens.`);
  }
}

/** Frozen / presale state of a factory token. */
async function presaleFlags(client: BasisClient, t: Address): Promise<{ frozen: boolean; presaleDone: boolean }> {
  const [frozen, presaleDone] = await Promise.all([
    client.publicClient.readContract({ address: t, abi: FactoryTokenAbi, functionName: "frozen" }),
    client.publicClient.readContract({ address: t, abi: FactoryTokenAbi, functionName: "presaleComplete" }),
  ]);
  return { frozen, presaleDone };
}

/** The image bytes of an image_url or image_file_path input (exactly one is set), checked before anything is sent. */
async function imageBytes(client: BasisClient, url: string | undefined, file: string | undefined): Promise<Uint8Array | undefined> {
  if (file) return (await readLocalImage(file)).bytes;
  if (url) return (await imageFromUrl(client, url)).bytes;
  return undefined;
}

/** The base-fee discount for a wallet with a referrer, in percent, read from the chain once; null when it can't be read. */
let referralDiscount: number | undefined;
async function referralDiscountPercent(client: BasisClient): Promise<number | null> {
  if (referralDiscount !== undefined) return referralDiscount;
  try {
    const v = await client.publicClient.readContract({ address: client.addresses.taxes, abi: TaxesAbi, functionName: "REFERRAL_DISCOUNT_PCT" });
    referralDiscount = Number(v);
    return referralDiscount;
  } catch {
    return null;
  }
}

/** The referral line for fee reads, with the discount from the chain when it can be read. */
function referralText(baseBps: number, discount: number | null): string {
  if (discount === null) return "A wallet with a referrer pays a lower base fee; get_tax_rate gives one wallet's rate.";
  const withRef = Math.floor((baseBps * (100 - discount)) / 100) / 100;
  return `A wallet with a referrer pays ${discount}% less base fee (${withRef}% instead of ${baseBps / 100}%); get_tax_rate gives one wallet's rate.`;
}

/** Why an upload failed, in plain words (the SDK's own text names its methods and the site's routes). */
function uploadReason(u: TokenUploadError): string {
  if (u.stage === "token") return "The new token's address couldn't be read from the launch transaction, so nothing was uploaded.";
  return errorText(u.cause ?? new Error(u.message));
}

function uploadErrorOut(u: TokenUploadError | null): Record<string, unknown> | null {
  return u ? { stage: u.stage, reason: uploadReason(u) } : null;
}

/** The SDK's warnings about a failed upload: uploadError and next already say it, in tool names. */
const UPLOAD_WARNING = /upload failed|token address is unknown/;

/** Rethrow an SDK ValidationError whose text names internals, in plain words (keyed by its rule). */
async function plainly<T>(run: Promise<T>, rules: Record<string, string>): Promise<T> {
  try {
    return await run;
  } catch (e) {
    if (e instanceof ValidationError && rules[e.rule]) throw new ValidationError(e.rule, rules[e.rule]);
    throw e;
  }
}

/** Each main's pair asset once (two mains can share one). */
async function pairAssets(client: BasisClient): Promise<MainInfo[]> {
  const seen = new Set<string>();
  const out: MainInfo[] = [];
  for (const m of await client.mains.list()) {
    const k = m.pairAsset.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(m);
  }
  return out;
}

async function inBatches<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.allSettled(items.slice(i, i + size).map(fn))));
  return out;
}

const metaInput = {
  description: z.string().optional().describe("About the token, at most 5000 characters."),
  website: z.string().optional().describe("Website: an https link (a bare domain gets https:// in front), at most 191 characters."),
  telegram: z.string().optional().describe("Telegram: a t.me link (https://t.me/your_channel, invite links too) or @handle (4 to 32 letters, digits or _)."),
  x: z.string().optional().describe("X profile: a handle (up to 15 letters, digits or _) or an x.com / twitter.com profile link."),
};
const IMAGE_URL_TEXT =
  "An https link to the token image (png, jpeg, gif or webp), downloaded and checked before anything is sent, and resized to 512x512 when the server can. The upload is public and permanent.";
const imageUrlInput = z.string().optional();

export const tokensTools: ToolDef[] = [
  tool({
    name: "create_token",
    toolset: "tokens",
    title: "Launch a token",
    description:
      "Launch a new token on BASIS with its image and links. Choose its family (how price and floor behave), launch " +
      "depth, an optional presale (open or whitelist-only) with auto-vest, and holder rewards: these settings are " +
      "permanent. Costs the creation fee in ETH (get_fee_amount) plus gas, both real ETH (on paper too).",
    input: {
      name: z.string().describe('Token name, e.g. "Moon Cats". Spaces at either end are trimmed off, and it must not be empty.'),
      symbol: z.string().describe('Ticker: 1 to 10 letters or digits, e.g. "MCAT" (lower case is sent as upper case).'),
      family: z
        .enum(FAMILY_NAMES)
        .describe(
          "Token family (permanent): Stable+ (price and floor move together), Utility+ (calmer moves for long-term " +
            "communities), Floor+ (room to run, a floor that builds), Meme+ (bigger moves with a growing floor), Yolo+ " +
            "(more swing, less floor support), Yolo (full market movement, fixed supply).",
        ),
      family_setting: z
        .number()
        .int()
        .optional()
        .describe(
          "Optional fine-tune inside the family (the H or R number the site shows): Utility+ 50 to 90 (default 70), " +
            "Floor+ 1 to 40 (default 1), Meme+ 10 to 50 (default 20), Yolo+ 60 to 90 (default 80). Stable+ and Yolo " +
            "are fixed at 100. In Utility+ and Floor+ a higher number keeps more of the price as floor; in Meme+ and " +
            "Yolo+ a higher number is closer to a fixed-supply token.",
        ),
      launch_depth_percent: z
        .number()
        .optional()
        .describe(
          "Starting liquidity, in percent of the main's own launch depth: 10 to 1000 (default 100). Virtual: you " +
            "deposit nothing. More depth means less price impact per trade and a bigger launch supply.",
        ),
      holder_rewards: p.bool(
        "Holder rewards (permanent, default false): holders share a rewards fee taken on trades, paid in the pair asset " +
          "and claimed with claim_rewards. The fee starts at 0%: set it with set_rewards_fee.",
      ),
      presale_percent: z
        .number()
        .optional()
        .describe(
          "Share of the launch supply sold in a presale first, 0 to 100 (Meme+, Yolo+ and Yolo: at most 50). Default " +
            "0: no presale, trading opens at launch. Needed for frozen and auto_vest_days.",
        ),
      frozen: p.bool(
        "Whitelist-only presale: only wallets you whitelist can buy until the presale sells out, then trading opens to " +
          "everyone. You can open it early with unfreeze_token; once open it can't be made whitelist-only again. Needs presale_percent.",
      ),
      whitelist: z
        .array(z.string())
        .max(200)
        .optional()
        .describe("Wallets (0x...) to whitelist right after launch, each up to whitelist_cap (frozen launches only), at most 200. Later: whitelist_wallets."),
      whitelist_cap: p.optAmount("With whitelist: the most presale tokens each of those wallets may buy, in tokens."),
      auto_vest_days: z
        .number()
        .int()
        .optional()
        .describe("Lock presale buys and release them over this many days, 1 to 990. Needs presale_percent. Default: no vesting."),
      gradual_vest: p.bool("With auto_vest_days: release a little at a time (true) or all at once at the end (false, the default)."),
      main: p.main("Main the token trades against: key, address or symbol (e.g. STASIS). Default: the default main. List them with get_mains."),
      ...metaInput,
      image_url: imageUrlInput.describe(`${IMAGE_URL_TEXT} Give image_url or image_file_path.`),
      image_file_path: p.imageFile(),
    },
    write: true,
    run: async (a, ctx) => {
      const client = await ctx.client();

      const fam = FAMILIES[a.family];
      const multiplier = a.family_setting ?? fam.def;
      if (multiplier < fam.min || multiplier > fam.max) {
        throw new ValidationError(
          "family_setting",
          fam.min === fam.max
            ? `${a.family} is always ${fam.min}: leave family_setting out.`
            : `family_setting for ${a.family} must be a whole number from ${fam.min} to ${fam.max}, got ${a.family_setting}.`,
        );
      }
      const startLP = toBps(a.launch_depth_percent ?? 100, "launch_depth_percent", 1000, 100000);

      const presalePct = a.presale_percent ?? 0;
      const presaleBps = toBps(presalePct, "presale_percent", 0, 10000);
      if (fam.reversed && presaleBps > 5000) {
        throw new ValidationError("presale_percent", `On ${a.family} the presale can be at most 50% of the launch supply, got ${presalePct}.`);
      }
      const frozen = a.frozen ?? false;
      if (frozen && presaleBps === 0) throw new ValidationError("frozen", "A whitelist-only launch needs a presale: set presale_percent.");
      const autoVest = a.auto_vest_days !== undefined;
      if (autoVest) {
        if (presaleBps === 0) throw new ValidationError("auto_vest_days", "Auto-vest locks presale buys, so it needs a presale: set presale_percent.");
        if (a.auto_vest_days! < 1 || a.auto_vest_days! > 990) throw new ValidationError("auto_vest_days", `auto_vest_days must be 1 to 990, got ${a.auto_vest_days}.`);
      }
      if (a.gradual_vest && !autoVest) throw new ValidationError("gradual_vest", "gradual_vest needs auto_vest_days.");

      const whitelist = (a.whitelist ?? []).map((w, i) => addr(w, `whitelist[${i}]`));
      let cap = 0n;
      if (whitelist.length) {
        if (!frozen) throw new ValidationError("whitelist", "A whitelist only matters on a whitelist-only launch: set frozen: true, or leave whitelist out.");
        if (a.whitelist_cap === undefined) throw new ValidationError("whitelist_cap", "Pass whitelist_cap: the most presale tokens each whitelisted wallet may buy.");
        cap = to18(a.whitelist_cap, "whitelist_cap");
        if (cap === 0n) throw new ValidationError("whitelist_cap", "whitelist_cap must be above 0: a wallet with cap 0 can buy nothing.");
      }

      if (!a.image_url === !a.image_file_path) throw new ValidationError("image_url", "Give exactly one image: image_url or image_file_path.");

      const info = await resolveMain(client, a.main);
      if (!info.registered) throw new ValidationError("main", `New tokens can't launch on ${info.symbol} yet. Pick another main (get_mains).`);
      if (!info.active) throw new ValidationError("main", `Trading on ${info.symbol} is paused, so no token can launch on it right now.`);

      const seed = await client.publicClient.readContract({ address: info.main, abi: MainTokenAbi, functionName: "baseReserve1" });
      const depth = (seed * BigInt(startLP)) / 10_000n;
      const supplyWei = (depth * 10n ** 18n) / info.pairUnit;
      const presaleTokens = (supplyWei * BigInt(presaleBps)) / 10_000n / 10n ** 18n;
      if (presaleBps > 0 && presaleTokens === 0n) {
        throw new ValidationError(
          "presale_percent",
          `${presalePct}% of a launch supply of ${tok(supplyWei)} tokens is less than one whole token. Raise presale_percent or launch_depth_percent.`,
        );
      }
      const image = await imageBytes(client, a.image_url, a.image_file_path);
      if (ctx.config.maxSpendUsd !== undefined) await checkSpend(client, zeroAddress, await client.factory.getCreationFee());

      const r = await client.factory.createTokenWithMetadata({
        name: a.name,
        symbol: a.symbol,
        hybridMultiplier: multiplier,
        reversed: fam.reversed,
        startLP,
        frozen,
        presaleTokens,
        rewardsEnabled: a.holder_rewards ?? false,
        autoVest,
        autoVestDuration: autoVest ? a.auto_vest_days : undefined,
        gradualAutovest: autoVest ? (a.gradual_vest ?? false) : false,
        main: info.main,
        description: a.description,
        website: a.website,
        telegram: a.telegram,
        twitterx: a.x,
        imageFile: image,
      });

      const { result: _result, uploadError, warnings: sdkWarnings, ...rest } = r;
      const warnings = uploadError ? sdkWarnings.filter((w) => !UPLOAD_WARNING.test(w)) : [...sdkWarnings];
      let whitelisted: Record<string, unknown> | undefined;
      if (whitelist.length) {
        if (!r.token) {
          warnings.push("The wallets were not whitelisted (the new token's address is unknown): find it with get_my_tokens, then use whitelist_wallets.");
        } else {
          try {
            const w = await client.factory.setWhitelistedWallet(r.token, whitelist, cap, "");
            whitelisted = { hash: w.hash, added: w.added, skipped: w.skipped, capPerWallet: w.cap };
            warnings.push(...w.warnings);
          } catch (e) {
            warnings.push(
              e instanceof TxNotConfirmedError
                ? `The token is live. Whitelisting the wallets was sent but isn't confirmed yet: ${e.txHash}. Check it with get_transaction (or get_whitelist) before whitelisting them again with whitelist_wallets. Don't create the token again.`
                : `The token is live, but whitelisting the wallets failed: ${errorText(e, explorerUrl(client))} Add them with whitelist_wallets (don't create the token again).`,
            );
          }
        }
      }

      const next: string[] = [];
      if (uploadError) {
        next.push(
          r.token
            ? `The token is live, but its ${uploadError.stage} upload failed. Finish it with retry_token_metadata (token ${r.token}` +
                `${r.imageUrl ? `, hosted_image_url ${r.imageUrl}` : ""}). Don't create the token again.`
            : "Find the new token with get_my_tokens, then add its image and details with retry_token_metadata. Don't create it again.",
        );
      }
      if (frozen && !whitelisted) next.push("Only you can buy for now: whitelist buyers with whitelist_wallets, or open trading to everyone with unfreeze_token.");
      if (a.holder_rewards) next.push("The holder rewards fee starts at 0%: set it with set_rewards_fee.");

      const out = { ...rest, warnings, uploadError: uploadErrorOut(uploadError) };
      return txOut(client, out, {
        family: a.family,
        setting: familyOf(multiplier, fam.reversed).setting,
        main: info.symbol,
        launchDepth: `${formatUnits(depth, info.pairDecimals)} ${info.pairSymbol} (virtual: nothing was deposited)`,
        launchSupply: `${tok(supplyWei)} tokens`,
        presale: presaleTokens > 0n ? `${presaleTokens} tokens${frozen ? ", whitelist only" : ""}${autoVest ? `, vested over ${a.auto_vest_days} days` : ""}` : "none",
        whitelist: whitelisted,
        next: next.length ? next : undefined,
      });
    },
  }),

  tool({
    name: "retry_token_metadata",
    toolset: "tokens",
    title: "Finish a token's image and details",
    description:
      "Finish a launch whose image or details upload failed (create_token says so). Sends no transaction. Only the " +
      "token's creator, and only once per token: to change details later, use update_token_details.",
    input: {
      token: p.token(TOKEN_DESC),
      image_url: imageUrlInput.describe(`${IMAGE_URL_TEXT} Give one image source.`),
      image_file_path: p.imageFile(),
      hosted_image_url: z
        .string()
        .optional()
        .describe("An image already hosted for this token (the imageUrl create_token returned when only the details failed): not uploaded again."),
      ...metaInput,
    },
    write: true,
    sendsTx: false,
    run: async (a, ctx) => {
      const client = await ctx.client();
      const t = await factoryToken(client, a.token);
      const sources = [a.image_url, a.image_file_path, a.hosted_image_url].filter((v) => v !== undefined && v !== "").length;
      if (sources !== 1) throw new ValidationError("image_url", "Give exactly one of image_url, image_file_path or hosted_image_url.");
      const img = await imageBytes(client, a.image_url, a.image_file_path);
      const r = await client.factory.retryTokenMetadata(t, {
        imageFile: img,
        hostedImageUrl: a.hosted_image_url || undefined,
        description: a.description,
        website: a.website,
        telegram: a.telegram,
        twitterx: a.x,
      });
      const u = r.uploadError;
      if (!u) return { status: "done", token: t, imageUrl: r.imageUrl, metadata: r.metadata };
      if (u.code === "exists") return { token: t, status: "already set", problem: "This token already has its image and details (they can be set only once here).", next: "Change them with update_token_details." };
      if (u.stage === "metadata" && r.imageUrl) {
        return {
          status: "image uploaded, details not saved",
          token: t,
          hostedImageUrl: r.imageUrl,
          reason: uploadReason(u),
          next: "Call retry_token_metadata again with hosted_image_url set to hostedImageUrl (no new upload).",
        };
      }
      throw new GuidedError(`The ${u.stage} upload failed: ${uploadReason(u)}`);
    },
  }),

  tool({
    name: "update_token_details",
    toolset: "tokens",
    title: "Edit a token's details",
    description:
      "Change a token's description, links or image on BASIS (no transaction). Only the token's creator. Pass only what " +
      "changes; an empty string removes a link. For a launch whose upload failed, use retry_token_metadata first.",
    input: {
      token: p.token(TOKEN_DESC),
      ...metaInput,
      image_url: imageUrlInput.describe(`New image: ${IMAGE_URL_TEXT}`),
      image_file_path: p.imageFile(),
    },
    write: true,
    sendsTx: false,
    run: async (a, ctx) => {
      const client = await ctx.client();
      const t = await factoryToken(client, a.token);
      if (a.image_url && a.image_file_path) throw new ValidationError("image_url", "Give image_url or image_file_path, not both.");
      let bytes: Uint8Array | undefined;
      let filename: string | undefined;
      if (a.image_file_path) {
        const img = await readLocalImage(a.image_file_path);
        bytes = img.bytes;
        filename = img.filename;
      } else if (a.image_url) {
        const img = await imageFromUrl(client, a.image_url);
        bytes = img.bytes;
        filename = img.resized ? `${t}.webp` : img.filename;
      }
      const payload: { description?: string; website?: string; telegram?: string; twitterx?: string } = {};
      if (a.description !== undefined) payload.description = a.description;
      if (a.website !== undefined) payload.website = a.website;
      if (a.telegram !== undefined) payload.telegram = a.telegram;
      if (a.x !== undefined) payload.twitterx = a.x;
      if (!Object.keys(payload).length && !bytes) {
        throw new ValidationError("description", "Pass at least one of description, website, telegram, x or an image.");
      }
      const r = await client.api.updateProject(t, payload, bytes, filename);
      const row: Record<string, unknown> = r.project ?? {};
      const stored = (key: string, sent: string): unknown => (key in row ? (row[key] ?? null) : sent || null);
      const changed: Record<string, unknown> = {};
      if (payload.description !== undefined) changed.description = stored("description", payload.description);
      if (payload.website !== undefined) changed.website = stored("website", payload.website);
      if (payload.telegram !== undefined) changed.telegram = stored("telegram", payload.telegram);
      if (payload.twitterx !== undefined) changed.x = stored("twitterx", payload.twitterx);
      if (bytes) changed.image = "new image uploaded";
      const imageUrl = typeof row.image === "string" && row.image ? row.image : null;
      return userContent({ status: "updated", token: t, changed, imageUrl });
    },
  }),

  tool({
    name: "get_fee_amount",
    toolset: "tokens",
    title: "Token creation fee",
    description:
      "The fee to launch a token, in ETH (on top of gas), and what a given wallet pays: some wallets launch for free. " +
      "The fee and gas are real ETH, on paper too.",
    input: { wallet: p.wallet("Wallet that would launch the token. Default: this server's wallet.") },
    run: async ({ wallet }, ctx) => {
      const client = await ctx.client();
      const fee = await client.factory.getFeeAmount();
      const who = wallet ? addr(wallet, "wallet") : client.account;
      const out: Record<string, unknown> = { creationFee: `${formatEther(fee)} ETH` };
      if (who) {
        const free = await client.factory.isFeeWhitelisted(who);
        out.wallet = who;
        out.thisWalletPays = `${formatEther(free ? 0n : fee)} ETH`;
      }
      return out;
    },
  }),

  tool({
    name: "get_token_state",
    toolset: "tokens",
    title: "Token state",
    description:
      "One token's settings and state from the chain: family, main, creator, price and floor, supply, presale " +
      "progress, who can buy, auto-vest and holder rewards. A main gives its price and supply. For volume, holders and " +
      "the token's page details use get_token_details (data tools); for its fees, get_fee_settings.",
    input: { token: p.token() },
    run: async ({ token }, ctx) => {
      const client = await ctx.client();
      const t = await resolveToken(client, token);
      if (await client.mains.isMain(t)) {
        const info = await client.mains.get(t);
        const [price, supply] = await Promise.all([client.trading.getPairPrice(t), client.factory.getTotalSupply(t)]);
        return {
          token: t,
          kind: "main",
          name: info.name,
          symbol: info.symbol,
          pairAsset: info.pairSymbol,
          price,
          totalSupply: tok(supply),
          tradingOpen: info.active && info.tradingEnabled,
          newTokensAllowed: info.registered,
        };
      }
      await assertMadeOnBasis(client, t);
      const [s, name, meta, floor] = await Promise.all([
        client.factory.getTokenState(t),
        client.publicClient.readContract({ address: t, abi: erc20Abi, functionName: "name" }),
        client.mains.tokenMeta(t),
        client.factory.getFloorPrice(t),
      ]);
      const info = await client.mains.get(s.main);
      const fam = familyOf(Number(s.hybridMultiplier), s.reversed);
      return userContent({
        token: s.token,
        kind: "token made on BASIS",
        name,
        symbol: meta.symbol,
        family: fam.family,
        setting: fam.setting,
        main: info.symbol,
        pairAsset: info.pairSymbol,
        creator: s.dev,
        created: iso(s.creationTime),
        listed: s.listed,
        price: s.pairPrice,
        priceInMain: s.tokenPrice,
        floorPrice: floor,
        totalSupply: tok(s.totalSupply),
        whoCanBuy: s.frozen && !s.presaleComplete ? "whitelisted wallets only" : "everyone",
        presale:
          s.presaleTarget === 0n
            ? null
            : {
                sold: `${tok(s.presaleSold)} of ${tok(s.presaleTarget)} tokens`,
                soldOut: s.presaleComplete,
                whitelistedWallets: Number(s.totalWhitelisted),
              },
        autoVest: s.autoVest ? { days: Number(s.autoVestDuration), release: s.gradualAutoVesting ? "gradual" : "all at once" } : null,
        holderRewards: s.rewardsEnabled,
      });
    },
  }),

  tool({
    name: "get_floor_price",
    toolset: "tokens",
    title: "Floor price",
    description:
      "A token's floor price per token, in the pair asset of its main and in the main, next to its price. The floor is " +
      "measured in the pair asset, which can move itself. Tokens made on BASIS only, not mains. get_token_state has " +
      "the floor too, with the rest of the token's settings.",
    input: { token: p.token(TOKEN_DESC) },
    run: async ({ token }, ctx) => {
      const client = await ctx.client();
      const t = await factoryToken(client, token);
      const [floor, floorInMain, price] = await Promise.all([
        client.factory.getFloorPrice(t),
        client.factory.getTokenFloor(t),
        client.factory.getPairPrice(t),
      ]);
      return { token: t, floorPrice: floor, floorInMain, price };
    },
  }),

  tool({
    name: "get_my_tokens",
    toolset: "tokens",
    title: "Tokens by creator",
    description:
      "Tokens a wallet launched, newest first, read from the chain: each with its family, price, who can buy and its " +
      "fees. get_wallet_projects (data tools) lists them with market cap, plus the prediction markets the wallet made.",
    input: { wallet: p.wallet("Creator wallet. Default: this server's wallet."), limit: p.limit(50, 20) },
    run: async ({ wallet, limit }, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, wallet);
      const all = [...(await client.factory.getTokensByCreator(who))].reverse();
      const shown = all.slice(0, limit ?? 20);
      const rows = await inBatches(shown, 5, async (t) => {
        const [name, meta, tax, price, flags] = await Promise.all([
          client.publicClient.readContract({ address: t, abi: erc20Abi, functionName: "name" }),
          client.mains.tokenMeta(t),
          client.taxes.getTokenTaxInfo(t),
          client.factory.getPairPrice(t),
          presaleFlags(client, t),
        ]);
        const fam = familyOf(tax.hybridMultiplier, tax.reversed);
        return {
          token: t,
          name,
          symbol: meta.symbol,
          family: fam.family,
          setting: fam.setting,
          price,
          whoCanBuy: flags.frozen && !flags.presaleDone ? "whitelisted wallets only" : "everyone",
          presaleRunning: !flags.presaleDone,
          holderRewards: tax.rewardsEnabled,
          creatorFeePercent: tax.creatorFee / 100,
          rewardsFeePercent: tax.rewardsFee / 100,
        };
      });
      return userContent({
        creator: who,
        total: all.length,
        shown: shown.length,
        tokens: rows.map((r, i) => (r.status === "fulfilled" ? r.value : { token: shown[i], details: "not available right now" })),
      });
    },
  }),

  tool({
    name: "is_basis_token",
    toolset: "tokens",
    title: "Is it a BASIS token?",
    description:
      "Whether an address is a BASIS token (a main, or a token made on BASIS), who created it, and whether it's listed " +
      "(tradable on BASIS: BASIS can delist a token).",
    input: { token: p.token("Token address (0x...).") },
    run: async ({ token }, ctx) => {
      const client = await ctx.client();
      const t = await resolveToken(client, token);
      if (await client.mains.isMain(t)) return { token: t, basisToken: true, kind: "main" };
      const [creator, listed] = await Promise.all([client.factory.creatorOf(t), client.factory.isEcosystemToken(t)]);
      const made = !isZeroAddress(creator);
      return { token: t, basisToken: made, kind: made ? "token made on BASIS" : "not a BASIS token", creator: made ? creator : null, listed };
    },
  }),

  tool({
    name: "unfreeze_token",
    toolset: "tokens",
    title: "Open a whitelist-only presale to everyone",
    description:
      "Open your whitelist-only presale to everyone now. Permanent: the token can't be made whitelist-only again. Only " +
      "the token's creator.",
    input: { token: p.token(TOKEN_DESC) },
    write: true,
    destructive: true,
    run: async ({ token }, ctx) => {
      const client = await ctx.client();
      const t = await factoryToken(client, token);
      const { frozen, presaleDone } = await presaleFlags(client, t);
      if (!frozen) throw new ValidationError("token", "This token isn't whitelist-only: everyone can already buy it.");
      if (presaleDone) throw new ValidationError("token", "This token's presale already sold out, so trading is open to everyone.");
      return txOut(client, await client.factory.disableFreeze(t));
    },
  }),

  tool({
    name: "whitelist_wallets",
    toolset: "tokens",
    title: "Whitelist presale buyers",
    description:
      "Let wallets buy your whitelist-only presale, each up to a cap in tokens. Only the token's creator, while the " +
      "presale runs. A wallet already on the list keeps its cap: to change it, remove it with remove_whitelist and add it again.",
    input: {
      token: p.token(TOKEN_DESC),
      wallets: z.array(z.string()).min(1).max(200).describe("Wallet addresses (0x...) to add, 1 to 200."),
      cap: p.amount("The most presale tokens each wallet may buy, in tokens."),
      tag: z.string().optional().describe('Optional label saved with the entries, e.g. "team".'),
    },
    write: true,
    run: async ({ token, wallets, cap, tag }, ctx) => {
      const client = await ctx.client();
      const t = await factoryToken(client, token);
      const list = wallets.map((w, i) => addr(w, `wallets[${i}]`));
      const raw = to18(cap, "cap");
      if (raw === 0n) throw new ValidationError("cap", "cap must be above 0: a wallet with cap 0 can buy nothing.");
      const r = await plainly(client.factory.setWhitelistedWallet(t, list, raw, tag ?? ""), {
        "not frozen": "This token isn't whitelist-only (it never was, or trading was opened to everyone), so a whitelist has no effect.",
        "Presale over": "This token's presale already sold out: the whitelist no longer matters.",
      });
      return txOut(client, r);
    },
  }),

  tool({
    name: "remove_whitelist",
    toolset: "tokens",
    title: "Remove a wallet from the whitelist",
    description:
      "Take a wallet off your token's presale whitelist: it can no longer buy the whitelist-only presale. Only the " +
      "token's creator.",
    input: { token: p.token(TOKEN_DESC), wallet: p.address("Wallet (0x...) to take off the whitelist.") },
    write: true,
    destructive: true,
    run: async ({ token, wallet }, ctx) => {
      const client = await ctx.client();
      const t = await factoryToken(client, token);
      return txOut(client, await client.factory.removeWhitelist(t, addr(wallet, "wallet")));
    },
  }),

  tool({
    name: "get_whitelist",
    toolset: "tokens",
    title: "Presale whitelist",
    description:
      "A token's presale whitelist. With a wallet: whether it's on the list, its cap, what it bought and what's left " +
      "(read from the chain). Without: the whitelisted wallets, a page at a time.",
    input: {
      token: p.token(TOKEN_DESC),
      wallet: z.string().optional().describe("A wallet (0x...) to check. Leave out to list the whitelist."),
      page: p.page(),
      limit: p.limit(100, 50),
    },
    run: async ({ token, wallet, page, limit }, ctx) => {
      const client = await ctx.client();
      const t = await factoryToken(client, token);
      if (wallet) {
        const who = addr(wallet, "wallet");
        const [st, flags] = await Promise.all([client.factory.getWhitelistStatus(t, who), presaleFlags(client, t)]);
        const unlimited = st.maxBuy === maxUint256;
        return {
          token: t,
          wallet: who,
          whitelisted: st.whitelisted,
          cap: unlimited ? "unlimited (the creator)" : `${tok(st.maxBuy)} tokens`,
          bought: `${tok(st.bought)} tokens`,
          left: unlimited ? "unlimited" : `${tok(st.remaining)} tokens`,
          whitelistInForce: flags.frozen && !flags.presaleDone,
        };
      }
      const list = await client.api.getTokenWhitelist(t, { page, limit: limit ?? 50 });
      const tokens = (raw: string) => (/^\d+$/.test(raw) ? `${tok(BigInt(raw))} tokens` : raw);
      return userContent({
        token: t,
        wallets: list.data.map((e) => ({
          wallet: e.walletAddress,
          cap: e.unlimited ? "unlimited (the creator)" : tokens(e.capTokens),
          note: e.note,
          added: e.timestamp,
          addedByCreator: !e.auto,
        })),
        pagination: list.pagination,
      });
    },
  }),

  tool({
    name: "claim_rewards",
    toolset: "tokens",
    title: "Claim holder rewards",
    description:
      "Claim your holder rewards on a token, paid in the pair asset of its main (e.g. USDG). Check first with " +
      "get_claimable_rewards; get_claimables lists everything claimable at once.",
    input: { token: p.token(TOKEN_DESC) },
    write: true,
    run: async ({ token }, ctx) => {
      const client = await ctx.client();
      const t = await factoryToken(client, token);
      const claimable = await client.factory.getClaimableRewards(t, walletOrSelf(client));
      if (claimable.raw === 0n) {
        throw new ValidationError("token", "Nothing to claim on this token right now (or it has holder rewards off). Check with get_claimable_rewards.");
      }
      return txOut(client, await client.factory.claimRewards(t));
    },
  }),

  tool({
    name: "get_claimable_rewards",
    toolset: "tokens",
    title: "Claimable holder rewards",
    description:
      "Holder rewards a wallet can claim on a token now (in the pair asset), what it has claimed so far, and its share " +
      "of the token's rewards. For everything claimable across BASIS at once, use get_claimables.",
    input: { token: p.token(TOKEN_DESC), wallet: p.wallet() },
    run: async ({ token, wallet }, ctx) => {
      const client = await ctx.client();
      const t = await factoryToken(client, token);
      const who = walletOrSelf(client, wallet);
      const i = await client.factory.getRewardsInfo(t, who);
      if (!i.rewardsEnabled) return { token: t, wallet: who, holderRewards: false, note: "This token has holder rewards off." };
      return {
        token: t,
        wallet: who,
        holderRewards: true,
        claimable: i.claimable,
        claimedSoFar: i.claimed,
        shares: tok(i.shares),
        totalShares: tok(i.totalShares),
        earnsRewards: !i.excluded,
        lastPayout: iso(i.lastDistribution),
        unclaimedGoToAllHoldersFrom: i.recyclableAt ? iso(i.recyclableAt) : undefined,
      };
    },
  }),

  tool({
    name: "add_holder_rewards",
    toolset: "tokens",
    title: "Top up holder rewards",
    description:
      "Add your own money to a token's holder rewards: the amount (in the pair asset, e.g. USDG) is shared out over " +
      "every current holder at once. Anyone can do it, and it can't be taken back.",
    input: {
      token: p.token(TOKEN_DESC),
      amount: p.amount("Amount to add, in the pair asset of the token's main (e.g. USDG)."),
    },
    write: true,
    destructive: true,
    run: async ({ token, amount }, ctx) => {
      const client = await ctx.client();
      const t = await factoryToken(client, token);
      const info = await client.mains.infoOfToken(t);
      const raw = toPairRaw(info, amount, "amount");
      await checkSpend(client, info.pairAsset, raw);
      const r = await plainly(client.factory.addToRewards(t, raw), {
        "rewards off": "This token has holder rewards off, so nobody would receive it: the money would go to the protocol instead.",
        "no shares": "This token has no holders earning rewards yet: the money would go to the protocol instead. Try again after the first buys.",
        "cannot be zero": "amount must be above 0.",
      });
      const { rewardsPerShare: _perShare, ...rest } = r;
      return txOut(client, rest);
    },
  }),

  tool({
    name: "set_creator_fee",
    toolset: "tokens",
    title: "Set your creator fee",
    description:
      "Set your token's creator fee: a percent of every trade on top of the base fee, paid to you (and any income " +
      "shares you set). Only the token's creator. There is a cap and a cooldown between changes (the first setting is " +
      "free): check both with get_fee_settings.",
    input: {
      token: p.token(TOKEN_DESC),
      fee_percent: p.percent("Creator fee in percent of each trade, e.g. 0.5 (steps of 0.01). 0 turns it off."),
    },
    write: true,
    run: async ({ token, fee_percent }, ctx) => {
      const client = await ctx.client();
      const t = await factoryToken(client, token);
      const r = await client.taxes.setCreatorFee(t, toBps(fee_percent, "fee_percent", 0, 10000));
      const { creatorFee, ...rest } = r;
      return txOut(client, rest, { creatorFeePercent: creatorFee === null ? null : creatorFee / 100 });
    },
  }),

  tool({
    name: "set_rewards_fee",
    toolset: "tokens",
    title: "Set the holder rewards fee",
    description:
      "Set your token's holder rewards fee: a percent of every trade on top of the base fee, paid to its holders. Only " +
      "the token's creator, on a token launched with holder rewards. Cap and cooldown: get_fee_settings.",
    input: {
      token: p.token(TOKEN_DESC),
      fee_percent: p.percent("Rewards fee in percent of each trade, e.g. 1 (steps of 0.01). 0 turns it off."),
    },
    write: true,
    run: async ({ token, fee_percent }, ctx) => {
      const client = await ctx.client();
      const t = await factoryToken(client, token);
      const r = await client.taxes.setRewardsFee(t, toBps(fee_percent, "fee_percent", 0, 10000));
      const { rewardsFee, ...rest } = r;
      return txOut(client, rest, { rewardsFeePercent: rewardsFee === null ? null : rewardsFee / 100 });
    },
  }),

  tool({
    name: "get_fee_settings",
    toolset: "tokens",
    title: "Token fee settings",
    description:
      "A token's fees in percent: the base fee, its creator and holder rewards fees, their caps, and when each can " +
      "change next. Read it before quoting or setting fees. What one wallet pays (its referral discount included): get_tax_rate.",
    input: { token: p.token() },
    run: async ({ token }, ctx) => {
      const client = await ctx.client();
      const t = await resolveToken(client, token);
      const [i, discount] = await Promise.all([client.taxes.getTokenTaxInfo(t), referralDiscountPercent(client)]);
      const referralNote = referralText(i.baseRate, discount);
      if (i.isMain) {
        return { token: t, kind: "main", baseFeePercent: i.baseRate / 100, totalFeePercent: i.totalRate / 100, note: `Mains pay the base fee only. ${referralNote}` };
      }
      const cd = await client.taxes.getFeeCooldowns(t);
      const fam = familyOf(i.hybridMultiplier, i.reversed);
      return {
        token: t,
        family: fam.family,
        setting: fam.setting,
        creator: i.dev,
        holderRewards: i.rewardsEnabled,
        baseFeePercent: i.baseRate / 100,
        creatorFeePercent: i.creatorFee / 100,
        rewardsFeePercent: i.rewardsFee / 100,
        totalFeePercent: i.totalRate / 100,
        maxCreatorFeePercent: i.maxCreatorFee / 100,
        maxRewardsFeePercent: i.rewardsEnabled ? i.maxRewardsFee / 100 : null,
        creatorFeeCanChange: cd.canChangeCreatorFee ? "now" : iso(cd.creatorFeeNextChangeAt),
        rewardsFeeCanChange: !i.rewardsEnabled ? "never (no holder rewards on this token)" : cd.canChangeRewardsFee ? "now" : iso(cd.rewardsFeeNextChangeAt),
        cooldownHours: { creatorFee: cd.creatorFeeCooldown / 3600, rewardsFee: cd.rewardsFeeCooldown / 3600 },
        note: `totalFeePercent is for a wallet without a referrer. ${referralNote}`,
      };
    },
  }),

  tool({
    name: "get_tax_rate",
    toolset: "tokens",
    title: "Trade fee for a wallet",
    description:
      "The fee a wallet pays per trade on a token, in percent: the base fee (lower for a wallet with a referrer) plus " +
      "the token's creator and holder rewards fees. Use it instead of assuming a fixed fee. The token's fee settings, " +
      "caps and cooldowns: get_fee_settings.",
    input: { token: p.token(), wallet: p.wallet() },
    run: async ({ token, wallet }, ctx) => {
      const client = await ctx.client();
      const t = await resolveToken(client, token);
      const who = walletOrSelf(client, wallet);
      const [rate, referrer] = await Promise.all([client.taxes.getTaxRate(t, who), client.taxes.getReferrer(who)]);
      const discount = referrer !== null && rate > 0 ? await referralDiscountPercent(client) : null;
      return {
        token: t,
        wallet: who,
        feePercent: rate / 100,
        hasReferrer: referrer !== null,
        baseFeeDiscountPercent: discount ?? undefined,
        note: rate === 0 ? "This wallet pays no trade fee." : undefined,
      };
    },
  }),

  tool({
    name: "add_dev_share",
    toolset: "tokens",
    title: "Share your creator income",
    description:
      "Give another wallet a share of your token's creator income. Only the token's creator. Up to 10 wallets and 100% " +
      "in total; whatever isn't shared stays with you. Setting it again for the same wallet replaces its share.",
    input: {
      token: p.token(TOKEN_DESC),
      wallet: p.address("Wallet (0x...) to share with."),
      share_percent: p.percent("Its share of your creator income, in percent (e.g. 25, steps of 0.01)."),
    },
    write: true,
    destructive: true,
    run: async ({ token, wallet, share_percent }, ctx) => {
      const client = await ctx.client();
      const t = await factoryToken(client, token);
      const r = await client.taxes.addDevShare(t, addr(wallet, "wallet"), toBps(share_percent, "share_percent", 1, 10000));
      const { basisPoints, ...rest } = r;
      return txOut(client, rest, { sharePercent: basisPoints === null ? null : basisPoints / 100 });
    },
  }),

  tool({
    name: "remove_dev_share",
    toolset: "tokens",
    title: "Stop a creator income share",
    description: "Stop a wallet's share of your token's creator income; its part comes back to you. Only the token's creator.",
    input: { token: p.token(TOKEN_DESC), wallet: p.address("Wallet (0x...) whose share to remove.") },
    write: true,
    run: async ({ token, wallet }, ctx) => {
      const client = await ctx.client();
      const t = await factoryToken(client, token);
      return txOut(client, await client.taxes.removeDevShare(t, addr(wallet, "wallet")));
    },
  }),

  tool({
    name: "get_dev_shares",
    toolset: "tokens",
    title: "Creator income shares",
    description: "Who shares a token's creator income and how much each gets, in percent; the rest goes to the creator.",
    input: { token: p.token(TOKEN_DESC) },
    run: async ({ token }, ctx) => {
      const client = await ctx.client();
      const t = await factoryToken(client, token);
      const [wallets, allocated, info] = await Promise.all([
        client.taxes.getDevWallets(t),
        client.taxes.getDevTotalAllocated(t),
        client.taxes.getTokenTaxInfo(t),
      ]);
      const shares = await Promise.all(wallets.map(async (w) => ({ wallet: w, sharePercent: (await client.taxes.getDevBasisPoints(t, w)) / 100 })));
      return { token: t, creator: info.dev, shares, sharedPercent: allocated / 100, creatorKeepsPercent: (10_000 - allocated) / 100 };
    },
  }),

  tool({
    name: "get_creator_earnings",
    toolset: "tokens",
    title: "Creator earnings on a token",
    description:
      "What a wallet has earned from one token as its creator or a share holder (lifetime, never reset, in the pair " +
      "asset), next to everything the token has paid its creator side. Across all tokens: get_dev_total_earnings.",
    input: { token: p.token(TOKEN_DESC), wallet: p.wallet("Creator or share wallet. Default: this server's wallet.") },
    run: async ({ token, wallet }, ctx) => {
      const client = await ctx.client();
      const t = await factoryToken(client, token);
      const who = walletOrSelf(client, wallet);
      const [earned, total] = await Promise.all([client.taxes.getCreatorEarnings(t, who), client.taxes.getTotalCreatorIncome(t)]);
      return { token: t, wallet: who, earned, tokenTotalCreatorIncome: total };
    },
  }),

  tool({
    name: "get_dev_total_earnings",
    toolset: "tokens",
    title: "Creator earnings, all tokens",
    description:
      "A wallet's lifetime creator income across every token it launched or shares in, per pair asset, from the chain. " +
      "One token: get_creator_earnings. By time window, with USD values: get_wallet_earnings (data tools).",
    input: { wallet: p.wallet() },
    run: async ({ wallet }, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, wallet);
      const assets = await pairAssets(client);
      const earned = await Promise.all(assets.map(async (m) => ({ pairAsset: m.pairSymbol, earned: await client.taxes.getDevTotalEarnings(who, m.pairAsset) })));
      return { wallet: who, earned };
    },
  }),

  tool({
    name: "get_referral_earnings",
    toolset: "tokens",
    title: "Referral earnings",
    description:
      "What a wallet has earned from the wallets it referred (both referral levels), lifetime, per pair asset. Set or " +
      "check a referrer with set_referrer / get_referrer. Who it referred, per level and per wallet: get_wallet_referrals (data tools).",
    input: { wallet: p.wallet() },
    run: async ({ wallet }, ctx) => {
      const client = await ctx.client();
      const who = walletOrSelf(client, wallet);
      const assets = await pairAssets(client);
      const earned = await Promise.all(assets.map(async (m) => ({ pairAsset: m.pairSymbol, earned: await client.taxes.getReferralEarnings(who, m.pairAsset) })));
      return { wallet: who, earned };
    },
  }),
];
