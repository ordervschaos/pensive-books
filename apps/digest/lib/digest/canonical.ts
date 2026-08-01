import { createHash } from "crypto";

// Content-addressed dedupe. The digest's memory of "already told you this" is keyed by a hash of the
// CANONICAL url, not the raw one — without normalization the same article arrives new every morning through
// a different tracking link, and the whole dedupe layer quietly does nothing.

const TRACKING_PREFIXES = ["utm_", "mc_", "pk_"];
const TRACKING_EXACT = new Set([
  "fbclid", "gclid", "gbraid", "wbraid", "msclkid", "igshid", "ref", "ref_src", "source", "cmpid",
]);

export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.protocol = u.protocol === "http:" ? "https:" : u.protocol;
    u.hostname = u.hostname.toLowerCase().replace(/^(www|m|amp)\./, "");
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) {
      const k = key.toLowerCase();
      if (TRACKING_EXACT.has(k) || TRACKING_PREFIXES.some((p) => k.startsWith(p))) {
        u.searchParams.delete(key);
      }
    }
    // Stable param order, so ?a=1&b=2 and ?b=2&a=1 hash the same.
    u.searchParams.sort();
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString();
  } catch {
    return raw.trim();
  }
}

export function urlHash(raw: string): string {
  return createHash("sha256").update(canonicalUrl(raw)).digest("hex");
}
