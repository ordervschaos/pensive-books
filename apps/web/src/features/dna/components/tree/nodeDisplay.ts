// Pure display derivations over DnaNode — titles, field display strings, and the
// prose-completion rollup. No React, no IO; everything here is (nodes) => value.
import { isProseStale, type BeatContent, type DnaNode, type SceneContent } from "@/features/dna/lib/novelDna";
import { type EditSpec } from "@/features/dna/lib/dnaSchema";

// ── Title extraction per kind (first meaningful field) ───────────────────────
export function nodeTitle(n: DnaNode): string {
  const c = n.content as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "");
  switch (n.kind) {
    case "seed": return s(c.logline);
    case "premise": return s(c.dramatic_question) || s((c.shape as Record<string, unknown>)?.name);
    case "pillar": return s(c.controlling_idea);
    case "character": return s(c.name);
    case "relationship": return s(c.bond);
    case "world_fact": return s(c.name) || s(c.rule);
    case "location": return s(c.name) || s(c.summary);
    case "tentpole": return s(c.summary);
    case "game": return s(c.name);
    case "thread": return s(c.name) || s(c.promise);
    case "act": return s(c.title) || s(c.goal);
    case "beat": return s((c as BeatContent).summary);
    case "scene": return s((c as SceneContent).chapter_start?.title) || s((c as SceneContent).goal);
    case "voice_profile": return s(c.style) || "voice profile";
    default: return "";
  }
}

// ── Connector glyph for beats ────────────────────────────────────────────────
export function beatGlyph(n: DnaNode): string {
  if (n.kind !== "beat") return "";
  const c = (n.content as BeatContent).connector;
  return c === "therefore" ? "∴ " : c === "but" ? "↯ " : "";
}

// ── Field value helpers ───────────────────────────────────────────────────────
export const contentAt = (node: DnaNode, parentKey?: string): Record<string, unknown> =>
  (parentKey ? ((node.content as Record<string, unknown>)[parentKey] as Record<string, unknown>) ?? {} : node.content) as Record<string, unknown>;
export const refName = (id: unknown, index: Map<string, DnaNode>): string =>
  typeof id === "string" ? (index.has(id) ? nodeTitle(index.get(id)!) || id : id) : "";
/** The display string for a field given its type (refs resolved to names, percent rendered, etc.). */
export function displayValue(node: DnaNode, spec: EditSpec, index: Map<string, DnaNode>, parentKey?: string): string {
  const raw = contentAt(node, parentKey)[spec.key];
  switch (spec.type) {
    case "ref": return refName(raw, index);
    case "refs": return Array.isArray(raw) ? raw.map((r) => refName(r, index)).filter(Boolean).join(", ") : "";
    case "list": return Array.isArray(raw) ? raw.join(", ") : "";
    case "percent": return typeof raw === "number" ? `${Math.round(raw * 100)}%` : "";
    default: return typeof raw === "string" ? raw : raw != null ? String(raw) : "";
  }
}

// ── Prose-completion rollup for parent nodes (act / beat) ────────────────────
// A scene's prose is in one of three states: done (has prose, plan unchanged since), stale (prose exists but
// the scene plan moved under it → needs a re-write), or none (no prose yet). A beat rolls up its direct
// scenes; an act rolls up the scenes under all its beats. The badge on the parent makes "what's written /
// half-written / unwritten" legible without expanding the subtree.
type ProseState = "done" | "stale" | "none";
function proseStateOf(scene: DnaNode): ProseState {
  const text = (scene.content as SceneContent).prose?.text?.trim();
  if (!text) return "none";
  return isProseStale(scene) ? "stale" : "done";
}
function descendantScenes(node: DnaNode, nodes: DnaNode[]): DnaNode[] {
  if (node.kind === "beat") return nodes.filter((n) => n.parent_id === node.id && n.kind === "scene");
  if (node.kind === "act") {
    const beats = nodes.filter((n) => n.parent_id === node.id && n.kind === "beat");
    return beats.flatMap((b) => nodes.filter((n) => n.parent_id === b.id && n.kind === "scene"));
  }
  return [];
}
export interface ProseRollup { done: number; stale: number; none: number; total: number }
export function proseRollup(node: DnaNode, nodes: DnaNode[]): ProseRollup | null {
  if (node.kind !== "act" && node.kind !== "beat") return null;
  const scenes = descendantScenes(node, nodes);
  if (!scenes.length) return null;
  let done = 0, stale = 0, none = 0;
  for (const s of scenes) {
    const st = proseStateOf(s);
    if (st === "done") done++;
    else if (st === "stale") stale++;
    else none++;
  }
  return { done, stale, none, total: scenes.length };
}
