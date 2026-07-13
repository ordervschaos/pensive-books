// synopsisRead — the client half of the "synopsis read": the shift-left quality judge (W2,
// doc_1783192600000_dna_build_plan.md). Cloned from shapeRead: an acquisitions editor scores the PLAN at
// synopsis resolution (premise + pillar + acts + beats, zero prose) on fixed craft axes — LLM as SENSOR (one
// call → a structured verdict written onto the tree), pure function as JUDGE (the craft_flag lint reads the
// verdict; the floor lives in the engine). This is the cheapest place to catch a boring book — before any
// prose is paid for.
//
// The tree is the single source of truth, so (like the shape read) the CLIENT assembles the read's input and
// writes its output back; the edge fn / bridge is a stateless prompt→JSON call. The verdict lands on the
// PILLAR node (the level that owns the whole plan), sealed by a hash of the exact input sent — the lint
// recomputes that hash off the live tree to tell a fresh verdict from a stale one.
import { supabase } from "@/integrations/supabase/client";
import { invokeFn } from "@/lib/localFn";
import { sendAgentMessage } from "@/features/dna/lib/agentThread";
import {
  analysisText, buildSynopsisReadInput, synopsisReadHash, validate,
  type BookSettings, type DnaNode, type PillarContent, type SynopsisReadInput,
} from "@/features/dna/lib/novelDna";

// The assembler + seal are shared with the engine (the lint recomputes the same hash), so we re-export rather
// than re-implement — that shared code IS what keeps the seal honest.
export { buildSynopsisReadInput, synopsisReadHash } from "@/features/dna/lib/novelDna";

/** One row of the read's verdict: a craft axis's 1–5 score, its one-line note, and the beat most responsible. */
export interface CraftRow { axis: string; score: number; note?: string; worst?: string }

/** Run the read: locally-served fn (VITE_LOCAL_FUNCTIONS_URL) or deployed edge fn. Returns one row per craft axis. */
export async function invokeSynopsisRead(bookId: number, input: SynopsisReadInput): Promise<CraftRow[]> {
  const { data, error } = await invokeFn<{ craft?: CraftRow[] }>("read-synopsis", { body: { bookId, input } });
  if (error) throw error;
  return data?.craft ?? [];
}

/** Write the verdict back onto the PILLAR node (a targeted patch touching only observed_craft +
 *  observed_craft_hash — controlling_idea/ending are never clobbered). The hash seals the verdict against the
 *  exact input that produced it; a later plan edit that changes the input flips the seal → the lint goes stale. */
export async function writeCraft(nodes: DnaNode[], input: SynopsisReadInput, rows: CraftRow[]): Promise<void> {
  const pillar = nodes.find((n) => n.kind === "pillar");
  if (!pillar) return;
  const content: PillarContent = { ...(pillar.content as PillarContent), observed_craft: rows, observed_craft_hash: synopsisReadHash(input) };
  const { error } = await supabase.from("book_nodes").update({ content }).eq("id", pillar.id);
  if (error) throw error;
}

/** The read's findings as an instruction for the editor agent — built from the engine's own craft_flag lints
 *  (no duplicated thresholds; the lint already gates on a fresh seal). Returns null when every axis clears. */
export function craftFindingsMessage(nodes: DnaNode[]): string | null {
  const flags = validate(nodes).filter((i) => i.rule === "craft_flag");
  if (!flags.length) return null;
  return [
    "I ran the editor's read of the plan (the synopsis read). These craft axes score under the floor:",
    ...flags.map((g) => `- ${g.message}`),
    "Investigate the named beats and propose plan revisions that raise each flagged axis.",
  ].join("\n");
}

/** Hand the read's findings to the editor agent (the existing book-agent thread) — the manual taste gate; the
 *  AgentRail on the tree page renders the run via Realtime. Returns false when the plan clears every axis. */
export async function sendCraftFindingsToEditor(bookId: number, nodes: DnaNode[], settings: BookSettings): Promise<boolean> {
  const message = craftFindingsMessage(nodes);
  if (!message) return false;
  await sendAgentMessage(bookId, message, analysisText(nodes, settings));
  return true;
}
