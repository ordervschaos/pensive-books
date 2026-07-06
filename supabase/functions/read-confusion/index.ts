// read-confusion — the cold-reader confusion pass of the verify loop (W5, doc_1783192600000).
//
// An LLM judge simulating a FIRST-TIME reader: for each chapter it sees ONLY what a reader has by then
// (the client-built recap of prior pages + this chapter's prose, in order) and flags what it couldn't
// follow. The judge's context is capped at the reader's knowledge horizon on purpose — it never sees
// beats/threads/character sheets, because confusion is only detectable without the author's map.
// Stateless (like read-meters / read-facts): the client owns the tree, assembles the chapters, and
// writes the flags onto the scene nodes as `confusion_flags` (the engine's reader_confusion lint reads them).
//
//   client → POST { bookId, chapters:[{chapterIndex,priorContext,scenes:[{sceneId,prose}]}] }
//          → one Claude call over as many chapters as fit → { flags:[{sceneId,kind,note}], truncated, chaptersRead }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { callLLM, textFromLLM, type CallMeta } from "../_shared/llm.ts";
import { getActiveModels } from "../_shared/model-config.ts";
import { extractJsonBlock } from "../_shared/json.ts";

interface ReadScene { sceneId: string; prose: string }
interface ReadChapter { chapterIndex: number; priorContext?: string; scenes?: ReadScene[] }
type ConfusionKind = "who" | "where" | "when" | "why" | "reference";
const KINDS = new Set<string>(["who", "where", "when", "why", "reference"]);

const MAX_PROSE_CHARS = 6000;  // per-scene cap (defensive — the client caps too)
const MAX_PRIOR_CHARS = 3000;  // per-chapter reader-recap cap
const MAX_TOTAL_CHARS = 80_000; // one call's budget; chapters past it are deferred (truncated: true)
const MAX_FLAGS_PER_SCENE = 5;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const userClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { bookId, chapters } = (await req.json().catch(() => ({}))) as { bookId?: number; chapters?: ReadChapter[] };
    if (!bookId || !Array.isArray(chapters)) return json({ error: "bookId and chapters[] are required" }, 400);
    if (!chapters.length) return json({ flags: [], truncated: false, chaptersRead: 0 }); // nothing to read yet

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    // Access check: the same surface as editing the book (RLS lets the caller read it).
    const { data: book } = await userClient.from("books").select("id").eq("id", bookId).maybeSingle();
    if (!book) return json({ error: "Book not found or access denied" }, 403);

    // Batch the chapters into ONE judge call (the read-meters shape), consuming them IN ORDER until the
    // budget is hit — a partially-read long book returns truncated:true and the client re-runs later.
    // The first chapter is always included so an oversized opener still makes progress.
    const blocks: string[] = [];
    const sceneIds = new Set<string>();
    let total = 0, chaptersRead = 0;
    for (const ch of chapters) {
      const scenes = (ch.scenes ?? []).filter((s) => s?.sceneId && typeof s.prose === "string" && s.prose.trim());
      const prior = String(ch.priorContext ?? "").slice(0, MAX_PRIOR_CHARS).trim();
      const block =
        `=== CHAPTER ${(ch.chapterIndex ?? chaptersRead) + 1} ===\n` +
        `WHAT YOU KNOW SO FAR: ${prior || "(nothing — the book opens here)"}\n\n` +
        scenes.map((s) => `[scene=${s.sceneId}]\n${s.prose.slice(0, MAX_PROSE_CHARS)}`).join("\n\n");
      if (blocks.length && total + block.length > MAX_TOTAL_CHARS) break;
      blocks.push(block); total += block.length; chaptersRead++;
      for (const s of scenes) sceneIds.add(s.sceneId);
    }
    const truncated = chaptersRead < chapters.length;
    if (!sceneIds.size) return json({ flags: [], truncated, chaptersRead });

    const { high: model } = await getActiveModels();
    const meta: CallMeta = { fn: "read-confusion", bookId, taskTable: "book_nodes", taskId: bookId };
    const data = await callLLM(apiKey, {
      model,
      max_tokens: 3000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system: [{
        type: "text",
        text:
          "You are a first-time reader with NO access to the author's notes, outline, or character sheets. " +
          "You know ONLY the PRIOR CONTEXT recap and what you read here, in order. For each scene, flag only " +
          "GENUINE confusion — a moment where a reader who knows only this much loses the thread: who someone " +
          "is (who), where the scene takes place (where), when it happens or how much time has passed (when), " +
          "why a character acts or why events follow (why), or a callback to something never shown (reference). " +
          "Each note is ONE concrete line quoting the confusing bit. Deliberate mystery the text clearly frames " +
          "as a question to be answered later is NOT confusion. Skip scenes that read fine — most should.",
      }],
      messages: [{
        role: "user",
        content:
          `THE BOOK SO FAR, chapter by chapter (each with what you, the reader, know going in):\n\n` +
          `${blocks.join("\n\n")}\n\n` +
          `Output ONLY this JSON (no prose, no fences):\n` +
          `{ "flags": [ { "sceneId": "<a scene= id above>", "kind": "who|where|when|why|reference", "note": "<one line quoting the confusing bit>" } ] }`,
      }],
    }, meta, { signal: AbortSignal.timeout(140_000) });

    const parsed = JSON.parse(extractJsonBlock(textFromLLM(data).trim())) as { flags?: unknown };
    const perScene = new Map<string, number>();
    const flags = (Array.isArray(parsed.flags) ? parsed.flags : [])
      .filter((f): f is { sceneId: string; kind: ConfusionKind; note: string } =>
        !!f && typeof (f as Record<string, unknown>).sceneId === "string" && sceneIds.has((f as { sceneId: string }).sceneId) &&
        KINDS.has(String((f as Record<string, unknown>).kind)) &&
        typeof (f as Record<string, unknown>).note === "string" && !!(f as { note: string }).note.trim())
      .filter((f) => {
        const n = (perScene.get(f.sceneId) ?? 0) + 1;
        perScene.set(f.sceneId, n);
        return n <= MAX_FLAGS_PER_SCENE;
      })
      .map((f) => ({ sceneId: f.sceneId, kind: f.kind, note: f.note.trim() }));

    return json({ flags, truncated, chaptersRead });
  } catch (e) {
    console.error("read-confusion error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});
