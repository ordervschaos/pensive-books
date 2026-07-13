// read-shape — the "shape read": the paid, semantic ceiling of vertical fit (doc_1783113903000_shape_read_spec.md).
//
// Stateless prompt→JSON Claude call (like read-meters, the client owns the tree): given the premise's promised
// MOVEMENTS and the acts' PLAN (goal/turning_point + beat summaries), judge for each movement which act(s) carry
// it (an INFERRED mapping — acts hold no movement ref) and how faithfully their content delivers it. The client
// writes the verdict onto the premise node (observed_shape_fit) sealed by the input hash, and the pure engine's
// movement_unfit lint reads it. PLAN plane only — no prose is read (that is the meter read's job).
//
//   client → POST { bookId, movements:[..], endingFeel?, acts:[{actId,title,goal,turningPoint,beats:[{beatId,summary}]}] }
//          → one Claude call → { fits: [{ movement, actIds, fit, worst?, note? }] }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { callLLM, textFromLLM, type CallMeta } from "../_shared/llm.ts";
import { getActiveModels } from "../_shared/model-config.ts";
import { extractJsonBlock } from "../_shared/json.ts";

interface ReadAct { actId: string; title?: string; goal?: string; turningPoint?: string; beats?: { beatId: string; summary?: string }[] }

const MAX_NOTE_CHARS = 200; // the verdict is a diagnosis, not an essay

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const userClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { bookId, movements, endingFeel, acts } = (await req.json().catch(() => ({}))) as {
      bookId?: number; movements?: string[]; endingFeel?: string; acts?: ReadAct[];
    };
    if (!bookId || !Array.isArray(movements) || !Array.isArray(acts)) {
      return json({ error: "bookId, movements[], and acts[] are required" }, 400);
    }
    if (!movements.length || !acts.some((a) => a.beats?.length)) return json({ fits: [] }); // nothing to read yet


    // Access check: the same surface as editing the book (RLS lets the caller read it).
    const { data: book } = await userClient.from("books").select("id").eq("id", bookId).maybeSingle();
    if (!book) return json({ error: "Book not found or access denied" }, 403);

    const movementMenu = movements.map((m, i) => `${i}. ${m}`).join("\n");
    const actMenu = acts.map((a) => {
      const beats = (a.beats ?? []).map((b) => `    · [beat=${b.beatId}] ${b.summary ?? ""}`).join("\n");
      return `[act=${a.actId}]${a.title ? ` "${a.title}"` : ""}` +
        `${a.goal ? `\n    goal: ${a.goal}` : ""}${a.turningPoint ? `\n    turning point: ${a.turningPoint}` : ""}` +
        `${beats ? `\n${beats}` : ""}`;
    }).join("\n\n");

    const { high: model } = await getActiveModels();
    const meta: CallMeta = { fn: "read-shape", bookId, taskTable: "book_nodes", taskId: bookId };
    const data = await callLLM({
      model,
      max_tokens: 1500,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system: [{
        type: "text",
        text:
          "You are a structural editor. The premise promises the story moves through these MOVEMENTS, in order. " +
          "The acts below are the story's actual plan at the next zoom. For each movement, judge which act(s) carry " +
          "it (actIds, in reading order, possibly empty when no act carries it) and how faithfully their content " +
          "delivers that movement (fit 0=absent … 5=fully delivered). Judge the PLAN TEXT on the page, not what a " +
          "good version would say. `worst` = the single act or beat most responsible for a low score. Be calibrated: " +
          "do not flatter the outline.",
      }],
      messages: [{
        role: "user",
        content:
          `MOVEMENTS (the promise, in order — reference each by its number):\n${movementMenu}\n\n` +
          (endingFeel ? `ENDING FEEL (context only): ${endingFeel}\n\n` : "") +
          `ACTS (the plan; each act's goal, turning point, and beat summaries):\n${actMenu}\n\n` +
          `Output ONLY this JSON (no prose, no fences):\n` +
          `{ "fits": [ { "movement": <a movement number above>, "actIds": ["<act= id>", ...], "fit": <0..5>, "worst": "<an act= or beat= id>", "note": "<one line, ≤200 chars>" } ] }`,
      }],
    }, meta, { signal: AbortSignal.timeout(140_000) });

    const text = textFromLLM(data).trim();
    const parsed = JSON.parse(extractJsonBlock(text)) as { fits?: unknown };

    // Rails (same class as read-meters): every id must come from the ids sent; drop what doesn't resolve
    // (fail-closed per row); fit clamped 0–5; movement must index into the movements sent.
    const actIds = new Set(acts.map((a) => a.actId));
    const beatIds = new Set(acts.flatMap((a) => (a.beats ?? []).map((b) => b.beatId)));
    const fits = (Array.isArray(parsed.fits) ? parsed.fits : [])
      .map((r) => (r ?? {}) as Record<string, unknown>)
      .filter((r) => typeof r.movement === "number" && r.movement >= 0 && r.movement < movements.length && typeof r.fit === "number")
      .map((r) => {
        const carried = (Array.isArray(r.actIds) ? r.actIds : []).filter((id): id is string => typeof id === "string" && actIds.has(id));
        const worst = typeof r.worst === "string" && (actIds.has(r.worst) || beatIds.has(r.worst)) ? r.worst : undefined;
        const note = typeof r.note === "string" ? r.note.slice(0, MAX_NOTE_CHARS) : undefined;
        return { movement: r.movement as number, actIds: carried, fit: Math.max(0, Math.min(5, r.fit as number)), worst, note };
      });

    return json({ fits });
  } catch (e) {
    console.error("read-shape error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});
