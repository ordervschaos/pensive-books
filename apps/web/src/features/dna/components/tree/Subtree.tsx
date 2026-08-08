import { useState } from "react";
import { childrenOf, isEntityKind, isProseStale, SINGLETON_KINDS, type DnaIssue, type DnaNode, type NodeKind, type SceneContent } from "@/features/dna/lib/novelDna";
import { editSpecs, KIND_EXPLAINER } from "@/features/dna/lib/dnaSchema";
import { ConnectorTick, detailRowStyle, labelStyle, MONO, SERIF, T } from "./treeChrome";
import { staleActionsFor } from "./staleActions";
import { proseRollup } from "./nodeDisplay";
import { EditableField } from "./EditableField";
import { BacklinksRow, HiddenFieldsRow, TreeRow, type KebabItem } from "./TreeRow";
import { addKey, OpDiffBlock, PhantomRow, ProposalPicker, type ProposalView } from "./proposalOverlay";
import { ghostActs, ghostBeatsForAct, ghostCast, ghostFromPremise, ghostFromSeed } from "@/features/dna/lib/dnaSkeleton";
import { GhostRows } from "./GhostRows";

// ── A render-only grouping of the pillar's children ──────────────────────────
// The pillar parents two kinds of thing (schema §3 ladder vs §4 entities), and the entity side spans seven
// kinds. This projects the `kind` axis into legible buckets without moving any node; a synthetic
// `${pillar}::story|::world|::world::<kind>` id wires each group into the existing collapse machinery.
const ENTITY_GROUPS: { kind: DnaNode["kind"]; label: string }[] = [
  { kind: "character", label: "characters" },
  { kind: "relationship", label: "relationships" },
  { kind: "thread", label: "threads" },
  { kind: "game", label: "games" },
  { kind: "world_fact", label: "world facts" },
  { kind: "location", label: "locations" },
  { kind: "tentpole", label: "tentpoles" },
  { kind: "voice_profile", label: "voice" },
];

// A clickable "＋ <label>" affordance — adds a node (footer of a group or container).
export function AddRow({ label, depth, onAdd }: { label: string; depth: number; onAdd: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div style={detailRowStyle(depth)}>
      <ConnectorTick depth={depth} />
      <span style={{ width: 12, flexShrink: 0 }} />
      <span onClick={async () => { if (busy) return; setBusy(true); try { await onAdd(); } finally { setBusy(false); } }}
        style={{ fontFamily: MONO, fontSize: 11, color: busy ? T.faint : T.good, cursor: busy ? "default" : "pointer", letterSpacing: "0.04em" }}>
        ＋ {label}
      </span>
    </div>
  );
}

// Compact inline "＋" (manual add) for NodeGroup headers. AI generation for these groups now lives on the
// agent (the rail), not as per-group buttons.
function GroupAddButton({ onAdd, title }: { onAdd: () => void | Promise<void>; title?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <span onClick={async (e) => {
      e.stopPropagation();
      if (busy) return;
      setBusy(true);
      try { await onAdd(); } finally { setBusy(false); }
    }} title={title ?? "add"} style={{ fontFamily: MONO, fontSize: 12, color: busy ? T.faint : T.good, cursor: busy ? "default" : "pointer", flexShrink: 0, lineHeight: 1 }}>
      {busy ? "…" : "＋"}
    </span>
  );
}

// A collapsible labeled section — pure layout, not a real node. `children` is whatever renders inside.
// `alwaysShow` keeps an empty group visible (so its add affordance is reachable); `footer` renders after.
function NodeGroup({ groupId, label, hint, count, depth, collapsedSet, onToggle, children, alwaysShow, footer, action }: {
  groupId: string; label: string; hint?: string; count: number; depth: number;
  collapsedSet: Set<string>; onToggle: (id: string) => void; children: React.ReactNode;
  alwaysShow?: boolean; footer?: React.ReactNode; action?: React.ReactNode;
}) {
  if (!count && !alwaysShow) return null;
  const collapsed = collapsedSet.has(groupId);
  return (
    <div style={{ position: "relative" }}>
      <div onClick={() => onToggle(groupId)} style={{
        display: "flex", alignItems: "baseline", gap: 8,
        paddingLeft: depth * 20 + 20, paddingRight: 12, paddingTop: 7, paddingBottom: 3, cursor: "pointer",
      }}>
        <span style={{ width: 12, flexShrink: 0, color: T.faint, fontSize: 9, lineHeight: 1 }}>{collapsed ? "▶" : "▼"}</span>
        <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.2em", textTransform: "uppercase", color: count ? T.inkSoft : T.faint }}>{label}</span>
        <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.06em", color: T.faint }}>{hint ? `${hint} · ` : ""}{count}</span>
        {action && <span onClick={(e) => e.stopPropagation()} style={{ marginLeft: "auto" }}>{action}</span>}
      </div>
      {!collapsed && children}
      {!collapsed && footer}
    </div>
  );
}

// ── Prose block — collapsible prose text under an expanded scene node ─────────
function ProseBlock({ node, depth, open, onToggle }: {
  node: DnaNode; depth: number; open: boolean; onToggle: () => void;
}) {
  const c = node.content as SceneContent;
  const text = c.prose?.text?.trim() ?? "";
  const words = c.prose?.words ?? (text ? text.split(/\s+/).length : 0);
  const stale = isProseStale(node);
  const mono = MONO;
  return (
    <div style={{ position: "relative" }}>
      <ConnectorTick depth={depth} />
      {/* Toggle row */}
      <div onClick={onToggle} style={{ display: "flex", alignItems: "baseline", gap: 8, paddingLeft: depth * 20 + 20, paddingRight: 12, paddingTop: 4, paddingBottom: 4, cursor: "pointer" }}>
        <span style={{ width: 12, flexShrink: 0, color: T.faint, fontSize: 9 }}>{open ? "▼" : "▶"}</span>
        <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: text ? `${T.good}aa` : T.faint }}>prose</span>
        {words > 0 && <span style={{ fontFamily: mono, fontSize: 9.5, color: T.faint }}>{words}w</span>}
        {stale && <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: T.stale }}>stale</span>}
        {!text && <span style={{ fontFamily: mono, fontSize: 9.5, color: T.faint, fontStyle: "italic" }}>not yet written</span>}
      </div>
      {/* Prose text */}
      {open && text && (
        <div style={{ paddingLeft: depth * 20 + 32, paddingRight: 16, paddingBottom: 10 }}>
          <div style={{ fontFamily: SERIF, fontSize: 15, lineHeight: 1.7, color: stale ? T.staleProse : T.inkSoft, whiteSpace: "pre-wrap", borderLeft: `2px solid ${stale ? `${T.stale}55` : `${T.good}44`}`, paddingLeft: 12 }}>
            {text}
          </div>
        </div>
      )}
      {open && !text && (
        <div style={{ paddingLeft: depth * 20 + 32, paddingRight: 16, paddingBottom: 8, fontFamily: mono, fontSize: 11, color: T.faint, fontStyle: "italic" }}>
          — no prose yet
        </div>
      )}
    </div>
  );
}

// The next rung down each spine singleton — the author can add the placeholder manually; the agent fills it.
const SPINE_CHILD: Record<string, NodeKind> = { seed: "premise", premise: "pillar" };

// ── Recursive tree subtree ───────────────────────────────────────────────────
// Read-only header affordance for a scene that already has prose — opens the reader. Writing prose is the
// agent's job now (the rail), so there is no inline write/generate button on the row.
function ReadProseButton({ node, onOpenReader }: { node: DnaNode; onOpenReader?: () => void }) {
  const hasProse = !!(node.content as SceneContent).prose?.text?.trim();
  if (!hasProse || !onOpenReader) return null;
  return (
    <span onClick={(e) => { e.stopPropagation(); onOpenReader(); }} title="read prose"
      style={{
        fontFamily: MONO, fontSize: 10, letterSpacing: "0.04em",
        color: T.accent, cursor: "pointer",
        border: `1px solid ${T.accent}44`, borderRadius: 4, padding: "0px 7px", background: `${T.accent}08`, flexShrink: 0,
      }}>
      read
    </span>
  );
}

export interface TreeView {
  onToggle: (id: string) => void; onToggleDetail: (id: string) => void;
  onAdd: (parentId: string, kind: DnaNode["kind"]) => void | Promise<void>;
  onDelete: (node: DnaNode) => void;
  onJump: (id: string) => void;         // #1 — reveal + scroll + flash a node by id
  dragId: string | null;                // #5 — the node currently being dragged (null = no drag)
  onDragStart: (id: string) => void; onDragEnd: () => void;
  onDrop: (target: DnaNode, before: boolean) => void; // reorder dragId to before/after target
  backlinks: Map<string, DnaNode[]>;    // #2 — inbound cross-references
  flashId: string | null;               // #1 — the just-jumped-to node
  proposal: ProposalView | null;        // proposed ops to overlay
  issuesByNode: Map<string, DnaIssue[]>; // #6 — health lints grouped by the node they attach to
  contextId: string | null;             // #7 — the focused node (null = no context active)
  ctxConsumes: Set<string>;             // #7 — ids the focused node REFERENCES (built from)
  ctxConsumedBy: Set<string>;           // #7 — ids that reference the focused node (built on it)
  onContextFocus: (id: string) => void; // #7 — toggle context focus from a kind badge
  seq: Map<string, number>;             // beat/scene → its global reading-order number (shown in the kind badge)
  searchPattern: RegExp | null;         // #8 — the active search panel's pattern (null = panel closed/empty); highlights titles + field values
  proseOpenSet: Set<string>;            // scene ids whose prose block is expanded
  onToggleProse: (id: string) => void;
  onDiscardStory: () => void;
  onAttachNode: (id: string) => void;   // slice 2 — attach this node to the agent's context tray (anchors)
  onOpenProseReader: (sceneId: string) => void; // open the prose reader modal for a scene
  onOpenDetails: (nodeId: string) => void; // open the "view details" modal (authoring provenance)
}
// How much of THIS node's subtree to render. The stage stack (stageLadder.ts) slices the singleton spine —
// seed / premise / pillar — across five ordered cards, so each card shows one node's own fields plus only
// the children that belong to that rung. Never inherited: children always render "all".
//   all      — the whole subtree (the default; the classic nested tree)
//   fields   — NO row of its own: just this node's fields. The stage card's header IS the node's header, so
//              a TreeRow here would be a second title saying the same thing one indent to the right.
//   entities — like `fields`, plus the pillar's cast/world registry groups promoted to this level (the
//              "CAST & WORLD" wrapper is dropped: it had exactly one child group set, so it was an indent
//              level that carried no choice).
export type SubtreeScope = "all" | "fields" | "entities";

export function Subtree({ node, index, nodes, depth, collapsedSet, openSet, h, scope = "all" }: {
  node: DnaNode; index: Map<string, DnaNode>; nodes: DnaNode[]; depth: number;
  collapsedSet: Set<string>; openSet: Set<string>; h: TreeView; scope?: SubtreeScope;
}) {
  const kids = childrenOf(nodes, node.id).sort((a, b) => a.position - b.position);
  const hasKids = kids.length > 0;
  const specs = editSpecs(node.kind);
  // A node is expandable if it has children OR editable fields (entities/scenes have fields but no kids).
  const expandable = hasKids || specs.length > 0;
  // Staged options force the row open regardless of collapse state — a picker the author never sees is
  // useless, and there's no separate "you have options" affordance elsewhere in the tree.
  const hasOptions = Boolean(node.proposals?.length);
  // `rowless` = a sliced rung in the stage ladder: no TreeRow, so nothing to collapse INTO and no indent to
  // hang off — always open, and the body sits at this node's own depth instead of one level in.
  const rowless = scope !== "all";
  const open = rowless || hasOptions || (expandable && (hasKids ? !collapsedSet.has(node.id) : openSet.has(node.id)));
  const bodyDepth = rowless ? depth : depth + 1;
  const toggle = () => (hasKids ? h.onToggle(node.id) : h.onToggleDetail(node.id));
  // A rung whose ONLY editable field is what the card header already names (the seed = its logline) drops the
  // label column too — otherwise the same words appear as heading, as label, and as value.
  const bare = rowless && specs.length === 1;
  const fields = specs.map((spec) => <EditableField key={spec.key} node={node} spec={spec} depth={bodyDepth} index={index} onJump={h.onJump} searchPattern={h.searchPattern} hideLabel={bare} />);
  const hidden = <HiddenFieldsRow node={node} index={index} depth={bodyDepth} />;
  const backlinks = <BacklinksRow node={node} backlinks={h.backlinks} depth={bodyDepth} onJump={h.onJump} />;
  const sub = (items: DnaNode[], d: number) => items.map((child) => (
    <Subtree key={child.id} node={child} index={index} nodes={nodes} depth={d}
      collapsedSet={collapsedSet} openSet={openSet} h={h} />
  ));
  // #1 — phantom add rows the proposal would create under (parentId, kind), rendered before the ＋ add row.
  const phantoms = (parentId: string, kind: string, d: number) =>
    (h.proposal?.addsByParent.get(addKey(parentId, kind)) ?? []).map((add, i) => <PhantomRow key={`ph-${i}`} add={add} depth={d} />);
  // The options picker (any node with staged candidates) renders after this node's own fields, before its
  // children. Generating the candidates is the agent's job (propose_options in the rail); this just picks.
  const lab = open && node.proposals?.length
    ? <ProposalPicker node={node} nodes={nodes} depth={bodyDepth} />
    : null;
  // The hanging "+ next rung" slot for the spine singletons (seed→premise→pillar) — a MANUAL placeholder add,
  // shown once THIS node has real content and its single child rung is still empty. The agent fills it (or
  // creates the rung itself). Deeper rungs (pillar→acts, act→beats) already have AddRows.
  const spineChildKind = SPINE_CHILD[node.kind];
  const nodeEmpty = Object.keys((node.content ?? {}) as Record<string, unknown>).length === 0;
  const spineChildRow = open && spineChildKind && !nodeEmpty && !kids.some((k) => k.kind === spineChildKind)
    ? <AddRow label={`+ ${spineChildKind}`} depth={depth + 1} onAdd={() => h.onAdd(node.id, spineChildKind)} />
    : null;

  // Header actions — a scene with prose gets a read affordance; everything else is agent-driven (the rail).
  const headerActions: React.ReactNode =
    node.kind === "scene" ? <ReadProseButton node={node} onOpenReader={() => h.onOpenProseReader(node.id)} />
    : null;

  // Kebab items — MANUAL adds, plus "view details" (always available). AI generation (options, beats,
  // scenes, prose, regenerate) is the agent's job now, in the rail. (Attach-to-agent-context lives on the
  // row itself as the "@" icon.)
  const kebabItems: KebabItem[] = [
    { label: "ⓘ view details", onClick: () => h.onOpenDetails(node.id) },
  ];
  // Act: add a beat manually
  if (node.kind === "act") {
    kebabItems.push({ label: "+ add beat", color: T.good, onClick: () => h.onAdd(node.id, "beat") });
  }

  // The pillar splits into STORY (the spine) + CAST & WORLD (the registry, sub-grouped by kind); a act
  // can add beats, a beat can add scenes; every other node just renders its editable fields.
  let body: React.ReactNode = null;
  if (open) {
    if (rowless && node.kind !== "pillar") {
      // A sliced rung: this node's own fields only. Its children (and the ghost preview of them) belong to
      // the NEXT stage card, which renders them itself.
      body = <>{fields}{hidden}{backlinks}{lab}</>;
    } else if (node.kind === "pillar") {
      const ladder = kids.filter((c) => !isEntityKind(c.kind));
      const entities = kids.filter((c) => isEntityKind(c.kind));
      // `flat` = promoted to the pillar's own level (stage ladder); otherwise nested under the wrapper.
      const flat = scope === "entities";
      const gd = flat ? bodyDepth : depth + 2; // the per-kind group's depth
      const perKind = ENTITY_GROUPS.map(({ kind, label }) => {
        const items = entities.filter((e) => e.kind === kind);
        const ghosts = kind === "character" ? ghostCast(nodes) : [];
        return (
          <NodeGroup key={kind} groupId={`${node.id}::world::${kind}`} label={label} hint={KIND_EXPLAINER[kind]}
            count={items.length} depth={gd} collapsedSet={collapsedSet} onToggle={h.onToggle} alwaysShow
            action={<GroupAddButton onAdd={() => h.onAdd(node.id, kind)} title={`add ${kind}`} />}
            footer={phantoms(node.id, kind, gd + 1)}>
            {sub(items, gd + 1)}
            <GhostRows items={ghosts} depth={gd + 1} />
          </NodeGroup>
        );
      });
      const registryGroups = flat ? perKind : (
        <NodeGroup groupId={`${node.id}::world`} label="cast & world" hint="the registry"
          count={entities.length} depth={depth + 1} collapsedSet={collapsedSet} onToggle={h.onToggle} alwaysShow>
          {perKind}
        </NodeGroup>
      );
      body = (
        <>
          {fields}
          {hidden}
          {backlinks}
          {lab}
          {/* Foundations (cast & world) first — the materials — then the spine built from them.
              In the stage ladder the "CAST & WORLD" wrapper is DROPPED and its per-kind groups promoted to
              the card's own level: a group with exactly one possible child set is an indent that carries no
              choice, and it was pushing every character three levels deep. Under the classic nested tree the
              wrapper stays, because there it does separate the registry from the spine beside it. */}
          {registryGroups}
          {scope === "entities" ? null : <NodeGroup groupId={`${node.id}::story`} label="story" hint="the spine — acts in order"
            count={ladder.length} depth={depth + 1} collapsedSet={collapsedSet} onToggle={h.onToggle} alwaysShow
            footer={<>
              {phantoms(node.id, "act", depth + 2)}
              <AddRow label="act" depth={depth + 2} onAdd={() => h.onAdd(node.id, "act")} />
            </>}
            action={ladder.length > 0 ? (
              <span onClick={() => h.onDiscardStory()}
                title="Delete all acts, beats, scenes and prose"
                style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: T.bad, cursor: "pointer" }}>
                discard ✕
              </span>
            ) : undefined}>
            {sub(ladder, depth + 2)}
            <GhostRows items={ghostActs(nodes)} depth={depth + 2} />
          </NodeGroup>}
        </>
      );
    } else if (node.kind === "seed") {
      // The seed IS the LOGLINE node — the first DERIVED artifact (protagonist · inciting · goal · obstacle ·
      // stakes). Show that labeled field first, then the lab that forges/refines it, then the BRIEF (the
      // constant, book-level origin it derives FROM — not a tree rung), then the premise child.
      body = (
        <>
          {fields}
          {hidden}
          {backlinks}
          {lab}
          {sub(kids, depth + 1)}
          {spineChildKind && phantoms(node.id, spineChildKind, depth + 1)}
          {spineChildRow}
          <GhostRows items={ghostFromSeed(nodes)} depth={depth + 1} />
        </>
      );
    } else {
      // childAdd only used for phantoms now (beat→scene, act→beat); add/generate moved to header.
      const childAdd = node.kind === "beat" ? "scene" : null;
      body = (
        <>
          {fields}
          {hidden}
          {backlinks}
          {lab}
          {node.kind === "scene" && (
            <ProseBlock node={node} depth={depth + 1} open={h.proseOpenSet.has(node.id)} onToggle={() => h.onToggleProse(node.id)} />
          )}
          {sub(kids, depth + 1)}
          {spineChildKind && phantoms(node.id, spineChildKind, depth + 1)}
          {spineChildRow}
          {childAdd && phantoms(node.id, childAdd, depth + 1)}
          {node.kind === "premise" && <GhostRows items={ghostFromPremise(nodes)} depth={depth + 1} />}
          {node.kind === "act" && <GhostRows items={ghostBeatsForAct(nodes, node)} depth={depth + 1} />}
        </>
      );
    }
  }

  // Delete is allowed on addable kinds when unlocked. For the seed/premise/pillar singletons we allow delete
  // ONLY when a duplicate of that kind exists — so you can clean up stray/duplicated anchors (e.g. a second
  // STALE seed) without ever orphaning the tree by removing its sole anchor.
  const isSingleton = SINGLETON_KINDS.includes(node.kind);
  const isDuplicatedSingleton = isSingleton && nodes.filter((n) => n.kind === node.kind).length > 1;
  const deletable = !node.authoring.locked && (isEntityKind(node.kind) || ["act", "beat", "scene"].includes(node.kind) || isDuplicatedSingleton);
  // #5 — drag-to-reorder among same-kind siblings (entities by kind under the pillar; act/beat/scene by
  // parent). A row is a drop target only while a SIBLING (same parent + kind) is being dragged.
  const reorderable = isEntityKind(node.kind) || ["act", "beat", "scene"].includes(node.kind);
  const dragged = h.dragId ? index.get(h.dragId) : null;
  const canDrop = !!dragged && dragged.id !== node.id && dragged.parent_id === node.parent_id && dragged.kind === node.kind;
  // #1 proposal mark for THIS node.
  const editPatch = h.proposal?.edits.get(node.id);
  const mark = h.proposal ? (h.proposal.deletes.has(node.id) ? "delete" : editPatch ? "edit" : undefined) : undefined;
  // #6 this node's lints (row badge). #7 context-highlight: this node's role in the focused neighborhood.
  const issues = h.issuesByNode.get(node.id);
  const ctxActive = h.contextId !== null;
  const ctx = !ctxActive ? undefined
    : node.id === h.contextId ? "focus"
      : h.ctxConsumes.has(node.id) ? "consumes"
        : h.ctxConsumedBy.has(node.id) ? "consumedBy" : undefined;
  // Dim when: context active + not in the neighborhood.
  const dimmed = ctxActive && !ctx;

  // Stale actions — accept/discard for any stale node (staleActions.ts is the one implementation,
  // shared with the FocusPanel).
  const staleActions = staleActionsFor(node, index);

  // A sliced rung has no row of its own — the stage card's header is its header, and it renders the node's
  // affordances (NodeChips) up there. Proposal marks still land: the OpDiffBlock below is what shows an
  // agent's proposed edit, and it doesn't depend on the row.
  if (rowless) {
    return (
      <div id={`dna-node-${node.id}`} style={{ background: h.flashId === node.id ? `${T.accent}1a` : undefined, borderRadius: 4, transition: "background 0.4s" }}>
        {editPatch && <OpDiffBlock node={node} content={editPatch} nodes={nodes} depth={bodyDepth} />}
        {body}
      </div>
    );
  }

  return (
    <div>
      <TreeRow node={node} index={index} depth={depth} expandable={expandable} open={open} lockedOpen={hasOptions} onToggle={toggle}
        seq={h.seq.get(node.id)} searchPattern={h.searchPattern}
        onDelete={deletable ? () => h.onDelete(node) : undefined}
        onAttach={() => h.onAttachNode(node.id)}
        kebabItems={kebabItems.length ? kebabItems : undefined}
        draggable={reorderable} dragging={h.dragId === node.id} canDrop={canDrop}
        onDragStartRow={() => h.onDragStart(node.id)} onDragEndRow={h.onDragEnd}
        onDropRow={(before) => h.onDrop(node, before)}
        mark={mark} flash={h.flashId === node.id} issues={issues} dimmed={dimmed}
        ctx={ctx} onContextFocus={() => h.onContextFocus(node.id)} prose={proseRollup(node, nodes)}
        headerActions={headerActions} staleActions={staleActions} />
      {editPatch && <OpDiffBlock node={node} content={editPatch} nodes={nodes} depth={depth + 1} />}
      {body}
    </div>
  );
}
