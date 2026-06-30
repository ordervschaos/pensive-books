// factLedger — the client half of the continuity ledger (docs/true-agent.md Step 3).
//
// The prefix-sum scan: walk scenes in reading order, and for each, hand the read the "story so far" canon
// (folded from the facts we've extracted up to here) + the scene's prose. The read returns the facts THIS
// scene asserts/changes (the delta) and any contradictions vs the canon; we write both onto the scene
// (observed_establishes + continuity_flags) and fold the delta forward. Sequential = O(n) calls, and each
// call's context is bounded by the ledger, not the whole prior manuscript (the O(n²) read-back it replaces).
import { supabase } from "@/integrations/supabase/client";
import { BRIDGE, bridgeFetch } from "@/lib/bridge";
import { sendAgentMessage } from "@/lib/agentThread";
import {
  analysisText, byId, scenesInOrder, validate,
  type BeatContent, type BookSettings, type ContinuityFlag, type DnaNode, type LedgerFact, type SceneContent,
} from "@/lib/novelDna";

export interface FactReadResult { facts: LedgerFact[]; contradictions: ContinuityFlag[] }

/** Run the read for ONE scene against the canon folded so far. Bridge in dev, edge fn in prod. */
export async function invokeReadFacts(bookId: number, ledgerIn: LedgerFact[], scene: { id: string; summary?: string; prose: string }): Promise<FactReadResult> {
  if (BRIDGE) {
    const r = await bridgeFetch("/read-facts", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookId, ledgerIn, scene }),
    });
    if (!r.ok) throw new Error(`read-facts bridge ${r.status}: ${await r.text()}`);
    const d = await r.json();
    return { facts: d?.facts ?? [], contradictions: d?.contradictions ?? [] };
  }
  const { data, error } = await supabase.functions.invoke("read-facts", { body: { bookId, ledgerIn, scene } });
  if (error) throw error;
  return { facts: data?.facts ?? [], contradictions: data?.contradictions ?? [] };
}

/** Write a scene's ledger delta + any contradiction flags onto the node (output fields — stripped from the
 *  scene's prose/illus hashes, so this never stales the prose). Empty arrays clear a prior run's results. */
async function writeSceneLedger(scene: DnaNode, facts: LedgerFact[], flags: ContinuityFlag[]): Promise<void> {
  const content = { ...scene.content, observed_establishes: facts, continuity_flags: flags };
  const { error } = await supabase.from("book_nodes").update({ content }).eq("id", scene.id);
  if (error) throw error;
}

export interface LedgerScanProgress { done: number; total: number; contradictions: number }
export interface LedgerScanResult { scanned: number; facts: number; contradictions: number }

/** The full prefix-sum scan over every scene that has prose. Maintains the canon locally as it goes (so a
 *  scene reads the facts the run just established upstream, not a stale DB snapshot). The book_nodes Realtime
 *  subscription paints the ledger as each scene lands. */
export async function runLedgerScan(bookId: number, nodes: DnaNode[], onProgress?: (p: LedgerScanProgress) => void): Promise<LedgerScanResult> {
  const index = byId(nodes);
  const beatSummary = (scene: DnaNode): string => {
    const beat = scene.parent_id ? index.get(scene.parent_id) : null;
    return String((beat?.content as BeatContent | undefined)?.summary ?? (scene.content as SceneContent).goal ?? "");
  };
  const scenes = scenesInOrder(nodes).filter((s) => (s.content as SceneContent).prose?.text?.trim());
  const canon = new Map<string, LedgerFact>();
  let totalFacts = 0, totalContra = 0;
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    const { facts, contradictions } = await invokeReadFacts(bookId, [...canon.values()], {
      id: s.id, summary: beatSummary(s), prose: (s.content as SceneContent).prose!.text!.trim(),
    });
    for (const f of facts) if (f.key) canon.set(f.key, f); // fold forward, last-write-wins
    await writeSceneLedger(s, facts, contradictions);
    totalFacts += facts.length; totalContra += contradictions.length;
    onProgress?.({ done: i + 1, total: scenes.length, contradictions: totalContra });
  }
  return { scanned: scenes.length, facts: totalFacts, contradictions: totalContra };
}

/** The recorded continuity breaks as an instruction for the editor agent — built from the engine's own
 *  continuity_break lints (no duplicated logic). Null when the prose is consistent everywhere. */
export function ledgerFindingsMessage(nodes: DnaNode[]): string | null {
  const breaks = validate(nodes).filter((i) => i.rule === "continuity_break");
  if (!breaks.length) return null;
  return [
    "The continuity read found these breaks against the story's established canon:",
    ...breaks.map((b) => `- ${b.message}`),
    "Fix the prose so it stays consistent with the canon (the earlier statement is usually the one to keep).",
  ].join("\n");
}

/** Hand the continuity breaks to the editor agent (the manual taste gate). Returns false when there are none. */
export async function sendBreaksToEditor(bookId: number, nodes: DnaNode[], settings: BookSettings): Promise<boolean> {
  const message = ledgerFindingsMessage(nodes);
  if (!message) return false;
  await sendAgentMessage(bookId, message, undefined, analysisText(nodes, settings));
  return true;
}
