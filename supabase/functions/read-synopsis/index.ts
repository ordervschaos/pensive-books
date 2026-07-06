// read-synopsis — the "synopsis read": the shift-left quality judge (W2, doc_1783192600000_dna_build_plan.md).
//
// Stateless prompt→JSON call (like read-shape, the client owns the tree): given the WHOLE PLAN at synopsis
// resolution (premise promise + pillar thesis + acts with beat summaries/connectors/polarities — zero prose),
// a calibrated acquisitions editor scores fixed craft axes 1–5. The client writes the verdict onto the PILLAR
// node (observed_craft) sealed by the input hash, and the pure engine's craft_flag lint reads it. This is the
// cheapest place to catch a boring book — before any prose is paid for. The brief (genre/audience/tone) is
// loaded HERE (not sent by the client) because the genre_feel axis judges the plan AGAINST the brief's promise.
//
//   client → POST { bookId, input: <buildSynopsisReadInput output> }
//          → one call → { craft: [{ axis, score, note?, worst? }] }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { callLLM, textFromLLM, type CallMeta } from "../_shared/llm.ts";
import { getActiveModels } from "../_shared/model-config.ts";
import { extractJsonBlock } from "../_shared/json.ts";
import { briefContext, type Brief } from "../_shared/brief.ts";

interface ReadBeat { beatId: string; summary?: string; connector?: string; polarity?: string }
interface ReadAct {
  actId: string; title?: string; goal?: string; turningPoint?: string;
  value?: { name?: string; from?: string; to?: string; polarity?: string };
  beats?: ReadBeat[];
}
interface SynopsisInput {
  premise?: { dramaticQuestion?: string; shapeName?: string; movements?: string[]; endingFeel?: string };
  pillar?: { controllingIdea?: string; ending?: string };
  acts?: ReadAct[];
}

const MAX_NOTE_CHARS = 200; // the verdict is a diagnosis, not an essay

// The FIXED axis menu — the engine's craft_flag lint fires per axis; unknown axes from the model are dropped.
const AXES: [string, string][] = [
  ["boredom_risk", "5 = gripping at every turn, 1 = dull / episodic / slack"],
  ["predictability", "5 = surprising yet inevitable, 1 = telegraphed / formulaic"],
  ["genre_feel", "5 = delivers exactly what the brief's genre promises, 1 = generic / off-genre"],
  ["stakes_clarity", "5 = stakes concrete and escalating, 1 = vague or static stakes"],
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const userClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { bookId, input } = (await req.json().catch(() => ({}))) as { bookId?: number; input?: SynopsisInput };
    if (!bookId || !input || !Array.isArray(input.acts)) {
      return json({ error: "bookId and input (with acts[]) are required" }, 400);
    }
    const acts = input.acts;
    if (!acts.some((a) => a.beats?.length)) return json({ craft: [] }); // nothing to read yet

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    // Access check + brief load in one query: RLS lets the caller read the book, and the brief carries the
    // genre/audience/tone promise the genre_feel axis judges against.
    const { data: book } = await userClient.from("books").select("id, brief").eq("id", bookId).maybeSingle();
    if (!book) return json({ error: "Book not found or access denied" }, 403);
    const brief = (book.brief ?? null) as Brief | null;

    const premiseLines = [
      input.premise?.dramaticQuestion ? `dramatic question: ${input.premise.dramaticQuestion}` : "",
      input.premise?.shapeName ? `shape: ${input.premise.shapeName}` : "",
      (input.premise?.movements ?? []).length ? `movements: ${(input.premise!.movements!).join(" → ")}` : "",
      input.premise?.endingFeel ? `ending feel: ${input.premise.endingFeel}` : "",
    ].filter(Boolean).join("\n");
    const pillarLines = [
      input.pillar?.controllingIdea ? `controlling idea: ${input.pillar.controllingIdea}` : "",
      input.pillar?.ending ? `ending: ${input.pillar.ending}` : "",
    ].filter(Boolean).join("\n");
    const actMenu = acts.map((a) => {
      const v = a.value;
      const valueStr = v?.name ? `${v.name}${v.from || v.to ? ` (${v.from ?? "?"} → ${v.to ?? "?"})` : ""}${v.polarity ? ` [${v.polarity}]` : ""}` : "";
      const beats = (a.beats ?? []).map((b) =>
        `    · [beat=${b.beatId}]${b.connector ? ` (${b.connector})` : ""}${b.polarity ? ` [${b.polarity}]` : ""} ${b.summary ?? ""}`).join("\n");
      return `[act=${a.actId}]${a.title ? ` "${a.title}"` : ""}` +
        `${a.goal ? `\n    goal: ${a.goal}` : ""}${a.turningPoint ? `\n    turning point: ${a.turningPoint}` : ""}` +
        `${valueStr ? `\n    value: ${valueStr}` : ""}${beats ? `\n${beats}` : ""}`;
    }).join("\n\n");
    const axisMenu = AXES.map(([name, anchor]) => `- ${name}: ${anchor}`).join("\n");

    const { high: model } = await getActiveModels();
    const meta: CallMeta = { fn: "read-synopsis", bookId, taskTable: "book_nodes", taskId: bookId };
    const data = await callLLM(apiKey, {
      model,
      max_tokens: 2000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system: [{
        type: "text",
        text:
          "You are a sharp acquisitions editor reading a SYNOPSIS-level plan — premise, pillar, acts, and beat " +
          "summaries; no prose exists yet. Score the plan on EXACTLY the axes listed, 1–5 each, with a one-line " +
          "note per axis. Judge the PLAN TEXT on the page, not what a good version would say. When an axis scores " +
          "below 4, `worst` = the single beat (its beat= id) most responsible. Be calibrated: do not flatter the " +
          "outline — a serviceable-but-unremarkable plan scores 3.",
      }],
      messages: [{
        role: "user",
        content:
          `BRIEF (the promise this book is bought on — genre_feel judges against it):\n${briefContext(brief)}\n\n` +
          (premiseLines ? `PREMISE:\n${premiseLines}\n\n` : "") +
          (pillarLines ? `PILLAR:\n${pillarLines}\n\n` : "") +
          `ACTS (the plan; each act's goal, turning point, value, and beats in reading order):\n${actMenu}\n\n` +
          `AXES (score each, 1–5):\n${axisMenu}\n\n` +
          `Output ONLY this JSON (no prose, no fences):\n` +
          `{ "craft": [ { "axis": "<an axis name above>", "score": <1..5>, "note": "<one line, ≤200 chars>", "worst": "<a beat= id, when score < 4>" } ] }`,
      }],
    }, meta, { signal: AbortSignal.timeout(140_000) });

    const text = textFromLLM(data).trim();
    const parsed = JSON.parse(extractJsonBlock(text)) as { craft?: unknown };

    // Rails (same class as read-shape): axis must come from the fixed menu (one row per axis, first wins);
    // score clamped 1–5; `worst` must be a beatId from the input sent — drop what doesn't resolve.
    const axisNames = new Set(AXES.map(([name]) => name));
    const beatIds = new Set(acts.flatMap((a) => (a.beats ?? []).map((b) => b.beatId)));
    const seen = new Set<string>();
    const craft = (Array.isArray(parsed.craft) ? parsed.craft : [])
      .map((r) => (r ?? {}) as Record<string, unknown>)
      .filter((r) => typeof r.axis === "string" && axisNames.has(r.axis) && typeof r.score === "number")
      .filter((r) => !seen.has(r.axis as string) && seen.add(r.axis as string))
      .map((r) => {
        const worst = typeof r.worst === "string" && beatIds.has(r.worst) ? r.worst : undefined;
        const note = typeof r.note === "string" ? r.note.slice(0, MAX_NOTE_CHARS) : undefined;
        return { axis: r.axis as string, score: Math.max(1, Math.min(5, Math.round(r.score as number))), note, worst };
      });

    return json({ craft });
  } catch (e) {
    console.error("read-synopsis error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});
