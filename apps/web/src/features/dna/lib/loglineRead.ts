// loglineRead — the client half of the "brief read" (read-logline): does the LOGLINE still honor the BRIEF
// it was forged from? Cloned from synopsisRead: LLM as SENSOR (one call → a structured verdict written onto
// the tree), pure function as JUDGE (the brief_fit_flag lint reads the verdict; the floor lives in the
// engine). Distinct from the deterministic logline_overlong/logline_static lints — those check prose
// mechanics, this checks fidelity to the brief's idea/genre/tone/stakes.
//
// The tree is the single source of truth, so (like the other reads) the CLIENT assembles the read's input
// and writes its output back; the edge fn / bridge is a stateless prompt→JSON call. The verdict lands on the
// SEED node (the level that owns the logline), sealed by a hash of the exact input sent.
import { supabase } from "@/integrations/supabase/client";
import { BRIDGE, bridgeFetch } from "@/lib/bridge";
import { sendAgentMessage } from "@/features/dna/lib/agentThread";
import {
  analysisText, buildBriefFitInput, briefFitHash, validate,
  type BookSettings, type BriefFitInput, type DnaNode, type SeedContent,
} from "@/features/dna/lib/novelDna";

// The assembler + seal are shared with the engine (the lint recomputes the same hash), so we re-export rather
// than re-implement — that shared code IS what keeps the seal honest.
export { buildBriefFitInput, briefFitHash } from "@/features/dna/lib/novelDna";

/** One row of the read's verdict: a brief-fidelity axis's 1–5 score and its one-line note. */
export interface BriefFitRow { axis: string; score: number; note?: string }

/** Run the read: bridge in dev (localhost:8787), edge fn in prod. Returns one row per axis. */
export async function invokeBriefRead(bookId: number, input: BriefFitInput): Promise<BriefFitRow[]> {
  if (BRIDGE) {
    const r = await bridgeFetch("/read-logline", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookId, input }),
    });
    if (!r.ok) throw new Error(`read-logline bridge ${r.status}: ${await r.text()}`);
    return ((await r.json())?.brief_fit ?? []) as BriefFitRow[];
  }
  const { data, error } = await supabase.functions.invoke("read-logline", { body: { bookId, input } });
  if (error) throw error;
  return (data?.brief_fit ?? []) as BriefFitRow[];
}

/** Write the verdict back onto the SEED node (a targeted patch touching only observed_brief_fit +
 *  observed_brief_fit_hash — the logline itself is never touched). The hash seals the verdict against the
 *  exact input that produced it; editing the logline flips the seal → the lint goes stale. */
export async function writeBriefFit(nodes: DnaNode[], input: BriefFitInput, rows: BriefFitRow[]): Promise<void> {
  const seed = nodes.find((n) => n.kind === "seed");
  if (!seed) return;
  const content: SeedContent = { ...(seed.content as SeedContent), observed_brief_fit: rows, observed_brief_fit_hash: briefFitHash(input) };
  const { error } = await supabase.from("book_nodes").update({ content }).eq("id", seed.id);
  if (error) throw error;
}

/** The read's findings as an instruction for the editor agent — built from the engine's own brief_fit_flag
 *  lints (no duplicated thresholds; the lint already gates on a fresh seal). Returns null when every axis clears. */
export function briefFitFindingsMessage(nodes: DnaNode[]): string | null {
  const flags = validate(nodes).filter((i) => i.rule === "brief_fit_flag");
  if (!flags.length) return null;
  return [
    "I ran the brief read on the logline. These axes score under the floor:",
    ...flags.map((g) => `- ${g.message}`),
    "Revise the logline so it still honors the brief on these axes.",
  ].join("\n");
}

/** Hand the read's findings to the editor agent (the existing book-agent thread) — the manual taste gate; the
 *  AgentRail on the tree page renders the run via Realtime. Returns false when the logline clears every axis. */
export async function sendBriefFitFindingsToEditor(bookId: number, nodes: DnaNode[], settings: BookSettings): Promise<boolean> {
  const message = briefFitFindingsMessage(nodes);
  if (!message) return false;
  await sendAgentMessage(bookId, message, analysisText(nodes, settings));
  return true;
}
