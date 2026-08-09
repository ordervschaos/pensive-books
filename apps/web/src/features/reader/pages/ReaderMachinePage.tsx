// ReaderMachinePage — /reader
//
// The UI for Reader Machine P0 (.doc_1786174825000_reader_model_algorithm.md §10): drop an epub,
// get the units a reader steps through plus the free computed lenses.
//
// RUNS ENTIRELY IN THE BROWSER. The P0 pipeline is pure text processing — no model calls, no upload,
// no Supabase — so the file never leaves the machine and a run costs nothing. That is a property of
// P0 specifically; P1 (the causal forward pass) is the first stage that needs a server and a budget.
//
// The pipeline itself lives in ../lib/readerMachine.ts, which scripts/reader-machine.mts also
// imports — one implementation, no twin to drift.
import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  analyzeChapter, castCurve, readEpub,
  type ChapterAnalysis, type ReaderBook, type ReaderUnit, type UnitKind,
} from "../lib/readerMachine";
import { invokeFn } from "@/lib/localFn";
import { planWindows, runForwardPass, type ForwardProgress, type TraceCall } from "../lib/forwardPass";
import { type UnitDelta } from "../lib/brain";
import { BrainTimeline } from "../components/BrainTimeline";

// ── palette ──────────────────────────────────────────────────────────────────────────────────────
// Validated with the dataviz validator (all-pairs, both modes): categorical slots 1–3 for the three
// real unit kinds, neutral for `fragment` — which is not a fourth identity but the "too short to
// classify" null case, so it correctly reads as absence of hue. Slot 4 was avoided deliberately: it
// puts yellow beside orange, which fails the all-pairs floors. Aqua sits below 3:1 on the light
// surface, so the relief rule applies — every kind is direct-labelled in text, never colour alone.
const VIZ_CSS = `
.viz-root {
  --surface-1: #fcfcfb; --grid: #e7e6e2; --chip: #eeedea;
  --ink-1: #0b0b0b; --ink-2: #52514e; --ink-3: #85837c;
  --series-1: #2a78d6;
  --kind-narration: #2a78d6; --kind-mixed: #eb6834; --kind-dialogue: #1baf7a; --kind-fragment: #a3a29b;
  --kind-character: #2a78d6; --kind-place: #1baf7a;
  --kind-object: #a3a29b; --kind-faction: #a3a29b; --kind-concept: #a3a29b;
  --rel-warm: #2a78d6; --rel-hostile: #e34948; --edge-neutral: #a3a29b;
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) .viz-root {
    --surface-1: #1a1a19; --grid: #33322f; --chip: #2a2a27;
    --ink-1: #ffffff; --ink-2: #c3c2b7; --ink-3: #8e8d84;
    --series-1: #3987e5;
    --kind-narration: #3987e5; --kind-mixed: #d95926; --kind-dialogue: #199e70; --kind-fragment: #6f6e68;
    --kind-character: #3987e5; --kind-place: #199e70;
    --kind-object: #6f6e68; --kind-faction: #6f6e68; --kind-concept: #6f6e68;
    --rel-warm: #3987e5; --rel-hostile: #e66767; --edge-neutral: #6f6e68;
  }
}
:root[data-theme="dark"] .viz-root, .dark .viz-root {
  --surface-1: #1a1a19; --grid: #33322f; --chip: #2a2a27;
  --ink-1: #ffffff; --ink-2: #c3c2b7; --ink-3: #8e8d84;
  --series-1: #3987e5;
  --kind-narration: #3987e5; --kind-mixed: #d95926; --kind-dialogue: #199e70; --kind-fragment: #6f6e68;
  --kind-character: #3987e5; --kind-place: #199e70;
  --kind-object: #6f6e68; --kind-faction: #6f6e68; --kind-concept: #6f6e68;
  --rel-warm: #3987e5; --rel-hostile: #e66767; --edge-neutral: #6f6e68;
}
`;

const KIND_VAR: Record<UnitKind, string> = {
  narration: "var(--kind-narration)",
  mixed: "var(--kind-mixed)",
  dialogue: "var(--kind-dialogue)",
  fragment: "var(--kind-fragment)",
};
const KIND_ORDER: UnitKind[] = ["narration", "mixed", "dialogue", "fragment"];

// ── the analysis shape both sources produce ──────────────────────────────────────────────────────
interface Analysis extends ChapterAnalysis {
  title: string;
  author: string | null;
  chapterCount: number;
}

// The demo fixture carries measurements plus a 160-char excerpt per unit — never the manuscript.
// That is what lets a copyrighted reference book back the pre-filled page without shipping its text.
const DEMO = lazy(() => import("../fixtures/DemoFixture"));

// ── smoothing ────────────────────────────────────────────────────────────────────────────────────
// Per-unit ratios are near-binary (a line of dialogue is 1.0, the narration around it 0.0), so the
// raw series reads as noise. Charts plot a centred rolling mean and say so; the exact per-unit
// values stay available in the table below, which is the un-smoothed view of the same data.
const WINDOW = 9;
function rolling(xs: number[], w = WINDOW): number[] {
  const half = Math.floor(w / 2);
  return xs.map((_, i) => {
    const slice = xs.slice(Math.max(0, i - half), Math.min(xs.length, i + half + 1));
    return slice.reduce((a, c) => a + c, 0) / slice.length;
  });
}

interface Lens {
  key: string;
  title: string;
  note: string;
  pick: (u: ReaderUnit) => number;
  fmt: (n: number) => string;
  /** Cumulative series are already monotone — smoothing them would be a lie. */
  raw?: boolean;
}
const LENSES: Lens[] = [
  { key: "wps", title: "Tempo", note: "words per sentence", pick: (u) => u.wps, fmt: (n) => n.toFixed(1) },
  { key: "words", title: "Unit length", note: "words per paragraph", pick: (u) => u.words, fmt: (n) => `${Math.round(n)}w` },
  { key: "dialogueRatio", title: "Dialogue", note: "share of characters inside quotes", pick: (u) => u.dialogueRatio, fmt: (n) => n.toFixed(2) },
  { key: "pronounRate", title: "Pronoun rate", note: "narrative pronouns per word", pick: (u) => u.pronounRate, fmt: (n) => n.toFixed(3) },
  { key: "questions", title: "Questions", note: "literal “?” — the dumb baseline P1 must beat", pick: (u) => u.questions, fmt: (n) => n.toFixed(1) },
];

// ── page ─────────────────────────────────────────────────────────────────────────────────────────
export default function ReaderMachinePage() {
  const [book, setBook] = useState<ReaderBook | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [demo, setDemo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (file: File) => {
    setBusy(true); setError(null); setDemo(false); setBook(null); setAnalysis(null);
    try {
      const parsed = await readEpub(await file.arrayBuffer());
      if (!parsed.chapters.length) {
        throw new Error("No chapter markers found. This epub needs a different LOCATE rule — see readerMachine.ts §2.");
      }
      setBook(parsed);
      setAnalysis({ ...analyzeChapter(parsed, 0), title: parsed.title, author: parsed.author, chapterCount: parsed.chapters.length });
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }, []);

  const pickChapter = useCallback((i: number) => {
    if (!book) return;
    setAnalysis({ ...analyzeChapter(book, i), title: book.title, author: book.author, chapterCount: book.chapters.length });
  }, [book]);

  return (
    <div className="viz-root min-h-screen" style={{ background: "var(--surface-1)", color: "var(--ink-1)" }}>
      <style>{VIZ_CSS}</style>
      <div className="mx-auto max-w-6xl px-6 py-10">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">Reader Machine</h1>
          <p className="mt-1 max-w-2xl text-sm" style={{ color: "var(--ink-2)" }}>
            P0 — segmenter and computed lenses. An epub becomes the units a reader actually steps
            through, measured with pure-JS lenses that cost nothing. Everything runs in this browser;
            the file is never uploaded.
          </p>
        </header>

        <SourceBar busy={busy} onFile={load} onDemo={() => { setDemo(true); setBook(null); setAnalysis(null); setError(null); }} />

        {error && (
          <p className="mt-6 rounded-md border px-4 py-3 text-sm" style={{ borderColor: "var(--kind-mixed)", color: "var(--kind-mixed)" }}>
            {error}
          </p>
        )}

        {demo && (
          <Suspense fallback={<p className="mt-8 text-sm" style={{ color: "var(--ink-3)" }}>loading the pre-filled run…</p>}>
            <DEMO render={(a: Analysis, d: UnitDelta[]) => <Report analysis={a} deltas={d} />} />
          </Suspense>
        )}

        {analysis && (
          <>
            {book && book.chapters.length > 1 && (
              <ChapterPicker
                labels={book.chapters.map((c) => c.label)}
                active={book.chapters.findIndex((c) => c.at === analysis.chapter.at)}
                onPick={pickChapter}
              />
            )}
            <Report analysis={analysis} />
          </>
        )}
      </div>
    </div>
  );
}

// ── source ───────────────────────────────────────────────────────────────────────────────────────
function SourceBar({ busy, onFile, onDemo }: { busy: boolean; onFile: (f: File) => void; onDemo: () => void }) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
      className="flex flex-wrap items-center gap-4 rounded-lg border border-dashed px-5 py-6 transition-colors"
      style={{ borderColor: over ? "var(--series-1)" : "var(--grid)", background: over ? "color-mix(in oklab, var(--series-1) 6%, transparent)" : "transparent" }}
    >
      <label className="cursor-pointer rounded-md px-3 py-2 text-sm font-medium text-white" style={{ background: "var(--series-1)" }}>
        {busy ? "Reading…" : "Choose an .epub"}
        <input
          type="file" accept=".epub,application/epub+zip" className="sr-only" disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
        />
      </label>
      <span className="text-sm" style={{ color: "var(--ink-3)" }}>or drop one here</span>
      <button type="button" onClick={onDemo} className="ml-auto text-sm underline underline-offset-4" style={{ color: "var(--series-1)" }}>
        Load the pre-filled run →
      </button>
    </div>
  );
}

function ChapterPicker({ labels, active, onPick }: { labels: string[]; active: number; onPick: (i: number) => void }) {
  return (
    <div className="mt-8 flex gap-1.5 overflow-x-auto pb-2">
      {labels.map((label, i) => (
        <button
          key={label + i} type="button" onClick={() => onPick(i)}
          className="shrink-0 rounded-md border px-2.5 py-1 text-xs tabular-nums transition-colors"
          style={{
            borderColor: i === active ? "var(--series-1)" : "var(--grid)",
            background: i === active ? "var(--series-1)" : "transparent",
            color: i === active ? "#fff" : "var(--ink-2)",
          }}
        >
          {label.replace("Chapter ", "")}
        </button>
      ))}
    </div>
  );
}

// ── report ───────────────────────────────────────────────────────────────────────────────────────
function Report({ analysis, deltas }: { analysis: Analysis; deltas?: UnitDelta[] }) {
  const { units, chapter, cast, words, rawFragments, span } = analysis;

  const series = useMemo(() => {
    const cum = castCurve(units);
    const smoothed = Object.fromEntries(LENSES.map((l) => [l.key, l.raw ? units.map(l.pick) : rolling(units.map(l.pick))]));
    return units.map((u, i) => ({
      i,
      cast: cum[i],
      ...Object.fromEntries(LENSES.map((l) => [l.key, smoothed[l.key][i]])),
    }));
  }, [units]);

  const mix = useMemo(
    () => KIND_ORDER.map((k) => ({ kind: k, n: units.filter((u) => u.kind === k).length })).filter((d) => d.n > 0),
    [units],
  );

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">
          {analysis.title}
          {analysis.author && <span className="font-normal" style={{ color: "var(--ink-3)" }}> — {analysis.author}</span>}
        </h2>
        <p className="text-xs tabular-nums" style={{ color: "var(--ink-3)" }}>
          {chapter.label} · blocks {span[0]}–{span[1] - 1} of {analysis.chapterCount} chapters located
        </p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border sm:grid-cols-5" style={{ borderColor: "var(--grid)", background: "var(--grid)" }}>
        <Stat label="units" value={units.length.toLocaleString()} note="paragraphs" />
        <Stat label="words" value={words.toLocaleString()} note="in this chapter" />
        <Stat label="cast" value={String(cast.length)} note="proper nouns" />
        <Stat label="repair" value={`${(rawFragments / Math.max(1, units.length)).toFixed(2)}×`} note={`${rawFragments} raw fragments`} />
        <Stat label="dialogue" value={`${Math.round((units.filter((u) => u.kind !== "narration" && u.kind !== "fragment").length / Math.max(1, units.length)) * 100)}%`} note="of units carry speech" />
      </div>

      {chapter.epigraph.length > 0 && (
        // Reported outside the unit stream on purpose: an epigraph is read before the first line of
        // prose and seeds the world model, but it is not narration and must not enter the curves.
        <figure className="mt-6 border-l-2 pl-4" style={{ borderColor: "var(--series-1)" }}>
          <blockquote className="text-sm italic" style={{ color: "var(--ink-2)" }}>{chapter.epigraph.join(" ")}</blockquote>
          <figcaption className="mt-1 text-xs" style={{ color: "var(--ink-3)" }}>epigraph — excluded from every measurement below</figcaption>
        </figure>
      )}

      <h3 className="mb-1 mt-10 text-sm font-semibold">Computed lenses</h3>
      <p className="mb-4 text-xs" style={{ color: "var(--ink-3)" }}>
        Reading position runs left to right. Ratio lenses are a {WINDOW}-unit centred rolling mean —
        per-unit values are near-binary and read as noise; the exact numbers are in the table below.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <LensChart title="Cast introduced" note="cumulative new proper nouns — reader onboarding load" dataKey="cast" data={series} fmt={(n) => String(Math.round(n))} />
        {LENSES.map((l) => (
          <LensChart key={l.key} title={l.title} note={l.note} dataKey={l.key} data={series} fmt={l.fmt} />
        ))}
      </div>

      <h3 className="mb-3 mt-10 text-sm font-semibold">Unit mix</h3>
      <CompositionBar mix={mix} total={units.length} />

      <h3 className="mb-1 mt-10 text-sm font-semibold">Cast, in order of first appearance</h3>
      <p className="flex flex-wrap gap-1.5 pt-2">
        {cast.map((name, i) => (
          <span key={name} className="rounded border px-1.5 py-0.5 text-xs" style={{ borderColor: "var(--grid)", color: "var(--ink-2)" }}>
            <span className="tabular-nums" style={{ color: "var(--ink-3)" }}>{i + 1}</span> {name}
          </span>
        ))}
      </p>

      {deltas?.length
        ? (
          // The pre-filled run ships its trace, so the timeline is playable without spending anything.
          <div className="mt-12 border-t pt-8" style={{ borderColor: "var(--grid)" }}>
            <h3 className="text-sm font-semibold">The reader’s mind</h3>
            <p className="mt-1 max-w-2xl text-sm" style={{ color: "var(--ink-2)" }}>
              A pre-computed sweep of this chapter — what each unit did to a first-time reader. The pass
              is <em>causal by construction</em>: each call was sent only the units before it plus the
              state folded from them, so it could not read ahead.
            </p>
            <BrainTimeline units={units} deltas={deltas} />
          </div>
        )
        : <ForwardPass units={units} />}

      <h3 className="mb-1 mt-10 text-sm font-semibold">Unit stream</h3>
      {units.some((u) => !u.text) && (
        <p className="mb-3 text-xs" style={{ color: "var(--ink-3)" }}>
          The pre-filled run ships measurements, not the manuscript — text is kept for the opening
          units only. Load the epub yourself to see every unit’s prose; it stays in your browser.
        </p>
      )}
      <UnitTable units={units} />
    </section>
  );
}

// ── P1 — the causal forward pass ─────────────────────────────────────────────────────────────────
// The first stage that costs money, so the cost is stated BEFORE the button rather than after: the
// window plan is pure, so the exact number of model calls is knowable without making any.
function ForwardPass({ units }: { units: ReaderUnit[] }) {
  const [deltas, setDeltas] = useState<UnitDelta[] | null>(null);
  const [progress, setProgress] = useState<ForwardProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ from: number; to: number; error: string }[]>([]);
  const windows = useMemo(() => planWindows(units), [units]);

  const hasText = units.some((u) => u.text);

  // The browser transport for read-trace. The sweep itself lives in forwardPass.ts and is shared
  // with the harness script, which injects a fetch-backed caller instead.
  const call: TraceCall = async (body, signal) => {
    const { data, error } = await invokeFn<{ deltas?: UnitDelta[] }>("read-trace", { body, signal });
    if (error) throw error;
    return data;
  };

  const run = async () => {
    setRunning(true); setError(null); setFailed([]); setDeltas(null); setProgress(null);
    try {
      const res = await runForwardPass(units, call, { onProgress: setProgress, onDeltas: setDeltas });
      setDeltas(res.deltas);
      setFailed(res.failed);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="mt-12 border-t pt-8" style={{ borderColor: "var(--grid)" }}>
      <h3 className="text-sm font-semibold">The reader’s mind</h3>
      <p className="mt-1 max-w-2xl text-sm" style={{ color: "var(--ink-2)" }}>
        Sweep the chapter one window at a time and record what each unit does to a first-time reader.
        The pass is <em>causal by construction</em>: each call is sent only the units before it plus the
        state folded from them, so it cannot read ahead.
      </p>

      {!hasText ? (
        <p className="mt-3 text-xs" style={{ color: "var(--ink-3)" }}>
          The pre-filled run ships measurements, not prose, so there is nothing here to read. Load an
          epub above to run the pass.
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button" onClick={run} disabled={running}
            className="rounded-md px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
            style={{ background: "var(--series-1)" }}
          >
            {running ? "Reading…" : "Run the forward pass"}
          </button>
          <span className="text-xs" style={{ color: "var(--ink-3)" }}>
            {progress
              ? `window ${progress.window}/${progress.windows} · ${progress.unitsDone}/${progress.unitsTotal} units`
              : `${windows.length} model calls · ${units.length} units`}
          </span>
        </div>
      )}

      {error && <p className="mt-3 text-sm" style={{ color: "var(--kind-mixed)" }}>{error}</p>}
      {failed.length > 0 && (
        <p className="mt-3 text-xs" style={{ color: "var(--kind-mixed)" }}>
          {failed.length} window(s) failed and fold as no-ops — units{" "}
          {failed.map((f) => `${f.from}–${f.to}`).join(", ")}. The sweep still advances time across them.
        </p>
      )}

      {deltas && deltas.length > 0 && <BrainTimeline units={units} deltas={deltas} />}
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="px-4 py-3" style={{ background: "var(--surface-1)" }}>
      <p className="text-xs uppercase tracking-wide" style={{ color: "var(--ink-3)" }}>{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs" style={{ color: "var(--ink-3)" }}>{note}</p>
    </div>
  );
}

function LensChart({ title, note, dataKey, data, fmt }: {
  title: string; note: string; dataKey: string; data: Record<string, number>[]; fmt: (n: number) => string;
}) {
  const id = `fill-${dataKey}`;
  return (
    <figure className="rounded-lg border p-3" style={{ borderColor: "var(--grid)" }}>
      <figcaption className="mb-1 px-1">
        <span className="text-sm font-medium">{title}</span>
        <span className="ml-2 text-xs" style={{ color: "var(--ink-3)" }}>{note}</span>
      </figcaption>
      <div style={{ height: 132 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 6, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.28} />
                <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--grid)" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="i" tick={{ fill: "var(--ink-3)", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "var(--grid)" }} minTickGap={40} />
            <YAxis width={38} tick={{ fill: "var(--ink-3)", fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={fmt} />
            <Tooltip
              cursor={{ stroke: "var(--ink-3)", strokeDasharray: "3 3" }}
              contentStyle={{ background: "var(--surface-1)", border: "1px solid var(--grid)", borderRadius: 6, fontSize: 12, color: "var(--ink-1)" }}
              labelFormatter={(i) => `unit ${i}`}
              formatter={(v: number) => [fmt(v), title]}
            />
            <Area type="monotone" dataKey={dataKey} stroke="var(--series-1)" strokeWidth={2} fill={`url(#${id})`} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

function CompositionBar({ mix, total }: { mix: { kind: UnitKind; n: number }[]; total: number }) {
  return (
    <>
      {/* 2px surface gaps between segments, and every segment direct-labelled — identity is never
          carried by colour alone (the aqua slot sits below 3:1 on the light surface). */}
      <div className="flex h-6 w-full overflow-hidden rounded" style={{ gap: 2 }}>
        {mix.map(({ kind, n }) => (
          <div key={kind} style={{ width: `${(n / total) * 100}%`, background: KIND_VAR[kind] }} title={`${kind} — ${n}`} />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
        {mix.map(({ kind, n }) => (
          <li key={kind} className="flex items-center gap-1.5 text-xs" style={{ color: "var(--ink-2)" }}>
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: KIND_VAR[kind] }} />
            {kind} <span className="tabular-nums" style={{ color: "var(--ink-3)" }}>{n} · {Math.round((n / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function UnitTable({ units }: { units: ReaderUnit[] }) {
  const [limit, setLimit] = useState(60);
  return (
    <>
      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--grid)" }}>
        <table className="w-full text-left text-xs">
          <thead style={{ color: "var(--ink-3)" }}>
            <tr className="border-b" style={{ borderColor: "var(--grid)" }}>
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">kind</th>
              <th className="px-3 py-2 text-right font-medium">words</th>
              <th className="px-3 py-2 text-right font-medium">w/sent</th>
              <th className="px-3 py-2 text-right font-medium">dialogue</th>
              <th className="px-3 py-2 font-medium">new names</th>
              <th className="px-3 py-2 font-medium">text</th>
            </tr>
          </thead>
          <tbody>
            {units.slice(0, limit).map((u) => (
              <tr key={u.i} className="border-b align-top last:border-0" style={{ borderColor: "var(--grid)" }}>
                <td className="px-3 py-2 tabular-nums" style={{ color: "var(--ink-3)" }}>{u.i}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  <span className="mr-1.5 inline-block h-2 w-2 rounded-sm align-middle" style={{ background: KIND_VAR[u.kind] }} />
                  <span style={{ color: "var(--ink-2)" }}>{u.kind}</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums" style={{ color: "var(--ink-2)" }}>{u.words}</td>
                <td className="px-3 py-2 text-right tabular-nums" style={{ color: "var(--ink-2)" }}>{u.wps}</td>
                <td className="px-3 py-2 text-right tabular-nums" style={{ color: "var(--ink-2)" }}>{u.dialogueRatio.toFixed(2)}</td>
                <td className="px-3 py-2" style={{ color: "var(--ink-3)" }}>{u.newProperNouns.join(", ")}</td>
                <td className="px-3 py-2" style={{ color: u.text ? "var(--ink-1)" : "var(--ink-3)" }}>
                  {u.text ? `${u.text.slice(0, 220)}${u.text.length > 220 ? "…" : ""}` : "— text not shipped —"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {limit < units.length && (
        <button type="button" onClick={() => setLimit((n) => n + 200)} className="mt-3 text-sm underline underline-offset-4" style={{ color: "var(--series-1)" }}>
          Show more ({units.length - limit} left)
        </button>
      )}
    </>
  );
}
