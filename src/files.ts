
import { realpath, readFile, stat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import { IMAGE_MAX_BYTES, ValidationError, type BasisClient } from "basis-sdk";

const MB = Math.round(IMAGE_MAX_BYTES / (1024 * 1024));

/** Network shares, device namespaces and pseudo-files. */
function isRemoteOrDevice(path: string): boolean {
  const p = path.replace(/\//g, "\\");
  if (p.startsWith("\\\\")) return true;
  if (/^[a-z]+:\/\//i.test(path)) return true;
  if (/^\/(dev|proc|sys)\//.test(path)) return true;
  return false;
}

function imageKind(b: Uint8Array): string | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "gif";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return "webp";
  }
  return null;
}

export interface LocalImage {
  bytes: Uint8Array;
  /** File name only (never the folder). */
  filename: string;
}

/** Reads a local image for upload, or throws ValidationError(field) saying what to pass instead. */
export async function readLocalImage(path: string, field = "image_file_path"): Promise<LocalImage> {
  const given = (path ?? "").trim();
  if (!given) throw new ValidationError(field, `${field} is empty.`);
  if (isRemoteOrDevice(given)) {
    throw new ValidationError(field, `${field} must be an image on this computer's disk, not a network or device path.`);
  }
  if (!isAbsolute(given)) {
    throw new ValidationError(field, `${field} must be a full path to the image (e.g. C:\\images\\logo.png or /home/me/logo.png).`);
  }
  let full: string;
  let size: number;
  try {
    full = await realpath(given);
    const st = await stat(full);
    if (!st.isFile()) throw new Error("not a file");
    size = st.size;
  } catch {
    throw new ValidationError(field, `Can't read an image file at ${field}. Pass the full path to a png, jpeg, gif or webp file.`);
  }
  if (isRemoteOrDevice(full)) {
    throw new ValidationError(field, `${field} must be an image on this computer's disk, not a network or device path.`);
  }
  if (size === 0) throw new ValidationError(field, `The file at ${field} is empty.`);
  if (size > IMAGE_MAX_BYTES) throw new ValidationError(field, `The image is over ${MB} MB: images can be at most ${MB} MB.`);
  const bytes = new Uint8Array(await readFile(full));
  if (!imageKind(bytes)) {
    throw new ValidationError(field, `The file at ${field} isn't a png, jpeg, gif or webp image.`);
  }
  return { bytes, filename: basename(full) };
}

/** Text for an image_file_path parameter. */
export const IMAGE_FILE_TEXT =
  `Or a local image file: the full path to a png, jpeg, gif or webp, up to ${MB} MB. The upload is public and permanent.`;


/** Hosts on this computer or its local network, by name or IP literal (a link must never reach them). */
function isLocalHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h === "0.0.0.0") return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (h.includes(":")) return h === "::1" || h === "::" || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith("::ffff:");
  return false;
}

/** An https link to a public host, or ValidationError(field). Plain http and local-network hosts are refused. */
export function httpsLink(url: string, field: string): string {
  const link = (url ?? "").trim();
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    throw new ValidationError(field, `${field} must be an https link to an image.`);
  }
  if (u.protocol !== "https:") throw new ValidationError(field, `${field} must be an https link (plain http and other kinds of link aren't accepted).`);
  if (isLocalHost(u.hostname)) throw new ValidationError(field, `${field} must point to a public website, not this computer or its local network.`);
  return link;
}

/** A download's body, refused once it passes the image size cap (never read whole into memory first). */
async function readCapped(res: Response, field: string): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const parts: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > IMAGE_MAX_BYTES) throw new ValidationError(field, `The image is over ${MB} MB: images can be at most ${MB} MB.`);
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

/** One download with every redirect checked by hand (each hop must be https to a public host), size-capped. */
async function download(link: string, field: string): Promise<Uint8Array> {
  let url = link;
  for (let hop = 0; hop <= 4; hop++) {
    let res: Response;
    try {
      res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      const timedOut = e instanceof Error && /timeout|aborted/i.test(`${e.name} ${e.message}`);
      throw new ValidationError(field, timedOut ? "Couldn't download the image: the site took longer than 30 s." : "Couldn't download the image: the site couldn't be reached.");
    }
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel().catch(() => undefined);
      const to = res.headers.get("location");
      if (!to) throw new ValidationError(field, `Couldn't download the image (HTTP ${res.status} with no new address).`);
      let next: string;
      try {
        next = new URL(to, url).toString();
      } catch {
        throw new ValidationError(field, `Couldn't download the image: the link forwards to an address that isn't valid.`);
      }
      try {
        url = httpsLink(next, field);
      } catch {
        throw new ValidationError(field, `${field} forwards to an address that isn't a public https link: give a link that points straight at the image.`);
      }
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new ValidationError(field, `Couldn't download the image (HTTP ${res.status}).`);
    }
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > IMAGE_MAX_BYTES) {
      await res.body?.cancel().catch(() => undefined);
      throw new ValidationError(field, `The image is over ${MB} MB: images can be at most ${MB} MB.`);
    }
    return readCapped(res, field);
  }
  throw new ValidationError(field, `Couldn't download the image: the link forwards too many times.`);
}

/** sharp, when the optional package is installed (loaded by name so the build doesn't need it). */
async function loadSharp(): Promise<((input: Uint8Array) => { resize: (...a: unknown[]) => { webp: () => { toBuffer: () => Promise<Buffer> } } }) | null> {
  const name = "sharp";
  try {
    const mod = (await import(name)) as { default?: unknown };
    return (mod.default ?? mod) as never;
  } catch {
    return null;
  }
}

/**
 * An image from an https link: downloaded once (every redirect checked, at most 5 MB), then resized to 512x512 WebP
 * when the optional image library (sharp) is installed, otherwise uploaded as downloaded (png, jpeg, gif or webp).
 * Used by every tool with an image_url.
 */
export async function imageFromUrl(
  _client: BasisClient,
  url: string,
  field = "image_url",
): Promise<{ bytes: Uint8Array; filename: string; resized: boolean }> {
  const link = httpsLink(url, field);
  const raw = await download(link, field);
  const sharp = await loadSharp();
  if (sharp) {
    try {
      const out = await sharp(raw).resize(512, 512, { fit: "cover", position: "centre" }).webp().toBuffer();
      return { bytes: new Uint8Array(out), filename: "image.webp", resized: true };
    } catch {
      throw new ValidationError(field, `The file at ${field} isn't an image that can be read.`);
    }
  }
  if (!imageKind(raw)) throw new ValidationError(field, `The file at ${field} isn't a png, jpeg, gif or webp image.`);
  let filename = "image";
  try {
    filename = basename(new URL(link).pathname) || "image";
  } catch {
  }
  return { bytes: raw, filename, resized: false };
}
