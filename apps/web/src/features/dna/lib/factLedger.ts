// factLedger — the client half of the continuity ledger (docs/true-agent.md Step 3).
//
// The prefix-sum scan: walk scenes in reading order, and for each, hand the read the "story so far" canon
// (folded from the facts we've extracted up to here) + the scene's prose. The read returns the facts THIS
// scene asserts/changes (the delta) and any contradictions vs the canon; we write both onto the scene
// (observed_establishes + continuity_flags) and fold the delta forward. Sequential = O(n) calls, and each
// call's context is bounded by the ledger, not the whole prior manuscript (the O(n²) read-back it replaces).
import { supabase } from "@/integrations/supabase/client";
import { invokeFn } from "@/lib/localFn";
import { sendAgentMessage } from "@/features/dna/lib/agentThread";
import {
  analysisText, byId, entityRegistryBlock, scenesInOrder, traceDiff, validate,
  type BeatContent, type BookSettings, type ContinuityFlag, type DnaNode, type LedgerFact, type SceneContent, type SceneFingerprint, type ValueCarrier, type ValueShift,
} from "@/features/dna/lib/novelDna";

export interface FactReadResult { facts: LedgerFact[]; contradictions: ContinuityFlag[]; valueCarrier?: ValueCarrier; fingerprint?: SceneFingerprint }

/** Run the read for ONE scene against the canon folded so far. `entities` is the entityRegistryBlock the read
 *  grounds facts against (Phase-1). `scene.value_shift` (when present) also asks the read to judge value
 *  embodiment (R2). Locally-served fn (VITE_LOCAL_FUNCTIONS_URL) or deployed edge fn. */
export async function invokeReadFacts(bookId: number, ledgerIn: LedgerFact[], scene: { id: string; summary?: string; prose: string; value_shift?: ValueShift }, entities?: string): Promise<FactReadResult> {
  const { data, error } = await invokeFn<FactReadResult>("read-facts", { body: { bookId, ledgerIn, scene, entities } });
  if (error) throw error;
  return { facts: data?.facts ?? [], contradictions: data?.contradictions ?? [], valueCarrier: data?.valueCarrier, fingerprint: data?.fingerprint };
}

/** Write a scene's ledger delta + any contradiction flags onto the node (output fields — stripped from the
 *  scene's prose/illus hashes, so this never stales the prose). Empty arrays clear a prior run's results. */
async function writeSceneLedger(scene: DnaNode, facts: LedgerFact[], flags: ContinuityFlag[], valueCarrier?: ValueCarrier, fingerprint?: SceneFingerprint): Promise<void> {
  const content: SceneContent = { ...scene.content, observed_establishes: facts, continuity_flags: flags };
  // R2: write the embodiment verdict when the read returned one; clear a prior run's value when the scene has
  // a shift but the read didn't (keeps the field honest), and leave it untouched for shift-less scenes.
  if (valueCarrier) content.observed_value_carrier = valueCarrier;
  else if ((scene.content as SceneContent).value_shift?.from) delete content.observed_value_carrier;
  // Fingerprint task is unconditional (asked on every scene) — so unlike value_carrier there's no shift-less
  // scene to leave untouched: write it when the read returned one, else clear a prior run's stale value.
  if (fingerprint) content.observed_fingerprint = fingerprint;
  else delete content.observed_fingerprint;
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
  const registry = entityRegistryBlock(nodes); // the shared keyspace, computed once for the whole scan
  const canon = new Map<string, LedgerFact>();
  let totalFacts = 0, totalContra = 0;
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    const { facts, contradictions, valueCarrier, fingerprint } = await invokeReadFacts(bookId, [...canon.values()], {
      id: s.id, summary: beatSummary(s), prose: (s.content as SceneContent).prose!.text!.trim(),
      value_shift: (s.content as SceneContent).value_shift,
    }, registry);
    for (const f of facts) if (f.key) canon.set(f.key, f); // fold forward, last-write-wins
    await writeSceneLedger(s, facts, contradictions, valueCarrier, fingerprint);
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

/** The planned-vs-observed TRACE gaps (traceDiff) as an editor instruction — the state-axis half of the verify
 *  loop, unlocked by Phase-1 grounding (docs/scene-ledger.md §3.2 consumer 3). A relationship a scene planned to
 *  move, or a promise it planned to pay, that the prose read surfaced no fact for. Null when plan and prose
 *  agree on every read scene. */
export function traceFindingsMessage(nodes: DnaNode[]): string | null {
  const gaps = traceDiff(nodes);
  if (!gaps.length) return null;
  return [
    "The planned-vs-observed trace found these plans the prose read didn't deliver:",
    ...gaps.map((g) => `- ${g.note}`),
    "Either revise the prose to deliver the planned move/payoff, or adjust the plan if the scene legitimately changed.",
  ].join("\n");
}

/** Hand the verify-loop findings — continuity breaks AND planned-vs-observed trace gaps — to the editor agent
 *  (the manual taste gate). Returns false when there's nothing to send. */
export async function sendBreaksToEditor(bookId: number, nodes: DnaNode[], settings: BookSettings): Promise<boolean> {
  const message = [ledgerFindingsMessage(nodes), traceFindingsMessage(nodes)].filter(Boolean).join("\n\n");
  if (!message) return false;
  await sendAgentMessage(bookId, message, analysisText(nodes, settings));
  return true;
}
