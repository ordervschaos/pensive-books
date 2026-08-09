// ReaderSnapshot — the full-screen view. The page IS the mind: depth runs top to bottom.
//
// ── Two rules this component exists to enforce ───────────────────────────────────────────────────
//
// 1. NOTHING FROM THE FUTURE. The data layer is strictly causal — `foldTo(t)` cannot contain a unit
//    the reader has not reached — and it is easy to leak the future back in through presentation.
//    The first version of this screen did exactly that: it sat at unit 2 under four whole-book
//    curves. A reader at unit 2 has no idea the tension rises at unit 34. Showing them the shape of
//    a book they have not read is the same violation as letting the model read ahead, committed one
//    layer up. So: no series over the whole book, no aggregate needing the ending. Whole-book curves
//    live in the analyst view, which is a different viewer entirely.
//
// 2. DEPTH, NOT CATEGORY. Sections are ordered by how present a thing is, not by what type it is —
//    a person, a place, a fact and an unanswered question can all be equally on top of mind, and the
//    same item sinks as the story moves on. Grouping by kind would be a filing cabinet; grouping by
//    depth is a mind. Scrubbing makes the movement visible: things introduced hot sit at the top and
//    visibly sink over the following units, which is what forgetting looks like from the inside.
import { useMemo } from "react";
import {
  clusters, diffIsEmpty, immersion, itemKey, mindLayers, openQuestions, ranked,
  type BrainDiff, type BrainState, type Entity, type MindItem, type UnitDelta,
} from "../lib/brain";
import { type ReaderUnit } from "../lib/readerMachine";
import { RelationGraph } from "./RelationGraph";
import { WhatJustHappened } from "./WhatJustHappened";

const KIND_LABEL: Record<Entity["kind"], string> = {
  character: "person", place: "place", object: "thing", faction: "faction", concept: "idea",
};

export function ReaderSnapshot({ units, deltas, at, state, change, selected, onSelect }: {
  units: ReaderUnit[];
  deltas: UnitDelta[];
  at: number;
  state: BrainState;
  change: BrainDiff;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const delta = deltas[at];
  const unit = units.find((u) => u.i === delta?.i);
  const layers = useMemo(() => mindLayers(state), [state]);
  const place = state.place ? state.entities[state.place] : undefined;
  const groups = useMemo(() => clusters(state), [state]);
  const people = useMemo(() => ranked(state).filter((r) => r.entity.kind === "character").length, [state]);
  const trail = useMemo(
    () => deltas.slice(0, at + 1).filter((d) => d.gist).slice(-8).reverse(),
    [deltas, at],
  );

  // Marks whatever moved on THIS frame, so the sinking is legible while scrubbing.
  const fresh = new Set<string>([
    ...change.met.map((e) => `e:${e.id}`),
    ...change.woke.map((w) => `e:${w.entity.id}`),
    ...change.recalled.map((e) => `e:${e.id}`),
    ...change.wondered.map((q) => `q:${q.qid}`),
    ...change.learned.map((f) => `f:${f.key}`),
    ...change.revised.map((f) => `f:${f.key}`),
  ]);

  return (
    <div className="mx-auto max-w-[1200px] pb-10">
      {/* ── THE MOMENT — the input, above everything it changes ──────────────────────────────── */}
      <Band label="On the page" sub={`unit ${delta?.i ?? 0} · ${Math.round(((at + 1) / deltas.length) * 100)}% through`} tone={1}>
        <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <div>
            {unit?.text
              ? <p className="text-[15px] leading-relaxed" style={{ color: "var(--ink-1)" }}>{unit.text}</p>
              : <p className="text-xs italic" style={{ color: "var(--ink-3)" }}>text not shipped with the pre-filled run</p>}
            {delta?.gist && (
              <p className="mt-3 border-l-2 pl-3 text-sm" style={{ borderColor: "var(--series-1)", color: "var(--ink-2)" }}>
                {delta.gist}
              </p>
            )}
          </div>
          <div>
            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ink-3)" }}>
              what it did to you
            </h4>
            <WhatJustHappened diff={change} empty={diffIsEmpty(change)} unread={!!delta?.failed} />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t pt-3" style={{ borderColor: "var(--grid)" }}>
          <span className="text-xs" style={{ color: "var(--ink-2)" }}>
            <span style={{ color: "var(--ink-3)" }}>you are at </span>
            <span className="font-medium">{place?.name ?? "nowhere established"}</span>
            {place && place.senses.length > 0 && (
              <span style={{ color: "var(--ink-3)" }}> · {new Set(place.senses.map((s) => s.channel)).size} senses · immersion {immersion(place).toFixed(1)}</span>
            )}
          </span>
          {state.present.length > 0 && (
            <span className="text-xs" style={{ color: "var(--ink-2)" }}>
              <span style={{ color: "var(--ink-3)" }}>in front of you </span>
              {state.present.map((id) => state.entities[id]?.name ?? id).join(", ")}
            </span>
          )}
          {/* A value, never a curve: a reader feels how tense it is NOW; they do not perceive the
              tension graph of a book they have not finished. */}
          <Meter label="tension" value={state.affect.tension} max={10} tone="var(--rel-hostile)" />
          <Meter label="warmth" value={state.affect.warmth + 5} max={10} display={state.affect.warmth} tone="var(--series-1)" />
        </div>
      </Band>

      {/* ── ON TOP OF MIND ───────────────────────────────────────────────────────────────────── */}
      <Band label="On top of mind" sub={`${layers.front.length} things you're thinking with`} tone={1} accent>
        {layers.front.length
          ? <ItemGrid items={layers.front} depth="front" fresh={fresh} state={state} at={delta?.i ?? 0} onSelect={onSelect} />
          : <Empty>nothing has taken hold yet</Empty>}
      </Band>

      {/* ── DRIFTING ─────────────────────────────────────────────────────────────────────────── */}
      <Band label="Drifting" sub={`${layers.middle.length} still within reach`} tone={0.72}>
        {layers.middle.length
          ? <ItemGrid items={layers.middle} depth="middle" fresh={fresh} state={state} at={delta?.i ?? 0} onSelect={onSelect} />
          : <Empty>nothing in the middle distance</Empty>}
        {change.faded.length > 0 && (
          <p className="mt-3 text-xs" style={{ color: "var(--ink-3)" }}>
            just slipped down from the front: {change.faded.map((e) => e.name).join(", ")}
          </p>
        )}
      </Band>

      {/* ── BACK OF MIND ─────────────────────────────────────────────────────────────────────── */}
      <Band label="Back of mind" sub={`${layers.back.length} known, currently quiet`} tone={0.5}>
        {layers.back.length
          ? <ItemChips items={layers.back} fresh={fresh} onSelect={onSelect} />
          : <Empty>nothing has settled yet</Empty>}
      </Band>

      {/* ── THE SUBSTRATE — the shape of everything known, and the trail behind you ───────────── */}
      <Band label="Underneath" sub={`${people} people · ${groups.length} clusters · the story so far`} tone={0.5}>
        <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <RelationGraph state={state} size={320} onPick={(id) => onSelect(selected === id ? null : id)} selected={selected} />
            {selected && state.entities[selected] && <Detail entity={state.entities[selected]} state={state} />}
            {groups.length > 0 && (
              <ul className="mt-3 space-y-1">
                {groups.slice(0, 4).map((g) => (
                  <li key={g.label} className="text-xs">
                    <span className="font-medium" style={{ color: "var(--ink-2)" }}>{g.label}</span>
                    <span style={{ color: "var(--ink-3)" }}> — {g.members.slice(1).map((m) => m.name).join(", ")}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ink-3)" }}>
              what you'd say happened
            </h4>
            {trail.length ? (
              <ol className="space-y-1">
                {trail.map((d) => (
                  <li key={d.i} className="flex gap-3 text-xs">
                    <span className="w-8 shrink-0 text-right tabular-nums" style={{ color: "var(--ink-3)" }}>{d.i}</span>
                    <span style={{ color: d.i === delta?.i ? "var(--ink-1)" : "var(--ink-2)" }}>{d.gist}</span>
                  </li>
                ))}
              </ol>
            ) : <Empty>nothing has happened yet</Empty>}
          </div>
        </div>
      </Band>
    </div>
  );
}

// ── bands ────────────────────────────────────────────────────────────────────────────────────────
/** A stratum of the mind. `tone` dims the whole band — depth is encoded as recession, literally. */
function Band({ label, sub, tone, accent, children }: {
  label: string; sub?: string; tone: number; accent?: boolean; children: React.ReactNode;
}) {
  return (
    <section
      className="mt-3 rounded-lg border p-4"
      style={{
        borderColor: "var(--grid)",
        borderLeftWidth: accent ? 3 : 1,
        borderLeftColor: accent ? "var(--series-1)" : "var(--grid)",
        opacity: tone,
      }}
    >
      <div className="mb-3 flex items-baseline gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ink-2)" }}>{label}</h3>
        {sub && <span className="text-xs" style={{ color: "var(--ink-3)" }}>{sub}</span>}
      </div>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="text-xs italic" style={{ color: "var(--ink-3)" }}>{children}</p>
);

/** Front and middle bands: each item gets room, with detail proportional to how present it is. */
function ItemGrid({ items, depth, fresh, state, at, onSelect }: {
  items: MindItem[]; depth: "front" | "middle"; fresh: Set<string>; state: BrainState; at: number;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {items.slice(0, depth === "front" ? 12 : 15).map((item) => {
        const key = itemKey(item);
        const isNew = fresh.has(key);
        return (
          <li
            key={key}
            className="rounded border px-2.5 py-2"
            style={{
              borderColor: isNew ? "var(--series-1)" : "var(--grid)",
              background: isNew ? "color-mix(in oklab, var(--series-1) 8%, transparent)" : "transparent",
            }}
          >
            <ItemBody item={item} state={state} at={at} detailed={depth === "front"} onSelect={onSelect} />
          </li>
        );
      })}
    </ul>
  );
}

/** Back band: dense chips. You hold these; you are not turning them over. */
function ItemChips({ items, fresh, onSelect }: {
  items: MindItem[]; fresh: Set<string>; onSelect: (id: string) => void;
}) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.slice(0, 60).map((item) => {
        const key = itemKey(item);
        const label = item.type === "entity" ? item.entity.name
          : item.type === "question" ? item.question.text
          : item.fact.key.replace(/_/g, " ");
        return (
          <li key={key}>
            <button
              type="button"
              onClick={() => item.type === "entity" && onSelect(item.entity.id)}
              className="rounded border px-1.5 py-0.5 text-xs"
              style={{
                borderColor: fresh.has(key) ? "var(--series-1)" : "var(--grid)",
                color: "var(--ink-3)",
                cursor: item.type === "entity" ? "pointer" : "default",
              }}
              title={item.type === "fact" ? `${item.fact.key}: ${item.fact.value}` : undefined}
            >
              <Dot item={item} /> {label.length > 34 ? `${label.slice(0, 33)}…` : label}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** A tiny type marker. Type is secondary here — depth is the primary axis — so it stays small. */
function Dot({ item }: { item: MindItem }) {
  const color = item.type === "entity" ? `var(--kind-${item.entity.kind})`
    : item.type === "question" ? "var(--rel-hostile)"
    : "var(--edge-neutral)";
  return <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: color }} />;
}

function ItemBody({ item, state, at, detailed, onSelect }: {
  item: MindItem; state: BrainState; at: number; detailed: boolean; onSelect: (id: string) => void;
}) {
  if (item.type === "entity") {
    const e = item.entity;
    return (
      <>
        <button type="button" onClick={() => onSelect(e.id)} className="text-left text-sm font-medium hover:underline"
                style={{ color: "var(--ink-1)" }}>
          <Dot item={item} />{e.name}
        </button>
        <p className="mt-0.5 text-xs" style={{ color: "var(--ink-3)" }}>
          {KIND_LABEL[e.kind]} · met at {e.firstSeen}
          {e.recalls.length > 0 && ` · brought back ${e.recalls.length}×`}
        </p>
        {detailed && e.beliefs.length > 0 && (
          <p className="mt-1 text-xs" style={{ color: "var(--ink-2)" }}>{e.beliefs[e.beliefs.length - 1].claim}</p>
        )}
        {detailed && e.senses.length > 0 && (
          <p className="mt-1 text-xs" style={{ color: "var(--ink-2)" }}>
            <span style={{ color: "var(--ink-3)" }}>{e.senses[e.senses.length - 1].channel}: </span>
            {e.senses[e.senses.length - 1].detail}
          </p>
        )}
      </>
    );
  }
  if (item.type === "question") {
    const q = item.question;
    return (
      <>
        <p className="text-sm" style={{ color: "var(--ink-1)" }}><Dot item={item} />{q.text}</p>
        <p className="mt-0.5 text-xs" style={{ color: "var(--ink-3)" }}>
          {q.kind} · {"●".repeat(q.heat)}<span style={{ opacity: 0.3 }}>{"●".repeat(3 - q.heat)}</span>
          {" · "}waiting {at - q.openedAt} units
        </p>
      </>
    );
  }
  const f = item.fact;
  return (
    <>
      <p className="text-sm" style={{ color: "var(--ink-1)" }}><Dot item={item} />{f.value}</p>
      <p className="mt-0.5 text-xs" style={{ color: "var(--ink-3)" }}>
        {f.key.replace(/_/g, " ")}
        {f.about && state.entities[f.about] ? ` · about ${state.entities[f.about].name}` : ""}
      </p>
    </>
  );
}

// ── small parts ──────────────────────────────────────────────────────────────────────────────────
function Meter({ label, value, max, display, tone }: {
  label: string; value: number; max: number; display?: number; tone: string;
}) {
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <span style={{ color: "var(--ink-3)" }}>{label}</span>
      <span className="h-1.5 w-16 overflow-hidden rounded-full" style={{ background: "var(--chip)" }}>
        <span className="block h-full rounded-full" style={{ width: `${(value / max) * 100}%`, background: tone }} />
      </span>
      <span className="tabular-nums" style={{ color: "var(--ink-2)" }}>{display ?? value}</span>
    </span>
  );
}

const Tag = ({ children }: { children: React.ReactNode }) => (
  <span className="mr-1 rounded px-1 text-[10px] uppercase tracking-wide"
        style={{ background: "var(--chip)", color: "var(--ink-3)" }}>{children}</span>
);

function Detail({ entity, state }: { entity: Entity; state: BrainState }) {
  const edges = state.relations.filter((r) => r.from === entity.id || r.to === entity.id);
  return (
    <div className="mt-3 rounded border p-3" style={{ borderColor: "var(--grid)" }}>
      <p className="text-sm font-medium">
        {entity.name} <span className="text-xs font-normal" style={{ color: "var(--ink-3)" }}>{KIND_LABEL[entity.kind]}</span>
      </p>
      <p className="mt-0.5 text-xs" style={{ color: "var(--ink-3)" }}>
        met at unit {entity.firstSeen} · come up {entity.mentions}× so far
        {entity.recalls.length > 0 && ` · brought back ${entity.recalls.length}×`}
      </p>
      {entity.beliefs.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {entity.beliefs.slice(-4).map((b, i) => (
            <li key={i} className="text-xs" style={{ color: "var(--ink-2)" }}><Tag>{b.ground}</Tag>{b.claim}</li>
          ))}
        </ul>
      )}
      {edges.length > 0 && (
        <p className="mt-2 text-xs" style={{ color: "var(--ink-2)" }}>
          {edges.map((r, i) => (
            <span key={i}>
              {i > 0 && " · "}
              {r.from === entity.id ? "" : `${state.entities[r.from]?.name ?? r.from} `}
              <span style={{ color: r.valence < 0 ? "var(--rel-hostile)" : r.valence > 0 ? "var(--rel-warm)" : "var(--ink-3)" }}>{r.kind}</span>
              {r.from === entity.id ? ` ${state.entities[r.to]?.name ?? r.to}` : ""}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
