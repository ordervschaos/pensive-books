// StageStack — the tree tab's LINEAR LADDER: five ordered stage cards the author walks top to bottom.
//
// The problem it solves: the DNA tree's top is a chain of SINGLETONS (one seed → one premise → one pillar),
// and rendering that chain as nesting spent three indent levels saying "these happen in order" — the order
// was encoded in indentation, where it reads as containment instead of sequence. Here the chain is
// FLATTENED into sibling cards on a numbered spine; only the genuinely 1:N part of the tree (acts → beats →
// scenes → prose) keeps its nesting, inside card 5.
//
// The DATA is untouched: book_nodes is still the same parent/child tree, every write still goes through the
// same saveNode/applyNodeOps paths, and the agent still sees one tree. This file is projection only — a
// different cut of the same nodes (cf. lib/novelDnaRender, which cuts the same tree into pages).
//
// Stage → content:
//   1 brief & vision   books.brief + brief.vision (NOT a node — the origin the seed derives from)
//   2 seed             the seed node's own fields (the logline)
//   3 premise & shape  the premise node's own fields (dramatic question + shape)
//   4 pillar           the pillar node's fields + the CAST & WORLD registry hanging off it
//   5 story            the acts, each a full nested subtree (beats → scenes → prose)
//   +  unplaced        a safety net: any node this cut would otherwise render nowhere
import { useCallback, useState } from "react";
import type { Brief } from "@/lib/brief";
import { childrenOf, isEntityKind, type DnaNode } from "@/features/dna/lib/novelDna";
import { ghostActs } from "@/features/dna/lib/dnaSkeleton";
import { MONO, SERIF, T } from "./treeChrome";
import { AddRow, Subtree, type SubtreeScope, type TreeView } from "./Subtree";
import { NodeChips } from "./TreeRow";
import { staleActionsFor } from "./staleActions";
import { GhostRows } from "./GhostRows";
import { BriefOrigin } from "./BriefSection";
import { buildLadder, type LadderKey, type LadderStage } from "./stageLadder";

// The numbered spine's geometry — the gutter the discs and the connecting line live in. Kept tight: this
// column is pure wayfinding, and every pixel here is one the author's actual prose doesn't get.
const GUTTER = 26;
const DISC = 18;

// ── One rung ─────────────────────────────────────────────────────────────────
// A numbered disc on a continuous vertical line (the "ladder"), a header, and a collapsible body. The disc
// hue IS the status: green = done, accent ring = the current rung, faint = not reached yet. Cards are never
// disabled — the tree is start-anywhere, so an unreached rung is dimmed, not locked.
function StageCard({ stage, open, onToggle, last, children, action, chips }: {
  stage: LadderStage; open: boolean; onToggle: () => void; last?: boolean;
  children: React.ReactNode; action?: React.ReactNode;
  chips?: React.ReactNode; // the rung node's own affordances (NodeChips) — this header IS its row
}) {
  const hue = stage.status === "done" ? T.good : stage.status === "now" ? T.accent : T.faint;
  return (
    <div style={{ display: "flex", alignItems: "stretch", position: "relative" }}>
      {/* The spine gutter: the connecting line, then the disc drawn over it */}
      <div style={{ width: GUTTER, flexShrink: 0, position: "relative" }}>
        {!last && (
          <span style={{ position: "absolute", left: GUTTER / 2 - 0.5, top: 11 + DISC, bottom: 0, width: 1, background: T.border }} />
        )}
        <span style={{
          position: "absolute", left: (GUTTER - DISC) / 2, top: 10, width: DISC, height: DISC, borderRadius: "50%",
          background: stage.status === "done" ? hue : T.raised, border: `1.5px solid ${hue}`,
          color: stage.status === "done" ? T.paper : hue,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: MONO, fontSize: 9.5, fontWeight: 600, lineHeight: 1,
        }}>
          {stage.status === "done" ? "✓" : stage.num}
        </span>
      </div>

      {/* The rung itself */}
      <div style={{ flex: 1, minWidth: 0, paddingBottom: last ? 0 : 14 }}>
        <div onClick={onToggle} title={stage.caption}
          style={{
            display: "flex", alignItems: "baseline", gap: 10, cursor: "pointer", minWidth: 0,
            padding: "12px 12px 8px 0", opacity: stage.status === "ahead" ? 0.72 : 1,
          }}>
          <span style={{ fontSize: 9, color: T.muted, flexShrink: 0, alignSelf: "center" }}>{open ? "▾" : "▸"}</span>
          <span style={{ fontFamily: MONO, fontSize: 11.5, letterSpacing: "0.2em", textTransform: "uppercase", color: stage.status === "ahead" ? T.muted : T.ink, flexShrink: 0 }}>
            {stage.label}
          </span>
          <span style={{ fontFamily: SERIF, fontSize: 12.5, fontStyle: "italic", color: T.faint, flexShrink: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {stage.caption}
          </span>
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexShrink: 0, paddingLeft: 12 }}>
            <span style={{ fontFamily: MONO, fontSize: 10, color: T.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 360 }}>
              {stage.summary}
            </span>
            {action && <span onClick={(e) => e.stopPropagation()}>{action}</span>}
            {chips && <span onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center" }}>{chips}</span>}
          </span>
        </div>
        {open && <div style={{ paddingBottom: 6 }}>{children}</div>}
      </div>
    </div>
  );
}

// The muted line an empty rung shows in place of content, with the manual "＋ <kind>" add beside it. The
// agent normally mints these rungs; the add row is the hand-authored escape hatch that already existed as
// the tree's `spineChildRow`.
function EmptyRung({ what }: { what: string }) {
  return (
    <div style={{ padding: "2px 12px 4px 4px", fontFamily: SERIF, fontSize: 13, fontStyle: "italic", color: T.faint }}>
      not drafted yet — {what}
    </div>
  );
}

export function StageStack({ nodes, index, brief, onSaveBrief, collapsedSet, openSet, h, bookId }: {
  nodes: DnaNode[]; index: Map<string, DnaNode>; brief: Brief | null;
  onSaveBrief: (patch: Partial<Brief>) => Promise<void>;
  collapsedSet: Set<string>; openSet: Set<string>; h: TreeView; bookId: number;
}) {
  const stages = buildLadder(nodes, brief);

  // Per-book, per-rung open state. Default OPEN for every rung: the point of the ladder is that the whole
  // book is legible in order at a glance — auto-folding "done" rungs would hide work the author still edits.
  const key = `dna-stage-closed:${bookId}`;
  const [closed, setClosed] = useState<Set<LadderKey>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as LadderKey[]); } catch { return new Set(); }
  });
  const toggle = useCallback((k: LadderKey) => {
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      try { localStorage.setItem(key, JSON.stringify([...next])); } catch { /* private mode */ }
      return next;
    });
  }, [key]);

  const of = (kind: DnaNode["kind"]) => nodes.filter((n) => n.kind === kind).sort((a, b) => a.position - b.position);
  const seeds = of("seed"), premises = of("premise"), pillars = of("pillar");
  const acts = of("act");
  const pillar = pillars[0];

  const sliced = (list: DnaNode[], scope: SubtreeScope) =>
    list.map((n) => (
      <Subtree key={n.id} node={n} index={index} nodes={nodes} depth={0}
        collapsedSet={collapsedSet} openSet={openSet} h={h} scope={scope} />
    ));

  // Safety net: this is a FILTERED view, and a filtered view's failure mode is data that renders nowhere.
  // Anything whose kind isn't claimed by a rung, and which isn't a descendant of one that is, surfaces here
  // rather than silently vanishing. (Entities live under the pillar → card 4; beats/scenes under acts → card 5.)
  const claimed = new Set<string>();
  const claim = (n: DnaNode) => { claimed.add(n.id); for (const c of childrenOf(nodes, n.id)) claim(c); };
  for (const n of [...seeds, ...premises, ...pillars]) claimed.add(n.id);
  for (const n of nodes) if (isEntityKind(n.kind) && n.parent_id && claimed.has(n.parent_id)) claimed.add(n.id);
  for (const a of acts) claim(a);
  const unplaced = nodes.filter((n) => !claimed.has(n.id));

  const body: Record<LadderKey, React.ReactNode> = {
    // The brief is book-level state (books.brief), not a node — hence its own save path and no TreeRow.
    brief: <BriefOrigin brief={brief} onSave={onSaveBrief} open bare />,
    seed: seeds.length ? sliced(seeds, "fields") : <EmptyRung what="the seed holds the logline" />,
    premise: premises.length ? sliced(premises, "fields") : (
      <>
        <EmptyRung what="the dramatic question the book answers" />
        <GhostRows items={[{ kind: "premise", title: "Premise", hint: "the dramatic question" }]} depth={1} />
        {seeds[0] && <AddRow label="+ premise" depth={1} onAdd={() => h.onAdd(seeds[0].id, "premise")} />}
      </>
    ),
    pillar: pillars.length ? sliced(pillars, "entities") : (
      <>
        <EmptyRung what="the controlling idea, the ending, and the cast they need" />
        <GhostRows items={[{ kind: "pillar", title: "Pillar", hint: "controlling idea · ending" }]} depth={1} />
        {premises[0] && <AddRow label="+ pillar" depth={1} onAdd={() => h.onAdd(premises[0].id, "pillar")} />}
      </>
    ),
    story: (
      <>
        {sliced(acts, "all")}
        <GhostRows items={ghostActs(nodes)} depth={1} />
        {pillar && <AddRow label="act" depth={1} onAdd={() => h.onAdd(pillar.id, "act")} />}
      </>
    ),
  };

  // Cards 2–4 render their node WITHOUT a TreeRow, so the node's own affordances — status dot, id, stale
  // accept/regen, attach-to-agent, the kebab — ride in the card header instead. Same NodeChips the tree row
  // uses, so there is one implementation of these controls, not two.
  const rungNode: Partial<Record<LadderKey, DnaNode>> = { seed: seeds[0], premise: premises[0], pillar };
  const chipsFor = (k: LadderKey) => {
    const n = rungNode[k];
    if (!n) return undefined;
    return (
      <NodeChips node={n} index={index} issues={h.issuesByNode.get(n.id)}
        mark={h.proposal?.deletes.has(n.id) ? "delete" : h.proposal?.edits.get(n.id) ? "edit" : undefined}
        staleActions={staleActionsFor(n, index)}
        onAttach={() => h.onAttachNode(n.id)}
        kebabItems={[{ label: "ⓘ view details", onClick: () => h.onOpenDetails(n.id) }]} />
    );
  };

  return (
    <div style={{ padding: "4px 16px 8px" }}>
      {stages.map((s, i) => (
        <StageCard key={s.key} stage={s} last={i === stages.length - 1 && !unplaced.length}
          open={!closed.has(s.key)} onToggle={() => toggle(s.key)} chips={chipsFor(s.key)}
          action={s.key === "story" && acts.length ? (
            <span onClick={() => h.onDiscardStory()} title="Delete all acts, beats, scenes and prose"
              style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: T.bad, cursor: "pointer" }}>
              discard ✕
            </span>
          ) : undefined}>
          {body[s.key]}
        </StageCard>
      ))}

      {unplaced.length > 0 && (
        <StageCard last
          stage={{ key: "story", num: 0, label: "unplaced", caption: "nodes outside the ladder — a broken parent link", status: "now", summary: `${unplaced.length} node${unplaced.length === 1 ? "" : "s"}`, jump: "structure" }}
          open onToggle={() => {}}>
          {sliced(unplaced, "all")}
        </StageCard>
      )}
    </div>
  );
}
