// DnaStudio — the four-verb authoring surface for the Novel DNA tree (Phase 4/5). The book IS the tree
// (docs/novel-dna-schema.md); this is the "hungry structure" the author fills. One uniform NodeCard for
// every kind (the self-similar promise: learn generate/edit/lock once). Styled with the studio's own
// primitives (studioUi) so it reads as part of the Build Studio. Live projection of book_nodes; pages are
// produced on demand via reconcileDna (Render). expand = ONE authoritative value (not proposals).
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Lock, Unlock, BookOpen, Loader2, Check, X, ChevronRight, ChevronDown, LayoutDashboard, GripVertical, Image } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { ActionLink, Eyebrow, Panel, StageHead, StepDot } from "@/components/book/shared/studioUi";
import { buildJourney, stageSubsteps, STAGE_KINDS, type StageKey } from "@/features/dna/lib/dnaJourney";
import { AgentRail } from "@/features/dna/components/AgentRail";
import { DnaVisuals } from "@/features/dna/components/DnaVisuals";
import { DnaStageDiagram } from "@/features/dna/components/DnaStageDiagram";
import { DnaOverview } from "@/features/dna/components/DnaOverview";
import { saveNode, saveNodes, deleteNode } from "@/features/dna/lib/bookNodes";
import { migrateBookToDna } from "@/features/dna/lib/migrateToDna";
import { reconcileDna } from "@/features/dna/lib/novelDnaRender";
import {
  byId, childrenOf, editContent, emptyNode, isIllusStale, isProseStale, isStale, lock as lockNode, renderBlockers, scenesInOrder,
  setStatus, type BeatContent, type CharacterContent, type DnaNode, type GameContent, type ActContent,
  type NodeKind, type RelationshipContent, type SceneContent, type ThreadContent, type WorldFactContent,
} from "@/features/dna/lib/novelDna";

// Human-readable display name for kinds that have internal/technical names.
const KIND_DISPLAY: Partial<Record<NodeKind, string>> = { act: "act", world_fact: "world rule" };

// The meaningful fields the UI exposes per kind (★/U slots; dotted keys reach into nested content).
const FIELDS: Partial<Record<NodeKind, { key: string; label: string }[]>> = {
  seed: [{ key: "logline", label: "logline" }],
  premise: [
    { key: "dramatic_question", label: "dramatic question" },
    { key: "shape.setup", label: "setup" },
    { key: "shape.turn1", label: "turn 1" },
    { key: "shape.turn2", label: "turn 2 ★" },
    { key: "shape.turn3", label: "turn 3" },
    { key: "shape.resolution", label: "resolution ★" },
  ],
  pillar: [{ key: "controlling_idea", label: "controlling idea" }, { key: "ending", label: "ending ★" }],
  character: [
    { key: "name", label: "name" },
    { key: "role", label: "role" },
    { key: "want", label: "want" },
    { key: "need", label: "need ★" },
    { key: "wound", label: "wound ★" },
    { key: "lie", label: "lie ★" },
    { key: "truth", label: "truth ★" },
    { key: "idiolect", label: "idiolect" },
    { key: "tag", label: "physical tag" },
    { key: "history", label: "history" },
  ],
  relationship: [{ key: "bond", label: "bond" }, { key: "charge", label: "charge" }],
  tentpole: [{ key: "summary", label: "tent-pole ★" }],
  world_fact: [
    { key: "name", label: "name" },
    { key: "rule", label: "rule" },
    { key: "mechanism", label: "mechanism (what it enables/forbids) ★" },
    { key: "category", label: "category" },
  ],
  thread: [
    { key: "name", label: "name" },
    { key: "kind", label: "kind (mystery/foreshadow/setup_payoff/arc)" },
    { key: "promise", label: "promise ★" },
    { key: "payoff", label: "payoff ★" },
  ],
  game: [
    { key: "name", label: "name" },
    { key: "win_condition", label: "conditions to win ★" },
    { key: "lose_condition", label: "conditions to lose ★" },
    { key: "stake", label: "stake" },
  ],
  act: [
    { key: "title", label: "title" },
    { key: "goal", label: "goal" },
    { key: "turning_point", label: "turning point ★" },
    { key: "target_pct", label: "target position (0–1) ★" },
    { key: "value.name", label: "value axis" },
    { key: "value.from", label: "value: starts as" },
    { key: "value.to", label: "value: ends as ★" },
  ],
  beat: [
    { key: "summary", label: "beat ★" },
    { key: "connector", label: "connector (therefore/but)" },
    { key: "polarity", label: "polarity (up/down)" },
    { key: "needs", label: "needs (state keys, comma-separated)" },
    { key: "establishes", label: "establishes (state keys, comma-separated)" },
    { key: "grounds_in", label: "grounds in (world rules, comma-separated)" },
  ],
  scene: [
    { key: "chapter_start.title", label: "chapter title (blank = mid-chapter)" },
    { key: "loc", label: "location" },
    { key: "goal", label: "goal" },
    { key: "conflict", label: "conflict" },
    { key: "outcome", label: "outcome ★" },
    { key: "value_shift.value", label: "value axis" },
    { key: "value_shift.from", label: "value: starts as" },
    { key: "value_shift.to", label: "value: ends as ★" },
    { key: "value_shift.polarity", label: "polarity (up/down)" },
    { key: "prose.text", label: "prose" },
  ],
};

const getPath = (obj: Record<string, unknown>, path: string): string => {
  const v = path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(String).join(", ");
  return "";
};
// Numeric content fields (kept as numbers in jsonb so the engine's pacing() reads them).
const NUMERIC_KEYS = new Set(["target_pct"]);
// Array content fields (stored as string[] in jsonb; edited as comma-separated in the UI).
const ARRAY_KEYS = new Set(["needs", "establishes", "grounds_in"]);
// Fields that render as a <select> instead of a textarea.
const SELECT_FIELDS: Record<string, string[]> = {
  role: ["protagonist", "antagonist", "ally", "love_interest", "minor"],
  connector: ["therefore", "but"],
  polarity: ["up", "down"],
  "value_shift.polarity": ["up", "down"],
};
const setPath = (path: string, value: string): Record<string, unknown> => {
  const keys = path.split(".");
  const leaf = keys[keys.length - 1];
  const coerced: unknown = NUMERIC_KEYS.has(leaf)
    ? (value.trim() === "" ? undefined : Number(value))
    : ARRAY_KEYS.has(leaf)
      ? value.split(",").map((s) => s.trim()).filter(Boolean)
      : value;
  const root: Record<string, unknown> = {};
  let cur = root;
  keys.forEach((k, i) => { if (i === keys.length - 1) cur[k] = coerced; else { cur[k] = {}; cur = cur[k] as Record<string, unknown>; } });
  return root;
};
export interface DnaSettings { title?: string; author?: string; word_target?: number; mode?: "prose" | "picture" }

export function DnaStudio({ bookId, bookSlug, settings, nodes, onChanged }: {
  bookId: number; bookSlug: string; settings: DnaSettings; nodes: DnaNode[]; onChanged: () => void;
}) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [view, setView] = useState<"overview" | "visuals" | StageKey>("overview"); // "overview" = the dashboard; "visuals" = the non-gating Visuals section; else a stage
  const [flashId, setFlashId] = useState<string | null>(null); // a node to scroll-to + briefly ring (drill-in from the map)
  const [foundationsTab, setFoundationsTab] = useState<"pillar" | "character" | "world_fact" | "game" | "tentpole" | "relationship">("pillar");
  const [structureTab, setStructureTab] = useState<"acts" | "beats">("acts");
  const index = byId(nodes);
  const of = (kind: NodeKind) => nodes.filter((n) => n.kind === kind);
  const blockers = renderBlockers(nodes, settings);
  // Picture-book mode (docs/picture-book-mode.md): the Draft rung ILLUSTRATES each scene (image + caption)
  // instead of writing prose. A book-level choice on books.mode; the tree above the scene is mode-agnostic.
  const picture = settings.mode === "picture";

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try { await fn(); onChanged(); }
    catch (e) { toast({ title: `Couldn't ${label}`, description: String((e as Error)?.message ?? e), variant: "destructive" }); }
    finally { setBusy(null); }
  };
  const migrate = () => run("migrate", async () => { const { count } = await migrateBookToDna(bookId); toast({ title: "Migrated to DNA", description: `${count} nodes built from the legacy book.` }); });
  const render = () => run("render", async () => { const r = await reconcileDna(bookId); toast({ title: "Rendered", description: `${r.pages} pages · ${r.created} added · ${r.updated} updated · ${r.archived} archived.` }); });
  // Render-then-read: project the tree onto pages FIRST (idempotent), then open the reader — so the prose
  // you read is always current, never the stale "I forgot to render" page. One click instead of two.
  const renderAndRead = () => run("read", async () => { await reconcileDna(bookId); window.location.href = `/books/${bookSlug}`; });
  const addChild = (parent: DnaNode, kind: NodeKind, level: number) =>
    run("add", () => saveNode(emptyNode(bookId, kind, level, parent.id, childrenOf(nodes, parent.id).length)));

  // ── Collapse state — keep the long stages an OUTLINE, not a wall. A node defaults OPEN only while it (or
  // anything beneath it) still needs work; once a whole branch is accepted + in-sync it folds to a one-line
  // row. `expanded` holds explicit user toggles layered on top of that smart default. Cheap full-tree walk
  // (trees are small) so it stays correct as nodes change without a memo/deps dance.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const needsAttn = (n: DnaNode) => n.authoring.status !== "accepted" || isStale(n, index) || (n.kind === "scene" && (picture ? isIllusStale(n) : isProseStale(n)));
  const attn = (() => {
    const s = new Set<string>();
    const visit = (n: DnaNode): boolean => {
      let r = needsAttn(n);
      for (const c of childrenOf(nodes, n.id)) if (visit(c)) r = true;
      if (r) s.add(n.id);
      return r;
    };
    for (const root of nodes.filter((n) => n.parent_id === null)) visit(root);
    return s;
  })();
  const openDefault = (n: DnaNode) => attn.has(n.id);
  const isOpen = (n: DnaNode) => expanded[n.id] ?? openDefault(n);
  const toggle = (n: DnaNode) => setExpanded((e) => ({ ...e, [n.id]: !(e[n.id] ?? openDefault(n)) }));
  const setAll = (open: boolean) => setExpanded(Object.fromEntries(nodes.map((n) => [n.id, open])));
  // The collapsed-row subtitle for a spine parent: how many children, and how many still need work.
  const collapsedMeta = (n: DnaNode): string | undefined => {
    if (n.kind !== "act" && n.kind !== "beat") return undefined;
    const childKind: NodeKind = n.kind === "act" ? "beat" : "scene";
    const kids = childrenOf(nodes, n.id).filter((c) => c.kind === childKind);
    if (!kids.length) return undefined;
    const need = kids.filter((k) => attn.has(k.id)).length;
    return `${kids.length} ${childKind}${kids.length > 1 ? "s" : ""}${need ? ` · ${need} need work` : ""}`;
  };

  const card = (n: DnaNode, accent?: boolean) => (
    <NodeCard key={n.id} node={n} index={index} bookId={bookId} kids={childrenOf(nodes, n.id)} onChanged={onChanged}
      accent={accent} expanded={isOpen(n)} onToggle={() => toggle(n)} meta={collapsedMeta(n)} picture={picture} flash={flashId === n.id} />
  );
  const [seed, premise, pillar] = [of("seed")[0], of("premise")[0], of("pillar")[0]];
  const entityKinds: NodeKind[] = ["character", "relationship", "tentpole", "world_fact"];

  // The guided journey: ordered stages of increasing resolution. The studio opens on the Overview; from there
  // (or the Navigator) the author picks a stage. `view` is "overview" or a stage key; activeKey resolves the
  // stage in focus (falling back to the live "now" stage, e.g. while on Overview the rail follows "now").
  const { stages, nowIndex } = buildJourney(nodes, picture ? "picture" : "prose");
  const nowKey = stages[nowIndex]?.key ?? "premise";
  const selectable = (k: StageKey) => stages.find((s) => s.key === k)?.status !== "locked";
  const onOverview = view === "overview";
  const onVisuals = view === "visuals";
  // Treat "visuals" as a non-stage view (like "overview") so activeKey is only set for real stages.
  const activeKey: StageKey = (view !== "overview" && view !== "visuals" && selectable(view)) ? view : nowKey;
  // Open a stage, optionally drilling to a specific node: reveal it (expand it + every ancestor so it isn't
  // hidden under a folded parent), then flash it (the scroll-into-view + ring runs in an effect below).
  const openStage = (k: StageKey, focusId?: string) => {
    if (!selectable(k)) { setView("overview"); return; }
    setView(k);
    if (focusId) {
      const chain = new Set<string>();
      for (let cur: DnaNode | undefined = index.get(focusId); cur; cur = cur.parent_id ? index.get(cur.parent_id) : undefined) chain.add(cur.id);
      setExpanded((e) => { const next = { ...e }; for (const id of chain) next[id] = true; return next; });
      setFlashId(focusId);
    } else setFlashId(null);
  };
  // Scroll the freshly-focused node into view once the target stage has rendered; clear the ring after a beat.
  useEffect(() => {
    if (!flashId) return;
    const scroll = window.setTimeout(() => document.getElementById(`dna-node-${flashId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
    const clear = window.setTimeout(() => setFlashId(null), 2000);
    return () => { window.clearTimeout(scroll); window.clearTimeout(clear); };
  }, [flashId, view]);
  const active = stages.find((s) => s.key === activeKey)!;
  const nextStage = stages[stages.findIndex((s) => s.key === activeKey) + 1];

  const renderStage = (key: StageKey) => {
    if (key === "premise") {
      const seedEmpty = seed && !(seed.content as { logline?: string }).logline?.trim();
      return (
        <>
          {seedEmpty && (
            <div className="rounded-xl border border-dashed border-[hsl(var(--pv-border-soft))]/70 bg-[hsl(var(--pv-surface-2))]/40 px-5 py-5 text-center">
              <p className="pv-serif text-[14px] text-[hsl(var(--pv-text-muted))]">Start with a logline</p>
              <p className="pv-serif mt-1 text-[12.5px] italic text-[hsl(var(--pv-text-faint))]">
                One sentence: who wants what, who or what stands in the way, and what's at stake.
              </p>
            </div>
          )}
          {[seed, premise].filter(Boolean).map((n) => card(n!))}
        </>
      );
    }
    if (key === "foundations") {
      const FOUND_TABS = [
        { key: "pillar" as const, label: "Pillar" },
        { key: "character" as const, label: "Cast" },
        { key: "world_fact" as const, label: "World" },
        { key: "game" as const, label: "Games" },
        { key: "tentpole" as const, label: "Tent-poles" },
        { key: "relationship" as const, label: "Relationships" },
      ] as const;
      const tab = foundationsTab;
      return (
        <>
          {/* Tab bar — quick navigation between the 5 foundation layers */}
          <div className="flex gap-0.5 border-b border-[hsl(var(--pv-border-soft))] mb-4 -mx-1 px-1">
            {FOUND_TABS.map((t) => {
              const count = t.key !== "pillar" ? of(t.key as NodeKind).length : null;
              return (
                <button key={t.key} onClick={() => setFoundationsTab(t.key)}
                  className={`pv-serif px-3 py-1.5 text-[13px] border-b-2 -mb-px transition-colors whitespace-nowrap ${
                    tab === t.key
                      ? "border-[hsl(var(--pv-accent))] text-foreground"
                      : "border-transparent text-[hsl(var(--pv-text-muted))] hover:text-foreground"
                  }`}>
                  {t.label}{count !== null && count > 0 ? ` · ${count}` : ""}
                </button>
              );
            })}
          </div>

          {/* Pillar tab — the controlling idea + ending */}
          {tab === "pillar" && pillar && card(pillar, true)}

          {/* Entity tabs — add + card list */}
          {tab !== "pillar" && pillar && (() => {
            const items = of(tab as NodeKind);
            return (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <ActionLink busy={busy === "add"} onClick={() => addChild(pillar, tab as NodeKind, 2)} tone="faint" className="ml-auto">+ add</ActionLink>
                </div>
                {items.map((n) => card(n))}
              </div>
            );
          })()}
        </>
      );
    }
    if (key === "structure") {
      const acts = of("act");
      // Wipe the whole spine: deleting every act cascades (ON DELETE CASCADE) to its beats and scenes, so this
      // clears Structure → Scenes in one move. Foundations stay.
      const discardAllActs = () => {
        if (acts.length === 0) return;
        if (!window.confirm(`Discard all ${acts.length} act${acts.length === 1 ? "" : "s"}? This also removes their beats and scenes. Foundations stay. This can't be undone.`)) return;
        void run("discard acts", async () => {
          await Promise.all(acts.map((m) => deleteNode(m.id)));
          toast({ title: "Acts discarded", description: `${acts.length} act${acts.length === 1 ? "" : "s"} removed.` });
        });
      };
      // Structure is the pure sequential spine: Acts (coarse) · Beats (the causal units, grouped under their
      // act). Cross-cutting registries live elsewhere — Games in Foundations (a contest is definable without
      // beats), Threads in the Overview (a whole-book promise registry).
      const STR_TABS = [
        { key: "acts" as const, label: "Acts", count: acts.length },
        { key: "beats" as const, label: "Beats", count: of("beat").length },
      ] as const;
      const stab = structureTab;
      return (
        <>
          {/* Tab bar — quick navigation between the 4 structure sections */}
          <div className="flex gap-0.5 border-b border-[hsl(var(--pv-border-soft))] mb-4 -mx-1 px-1">
            {STR_TABS.map((t) => (
              <button key={t.key} onClick={() => setStructureTab(t.key)}
                className={`pv-serif px-3 py-1.5 text-[13px] border-b-2 -mb-px transition-colors whitespace-nowrap ${
                  stab === t.key
                    ? "border-[hsl(var(--pv-accent))] text-foreground"
                    : "border-transparent text-[hsl(var(--pv-text-muted))] hover:text-foreground"
                }`}>
                {t.label}{t.count > 0 ? ` · ${t.count}` : ""}
              </button>
            ))}
          </div>

          {/* ACTS — the coarse spine: act-level plan (goal, turning point, value), one card each. */}
          {stab === "acts" && (
            <div className="space-y-2">
              {acts.map((m) => card(m, true))}
              <div className="flex items-center gap-4">
                {pillar && <ActionLink busy={busy === "add"} onClick={() => addChild(pillar, "act", 3)} tone="faint">+ add act</ActionLink>}
                {acts.length > 0 && <ActionLink busy={busy === "discard acts"} onClick={discardAllActs} tone="faint">discard all acts →</ActionLink>}
              </div>
            </div>
          )}

          {/* BEATS — the causal units, grouped under each act header; reorder within an act. */}
          {stab === "beats" && (
            <div className="space-y-4">
              {acts.length === 0 && (
                <p className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))]">Add acts first — beats hang off them.</p>
              )}
              {acts.map((m, mi) => {
                const mc = m.content as ActContent;
                return (
                  <div key={m.id} className="space-y-2">
                    <div className="flex items-baseline gap-2 border-b border-[hsl(var(--pv-border-soft))]/60 pb-1">
                      <Eyebrow tone="accent">act {mi + 1}</Eyebrow>
                      {(mc.title || mc.goal) && <span className="pv-serif truncate text-[13px] text-[hsl(var(--pv-text-muted))]">{mc.title || mc.goal}</span>}
                    </div>
                    <SortableBeatList
                      beats={childrenOf(nodes, m.id).filter((b) => b.kind === "beat")}
                      bookId={bookId}
                      renderCard={card}
                      onSaved={onChanged}
                    />
                    <ActionLink busy={busy === "add"} onClick={() => addChild(m, "beat", 4)} tone="faint">+ add beat</ActionLink>
                  </div>
                );
              })}
            </div>
          )}
        </>
      );
    }
    if (key === "draft") {
      // Prose reading view: Act → Beat → prose text. Non-editable; headers link back to Structure.
      const acts = of("act");
      // Reading order (spine DFS), not node-storage order — so the batch drafts the opening scenes first
      // and continuity context flows forward, instead of leaving the first pages empty.
      const scenesAll = scenesInOrder(nodes);
      const done = scenesAll.filter((s) =>
        picture
          ? (s.content as SceneContent).image_url && !isIllusStale(s)
          : (s.content as SceneContent).prose?.text && !isProseStale(s)
      ).length;
      const ready = scenesAll.length > 0 && done === scenesAll.length;
      const noun = picture ? "illustrated" : "drafted";
      const scenesWithProse = !picture ? scenesAll.filter((s) => !!(s.content as SceneContent).prose?.text?.trim()) : [];
      const discardAllProse = () => {
        if (scenesWithProse.length === 0) return;
        if (!window.confirm(`Discard the prose on ${scenesWithProse.length} scene${scenesWithProse.length === 1 ? "" : "s"}? The scenes stay. This can't be undone.`)) return;
        void run("discard prose", async () => {
          await Promise.all(scenesWithProse.map((s) => saveNode({
            ...s,
            content: { ...(s.content as SceneContent), prose: {} },
            authoring: { ...s.authoring, prose_src_hash: undefined },
          })));
          toast({ title: "Prose discarded", description: `${scenesWithProse.length} scene${scenesWithProse.length === 1 ? "" : "s"} cleared.` });
        });
      };
      return (
        <>
          {/* Top action bar — first fold: read + progress */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <button
              type="button"
              disabled={busy === "read" || scenesAll.length === 0}
              onClick={renderAndRead}
              title={ready ? "Render the latest pages and open the reader" : `${done}/${scenesAll.length} scenes ${noun} — reads what's ready so far`}
              className="pv-serif inline-flex items-center gap-2 rounded-full bg-[hsl(var(--pv-accent))] px-4 py-2 text-[13.5px] text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy === "read" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookOpen className="h-3.5 w-3.5" />}
              Read the book →
            </button>
            {scenesAll.length > 0 && (
              <span className="pv-mono text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">{done}/{scenesAll.length} scenes {noun}</span>
            )}
            {!picture && scenesWithProse.length > 0 && (
              <ActionLink tone="faint" busy={busy === "discard prose"} onClick={discardAllProse}>discard all prose →</ActionLink>
            )}
            <ActionLink busy={busy === "render"} onClick={render} tone="faint">render only</ActionLink>
          </div>
          {/* Act → Beat → prose reading view */}
          {acts.map((m, mi) => {
            const mvContent = m.content as ActContent;
            const mvBeats = childrenOf(nodes, m.id).filter((b) => b.kind === "beat");
            const actTitle = mvContent.title || mvContent.goal;
            return (
              <div key={m.id} className="space-y-3 border-t border-[hsl(var(--pv-border-soft))] pt-4">
                {/* Act header — click to drill into Structure */}
                <button type="button" onClick={() => openStage("structure", m.id)}
                  className="flex items-baseline gap-2 text-left transition-opacity hover:opacity-70">
                  <Eyebrow tone="accent">act {mi + 1}</Eyebrow>
                  {actTitle && <span className="pv-serif text-[13px] text-foreground">{actTitle}</span>}
                </button>
                {mvBeats.map((b) => {
                  const beatContent = b.content as BeatContent;
                  const bScenes = childrenOf(nodes, b.id).filter((s) => s.kind === "scene");
                  return (
                    <div key={b.id} className="ml-4 space-y-2 border-l border-[hsl(var(--pv-border-soft))] pl-4">
                      {/* Beat header — click to drill into Structure */}
                      <button type="button" onClick={() => openStage("structure", b.id)}
                        className="flex items-baseline gap-2 text-left transition-opacity hover:opacity-70">
                        <span className="pv-mono text-[9px] uppercase tracking-[0.1em] text-[hsl(var(--pv-text-faint))]">beat</span>
                        {beatContent.summary && (
                          <span className="pv-serif text-[12.5px] text-[hsl(var(--pv-text-muted))]">{beatContent.summary}</span>
                        )}
                      </button>
                      {bScenes.map((s) => {
                        const sc = s.content as SceneContent;
                        const proseText = sc.prose?.text;
                        const staleScene = isProseStale(s);
                        return (
                          <div key={s.id} id={`dna-node-${s.id}`} className="scroll-mt-6 space-y-1">
                            {sc.chapter_start?.title && (
                              <p className="pv-mono text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--pv-text-faint))]">{sc.chapter_start.title}</p>
                            )}
                            {proseText ? (
                              <div className={staleScene ? "opacity-60" : ""}>
                                <p className="pv-serif whitespace-pre-wrap text-[14.5px] leading-[1.75] text-foreground">{proseText}</p>
                                {staleScene && <span className="pv-mono mt-1 inline-block text-[9px] uppercase tracking-[0.12em] text-amber-500">stale — scene changed</span>}
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 rounded-lg border border-dashed border-[hsl(var(--pv-border-soft))]/70 px-3 py-2">
                                <span className="pv-serif text-[12px] italic text-[hsl(var(--pv-text-faint))]">no prose yet</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </>
      );
    }
    // scenes: scenes grouped under their beat. Each beat is a collapsible group header —
    // fold a beat to hide its scenes, so this stage reads as an outline of beats to drill into one at a time.
    const beatsAll = of("act").flatMap((m) => childrenOf(nodes, m.id).filter((b) => b.kind === "beat"));
    const scenesAll = of("scene");
    // Clear the scene layer without touching the spine: deleting scenes leaves acts/beats intact.
    // Acts stay — use "discard all acts" to wipe the spine.
    const discardAllScenes = () => {
      if (scenesAll.length === 0) return;
      if (!window.confirm(`Discard all ${scenesAll.length} scene${scenesAll.length === 1 ? "" : "s"}? This also removes their prose. Acts and beats stay. This can't be undone.`)) return;
      void run("discard scenes", async () => {
        await Promise.all(scenesAll.map((s) => deleteNode(s.id)));
        toast({ title: "Scenes discarded", description: `${scenesAll.length} scene${scenesAll.length === 1 ? "" : "s"} removed.` });
      });
    };
    return (
      <>
        {scenesAll.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <ActionLink busy={busy === "discard scenes"} onClick={discardAllScenes} tone="faint">discard all scenes →</ActionLink>
          </div>
        )}
        {beatsAll.map((b) => {
          const scenes = childrenOf(nodes, b.id).filter((s) => s.kind === "scene");
          const open = isOpen(b);
          const need = scenes.filter((s) => attn.has(s.id)).length;
          return (
            <div key={b.id} className="space-y-2">
              <button type="button" onClick={() => toggle(b)} className="flex w-full items-center gap-2 border-b border-[hsl(var(--pv-border-soft))]/60 pb-1 text-left">
                {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--pv-text-faint))]" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--pv-text-faint))]" />}
                <Eyebrow tone="muted" className="truncate">{(b.content as { summary?: string }).summary || "beat"}</Eyebrow>
                <span className="pv-mono ml-auto shrink-0 text-[9px] uppercase tracking-[0.1em] text-[hsl(var(--pv-text-faint))]">
                  {scenes.length} scene{scenes.length === 1 ? "" : "s"}{need ? ` · ${need} need work` : ""}
                </span>
              </button>
              {open && (
                <>
                  {scenes.map((s) => card(s))}
                  <ActionLink busy={busy === "add"} onClick={() => addChild(b, "scene", 5)}>add scene</ActionLink>
                </>
              )}
            </div>
          );
        })}
      </>
    );
  };

  const dot = (s: typeof stages[number]): "done" | "active" | "ready" | "locked" =>
    s.status === "done" ? "done" : s.status === "now" ? "active" : s.status === "locked" ? "locked" : "ready";
  // Does any load-bearing node in a stage carry a stale flag? This is the non-linear truth a wizard hides:
  // a layer can be "approved" yet drifted out of sync with an upstream change. Surfaced in the rail so the
  // ladder tells you where to look, instead of a checkmark that pretends the work is final.
  const stageStale = (key: StageKey) => STAGE_KINDS[key].some((kind) =>
    of(kind).some((n) => isStale(n, index) || (n.kind === "scene" && (picture ? isIllusStale(n) : isProseStale(n)))));

  // One layer row in the ladder rail: dot · label · (stale chip / now tally), with its serial sub-step spine
  // unfolded when focused. Reused for the authoring layers AND the Output rung — no step numbers, no "now"
  // badge: the rail reads as a resolution ladder (coarse → fine), not a 5-step progress bar.
  const stageRow = (s: typeof stages[number]) => {
    const subs = nodes.length > 0 ? stageSubsteps(s.key, nodes, picture ? "picture" : "prose") : [];
    const done = subs.filter((ss) => ss.status === "done").length;
    const focused = !onOverview && activeKey === s.key; // highlighted only when this layer is the open view
    const stale = s.status === "done" && stageStale(s.key);
    return (
      <div key={s.key}>
        <button disabled={s.status === "locked"} onClick={() => setView(s.key)}
          className={`mb-0.5 flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors disabled:opacity-40 ${focused ? "bg-[hsl(var(--pv-accent))]/[0.08]" : "hover:bg-[hsl(var(--pv-surface-2))]/60"}`}>
          <StepDot state={dot(s)} stale={stale} />
          <span className={`pv-serif flex-1 text-[14px] ${s.status === "locked" ? "text-[hsl(var(--pv-text-faint))]" : focused ? "text-foreground" : "text-[hsl(var(--pv-text-muted))]"}`}>{s.label}</span>
          {/* stale = the honest signal a wizard hides: an approved layer drifted out of sync upstream */}
          {stale && <span className="pv-mono text-[9px] uppercase tracking-[0.12em] text-amber-500">stale</span>}
          {/* the "now" layer shows a sub-step tally so progress reads without opening it */}
          {s.status === "now" && subs.length > 0 && <span className="pv-mono text-[9px] text-[hsl(var(--pv-text-faint))]">{done}/{subs.length}</span>}
        </button>
      </div>
    );
  };

  // The rail splits into two zones: LAYERS you author (idea → scenes, coarse → fine) and OUTPUT projected
  // from the whole tree (prose pages + visuals). Prose/Visuals aren't authoring rungs — they're renders of
  // everything above — so they get their own zone instead of masquerading as "step 5 of 5".
  const authoringStages = stages.filter((s) => s.key !== "draft");
  const draftStage = stages.find((s) => s.key === "draft")!;
  const sectionLabel = (text: string, hint?: string) => (
    <div className="mb-1 mt-3.5 flex items-baseline justify-between px-2.5">
      <Eyebrow>{text}</Eyebrow>
      {hint && <span className="pv-mono text-[8.5px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]/80">{hint}</span>}
    </div>
  );

  const nav = (
    <div className="h-full overflow-y-auto border-b border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/40 px-4 pb-12 pt-5 md:border-b-0 md:border-r">
      <div className="mb-1 px-1">
        <Eyebrow tone="muted">Build</Eyebrow>
      </div>
      {/* Overview — the studio's home; the dashboard, not a resolution rung (so it sits above the ladder). */}
      {nodes.length > 0 && (
        <button onClick={() => setView("overview")}
          className={`mb-1.5 mt-2 flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors ${onOverview ? "bg-[hsl(var(--pv-accent))]/[0.08]" : "hover:bg-[hsl(var(--pv-surface-2))]/60"}`}>
          <span className="flex h-5 w-5 items-center justify-center"><LayoutDashboard className={`h-3.5 w-3.5 ${onOverview ? "text-[hsl(var(--pv-accent))]" : "text-[hsl(var(--pv-text-faint))]"}`} /></span>
          <span className={`pv-serif flex-1 text-[14px] ${onOverview ? "text-foreground" : "text-[hsl(var(--pv-text-muted))]"}`}>Overview</span>
        </button>
      )}
      {/* LAYERS — the resolution ladder you author, coarse → fine. */}
      {nodes.length > 0 && sectionLabel("Layers", "coarse → fine")}
      {authoringStages.map(stageRow)}

      {/* OUTPUT — projected from the whole tree, not authored: prose pages + visuals. */}
      {nodes.length > 0 && sectionLabel("Output")}
      {stageRow(draftStage)}
      <button onClick={() => setView("visuals")}
        className={`mb-0.5 flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors ${onVisuals ? "bg-[hsl(var(--pv-accent))]/[0.08]" : "hover:bg-[hsl(var(--pv-surface-2))]/60"}`}>
        <span className="flex h-5 w-5 items-center justify-center"><Image className={`h-3.5 w-3.5 ${onVisuals ? "text-[hsl(var(--pv-accent))]" : "text-[hsl(var(--pv-text-faint))]"}`} /></span>
        <span className={`pv-serif flex-1 text-[14px] ${onVisuals ? "text-foreground" : "text-[hsl(var(--pv-text-muted))]"}`}>Visuals</span>
        {picture && of("scene").length > 0 && (
          <span className="pv-mono text-[9px] text-[hsl(var(--pv-text-faint))]">
            {of("scene").filter((sc) => (sc.content as SceneContent).image_url && !isIllusStale(sc)).length}/{of("scene").length}
          </span>
        )}
      </button>

      <div className="mx-2.5 my-3 mt-4 h-px bg-[hsl(var(--pv-border-soft))]" />
      <div className="flex flex-col items-start gap-2 px-2.5">
        {/* The brief (genre/length/heat/audience — the binding mandate) renders above the DNA tree; the
            concept there is the same idea this DNA tree elaborates. Jump out to edit it. */}
        <ActionLink tone="muted" onClick={() => navigate(`/books/${bookSlug}/dna/tree`)}>edit brief →</ActionLink>
        {/* Output mode (prose vs picture book) now lives in the Visuals section, alongside the look. */}
        {nodes.length === 0 && <ActionLink busy={busy === "migrate"} onClick={migrate}>migrate from legacy</ActionLink>}
        {nodes.length > 0 && <ActionLink busy={busy === "render"} onClick={render} tone="faint">render pages →</ActionLink>}
        {nodes.length > 0 && <ActionLink busy={busy === "read"} onClick={renderAndRead}>read →</ActionLink>}
      </div>
    </div>
  );

  const stage = (
    <div className="h-full overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-2xl space-y-5">
        {nodes.length === 0 ? (
          <div className="space-y-3">
            <StageHead eyebrow="Novel DNA" title={settings.title || "Untitled"} caption="Nothing here yet — choose where to start." />
            <p className="pv-serif text-[15px] italic text-[hsl(var(--pv-text-faint))]">
              <button className="text-[hsl(var(--pv-accent))] underline" onClick={migrate}>Migrate the legacy book</button>{" "}
              or <button className="text-[hsl(var(--pv-accent))] underline" onClick={() => run("seed", () => saveNode(emptyNode(bookId, "seed", 0, null)))}>start a blank seed</button>.
            </p>
          </div>
        ) : onOverview ? (
          // The home dashboard — shape, next move, and issues; every action drills into the owning stage.
          <DnaOverview bookId={bookId} nodes={nodes} settings={settings} stages={stages} nowKey={nowKey} onOpen={openStage} onChanged={onChanged}
            renderCard={card} />
        ) : onVisuals ? (
          // The standalone Visuals control room — look, cast references, illustrations (renders its own StageHead).
          <DnaVisuals bookId={bookId} nodes={nodes} settings={settings} onChanged={onChanged} />
        ) : (
          <>
            <StageHead eyebrow={active.status === "done" ? (stageStale(activeKey) ? "Approved · out of sync" : "Approved") : active.status === "now" ? "Focus · the next move" : "Layer"} title={active.label} caption={active.caption}
              right={["foundations", "structure", "scenes", "draft"].includes(activeKey) ? (
                <div className="flex shrink-0 items-center gap-3">
                  <ActionLink tone="faint" onClick={() => setAll(true)}>expand all</ActionLink>
                  <ActionLink tone="faint" onClick={() => setAll(false)}>collapse all</ActionLink>
                </div>
              ) : undefined} />
            {/* "Continue" at the top when the stage is already approved — no need to scroll down to proceed. */}
            {active.status === "done" && nextStage && nextStage.status !== "locked" && (
              <div className="-mt-1 pb-1"><ActionLink onClick={() => setView(nextStage.key)}>continue to {nextStage.label} →</ActionLink></div>
            )}
            {/* The level's SHAPE at a glance — root / interlinked web / serial-budgeted spine / value turns */}
            <DnaStageDiagram stage={activeKey} nodes={nodes} />
            <div className="space-y-2">{renderStage(activeKey)}</div>
            {active.status === "done" && nextStage && nextStage.status !== "locked" && (
              <div className="pt-2"><ActionLink onClick={() => setView(nextStage.key)}>continue to {nextStage.label} →</ActionLink></div>
            )}
          </>
        )}
      </div>
    </div>
  );

  const railHandle = <ResizableHandle className="w-1.5 bg-transparent transition-colors hover:bg-[hsl(var(--pv-accent))]/30 data-[resize-handle-state=drag]:bg-[hsl(var(--pv-accent))]/50" />;
  // The omni-rail agent (docs/agent-rail.md) — one durable, tool-using conversation over the whole DNA
  // tree, with the context filter + slash commands. Supersedes the per-stage DnaChatRail.
  const rail = nodes.length > 0 ? <AgentRail bookId={bookId} nodes={nodes} settings={settings} bookSlug={bookSlug} /> : null;

  return (
    <div className="flex h-full flex-col">
      <ResizablePanelGroup direction="horizontal" className="hidden min-h-0 flex-1 md:flex">
        <ResizablePanel defaultSize={20} minSize={14} maxSize={32}>{nav}</ResizablePanel>
        {railHandle}
        <ResizablePanel defaultSize={rail ? 52 : 80} minSize={32}>{stage}</ResizablePanel>
        {rail && (<>{railHandle}<ResizablePanel defaultSize={28} minSize={20} maxSize={42}>{rail}</ResizablePanel></>)}
      </ResizablePanelGroup>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:hidden">
        <div className="shrink-0">{nav}</div>
        <div className="shrink-0">{stage}</div>
        {rail && <div className="h-[70vh] shrink-0">{rail}</div>}
      </div>
    </div>
  );
}

// ── Card chrome: small read-only chips that make derived state scannable ───────
const nameOf = (index: Map<string, DnaNode>, id?: string): string | undefined =>
  id ? (index.get(id)?.content as { name?: string } | undefined)?.name : undefined;

// A status pill: the authoring lifecycle as one glanceable, color-coded token. Approved = the committed
// rung; draft/proposed = in progress; empty = a hungry slot. One fixed-shape chip → no layout shift.
function StatusPill({ status }: { status: DnaNode["authoring"]["status"] }) {
  const tone = status === "accepted" ? "text-emerald-500" : status === "empty" ? "text-[hsl(var(--pv-text-faint))]" : "text-[hsl(var(--pv-text-muted))]";
  const label = status === "accepted" ? "approved" : status;
  return <span className={`pv-mono text-[9px] uppercase tracking-[0.12em] ${tone}`}>{label}</span>;
}

// ── Beat reordering (drag-and-drop within a act) ────────────────────────
// SortableBeatList owns local position state so drops feel instant; saves on drop via saveNodes.
function SortableBeatList({ beats, bookId, renderCard, onSaved }: {
  beats: DnaNode[];
  bookId: number;
  renderCard: (n: DnaNode) => ReactNode;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [items, setItems] = useState(beats);
  useEffect(() => { setItems(beats); }, [beats]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((b) => b.id === active.id);
    const newIndex = items.findIndex((b) => b.id === over.id);
    const reordered = arrayMove(items, oldIndex, newIndex);
    const prev = items;
    setItems(reordered);
    try {
      await saveNodes(reordered.map((b, i) => ({ ...b, position: i })));
      onSaved();
    } catch (e) {
      setItems(prev);
      toast({ title: "Couldn't reorder", description: String((e as Error)?.message ?? e), variant: "destructive" });
    }
  };

  if (items.length === 0) return null;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => { void handleDragEnd(e); }}>
      <SortableContext items={items.map((b) => b.id)} strategy={verticalListSortingStrategy}>
        {items.map((b) => (
          <SortableBeatItem key={b.id} beat={b}>
            {renderCard(b)}
          </SortableBeatItem>
        ))}
      </SortableContext>
    </DndContext>
  );
}

function SortableBeatItem({ beat, children }: { beat: DnaNode; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: beat.id });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, transition }
    : undefined;
  return (
    <div ref={setNodeRef} style={style} className={`flex items-start gap-1 ${isDragging ? "relative z-10 opacity-50" : ""}`}>
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="mt-3 shrink-0 cursor-grab p-0.5 text-[hsl(var(--pv-text-faint))] hover:text-[hsl(var(--pv-text-muted))] active:cursor-grabbing"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// The DERIVED summary strip — the engine data the old card hid. Read-only, scannable, kind-specific; only
// renders when there's something to show (so it never adds empty space). This is the "surface the model"
// move: a game's two poles + its coupling cascade, a beat's causal in/out, a scene's value turn, a
// relationship's dyad, a character's role. The editable detail still lives in the fields below.
function KindSummary({ node, index }: { node: DnaNode; index: Map<string, DnaNode> }) {
  const wrap = (children: ReactNode) =>
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11.5px] leading-snug">{children}</div>;
  const tag = (label: string, tone = "text-[hsl(var(--pv-text-faint))]") =>
    <span className={`pv-mono text-[9px] uppercase tracking-[0.1em] ${tone}`}>{label}</span>;

  // (relationship dyad is shown as the card title so it survives the collapsed one-line row)
  // role is now an editable select field — don't repeat it here; only show the physical tag as flavour.
  if (node.kind === "character") {
    const c = node.content as CharacterContent;
    if (!c.tag) return null;
    return wrap(<span className="pv-serif italic text-[hsl(var(--pv-text-faint))]">&ldquo;{c.tag}&rdquo;</span>);
  }
  if (node.kind === "game") {
    const c = node.content as GameContent;
    const couples = (c.couples ?? []).map((k) => `${k.when} → ${k.effect} ${nameOf(index, k.to) ?? "?"}`);
    const players = (c.players ?? []).map((p) => nameOf(index, p)).filter(Boolean) as string[];
    if (!c.win_condition && !c.lose_condition && !couples.length && !players.length) return null;
    return (
      <div className="mt-2.5 space-y-1.5 rounded-lg border border-[hsl(var(--pv-border-soft))]/70 bg-background/30 px-3 py-2">
        {players.length > 0 && <p className="pv-serif text-[12px] text-[hsl(var(--pv-text-muted))]">{players.join(" vs ")}</p>}
        {c.win_condition && <p className="pv-serif flex gap-1.5 text-[12.5px] leading-snug"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-500/70" /><span className="text-foreground"><b className="font-medium text-emerald-500">WIN </b>{c.win_condition}</span></p>}
        {c.lose_condition && <p className="pv-serif flex gap-1.5 text-[12.5px] leading-snug"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-rose-500/60" /><span className="text-foreground"><b className="font-medium text-rose-500">LOSE </b>{c.lose_condition}</span></p>}
        {couples.length > 0 && <p className="pv-mono text-[10px] leading-relaxed text-[hsl(var(--pv-text-faint))]">⛓ {couples.join("  ·  ")}</p>}
      </div>
    );
  }
  if (node.kind === "beat") {
    const c = node.content as BeatContent;
    const needs = c.needs ?? [], establishes = c.establishes ?? [];
    if (!needs.length && !establishes.length) return null;
    return wrap(
      <>
        {needs.length > 0 && <span className="flex items-center gap-1.5">{tag("needs")}<span className="pv-serif text-[12px] text-[hsl(var(--pv-text-muted))]">{needs.join(", ")}</span></span>}
        {establishes.length > 0 && <span className="flex items-center gap-1.5">{tag("→ establishes", "text-[hsl(var(--pv-accent))]")}<span className="pv-serif text-[12px] text-[hsl(var(--pv-text-muted))]">{establishes.join(", ")}</span></span>}
      </>,
    );
  }
  if (node.kind === "scene") {
    const vs = (node.content as SceneContent).value_shift;
    if (!vs?.from || !vs?.to) return null;
    const up = vs.polarity === "up", down = vs.polarity === "down";
    return wrap(
      <span className="pv-serif text-[12px] text-[hsl(var(--pv-text-muted))]">
        {vs.value ? <span className="text-[hsl(var(--pv-text-faint))]">{vs.value}: </span> : null}
        {vs.from} <span className={up ? "text-emerald-500" : down ? "text-rose-500" : "text-[hsl(var(--pv-accent))]"}>{up ? "↗" : down ? "↘" : "→"}</span> {vs.to}
      </span>,
    );
  }
  if (node.kind === "world_fact") {
    const c = node.content as WorldFactContent;
    if (!c.mechanism) return null;
    return wrap(<span className="flex items-center gap-1.5">{tag("mechanism", "text-[hsl(var(--pv-accent))]")}<span className="pv-serif text-[12px] text-[hsl(var(--pv-text-muted))]">{c.mechanism}</span></span>);
  }
  if (node.kind === "thread") {
    const c = node.content as ThreadContent;
    if (!c.kind) return null;
    return wrap(tag(c.kind, "text-[hsl(var(--pv-accent))]"));
  }
  return null;
}

// The card's scannable identity line — a short title from the node's own content, so a stack of cards reads
// top-to-bottom without opening each. Falls back to nothing (the kind badge carries it).
function cardTitle(node: DnaNode): string | undefined {
  const c = node.content as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  switch (node.kind) {
    case "act": return s((c as ActContent).title) ?? s((c as ActContent).goal);
    case "beat": return s((c as BeatContent).summary);
    case "scene": return s((c as SceneContent).chapter_start?.title) ?? s((c as SceneContent).goal);
    case "tentpole": return s((c as { summary?: string }).summary);
    case "character": case "world_fact": case "thread": case "game": return s((c as { name?: string }).name);
    default: return undefined;
  }
}

// The uniform node card — the same verbs (edit / lock) at every depth, now in four stable zones:
// IDENTITY (kind · title · status) → SUMMARY (derived engine data) → FIELDS (editable slots) → ACTIONS (a
// persistent bar: approve gate, lock, delete). The action bar always occupies its row, so the
// card never reflows as state changes (low layout shift). A beat's connector glyph (∴/↯) prefixes its title.
function NodeCard({ node, index, bookId, kids, onChanged, accent, expanded, onToggle, meta, picture, flash }: {
  node: DnaNode; index: Map<string, DnaNode>; bookId: number; kids: DnaNode[]; onChanged: () => void; accent?: boolean;
  expanded: boolean; onToggle: () => void; meta?: string; picture?: boolean; flash?: boolean;
}) {
  const { toast } = useToast();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  useEffect(() => { setDrafts({}); }, [node.id]);
  const isPictureScene = picture && node.kind === "scene";
  // Picture-mode scene cards edit the CAPTION (not prose) + show the illustration; everything else is shared.
  const fields = isPictureScene
    ? [
        ...(FIELDS.scene ?? []).map((f) => f.key === "prose.text" ? { key: "caption.text", label: "caption" } : f),
        // Per-scene art direction — folded into THIS scene's image prompt on top of the book house look.
        { key: "art_note", label: "art direction (this scene's look)" },
      ]
    : FIELDS[node.kind] ?? [];
  const sceneImage = node.kind === "scene" ? (node.content as SceneContent).image_url : null;
  const stale = isStale(node, index) || (node.kind === "scene" && (picture ? isIllusStale(node) : isProseStale(node)));
  const locked = node.authoring.locked;
  // Title falls back to the relationship dyad (needs index) so a collapsed relationship row stays labeled.
  const title = cardTitle(node) ?? (node.kind === "relationship"
    ? (() => { const c = node.content as RelationshipContent; const a = nameOf(index, c.a), b = nameOf(index, c.b); return a && b ? `${a} ↔ ${b}` : undefined; })()
    : undefined);
  const connector = node.kind === "beat" ? (node.content as BeatContent).connector : undefined;
  const connectorGlyph = connector === "therefore" ? "∴" : connector === "but" ? "↯" : undefined;
  // For beats: suppress the summary field from FIELDS when the card is expanded and the title already shows it.
  const displayFields = (expanded && title && node.kind === "beat")
    ? fields.filter((f) => f.key !== "summary")
    : fields;

  const guard = async (label: string, fn: () => Promise<void>) => {
    try { await fn(); onChanged(); } catch (e) { toast({ title: label, description: String((e as Error)?.message ?? e), variant: "destructive" }); }
  };
  const ready = node.authoring.status === "accepted"; // progressive disclosure: expand only from an accepted rung (§7)
  const save = (patch: Record<string, unknown>) => guard("Couldn't save", () => saveNode(editContent(node, patch)));
  const accept = () => guard("Couldn't accept", () => saveNode(setStatus(node, "accepted")));
  const toggleLock = () => guard("Couldn't lock", () => saveNode(lockNode(node, !locked)));
  const remove = () => { if (window.confirm(`Delete this ${node.kind} and everything under it?`)) void guard("Couldn't delete", () => deleteNode(node.id)); };

  return (
    <Panel id={`dna-node-${node.id}`} variant={accent ? "chosen" : "soft"}
      className={`px-4 py-3 scroll-mt-6 transition-[box-shadow,border-color] ${flash ? "border-[hsl(var(--pv-accent))] ring-2 ring-[hsl(var(--pv-accent))]/40" : ""}`}>
      {/* IDENTITY — the whole row toggles open/closed; chevron · kind · title · status all on one line */}
      <button type="button" onClick={onToggle} className="flex w-full items-start gap-2 text-left">
        <span className="mt-0.5 shrink-0 text-[hsl(var(--pv-text-faint))]">
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
        <Eyebrow tone="accent" className="mt-0.5 shrink-0">{KIND_DISPLAY[node.kind] ?? node.kind}</Eyebrow>
        <div className="min-w-0 flex-1">
          {title && (
            <p className={`pv-serif text-[13.5px] leading-snug text-foreground ${expanded ? "" : "truncate"}`}>
              {connectorGlyph && <span className="mr-1 text-[hsl(var(--pv-accent))]" title={connector}>{connectorGlyph}</span>}
              {title}
            </p>
          )}
          {!expanded && meta && <p className="pv-mono mt-0.5 text-[9px] uppercase tracking-[0.1em] text-[hsl(var(--pv-text-faint))]">{meta}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {stale && <span className="pv-mono text-[9px] uppercase tracking-[0.12em] text-amber-500" title="inputs changed since this was generated">stale</span>}
          <StatusPill status={node.authoring.status} />
          {locked && <Lock className="h-3 w-3 text-[hsl(var(--pv-accent))]" />}
        </div>
      </button>

      {expanded && (<>
      {/* SUMMARY — derived engine data (win/lose, coupling, causality, value turn…) */}
      <KindSummary node={node} index={index} />

      {/* PICTURE MODE — the scene's chosen illustration (pinned on the node; the page renders this). */}
      {isPictureScene && sceneImage && (
        <img src={sceneImage} alt="scene illustration"
          className="mt-2.5 w-full rounded-md border border-[hsl(var(--pv-border-soft))] object-cover" />
      )}

      {/* FIELDS — the editable slots; ★ marks a load-bearing one */}
      {fields.length > 0 && (
        <div className="mt-2.5 space-y-1.5">
          {displayFields.map((fld) => {
            const required = fld.label.includes("★");
            const label = fld.label.replace(/\s*★\s*$/, "");
            const val = drafts[fld.key] ?? getPath(node.content, fld.key);
            const options = SELECT_FIELDS[fld.key];
            return (
              <label key={fld.key} className="block">
                <span className="pv-mono flex items-center gap-1 text-[9px] uppercase tracking-[0.1em] text-[hsl(var(--pv-text-faint))]">
                  {label}{required && <span className="text-[hsl(var(--pv-accent))]" title="load-bearing field">★</span>}
                </span>
                {options ? (
                  <select
                    value={val}
                    disabled={locked}
                    onChange={(e) => { void save(setPath(fld.key, e.target.value)); }}
                    className="pv-serif mt-0.5 w-full border-0 border-b border-transparent bg-transparent py-0.5 text-[14px] leading-snug text-foreground outline-none focus:border-[hsl(var(--pv-accent))]/40 disabled:opacity-60"
                  >
                    <option value="">—</option>
                    {options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <AutoTextarea
                    value={val}
                    disabled={locked}
                    onChange={(e) => setDrafts((d) => ({ ...d, [fld.key]: e.target.value }))}
                    onBlur={() => { const v = drafts[fld.key]; if (v != null && v !== getPath(node.content, fld.key)) void save(setPath(fld.key, v)); }}
                    placeholder="—"
                    className="pv-serif w-full resize-none border-0 border-b border-transparent bg-transparent px-0 py-0.5 text-[14px] leading-snug text-foreground outline-none focus:border-[hsl(var(--pv-accent))]/40 focus-visible:ring-0 disabled:opacity-60"
                  />
                )}
              </label>
            );
          })}
        </div>
      )}

      {/* ACTIONS — a persistent bar (never reflows): approve left, edit controls right */}
      <div className="mt-3 flex min-h-[24px] items-center gap-3 border-t border-[hsl(var(--pv-border-soft))]/60 pt-2.5">
        {!ready && (
          <ActionLink onClick={accept} icon={<Check className="h-3.5 w-3.5" />} title="approve this rung to unlock editing below it">approve</ActionLink>
        )}
        <div className="ml-auto flex items-center gap-3 text-[hsl(var(--pv-text-faint))]">
          <button onClick={toggleLock} title={locked ? "unlock" : "lock — pin this so it can't be touched"} className={`transition-colors ${locked ? "text-[hsl(var(--pv-accent))]" : "hover:text-foreground"}`}>
            {locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
          </button>
          <button onClick={remove} title="delete this node and everything under it" className="transition-colors hover:text-destructive/70"><X className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      </>)}
    </Panel>
  );
}

