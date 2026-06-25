// generate-dna-character-portrait — the "design the look" step for a Novel-DNA character NODE (picture-book
// mode, docs/picture-book-mode.md). The node-native sibling of generate-character-portrait: that one reads
// foundations.cast; this reads a book_nodes character node (DNA-native books have no foundations.cast). The
// pinned portrait(s) live on character.content.portraits and are fed into scene renders so the character
// stays consistent across scenes (the consistency layer).
//
//   mode "prompt" → compose an editable portrait prompt from the character node. Returns { prompt }.
//   mode "image"  → render `count` VARIANTS from the prompt (or, with no prompt, compose one server-side
//                   first for one-click quality) + author references. Returns { urls } — NOT pinned; the
//                   client lets the author pick and appends to character.content.portraits.
//
// Synchronous (mirrors generate-character-portrait). Client invokes via supabase.functions.invoke.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { hasEditAccess } from "../_shared/access.ts";
import { serviceClient } from "../_shared/task.ts";
import { generateImages, uploadDataUrl } from "../_shared/image.ts";
import { callClaude, textFromClaude, type CallMeta } from "../_shared/claude.ts";
import { IMAGE_PROMPT_MODEL } from "../_shared/model-config.ts";
import { PORTRAIT_SYSTEM, fallbackPortrait, portraitUserContent, type PortraitSubject } from "../_shared/characterPortraitPrompts.ts";

interface CharContent { name?: string; role?: string; tag?: string; want?: string; wound?: string }

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

    const { bookId, nodeId, mode = "image", prompt, instruction, count = 3, refUrls = [] } =
      (await req.json().catch(() => ({}))) as {
        bookId?: number; nodeId?: string; mode?: "prompt" | "image";
        prompt?: string; instruction?: string; count?: number; refUrls?: string[];
      };
    if (!bookId || !nodeId) return json({ error: "bookId and nodeId are required" }, 400);
    if (!(await hasEditAccess(userClient, bookId, user.id))) return json({ error: "Access denied" }, 403);

    const { data: book } = await userClient.from("books").select("foundations").eq("id", bookId).single();
    const foundations = (book?.foundations as { art_direction?: string; image_model?: string } | null) ?? {};
    const houseLook = (foundations.art_direction ?? "").trim();
    const imageModel = foundations.image_model;

    const { data: nodeRow } = await userClient.from("book_nodes").select("id, kind, content").eq("id", nodeId).eq("book_id", bookId).maybeSingle();
    if (!nodeRow || (nodeRow as { kind?: string }).kind !== "character") return json({ error: "Character node not found" }, 404);
    const c = (nodeRow as { content: CharContent }).content;
    const name = (c.name ?? "").trim();
    if (!name) return json({ error: "Name the character before designing the look." }, 400);
    // The DNA character node's visual descriptor is `tag` (the physical tag); the rest maps 1:1.
    const subject: PortraitSubject = { name, role: c.role, appearance: c.tag, want: c.want, wound: c.wound };

    const composePromptText = async (): Promise<string> => {
      const apiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
      const meta: CallMeta = { fn: "generate-dna-character-portrait", bookId, userId: user.id };
      const data = await callClaude(apiKey, {
        model: IMAGE_PROMPT_MODEL, max_tokens: 400, temperature: 0.8,
        system: [{ type: "text", text: PORTRAIT_SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: portraitUserContent(subject, houseLook, instruction) }],
      }, meta);
      return textFromClaude(data).trim();
    };

    // ── mode "prompt": compose an editable portrait prompt; also returns model so the UI can label it ──
    if (mode === "prompt") {
      const composed = await composePromptText();
      if (!composed) return json({ error: "Could not compose a portrait prompt." }, 502);
      return json({ prompt: composed, model: imageModel ?? null });
    }

    // ── mode "image": render `count` variants. With no author prompt, compose one server-side first
    // (one-click quality); if that fails, fall back to the structured no-AI prompt from the node record.
    let promptText = prompt?.trim();
    if (!promptText) { try { promptText = await composePromptText(); } catch { /* fall through to fallback */ } }
    if (!promptText) promptText = fallbackPortrait(subject, houseLook);

    const dataUrls = await generateImages({ prompt: promptText, refImages: refUrls, model: imageModel }, count);
    const svc = serviceClient();
    const urls = await Promise.all(
      dataUrls.map((d, i) => uploadDataUrl(svc, "scene-images", `portraits/node/${nodeId}-${Date.now()}-${i}.png`, d)),
    );
    return json({ urls });
  } catch (e) {
    console.error("generate-dna-character-portrait error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});
