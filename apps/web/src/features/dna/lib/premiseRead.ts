// premiseRead — the client half of the "premise read" (read-premise): does the PREMISE still honor the
// LOGLINE it was derived from? Cloned from synopsisRead: LLM as SENSOR (one call → a structured verdict
// written onto the tree), pure function as JUDGE (the logline_fit_flag lint reads the verdict; the floor
// lives in the engine). Distinct from observed_shape_fit (the shape read — per-movement act-delivery, a
// different judge of a different question).
//
// The tree is the single source of truth, so (like the other reads) the CLIENT assembles the read's input
// and writes its output back; the edge fn / bridge is a stateless prompt→JSON call. The verdict lands on the
// PREMISE node (the level that made the promise), sealed by a hash of the exact input sent.
import { supabase } from "@/integrations/supabase/client";
import { invokeFn } from "@/lib/localFn";
import { sendAgentMessage } from "@/features/dna/lib/agentThread";
import {
  analysisText, buildLoglineFitInput, loglineFitHash, validate,
  type BookSettings, type DnaNode, type LoglineFitInput, type PremiseContent,
} from "@/features/dna/lib/novelDna";

// The assembler + seal are shared with the engine (the lint recomputes the same hash), so we re-export rather
// than re-implement — that shared code IS what keeps the seal honest.
export { buildLoglineFitInput, loglineFitHash } from "@/features/dna/lib/novelDna";

/** One row of the read's verdict: a logline-fidelity axis's 1–5 score and its one-line note. */
export interface LoglineFitRow { axis: string; score: number; note?: string }

/** Run the read: locally-served fn (VITE_LOCAL_FUNCTIONS_URL) or deployed edge fn. Returns one row per axis. */
export async function invokePremiseRead(bookId: number, input: LoglineFitInput): Promise<LoglineFitRow[]> {
  const { data, error } = await invokeFn<{ premise_fit?: LoglineFitRow[] }>("read-premise", { body: { bookId, input } });
  if (error) throw error;
  return data?.premise_fit ?? [];
}

/** Write the verdict back onto the PREMISE node (a targeted patch touching only observed_logline_fit +
 *  observed_logline_fit_hash — dramatic_question/shape are never touched). The hash seals the verdict
 *  against the exact input that produced it; editing the logline or the premise flips the seal → the lint
 *  goes stale. */
export async function writeLoglineFit(nodes: DnaNode[], input: LoglineFitInput, rows: LoglineFitRow[]): Promise<void> {
  const premise = nodes.find((n) => n.kind === "premise");
  if (!premise) return;
  const content: PremiseContent = { ...(premise.content as PremiseContent), observed_logline_fit: rows, observed_logline_fit_hash: loglineFitHash(input) };
  const { error } = await supabase.from("book_nodes").update({ content }).eq("id", premise.id);
  if (error) throw error;
}

/** The read's findings as an instruction for the editor agent — built from the engine's own
 *  logline_fit_flag lints (no duplicated thresholds; the lint already gates on a fresh seal). Returns null
 *  when every axis clears. */
export function loglineFitFindingsMessage(nodes: DnaNode[]): string | null {
  const flags = validate(nodes).filter((i) => i.rule === "logline_fit_flag");
  if (!flags.length) return null;
  return [
    "I ran the premise read (does the premise still honor the logline?). These axes score under the floor:",
    ...flags.map((g) => `- ${g.message}`),
    "Propose premise revisions that raise each flagged axis without inventing a different logline.",
  ].join("\n");
}

/** Hand the read's findings to the editor agent (the existing book-agent thread) — the manual taste gate; the
 *  AgentRail on the tree page renders the run via Realtime. Returns false when the premise clears every axis. */
export async function sendLoglineFitFindingsToEditor(bookId: number, nodes: DnaNode[], settings: BookSettings): Promise<boolean> {
  const message = loglineFitFindingsMessage(nodes);
  if (!message) return false;
  await sendAgentMessage(bookId, message, analysisText(nodes, settings));
  return true;
}
