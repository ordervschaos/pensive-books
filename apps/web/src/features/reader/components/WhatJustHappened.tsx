// WhatJustHappened — the frame-to-frame change, in the reader's voice.
//
// Built from `diffBrains(foldTo(t-1), foldTo(t))`, NOT from the unit's op list. The distinction is
// the point: the ops say what the prose asserted, the diff says what actually landed. Re-asserting a
// known fact changes nothing; a bare `touch` can haul something from forgotten back to foreground.
// Only the diff can tell those apart, and "what just happened" means the second one.
import { type BrainDiff, type Entity } from "../lib/brain";

const Row = ({ verb, tone, children }: { verb: string; tone?: "warm" | "cold"; children: React.ReactNode }) => (
  <li className="flex gap-2 text-xs leading-relaxed">
    <span
      className="w-20 shrink-0 text-right font-medium"
      style={{ color: tone === "cold" ? "var(--rel-hostile)" : tone === "warm" ? "var(--series-1)" : "var(--ink-3)" }}
    >
      {verb}
    </span>
    <span style={{ color: "var(--ink-1)" }}>{children}</span>
  </li>
);

const names = (xs: Entity[]) => xs.map((e) => e.name).join(", ");

export function WhatJustHappened({ diff, empty, unread }: { diff: BrainDiff; empty: boolean; unread?: boolean }) {
  if (unread) {
    return (
      <p className="text-xs" style={{ color: "var(--kind-mixed)" }}>
        This unit was never read — its window failed during the sweep. It folds as a no-op so time still
        passes, but nothing here is a reading of the prose.
      </p>
    );
  }
  if (empty) {
    return (
      <p className="text-xs italic" style={{ color: "var(--ink-3)" }}>
        Nothing changed. The reader moves on — this unit carries rhythm, not information.
      </p>
    );
  }
  return (
    <ul className="space-y-1">
      {diff.met.length > 0 && <Row verb="meets" tone="warm">{names(diff.met)}</Row>}
      {diff.moved && <Row verb="goes to">{diff.moved.to?.name ?? "somewhere new"}</Row>}
      {diff.entered.length > 0 && <Row verb="now sees">{names(diff.entered)}</Row>}
      {diff.left.length > 0 && <Row verb="loses sight of">{names(diff.left)}</Row>}
      {diff.recalled.map((e, i) => (
        <Row key={`r${i}`} verb="remembers" tone="warm">{e.name} — pulled back from the cold</Row>
      ))}
      {diff.learned.map((f, i) => (
        <Row key={`l${i}`} verb="learns">{f.key.replace(/_/g, " ")} — {f.value}</Row>
      ))}
      {diff.revised.map((f, i) => (
        <Row key={`v${i}`} verb="revises" tone="cold">
          {f.key.replace(/_/g, " ")}: <s style={{ color: "var(--ink-3)" }}>{f.was}</s> → {f.now}
        </Row>
      ))}
      {diff.believed.map((b, i) => (
        <Row key={`b${i}`} verb="reads">{b.entity.name}: {b.claim} <span style={{ color: "var(--ink-3)" }}>({b.ground})</span></Row>
      ))}
      {diff.sensed.map((s, i) => (
        <Row key={`s${i}`} verb={s.channel}>{s.entity.name} — {s.detail}</Row>
      ))}
      {diff.tied.map((r, i) => (
        <Row key={`t${i}`} verb="ties" tone={r.valence < 0 ? "cold" : r.valence > 0 ? "warm" : undefined}>
          {r.from} → {r.to}: {r.kind}
        </Row>
      ))}
      {diff.grounded.map((g, i) => (
        <Row key={`g${i}`} verb="clicks" tone="warm">
          {g.note}{g.ref ? <span style={{ color: "var(--ink-3)" }}> — {g.ref.replace(/_/g, " ")}</span> : null}
        </Row>
      ))}
      {diff.wondered.map((q, i) => (
        <Row key={`w${i}`} verb="wonders" tone="warm">{q.text} <span style={{ color: "var(--ink-3)" }}>[{q.kind}]</span></Row>
      ))}
      {diff.resolved.map((q, i) => (
        <Row key={`q${i}`} verb="settles">{q.text}{q.subverted ? " — but not the way it looked" : ""}</Row>
      ))}
      {diff.felt && (
        <Row verb="feels" tone={diff.felt.dTension > 0 ? "cold" : "warm"}>
          tension {diff.felt.dTension > 0 ? "↑" : "↓"} to {diff.felt.tension}/10
        </Row>
      )}
      {/* Attention movement is listed last and quietly: it is the texture under the events, not an
          event itself. Fading is shown because forgetting is a change the reader undergoes. */}
      {diff.woke.length > 0 && (
        <Row verb="back in mind">{diff.woke.slice(0, 4).map((w) => w.entity.name).join(", ")}</Row>
      )}
      {diff.faded.length > 0 && (
        <Row verb="slips away">{names(diff.faded.slice(0, 4))}</Row>
      )}
    </ul>
  );
}
