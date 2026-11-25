"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IMAGE_FILE_TEXT = void 0;
exports.readLocalImage = readLocalImage;
exports.httpsLink = httpsLink;
exports.imageFromUrl = imageFromUrl;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const basis_sdk_1 = require("basis-sdk");
const MB = Math.round(basis_sdk_1.IMAGE_MAX_BYTES / (1024 * 1024));
function isRemoteOrDevice(path) {
    const p = path.replace(/\//g, "\\");
    if (p.startsWith("\\\\"))
        return true;
    if (/^[a-z]+:\/\//i.test(path))
        return true;
    if (/^\/(dev|proc|sys)\//.test(path))
        return true;
    return false;
}
function imageKind(b) {
    if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
        return "png";
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
        return "jpeg";
    if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38)
        return "gif";
    if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
        return "webp";
    }
    return null;
}
async function readLocalImage(path, field = "image_file_path") {
    const given = (path ?? "").trim();
    if (!given)
        throw new basis_sdk_1.ValidationError(field, `${field} is empty.`);
    if (isRemoteOrDevice(given)) {
        throw new basis_sdk_1.ValidationError(field, `${field} must be an image on this computer's disk, not a network or device path.`);
    }
    if (!(0, node_path_1.isAbsolute)(given)) {
        throw new basis_sdk_1.ValidationError(field, `${field} must be a full path to the image (e.g. C:\\images\\logo.png or /home/me/logo.png).`);
    }
    let full;
    let size;
    try {
        full = await (0, promises_1.realpath)(given);
        const st = await (0, promises_1.stat)(full);
        if (!st.isFile())
            throw new Error("not a file");
        size = st.size;
    }
    catch {
        throw new basis_sdk_1.ValidationError(field, `Can't read an image file at ${field}. Pass the full path to a png, jpeg, gif or webp file.`);
    }
    if (isRemoteOrDevice(full)) {
        throw new basis_sdk_1.ValidationError(field, `${field} must be an image on this computer's disk, not a network or device path.`);
    }
    if (size === 0)
        throw new basis_sdk_1.ValidationError(field, `The file at ${field} is empty.`);
    if (size > basis_sdk_1.IMAGE_MAX_BYTES)
        throw new basis_sdk_1.ValidationError(field, `The image is over ${MB} MB: images can be at most ${MB} MB.`);
    const bytes = new Uint8Array(await (0, promises_1.readFile)(full));
    if (!imageKind(bytes)) {
        throw new basis_sdk_1.ValidationError(field, `The file at ${field} isn't a png, jpeg, gif or webp image.`);
    }
    return { bytes, filename: (0, node_path_1.basename)(full) };
}
exports.IMAGE_FILE_TEXT = `Or a local image file: the full path to a png, jpeg, gif or webp, up to ${MB} MB. The upload is public and permanent.`;
function isLocalHost(host) {
    const h = host.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h === "0.0.0.0")
        return true;
    const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
    if (v4) {
        const [a, b] = [Number(v4[1]), Number(v4[2])];
        return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
    }
    if (h.includes(":"))
        return h === "::1" || h === "::" || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith("::ffff:");
    return false;
}
function httpsLink(url, field) {
    const link = (url ?? "").trim();
    let u;
    try {
        u = new URL(link);
    }
    catch {
        throw new basis_sdk_1.ValidationError(field, `${field} must be an https link to an image.`);
    }
    if (u.protocol !== "https:")
        throw new basis_sdk_1.ValidationError(field, `${field} must be an https link (plain http and other kinds of link aren't accepted).`);
    if (isLocalHost(u.hostname))
        throw new basis_sdk_1.ValidationError(field, `${field} must point to a public website, not this computer or its local network.`);
    return link;
}
async function readCapped(res, field) {
    if (!res.body)
        return new Uint8Array(await res.arrayBuffer());
    const parts = [];
    let total = 0;
    for await (const chunk of res.body) {
        total += chunk.byteLength;
        if (total > basis_sdk_1.IMAGE_MAX_BYTES)
            throw new basis_sdk_1.ValidationError(field, `The image is over ${MB} MB: images can be at most ${MB} MB.`);
        parts.push(chunk);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
        out.set(part, at);
        at += part.byteLength;
    }
    return out;
}
async function download(link, field) {
    let url = link;
    for (let hop = 0; hop <= 4; hop++) {
        let res;
        try {
            res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
        }
        catch (e) {
            const timedOut = e instanceof Error && /timeout|aborted/i.test(`${e.name} ${e.message}`);
            throw new basis_sdk_1.ValidationError(field, timedOut ? "Couldn't download the image: the site took longer than 30 s." : "Couldn't download the image: the site couldn't be reached.");
        }
        if (res.status >= 300 && res.status < 400) {
            await res.body?.cancel().catch(() => undefined);
            const to = res.headers.get("location");
            if (!to)
                throw new basis_sdk_1.ValidationError(field, `Couldn't download the image (HTTP ${res.status} with no new address).`);
            let next;
            try {
                next = new URL(to, url).toString();
            }
            catch {
                throw new basis_sdk_1.ValidationError(field, `Couldn't download the image: the link forwards to an address that isn't valid.`);
            }
            try {
                url = httpsLink(next, field);
            }
            catch {
                throw new basis_sdk_1.ValidationError(field, `${field} forwards to an address that isn't a public https link: give a link that points straight at the image.`);
            }
            continue;
        }
        if (!res.ok) {
            await res.body?.cancel().catch(() => undefined);
            throw new basis_sdk_1.ValidationError(field, `Couldn't download the image (HTTP ${res.status}).`);
        }
        const declared = Number(res.headers.get("content-length") ?? "0");
        if (declared > basis_sdk_1.IMAGE_MAX_BYTES) {
            await res.body?.cancel().catch(() => undefined);
            throw new basis_sdk_1.ValidationError(field, `The image is over ${MB} MB: images can be at most ${MB} MB.`);
        }
        return readCapped(res, field);
    }
    throw new basis_sdk_1.ValidationError(field, `Couldn't download the image: the link forwards too many times.`);
}
async function loadSharp() {
    const name = "sharp";
    try {
        const mod = (await import(name));
        return (mod.default ?? mod);
    }
    catch {
        return null;
    }
}
async function imageFromUrl(_client, url, field = "image_url") {
    const link = httpsLink(url, field);
    const raw = await download(link, field);
    const sharp = await loadSharp();
    if (sharp) {
        try {
            const out = await sharp(raw).resize(512, 512, { fit: "cover", position: "centre" }).webp().toBuffer();
            return { bytes: new Uint8Array(out), filename: "image.webp", resized: true };
        }
        catch {
            throw new basis_sdk_1.ValidationError(field, `The file at ${field} isn't an image that can be read.`);
        }
    }
    if (!imageKind(raw))
        throw new basis_sdk_1.ValidationError(field, `The file at ${field} isn't a png, jpeg, gif or webp image.`);
    let filename = "image";
    try {
        filename = (0, node_path_1.basename)(new URL(link).pathname) || "image";
    }
    catch {
    }
    return { bytes: raw, filename, resized: false };
}
