// DnaStudio — the four-verb authoring surface for the Novel DNA tree (Phase 4/5). The book IS the tree
// (docs/novel-dna-schema.md); this is the "hungry structure" the author fills. One uniform NodeCard for
// every kind (the self-similar promise: learn generate/edit/lock once). Styled with the studio's own
// primitives (studioUi) so it reads as part of the Build Studio. Live projection of book_nodes; pages are
// produced on demand via reconcileDna (Render). expand = ONE authoritative value (not proposals).
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Lock, Unlock, Sparkles, BookOpen, Loader2, Check, X, ChevronRight, ChevronDown, LayoutDashboard, GripVertical, Image } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { ActionLink, Eyebrow, Panel, RunningInline, StageHead, StepDot } from "@/components/book/studio/studioUi";
import { buildJourney, stageSubsteps, type StageKey, type SubStep } from "@/lib/dnaJourney";
import { AgentRail } from "@/components/book/studio/AgentRail";
import { DnaVisuals } from "@/components/book/dna/DnaVisuals";
import { DnaAnalysis } from "@/components/book/dna/DnaAnalysis";
import { DnaStageDiagram } from "@/components/book/dna/DnaStageDiagram";
import { DnaOverview } from "@/components/book/dna/DnaOverview";
import { saveNode, saveNodes, deleteNode } from "@/lib/bookNodes";
import { migrateBookToDna } from "@/lib/migrateToDna";
import { reconcileDna } from "@/lib/novelDnaRender";
import { expandNode, composeSceneIllustration, renderSceneIllustration, type ComposedSceneImage } from "@/lib/dnaExpand";
import { ImagePromptPreview } from "@/components/book/dna/ImagePromptPreview";
import {
  byId, childrenOf, editContent, emptyNode, isIllusStale, isProseStale, isStale, lock as lockNode, renderBlockers,
  setStatus, type BeatContent, type CharacterContent, type DnaNode, type GameContent, type MovementContent,
  type NodeKind, type RelationshipContent, type SceneContent, type ThreadContent, type WorldFactContent,
} from "@/lib/novelDna";

// The expand verb(s) per kind. A node can have several (a pillar generates cast, world, AND acts). Each
// names the TARGET the engine generates and the child kind it produces. SINGLE targets make exactly one
// child, so the UI hides them once that child exists.
interface ExpandTarget { target: string; label: string; childKind: NodeKind; needs?: NodeKind }
const EXPAND_TARGETS: Partial<Record<NodeKind, ExpandTarget[]>> = {
  seed: [{ target: "premise", label: "generate premise", childKind: "premise" }],
  premise: [{ target: "pillar", label: "generate pillar", childKind: "pillar" }],
  pillar: [
    { target: "cast", label: "generate cast", childKind: "character" },
    { target: "relationships", label: "generate relationships", childKind: "relationship", needs: "character" },
    { target: "world", label: "generate world", childKind: "world_fact" },
    { target: "set-pieces", label: "generate tent-poles", childKind: "tentpole" },
    { target: "movements", label: "generate acts", childKind: "movement" },
  ],
  movement: [{ target: "beats", label: "generate beats", childKind: "beat" }],
  beat: [{ target: "scenes", label: "generate scenes", childKind: "scene" }],
  scene: [{ target: "prose", label: "write prose", childKind: "scene" }],
};
const SINGLE = new Set(["premise", "pillar"]); // targets that produce exactly one child

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
  movement: [
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
  const [collapsedSections, setCollapsedSections] = useState<Set<NodeKind>>(new Set());
  const toggleSection = (k: NodeKind) => setCollapsedSections((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
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
  // Stage-level generation (a whole-arc op, not a per-node verb): threads (the promise registry) and the
  // GLOBAL beat sheet both read every movement, so they live as structure-stage actions on the pillar.
  const generateFromPillar = (target: string, label: string) =>
    run(target, async () => { if (!pillar) return; const { added } = await expandNode(bookId, pillar, target, {}); toast({ title: label, description: `${added} node(s) generated.` }); });

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
  // A node is also OPEN by default while it's the generative frontier — accepted but still has a child-kind
  // it can generate that doesn't exist yet (e.g. a pillar before "generate cast", a movement before beats).
  // So approving a rung reveals its next move instead of folding it away. (Prose isn't a child node — a
  // scene's done-ness is handled by needsAttn via prose staleness.)
  const hasOpenTarget = (n: DnaNode) => {
    const kids = childrenOf(nodes, n.id);
    return (EXPAND_TARGETS[n.kind] ?? []).some((t) =>
      t.target !== "prose" && !kids.some((c) => c.kind === t.childKind) && !(t.needs && !kids.some((c) => c.kind === t.needs)));
  };
  const openDefault = (n: DnaNode) => attn.has(n.id) || hasOpenTarget(n);
  const isOpen = (n: DnaNode) => expanded[n.id] ?? openDefault(n);
  const toggle = (n: DnaNode) => setExpanded((e) => ({ ...e, [n.id]: !(e[n.id] ?? openDefault(n)) }));
  const setAll = (open: boolean) => setExpanded(Object.fromEntries(nodes.map((n) => [n.id, open])));
  // The collapsed-row subtitle for a spine parent: how many children, and how many still need work.
  const collapsedMeta = (n: DnaNode): string | undefined => {
    if (n.kind !== "movement" && n.kind !== "beat") return undefined;
    const childKind: NodeKind = n.kind === "movement" ? "beat" : "scene";
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
    if (key === "premise") return [seed, premise].filter(Boolean).map((n) => card(n!));
    if (key === "foundations") {
      const labels: Record<string, string> = { character: "Cast", relationship: "Relationships", tentpole: "Tent-poles", world_fact: "World rules" };
      return (
        <>
          {pillar && card(pillar, true)}
          {/* Each entity kind in its own labeled, countable section — grouped so the bedrock reads at a glance
              rather than as one undifferentiated stack. Cast/world are generated from the pillar above; "add"
              here drops a blank slot for manual authoring. */}
          {pillar && entityKinds.map((k) => {
            const items = of(k);
            const collapsed = collapsedSections.has(k);
            return (
              <section key={k} className="space-y-2 pt-1">
                <div className="flex items-center gap-2.5 border-b border-[hsl(var(--pv-border-soft))]/60 pb-1">
                  <button onClick={() => toggleSection(k)} className="flex items-center gap-1.5 group">
                    {collapsed ? <ChevronRight className="h-3 w-3 text-[hsl(var(--pv-text-faint))]" /> : <ChevronDown className="h-3 w-3 text-[hsl(var(--pv-text-faint))]" />}
                    <Eyebrow tone="muted">{labels[k]}</Eyebrow>
                  </button>
                  {items.length > 0 && <span className="pv-mono text-[9px] text-[hsl(var(--pv-text-faint))]">{items.length}</span>}
                  <ActionLink busy={busy === "add"} onClick={() => addChild(pillar, k, 2)} tone="faint" className="ml-auto">+ add</ActionLink>
                </div>
                {!collapsed && items.map((n) => card(n))}
              </section>
            );
          })}
        </>
      );
    }
    if (key === "structure") {
      const movements = of("movement");
      const threads = of("thread");
      const games = of("game");
      // Acts still missing their beats — the targets of the bulk "generate beats for all acts" pass. Mirrors
      // the per-act "generate beats" verb (same expandNode call), just looped so the whole spine fills in one
      // click. Skips acts that already have beats (non-destructive); regenerate one at a time on its own card.
      const movementsNeedingBeats = movements.filter((m) => !childrenOf(nodes, m.id).some((c) => c.kind === "beat"));
      const generateAllBeats = () => run("allbeats", async () => {
        const targets = movementsNeedingBeats;
        let added = 0; const failed: string[] = [];
        for (const m of targets) {
          try { added += (await expandNode(bookId, m, "beats", {})).added; }
          catch (e) { failed.push(String((e as Error)?.message ?? e)); }
        }
        toast({ title: "Beats generated", description: `${added} beat(s) across ${targets.length - failed.length}/${targets.length} act(s)${failed.length ? ` · ${failed.length} failed` : ""}.` });
      });
      return (
        <>
          <DnaAnalysis nodes={nodes} settings={settings} />
          {pillar && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <ActionLink busy={busy === "movements"} icon={<Sparkles className="h-3.5 w-3.5" />} onClick={() => generateFromPillar("movements", "Acts generated")}>
                {movements.length ? "regenerate acts" : "generate acts"}
              </ActionLink>
              {movementsNeedingBeats.length > 0 && (
                <ActionLink busy={busy === "allbeats"} icon={<Sparkles className="h-3.5 w-3.5" />} onClick={generateAllBeats}>
                  generate beats for all {movementsNeedingBeats.length} act{movementsNeedingBeats.length > 1 ? "s" : ""}
                </ActionLink>
              )}
            </div>
          )}
          {movements.map((m) => (
            <div key={m.id} className="space-y-2">
              {card(m, true)}
              {/* Beats live under the movement; folding the movement (its chevron) hides them all. */}
              {isOpen(m) && (
                <div className="ml-4 space-y-2 border-l border-[hsl(var(--pv-border-soft))] pl-4">
                  <SortableBeatList
                    beats={childrenOf(nodes, m.id).filter((b) => b.kind === "beat")}
                    bookId={bookId}
                    renderCard={card}
                    onSaved={onChanged}
                  />
                  <ActionLink busy={busy === "add"} onClick={() => addChild(m, "beat", 4)}>add beat</ActionLink>
                </div>
              )}
            </div>
          ))}
          {pillar && <ActionLink busy={busy === "add"} onClick={() => addChild(pillar, "movement", 3)}>add movement</ActionLink>}

          {/* The promise registry (threads) + games + the global beat sheet — whole-arc ops on the acts. */}
          {pillar && movements.length > 0 && (
            <div className="space-y-2 border-t border-[hsl(var(--pv-border-soft))] pt-4">
              <div className="flex items-center gap-3">
                <Eyebrow tone="muted">promises · the thread registry</Eyebrow>
                <ActionLink busy={busy === "threads"} icon={<Sparkles className="h-3.5 w-3.5" />} onClick={() => generateFromPillar("threads", "Threads generated")}>
                  {threads.length ? "regenerate threads" : "generate threads"}
                </ActionLink>
              </div>
              {threads.map((t) => card(t))}

              <div className="flex items-center gap-3 pt-2">
                <Eyebrow tone="muted">games · the contests (win / lose)</Eyebrow>
                <ActionLink busy={busy === "games"} icon={<Sparkles className="h-3.5 w-3.5" />} onClick={() => generateFromPillar("games", "Games generated")}>
                  {games.length ? "regenerate games" : "generate games"}
                </ActionLink>
              </div>
              {games.map((g) => card(g))}

              {(threads.length > 0 || games.length > 0) && (
                <div className="pt-1">
                  <ActionLink busy={busy === "beatsheet"} icon={<Sparkles className="h-3.5 w-3.5" />} onClick={() => generateFromPillar("beatsheet", "Beat sheet generated")}>
                    generate beat sheet (schedules promises, plays the games, paces the whole book)
                  </ActionLink>
                </div>
              )}
            </div>
          )}
        </>
      );
    }
    // scenes + draft: the scenes grouped under their beat. Each beat is a collapsible group header (the
    // beat itself is in the Structure stage) — fold a beat to hide its scenes, so this stage reads as an
    // outline of beats you drill into one at a time.
    const beatsAll = of("movement").flatMap((m) => childrenOf(nodes, m.id).filter((b) => b.kind === "beat"));
    const beatsNeedingScenes = beatsAll.filter((b) => !childrenOf(nodes, b.id).some((c) => c.kind === "scene"));
    const generateAllScenes = () => run("allscenes", async () => {
      let added = 0; const failed: string[] = [];
      for (const b of beatsNeedingScenes) {
        try { added += (await expandNode(bookId, b, "scenes", {})).added; }
        catch (e) { failed.push(String((e as Error)?.message ?? e)); }
      }
      toast({ title: "Scenes generated", description: `${added} scene(s) across ${beatsNeedingScenes.length - failed.length}/${beatsNeedingScenes.length} beat(s)${failed.length ? ` · ${failed.length} failed` : ""}.` });
    });
    return (
      <>
        <DnaAnalysis nodes={nodes} settings={settings} />
        {beatsNeedingScenes.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <ActionLink busy={busy === "allscenes"} icon={<Sparkles className="h-3.5 w-3.5" />} onClick={generateAllScenes}>
              generate scenes for all {beatsNeedingScenes.length} beat{beatsNeedingScenes.length > 1 ? "s" : ""}
            </ActionLink>
          </div>
        )}
        {beatsAll.map((b) => {
          const scenes = childrenOf(nodes, b.id).filter((s) => s.kind === "scene");
          const open = isOpen(b);
          const need = scenes.filter((s) => attn.has(s.id)).length;
          const beatBusy = `scene:${b.id}`;
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
                  {scenes.length === 0 && (
                    <ActionLink busy={busy === beatBusy} icon={<Sparkles className="h-3.5 w-3.5" />}
                      onClick={() => run(beatBusy, async () => { const { added } = await expandNode(bookId, b, "scenes", {}); toast({ title: "Scenes generated", description: `${added} scene(s).` }); })}>
                      generate scenes
                    </ActionLink>
                  )}
                  {scenes.map((s) => card(s))}
                  <ActionLink busy={busy === "add"} onClick={() => addChild(b, "scene", 5)}>add scene</ActionLink>
                </>
              )}
            </div>
          );
        })}
        {key === "draft" && (() => {
          const scenesAll = of("scene");
          // Picture mode counts ILLUSTRATED scenes (a pinned image); prose mode counts written scenes.
          const done = scenesAll.filter((s) =>
            picture
              ? (s.content as SceneContent).image_url && !isIllusStale(s)
              : (s.content as SceneContent).prose?.text && !isProseStale(s)
          ).length;
          const ready = scenesAll.length > 0 && done === scenesAll.length;
          const noun = picture ? "illustrated" : "drafted";
          const scenesNeedingProse = !picture ? scenesAll.filter((s) => !(s.content as SceneContent).prose?.text?.trim() || isProseStale(s)) : [];
          const scenesWithProse = !picture ? scenesAll.filter((s) => !!(s.content as SceneContent).prose?.text?.trim()) : [];
          const generateAllProse = () => run("allprose", async () => {
            let ok = 0; const failed: string[] = [];
            for (const s of scenesNeedingProse) {
              try { await expandNode(bookId, s, "prose", {}); ok++; } catch (e) { failed.push(String((e as Error)?.message ?? e)); }
            }
            toast({ title: "Prose generated", description: `${ok}/${scenesNeedingProse.length} scene(s) written${failed.length ? ` · ${failed.length} failed` : ""}.` });
          });
          const discardAllProse = () => {
            if (scenesWithProse.length === 0) return;
            if (!window.confirm(`Discard the prose on ${scenesWithProse.length} scene${scenesWithProse.length === 1 ? "" : "s"}? The scenes stay — you'll re-draft from them. This can't be undone.`)) return;
            void run("discard prose", async () => {
              await Promise.all(scenesWithProse.map((s) => saveNode({
                ...s,
                content: { ...(s.content as SceneContent), prose: {} },
                authoring: { ...s.authoring, prose_src_hash: undefined },
              })));
              toast({ title: "Prose discarded", description: `${scenesWithProse.length} scene${scenesWithProse.length === 1 ? "" : "s"} cleared. Write prose to re-draft.` });
            });
          };
          return (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-2">
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
              {!picture && scenesNeedingProse.length > 0 && (
                <ActionLink busy={busy === "allprose"} icon={<Sparkles className="h-3.5 w-3.5" />} onClick={generateAllProse}>
                  write prose for all {scenesNeedingProse.length} missing/stale scene{scenesNeedingProse.length !== 1 ? "s" : ""}
                </ActionLink>
              )}
              {!picture && scenesWithProse.length > 0 && (
                <ActionLink tone="faint" busy={busy === "discard prose"} onClick={discardAllProse}>
                  discard all prose →
                </ActionLink>
              )}
              <ActionLink busy={busy === "render"} onClick={render} tone="faint">render only</ActionLink>
            </div>
          );
        })()}
      </>
    );
  };

  const dot = (s: typeof stages[number]): "done" | "active" | "ready" | "locked" =>
    s.status === "done" ? "done" : s.status === "now" ? "active" : s.status === "locked" ? "locked" : "ready";

  const nav = (
    <div className="h-full overflow-y-auto border-b border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/40 px-4 pb-12 pt-5 md:border-b-0 md:border-r">
      <div className="mb-3 flex items-baseline justify-between px-1">
        <Eyebrow tone="muted">Build</Eyebrow>
        <span className="pv-mono text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">step {nowIndex + 1} / {stages.length}</span>
      </div>
      {/* Overview — the studio's home; the dashboard, not a resolution rung (so it sits above the ladder). */}
      {nodes.length > 0 && (
        <button onClick={() => setView("overview")}
          className={`mb-1.5 flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors ${onOverview ? "bg-[hsl(var(--pv-accent))]/[0.08]" : "hover:bg-[hsl(var(--pv-surface-2))]/60"}`}>
          <span className="flex h-5 w-5 items-center justify-center"><LayoutDashboard className={`h-3.5 w-3.5 ${onOverview ? "text-[hsl(var(--pv-accent))]" : "text-[hsl(var(--pv-text-faint))]"}`} /></span>
          <span className={`pv-serif flex-1 text-[14px] ${onOverview ? "text-foreground" : "text-[hsl(var(--pv-text-muted))]"}`}>Overview</span>
        </button>
      )}
      {stages.map((s) => {
        const subs = nodes.length > 0 ? stageSubsteps(s.key, nodes, picture ? "picture" : "prose") : [];
        const done = subs.filter((ss) => ss.status === "done").length;
        const focused = !onOverview && activeKey === s.key; // highlighted only when this stage is the open view
        return (
          <div key={s.key}>
            <button disabled={s.status === "locked"} onClick={() => setView(s.key)}
              className={`mb-0.5 flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors disabled:opacity-40 ${focused ? "bg-[hsl(var(--pv-accent))]/[0.08]" : "hover:bg-[hsl(var(--pv-surface-2))]/60"}`}>
              <StepDot state={dot(s)} />
              <span className="pv-mono text-[11px] text-[hsl(var(--pv-text-faint))]">{s.num}</span>
              <span className={`pv-serif flex-1 text-[14px] ${s.status === "locked" ? "text-[hsl(var(--pv-text-faint))]" : focused ? "text-foreground" : "text-[hsl(var(--pv-text-muted))]"}`}>{s.label}</span>
              {/* the "now" stage shows a sub-step tally so progress reads without expanding it */}
              {s.status === "now" && subs.length > 0 && <span className="pv-mono text-[9px] text-[hsl(var(--pv-text-faint))]">{done}/{subs.length}</span>}
              {s.status === "now" && <span className="pv-mono text-[9px] uppercase tracking-[0.12em] text-[hsl(var(--pv-accent))]">now</span>}
            </button>
            {/* The active stage unfolds its serial sub-step spine: dot = state (done/now/blocked), the
                connector line = the chain, "opt" = a parallel branch off the spine. */}
            {focused && subs.length > 0 && (
              <div className="mb-1.5 ml-[26px] space-y-px border-l border-[hsl(var(--pv-border-soft))] py-0.5 pl-3.5">
                {subs.map((ss) => <SubStepRow key={ss.key} sub={ss} />)}
              </div>
            )}
            {/* Visuals — a standalone, NON-gating section (no StepDot number) that sits right under
                Foundations. Always reachable; it never blocks the stages below it. */}
            {s.key === "foundations" && (
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
            )}
          </div>
        );
      })}
      <div className="mx-2.5 my-3 h-px bg-[hsl(var(--pv-border-soft))]" />
      <div className="flex flex-col items-start gap-2 px-2.5">
        {/* The brief (genre/length/heat/audience — the binding mandate) lives in the Build Studio; the
            concept there is the same idea this DNA tree elaborates. Jump out to edit it. */}
        <ActionLink tone="muted" onClick={() => navigate(`/books/${bookSlug}/studio/brief`)}>edit brief →</ActionLink>
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
          <DnaOverview bookId={bookId} nodes={nodes} settings={settings} stages={stages} nowKey={nowKey} onOpen={openStage} onChanged={onChanged} />
        ) : onVisuals ? (
          // The standalone Visuals control room — look, cast references, illustrations (renders its own StageHead).
          <DnaVisuals bookId={bookId} nodes={nodes} settings={settings} onChanged={onChanged} />
        ) : (
          <>
            <StageHead eyebrow={active.status === "done" ? "Approved" : active.status === "now" ? "Focus · the next move" : "Stage"} title={active.label} caption={active.caption}
              right={["foundations", "structure", "scenes", "draft"].includes(activeKey) ? (
                <div className="flex shrink-0 items-center gap-3">
                  <ActionLink tone="faint" onClick={() => setAll(true)}>expand all</ActionLink>
                  <ActionLink tone="faint" onClick={() => setAll(false)}>collapse all</ActionLink>
                </div>
              ) : undefined} />
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
  const rail = nodes.length > 0 ? <AgentRail bookId={bookId} nodes={nodes} settings={settings} /> : null;

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

// One rung of the Navigator's sub-step spine. The dot encodes state (filled = done, ring = now, lock =
// blocked, hollow = available); "opt" flags a parallel branch; the right number is the collection's tally.
// Read-only — it surfaces the serial blocking + progress, it isn't an action.
function SubStepRow({ sub }: { sub: SubStep }) {
  const dot =
    sub.status === "done" ? <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--pv-accent))]" />
      : sub.status === "now" ? <span className="flex h-2.5 w-2.5 items-center justify-center rounded-full border border-[hsl(var(--pv-accent))]"><span className="h-1 w-1 rounded-full bg-[hsl(var(--pv-accent))]" /></span>
        : sub.status === "locked" ? <Lock className="h-2.5 w-2.5 text-[hsl(var(--pv-text-faint))]" />
          : <span className="h-1.5 w-1.5 rounded-full border border-[hsl(var(--pv-text-faint))]/60" />;
  const tone = sub.status === "locked" ? "text-[hsl(var(--pv-text-faint))]" : sub.status === "now" ? "text-foreground" : "text-[hsl(var(--pv-text-muted))]";
  const count = sub.total != null ? `${sub.count ?? 0}/${sub.total}` : sub.count ? String(sub.count) : null;
  return (
    <div className="flex items-center gap-2 py-[3px]" title={sub.status === "locked" ? "blocked — finish the step above it first" : sub.manual ? "hand-authored — type it in" : undefined}>
      <span className="flex w-2.5 shrink-0 items-center justify-center">{dot}</span>
      <span className={`pv-serif text-[12.5px] leading-none ${tone}`}>{sub.label}</span>
      {sub.optional && <span className="pv-mono text-[8px] uppercase tracking-[0.1em] text-[hsl(var(--pv-text-faint))]/70">opt</span>}
      {count && <span className="pv-mono ml-auto text-[9px] text-[hsl(var(--pv-text-faint))]">{count}</span>}
    </div>
  );
}

// ── Beat reordering (drag-and-drop within a movement) ────────────────────────
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
    case "movement": return s((c as MovementContent).title) ?? s((c as MovementContent).goal);
    case "beat": return s((c as BeatContent).summary);
    case "scene": return s((c as SceneContent).chapter_start?.title) ?? s((c as SceneContent).goal);
    case "tentpole": return s((c as { summary?: string }).summary);
    case "character": case "world_fact": case "thread": case "game": return s((c as { name?: string }).name);
    default: return undefined;
  }
}

// The uniform node card — the same verbs (generate / edit / lock) at every depth, now in four stable zones:
// IDENTITY (kind · title · status) → SUMMARY (derived engine data) → FIELDS (editable slots) → ACTIONS (a
// persistent bar: approve gate, generate, lock, delete). The action bar always occupies its row, so the
// card never reflows as state changes (low layout shift). A beat's connector glyph (∴/↯) prefixes its title.
function NodeCard({ node, index, bookId, kids, onChanged, accent, expanded, onToggle, meta, picture, flash }: {
  node: DnaNode; index: Map<string, DnaNode>; bookId: number; kids: DnaNode[]; onChanged: () => void; accent?: boolean;
  expanded: boolean; onToggle: () => void; meta?: string; picture?: boolean; flash?: boolean;
}) {
  const { toast } = useToast();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState<string | null>(null);
  // Two-phase illustrate: compose → show preview → author edits → render. preview holds the composed
  // scene image data (prompt + refImages + model) while the panel is visible.
  const [preview, setPreview] = useState<ComposedSceneImage | null>(null);
  useEffect(() => { setDrafts({}); setPreview(null); }, [node.id]);
  const isPictureScene = picture && node.kind === "scene";
  // Picture-mode scene cards edit the CAPTION (not prose) + show the illustration; everything else is shared.
  const fields = isPictureScene
    ? [
        ...(FIELDS.scene ?? []).map((f) => f.key === "prose.text" ? { key: "caption.text", label: "caption" } : f),
        // Per-scene art direction — folded into THIS scene's image prompt on top of the book house look.
        // Editing it flips the scene stale (it's in the illus hash) → re-illustrate to apply.
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
  // Available generate verbs: hide a SINGLE-child target once made, and a target whose prerequisite kind
  // (e.g. relationships need a cast) doesn't exist yet. Picture-mode scenes ILLUSTRATE instead of "write prose".
  const baseTargets = isPictureScene
    ? [{ target: "illustrate", label: "illustrate", childKind: "scene" as NodeKind }]
    : (EXPAND_TARGETS[node.kind] ?? []);
  const targets = baseTargets.filter((t) =>
    !(SINGLE.has(t.target) && kids.some((c) => c.kind === t.childKind)) && !(t.needs && !kids.some((c) => c.kind === t.needs)));

  const guard = async (label: string, fn: () => Promise<void>) => {
    try { await fn(); onChanged(); } catch (e) { toast({ title: label, description: String((e as Error)?.message ?? e), variant: "destructive" }); }
  };
  const ready = node.authoring.status === "accepted"; // progressive disclosure: expand only from an accepted rung (§7)
  const save = (patch: Record<string, unknown>) => guard("Couldn't save", () => saveNode(editContent(node, patch)));
  const accept = () => guard("Couldn't accept", () => saveNode(setStatus(node, "accepted")));
  const toggleLock = () => guard("Couldn't lock", () => saveNode(lockNode(node, !locked)));
  const remove = () => { if (window.confirm(`Delete this ${node.kind} and everything under it?`)) void guard("Couldn't delete", () => deleteNode(node.id)); };
  const generate = async (t: ExpandTarget) => {
    // Picture mode: two-phase ILLUSTRATE — compose → show editable preview → render. The preview IS the
    // confirm, so we drop the window.confirm for re-illustrate. Phase 1 (compose) writes the caption
    // + stamps the hash, ensures portraits, and returns the prompt. Phase 2 (render) is triggered from
    // the ImagePromptPreview panel after the author reviews/edits.
    if (t.target === "illustrate") {
      setGenerating("illustrate");
      try {
        const composed = await composeSceneIllustration(bookId, node);
        setPreview(composed);
        onChanged(); // caption + stamp already written
      } catch (e) {
        toast({ title: "Couldn't compose illustration", description: String((e as Error)?.message ?? e), variant: "destructive" });
      } finally {
        setGenerating(null);
      }
      return;
    }
    // Regenerate REPLACES the unlocked children of this kind (locked ones are kept); first run just appends.
    const existing = kids.filter((c) => c.kind === t.childKind);
    const unlocked = existing.filter((c) => !c.authoring.locked);
    if (t.target === "prose" && (node.content as SceneContent).prose?.text?.trim() && !window.confirm("Rewrite this scene's prose?")) return;
    if (unlocked.length && !window.confirm(`Regenerate? Replaces ${unlocked.length} ${t.childKind}(s)${existing.length - unlocked.length ? `, keeps ${existing.length - unlocked.length} locked` : ""}.`)) return;
    setGenerating(t.target);
    try {
      await expandNode(bookId, node, t.target, { startPosition: existing.length - unlocked.length, replaceIds: unlocked.map((c) => c.id) });
      onChanged();
    } catch (e) { toast({ title: "Couldn't generate", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
    finally { setGenerating(null); }
  };

  return (
    <Panel id={`dna-node-${node.id}`} variant={accent ? "chosen" : "soft"}
      className={`px-4 py-3 scroll-mt-6 transition-[box-shadow,border-color] ${flash ? "border-[hsl(var(--pv-accent))] ring-2 ring-[hsl(var(--pv-accent))]/40" : ""}`}>
      {/* IDENTITY — the whole row toggles open/closed; chevron · kind · title · status all on one line */}
      <button type="button" onClick={onToggle} className="flex w-full items-start gap-2 text-left">
        <span className="mt-0.5 shrink-0 text-[hsl(var(--pv-text-faint))]">
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
        <Eyebrow tone="accent" className="mt-0.5 shrink-0">{node.kind}</Eyebrow>
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

      {/* PICTURE MODE — editable prompt preview after compose, before render. The author reviews (and
          optionally edits) the prompt + ref thumbnails + model, then clicks Generate to kick the durable
          render. Clearing preview after render or cancel. */}
      {isPictureScene && preview && (
        <ImagePromptPreview
          prompt={preview.prompt}
          refImages={preview.refImages}
          model={preview.model}
          busy={generating === "rendering"}
          onGenerate={async (finalPrompt) => {
            setGenerating("rendering");
            try {
              await renderSceneIllustration(bookId, node.id, { ...preview, prompt: finalPrompt });
              setPreview(null);
              onChanged();
            } catch (e) {
              toast({ title: "Couldn't generate image", description: String((e as Error)?.message ?? e), variant: "destructive" });
            } finally {
              setGenerating(null);
            }
          }}
          onCancel={() => setPreview(null)}
        />
      )}

      {/* FIELDS — the editable slots; ★ marks a load-bearing one */}
      {fields.length > 0 && (
        <div className="mt-2.5 space-y-1.5">
          {fields.map((fld) => {
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

      {/* (Reference portraits live in the standalone Visuals section now, not on the card.) */}

      {/* ACTIONS — a persistent bar (never reflows): generate verbs left, edit controls right */}
      <div className="mt-3 flex min-h-[24px] items-center gap-3 border-t border-[hsl(var(--pv-border-soft))]/60 pt-2.5">
        {generating ? (
          <RunningInline label={generating === "prose" ? "writing prose…" : generating === "illustrate" ? "composing prompt…" : generating === "rendering" ? "rendering…" : "generating…"} />
        ) : (
          <>
            {!ready && (
              <ActionLink onClick={accept} icon={<Check className="h-3.5 w-3.5" />} title="approve this rung to unlock generating below it">approve</ActionLink>
            )}
            {ready && targets.map((t) => (
              <ActionLink key={t.target} icon={<Sparkles className="h-3.5 w-3.5" />} onClick={() => generate(t)} title={t.label}>{t.label}</ActionLink>
            ))}
            <div className="ml-auto flex items-center gap-3 text-[hsl(var(--pv-text-faint))]">
              <button onClick={toggleLock} title={locked ? "unlock — let regeneration revise this again" : "lock — pin this so regeneration can't touch it"} className={`transition-colors ${locked ? "text-[hsl(var(--pv-accent))]" : "hover:text-foreground"}`}>
                {locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
              </button>
              <button onClick={remove} title="delete this node and everything under it" className="transition-colors hover:text-destructive/70"><X className="h-3.5 w-3.5" /></button>
            </div>
          </>
        )}
      </div>
      </>)}
    </Panel>
  );
}
