// image.ts — the single chokepoint for IMAGE generation in edge functions. Text generation goes
// through llm.ts; images are a different modality (and provider response shape), so they live here.
//
// We use Gemini 3 Pro Image ("nano-banana-pro") via OpenRouter — the model in our stack that holds
// CHARACTER CONSISTENCY: pass a character's reference portrait(s) as input images and it renders the
// same person across different scenes (identity preserved across up to 5 subjects). That's how
// "coherent characters" works (manual portrait step first → scenes reuse those portraits). Reuses the
// existing OPENROUTER_API_KEY.
import { type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Safelisted render models the UI can pick between (books.foundations.image_model holds the KEY, not the
// slug — the client never injects an arbitrary model). Gemini 3 Pro ("nano-banana-pro") is the default:
// it holds CHARACTER CONSISTENCY across reference portraits (identity preserved across up to 5 subjects),
// which the "coherent cast" feature depends on. 2.5 Flash is faster/cheaper but looser on likeness.
export const IMAGE_MODELS: Record<string, string> = {
  "gemini-3": "google/gemini-3-pro-image-preview",
  "gemini-2.5-flash": "google/gemini-2.5-flash-image",
};
export const DEFAULT_IMAGE_MODEL = "gemini-3";
const resolveModel = (key?: string): string => IMAGE_MODELS[key ?? ""] ?? IMAGE_MODELS[DEFAULT_IMAGE_MODEL];

export interface GenImageInput {
  prompt: string;
  /** Reference images (URLs or data URLs) — character portraits, fed in for visual coherence. */
  refImages?: string[];
  /** Render-model KEY from IMAGE_MODELS (book-level choice). Defaults to gemini-3. */
  model?: string;
}

// deno-lint-ignore no-explicit-any
type Content = any;

/** Generate `count` variants of the same prompt in parallel. Returns the ones that succeeded
 *  (throws only if every attempt failed). */
export async function generateImages(input: GenImageInput, count: number): Promise<string[]> {
  const n = Math.max(1, Math.min(count, 4));
  const settled = await Promise.allSettled(Array.from({ length: n }, () => generateImage(input)));
  const ok = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (ok.length === 0) {
    const first = settled.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    throw new Error(first ? String(first.reason?.message ?? first.reason) : "Image generation failed.");
  }
  return ok;
}

/** Generate one image. Returns a data URL (data:image/...;base64,...). Throws on failure. */
export async function generateImage({ prompt, refImages = [], model }: GenImageInput): Promise<string> {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not configured");

  const content: Content[] = [{ type: "text", text: prompt }];
  for (const url of refImages) content.push({ type: "image_url", image_url: { url } });

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: resolveModel(model), modalities: ["image", "text"], messages: [{ role: "user", content }] }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`Image API ${res.status}: ${raw.slice(0, 500)}`);

  const data = JSON.parse(raw);
  const img = data?.choices?.[0]?.message?.images?.[0]?.image_url?.url as string | undefined;
  if (!img) throw new Error("Image model returned no image.");
  return img;
}

/** Upload a data URL to a public bucket and return its public URL. */
export async function uploadDataUrl(
  client: SupabaseClient,
  bucket: string,
  path: string,
  dataUrl: string,
): Promise<string> {
  const comma = dataUrl.indexOf(",");
  const header = dataUrl.slice(0, comma);
  const b64 = dataUrl.slice(comma + 1);
  const contentType = header.match(/data:(.*?);/)?.[1] ?? "image/png";
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const { error } = await client.storage.from(bucket).upload(path, bytes, { contentType, upsert: true });
  if (error) throw error;
  return client.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}
