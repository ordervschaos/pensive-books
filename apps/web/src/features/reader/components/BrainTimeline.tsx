// BrainTimeline — the playable sweep.
//
// A book read is a sweep, and this is the scrubber for it: drag (or press play) and watch the
// reader's model of the story assemble itself unit by unit. Everything on screen is `foldTo(t)` —
// a pure recompute from the deltas, never a stored snapshot — so scrubbing backwards is exact
// rather than an undo, and the reader at unit 40 genuinely does not know what unit 41 says.
//
// The panels are the registers, laid out by the question each answers:
//   WHERE / ON STAGE  — the immediate scene
//   IN MIND           — activated memory, decaying (what they are actually holding)
//   WANTS             — open questions, the reason to turn the page
//   GRAPH             — how it all interconnects
//   THIS UNIT         — the delta: what this one paragraph did to them
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  clusters, diffBrains, diffIsEmpty, foldTo, immersion, importance, openQuestions, ranked, tracks, workingSet,
  type BrainState, type Entity, type Op, type Track, type UnitDelta,
} from "../lib/brain";
import { type ReaderUnit } from "../lib/readerMachine";
import { RelationGraph } from "./RelationGraph";
import { WhatJustHappened } from "./WhatJustHappened";
import { ReaderSnapshot } from "./ReaderSnapshot";

const KIND_LABEL: Record<Entity["kind"], string> = {
  character: "person", place: "place", object: "thing", faction: "faction", concept: "idea",
};

export function BrainTimeline({ units, deltas }: { units: ReaderUnit[]; deltas: UnitDelta[] }) {
  const [at, setAt] = useState(deltas.length - 1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(6);
  const [selected, setSelected] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const [full, setFull] = useState(false);
  const maxIndex = deltas.length - 1;
  const delta = deltas[Math.min(at, maxIndex)];
  const state = useMemo(() => foldTo(deltas, delta?.i ?? 0), [deltas, delta]);
  // The frame BEFORE this one. Two folds per frame is cheap (each is a few hundred small steps) and
  // it is what makes "what just happened" exact rather than inferred from the op list.
  const before = useMemo(() => foldTo(deltas, (deltas[at - 1]?.i ?? -1)), [deltas, at]);
  const change = useMemo(() => diffBrains(before, state), [before, state]);
  const track = useMemo(() => tracks(deltas), [deltas]);
  const unit = units.find((u) => u.i === delta?.i);

  const go = useCallback((n: number) => { setPlaying(false); setAt(Math.max(0, Math.min(maxIndex, n))); }, [maxIndex]);

  useEffect(() => {
    if (!playing) return;
    timer.current = window.setInterval(() => {
      setAt((n) => (n >= maxIndex ? (setPlaying(false), maxIndex) : n + 1));
    }, 1000 / speed);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [playing, speed, maxIndex]);

  // Frame-by-frame from the keyboard — arrows step, shift+arrow jumps ten, space plays, Esc leaves
  // full screen. Stepping is the primary gesture here, so it should not require aiming at a control.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      const jump = e.shiftKey ? 10 : 1;
      if (e.key === "ArrowRight") { e.preventDefault(); go(at + jump); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(at - jump); }
      else if (e.key === "Home") { e.preventDefault(); go(0); }
      else if (e.key === "End") { e.preventDefault(); go(maxIndex); }
      else if (e.key === " ") { e.preventDefault(); setPlaying((p) => !p); }
      else if (e.key === "Escape" && full) setFull(false);
      else if (e.key === "f" && !e.metaKey && !e.ctrlKey) setFull((f) => !f);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [at, maxIndex, go, full]);

  const live = workingSet(state);
  const wants = openQuestions(state);
  const cast = ranked(state).slice(0, 12);
  const groups = useMemo(() => clusters(state), [state]);
  const unread = useMemo(() => deltas.filter((d) => d.failed).length, [deltas]);
  const place = state.place ? state.entities[state.place] : undefined;

  const fresh = {
    met: new Set(change.met.map((e) => e.id)),
    woke: new Set(change.woke.map((w) => w.entity.id)),
    asked: new Set(change.wondered.map((q) => q.qid)),
    place: !!change.moved,
  };

  const body = (
    <section className={full ? "" : "mt-10"}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-semibold">The read, unit by unit</h3>
        {/* Precise about which half is causal. The panels are the reader at unit t; the curves are
            the whole book, which the reader has not read — that is why full screen drops them. */}
        <span className="text-xs" style={{ color: "var(--ink-3)" }}>
          analyst view — the panels are the reader’s model after unit {delta?.i ?? 0}; the curves span the
          whole chapter, including what they haven’t reached. Press <kbd>f</kbd> for the reader’s own snapshot.
        </span>
      </div>

      {unread > 0 && (
        // Stated up front, not buried: with a gap in the trace, the tail of every curve is an
        // artefact of the sweep rather than a property of the book.
        <p className="mb-3 rounded-md border px-3 py-2 text-xs" style={{ borderColor: "var(--kind-mixed)", color: "var(--kind-mixed)" }}>
          {unread} of {deltas.length} units were never read — their windows failed during the sweep.
          They fold as no-ops, so the curves past unit {deltas.find((d) => d.failed)?.i} decay toward zero
          because nothing is arriving, not because the reader lost interest. Re-run to fill the gap.
        </p>
      )}

      {/* ── transport ───────────────────────────────────────────────────────────────────────── */}
      <Transport
        at={at} maxIndex={maxIndex} playing={playing} speed={speed} full={full}
        onGo={go} onPlay={() => setPlaying((p) => !p)} onSpeed={setSpeed} onFull={() => setFull((f) => !f)}
        unread={!!delta?.failed}
      />

      {/* ── tracks ──────────────────────────────────────────────────────────────────────────── */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <TrackChart title="Pull" note="unresolved want, decayed by age — the reason to keep reading" data={track} k="pull" at={delta?.i ?? 0} />
        <TrackChart title="Tension" note="how it feels, 0–10" data={track} k="tension" at={delta?.i ?? 0} />
        <TrackChart title="Immersion" note="sensory vividness of the current scene" data={track} k="immersion" at={delta?.i ?? 0} />
        <TrackChart title="In mind" note="entities still active vs. total known" data={track} k="live" k2="known" at={delta?.i ?? 0} />
      </div>

      {/* ── the moment ──────────────────────────────────────────────────────────────────────── */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <div className="space-y-4">
          <Panel title="What you just read" hint={`unit ${delta?.i ?? 0}`}>
            {unit?.text
              ? <p className="text-sm leading-relaxed" style={{ color: "var(--ink-1)" }}>{unit.text}</p>
              : <p className="text-xs italic" style={{ color: "var(--ink-3)" }}>text not shipped with the pre-filled run</p>}
            {delta?.gist && (
              <p className="mt-3 border-l-2 pl-3 text-sm" style={{ borderColor: "var(--series-1)", color: "var(--ink-2)" }}>
                {delta.gist}
              </p>
            )}
          </Panel>

          <Panel title="What just happened" hint={delta?.failed ? "unread" : `unit ${delta?.i ?? 0}`}
                 changed={!diffIsEmpty(change)}>
            <WhatJustHappened diff={change} empty={diffIsEmpty(change)} unread={!!delta?.failed} />
            {/* The raw ops behind the reading, folded away. The diff above is what LANDED; this is
                what the prose asserted — they differ, and when a reading looks wrong this is where
                you find out whether the model or the fold is at fault. */}
            {(delta?.ops.length ?? 0) > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs" style={{ color: "var(--ink-3)" }}>
                  {delta.ops.length} raw ops
                </summary>
                <ul className="mt-1.5 space-y-1">{delta.ops.map((op, i) => <OpRow key={i} op={op} state={state} />)}</ul>
              </details>
            )}
          </Panel>

          <Panel title="What you want to know" hint={`${wants.length} open`}
                 changed={change.wondered.length > 0 || change.resolved.length > 0}>
            {wants.length ? (
              <ul className="space-y-1.5">
                {wants.map((q) => (
                  <li key={q.qid} className="flex gap-2 text-sm">
                    <span className="mt-0.5 shrink-0 rounded px-1 text-[10px] uppercase tracking-wide"
                          style={{ background: "var(--chip)", color: "var(--ink-3)" }}>{q.kind}</span>
                    <span style={{ color: "var(--ink-1)" }}>{fresh.asked.has(q.qid) ? <Fresh>{q.text}</Fresh> : q.text}</span>
                    <span className="ml-auto shrink-0 text-xs tabular-nums" style={{ color: "var(--ink-3)" }}>
                      {"●".repeat(q.heat)}<span style={{ opacity: 0.25 }}>{"●".repeat(3 - q.heat)}</span>
                      <span className="ml-1.5">+{(delta?.i ?? 0) - q.openedAt}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs italic" style={{ color: "var(--ink-3)" }}>nothing pulling — a dead stretch</p>}
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Where you are" hint={place ? KIND_LABEL[place.kind] : "—"} changed={fresh.place || change.entered.length > 0}>
            <p className="text-sm font-medium">{fresh.place ? <Fresh>{place?.name ?? "not established"}</Fresh> : (place?.name ?? "not established")}</p>
            {place && (
              <>
                <SenseStrip entity={place} />
                <p className="mt-2 text-xs" style={{ color: "var(--ink-3)" }}>
                  immersion {immersion(place).toFixed(1)} · {new Set(place.senses.map((s) => s.channel)).size} senses engaged
                </p>
              </>
            )}
            {state.present.length > 0 && (
              <p className="mt-3 text-xs" style={{ color: "var(--ink-2)" }}>
                <span style={{ color: "var(--ink-3)" }}>on stage: </span>
                {state.present.map((id) => state.entities[id]?.name ?? id).join(", ")}
              </p>
            )}
          </Panel>

          <Panel title="In mind right now" hint={`${live.length} live of ${Object.keys(state.entities).length}`}
                 changed={change.woke.length > 0 || change.met.length > 0 || change.faded.length > 0}>
            {/* ACTIVATED MEMORY. Bars are activation, which decays every unit — this is the panel
                that shows the reader forgetting, which no static cast list can show. */}
            {live.length ? (
              <ul className="space-y-1">
                {live.slice(0, 10).map((e) => (
                  <li key={e.id} className="flex items-center gap-2 text-xs">
                    <span className="w-28 shrink-0 truncate" style={{ color: "var(--ink-1)" }}>
                      {fresh.met.has(e.id) || fresh.woke.has(e.id) ? <Fresh>{e.name}</Fresh> : e.name}
                    </span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: "var(--chip)" }}>
                      <span className="block h-full rounded-full"
                            style={{ width: `${Math.min(100, (e.activation / 3) * 100)}%`, background: `var(--kind-${e.kind})` }} />
                    </span>
                    <span className="w-8 shrink-0 text-right tabular-nums" style={{ color: "var(--ink-3)" }}>{e.activation.toFixed(1)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs italic" style={{ color: "var(--ink-3)" }}>nothing yet</p>}
          </Panel>

          <Panel title="How it all connects" hint="click a node">
            <RelationGraph state={state} onPick={(id) => setSelected((s) => (s === id ? null : id))} selected={selected} />
            {selected && state.entities[selected] && <EntityCard entity={state.entities[selected]} state={state} />}
          </Panel>

          <Panel title="What clumps together" hint={`${groups.length} groups`}>
            {/* Grouping is DERIVED — connected components of the relation graph — so a group appears
                the moment the prose ties two things together, and never before. */}
            {groups.length ? (
              <ul className="space-y-2">
                {groups.slice(0, 5).map((g) => (
                  <li key={g.label} className="text-xs">
                    <span className="font-medium" style={{ color: "var(--ink-1)" }}>{g.label}</span>
                    <span style={{ color: "var(--ink-3)" }}> · {g.members.length}</span>
                    <p className="mt-0.5" style={{ color: "var(--ink-2)" }}>
                      {g.members.map((m) => m.name).join(" · ")}
                    </p>
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs italic" style={{ color: "var(--ink-3)" }}>nothing tied together yet</p>}
          </Panel>

          <Panel title="Who matters" hint="mentions + reach + recalls">
            {/* IMPORTANCE is retrospective by construction: it counts how often the story came BACK,
                never how the introducing sentence sounded. So it only becomes true as you scrub. */}
            <ul className="space-y-1">
              {cast.map(({ entity, score }) => (
                <li key={entity.id} className="flex items-baseline gap-2 text-xs">
                  <span className="inline-block h-2 w-2 shrink-0 rounded-sm" style={{ background: `var(--kind-${entity.kind})` }} />
                  <button type="button" className="truncate text-left hover:underline" style={{ color: "var(--ink-1)" }}
                          onClick={() => setSelected(entity.id)}>{entity.name}</button>
                  <span style={{ color: "var(--ink-3)" }}>{KIND_LABEL[entity.kind]}</span>
                  <span className="ml-auto shrink-0 tabular-nums" style={{ color: "var(--ink-3)" }}>{score.toFixed(0)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </section>
  );

  if (!full) return body;

  // FULL SCREEN IS A DIFFERENT VIEWER, not a bigger version of the same one.
  //
  // The body above is the ANALYST's view: someone studying a finished book, for whom whole-book
  // curves are the point. Full screen is the READER's view, and a reader at unit 2 does not know
  // the tension rises at unit 34 — so nothing here may be drawn from units they have not reached.
  // Showing them the shape of the book they have not read is the same causality violation as
  // letting the model read ahead, just committed one layer higher up.
  //
  // A plain fixed overlay rather than the Fullscreen API: keeps the theme tokens and the keyboard
  // handler, and Esc already exits.
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto p-5" style={{ background: "var(--surface-1)" }}>
      <div className="mx-auto max-w-[1500px]">
        <Transport
          at={at} maxIndex={maxIndex} playing={playing} speed={speed} full
          onGo={go} onPlay={() => setPlaying((p) => !p)} onSpeed={setSpeed} onFull={() => setFull(false)}
          unread={!!delta?.failed}
        />
        {unread > 0 && (
          <p className="mt-3 rounded-md border px-3 py-2 text-xs" style={{ borderColor: "var(--kind-mixed)", color: "var(--kind-mixed)" }}>
            {unread} of {deltas.length} units were never read — their windows failed during the sweep.
          </p>
        )}
        <div className="mt-4">
          <ReaderSnapshot
            units={units} deltas={deltas} at={at} state={state} change={change}
            selected={selected} onSelect={setSelected}
          />
        </div>
      </div>
    </div>
  );
}

// ── pieces ───────────────────────────────────────────────────────────────────────────────────────
function Transport({ at, maxIndex, playing, speed, full, unread, onGo, onPlay, onSpeed, onFull }: {
  at: number; maxIndex: number; playing: boolean; speed: number; full: boolean; unread: boolean;
  onGo: (n: number) => void; onPlay: () => void; onSpeed: (n: number) => void; onFull: () => void;
}) {
  const btn = "shrink-0 rounded border px-2 py-1 text-xs disabled:opacity-40";
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: "var(--grid)" }}>
      <button type="button" onClick={() => onGo(at - 1)} disabled={at === 0} className={btn}
              style={{ borderColor: "var(--grid)", color: "var(--ink-2)" }} aria-label="Previous unit" title="← (shift for ×10)">‹ prev</button>
      <button type="button" onClick={onPlay} className="w-16 shrink-0 rounded px-2 py-1 text-xs font-medium text-white"
              style={{ background: "var(--series-1)" }}>{playing ? "❚❚ pause" : "▶ play"}</button>
      <button type="button" onClick={() => onGo(at + 1)} disabled={at === maxIndex} className={btn}
              style={{ borderColor: "var(--grid)", color: "var(--ink-2)" }} aria-label="Next unit" title="→ (shift for ×10)">next ›</button>

      <input
        type="range" min={0} max={maxIndex} value={at}
        onChange={(e) => onGo(Number(e.target.value))}
        className="min-w-[140px] flex-1 accent-[color:var(--series-1)]"
        aria-label="Reading position"
      />

      <span className="w-24 shrink-0 text-right text-xs tabular-nums"
            style={{ color: unread ? "var(--kind-mixed)" : "var(--ink-3)" }}>
        {at + 1} / {maxIndex + 1}{unread ? " ·unread" : ""}
      </span>
      <select value={speed} onChange={(e) => onSpeed(Number(e.target.value))}
              className="shrink-0 rounded border bg-transparent px-1.5 py-1 text-xs"
              style={{ borderColor: "var(--grid)", color: "var(--ink-2)" }} aria-label="Playback speed">
        {[2, 4, 6, 12, 24].map((s) => <option key={s} value={s}>{s}×</option>)}
      </select>
      <button type="button" onClick={onFull} className={btn}
              style={{ borderColor: "var(--grid)", color: "var(--ink-2)" }} title="f">
        {full ? "exit reader view" : "reader view"}
      </button>
    </div>
  );
}

function Panel({ title, hint, changed, children }: {
  title: string; hint?: string; changed?: boolean; children: React.ReactNode;
}) {
  return (
    // A changed panel gets a coloured left edge — the cheapest possible "look here" that survives
    // playback at 24×, where anything requiring reading is already gone before you notice it.
    <div className="rounded-lg border p-4" style={{ borderColor: "var(--grid)", borderLeftWidth: changed ? 3 : 1, borderLeftColor: changed ? "var(--series-1)" : "var(--grid)" }}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ink-2)" }}>{title}</h4>
        {hint && <span className="text-xs tabular-nums" style={{ color: "var(--ink-3)" }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/** Marks an item that changed on THIS frame. */
const Fresh = ({ children }: { children: React.ReactNode }) => (
  <span className="rounded px-1" style={{ background: "color-mix(in oklab, var(--series-1) 16%, transparent)" }}>{children}</span>
);

function SenseStrip({ entity }: { entity: Entity }) {
  const recent = entity.senses.slice(-4);
  if (!recent.length) return null;
  return (
    <ul className="mt-2 space-y-0.5">
      {recent.map((s, i) => (
        <li key={i} className="text-xs" style={{ color: "var(--ink-2)" }}>
          <span className="mr-1.5 rounded px-1 text-[10px] uppercase" style={{ background: "var(--chip)", color: "var(--ink-3)" }}>{s.channel}</span>
          {s.detail}
        </li>
      ))}
    </ul>
  );
}

function EntityCard({ entity, state }: { entity: Entity; state: BrainState }) {
  const edges = state.relations.filter((r) => r.from === entity.id || r.to === entity.id);
  return (
    <div className="mt-3 rounded border p-3" style={{ borderColor: "var(--grid)" }}>
      <p className="text-sm font-medium">{entity.name} <span className="text-xs font-normal" style={{ color: "var(--ink-3)" }}>{KIND_LABEL[entity.kind]}</span></p>
      <p className="mt-0.5 text-xs" style={{ color: "var(--ink-3)" }}>
        first met at unit {entity.firstSeen} · {entity.mentions} mentions · importance {importance(state, entity.id).toFixed(0)}
        {entity.recalls.length > 0 && ` · recalled ${entity.recalls.length}×`}
      </p>
      {entity.beliefs.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {entity.beliefs.slice(-4).map((b, i) => (
            <li key={i} className="text-xs" style={{ color: "var(--ink-2)" }}>
              <span className="mr-1.5 rounded px-1 text-[10px] uppercase" style={{ background: "var(--chip)", color: "var(--ink-3)" }}>{b.ground}</span>
              {b.claim}
            </li>
          ))}
        </ul>
      )}
      {edges.length > 0 && (
        <p className="mt-2 text-xs" style={{ color: "var(--ink-2)" }}>
          {edges.map((r, i) => (
            <span key={i}>
              {i > 0 && " · "}
              {r.from === entity.id ? "" : `${state.entities[r.from]?.name ?? r.from} `}
              <span style={{ color: r.valence < 0 ? "var(--pole-cold)" : r.valence > 0 ? "var(--pole-warm)" : "var(--ink-3)" }}>{r.kind}</span>
              {r.from === entity.id ? ` ${state.entities[r.to]?.name ?? r.to}` : ""}
            </span>
          ))}
        </p>
      )}
      <SenseStrip entity={entity} />
    </div>
  );
}

function OpRow({ op, state }: { op: Op; state: BrainState }) {
  const nameOf = (id: string) => state.entities[id]?.name ?? id;
  const label: Record<Op["op"], string> = {
    entity: "meets", fact: "learns", believe: "reads", relate: "ties", move: "goes",
    present: "sees", sense: "feels", open: "wonders", answer: "resolves", touch: "notices",
    recall: "remembers", affect: "feels",
  };
  let body = "";
  switch (op.op) {
    case "entity": body = `${op.name} (${KIND_LABEL[op.kind]})`; break;
    case "fact": body = `${op.key.replace(/_/g, " ")} — ${op.value}`; break;
    case "believe": body = `${nameOf(op.about)}: ${op.claim} (${op.ground})`; break;
    case "relate": body = `${nameOf(op.from)} → ${nameOf(op.to)}: ${op.kind}`; break;
    case "move": body = nameOf(op.to); break;
    case "present": body = op.ids.map(nameOf).join(", ") || "nobody"; break;
    case "sense": body = `${nameOf(op.about)} — ${op.channel}: ${op.detail}`; break;
    case "open": body = op.text; break;
    case "answer": body = `${op.qid}${op.subverted ? " (subverted)" : ""}${op.note ? ` — ${op.note}` : ""}`; break;
    case "touch": body = op.ids.map(nameOf).join(", "); break;
    case "recall": body = nameOf(op.id); break;
    case "affect": body = `tension ${op.tension}, warmth ${op.warmth}`; break;
  }
  return (
    <li className="flex gap-2 text-xs">
      <span className="w-16 shrink-0 font-medium" style={{ color: "var(--ink-3)" }}>{label[op.op]}</span>
      <span style={{ color: "var(--ink-1)" }}>{body}</span>
    </li>
  );
}

function TrackChart({ title, note, data, k, k2, at }: {
  title: string; note: string; data: Track[]; k: keyof Track; k2?: keyof Track; at: number;
}) {
  return (
    <figure className="rounded-lg border p-3" style={{ borderColor: "var(--grid)" }}>
      <figcaption className="mb-1 px-1">
        <span className="text-xs font-medium">{title}</span>
        <span className="ml-2 text-xs" style={{ color: "var(--ink-3)" }}>{note}</span>
      </figcaption>
      <div style={{ height: 92 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 6, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`t-${k}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--grid)" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="i" tick={{ fill: "var(--ink-3)", fontSize: 9 }} tickLine={false} axisLine={{ stroke: "var(--grid)" }} minTickGap={40} />
            <YAxis width={30} tick={{ fill: "var(--ink-3)", fontSize: 9 }} tickLine={false} axisLine={false} />
            <Tooltip
              cursor={{ stroke: "var(--ink-3)", strokeDasharray: "3 3" }}
              contentStyle={{ background: "var(--surface-1)", border: "1px solid var(--grid)", borderRadius: 6, fontSize: 12, color: "var(--ink-1)" }}
              labelFormatter={(i) => `unit ${i}`}
            />
            {/* The playhead — the one thing tying the curves to the panels below. */}
            <ReferenceLine x={at} stroke="var(--ink-1)" strokeWidth={1.5} />
            {k2 && <Area type="monotone" dataKey={k2} stroke="var(--edge-neutral)" strokeWidth={1.5} fill="none" dot={false} isAnimationActive={false} />}
            <Area type="monotone" dataKey={k} stroke="var(--series-1)" strokeWidth={2} fill={`url(#t-${k})`} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
