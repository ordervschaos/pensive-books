// confusionRead — the client half of the cold-reader confusion pass (W5, doc_1783192600000).
//
// The judge simulates a FIRST-TIME reader, so its context is capped at the reader's knowledge horizon:
// per chapter it gets a recap of the pages BEFORE it + the chapter's prose, never the plan (beats/threads/
// character sheets) — confusion is only detectable without the author's map. The recap reuses the rolling
// continuity digest dna-expand already caches per scene (authoring.prose_digest.line = that page's one-line
// recap delta): joining the prior scenes' lines reconstructs the "story so far" a reader carries, for free.
// A scene without a cached line falls back to the opening ~300 chars of its chapter's first scene, marked as
// a truncated recap. The read writes `confusion_flags` onto the flagged scenes (parallel to continuity_flags);
// the engine's reader_confusion lint surfaces them, and the findings hand off to the editor agent.
import { supabase } from "@/integrations/supabase/client";
import { BRIDGE, bridgeFetch } from "@/lib/bridge";
import { sendAgentMessage } from "@/features/dna/lib/agentThread";
import {
  analysisText, byId, chapters, validate,
  type Authoring, type BookSettings, type ConfusionFlag, type DnaNode, type SceneContent,
} from "@/features/dna/lib/novelDna";

export interface ConfusionReadScene { sceneId: string; prose: string }
export interface ConfusionReadChapter { chapterIndex: number; priorContext: string; scenes: ConfusionReadScene[] }
export interface ConfusionReadInput { chapters: ConfusionReadChapter[] }
export interface SceneConfusionFlag { sceneId: string; kind: NonNullable<ConfusionFlag["kind"]>; note: string }
/** truncated/chaptersRead: a long book may not fit one judge call — the fn reads the first chapters that fit
 *  and reports how far it got, so the client only touches the scenes that were actually judged. */
export interface ConfusionReadResult { flags: SceneConfusionFlag[]; truncated: boolean; chaptersRead: number }

const MAX_PROSE_CHARS = 6000;    // per-scene prose sent to the judge
const MAX_PRIOR_CHARS = 3000;    // per-chapter reader-recap budget (the tail wins — recency matters most)
const FALLBACK_SNIPPET = 300;    // chars of a chapter opening used when no digest line is cached

/** The cached one-line recap dna-expand's digest fold stored for this scene's prose, if any. The field lives
 *  on the authoring jsonb (written server-side), so it's untyped on the client — read it defensively. */
const digestLine = (s: DnaNode): string | null => {
  const line = (s.authoring as Authoring & { prose_digest?: { line?: string } }).prose_digest?.line?.trim();
  return line || null;
};

/** Assemble the read input from the live tree: chapters in reading order, each with its prose scenes and the
 *  reader's recap of everything before it. Chapters with no prose are skipped (nothing to read — and they add
 *  nothing to the recap a real reader would carry either, since there are no pages to have read). */
export function buildConfusionReadInput(nodes: DnaNode[]): ConfusionReadInput {
  const index = byId(nodes);
  const out: ConfusionReadChapter[] = [];
  const recap: string[] = []; // grows chapter by chapter — always "everything BEFORE the current chapter"
  let usedFallback = false;
  for (const ch of chapters(nodes)) {
    const scenes = ch.sceneIds
      .map((id) => index.get(id))
      .filter((s): s is DnaNode => !!s)
      .map((s) => ({ node: s, prose: ((s.content as SceneContent).prose?.text ?? "").trim() }))
      .filter((s) => s.prose);
    if (scenes.length) {
      let prior = recap.join(" ");
      if (prior.length > MAX_PRIOR_CHARS) prior = `…${prior.slice(-MAX_PRIOR_CHARS)}`;
      if (usedFallback && prior) prior = `(truncated recap — some earlier pages are represented by their opening lines only) ${prior}`;
      out.push({
        chapterIndex: ch.index,
        priorContext: prior,
        scenes: scenes.map((s) => ({ sceneId: s.node.id, prose: s.prose.slice(0, MAX_PROSE_CHARS) })),
      });
    }
    // Fold THIS chapter into the recap the NEXT chapter's reader carries: the cached digest line per scene
    // when present, else the chapter opening's first chars as a stand-in (never new digest computation).
    scenes.forEach(({ node, prose }, i) => {
      const line = digestLine(node);
      if (line) recap.push(line);
      else if (i === 0) { recap.push(`[${ch.title}] ${prose.slice(0, FALLBACK_SNIPPET)}…`); usedFallback = true; }
    });
  }
  return { chapters: out };
}

/** The scene ids the judge actually saw: the fn consumes chapters in order until its budget, so the first
 *  `chaptersRead` input chapters are exactly the judged set (the clearing scope for writeConfusionFlags). */
export const judgedSceneIds = (input: ConfusionReadInput, chaptersRead: number): string[] =>
  input.chapters.slice(0, chaptersRead).flatMap((c) => c.scenes.map((s) => s.sceneId));

/** Run the read: bridge in dev (localhost:8787), edge fn in prod. One call covers as many chapters as fit. */
export async function invokeConfusionRead(bookId: number, input: ConfusionReadInput): Promise<ConfusionReadResult> {
  if (BRIDGE) {
    const r = await bridgeFetch("/read-confusion", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookId, ...input }),
    });
    if (!r.ok) throw new Error(`read-confusion bridge ${r.status}: ${await r.text()}`);
    const d = await r.json();
    return { flags: d?.flags ?? [], truncated: !!d?.truncated, chaptersRead: d?.chaptersRead ?? input.chapters.length };
  }
  const { data, error } = await supabase.functions.invoke("read-confusion", { body: { bookId, ...input } });
  if (error) throw error;
  return { flags: data?.flags ?? [], truncated: !!data?.truncated, chaptersRead: data?.chaptersRead ?? input.chapters.length };
}

/** Write the flags back onto the scene nodes (a targeted patch touching ONLY confusion_flags — an output
 *  field, so it never stales the prose). Clearing semantics: a JUDGED scene with no flags gets [] — a re-run
 *  that finds a scene fixed clears its old flags (state reflects the latest read). Scenes OUTSIDE the judged
 *  set keep whatever they had (a truncated run must not erase flags on chapters it never reached). Scenes
 *  that are clean before and after are not touched at all (no pointless row churn). */
export async function writeConfusionFlags(nodes: DnaNode[], flags: SceneConfusionFlag[], readSceneIds: string[]): Promise<void> {
  const byScene = new Map<string, ConfusionFlag[]>();
  for (const f of flags) {
    if (!f.sceneId || !f.kind || !f.note) continue;
    (byScene.get(f.sceneId) ?? byScene.set(f.sceneId, []).get(f.sceneId)!).push({ kind: f.kind, note: f.note });
  }
  const index = byId(nodes);
  await Promise.all(readSceneIds.map(async (sceneId) => {
    const scene = index.get(sceneId);
    if (!scene || scene.kind !== "scene") return;
    const next = byScene.get(sceneId) ?? [];
    const had = ((scene.content as SceneContent).confusion_flags ?? []).length > 0;
    if (!next.length && !had) return; // clean before and after — nothing to write
    const content = { ...scene.content, confusion_flags: next };
    const { error } = await supabase.from("book_nodes").update({ content }).eq("id", sceneId);
    if (error) throw error;
  }));
}

/** The read's findings as an instruction for the editor agent — built from the engine's own reader_confusion
 *  lints (no duplicated logic). Null when a cold reader can follow everything (nothing to hand off). */
export function confusionFindingsMessage(nodes: DnaNode[]): string | null {
  const flags = validate(nodes).filter((i) => i.rule === "reader_confusion");
  if (!flags.length) return null;
  return [
    "The cold read — a first-time reader who knows only the pages so far — got lost here:",
    ...flags.map((f) => `- ${f.message}`),
    "Revise the flagged scenes so a first-time reader can follow them: establish who/where/when on the page, or seed the missing reference earlier.",
  ].join("\n");
}

/** Hand the confusion flags to the editor agent (the manual taste gate). Returns false when there's nothing
 *  to send. The AgentRail on the tree page renders the run via Realtime. */
export async function sendConfusionFindingsToEditor(bookId: number, nodes: DnaNode[], settings: BookSettings): Promise<boolean> {
  const message = confusionFindingsMessage(nodes);
  if (!message) return false;
  await sendAgentMessage(bookId, message, analysisText(nodes, settings));
  return true;
}
