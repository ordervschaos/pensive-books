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
import { runInBackground, serviceClient } from "../_shared/task.ts";
import { generateImage, uploadDataUrl } from "../_shared/image.ts";
import { callLLM, textFromLLM, type CallMeta } from "../_shared/llm.ts";
import { IMAGE_PROMPT_MODEL } from "../_shared/model-config.ts";
import { PROMPT_SYSTEM } from "../_shared/sceneImagePrompts.ts";

interface CastMember { id: string; name: string; appearance?: string; portraits?: string[] }
interface PageRow { id: number; page_index: number; metadata: { beat?: string } | null }

const SCENE_SELECT = "id, page_id, book_id, image_url, prompt, status, error, scene_spec, created_at";

// Tolerant JSON extraction for the spec composer — strips any markdown fence / prose around the object
// and pulls the first {...} block. Returns null when nothing parseable is found.
function parseSpec(text: string): Record<string, unknown> | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(t.slice(start, end + 1));
    return obj && typeof obj === "object" ? obj as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

// A cast member is "present" if their name (whole word, case-insensitive) appears in the beat.
function namedIn(text: string, name: string): boolean {
  const n = name.trim();
  if (!n) return false;
  return new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
}

// SPEC mode: same focal-staging craft as PROMPT_SYSTEM, but emit a STRUCTURED JSON spec the author edits
// field-by-field in the studio. The first subject is the FOCAL character; others are subordinate. The
// client flattens this back into the labelled prompt at render time, so the staging rules still hold.
const SPEC_SYSTEM = `You compose a STRUCTURED scene spec for a single scene of a novel. The author edits it field-by-field, then it is rendered as an image — so each field must be concrete and visual.

You are given recent story beats for continuity and the BEAT TO DEPICT. Depict ONLY the beat-to-depict.

The image's job is IMMERSION, not exposition. Choose ONE focal character — whoever the beat centres on — as the FIRST subject, and build the frame around them. Other named characters may be present, staged naturally and SUBORDINATELY (in the action, turned away, partly in frame, soft in the background) — never a posed, evenly-spaced cast line-up, never anyone facing the camera unless the beat is literally a portrait. Favour an intimate, candid shot (close / medium / over-the-shoulder), varying the angle.

Output ONLY a JSON object (no prose, no markdown fence) with exactly this shape:
{
  "subjects": [
    { "name": "the character's name", "build": "physique / age read / height", "clothing": "what they are wearing", "expression": "their exact expression in this moment", "action": "what they are doing right now" }
  ],
  "setting": "where it happens, time of day, telling environmental details",
  "action": "the single moment being depicted, drawn from the beat",
  "composition": "intimate candid camera — shot type (favour close/medium/over-the-shoulder), the focal point held on the first subject, plus angle and depth of field; explicitly avoid a flat line-up",
  "lighting": "quality, direction, and colour of the light",
  "mood": "the emotional atmosphere",
  "exclude": "things to keep out (text, watermarks, posed line-ups, facing camera)"
}

Rules:
- The FIRST subject is the focal character. List only characters actually in the frame.
- Fill build/clothing faithfully from each character's given appearance; infer sensibly when the appearance is thin, but never invent contradicting details.
- Be concrete and visual everywhere — avoid plot abstractions a camera cannot see.
- Do NOT include a "style" field — the rendering look is applied separately by the author's house look.
- Weave any author art direction into the relevant fields.`;

// REVISE mode (the Scene editor's chat): apply ONE free-text change to an existing spec and return the
// full updated spec. The point is surgical edits — only touch what the change implies.
const REVISE_SPEC_SYSTEM = `You revise a STRUCTURED scene spec for a single scene of a novel, in a chat with the author. You are given the CURRENT SPEC and the author's requested CHANGE. Apply the change and return the FULL updated spec — but ONLY alter what the change implies; keep every other field exactly as it was.

The spec shape (same as composing): "subjects" is an array of { "name", "build", "clothing", "expression", "action" } with the FIRST subject being the focal character; plus "setting", "action", "composition", "lighting", "mood", "exclude". Keep the same focal-staging discipline (one focal subject, others subordinate, no posed line-ups, candid intimate framing).

Output ONLY a JSON object (no prose, no markdown fence) of that exact shape, PLUS one extra field "note": a single short sentence, first person and past tense, saying what you changed (e.g. "Moved the scene to night and brought Mara to the foreground.").

Rules:
- Be concrete and visual. Do NOT include a "style" field. Never invent details that contradict the cast appearances or the beat.
- If the change adds or removes a character, update "subjects" accordingly (and re-pick the focal subject only if the change asks for it).`;

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

    const { pageId, mode = "image", prompt, instruction, style, refUrls = [], currentSpec, spec, refCount = 0, castRefUrls } =
      (await req.json().catch(() => ({}))) as {
        pageId?: number; mode?: "prompt" | "image" | "oneshot" | "spec" | "revise-spec";
        prompt?: string; instruction?: string; style?: string; refUrls?: string[]; currentSpec?: unknown; spec?: unknown; refCount?: number; castRefUrls?: string[];
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
    const foundations = (book?.foundations as { cast?: CastMember[]; art_direction?: string; image_model?: string } | null) ?? {};
    const cast = foundations.cast ?? [];
    // An explicit `style` (the author's per-compose style pick) overrides the book house look for this
    // composition — so they can sweep styles without mutating the book default.
    const houseLook = (style?.trim() || foundations.art_direction || "").trim();
    const imageModel = foundations.image_model;
    const present = cast.filter((m) => namedIn(beat, m.name));
    // ONE portrait per present character, capped at 3 total. More than that (or multiple angles each)
    // pushes the model to assemble every face into a flat, evenly-spaced cast line-up — the opposite of
    // the intimate, focal-character framing the composer now asks for. One ref each is enough for likeness.
    const refImages = present.flatMap((m) => (m.portraits ?? []).slice(0, 1)).slice(0, 3);

    // Compose the structured scene prompt from the cast + recent beats + house look. Runs the text model
    // server-side, so it stays durable when called from the background "oneshot" job (nothing to lose if
    // the client navigates away mid-compose — the gap the two-call client flow left during "Composing…").
    // Shared context block for the labelled-prompt composer, the spec composer and the spec reviser.
    // `opts.withInstruction` injects the free-text instruction as ART DIRECTION (off for revise, where
    // the instruction is framed as the change in `opts.extra` instead); `opts.extra` is an extra block
    // (e.g. the current spec + change request) inserted just before the closing line.
    const buildUserContent = async (closing: string, opts?: { withInstruction?: boolean; extra?: string }): Promise<string> => {
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
      const withInstruction = opts?.withInstruction ?? true;
      return [
        priorBeats.length ? `RECENT BEATS (for continuity — do NOT depict):\n${priorBeats.map((b, i) => `${i + 1}. ${b}`).join("\n\n")}` : null,
        `BEAT TO DEPICT:\n${beat}`,
        castNotes ? `CHARACTERS PRESENT (render faithfully):\n${castNotes}` : null,
        houseLook ? `HOUSE LOOK (the book's settled visual style — honour this so every scene looks like one book):\n${houseLook}` : null,
        withInstruction && instruction?.trim() ? `ART DIRECTION (author — honor this):\n${instruction.trim()}` : null,
        opts?.extra ?? null,
        closing,
      ].filter(Boolean).join("\n\n");
    };

    const composeScenePromptText = async (): Promise<string> => {
      const userContent = await buildUserContent("Write the image prompt.");
      const apiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
      const meta: CallMeta = { fn: "generate-scene-image", bookId, userId: user.id };
      const data = await callLLM(apiKey, {
        model: IMAGE_PROMPT_MODEL, max_tokens: 400, temperature: 0.8,
        system: [{ type: "text", text: PROMPT_SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userContent }],
      }, meta);
      return textFromLLM(data).trim();
    };

    // ── mode "spec": compose a STRUCTURED scene spec (the studio rail's field-by-field editor) ──
    if (mode === "spec") {
      const userContent = await buildUserContent("Output the scene spec as JSON.");
      const apiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
      const meta: CallMeta = { fn: "generate-scene-image", bookId, userId: user.id };
      const data = await callLLM(apiKey, {
        model: IMAGE_PROMPT_MODEL, max_tokens: 700, temperature: 0.7,
        system: [{ type: "text", text: SPEC_SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userContent }],
      }, meta);
      const composed = parseSpec(textFromLLM(data));
      if (!composed) return json({ error: "Could not compose a scene spec." }, 502);
      return json({ spec: composed });
    }

    // ── mode "revise-spec": CHAT — apply a free-text change to the current spec, keeping the rest ──
    if (mode === "revise-spec") {
      if (!instruction?.trim()) return json({ error: "Say what to change." }, 400);
      // When the author attached reference image(s), their message is direction about those references.
      // The reviser can't SEE them, but it must fold the author's words into the spec fields so the
      // labelled prompt carries the intent to the renderer, which CAN see them (in the same order).
      const refBlock = refCount > 1
        ? `\n\nREFERENCE IMAGES: the author attached ${refCount} reference images you cannot see, in order — reference 1, 2, … through ${refCount}. Their change may take a DIFFERENT element from each (e.g. the camera angle from one, a character's face or outfit from another). Apply each to the relevant field(s) and add a short cue naming the source, like "(the camera angle of reference 1)" or "(her face from reference 2)", so the renderer applies the right element from the right image.`
        : refCount === 1
          ? `\n\nREFERENCE IMAGE: the author attached 1 reference image you cannot see. Their change says what to take from it — weave that into the relevant field(s) and add a short cue like "(matching the attached reference)" so the renderer (which CAN see it) applies it.`
          : "";
      const userContent = await buildUserContent(
        `Apply the change and output the FULL updated spec as JSON, with an extra "note" field: one short sentence (first person, past tense) describing what you changed.`,
        { withInstruction: false, extra: `CURRENT SPEC (revise THIS — keep everything the change does not mention):\n${JSON.stringify(currentSpec ?? {}, null, 2)}${refBlock}\n\nAUTHOR'S CHANGE:\n${instruction.trim()}` },
      );
      const apiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
      const meta: CallMeta = { fn: "generate-scene-image", bookId, userId: user.id };
      const data = await callLLM(apiKey, {
        model: IMAGE_PROMPT_MODEL, max_tokens: 800, temperature: 0.6,
        system: [{ type: "text", text: REVISE_SPEC_SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userContent }],
      }, meta);
      const obj = parseSpec(textFromLLM(data));
      if (!obj) return json({ error: "Could not revise the scene spec." }, 502);
      const note = typeof obj.note === "string" ? obj.note.trim() : "";
      delete obj.note;
      return json({ spec: obj, note });
    }

    // ── mode "prompt": compose an editable scene prompt (the "compose & edit first" path) ──
    if (mode === "prompt") {
      const composed = await composeScenePromptText();
      if (!composed) return json({ error: "Could not compose a scene prompt." }, 502);
      return json({ prompt: composed });
    }

    // ── mode "oneshot": DURABLE compose + render in ONE background job (the default Generate) ──
    // Insert a 'composing' placeholder row, then compose AND render in the background (waitUntil). The
    // whole thing survives the client leaving, and the composed prompt is saved on the row for revision.
    if (mode === "oneshot") {
      const svc = serviceClient();
      const { data: row, error: insErr } = await svc
        .from("page_scene_images")
        .insert({ page_id: pageId, book_id: bookId, image_url: null, prompt: null, status: "composing", created_by: user.id })
        .select(SCENE_SELECT)
        .single();
      if (insErr) throw insErr;
      runInBackground(svc, "page_scene_images", row.id, "generate-scene-image", async () => {
        const promptText = await composeScenePromptText();
        if (!promptText) throw new Error("Could not compose a scene prompt.");
        const dataUrl = await generateImage({ prompt: promptText, refImages, model: imageModel });
        const url = await uploadDataUrl(svc, "scene-images", `scenes/${pageId}/${Date.now()}.png`, dataUrl);
        return { prompt: promptText, image_url: url, status: "ready" };
      });
      return json(row);
    }

    // ── mode "image": render the prompt VERBATIM + cast portraits + author references ──
    // The (author-edited) structured prompt is the single source of truth — nothing is appended, so the
    // author controls the full prompt. Cast portraits still ride along as reference images for likeness.
    //
    // DURABLE: insert a 'generating' placeholder row FIRST, then render in the background (waitUntil) so
    // the HTTP response returns immediately and the work survives the client navigating away. The gallery
    // (a live projection of these rows) shows the spinner and swaps in the image when the row → 'ready'.
    if (!prompt?.trim()) return json({ error: "A prompt is required to render the scene." }, 400);
    const svc = serviceClient();
    const promptText = prompt.trim();
    // Author-attached references go FIRST, in attachment order, so "reference 1/2/…" in the prompt lines
    // up with what the author numbered in the chat; the character portraits follow as likeness anchors.
    // When the client sends `castRefUrls` (even []), it is the author-controlled portrait set and REPLACES
    // the edge's automatic beat-name pick; omit it to fall back to the auto selection.
    const castRefs = Array.isArray(castRefUrls) ? castRefUrls : refImages;
    const refs = [...refUrls, ...castRefs];

    const { data: row, error: insErr } = await svc
      .from("page_scene_images")
      .insert({ page_id: pageId, book_id: bookId, image_url: null, prompt: promptText, status: "generating", scene_spec: spec ?? null, created_by: user.id })
      .select(SCENE_SELECT)
      .single();
    if (insErr) throw insErr;

    runInBackground(svc, "page_scene_images", row.id, "generate-scene-image", async () => {
      const dataUrl = await generateImage({ prompt: promptText, refImages: refs, model: imageModel });
      const url = await uploadDataUrl(svc, "scene-images", `scenes/${pageId}/${Date.now()}.png`, dataUrl);
      return { image_url: url, status: "ready" };
    });

    return json(row);
  } catch (e) {
    console.error("generate-scene-image error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});
