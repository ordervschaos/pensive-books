// DnaOverview — the studio's home/dashboard, the first thing you see. It answers two questions: (1) what's the
// NEXT MOVE (the live "now" stage + its first open sub-step, with quick jumps into the optional branches that
// are also available); (2) what's WRONG (the conformance lints + render blockers, each a click away from the
// stage that owns it) — plus the Threads registry (edited here, a cross-cutting whole-book concern) and the
// tree as a navigable map. The read-only ANALYTIC projections (shape diagram · story map · census · promises
// ledger · pacing/topography) live on the analytics tab now — one place to comprehend the whole book, so this
// dashboard stays actionable. Reuses the engine (validate/renderBlockers) and the journey (stageSubsteps) so
// this never drifts from what the stages themselves compute.
import { useRef, type ReactNode } from "react";
import { ArrowRight, BookOpen, Check, GitBranch, Sparkles, TriangleAlert, Waypoints } from "lucide-react";
import { ActionLink, Eyebrow, Hero, Panel, StageHead } from "@/components/book/shared/studioUi";
import { KIND_STAGE, STAGE_KINDS, stageSubsteps, type JourneyStage, type StageKey } from "@/features/dna/lib/dnaJourney";
import type { Brief } from "@/lib/brief";
import {
  byId, childrenOf, isProseStale, isStale, validate,
  type BookSettings, type DnaNode, type NodeKind,
} from "@/features/dna/lib/novelDna";

const FAINT = "text-[hsl(var(--pv-text-faint))]";
const MUTED = "text-[hsl(var(--pv-text-muted))]";

// A node's lifecycle as one dot: accepted = filled accent (amber if drifted stale), else a hollow ring.
function NodePip({ node, index }: { node: DnaNode; index: Map<string, DnaNode> }) {
  const stale = isStale(node, index) || (node.kind === "scene" && isProseStale(node));
  const cls = node.authoring.status === "accepted"
    ? (stale ? "bg-amber-500" : "bg-[hsl(var(--pv-accent))]")
    : "border-[1.5px] border-[hsl(var(--pv-text-faint))]/60 bg-transparent";
  return <span className={`h-2 w-2 shrink-0 rounded-full ${cls}`} title={stale ? "approved · drifted" : node.authoring.status} />;
}

// One clickable row in the shape map: pip · kind · title · meta · jump arrow. Indented by depth.
function ShapeRow({ node, index, label, title, meta, depth, onOpen }: {
  node?: DnaNode; index: Map<string, DnaNode>; label: string; title?: string; meta?: string; depth: number; onOpen: () => void;
}) {
  return (
    <button type="button" onClick={onOpen}
      className="group flex w-full items-center gap-2.5 rounded-md py-1 pr-2 text-left transition-colors hover:bg-[hsl(var(--pv-surface-2))]/50"
      style={{ paddingLeft: depth * 18 + 6 }}>
      {node ? <NodePip node={node} index={index} /> : <span className={`h-2 w-2 shrink-0 rounded-full border-[1.5px] border-dashed ${FAINT} border-current/60`} />}
      <Eyebrow tone="accent" className="shrink-0">{label}</Eyebrow>
      {title && <span className={`pv-serif min-w-0 flex-1 truncate text-[13px] text-foreground`}>{title}</span>}
      {!title && <span className="flex-1" />}
      {meta && <span className={`pv-mono shrink-0 text-[9px] uppercase tracking-[0.1em] ${FAINT}`}>{meta}</span>}
      <ArrowRight className={`h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 ${FAINT}`} />
    </button>
  );
}

export function DnaOverview({ bookId, nodes, settings, stages, nowKey, brief, onSkipInterview, onOpen, onChanged, renderCard }: {
  bookId: number; nodes: DnaNode[]; settings: BookSettings; stages: JourneyStage[]; nowKey: StageKey; onOpen: (k: StageKey, focusId?: string) => void; onChanged: () => void;
  // The journey's first rung (the discovery interview) is gated on the BRIEF, not the tree — so the sub-step
  // derivation needs it, and the author needs a way out of it (onSkipInterview writes brief.vision.skipped).
  brief?: Brief | null;
  onSkipInterview?: () => void;
  // Threads are edited in place on the dashboard (a cross-cutting whole-book registry); the studio passes its
  // own card renderer down so we reuse the exact node-card UI without lifting it out.
  renderCard: (n: DnaNode, accent?: boolean) => ReactNode;
}) {
  const threadsRef = useRef<HTMLDivElement>(null);
  const index = byId(nodes);
  const of = (k: NodeKind) => nodes.filter((n) => n.kind === k);
  const first = (k: NodeKind) => of(k)[0];
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

  const [seed, premise, pillar] = [first("seed"), first("premise"), first("pillar")];
  const acts = of("act");
  const threads = of("thread");

  // ── Next move: the live now-stage + its first open sub-step, plus the optional branches also available now.
  const nowStage = stages.find((s) => s.key === nowKey)!;
  const allDone = stages.every((s) => s.status === "done");
  const subs = stageSubsteps(nowKey, nodes, brief);
  const nowSub = subs.find((s) => s.status === "now");
  const alsoAvailable = subs.filter((s) => s.status === "available");

  // ── Issues: the engine's lints + the render blockers, each routed to its owning stage.
  const issues = validate(nodes);
  const errors = issues.filter((i) => i.severity === "error").length;
  const issueStage = (nodeId?: string): StageKey => {
    const k = nodeId ? index.get(nodeId)?.kind : undefined;
    return k ? KIND_STAGE[k] : nowKey;
  };

  // ── The shape: counts for the entity branches + the cross-cutting registries.
  const counts: [NodeKind, string][] = [
    ["character", "cast"], ["world_fact", "world"], ["relationship", "relationships"], ["tentpole", "tent-poles"],
  ];
  const sceneCountOf = (m: DnaNode) =>
    childrenOf(nodes, m.id).filter((b) => b.kind === "beat").reduce((a, b) => a + childrenOf(nodes, b.id).filter((s) => s.kind === "scene").length, 0);

  return (
    <>
      <StageHead eyebrow="Overview" title={settings.title || "Untitled"}
        caption="What's next and what needs a look. The analytics tab has the full read — shape, story map, promises, meters." />

      {/* NEXT MOVE — the obvious thing to do, loud. */}
      {allDone ? (
        <Hero icon={<BookOpen className="h-5 w-5" />} title="Draft complete" sub="Every scene is drafted — open the reader." onClick={() => onOpen("draft")} />
      ) : (
        <Hero icon={<Sparkles className="h-5 w-5" />}
          title={`${nowStage.label}${nowSub ? ` · ${nowSub.label}` : ""}`}
          sub={nowStage.caption}
          onClick={() => onOpen(nowKey)} />
      )}
      

      {/* The interview is the one rung the author can decline outright — it asks THEM for the book, and an
          author who'd rather just start building shouldn't be stuck behind it (writes brief.vision.skipped;
          the journey re-derives itself off the live books row). */}
      {nowSub?.key === "interview" && onSkipInterview && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <Eyebrow tone="muted">or</Eyebrow>
          <ActionLink tone="faint" onClick={onSkipInterview}>skip the interview →</ActionLink>
        </div>
      )}

      {alsoAvailable.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <Eyebrow tone="muted">also ready</Eyebrow>
          {alsoAvailable.map((s) => (
            <ActionLink key={s.key} tone="faint" onClick={() => onOpen(nowKey)}>{s.label}{s.optional ? " (optional)" : ""} →</ActionLink>
          ))}
        </div>
      )}

      {/* THREADS — the promise registry (setup → payoff). A cross-cutting whole-book concern, so it's edited
          here on the dashboard rather than nested in the sequential spine. Uses the studio's own node card. */}
      <div ref={threadsRef}>
        <Panel variant="soft" className="px-4 py-3.5">
          <div className="mb-2.5 flex items-center gap-2">
            <Waypoints className={`h-3.5 w-3.5 ${FAINT}`} />
            <Eyebrow tone="muted">Threads — the promises this book makes, set up → paid off</Eyebrow>
          </div>
          {threads.length > 0 && <div className="mt-3 space-y-2">{threads.map((t) => renderCard(t))}</div>}
          {threads.length === 0 && <p className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))]">No threads yet.</p>}
        </Panel>
      </div>

      {/* ISSUES — conformance lints + render blockers, routed to their stage. */}
      <Panel variant={issues.length === 0 ? "soft" : "solid"} className="px-4 py-3.5">
        <div className="flex items-center gap-2">
          {issues.length === 0
            ? <><Check className="h-3.5 w-3.5 text-emerald-500" /><Eyebrow tone="muted">No issues — the structure is clean</Eyebrow></>
            : <><TriangleAlert className="h-3.5 w-3.5 text-amber-500" /><Eyebrow tone="muted">{errors ? `${errors} to fix · ` : ""}{issues.length - errors} to review</Eyebrow></>}
        </div>
        {issues.length > 0 && (
          <div className="mt-2.5 space-y-1.5">
            {issues.slice(0, 6).map((i, k) => (
              <button key={k} type="button"
                onClick={() => {
                  // thread issues are edited right here on the dashboard — scroll to the panel instead of routing.
                  if ((i.nodeId ? index.get(i.nodeId)?.kind : undefined) === "thread") { threadsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
                  onOpen(issueStage(i.nodeId), i.nodeId);
                }}
                className="group flex w-full items-start gap-2 text-left">
                <span className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${i.severity === "error" ? "bg-rose-500" : "bg-amber-500"}`} />
                <p className="pv-serif text-[12px] leading-snug">
                  <span className={`pv-mono mr-1.5 text-[9px] ${FAINT}`}>{i.rule}</span>
                  <span className={MUTED}>{i.message}</span>
                  <ArrowRight className={`ml-1 inline h-2.5 w-2.5 opacity-0 transition-opacity group-hover:opacity-100 ${FAINT}`} />
                </p>
              </button>
            ))}
            {issues.length > 6 && <p className={`pv-mono pl-3.5 text-[9px] ${FAINT}`}>+{issues.length - 6} more</p>}
          </div>
        )}
      </Panel>

      {/* THE SHAPE — the parent→child tree, collapsed to a navigable map. */}
      <Panel variant="soft" className="px-3 py-3">
        <div className="mb-1 flex items-center gap-2 px-2">
          <GitBranch className={`h-3.5 w-3.5 ${FAINT}`} />
          <Eyebrow tone="muted">The tree</Eyebrow>
        </div>
        <div className="space-y-px">
          {seed && <ShapeRow node={seed} index={index} label="seed" title={str((seed.content as { logline?: string }).logline)} depth={0} onOpen={() => onOpen("premise")} />}
          {premise && <ShapeRow node={premise} index={index} label="premise" title={str((premise.content as { dramatic_question?: string }).dramatic_question)} depth={1} onOpen={() => onOpen("premise")} />}
          {pillar && <ShapeRow node={pillar} index={index} label="pillar" title={str((pillar.content as { controlling_idea?: string }).controlling_idea)} depth={2} onOpen={() => onOpen("foundations")} />}

          {/* entity branches off the pillar — grouped as count chips (the interlinked context) */}
          {pillar && counts.some(([k]) => of(k).length > 0) && (
            <button type="button" onClick={() => onOpen("foundations")}
              className="group flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-md py-1 pr-2 transition-colors hover:bg-[hsl(var(--pv-surface-2))]/50" style={{ paddingLeft: 3 * 18 + 6 }}>
              {counts.filter(([k]) => of(k).length > 0).map(([k, label]) => (
                <span key={k} className={`pv-mono text-[9px] uppercase tracking-[0.1em] ${MUTED}`}><b className="font-semibold text-foreground">{of(k).length}</b> {label}</span>
              ))}
              <ArrowRight className={`h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100 ${FAINT}`} />
            </button>
          )}

          {/* the spine: each act with its nested beat/scene tally */}
          {acts.map((m, i) => {
            const b = childrenOf(nodes, m.id).filter((c) => c.kind === "beat").length;
            const sc = sceneCountOf(m);
            return (
              <ShapeRow key={m.id} node={m} index={index} label={`act ${i + 1}`}
                title={str((m.content as { title?: string }).title) ?? str((m.content as { goal?: string }).goal)}
                meta={`${b} beat${b === 1 ? "" : "s"}${sc ? ` · ${sc} scene${sc === 1 ? "" : "s"}` : ""}`}
                depth={3} onOpen={() => onOpen("structure")} />
            );
          })}

          {/* cross-cutting registries: games are a Foundations entity now; threads are edited on this page. */}
          {(threads.length > 0 || of("game").length > 0) && (
            <div className="mt-1 flex items-center gap-3 border-t border-[hsl(var(--pv-border-soft))]/50 py-1.5 pr-2 pt-2" style={{ paddingLeft: 6 }}>
              <Eyebrow tone="muted">spanning</Eyebrow>
              {of("game").length > 0 && (
                <button type="button" onClick={() => onOpen("foundations")} className="group flex items-center gap-1.5">
                  <span className={`pv-mono text-[9px] uppercase tracking-[0.1em] ${MUTED}`}><b className="font-semibold text-foreground">{of("game").length}</b> games</span>
                  <ArrowRight className={`h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100 ${FAINT}`} />
                </button>
              )}
              {threads.length > 0 && (
                <button type="button" onClick={() => threadsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} className="group flex items-center gap-1.5">
                  <span className={`pv-mono text-[9px] uppercase tracking-[0.1em] ${MUTED}`}><b className="font-semibold text-foreground">{threads.length}</b> threads</span>
                  <ArrowRight className={`h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100 ${FAINT}`} />
                </button>
              )}
            </div>
          )}
        </div>
      </Panel>
    </>
  );
}
