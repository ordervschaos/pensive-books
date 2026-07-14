// read-logline — the "brief read": does the LOGLINE still honor the BRIEF it was forged from? Cloned from
// read-synopsis's shape (stateless prompt→JSON, client owns the tree). The client writes the verdict onto
// the SEED node (observed_brief_fit), sealed by the input hash; the pure engine's brief_fit_flag lint reads
// it. Grounded in LOGLINE_CRAFT (craft-kb.ts) — the SAME anatomy dna-expand's logline forge writes against,
// so the judge and the generator share one definition of "a good logline".
//
//   client → POST { bookId, input: <buildBriefFitInput output> }
//          → one call → { brief_fit: [{ axis, score, note? }] }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, json } from "../_shared/cors.ts";
import { userClient as createUserClient } from "../_shared/task.ts";
import { callLLM, textFromLLM, type CallMeta } from "../_shared/llm.ts";
import { getActiveModels } from "../_shared/model-config.ts";
import { extractJsonBlock } from "../_shared/json.ts";
import { briefContext, type Brief } from "../_shared/brief.ts";
import { LOGLINE_CRAFT } from "../_shared/craft-kb.ts";

interface BriefFitInput { logline?: string }

const MAX_NOTE_CHARS = 200; // the verdict is a diagnosis, not an essay

// The FIXED axis menu — the engine's brief_fit_flag lint fires per axis; unknown axes from the model are dropped.
const AXES: [string, string][] = [
  ["idea_fidelity", "5 = still the SAME story the brief's idea names, 1 = a different story invented from nothing"],
  ["genre_tone_fit", "5 = honors the brief's genre/tone/heat mandate, 1 = drifts off-genre or off-tone"],
  ["originality_honored", "5 = the brief's most distinctive element survives explicitly, 1 = sanded down to generic"],
  ["stakes_grounded", "5 = stakes concrete and proportional to what the brief signals, 1 = invented or diluted"],
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const userClient = createUserClient(req.headers.get("Authorization") ?? "");
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { bookId, input } = (await req.json().catch(() => ({}))) as { bookId?: number; input?: BriefFitInput };
    const logline = (input?.logline ?? "").trim();
    if (!bookId || !logline) return json({ error: "bookId and input.logline are required" }, 400);


    // Access check + brief load in one query: RLS lets the caller read the book, and the brief carries the
    // idea/genre/tone/stakes the logline is judged against — loaded HERE, never sent by the client.
    const { data: book } = await userClient.from("books").select("id, brief").eq("id", bookId).maybeSingle();
    if (!book) return json({ error: "Book not found or access denied" }, 403);
    const brief = (book.brief ?? null) as Brief | null;

    const axisMenu = AXES.map(([name, anchor]) => `- ${name}: ${anchor}`).join("\n");

    const { high: model } = await getActiveModels();
    const meta: CallMeta = { fn: "read-logline", bookId, taskTable: "book_nodes", taskId: bookId };
    const data = await callLLM({
      model,
      max_tokens: 1200,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system: [{
        type: "text",
        text:
          "You are a calibrated development editor comparing a LOGLINE against the BRIEF it must honor. " +
          "This is what a good logline looks like:\n\n" + LOGLINE_CRAFT + "\n\n" +
          "Score the logline on EXACTLY the axes listed, 1–5 each, with a one-line note per axis. Judge the " +
          "LOGLINE TEXT on the page against the BRIEF TEXT on the page, not what a good version would say. " +
          "Be calibrated: do not flatter a serviceable-but-generic logline — it scores 3.",
      }],
      messages: [{
        role: "user",
        content:
          `BRIEF (the promise the logline must honor):\n${briefContext(brief)}\n\n` +
          `LOGLINE:\n${logline}\n\n` +
          `AXES (score each, 1–5):\n${axisMenu}\n\n` +
          `Output ONLY this JSON (no prose, no fences):\n` +
          `{ "brief_fit": [ { "axis": "<an axis name above>", "score": <1..5>, "note": "<one line, ≤200 chars>" } ] }`,
      }],
    }, meta, { signal: AbortSignal.timeout(140_000) });

    const text = textFromLLM(data).trim();
    const parsed = JSON.parse(extractJsonBlock(text)) as { brief_fit?: unknown };

    // Rails (same class as read-synopsis): axis must come from the fixed menu (one row per axis, first
    // wins); score clamped 1–5.
    const axisNames = new Set(AXES.map(([name]) => name));
    const seen = new Set<string>();
    const briefFit = (Array.isArray(parsed.brief_fit) ? parsed.brief_fit : [])
      .map((r) => (r ?? {}) as Record<string, unknown>)
      .filter((r) => typeof r.axis === "string" && axisNames.has(r.axis) && typeof r.score === "number")
      .filter((r) => !seen.has(r.axis as string) && seen.add(r.axis as string))
      .map((r) => {
        const note = typeof r.note === "string" ? r.note.slice(0, MAX_NOTE_CHARS) : undefined;
        return { axis: r.axis as string, score: Math.max(1, Math.min(5, Math.round(r.score as number))), note };
      });

    return json({ brief_fit: briefFit });
  } catch (e) {
    console.error("read-logline error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});
