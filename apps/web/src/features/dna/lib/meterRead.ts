// meterRead — the client half of the "editor's read" verify loop (docs/true-agent.md, Step 2).
//
// The meters page already holds the whole DNA tree, so (like dna-chat) the CLIENT assembles the read's
// input and applies its output; the edge fn / bridge is a stateless prompt→JSON Claude call. The read is
// keyed to BEATS (not pages): each beat's scenes' prose is rated against every meter, producing an OBSERVED
// reading per beat. We write those onto the beat nodes as `observed_readings` (parallel to the authored
// `readings`) — the tree stays the single source of truth, and observedSeries/observedGap derive the 3rd
// trace + the read_gap lint from it. The author reviews the gaps, then hands them to the editor agent.
import { supabase } from "@/integrations/supabase/client";
import { invokeFn } from "@/lib/localFn";
import { sendAgentMessage } from "@/features/dna/lib/agentThread";
import {
  analysisText, beatsInOrder, byId, childrenOf, validate,
  type BeatContent, type BookSettings, type DnaNode, type MeterContent, type SceneContent,
} from "@/features/dna/lib/novelDna";

export interface MeterDef { id: string; name: string; kind?: string; low?: string; high?: string; min?: number; max?: number }
export interface MeterReadBeat { beatId: string; summary: string; prose: string }
export interface MeterReadInput { beats: MeterReadBeat[]; meters: MeterDef[] }
export interface ObservedReading { beatId: string; meterId: string; value: number }

/** Assemble the read input from the live tree: every meter's definition + every beat that HAS prose (its
 *  scenes' prose concatenated). Beats without prose can't be read and are omitted (they stay a gap). */
export function buildMeterReadInput(nodes: DnaNode[]): MeterReadInput {
  const meters: MeterDef[] = nodes.filter((n) => n.kind === "meter").map((m) => {
    const c = m.content as MeterContent;
    return { id: m.id, name: c.name ?? m.id, kind: c.kind, low: c.poles?.low, high: c.poles?.high, min: c.scale?.min, max: c.scale?.max };
  });
  const beats: MeterReadBeat[] = beatsInOrder(nodes).map((b) => {
    const prose = childrenOf(nodes, b.id)
      .filter((s) => s.kind === "scene")
      .map((s) => (s.content as SceneContent).prose?.text?.trim())
      .filter((t): t is string => !!t)
      .join("\n\n");
    return { beatId: b.id, summary: String((b.content as BeatContent).summary ?? ""), prose };
  }).filter((b) => b.prose);
  return { beats, meters };
}

/** Run the read: locally-served fn (VITE_LOCAL_FUNCTIONS_URL) or deployed edge fn. Returns one reading per (beat, meter). */
export async function invokeMeterRead(bookId: number, input: MeterReadInput): Promise<ObservedReading[]> {
  const { data, error } = await invokeFn<{ readings?: ObservedReading[] }>("read-meters", { body: { bookId, ...input } });
  if (error) throw error;
  return data?.readings ?? [];
}

/** Write the observed readings back onto the beat nodes (a targeted patch touching ONLY observed_readings —
 *  the authored `readings` plan is never clobbered). Re-runs overwrite the field; the tree's Realtime
 *  subscription paints the new dotted line. */
export async function writeObserved(nodes: DnaNode[], readings: ObservedReading[]): Promise<void> {
  const byBeat = new Map<string, { ref: string; value: number }[]>();
  for (const r of readings) {
    if (typeof r.value !== "number" || !r.beatId || !r.meterId) continue;
    (byBeat.get(r.beatId) ?? byBeat.set(r.beatId, []).get(r.beatId)!).push({ ref: r.meterId, value: r.value });
  }
  const index = byId(nodes);
  await Promise.all([...byBeat].map(async ([beatId, observed_readings]) => {
    const beat = index.get(beatId);
    if (!beat || beat.kind !== "beat") return;
    const content = { ...beat.content, observed_readings };
    const { error } = await supabase.from("book_nodes").update({ content }).eq("id", beatId);
    if (error) throw error;
  }));
}

/** The read's findings as an instruction for the editor agent — built from the engine's own read_gap lints
 *  (no duplicated thresholds). Returns null when the prose is on-plan everywhere (nothing to hand off). */
export function observedFindingsMessage(nodes: DnaNode[]): string | null {
  const gaps = validate(nodes).filter((i) => i.rule === "read_gap");
  if (!gaps.length) return null;
  return [
    "I ran the emotional-trace read. The prose departs from the planned meter levels here:",
    ...gaps.map((g) => `- ${g.message}`),
    "Investigate the named beats and propose revisions that bring the prose to the planned levels.",
  ].join("\n");
}

/** Hand the read's findings to the editor agent (the existing book-agent thread). The author triggers this
 *  (the manual taste gate); the AgentRail on the tree page renders the run via Realtime. */
export async function sendFindingsToEditor(bookId: number, nodes: DnaNode[], settings: BookSettings): Promise<boolean> {
  const message = observedFindingsMessage(nodes);
  if (!message) return false;
  await sendAgentMessage(bookId, message, analysisText(nodes, settings));
  return true;
}
