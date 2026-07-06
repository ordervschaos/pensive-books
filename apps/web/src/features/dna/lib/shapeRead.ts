// shapeRead — the client half of the "shape read": the paid, semantic ceiling of vertical fit
// (doc_1783113903000_shape_read_spec.md). The deterministic `verticalLints` are the free floor (counts + enums);
// this pass asks whether the PLAN TEXT at level N+1 (acts + beats) actually delivers the movement text at level N
// (premise.shape). It mirrors the meter read verbatim — LLM as SENSOR (one call → a structured verdict written
// onto the tree), pure function as JUDGE (the movement_unfit lint reads the verdict; thresholds live in the engine).
//
// The tree is the single source of truth, so (like the meter read) the CLIENT assembles the read's input and
// writes its output back; the edge fn / bridge is a stateless prompt→JSON call. The verdict lands on the PREMISE
// node (the level that made the promise), sealed by a hash of the exact input sent — the lint recomputes that hash
// off the live tree to tell a fresh verdict from a stale one.
import { supabase } from "@/integrations/supabase/client";
import { BRIDGE, bridgeFetch } from "@/lib/bridge";
import { sendAgentMessage } from "@/features/dna/lib/agentThread";
import {
  analysisText, buildShapeReadInput, shapeReadHash, validate,
  type BookSettings, type DnaNode, type PremiseContent, type ShapeReadInput,
} from "@/features/dna/lib/novelDna";

// The assembler + seal are shared with the engine (the lint recomputes the same hash), so we re-export rather
// than re-implement — that shared code IS what keeps the seal honest.
export { buildShapeReadInput, shapeReadHash } from "@/features/dna/lib/novelDna";

/** One row of the read's verdict: which acts carry a movement (inferred), and how faithfully they deliver it. */
export interface ShapeFit { movement: number; actIds: string[]; fit: number; worst?: string; note?: string }

/** Run the read: bridge in dev (localhost:8787), edge fn in prod. Returns one fit row per movement. */
export async function invokeShapeRead(bookId: number, input: ShapeReadInput): Promise<ShapeFit[]> {
  if (BRIDGE) {
    const r = await bridgeFetch("/read-shape", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookId, ...input }),
    });
    if (!r.ok) throw new Error(`read-shape bridge ${r.status}: ${await r.text()}`);
    return ((await r.json())?.fits ?? []) as ShapeFit[];
  }
  const { data, error } = await supabase.functions.invoke("read-shape", { body: { bookId, ...input } });
  if (error) throw error;
  return (data?.fits ?? []) as ShapeFit[];
}

/** Write the verdict back onto the PREMISE node (a targeted patch touching only observed_shape_fit +
 *  observed_shape_hash — the authored `shape` is never clobbered). The hash seals the verdict against the
 *  exact input that produced it; a later plan edit that changes the input flips the seal → the lint goes stale. */
export async function writeShapeFit(nodes: DnaNode[], input: ShapeReadInput, fits: ShapeFit[]): Promise<void> {
  const premise = nodes.find((n) => n.kind === "premise");
  if (!premise) return;
  const content: PremiseContent = { ...(premise.content as PremiseContent), observed_shape_fit: fits, observed_shape_hash: shapeReadHash(input) };
  const { error } = await supabase.from("book_nodes").update({ content }).eq("id", premise.id);
  if (error) throw error;
}

/** The read's findings as an instruction for the editor agent — built from the engine's own movement_unfit lints
 *  (no duplicated thresholds; the lint already gates on a fresh seal). Returns null when every movement lands. */
export function shapeFindingsMessage(nodes: DnaNode[]): string | null {
  const unfit = validate(nodes).filter((i) => i.rule === "movement_unfit");
  if (!unfit.length) return null;
  return [
    "I ran the shape read. These movements aren't delivered by the acts that should carry them:",
    ...unfit.map((g) => `- ${g.message}`),
    "Investigate the named acts/beats and propose revisions that make each of these movements land.",
  ].join("\n");
}

/** Hand the read's findings to the editor agent (the existing book-agent thread) — the manual taste gate; the
 *  AgentRail on the tree page renders the run via Realtime. Returns false when the plan delivers the shape. */
export async function sendShapeFindingsToEditor(bookId: number, nodes: DnaNode[], settings: BookSettings): Promise<boolean> {
  const message = shapeFindingsMessage(nodes);
  if (!message) return false;
  await sendAgentMessage(bookId, message, analysisText(nodes, settings));
  return true;
}
