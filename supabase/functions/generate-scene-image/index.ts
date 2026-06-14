// generate-scene-image — illustrate a page's scene, with coherent characters. Prompt-first:
//
//   mode "prompt" → a TEXT model composes an editable image PROMPT from the character descriptions +
//                   the recent beats (the two preceding beats for continuity, the current beat as the
//                   moment to depict) + the author's art direction. Returns { prompt }.
//   mode "image"  → renders ONE image from the (possibly author-edited) prompt with the present cast's
//                   reference portraits + any author-supplied references attached, inserts a
//                   page_scene_images row, and returns it.
//
// Coherence: the current beat's named cast members are matched to books.foundations.cast[], and their
// pinned ref_image_url portraits (the "design the look" step) are fed in as reference images.
//
// Synchronous. Allows MANY images per page — each render inserts a new row (a gallery of moments).
// Client invokes via supabase.functions.invoke.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { hasEditAccess } from "../_shared/access.ts";
import { serviceClient } from "../_shared/task.ts";
import { generateImage, uploadDataUrl } from "../_shared/image.ts";
import { callClaude, textFromClaude, type CallMeta } from "../_shared/claude.ts";
import { getActiveModels } from "../_shared/model-config.ts";

interface CastMember { id: string; name: string; appearance?: string; portraits?: string[] }
interface PageRow { id: number; page_index: number; metadata: { beat?: string } | null }

// A cast member is "present" if their name (whole word, case-insensitive) appears in the beat.
function namedIn(text: string, name: string): boolean {
  const n = name.trim();
  if (!n) return false;
  return new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
}

const PROMPT_SYSTEM = `You write ONE image-generation prompt for a single scene of a novel.

You are given recent story beats for continuity and the BEAT TO DEPICT. Describe only the beat-to-depict as a still image: the setting, the characters present and their actions/expressions, the mood, the lighting, and the composition. Use the provided character appearances so each person is rendered faithfully. Let the preceding beats inform mood and continuity, but do NOT depict them.

Output ONLY the prompt text — no preamble, no quotes, no labels. 2–4 sentences. Do not mention cameras, file formats, or "no text/watermark" instructions (those are added separately).`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
    );
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const { pageId, mode = "image", prompt, instruction, refUrls = [] } =
      (await req.json().catch(() => ({}))) as {
        pageId?: number; mode?: "prompt" | "image";
        prompt?: string; instruction?: string; refUrls?: string[];
      };
    if (!pageId) return json({ error: "pageId is required" }, 400);

    const { data: page, error: pageError } = await userClient
      .from("pages").select("id, book_id, metadata").eq("id", pageId).single();
    if (pageError || !page) return json({ error: "Page not found" }, 404);

    const bookId = page.book_id as number;
    if (!(await hasEditAccess(userClient, bookId, user.id)))
      return json({ error: "Access denied" }, 403);

    const beat = ((page.metadata as { beat?: string } | null)?.beat ?? "").trim();
    if (!beat) return json({ error: "Plan the beat first — the scene is drawn from it." }, 400);

    const { data: book } = await userClient.from("books").select("foundations").eq("id", bookId).single();
    const cast = ((book?.foundations as { cast?: CastMember[] } | null)?.cast) ?? [];
    const present = cast.filter((m) => namedIn(beat, m.name));
    // Up to 2 angles per present character keeps the reference set focused (and the request small).
    const refImages = present.flatMap((m) => (m.portraits ?? []).slice(0, 2));

    // ── mode "prompt": compose an editable scene prompt from descriptions + beats context ──
    if (mode === "prompt") {
      // Recent beats for continuity: the up-to-2 preceding pages (by page_index) that have a beat.
      const { data: pages } = await userClient
        .from("pages").select("id, page_index, metadata")
        .eq("book_id", bookId).eq("archived", false).order("page_index", { ascending: true });
      const list = (pages as PageRow[] | null) ?? [];
      const here = list.findIndex((p) => p.id === pageId);
      const priorBeats = (here > 0 ? list.slice(0, here) : [])
        .map((p) => (p.metadata?.beat ?? "").trim()).filter(Boolean).slice(-2);
      const castNotes = present
        .map((m) => `- ${m.name}${m.appearance?.trim() ? `: ${m.appearance.trim()}` : ""}`)
        .join("\n");

      const apiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
      const { low: model } = await getActiveModels();
      const userContent = [
        priorBeats.length ? `RECENT BEATS (for continuity — do NOT depict):\n${priorBeats.map((b, i) => `${i + 1}. ${b}`).join("\n\n")}` : null,
        `BEAT TO DEPICT:\n${beat}`,
        castNotes ? `CHARACTERS PRESENT (render faithfully):\n${castNotes}` : null,
        instruction?.trim() ? `ART DIRECTION (author — honor this):\n${instruction.trim()}` : null,
        "Write the image prompt.",
      ].filter(Boolean).join("\n\n");
      const meta: CallMeta = { fn: "generate-scene-image", bookId, userId: user.id };
      const data = await callClaude(apiKey, {
        model, max_tokens: 400, temperature: 0.8,
        system: [{ type: "text", text: PROMPT_SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userContent }],
      }, meta);
      const composed = textFromClaude(data).trim();
      if (!composed) return json({ error: "Could not compose a scene prompt." }, 502);
      return json({ prompt: composed });
    }

    // ── mode "image": render from the prompt + cast portraits + author references ──
    if (!prompt?.trim()) return json({ error: "A prompt is required to render the scene." }, 400);
    const imagePrompt = [
      prompt.trim(),
      refImages.length ? "Reference portraits are attached — keep each character's face and features faithful to them." : null,
      "Cinematic, painterly, richly atmospheric. No text, captions, or watermarks.",
    ].filter(Boolean).join("\n\n");

    const dataUrl = await generateImage({ prompt: imagePrompt, refImages: [...refImages, ...refUrls] });
    const svc = serviceClient();
    const url = await uploadDataUrl(svc, "scene-images", `scenes/${pageId}/${Date.now()}.png`, dataUrl);

    const { data: row, error: insErr } = await svc
      .from("page_scene_images")
      .insert({ page_id: pageId, book_id: bookId, image_url: url, prompt: prompt.trim(), created_by: user.id })
      .select("id, page_id, book_id, image_url, prompt, created_at")
      .single();
    if (insErr) throw insErr;

    return json(row);
  } catch (e) {
    console.error("generate-scene-image error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});
