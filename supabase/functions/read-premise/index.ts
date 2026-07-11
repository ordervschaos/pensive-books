// read-premise — the "premise read": does the PREMISE still honor the LOGLINE it was derived from? Cloned
// from read-synopsis's shape (stateless prompt→JSON, client owns the tree). The client writes the verdict
// onto the PREMISE node (observed_logline_fit), sealed by the input hash; the pure engine's
// logline_fit_flag lint reads it. Grounded in PREMISE_CRAFT (the shape/dramatic-question anatomy) and
// PREMISE_JUDGE_CRITERIA (craft-kb.ts) — the SAME five criteria dna-expand's premise generator already
// silently self-scores against before answering (then discards); this read is where those scores finally
// surface. One axis is genuinely new: logline_fixity — dnaJourney.ts's premise-stage instructions require
// every option to honor the accepted logline's protagonist/inciting/goal/obstacle/stakes as FIXED, varying
// only the dramatic question and the shape's internal arc; nothing else checks that today.
//
//   client → POST { bookId, input: <buildLoglineFitInput output> }
//          → one call → { premise_fit: [{ axis, score, note? }] }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { callLLM, textFromLLM, type CallMeta } from "../_shared/llm.ts";
import { getActiveModels } from "../_shared/model-config.ts";
import { extractJsonBlock } from "../_shared/json.ts";
import { briefContext, type Brief } from "../_shared/brief.ts";
import { PREMISE_CRAFT, PREMISE_JUDGE_CRITERIA } from "../_shared/craft-kb.ts";

interface LoglineFitInput {
  logline?: string;
  premise?: { dramaticQuestion?: string; shapeName?: string; movements?: string[]; endingFeel?: string };
}

const MAX_NOTE_CHARS = 200; // the verdict is a diagnosis, not an essay

// The FIXED axis menu: 5 from the shared premise-judge criteria, plus brief_fidelity and the genuinely new
// logline_fixity axis. The engine's logline_fit_flag lint fires per axis; unknown axes are dropped.
const CRITERIA_AXES: [string, string][] = PREMISE_JUDGE_CRITERIA.map((c) => [c.key, c.desc]);
const AXES: [string, string][] = [
  ...CRITERIA_AXES,
  ["brief_fidelity", "5 = genre/tone/heat/ending_feel all still consistent with the brief, 1 = drifted"],
  ["logline_fixity", "5 = the premise leaves the logline's protagonist/inciting incident/goal/obstacle/stakes untouched, varying only the dramatic question and the shape's internal arc; 1 = it silently swapped one of the five"],
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const userClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { bookId, input } = (await req.json().catch(() => ({}))) as { bookId?: number; input?: LoglineFitInput };
    const logline = (input?.logline ?? "").trim();
    const dramaticQuestion = (input?.premise?.dramaticQuestion ?? "").trim();
    if (!bookId || !logline || !dramaticQuestion) {
      return json({ error: "bookId, input.logline and input.premise.dramaticQuestion are required" }, 400);
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    // Access check + brief load in one query: RLS lets the caller read the book, and the brief carries the
    // genre/tone/heat the brief_fidelity axis judges against.
    const { data: book } = await userClient.from("books").select("id, brief").eq("id", bookId).maybeSingle();
    if (!book) return json({ error: "Book not found or access denied" }, 403);
    const brief = (book.brief ?? null) as Brief | null;

    const movements = (input?.premise?.movements ?? []).filter(Boolean);
    const premiseLines = [
      `dramatic question: ${dramaticQuestion}`,
      input?.premise?.shapeName ? `shape: ${input.premise.shapeName}` : "",
      movements.length ? `movements: ${movements.join(" → ")}` : "",
      input?.premise?.endingFeel ? `ending feel: ${input.premise.endingFeel}` : "",
    ].filter(Boolean).join("\n");
    const axisMenu = AXES.map(([name, anchor]) => `- ${name}: ${anchor}`).join("\n");

    const { high: model } = await getActiveModels();
    const meta: CallMeta = { fn: "read-premise", bookId, taskTable: "book_nodes", taskId: bookId };
    const data = await callLLM(apiKey, {
      model,
      max_tokens: 3000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system: [{
        type: "text",
        text:
          "You are a ruthless development editor comparing a PREMISE against the LOGLINE it was derived " +
          "from and the BRIEF behind that. This is what a good premise looks like:\n\n" + PREMISE_CRAFT + "\n\n" +
          "Score the premise on EXACTLY the axes listed, 1–5 each, with a one-line note per axis. Judge the " +
          "PREMISE TEXT on the page against the LOGLINE and BRIEF TEXT on the page, not what a good version " +
          "would say. Do not be polite — a premise that would produce a readable but forgettable book should " +
          "score low. Be calibrated: a serviceable-but-unremarkable premise scores 3.",
      }],
      messages: [{
        role: "user",
        content:
          `BRIEF:\n${briefContext(brief)}\n\n` +
          `LOGLINE (protagonist · inciting incident · goal · obstacle · stakes — FIXED unless an axis below says otherwise):\n${logline}\n\n` +
          `PREMISE:\n${premiseLines}\n\n` +
          `AXES (score each, 1–5):\n${axisMenu}\n\n` +
          `Output ONLY this JSON (no prose, no fences):\n` +
          `{ "premise_fit": [ { "axis": "<an axis name above>", "score": <1..5>, "note": "<one line, ≤200 chars>" } ] }`,
      }],
    }, meta, { signal: AbortSignal.timeout(140_000) });

    const text = textFromLLM(data).trim();
    const parsed = JSON.parse(extractJsonBlock(text)) as { premise_fit?: unknown };

    // Rails (same class as read-synopsis): axis must come from the fixed menu (one row per axis, first
    // wins); score clamped 1–5.
    const axisNames = new Set(AXES.map(([name]) => name));
    const seen = new Set<string>();
    const premiseFit = (Array.isArray(parsed.premise_fit) ? parsed.premise_fit : [])
      .map((r) => (r ?? {}) as Record<string, unknown>)
      .filter((r) => typeof r.axis === "string" && axisNames.has(r.axis) && typeof r.score === "number")
      .filter((r) => !seen.has(r.axis as string) && seen.add(r.axis as string))
      .map((r) => {
        const note = typeof r.note === "string" ? r.note.slice(0, MAX_NOTE_CHARS) : undefined;
        return { axis: r.axis as string, score: Math.max(1, Math.min(5, Math.round(r.score as number))), note };
      });

    return json({ premise_fit: premiseFit });
  } catch (e) {
    console.error("read-premise error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});
