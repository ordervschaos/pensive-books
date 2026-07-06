// read-meters — the "editor's read" that produces the OBSERVED meter trace (docs/true-agent.md, Step 2).
//
// Stateless prompt→JSON Claude call (like dna-chat, the client owns the tree): given a BEAT-segmented
// manuscript (each beat = its scenes' prose) and the book's meter definitions, rate where the PROSE sits on
// each meter's scale at each beat. The client writes the result onto the beat nodes as `observed_readings`,
// and the pure engine diffs it against the planned `readings` (observedGap / read_gap). Beat-keyed so it's
// directly comparable to the plan — unlike the page-segmented evaluate-book rubric read.
//
//   client → POST { bookId, beats:[{beatId,summary,prose}], meters:[{id,name,kind,low,high,min,max}] }
//          → one Claude call → { readings: [{ beatId, meterId, value }] }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { callLLM, textFromLLM, type CallMeta } from "../_shared/llm.ts";
import { getActiveModels } from "../_shared/model-config.ts";
import { extractJsonBlock } from "../_shared/json.ts";

interface MeterDef { id: string; name: string; kind?: string; low?: string; high?: string; min?: number; max?: number }
interface ReadBeat { beatId: string; summary?: string; prose: string }

const MAX_PROSE_CHARS = 4000; // per-beat cap so a long book stays inside one call's budget

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const userClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { bookId, beats, meters } = (await req.json().catch(() => ({}))) as {
      bookId?: number; beats?: ReadBeat[]; meters?: MeterDef[];
    };
    if (!bookId || !Array.isArray(beats) || !Array.isArray(meters)) {
      return json({ error: "bookId, beats[], and meters[] are required" }, 400);
    }
    if (!beats.length || !meters.length) return json({ readings: [] }); // nothing to read yet

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    // Access check: the same surface as editing the book (RLS lets the caller read it).
    const { data: book } = await userClient.from("books").select("id").eq("id", bookId).maybeSingle();
    if (!book) return json({ error: "Book not found or access denied" }, 403);

    const meterMenu = meters.map((m) => {
      const range = typeof m.min === "number" && typeof m.max === "number" ? ` [${m.min}…${m.max}]` : "";
      const poles = m.low || m.high ? ` (low=${m.low ?? "?"}, high=${m.high ?? "?"})` : "";
      return `- ${m.id} · "${m.name}"${m.kind ? ` ${m.kind}` : ""}${range}${poles}`;
    }).join("\n");

    const manuscript = beats.map((b, i) =>
      `\n[beat=${b.beatId} · #${i + 1}${b.summary ? ` · "${b.summary}"` : ""}]\n${String(b.prose).slice(0, MAX_PROSE_CHARS)}`
    ).join("\n");

    const { high: model } = await getActiveModels();
    const meta: CallMeta = { fn: "read-meters", bookId, taskTable: "book_nodes", taskId: bookId };
    const data = await callLLM(apiKey, {
      model,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system: [{
        type: "text",
        text:
          "You are an editor reading a manuscript to MEASURE what the prose actually delivers, beat by beat. " +
          "For each beat, rate where its PROSE sits on each meter's scale — read the words on the page, not the " +
          "author's intent. Use the meter's own scale; if no numeric scale is given, use 0–100. Skip a (beat, " +
          "meter) pair you genuinely cannot judge from the prose. Be calibrated: do not flatter the text.",
      }],
      messages: [{
        role: "user",
        content:
          `METERS (the axes to rate):\n${meterMenu}\n\n` +
          `MANUSCRIPT (beat-segmented; rate each beat by its prose):\n${manuscript}\n\n` +
          `Output ONLY this JSON (no prose, no fences):\n` +
          `{ "readings": [ { "beatId": "<a beat= id above>", "meterId": "<a meter id above>", "value": <number on that meter's scale> } ] }`,
      }],
    }, meta, { signal: AbortSignal.timeout(140_000) });

    const text = textFromLLM(data).trim();
    const parsed = JSON.parse(extractJsonBlock(text)) as { readings?: unknown };
    const beatIds = new Set(beats.map((b) => b.beatId));
    const meterIds = new Set(meters.map((m) => m.id));
    const readings = (Array.isArray(parsed.readings) ? parsed.readings : [])
      .filter((r): r is { beatId: string; meterId: string; value: number } =>
        !!r && typeof (r as Record<string, unknown>).beatId === "string" && typeof (r as Record<string, unknown>).meterId === "string" &&
        typeof (r as Record<string, unknown>).value === "number" &&
        beatIds.has((r as { beatId: string }).beatId) && meterIds.has((r as { meterId: string }).meterId));

    return json({ readings });
  } catch (e) {
    console.error("read-meters error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});
