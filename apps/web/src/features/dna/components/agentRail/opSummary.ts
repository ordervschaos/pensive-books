import type { NodeOp } from "@/features/dna/lib/dnaChat";

// A short human handle for an op's content (its first meaningful field) — used by the collapsed resolved card.
export function opHandle(content: unknown): string {
  const c = (content ?? {}) as Record<string, unknown>;
  const h = c.logline ?? c.name ?? c.title ?? c.controlling_idea ?? c.dramatic_question ?? c.summary ?? c.goal ?? c.text;
  return typeof h === "string" && h.trim() ? h.trim().slice(0, 80) : "";
}

// One line per op for a resolved (applied/discarded) proposal — self-contained from the stored ops, so it
// reads the same in the live feed and in archived sessions (no live-tree lookup, no stale before/after).
export function opLine(op: NodeOp): string {
  if (op.op === "edit") { const h = opHandle((op as { content?: unknown }).content); return h ? `edit · ${h}` : "edit a node"; }
  if (op.op === "add") { const h = opHandle((op as { content?: unknown }).content); return `add ${(op as { kind?: string }).kind ?? "node"}${h ? ` · ${h}` : ""}`; }
  if (op.op === "delete") return "remove a node";
  if (op.op === "replace_children") { const o = op as { childKind?: string; children?: unknown[] }; return `rebuild ${o.childKind ?? "children"} · ${o.children?.length ?? 0} new`; }
  if (op.op === "replace_text") { const f = (op as { find?: string }).find ?? ""; return `patch prose · “${f.slice(0, 40)}${f.length > 40 ? "…" : ""}”`; }
  return "change";
}
