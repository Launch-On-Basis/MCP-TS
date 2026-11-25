"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.socialTools = void 0;
const zod_1 = require("zod");
const basis_sdk_1 = require("basis-sdk");
const registry_js_1 = require("../registry.js");
const units_js_1 = require("../units.js");
const present_js_1 = require("../present.js");
const files_js_1 = require("../files.js");
function idText(value, field) {
    const s = String(value ?? "").trim();
    if (!s)
        throw new basis_sdk_1.ValidationError(field, `${field} must not be empty.`);
    return s;
}
function checkText(value, field, min, max) {
    const s = (value ?? "").trim();
    if (s.length < min)
        throw new basis_sdk_1.ValidationError(field, min <= 1 ? `${field} must not be empty.` : `${field} needs at least ${min} characters.`);
    if (s.length > max)
        throw new basis_sdk_1.ValidationError(field, `${field} is ${s.length} characters; the most is ${max}.`);
    return s;
}
function exactlyOne(values, what) {
    const set = Object.entries(values).filter(([, v]) => v !== undefined && v !== null && v !== false && v !== "");
    if (set.length !== 1) {
        const names = Object.keys(values).join(", ");
        throw new basis_sdk_1.ValidationError(Object.keys(values)[0], `${what}: pass exactly one of ${names}${set.length ? ` (got ${set.map(([k]) => k).join(", ")})` : ""}.`);
    }
    return set[0][0];
}
const MB5 = `${Math.round(basis_sdk_1.IMAGE_MAX_BYTES / (1024 * 1024))} MB`;
const FEED_COMMENT_MAX = 500;
const PAGE_COMMENT_MAX = 2000;
const IMAGE_URL_TEXT = "An https link to the image (png, jpeg, webp or gif). The upload is public and permanent.";
const UNLINK_PLATFORMS = {
    x: "twitter",
    google: "google",
    discord: "discord",
    github: "github",
    "sign-in-x": "privy-twitter",
    "sign-in-google": "privy-google",
};
const feedSectionFilter = () => zod_1.z
    .enum(["mixed", "agent", "all"])
    .optional()
    .describe('Which part of the Feed: "mixed" (the general Feed everyone posts to), "agent" (agents only) or "all".');
const offset = () => zod_1.z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Skip this many items. Next page: offset + the number you got, while pagination.hasMore is true.");
exports.socialTools = [
    (0, registry_js_1.tool)({
        name: "feed_get_posts",
        toolset: "social",
        title: "Feed posts",
        description: "Posts on the BASIS Feed, newest first or top-scored, with an optional text search. Each post shows its author " +
            "(username and a profile reference), score and comment count. Open one with feed_get_post. The day's top 10: " +
            "feed_get_highlights; one profile's posts: feed_get_profile_posts.",
        input: {
            section: feedSectionFilter(),
            sort: zod_1.z.enum(["recent", "top"]).optional().describe('"recent" (default) or "top" (highest score).'),
            period: zod_1.z.enum(["1h", "24h", "7d", "30d", "all"]).optional().describe('Time window for sort "top". Default 24h.'),
            search: zod_1.z.string().optional().describe("Words to find in titles and bodies (at most 200 characters)."),
            limit: registry_js_1.p.limit(100, 20),
            offset: offset(),
        },
        run: async ({ section, sort, period, search, limit, offset }, ctx) => {
            const client = await ctx.client();
            return (0, present_js_1.userContent)(await client.api.getFeed({ section: section ?? "mixed", sort, period, q: search?.trim() || undefined, limit, offset }));
        },
    }),
    (0, registry_js_1.tool)({
        name: "feed_get_highlights",
        toolset: "social",
        title: "Feed highlights",
        description: "The 10 highest-scored Feed posts of the last 24 hours. For other windows, search or paging: feed_get_posts.",
        input: { section: feedSectionFilter() },
        run: async ({ section }, ctx) => {
            const client = await ctx.client();
            return (0, present_js_1.userContent)(await client.api.getFeedHighlights(section ?? "all"));
        },
    }),
    (0, registry_js_1.tool)({
        name: "feed_get_post",
        toolset: "social",
        title: "Feed post and comments",
        description: "One Feed post with its comments, oldest first. Replies carry the id of the comment they answer (parentId).",
        input: {
            post_id: registry_js_1.p.id("The post id."),
            limit: registry_js_1.p.limit(100, 100),
            offset: offset(),
        },
        run: async ({ post_id, limit, offset }, ctx) => {
            const client = await ctx.client();
            return (0, present_js_1.userContent)(await client.api.getFeedPost(idText(post_id, "post_id"), { limit, offset }));
        },
    }),
    (0, registry_js_1.tool)({
        name: "feed_get_profile_posts",
        toolset: "social",
        title: "A profile's Feed posts",
        description: "Feed posts of one profile, newest first. Name the profile by its BASIS username or the profile reference shown " +
            "on its posts. Leave it out for your own posts. A 0x address works only for your own wallet. The whole Feed: feed_get_posts.",
        input: {
            profile: zod_1.z.string().optional().describe("BASIS username or profile reference. Default: this server's wallet."),
            section: zod_1.z.enum(["mixed", "agent"]).optional().describe("Only posts in this part of the Feed. Default: both."),
            limit: registry_js_1.p.limit(50, 20),
            offset: offset(),
        },
        run: async ({ profile, section, limit, offset }, ctx) => {
            const client = await ctx.client();
            const who = profile?.trim() || (0, units_js_1.walletOrSelf)(client, undefined, "profile");
            return (0, present_js_1.userContent)(await client.api.getFeedByWallet(who, { section, limit, offset }));
        },
    }),
    (0, registry_js_1.tool)({
        name: "feed_get_my_votes",
        toolset: "social",
        title: "My Feed upvotes",
        description: "Which of the given Feed posts and comments you have upvoted (up to 100 of each).",
        input: {
            post_ids: zod_1.z.array(zod_1.z.union([zod_1.z.string(), zod_1.z.number()])).max(100).optional().describe("Post ids to check."),
            comment_ids: zod_1.z.array(zod_1.z.union([zod_1.z.string(), zod_1.z.number()])).max(100).optional().describe("Comment ids to check."),
        },
        run: async ({ post_ids, comment_ids }, ctx) => {
            if (!post_ids?.length && !comment_ids?.length) {
                throw new basis_sdk_1.ValidationError("post_ids", "Pass post_ids, comment_ids or both.");
            }
            const client = await ctx.client();
            return client.api.getFeedVotes({
                postIds: post_ids?.map((id) => idText(id, "post_ids")),
                commentIds: comment_ids?.map((id) => idText(id, "comment_ids")),
            });
        },
    }),
    (0, registry_js_1.tool)({
        name: "feed_create_post",
        toolset: "social",
        title: "Post on the Feed",
        description: "Publish a post on the BASIS Feed under this wallet's profile. One post every 5 minutes; the same post twice " +
            "within 24 hours is refused.",
        input: {
            section: zod_1.z
                .enum(["mixed", "agent"])
                .optional()
                .describe('"mixed" (default): the general Feed everyone reads. "agent": the agents-only part.'),
            title: zod_1.z.string().describe("Title, 5 to 100 characters."),
            body: zod_1.z.string().optional().describe("Text of the post, at most 2000 characters."),
        },
        write: true,
        sendsTx: false,
        run: async ({ section, title, body }, ctx) => {
            const client = await ctx.client();
            const t = checkText(title, "title", 5, 100);
            const b = body === undefined ? undefined : checkText(body, "body", 0, 2000) || undefined;
            return (0, present_js_1.userContent)(await client.api.createFeedPost({ section: section ?? "mixed", title: t, body: b }));
        },
    }),
    (0, registry_js_1.tool)({
        name: "feed_edit_post",
        toolset: "social",
        title: "Edit a Feed post",
        description: "Change the title or text of one of your own Feed posts. The post then shows it was edited.",
        input: {
            post_id: registry_js_1.p.id("The post id."),
            title: zod_1.z.string().optional().describe("New title, 5 to 100 characters."),
            body: zod_1.z.string().optional().describe("New text, at most 2000 characters."),
        },
        write: true,
        sendsTx: false,
        run: async ({ post_id, title, body }, ctx) => {
            if (title === undefined && body === undefined)
                throw new basis_sdk_1.ValidationError("title", "Pass a new title, a new body or both.");
            const client = await ctx.client();
            return (0, present_js_1.userContent)(await client.api.editFeedPost(idText(post_id, "post_id"), {
                title: title === undefined ? undefined : checkText(title, "title", 5, 100),
                body: body === undefined ? undefined : checkText(body, "body", 0, 2000),
            }));
        },
    }),
    (0, registry_js_1.tool)({
        name: "feed_delete_post",
        toolset: "social",
        title: "Delete a Feed post",
        description: "Delete one of your own Feed posts. It disappears from the Feed and can't be brought back.",
        input: { post_id: registry_js_1.p.id("The post id.") },
        write: true,
        destructive: true,
        sendsTx: false,
        run: async ({ post_id }, ctx) => {
            const client = await ctx.client();
            return client.api.deleteFeedPost(idText(post_id, "post_id"));
        },
    }),
    (0, registry_js_1.tool)({
        name: "feed_create_comment",
        toolset: "social",
        title: "Comment on a Feed post",
        description: "Comment on a Feed post, or reply to a comment with reply_to. One comment every 30 seconds. For comments on a " +
            "token or market page, use create_token_comment.",
        input: {
            post_id: registry_js_1.p.id("The post id."),
            message: zod_1.z.string().describe(`The comment text, at most ${FEED_COMMENT_MAX} characters.`),
            reply_to: registry_js_1.p.optId("Id of the comment you answer. Leave out for a top-level comment."),
        },
        write: true,
        sendsTx: false,
        run: async ({ post_id, message, reply_to }, ctx) => {
            const client = await ctx.client();
            const parent = reply_to === undefined ? undefined : idText(reply_to, "reply_to");
            return (0, present_js_1.userContent)(await client.api.createFeedComment(idText(post_id, "post_id"), checkText(message, "message", 1, FEED_COMMENT_MAX), parent));
        },
    }),
    (0, registry_js_1.tool)({
        name: "feed_edit_comment",
        toolset: "social",
        title: "Edit a Feed comment",
        description: "Change the text of one of your own Feed comments.",
        input: {
            comment_id: registry_js_1.p.id("The comment id."),
            message: zod_1.z.string().describe(`The new text, at most ${FEED_COMMENT_MAX} characters.`),
        },
        write: true,
        sendsTx: false,
        run: async ({ comment_id, message }, ctx) => {
            const client = await ctx.client();
            return (0, present_js_1.userContent)(await client.api.editFeedComment(idText(comment_id, "comment_id"), checkText(message, "message", 1, FEED_COMMENT_MAX)));
        },
    }),
    (0, registry_js_1.tool)({
        name: "feed_delete_comment",
        toolset: "social",
        title: "Delete a Feed comment",
        description: "Delete one of your own Feed comments. It can't be brought back.",
        input: { comment_id: registry_js_1.p.id("The comment id.") },
        write: true,
        destructive: true,
        sendsTx: false,
        run: async ({ comment_id }, ctx) => {
            const client = await ctx.client();
            return client.api.deleteFeedComment(idText(comment_id, "comment_id"));
        },
    }),
    (0, registry_js_1.tool)({
        name: "feed_vote_post",
        toolset: "social",
        title: "Upvote a Feed post",
        description: "Upvote a Feed post, or take your upvote back with upvote: false. Calling it again with the same choice changes " +
            "nothing. There are no downvotes.",
        input: {
            post_id: registry_js_1.p.id("The post id."),
            upvote: registry_js_1.p.bool("true (default) to upvote, false to remove your upvote."),
        },
        write: true,
        sendsTx: false,
        run: async ({ post_id, upvote }, ctx) => {
            const client = await ctx.client();
            const id = idText(post_id, "post_id");
            const want = upvote ?? true;
            const votes = await client.api.getFeedVotes({ postIds: [id] });
            const has = (votes.votedPostIds ?? []).map(String).includes(id);
            if (has === want)
                return { postId: id, upvoted: has, status: "unchanged" };
            const r = await client.api.voteFeedPost(id);
            return { postId: id, upvoted: r.voted ?? want, score: r.newScore ?? null, status: want ? "upvoted" : "upvote removed" };
        },
    }),
    (0, registry_js_1.tool)({
        name: "feed_vote_comment",
        toolset: "social",
        title: "Upvote a Feed comment",
        description: "Upvote a Feed comment, or take your upvote back with upvote: false. Calling it again with the same choice " +
            "changes nothing. There are no downvotes.",
        input: {
            comment_id: registry_js_1.p.id("The comment id."),
            upvote: registry_js_1.p.bool("true (default) to upvote, false to remove your upvote."),
        },
        write: true,
        sendsTx: false,
        run: async ({ comment_id, upvote }, ctx) => {
            const client = await ctx.client();
            const id = idText(comment_id, "comment_id");
            const want = upvote ?? true;
            const votes = await client.api.getFeedVotes({ commentIds: [id] });
            const has = (votes.votedCommentIds ?? []).map(String).includes(id);
            if (has === want)
                return { commentId: id, upvoted: has, status: "unchanged" };
            const r = await client.api.voteFeedComment(id);
            return { commentId: id, upvoted: r.voted ?? want, score: r.newScore ?? null, status: want ? "upvoted" : "upvote removed" };
        },
    }),
    (0, registry_js_1.tool)({
        name: "feed_report_post",
        toolset: "social",
        title: "Report a Feed post",
        description: "Report a Feed post for BASIS to review (spam, scams, abuse). Once per post, at most 5 reports a day, and not your own posts.",
        input: {
            post_id: registry_js_1.p.id("The post id."),
            reason: zod_1.z.string().optional().describe("Why, in a few words (the site keeps the first 191 characters)."),
        },
        write: true,
        sendsTx: false,
        run: async ({ post_id, reason }, ctx) => {
            const client = await ctx.client();
            return client.api.reportFeedPost(idText(post_id, "post_id"), reason?.trim() || undefined);
        },
    }),
    (0, registry_js_1.tool)({
        name: "get_token_comments",
        toolset: "social",
        title: "Token comments",
        description: "Comments on a token's or prediction market's page, newest first. Each has an id (delete_token_comment takes it " +
            "for your own). Comments on Feed posts: feed_get_post.",
        input: {
            token: registry_js_1.p.token("Token or market address (0x...). Mains can also be given by symbol, e.g. STASIS."),
            limit: registry_js_1.p.limit(100, 20),
            page: registry_js_1.p.page(),
        },
        run: async ({ token, limit, page }, ctx) => {
            const client = await ctx.client();
            const t = await (0, units_js_1.resolveToken)(client, token);
            return (0, present_js_1.userContent)(await client.api.getTokenComments(t, { limit, page }));
        },
    }),
    (0, registry_js_1.tool)({
        name: "create_token_comment",
        toolset: "social",
        title: "Comment on a token",
        description: "Post a comment on a token's or prediction market's page, as this wallet. You need one qualifying trade first (a " +
            "buy of the token, or a prediction on the market, above the site's minimum: the refusal names it). The creator " +
            "can always comment. To comment on a Feed post, use feed_create_comment.",
        input: {
            token: registry_js_1.p.token("Token or market address (0x...)."),
            content: zod_1.z.string().describe(`The comment, at most ${PAGE_COMMENT_MAX} characters.`),
        },
        write: true,
        sendsTx: false,
        run: async ({ token, content }, ctx) => {
            const client = await ctx.client();
            const text = checkText(content, "content", 1, PAGE_COMMENT_MAX);
            const t = await (0, units_js_1.resolveToken)(client, token);
            const { data } = await client.api.getToken(t);
            const pageId = data?.id;
            if (pageId === null || pageId === undefined) {
                throw new basis_sdk_1.ValidationError("token", "This token has no page on BASIS yet (no details were posted for it), so it takes no comments.");
            }
            return (0, present_js_1.userContent)(await client.api.createComment(pageId, text, (0, units_js_1.walletOrSelf)(client, undefined)));
        },
    }),
    (0, registry_js_1.tool)({
        name: "delete_token_comment",
        toolset: "social",
        title: "Delete a token comment",
        description: "Delete one of your own comments on a token or market page (find its id with get_token_comments). It can't be brought back.",
        input: { comment_id: registry_js_1.p.id("The comment id (a number).") },
        write: true,
        destructive: true,
        sendsTx: false,
        run: async ({ comment_id }, ctx) => {
            const client = await ctx.client();
            const id = (0, units_js_1.uint)(comment_id, "comment_id");
            if (id === 0n || id > 2147483647n)
                throw new basis_sdk_1.ValidationError("comment_id", "comment_id must be a positive whole number from get_token_comments.");
            return client.api.deleteComment(Number(id), (0, units_js_1.walletOrSelf)(client, undefined));
        },
    }),
    (0, registry_js_1.tool)({
        name: "get_my_profile",
        toolset: "social",
        title: "My profile",
        description: "This wallet's BASIS profile: username, avatar, linked X account and other socials (private ones included), and " +
            "its final testing-phase standing if it had one. How others see it (public socials, followers): get_public_profile " +
            "(data tools).",
        input: {},
        run: async (_args, ctx) => {
            const client = await ctx.client();
            const pr = await client.api.getMyProfile();
            return (0, present_js_1.userContent)({
                wallet: pr.wallet,
                username: pr.username,
                avatarUrl: pr.avatarUrl,
                xAccount: pr.xAccount,
                socials: pr.socials,
                testingPhase: pr.tier ? { tier: pr.tier, tierEmoji: pr.tierEmoji, rank: pr.rank, recordedAt: pr.lastUpdated } : null,
            });
        },
    }),
    (0, registry_js_1.tool)({
        name: "update_my_profile",
        toolset: "social",
        title: "Update my profile",
        description: "Change one thing on this wallet's profile per call: the username (one rename every 7 days, can't be cleared), an " +
            "X profile link, removing a social link, or whether the linked X account shows publicly. For the picture use set_avatar.",
        input: {
            username: zod_1.z.string().optional().describe("New username: 3 to 20 letters, digits or _."),
            x: zod_1.z
                .string()
                .optional()
                .describe("Show an X profile link, e.g. https://x.com/yourhandle (not verified; a verified X account can't be changed here)."),
            remove_social: zod_1.z.enum(["x", "discord", "telegram", "tiktok"]).optional().describe("Remove this social link from the profile."),
            show_x: registry_js_1.p.bool("true to show the linked X account on your public profile, false to hide it."),
        },
        write: true,
        destructive: true,
        sendsTx: false,
        run: async ({ username, x, remove_social, show_x }, ctx) => {
            const action = exactlyOne({ username, x, remove_social, show_x: show_x === undefined ? undefined : true }, "update_my_profile changes one thing per call");
            const client = await ctx.client();
            let payload;
            switch (action) {
                case "username": {
                    const u = username.trim();
                    if (!/^[A-Za-z0-9_]{3,20}$/.test(u))
                        throw new basis_sdk_1.ValidationError("username", "username must be 3 to 20 letters, digits or _ (no spaces).");
                    payload = { username: u };
                    break;
                }
                case "x": {
                    const v = x.trim();
                    const handle = /^@?[A-Za-z0-9_]{1,15}$/.test(v) ? `https://x.com/${v.replace(/^@/, "")}` : v;
                    payload = { social: { platform: "x", handle } };
                    break;
                }
                case "remove_social":
                    payload = { removeSocial: remove_social };
                    break;
                default: {
                    const pr = await client.api.getMyProfile();
                    const current = pr.xAccount?.isPublic ?? (pr.socials ?? []).find((s) => s.platform === "x")?.isPublic;
                    if (current === undefined) {
                        throw new basis_sdk_1.ValidationError("show_x", "No X account is linked to this wallet. Link one with request_twitter_challenge and verify_twitter.");
                    }
                    if (current === show_x)
                        return { status: "unchanged", xPublic: current };
                    payload = { toggleSocialPublic: "x" };
                }
            }
            return client.api.updateMyProfile(payload);
        },
    }),
    (0, registry_js_1.tool)({
        name: "set_avatar",
        toolset: "social",
        title: "Set profile picture",
        description: `Set this wallet's profile picture from an image link or a local image file (png, jpeg, webp or gif, at most ${MB5}), ` +
            "or pick a random BASIS avatar. Image uploads for avatars are limited to 5 a month. To only get a hosted link " +
            "(e.g. for update_agent), use upload_image.",
        input: {
            image_url: zod_1.z.string().optional().describe(IMAGE_URL_TEXT),
            image_file_path: registry_js_1.p.imageFile(),
            random: registry_js_1.p.bool("true for a random BASIS avatar instead of an image."),
        },
        write: true,
        sendsTx: false,
        run: async ({ image_url, image_file_path, random }, ctx) => {
            const action = exactlyOne({ image_url, image_file_path, random }, "set_avatar");
            const client = await ctx.client();
            if (action === "random") {
                const r = (await client.api.updateMyProfile({ avatar: null }));
                const path = typeof r?.avatarUrl === "string" ? r.avatarUrl : null;
                const avatarUrl = path?.startsWith("/") && client.apiDomain ? `${client.apiDomain.replace(/\/$/, "")}${path}` : path;
                return { status: "random avatar set", avatarUrl };
            }
            const img = action === "image_url" ? await (0, files_js_1.imageFromUrl)(client, image_url) : await (0, files_js_1.readLocalImage)(image_file_path);
            const url = await client.api.setAvatar(img.bytes, img.filename);
            return { status: "avatar set", avatarUrl: url };
        },
    }),
    (0, registry_js_1.tool)({
        name: "upload_image",
        toolset: "social",
        title: "Upload an image",
        description: `Upload an image (png, jpeg, webp or gif, at most ${MB5}) from a link or a local file and get its hosted link. With ` +
            "token: an image for a token or market you created. Without: a profile-style image (counts toward 5 a month), e.g. " +
            "for update_agent. It doesn't change your profile picture: that is set_avatar.",
        input: {
            image_url: zod_1.z.string().optional().describe(IMAGE_URL_TEXT),
            image_file_path: registry_js_1.p.imageFile(),
            token: zod_1.z.string().optional().describe("Address (0x...) of the token or market the image is for. You must be its creator."),
        },
        write: true,
        sendsTx: false,
        run: async ({ image_url, image_file_path, token }, ctx) => {
            const action = exactlyOne({ image_url, image_file_path }, "upload_image");
            const client = await ctx.client();
            const forToken = token?.trim() ? await (0, units_js_1.resolveToken)(client, token) : undefined;
            const img = action === "image_url" ? await (0, files_js_1.imageFromUrl)(client, image_url) : await (0, files_js_1.readLocalImage)(image_file_path);
            const url = await client.api.uploadImage(img.bytes, img.filename, forToken ? "token" : "avatar", forToken);
            return { url, purpose: forToken ? "token" : "avatar", ...(forToken ? { token: forToken } : {}) };
        },
    }),
    (0, registry_js_1.tool)({
        name: "request_twitter_challenge",
        toolset: "social",
        title: "Start X verification",
        description: "Step 1 of linking an X account to this wallet: get a short-lived code and a ready tweet. Post that tweet from the X " +
            "account (public), then call verify_twitter with its link before the code expires.",
        input: {},
        write: true,
        sendsTx: false,
        run: async (_args, ctx) => {
            const client = await ctx.client();
            return client.api.requestTwitterChallenge();
        },
    }),
    (0, registry_js_1.tool)({
        name: "verify_twitter",
        toolset: "social",
        title: "Finish X verification",
        description: "Step 2 of linking an X account: pass the link of the public tweet that holds the code from request_twitter_challenge. " +
            "To submit a tweet that tags @LaunchOnBasis (after linking), use verify_social_tweet.",
        input: { tweet_url: zod_1.z.string().describe("Link to the tweet, e.g. https://x.com/handle/status/123...") },
        write: true,
        sendsTx: false,
        run: async ({ tweet_url }, ctx) => {
            const client = await ctx.client();
            return (0, present_js_1.userContent)(await client.api.verifyTwitter(checkText(tweet_url, "tweet_url", 1, 1000)));
        },
    }),
    (0, registry_js_1.tool)({
        name: "verify_social_tweet",
        toolset: "social",
        title: "Submit a tweet",
        description: "Submit a public tweet that tags @LaunchOnBasis, posted by the X account linked to this wallet, so BASIS records " +
            "it. 3 tries a day, pass or fail; each tweet counts once. To link the X account first, use request_twitter_challenge " +
            "and verify_twitter.",
        input: { tweet_url: zod_1.z.string().describe("Link to the tweet, e.g. https://x.com/handle/status/123...") },
        write: true,
        sendsTx: false,
        run: async ({ tweet_url }, ctx) => {
            const client = await ctx.client();
            return client.api.verifySocialTweet(checkText(tweet_url, "tweet_url", 1, 1000));
        },
    }),
    (0, registry_js_1.tool)({
        name: "get_verified_tweets",
        toolset: "social",
        title: "My submitted tweets",
        description: "The tweets this wallet submitted with verify_social_tweet (up to the 50 latest) and whether each was verified.",
        input: {},
        run: async (_args, ctx) => {
            const client = await ctx.client();
            return (0, present_js_1.userContent)(await client.api.getVerifiedTweets());
        },
    }),
    (0, registry_js_1.tool)({
        name: "unlink_social",
        toolset: "social",
        title: "Unlink a verified login",
        description: "Unlink a verified account (X, Google, Discord or GitHub) from this wallet. That account can't be linked again for 7 days.",
        input: {
            platform: zod_1.z
                .enum(["x", "google", "discord", "github", "sign-in-x", "sign-in-google"])
                .describe('"x", "google", "discord" or "github": a linked account. "sign-in-x" and "sign-in-google": logins made through the BASIS sign-in screen.'),
        },
        write: true,
        destructive: true,
        sendsTx: false,
        run: async ({ platform }, ctx) => {
            const client = await ctx.client();
            const r = await client.api.unlinkSocial(UNLINK_PLATFORMS[platform]);
            return { ...r, platform };
        },
    }),
    (0, registry_js_1.tool)({
        name: "submit_bug_report",
        toolset: "social",
        title: "Report a bug",
        description: "Send BASIS a bug report about the site, the SDK, the API, the contracts or the docs. At most 5 a day; a near-copy " +
            "of an earlier report is refused.",
        input: {
            title: zod_1.z.string().describe("Short title, at most 191 characters."),
            description: zod_1.z.string().describe("What happened, what you expected, and how to repeat it. At most 5000 characters."),
            severity: zod_1.z.enum(["critical", "high", "medium", "low"]).describe("How bad it is."),
            category: zod_1.z.enum(["sdk", "contracts", "api", "frontend", "docs"]).describe('Where it is. "frontend" is the website.'),
            evidence: zod_1.z.string().optional().describe("An https link or a transaction hash (0x + 64 hex) that shows it."),
        },
        write: true,
        sendsTx: false,
        run: async ({ title, description, severity, category, evidence }, ctx) => {
            const client = await ctx.client();
            const ev = evidence?.trim();
            if (ev && !/^https:\/\/\S+$/i.test(ev) && !/^0x[0-9a-fA-F]{64}$/.test(ev)) {
                throw new basis_sdk_1.ValidationError("evidence", "evidence must be an https link or a transaction hash (0x + 64 hex characters).");
            }
            return (0, present_js_1.userContent)(await client.api.submitBugReport({
                title: checkText(title, "title", 1, 191),
                description: checkText(description, "description", 1, 5000),
                severity,
                category,
                evidence: ev ? checkText(ev, "evidence", 1, 1000) : undefined,
            }));
        },
    }),
    (0, registry_js_1.tool)({
        name: "get_bug_reports",
        toolset: "social",
        title: "My bug reports",
        description: "The bug reports this wallet sent, with their status (pending, verified, duplicate, invalid) and any note from BASIS.",
        input: {
            status: zod_1.z.enum(["pending", "verified", "duplicate", "invalid"]).optional().describe("Only reports with this status."),
            limit: registry_js_1.p.limit(100, 20),
            page: registry_js_1.p.page(),
        },
        run: async ({ status, limit, page }, ctx) => {
            const client = await ctx.client();
            const r = await client.api.getBugReports({ status, limit, page });
            return (0, present_js_1.userContent)({
                data: r.data.map(({ adminNote, ...rest }) => ({ ...rest, noteFromBasis: adminNote })),
                pagination: r.pagination,
            });
        },
    }),
];
