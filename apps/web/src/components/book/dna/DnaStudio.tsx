// DnaStudio — the four-verb authoring surface for the Novel DNA tree (Phase 4/5). The book IS the tree
// (docs/novel-dna-schema.md); this is the "hungry structure" the author fills. One uniform NodeCard for
// every kind (the self-similar promise: learn generate/edit/lock once). Styled with the studio's own
// primitives (studioUi) so it reads as part of the Build Studio. Live projection of book_nodes; pages are
// produced on demand via reconcileDna (Render). expand = ONE authoritative value (not proposals).
import { useEffect, useState } from "react";
import { Lock, Unlock, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { ActionLink, Eyebrow, Panel, RunningInline, StageHead, StepDot } from "@/components/book/studio/studioUi";
import { buildJourney, type StageKey } from "@/lib/dnaJourney";
import { DnaChatRail } from "@/components/book/dna/DnaChatRail";
import { DnaAnalysis } from "@/components/book/dna/DnaAnalysis";
import { saveNode, deleteNode } from "@/lib/bookNodes";
import { migrateBookToDna } from "@/lib/migrateToDna";
import { reconcileDna } from "@/lib/novelDnaRender";
import { expandNode } from "@/lib/dnaExpand";
import {
  byId, childrenOf, editContent, emptyNode, isProseStale, isStale, lock as lockNode, renderBlockers,
  setStatus, type CharacterContent, type DnaNode, type NodeKind, type RelationshipContent, type SceneContent,
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
  premise: [{ key: "dramatic_question", label: "dramatic question" }, { key: "shape.setup", label: "shape / throughline" }],
  pillar: [{ key: "controlling_idea", label: "controlling idea" }, { key: "ending", label: "ending ★" }],
  character: [{ key: "name", label: "name" }, { key: "want", label: "want" }, { key: "need", label: "need ★" }, { key: "wound", label: "wound ★" }, { key: "lie", label: "lie ★" }, { key: "idiolect", label: "idiolect" }],
  relationship: [{ key: "bond", label: "bond" }, { key: "charge", label: "charge" }],
  tentpole: [{ key: "summary", label: "set-piece" }],
  world_fact: [{ key: "name", label: "name" }, { key: "rule", label: "rule" }, { key: "mechanism", label: "mechanism (what it enables/forbids) ★" }],
  thread: [{ key: "name", label: "name" }, { key: "promise", label: "promise ★" }, { key: "payoff", label: "payoff" }, { key: "kind", label: "kind (mystery/foreshadow/setup_payoff/arc)" }],
  movement: [{ key: "title", label: "title" }, { key: "goal", label: "goal" }, { key: "turning_point", label: "turning point ★" }, { key: "target_pct", label: "target position (0–1) ★" }],
  beat: [{ key: "summary", label: "beat" }, { key: "connector", label: "connector (therefore/but)" }, { key: "polarity", label: "polarity (up/down)" }],
  scene: [{ key: "chapter_start.title", label: "chapter title (blank = mid-chapter)" }, { key: "goal", label: "goal" }, { key: "outcome", label: "outcome" }, { key: "prose.text", label: "prose" }],
};

const getPath = (obj: Record<string, unknown>, path: string): string => {
  const v = path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "";
};
// Numeric content fields (kept as numbers in jsonb so the engine's pacing() reads them).
const NUMERIC_KEYS = new Set(["target_pct"]);
const setPath = (path: string, value: string): Record<string, unknown> => {
  const keys = path.split(".");
  const leaf = keys[keys.length - 1];
  const coerced: unknown = NUMERIC_KEYS.has(leaf) ? (value.trim() === "" ? undefined : Number(value)) : value;
  const root: Record<string, unknown> = {};
  let cur = root;
  keys.forEach((k, i) => { if (i === keys.length - 1) cur[k] = coerced; else { cur[k] = {}; cur = cur[k] as Record<string, unknown>; } });
  return root;
};
const deepMerge = (a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> => {
  const out = { ...a };
  for (const k of Object.keys(b)) {
    const bv = b[k], av = out[k];
    out[k] = bv && typeof bv === "object" && !Array.isArray(bv) && av && typeof av === "object" ? deepMerge(av as Record<string, unknown>, bv as Record<string, unknown>) : bv;
  }
  return out;
};

export interface DnaSettings { title?: string; author?: string; word_target?: number }

export function DnaStudio({ bookId, bookSlug, settings, nodes, onChanged }: {
  bookId: number; bookSlug: string; settings: DnaSettings; nodes: DnaNode[]; onChanged: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<StageKey | null>(null); // chosen stage; null = follow the live "now" stage
  const index = byId(nodes);
  const of = (kind: NodeKind) => nodes.filter((n) => n.kind === kind);
  const blockers = renderBlockers(nodes, settings);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try { await fn(); onChanged(); }
    catch (e) { toast({ title: `Couldn't ${label}`, description: String((e as Error)?.message ?? e), variant: "destructive" }); }
    finally { setBusy(null); }
  };
  const migrate = () => run("migrate", async () => { const { count } = await migrateBookToDna(bookId); toast({ title: "Migrated to DNA", description: `${count} nodes built from the legacy book.` }); });
  const render = () => run("render", async () => { const r = await reconcileDna(bookId); toast({ title: "Rendered", description: `${r.pages} pages · ${r.created} added · ${r.updated} updated · ${r.archived} archived.` }); });
  const addChild = (parent: DnaNode, kind: NodeKind, level: number) =>
    run("add", () => saveNode(emptyNode(bookId, kind, level, parent.id, childrenOf(nodes, parent.id).length)));
  // Stage-level generation (a whole-arc op, not a per-node verb): threads (the promise registry) and the
  // GLOBAL beat sheet both read every movement, so they live as structure-stage actions on the pillar.
  const generateFromPillar = (target: string, label: string) =>
    run(target, async () => { if (!pillar) return; const { added } = await expandNode(bookId, pillar, target, {}); toast({ title: label, description: `${added} node(s) generated.` }); });

  const card = (n: DnaNode, accent?: boolean) => (
    <NodeCard key={n.id} node={n} index={index} bookId={bookId} kids={childrenOf(nodes, n.id)} onChanged={onChanged} accent={accent} />
  );
  const [seed, premise, pillar] = [of("seed")[0], of("premise")[0], of("pillar")[0]];
  const entityKinds: NodeKind[] = ["character", "relationship", "tentpole", "world_fact"];

  // The guided journey: ordered stages of increasing resolution. Default focus = the live "now" stage.
  const { stages, nowIndex } = buildJourney(nodes);
  const nowKey = stages[nowIndex]?.key ?? "premise";
  const selectable = (k: StageKey) => stages.find((s) => s.key === k)?.status !== "locked";
  const activeKey: StageKey = selected && selectable(selected) ? selected : nowKey;
  const active = stages.find((s) => s.key === activeKey)!;
  const nextStage = stages[stages.findIndex((s) => s.key === activeKey) + 1];

  const renderStage = (key: StageKey) => {
    if (key === "premise") return [seed, premise].filter(Boolean).map((n) => card(n!));
    if (key === "foundations") return (
      <>
        {pillar && card(pillar, true)}
        {pillar && (
          <div className="flex flex-wrap items-center gap-2">
            {entityKinds.map((k) => (
              <button key={k} onClick={() => addChild(pillar, k, 2)} className="pv-serif text-[12px] italic text-[hsl(var(--pv-text-faint))] hover:text-[hsl(var(--pv-accent))]">+ {k}</button>
            ))}
          </div>
        )}
        {entityKinds.flatMap((k) => of(k)).map((n) => card(n))}
      </>
    );
    if (key === "structure") {
      const movements = of("movement");
      const threads = of("thread");
      return (
        <>
          <DnaAnalysis nodes={nodes} settings={settings} />
          {movements.map((m) => (
            <div key={m.id} className="space-y-2">
              {card(m, true)}
              <div className="ml-4 space-y-2 border-l border-[hsl(var(--pv-border-soft))] pl-4">
                {childrenOf(nodes, m.id).filter((b) => b.kind === "beat").map((b) => card(b))}
                <ActionLink busy={busy === "add"} onClick={() => addChild(m, "beat", 4)}>add beat</ActionLink>
              </div>
            </div>
          ))}
          {pillar && <ActionLink busy={busy === "add"} onClick={() => addChild(pillar, "movement", 3)}>add movement</ActionLink>}

          {/* The promise registry (threads) + the global beat sheet — whole-arc ops on the acts above. */}
          {pillar && movements.length > 0 && (
            <div className="space-y-2 border-t border-[hsl(var(--pv-border-soft))] pt-4">
              <div className="flex items-center gap-3">
                <Eyebrow tone="muted">promises · the thread registry</Eyebrow>
                <ActionLink busy={busy === "threads"} icon={<Sparkles className="h-3.5 w-3.5" />} onClick={() => generateFromPillar("threads", "Threads generated")}>
                  {threads.length ? "regenerate threads" : "generate threads"}
                </ActionLink>
              </div>
              {threads.map((t) => card(t))}
              {threads.length > 0 && (
                <div className="pt-1">
                  <ActionLink busy={busy === "beatsheet"} icon={<Sparkles className="h-3.5 w-3.5" />} onClick={() => generateFromPillar("beatsheet", "Beat sheet generated")}>
                    generate beat sheet (schedules promises + paces the whole book)
                  </ActionLink>
                </div>
              )}
            </div>
          )}
        </>
      );
    }
    // scenes + draft: the scenes in their beat context (draft is where prose gets written + rendered).
    return (
      <>
        <DnaAnalysis nodes={nodes} settings={settings} />
        {of("movement").map((m) => childrenOf(nodes, m.id).filter((b) => b.kind === "beat").map((b) => (
          <div key={b.id} className="space-y-2">
            <Eyebrow tone="muted">{(b.content as { summary?: string }).summary || "beat"}</Eyebrow>
            {childrenOf(nodes, b.id).filter((s) => s.kind === "scene").map((s) => card(s))}
            <ActionLink busy={busy === "add"} onClick={() => addChild(b, "scene", 5)}>add scene</ActionLink>
          </div>
        )))}
        {key === "draft" && <ActionLink busy={busy === "render"} onClick={render}>render pages →</ActionLink>}
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
      {stages.map((s) => (
        <button key={s.key} disabled={s.status === "locked"} onClick={() => setSelected(s.key)}
          className={`mb-0.5 flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors disabled:opacity-40 ${activeKey === s.key ? "bg-[hsl(var(--pv-accent))]/[0.08]" : "hover:bg-[hsl(var(--pv-surface-2))]/60"}`}>
          <StepDot state={dot(s)} />
          <span className="pv-mono text-[11px] text-[hsl(var(--pv-text-faint))]">{s.num}</span>
          <span className={`pv-serif flex-1 text-[14px] ${s.status === "locked" ? "text-[hsl(var(--pv-text-faint))]" : activeKey === s.key ? "text-foreground" : "text-[hsl(var(--pv-text-muted))]"}`}>{s.label}</span>
          {s.status === "now" && <span className="pv-mono text-[9px] uppercase tracking-[0.12em] text-[hsl(var(--pv-accent))]">now</span>}
        </button>
      ))}
      <div className="mx-2.5 my-3 h-px bg-[hsl(var(--pv-border-soft))]" />
      <div className="flex flex-col items-start gap-2 px-2.5">
        {nodes.length === 0 && <ActionLink busy={busy === "migrate"} onClick={migrate}>migrate from legacy</ActionLink>}
        {nodes.length > 0 && <ActionLink busy={busy === "render"} onClick={render}>render pages →</ActionLink>}
        <a href={`/books/${bookSlug}`} className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))] hover:text-[hsl(var(--pv-accent))]">read →</a>
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
        ) : (
          <>
            <StageHead eyebrow={active.status === "done" ? "Approved" : active.status === "now" ? "Focus · the next move" : "Stage"} title={active.label} caption={active.caption} />
            <div className="space-y-2">{renderStage(activeKey)}</div>
            {active.status === "done" && nextStage && nextStage.status !== "locked" && (
              <div className="pt-2"><ActionLink onClick={() => setSelected(nextStage.key)}>continue to {nextStage.label} →</ActionLink></div>
            )}
          </>
        )}
      </div>
    </div>
  );

  const railHandle = <ResizableHandle className="w-1.5 bg-transparent transition-colors hover:bg-[hsl(var(--pv-accent))]/30 data-[resize-handle-state=drag]:bg-[hsl(var(--pv-accent))]/50" />;
  const rail = nodes.length > 0 ? <DnaChatRail bookId={bookId} stage={activeKey} nodes={nodes} settings={settings} onApplied={onChanged} /> : null;

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

// The uniform node card — the same verbs (generate / edit / lock) at every depth.
function NodeCard({ node, index, bookId, kids, onChanged, accent }: {
  node: DnaNode; index: Map<string, DnaNode>; bookId: number; kids: DnaNode[]; onChanged: () => void; accent?: boolean;
}) {
  const { toast } = useToast();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState<string | null>(null);
  useEffect(() => { setDrafts({}); }, [node.id]);
  const fields = FIELDS[node.kind] ?? [];
  const stale = isStale(node, index) || (node.kind === "scene" && isProseStale(node));
  // A relationship card names its dyad (a/b are character node ids).
  const dyad = node.kind === "relationship" ? (() => {
    const c = node.content as RelationshipContent;
    const nm = (id?: string) => (id ? (index.get(id)?.content as CharacterContent | undefined)?.name : undefined);
    const a = nm(c.a), b = nm(c.b);
    return a && b ? `${a} ↔ ${b}` : undefined;
  })() : undefined;
  // Available generate verbs: hide a SINGLE-child target once made, and a target whose prerequisite kind
  // (e.g. relationships need a cast) doesn't exist yet.
  const targets = (EXPAND_TARGETS[node.kind] ?? []).filter((t) =>
    !(SINGLE.has(t.target) && kids.some((c) => c.kind === t.childKind)) && !(t.needs && !kids.some((c) => c.kind === t.needs)));

  const guard = async (label: string, fn: () => Promise<void>) => {
    try { await fn(); onChanged(); } catch (e) { toast({ title: label, description: String((e as Error)?.message ?? e), variant: "destructive" }); }
  };
  const ready = node.authoring.status === "accepted"; // progressive disclosure: expand only from an accepted rung (§7)
  const save = (patch: Record<string, unknown>) => guard("Couldn't save", () => saveNode(editContent(node, patch)));
  const accept = () => guard("Couldn't accept", () => saveNode(setStatus(node, "accepted")));
  const toggleLock = () => guard("Couldn't lock", () => saveNode(lockNode(node, !node.authoring.locked)));
  const remove = () => { if (window.confirm(`Delete this ${node.kind} and everything under it?`)) void guard("Couldn't delete", () => deleteNode(node.id)); };
  const generate = async (t: ExpandTarget) => {
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
    <Panel variant={accent ? "chosen" : "soft"} className="px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <Eyebrow tone="accent">{node.kind}</Eyebrow>
        {dyad && <span className="pv-serif text-[12px] text-[hsl(var(--pv-text-muted))]">{dyad}</span>}
        <span className="pv-mono text-[9px] uppercase tracking-[0.1em] text-[hsl(var(--pv-text-faint))]">{node.authoring.status}</span>
        {stale && <span className="pv-mono text-[9px] uppercase tracking-[0.1em] text-amber-500">stale</span>}
        <div className="ml-auto flex items-center gap-3 text-[hsl(var(--pv-text-faint))]">
          {!ready && <ActionLink onClick={accept} title="accept this rung to unlock generating below it">accept</ActionLink>}
          {!generating && ready && targets.map((t) => (
            <ActionLink key={t.target} icon={<Sparkles className="h-3.5 w-3.5" />} onClick={() => generate(t)} title={t.label}>{t.label}</ActionLink>
          ))}
          <button onClick={toggleLock} title={node.authoring.locked ? "unlock" : "lock"} className={node.authoring.locked ? "text-[hsl(var(--pv-accent))]" : "hover:text-foreground"}>
            {node.authoring.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
          </button>
          <button onClick={remove} title="delete" className="text-[11px] hover:text-destructive/70">✕</button>
        </div>
      </div>

      {generating && <RunningInline label={generating === "prose" ? "writing prose…" : "generating…"} className="mb-2" />}

      <div className="space-y-1.5">
        {fields.map((fld) => {
          const val = drafts[fld.key] ?? getPath(node.content, fld.key);
          return (
            <label key={fld.key} className="block">
              <span className="pv-mono text-[9px] uppercase tracking-[0.1em] text-[hsl(var(--pv-text-faint))]">{fld.label}</span>
              <AutoTextarea
                value={val}
                disabled={node.authoring.locked}
                onChange={(e) => setDrafts((d) => ({ ...d, [fld.key]: e.target.value }))}
                onBlur={() => { const v = drafts[fld.key]; if (v != null && v !== getPath(node.content, fld.key)) void save(deepMerge(node.content as Record<string, unknown>, setPath(fld.key, v))); }}
                placeholder="—"
                className="pv-serif w-full resize-none border-0 border-b border-transparent bg-transparent px-0 py-0.5 text-[14px] leading-snug text-foreground outline-none focus:border-[hsl(var(--pv-accent))]/40 focus-visible:ring-0 disabled:opacity-60"
              />
            </label>
          );
        })}
      </div>
    </Panel>
  );
}
