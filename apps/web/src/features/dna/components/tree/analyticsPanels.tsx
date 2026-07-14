// analyticsPanels — the read-only "understanding" projections of the tree, lifted out of DnaOverview so the
// analytics tab is the ONE place you go to comprehend the whole book at once. Overview keeps the actionable
// half (next move · threads · issues · navigable tree); everything here is a pure projection — no generation,
// no mutation, except PromisesPanel's Waive (the author's explicit "leave this debt open on purpose" gesture).
// Every row jumps back into the stage that owns the node it's about, so the report doubles as a jump table.
import { useState } from "react";
import { Activity, ArrowRight, HandCoins, Network } from "lucide-react";
import { ActionLink, Eyebrow, Panel } from "@/components/book/shared/studioUi";
import { DnaFullDiagram } from "@/features/dna/components/DnaStageDiagram";
import { DnaStoryMap } from "@/features/dna/components/DnaStoryMap";
import { patchNodeContent } from "@/features/dna/lib/bookNodes";
import { KIND_STAGE, type StageKey } from "@/features/dna/lib/dnaJourney";
import {
  obligationLedger, openObligations,
  type DnaNode, type NodeKind, type Obligation, type SceneContent,
} from "@/features/dna/lib/novelDna";

const FAINT = "text-[hsl(var(--pv-text-faint))]";
const MUTED = "text-[hsl(var(--pv-text-muted))]";

// ── THE SHAPE — the whole DNA as one connected pipeline, live; each band jumps to its stage. ──────────────
export function ShapePanel({ nodes, onOpen }: { nodes: DnaNode[]; onOpen: (k: StageKey, focusId?: string) => void }) {
  return (
    <Panel variant="soft" className="px-4 py-3.5">
      <div className="mb-2.5 flex items-center gap-2">
        <Network className={`h-3.5 w-3.5 ${FAINT}`} />
        <Eyebrow tone="muted">The shape — root → web → spine → scenes → pages</Eyebrow>
      </div>
      <DnaFullDiagram nodes={nodes} onOpen={onOpen} />
    </Panel>
  );
}

// ── STORY MAP — the detailed spine: the emotional contour over every beat (∴/↯ connectors, ↗/↘ turns) and
// its scenes; click any row to drill straight to that node. Nothing to map before there are acts. ──────────
export function StoryMapPanel({ nodes, onOpen }: { nodes: DnaNode[]; onOpen: (k: StageKey, focusId?: string) => void }) {
  if (!nodes.some((n) => n.kind === "act")) return null;
  return (
    <Panel variant="soft" className="px-4 py-3.5">
      <div className="mb-2.5 flex items-center gap-2">
        <Activity className={`h-3.5 w-3.5 ${FAINT}`} />
        <Eyebrow tone="muted">Story map — the shape of the telling, beat by beat</Eyebrow>
      </div>
      <DnaStoryMap nodes={nodes} onOpen={onOpen} />
    </Panel>
  );
}

// ── AT A GLANCE — the census. ─────────────────────────────────────────────────────────────────────────────
export function CensusPanel({ nodes }: { nodes: DnaNode[] }) {
  const of = (k: NodeKind) => nodes.filter((n) => n.kind === k);
  const scenes = of("scene");
  const drafted = scenes.filter((s) => (s.content as SceneContent).prose?.text?.trim()).length;
  const stat = (label: string, n: number, total?: number) => (
    <span className={`pv-mono text-[10px] uppercase tracking-[0.1em] ${n === 0 ? FAINT : MUTED}`}>
      <b className={`font-semibold ${n === 0 ? FAINT : "text-foreground"}`}>{total != null ? `${n}/${total}` : n}</b> {label}
    </span>
  );
  return (
    <Panel variant="soft" className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
      {stat("acts", of("act").length)}
      {stat("beats", of("beat").length)}
      {stat("scenes", scenes.length)}
      {scenes.length > 0 && stat("drafted", drafted, scenes.length)}
      {of("character").length > 0 && stat("cast", of("character").length)}
      {of("thread").length > 0 && stat("threads", of("thread").length)}
      {of("game").length > 0 && stat("games", of("game").length)}
    </Panel>
  );
}

// ── PROMISES — the obligation ledger, pressure-ordered (novelDna.obligationLedger/openObligations): every debt
// the book owes the reader, across all six axes (thread/game/state_key/tentpole/entity_intro/contract —
// contract is the GENRE promise, a meter's compiled target curve), stalest-open first. A row with a backing
// node (everything but state_key — a bare causal key, nothing to point at) gets a Waive action: the author's
// direct "leave this open on purpose" gesture (a sequel hook, or "we're not chasing this convention"), same
// field (`content.waived`) the agent proposes via propose_node_ops — the manual, no-agent-round-trip path.
const KIND_LABEL: Record<Obligation["kind"], string> = {
  thread: "thread", game: "game", state_key: "state key", tentpole: "tentpole", entity_intro: "meet", contract: "genre",
};

function PromiseRow({ o, node, onOpen }: { o: Obligation; node?: DnaNode; onOpen: (k: StageKey, focusId?: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const waive = async () => {
    if (!node) return;
    setBusy(true); setErr(null);
    try { await patchNodeContent(node, { waived: true }); }
    catch (e) { setErr(String((e as Error)?.message ?? e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <button type="button" className="group flex min-w-0 flex-1 items-start gap-2 text-left"
        onClick={() => node && onOpen(KIND_STAGE[node.kind] ?? "structure", node.id)}>
        <span className={`mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full ${o.state === "open" ? "bg-amber-500" : "bg-[hsl(var(--pv-text-faint))]/60"}`} />
        <p className="pv-serif min-w-0 text-[12px] leading-snug">
          <span className={`pv-mono mr-1.5 text-[9px] uppercase tracking-[0.08em] ${FAINT}`}>{KIND_LABEL[o.kind]}</span>
          <span className="font-medium text-foreground">"{o.name}"</span>
          {o.promise && <span className={`ml-1 ${MUTED}`}>— {o.promise.slice(0, 90)}</span>}
          <span className={`ml-1.5 pv-mono text-[9px] ${FAINT}`}>
            ({o.state}{o.quiet ? ` · quiet ${o.quiet}` : ""})
          </span>
          {node && <ArrowRight className={`ml-1 inline h-2.5 w-2.5 opacity-0 transition-opacity group-hover:opacity-100 ${FAINT}`} />}
        </p>
      </button>
      {node && (
        <ActionLink tone="faint" busy={busy} onClick={waive} className="shrink-0 text-[10px]">Waive</ActionLink>
      )}
      {err && <span className="pv-mono text-[9px] text-rose-500">{err}</span>}
    </div>
  );
}

export function PromisesPanel({ nodes, index, onOpen }: { nodes: DnaNode[]; index: Map<string, DnaNode>; onOpen: (k: StageKey, focusId?: string) => void }) {
  const ledger = obligationLedger(nodes);
  const open = openObligations(nodes);
  const settled = ledger.length - open.length;
  return (
    <Panel variant="soft" className="px-4 py-3.5">
      <div className="mb-2.5 flex items-center gap-2">
        <HandCoins className={`h-3.5 w-3.5 ${FAINT}`} />
        <Eyebrow tone="muted">Promises — what this book still owes the reader{ledger.length > 0 ? ` (${settled}/${ledger.length} settled)` : ""}</Eyebrow>
      </div>
      {ledger.length === 0 && <p className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))]">Nothing tracked yet — a thread, game, tentpole, or cast member starts owing a promise once it's accepted.</p>}
      {ledger.length > 0 && open.length === 0 && <p className="pv-serif text-[13px] text-emerald-500">Every promise is paid or waived.</p>}
      {open.length > 0 && (
        <div className="mt-1 divide-y divide-[hsl(var(--pv-border-soft))]/40">
          {open.map((o) => <PromiseRow key={o.id} o={o} node={index.get(o.ref)} onOpen={onOpen} />)}
        </div>
      )}
    </Panel>
  );
}
