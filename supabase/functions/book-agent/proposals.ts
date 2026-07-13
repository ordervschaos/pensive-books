// book-agent proposal validators: turn the model's propose_* tool inputs into reviewable proposals,
// validated against the live tree + the lock fence (read-only on book_nodes except the
// proposeOptions creation shortcut, which mints a node + stages options in one step).
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { ALL_NODE_KINDS, nodeHandle, type NodeOp, type NewSubtree, type AgentProposal, type RenderBrief } from "./shared.ts";
import { newId, OUTPUT_FIELDS, PARENT_KIND, SINGLETON_KINDS, type NodeKind } from "../_shared/novel-dna.ts";

// Keep only { content, children } from a model-proposed subtree (drop stray op/kind/id fields the model
// may emit), recursively — the shape applyNodeOps expects for a replace_children rebuild.
function sanitizeSubtree(subs: unknown[]): NewSubtree[] {
  const out: NewSubtree[] = [];
  for (const s of Array.isArray(subs) ? subs : []) {
    if (!s || typeof s !== "object") continue;
    const sub = s as { content?: Record<string, unknown>; children?: unknown[] };
    if (!sub.content || typeof sub.content !== "object") continue;
    const kids = Array.isArray(sub.children) ? sanitizeSubtree(sub.children) : [];
    out.push(kids.length ? { content: sub.content, children: kids } : { content: sub.content });
  }
  return out;
}

// Validate proposed ops against the LIVE tree + the lock fence; build the reviewable proposal. Mirrors
// dna-chat's parser: ids must exist, never LOCKED, add-kinds valid.
async function proposeNodeOps(
  service: SupabaseClient,
  bookId: number,
  input: { summary?: string; ops?: unknown[] },
): Promise<{ ok: true; proposal: AgentProposal } | { ok: false; error: string }> {
  // content rides along for replace_text's find-string check; other ops don't read it.
  const { data: rows } = await service.from("book_nodes").select("id, kind, authoring, content").eq("book_id", bookId);
  const nodes = (rows ?? []) as { id: string; kind: string; authoring: { locked?: boolean } | null; content: Record<string, unknown> | null }[];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const ops: NodeOp[] = [];
  const badFinds: string[] = []; // replace_text ops whose find string isn't in the live prose — name them so the model corrects
  for (const raw of Array.isArray(input.ops) ? input.ops : []) {
    const o = raw as { op?: string; id?: string; kind?: string; childKind?: string; parentId?: string; content?: Record<string, unknown>; children?: unknown[]; find?: string; replace?: string };
    if (o.op === "edit" && o.id && byId.has(o.id) && !byId.get(o.id)!.authoring?.locked && o.content) {
      // Output fields (confusion_flags, observed_shape_fit, observed_craft, prose, …) are written BY the reads
      // (Cold Read / Shape Read / Editor's Read / prose render) — never a direct plan edit. Caught live 2026-07-09:
      // the agent, unable to fix a scene's actual prose inconsistency, cleared the scene's confusion_flags to []
      // instead — deleting the evidence rather than the problem, so the lint vanished while the prose stayed broken.
      const blockedKeys = Object.keys(o.content).filter((k) => (OUTPUT_FIELDS as readonly string[]).includes(k));
      if (blockedKeys.length) {
        badFinds.push(`[${o.id}] edit touches read-output field(s) "${blockedKeys.join('", "')}" — these are written by the reads (Cold Read/Shape Read/Editor's Read/prose render), never edited directly. Fix the underlying content instead (prose via replace_text/propose_prose_render, structure via other fields) — the flag clears itself next time that read runs.`);
        continue;
      }
      ops.push({ op: "edit", id: o.id, content: o.content });
    } else if (o.op === "delete" && o.id && byId.has(o.id) && !byId.get(o.id)!.authoring?.locked) {
      ops.push({ op: "delete", id: o.id });
    } else if (o.op === "add" && o.parentId && byId.has(o.parentId) && o.kind && ALL_NODE_KINDS.includes(o.kind) && o.content) {
      ops.push({ op: "add", kind: o.kind, parentId: o.parentId, content: o.content });
    } else if (o.op === "replace_children" && o.parentId && byId.has(o.parentId) && !byId.get(o.parentId)!.authoring?.locked && o.childKind && ALL_NODE_KINDS.includes(o.childKind) && Array.isArray(o.children) && o.children.length) {
      const children = sanitizeSubtree(o.children);
      if (children.length) ops.push({ op: "replace_children", parentId: o.parentId, childKind: o.childKind, children });
    } else if (o.op === "replace_text" && o.id && typeof o.find === "string" && o.find.length && typeof o.replace === "string") {
      const node = byId.get(o.id);
      if (!node || node.authoring?.locked || node.kind !== "scene") {
        badFinds.push(`[${o.id}] is not an editable scene`);
        continue;
      }
      // Verify against the LIVE prose so a stale/typo'd find bounces back to the model NOW (with the scene
      // named), instead of silently no-opping at apply time.
      const prose = String(((node.content as { prose?: { text?: unknown } } | null)?.prose?.text ?? ""));
      if (!prose.includes(o.find)) {
        badFinds.push(`"${o.find.slice(0, 60)}" not found in scene [${o.id}]`);
        continue;
      }
      ops.push({ op: "replace_text", id: o.id, find: o.find, replace: o.replace });
    }
  }
  if (ops.length === 0) {
    const findNote = badFinds.length ? ` replace_text failures: ${badFinds.join("; ")}. The find string must match the CURRENT prose exactly — search_nodes shows the live text.` : "";
    return { ok: false, error: "No valid ops — reference real, non-locked node ids." + findNote };
  }
  if (badFinds.length) {
    // Some ops were fine but these weren't — fail the whole proposal so nothing half-lands silently.
    return { ok: false, error: `Some replace_text ops don't match the live prose: ${badFinds.join("; ")}. Fix the find strings (they must match the CURRENT text exactly) and resend ALL the ops.` };
  }
  return { ok: true, proposal: { id: crypto.randomUUID(), layer: "dna", summary: String(input.summary ?? "Proposed change").trim() || "Proposed change", ops } };
}

// Validate a prose-render request: every id must be a real, non-locked SCENE in this book. Builds the
// reviewable proposal (layer 'prose-render', no ops). The author applies it and the prose streams in their
// browser via the v2 pipeline — the agent never renders prose in-worker (docs/agent-context-model.md).
// Shape the agent's free-form brief into the stored RenderBrief: verbatim strings (we keep the agent's own
// words, per the design), just trimmed + bounded so a runaway tool call can't bloat the proposal. Returns
// undefined when there's nothing usable, so a no-brief render behaves exactly as before.
function sanitizeBrief(raw: unknown): RenderBrief | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as { focus?: unknown; mustHonor?: unknown; avoid?: unknown };
  const line = (x: unknown) => (typeof x === "string" ? x.trim() : "");
  const list = (x: unknown) => (Array.isArray(x) ? x.map(line).filter(Boolean).slice(0, 12) : []);
  const focus = line(r.focus).slice(0, 400);
  const mustHonor = list(r.mustHonor);
  const avoid = list(r.avoid);
  if (!focus && !mustHonor.length && !avoid.length) return undefined;
  return { focus, ...(mustHonor.length ? { mustHonor } : {}), ...(avoid.length ? { avoid } : {}) };
}

async function proposeProseRender(
  service: SupabaseClient,
  bookId: number,
  input: { summary?: string; sceneIds?: unknown; brief?: unknown },
): Promise<{ ok: true; proposal: AgentProposal } | { ok: false; error: string }> {
  const { data: rows } = await service.from("book_nodes").select("id, kind, authoring").eq("book_id", bookId);
  const byId = new Map(((rows ?? []) as { id: string; kind: string; authoring: { locked?: boolean } | null }[]).map((n) => [n.id, n]));
  const ids = Array.isArray(input.sceneIds) ? input.sceneIds.filter((x): x is string => typeof x === "string") : [];
  const sceneIds: string[] = [];
  for (const id of ids) {
    const n = byId.get(id);
    if (n && n.kind === "scene" && !n.authoring?.locked && !sceneIds.includes(id)) sceneIds.push(id);
  }
  if (sceneIds.length === 0) return { ok: false, error: "No valid scene ids — propose_prose_render targets real, non-locked SCENE nodes by their [id]." };
  return { ok: true, proposal: { id: crypto.randomUUID(), layer: "prose-render", summary: String(input.summary ?? "Render prose").trim() || "Render prose", ops: [], sceneIds, brief: sanitizeBrief(input.brief) } };
}

// Stage an 'expansion' request: the dna-expand engine (client-side, on Apply) generates the beat sheet or a
// beat's scenes. We only VALIDATE the target here (node exists, not locked, right kind for the target); the
// engine does the real work + persistence in the browser (generateExpansionOps → applyNodeOps). 'beatsheet'
// needs the pillar (and acts to hang beats under); 'scenes' needs a beat.
async function proposeExpansion(
  service: SupabaseClient,
  bookId: number,
  input: { summary?: string; nodeId?: string; target?: string; brief?: unknown },
): Promise<{ ok: true; proposal: AgentProposal } | { ok: false; error: string }> {
  const target = String(input.target ?? "").trim();
  if (target !== "premise" && target !== "beatsheet" && target !== "scenes" && target !== "contract" && target !== "sketch") {
    return { ok: false, error: `Unknown target "${target}" — propose_expansion only handles 'premise' (nodeId = seed), 'beatsheet' (nodeId = pillar), 'scenes' (nodeId = beat), 'contract' (nodeId = pillar), or 'sketch' (nodeId = scene).` };
  }
  const { data: rows } = await service.from("book_nodes").select("id, kind, authoring").eq("book_id", bookId);
  const nodes = (rows ?? []) as { id: string; kind: string; authoring: { locked?: boolean } | null }[];
  const node = nodes.find((n) => n.id === input.nodeId);
  if (!node) return { ok: false, error: `No node with id ${input.nodeId}.` };
  if (node.authoring?.locked) return { ok: false, error: `Node ${input.nodeId} is LOCKED — unlock it before expanding.` };
  if (target === "premise") {
    if (node.kind !== "seed") return { ok: false, error: `'premise' expands the SEED/logline — pass the seed node's id, not a ${node.kind}.` };
  }
  if (target === "beatsheet") {
    if (node.kind !== "pillar") return { ok: false, error: `'beatsheet' expands the PILLAR (all acts at once) — pass the pillar node's id, not a ${node.kind}.` };
    if (!nodes.some((n) => n.kind === "act")) return { ok: false, error: "There are no acts yet — author the acts first (propose_node_ops), then generate the beat sheet." };
  }
  if (target === "scenes" && node.kind !== "beat") {
    return { ok: false, error: `'scenes' breaks ONE beat into scenes — pass a beat node's id, not a ${node.kind}.` };
  }
  if (target === "contract" && node.kind !== "pillar") {
    return { ok: false, error: `'contract' compiles the brief onto the PILLAR — pass the pillar node's id, not a ${node.kind}.` };
  }
  if (target === "sketch" && node.kind !== "scene") {
    return { ok: false, error: `'sketch' generates ONE scene's treatment — pass a scene node's id, not a ${node.kind}.` };
  }
  const label = target === "premise" ? "Derive the premise" : target === "beatsheet" ? "Generate the global beat sheet" : target === "contract" ? "Compile the brief's contract" : target === "sketch" ? "Sketch the scene's treatment" : "Break the beat into scenes";
  return { ok: true, proposal: { id: crypto.randomUUID(), layer: "expansion", summary: String(input.summary ?? label).trim() || label, ops: [], nodeId: node.id, target, brief: sanitizeBrief(input.brief) } };
}

// Stage 2–4 alternative content objects ON a node as pickable options (the options/picker channel). The
// candidates write to book_nodes.proposals; the author commits one in the tree (chooseProposal). Gated by
// the same live-tree + lock fence as proposeNodeOps — this only stages, it never commits.
//
// CREATION SHORTCUT: when `nodeId` is absent/unknown but `kind` and `parentId` are provided, a new node
// of that kind is created (draft, source=ai) and the options are staged on it immediately — one step.
// This is used for spine singletons like 'premise' that don't exist yet: the agent skips the separate
// propose_expansion → author-apply → propose_options cycle and surfaces all alternatives in one turn.
async function proposeOptions(
  service: SupabaseClient,
  bookId: number,
  input: { nodeId?: string; kind?: string; parentId?: string; note?: string; options?: unknown[] },
): Promise<{ ok: true; handle: string; count: number } | { ok: false; error: string }> {
  const { data: rows } = await service.from("book_nodes").select("id, parent_id, kind, level, position, content, authoring").eq("book_id", bookId);
  const nodes = (rows ?? []) as { id: string; parent_id: string | null; kind: string; level: number; position: number; content: Record<string, unknown> | null; authoring: { locked?: boolean } | null }[];
  const objects = (Array.isArray(input.options) ? input.options : []).filter((o) => o && typeof o === "object" && !Array.isArray(o)) as Record<string, unknown>[];
  if (objects.length < 2) return { ok: false, error: "Offer at least 2 distinct option objects (2–4)." };
  const note = input.note?.trim();
  const proposals = objects.slice(0, 4).map((content) => ({ id: crypto.randomUUID(), content, ...(note ? { note } : {}), source: "options" }));

  let node = nodes.find((n) => n.id === input.nodeId);

  // ── Creation shortcut: mint a new node for this kind under parentId ──
  // Used when the premise (or another spine singleton) doesn't exist yet — avoids the two-step
  // propose_expansion→apply→propose_options cycle by creating + staging options in one server turn.
  if (!node && input.kind && input.parentId) {
    const targetKind = input.kind as string;
    const parentId = input.parentId as string;
    const parentNode = nodes.find((n) => n.id === parentId);
    if (!parentNode) return { ok: false, error: `No parent node with id ${parentId}.` };
    if (!ALL_NODE_KINDS.includes(targetKind)) return { ok: false, error: `Unknown kind "${targetKind}".` };
    // STRUCTURAL GUARDRAILS — this shortcut writes book_nodes directly, bypassing the client validateOps gate,
    // so it must enforce the same invariants or it re-creates the nested-seed / duplicate-premise deviation.
    const want = PARENT_KIND[targetKind as NodeKind];
    if (want === null) return { ok: false, error: `${targetKind} is the tree root — it can't be created under another node.` };
    if (parentNode.kind !== want) return { ok: false, error: `${targetKind} must hang off ${want}, not ${parentNode.kind}.` };
    if (SINGLETON_KINDS.includes(targetKind as NodeKind) && nodes.some((n) => n.kind === targetKind))
      return { ok: false, error: `A ${targetKind} already exists — only one per book. Edit it (or offer options ON it) instead of creating a second.` };
    // Existing siblings of this kind — position after the last one (or 0 if none).
    const siblings = nodes.filter((n) => n.parent_id === parentId && n.kind === targetKind);
    const position = siblings.length ? Math.max(...siblings.map((n) => n.position)) + 1 : 0;
    // Mint an n_-prefixed id like every other write path (newId), not a raw UUID — a stray UUID id in the tree
    // was the fingerprint that this bypass path had written a malformed node.
    const nodeId = newId();
    const { error: insErr } = await service.from("book_nodes").insert({
      id: nodeId,
      book_id: bookId,
      parent_id: parentId,
      kind: targetKind,
      level: parentNode.level + 1,
      position,
      content: {},
      authoring: { status: "draft", source: "ai" },
      proposals,
    });
    if (insErr) return { ok: false, error: insErr.message };
    return { ok: true, handle: targetKind, count: proposals.length };
  }

  if (!node) return { ok: false, error: `No node with id ${input.nodeId}. To create a new node with options, pass kind and parentId instead.` };
  if (node.authoring?.locked) return { ok: false, error: `Node ${input.nodeId} is LOCKED — unlock it before offering options.` };
  const { error } = await service.from("book_nodes").update({ proposals }).eq("id", node.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, handle: nodeHandle(node.content), count: proposals.length };
}

export { proposeNodeOps, proposeProseRender, proposeExpansion, proposeOptions };
