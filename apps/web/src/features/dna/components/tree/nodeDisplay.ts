// Pure display derivations over DnaNode — titles, field display strings, and the
// prose-completion rollup. No React, no IO; everything here is (nodes) => value.
import { isProseStale, STRUCTURE_TEMPLATES, type BeatContent, type CausalityRow, type DnaNode, type SceneContent } from "@/features/dna/lib/novelDna";
import { editSpecs, NODE_SCHEMA, type EditSpec } from "@/features/dna/lib/dnaSchema";

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
    case "tentpole": return s(c.name) || s(c.summary);
    case "game": return s(c.name);
    case "thread": return s(c.name) || s(c.promise);
    case "act": return s(c.title);
    case "beat": return "";
    case "scene": return s((c as SceneContent).chapter_start?.title);
    case "voice_profile": return s(c.style) || "voice profile";
    default: return "";
  }
}

// ── Structure-slot badge for beats ───────────────────────────────────────────
// The named functional beat (hook / midpoint / climax…) made legible on the row — the tree reads like a
// beat board. Labels resolve across ALL templates (keys are unique enough today; an unresolved key still
// displays, underscores → spaces, so a slot never renders blank). Tooltip carries the slot's target % + craft.
const SLOT_INFO = new Map(Object.values(STRUCTURE_TEMPLATES).flatMap((t) => t.slots.map((s) => [s.key, s] as const)));
export function beatSlot(n: DnaNode): { label: string; hint: string } | null {
  if (n.kind !== "beat") return null;
  const key = String((n.content as BeatContent).slot ?? "").trim();
  if (!key) return null;
  const s = SLOT_INFO.get(key);
  return {
    label: (s?.label ?? key.replace(/_/g, " ")).replace(/^The /, ""),
    hint: s ? `${s.label} (~${Math.round(s.at * 100)}% of the book) — ${s.craft}` : `structure slot "${key}" (not in any known template)`,
  };
}

// ── Connector glyph for beats ────────────────────────────────────────────────
export function beatGlyph(n: DnaNode): string {
  if (n.kind !== "beat") return "";
  const c = (n.content as BeatContent).connector;
  return c === "therefore" ? "∴ " : c === "but" ? "↯ " : "";
}

// A causal link reads "hollow" when its connector promises something the row doesn't back up:
// `therefore` with an unmet upstream need, or `but` with neither a polarity reversal nor a real
// need. Shared by DnaStoryMap's beat rows and DnaAnalysis's causality strip — same test, one place.
export function isHollowCausalLink(connector: "therefore" | "but" | undefined, causal?: Pick<CausalityRow, "unmet" | "reversed" | "needs">): boolean {
  return (connector === "therefore" && (causal?.unmet.length ?? 0) > 0) || (connector === "but" && !causal?.reversed && !causal?.needs.length);
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

// ── Hidden/structural fields ──────────────────────────────────────────────────
// Everything in node.content that editSpecs() doesn't render: the genOnly plan fields (threads, needs,
// establishes, sketch…) AND anything missing from NODE_SCHEMA entirely (chapter_start, observed_* reads,
// continuity/confusion flags — real fields the AI writes, just never added to the SSOT). Computed off the
// live content rather than a hand-maintained key list, so it can't drift as new fields get written.
const humanizeKey = (key: string): string => key.replace(/_/g, " ");
// `prose` has its own dedicated block (ProseBlock) — don't duplicate it here.
const RENDERED_ELSEWHERE = new Set(["prose"]);

function renderRawValue(v: unknown, index: Map<string, DnaNode>): string {
  if (v == null) return "";
  if (typeof v === "string") {
    if (!v.trim()) return "";
    return index.has(v) ? nodeTitle(index.get(v)!) || v : v;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map((item) => renderRawValue(item, index)).filter(Boolean).join(", ");
  if (typeof v === "object") {
    const parts = Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => { const r = renderRawValue(val, index); return r ? `${humanizeKey(k)}: ${r}` : ""; })
      .filter(Boolean);
    return parts.join(" · ");
  }
  return String(v);
}

export interface HiddenField { key: string; label: string; note?: string; value: string }
/** Content keys not covered by editSpecs(kind) — the "▸ structural" disclosure reads straight off this. */
export function hiddenFields(node: DnaNode, index: Map<string, DnaNode>): HiddenField[] {
  const known = new Set(editSpecs(node.kind).map((s) => s.key));
  const specByKey = new Map((NODE_SCHEMA[node.kind] ?? []).map((s) => [s.key, s]));
  const content = (node.content ?? {}) as Record<string, unknown>;
  const out: HiddenField[] = [];
  for (const [key, raw] of Object.entries(content)) {
    if (known.has(key) || RENDERED_ELSEWHERE.has(key)) continue;
    const value = renderRawValue(raw, index);
    if (!value) continue;
    const spec = specByKey.get(key);
    out.push({ key, label: spec?.label ?? humanizeKey(key), note: spec?.note, value });
  }
  return out;
}
