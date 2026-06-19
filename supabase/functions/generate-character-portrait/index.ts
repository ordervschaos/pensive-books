// generate-character-portrait — the "design the look" step (manual portrait, approved by the author).
//
// Prompt-first, in two modes:
//   mode "prompt" → a TEXT model composes an editable PORTRAIT PROMPT from the cast record
//                   (name/role/appearance/want/wound). Returns { prompt }.
//   mode "image"  → renders `count` VARIANTS from the (possibly author-edited) prompt, plus any
//                   author-supplied reference images. Returns { urls } — NOT pinned; the client lets
//                   the author pick one and writes ref_image_url (single writer of foundations).
//
// The pinned portrait is what scene generation feeds back in so the character stays consistent.
// Synchronous. Client invokes via supabase.functions.invoke.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { hasEditAccess } from "../_shared/access.ts";
import { serviceClient } from "../_shared/task.ts";
import { generateImages, uploadDataUrl } from "../_shared/image.ts";
import { callClaude, textFromClaude, type CallMeta } from "../_shared/claude.ts";
import { IMAGE_PROMPT_MODEL } from "../_shared/model-config.ts";

interface CastMember {
  id: string; name: string;
  role?: string; appearance?: string; want?: string; wound?: string;
}

const PORTRAIT_SYSTEM = `You compose ONE structured image prompt for a character REFERENCE PORTRAIT for a novel. The author will edit it, then it is sent VERBATIM to an image model — so it must be complete and self-contained.

Given the character's name, role, appearance, and inner life, output EXACTLY these labelled lines, in this order, each on its own line, nothing before or after:

SUBJECT: the character's face, apparent age, build, hair, and distinguishing features, their typical dress, and an expression that reflects who they are — a believable, specific person.
FRAMING: head-and-shoulders character reference portrait.
BACKGROUND: neutral, with even soft lighting.
STYLE: the rendering look. If a HOUSE LOOK is given, this line MUST honour it; otherwise default to photorealistic. Keep features consistent and suitable as a reusable reference.
EXCLUDE: no text, captions, watermarks, or signatures.

Weave any author art direction into the relevant lines.`;

// Fallback when the author renders WITHOUT composing a prompt — mirrors the structured format so a
// no-AI portrait still carries the framing/background/exclude guidance the composer would have written.
const fallbackPortrait = (m: CastMember, houseLook: string) =>
  [
    `SUBJECT: ${m.name}${m.appearance?.trim() ? ` — ${m.appearance.trim()}` : ""}, an expression true to who they are.`,
    "FRAMING: head-and-shoulders character reference portrait.",
    "BACKGROUND: neutral, with even soft lighting.",
    `STYLE: ${houseLook || "photorealistic"}, consistent features suitable as a reusable reference.`,
    "EXCLUDE: no text, captions, watermarks, or signatures.",
  ].join("\n");

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

    const { bookId, castId, mode = "image", prompt, instruction, count = 3, refUrls = [] } =
      (await req.json().catch(() => ({}))) as {
        bookId?: number; castId?: string; mode?: "prompt" | "image";
        prompt?: string; instruction?: string; count?: number; refUrls?: string[];
      };
    if (!bookId || !castId) return json({ error: "bookId and castId are required" }, 400);

    const { data: book, error: bookError } = await userClient
      .from("books").select("id, name, foundations, owner_id").eq("id", bookId).single();
    if (bookError || !book) return json({ error: "Book not found" }, 404);
    if (!(await hasEditAccess(userClient, bookId, user.id, book.owner_id)))
      return json({ error: "Access denied" }, 403);

    const foundations = (book.foundations as { cast?: CastMember[]; art_direction?: string; image_model?: string } | null) ?? {};
    const cast = foundations.cast ?? [];
    const houseLook = (foundations.art_direction ?? "").trim();
    const imageModel = foundations.image_model;
    const member = cast.find((m) => m.id === castId);
    if (!member) return json({ error: "Character not found in this book's cast" }, 404);

    // ── mode "prompt": compose an editable portrait prompt ──
    if (mode === "prompt") {
      const apiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
      const model = IMAGE_PROMPT_MODEL;
      const userContent = [
        `NAME: ${member.name}`,
        member.role ? `ROLE: ${member.role}` : null,
        member.appearance?.trim() ? `APPEARANCE: ${member.appearance.trim()}` : null,
        member.want?.trim() ? `WANTS: ${member.want.trim()}` : null,
        member.wound?.trim() ? `WOUND (informs expression): ${member.wound.trim()}` : null,
        houseLook ? `HOUSE LOOK (the book's settled visual style — the STYLE line MUST honour this so the cast looks like one book): ${houseLook}` : null,
        instruction?.trim() ? `ART DIRECTION (author — honor this): ${instruction.trim()}` : null,
        "Write the portrait prompt.",
      ].filter(Boolean).join("\n");
      const meta: CallMeta = { fn: "generate-character-portrait", bookId, userId: user.id };
      const data = await callClaude(apiKey, {
        model, max_tokens: 400, temperature: 0.8,
        system: [{ type: "text", text: PORTRAIT_SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userContent }],
      }, meta);
      const composed = textFromClaude(data).trim();
      if (!composed) return json({ error: "Could not compose a portrait prompt." }, 502);
      return json({ prompt: composed });
    }

    // ── mode "image": render variants from the prompt VERBATIM + author references ──
    // The (author-edited) structured prompt is the source of truth; nothing is appended. When the author
    // skips composing, fall back to a structured prompt built from the cast record.
    const promptText = prompt?.trim() || fallbackPortrait(member, houseLook);
    const dataUrls = await generateImages({ prompt: promptText, refImages: refUrls, model: imageModel }, count);

    const svc = serviceClient();
    const urls = await Promise.all(
      dataUrls.map((d, i) => uploadDataUrl(svc, "scene-images", `portraits/${bookId}/${castId}-${Date.now()}-${i}.png`, d)),
    );
    return json({ urls });
  } catch (e) {
    console.error("generate-character-portrait error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});
