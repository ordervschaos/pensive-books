// DnaArchitecturePage — /dna/docs/architecture (admin only)
// A bespoke, book-agnostic "architecture atlas" for the whole DNA build pipeline: the resolution ladder,
// the linters, the ledgers, the verify reads, the driver, and how information flows between them. Pure
// presentation — no book context, no data fetching. The canonical prose/mermaid version is
// docs/dna/architecture.md; this is the richer, browsable representation. Self-contained dark "blueprint"
// theme (scoped under .arch-root) so it doesn't fight Paper-DS.
import { useEffect, useMemo, useRef, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// DATA — every name is code-accurate (novelDna.ts · dnaJourney.ts · dnaSchema.ts · book-agent · read-*).
// ─────────────────────────────────────────────────────────────────────────────

type Rung = {
  n: number; kind: string; level: string; color: string; tag?: string;
  produces: string; createdBy: string; mechanic: string;
};
const RUNGS: Rung[] = [
  { n: 0, kind: "seed", level: "L0", color: "#38bdf8", tag: "singleton · root",
    produces: "logline — protagonist · inciting · goal · obstacle · stakes",
    createdBy: "client bootstrap + dna-expand·logline",
    mechanic: "idea ≠ logline — the first refinement, the one hand-authored origin" },
  { n: 1, kind: "premise", level: "L1", color: "#4fd1c5", tag: "singleton",
    produces: "dramatic_question + internal shape",
    createdBy: "agent · propose_expansion(premise)",
    mechanic: "elaborates the logline; genre/tone stay on the brief (never duplicated down)" },
  { n: 2, kind: "pillar", level: "L2", color: "#a3e635", tag: "singleton · hub",
    produces: "controlling idea · ending — the anchor every entity hangs off",
    createdBy: "agent + node_type_configs",
    mechanic: "hub-and-spoke (PARENT_KIND); pin anything → propagates down as a hard constraint" },
  { n: 3, kind: "act", level: "L3", color: "#fbbf24",
    produces: "goal · turn · value shift",
    createdBy: "one replace_children",
    mechanic: "value polarity per act — the macro pressure curve" },
  { n: 4, kind: "beat", level: "L4", color: "#fb923c",
    produces: "therefore/but · polarity · needs/establishes · grounds_in · realizes · plays/resolves · threads",
    createdBy: "one global beat-sheet pass on the pillar",
    mechanic: "needs↔establishes state keys = a causal DAG; every 'therefore' must be earned upstream" },
  { n: 5, kind: "scene", level: "L5", color: "#f87171",
    produces: "pov · loc · goal→conflict→outcome · value_shift · register · readings",
    createdBy: "per-beat propose_expansion(scenes) · realizeScenesFromBeat",
    mechanic: "projection, not re-invention — needs→first scene, establishes→last" },
];
const PROSE = {
  produces: "scene.content.prose (draft)",
  createdBy: "two-hop — prepare assembles, the browser streams off-worker",
  mechanic: "escapes the ~150s worker ceiling; rolling O(1)/page digest; read-repair fixes the tail",
};

const ENTITIES = [
  "character", "relationship", "tentpole", "world_fact",
  "location", "thread", "game", "meter", "voice_profile",
];

type Stage = { key: string; label: string; kinds: string; produced: string; mechanic: string };
const STAGES: Stage[] = [
  { key: "premise", label: "① Premise", kinds: "seed · premise", produced: "dna-expand·logline · propose_options", mechanic: "idea ≠ logline" },
  { key: "foundations", label: "② Foundations", kinds: "pillar · character · relationship · tentpole · world_fact · game", produced: "agent + node_type_configs", mechanic: "hub-and-spoke; pins propagate" },
  { key: "structure", label: "③ Structure", kinds: "act · beat", produced: "one global beat-sheet pass", mechanic: "needs↔establishes = causal DAG" },
  { key: "scenes", label: "④ Scenes", kinds: "scene", produced: "per-beat propose_expansion", mechanic: "projection, not re-invention" },
  { key: "draft", label: "⑤ Draft", kinds: "scene (prose)", produced: "prepare + off-worker stream", mechanic: "escapes the worker ceiling" },
];

type Tool = { name: string; what: string; kind: "read" | "propose" | "gate" };
const TOOLS: Tool[] = [
  { name: "search_nodes", what: "query the tree", kind: "read" },
  { name: "read_node", what: "fetch one node", kind: "read" },
  { name: "get_schema", what: "the content contract", kind: "read" },
  { name: "check_against_contract", what: "brief-compile / mandate", kind: "read" },
  { name: "propose_options", what: "author-choice fork", kind: "propose" },
  { name: "propose_node_ops", what: "add / edit / move nodes", kind: "propose" },
  { name: "propose_expansion", what: "→ dna-expand a rung", kind: "propose" },
  { name: "propose_prose_render", what: "curated render brief", kind: "propose" },
  { name: "ask_author", what: "parks the run", kind: "gate" },
  { name: "finish", what: "end the turn", kind: "gate" },
];

type Lint = { code: string; family: string; fn: string; sev: "error" | "warn" };
const LINTS: Lint[] = [
  { code: "orphan", family: "Structural", fn: "structuralLints → validate", sev: "error" },
  { code: "misparented", family: "Structural", fn: "structuralLints → validate", sev: "error" },
  { code: "misordered_payoff", family: "Promise / debt", fn: "enforcePromiseSchedule", sev: "error" },
  { code: "unearned_payoff", family: "Promise / debt", fn: "enforcePromiseSchedule", sev: "warn" },
  { code: "uncaused_therefore", family: "Causal (why)", fn: "causality — needs/establishes DAG", sev: "error" },
  { code: "movement_unfit", family: "Vertical fit", fn: "vertical-fit / timeline layer", sev: "warn" },
  { code: "act_value_undelivered", family: "Vertical fit", fn: "vertical-fit / timeline layer", sev: "warn" },
  { code: "beat_polarity_undelivered", family: "Vertical fit", fn: "vertical-fit / timeline layer", sev: "warn" },
  { code: "scene_reading_departs", family: "Vertical fit", fn: "vertical-fit / timeline layer", sev: "warn" },
  { code: "shape_unmapped", family: "Shape read", fn: "buildShapeReadInput · read-shape", sev: "warn" },
  { code: "ending_feel_mismatch", family: "Shape read", fn: "read-shape", sev: "warn" },
  { code: "craft_flag", family: "Shape read", fn: "read-synopsis (shift-left judge)", sev: "warn" },
  { code: "brief_fit_flag", family: "Brief / premise read", fn: "buildBriefFitInput · read-logline", sev: "warn" },
  { code: "logline_fit_flag", family: "Brief / premise read", fn: "buildLoglineFitInput · read-premise", sev: "warn" },
  { code: "dead_arc", family: "Dead-field", fn: "DEAD-FIELD LINTS", sev: "warn" },
  { code: "static_relationship", family: "Dead-field", fn: "DEAD-FIELD LINTS", sev: "warn" },
  { code: "unmarked_travel", family: "Chronology", fn: "CHRONOLOGY LINTS (timeline floor)", sev: "warn" },
  { code: "reader_confusion", family: "Cold read", fn: "confusionRead · read-confusion", sev: "warn" },
  { code: "(prose read layer)", family: "Prose", fn: "proseLints", sev: "warn" },
  { code: "(scene treatment)", family: "Sketch", fn: "SKETCH LINTS", sev: "warn" },
];

type Ledger = { name: string; fns: string; what: string };
const LEDGERS: Ledger[] = [
  { name: "Continuity / fact", fns: "ledgerBefore · ledgerFull · ledgerText · factLedger · read-facts", what: "prefix-sum “story so far” up to a scene" },
  { name: "Entity registry", fns: "entityRegistryBlock", what: "shared keyspace — refs resolve to one id, not two spellings" },
  { name: "Facet exposure", fns: "facetExposureBefore · facetEchoes", what: "progressive disclosure — what the reader knows so far" },
  { name: "Between-scenes (unified)", fns: "ledgerAt", what: "one id-keyed read composing the three above" },
  { name: "Promise / obligation debt", fns: "promiseLedger · obligationLedger · openObligations · debtSettled", what: "book = a ledger of promises; completion = debt settled" },
  { name: "Causality spine", fns: "causality · cascade · stakesOf · blastRadius", what: "the needs/establishes DAG (the “and-then” killer)" },
  { name: "Meters", fns: "meterShape · meterSeries · observedSeries · targetGap · observedGap · traceDiff", what: "plottable axes — planned vs observed" },
  { name: "Decision journal", fns: "agentThread fork steps (⑂)", what: "auto-mode creative choices, journaled with timestamps" },
];

type Read = { fn: string; out: string };
const READS: Read[] = [
  { fn: "read-meters", out: "observed meter trace (dotted line)" },
  { fn: "read-shape", out: "semantic vertical fit → movement_unfit" },
  { fn: "read-synopsis", out: "craft_flag — shift-left quality judge" },
  { fn: "read-confusion", out: "reader_confusion — cold read" },
  { fn: "read-facts", out: "continuity flags / breaks" },
  { fn: "read-logline", out: "brief_fit_flag — does the logline honor the brief?" },
  { fn: "read-premise", out: "logline_fit_flag — does the premise honor the logline as FIXED?" },
];

type Table = { name: string; owner: string; role: string; priv?: boolean };
const TABLES: Table[] = [
  { name: "books", owner: "editor", role: "entry contract: brief · foundations · canon · craft_notes · context_auto" },
  { name: "book_nodes", owner: "DNA", role: "the genotype tree — single source of truth", priv: true },
  { name: "book_agent_runs", owner: "DNA", role: "durable agent run rows (waitUntil / self-chain)", priv: true },
  { name: "book_agent_sessions", owner: "DNA", role: "archived AgentRail threads (off the runs jsonb)", priv: true },
  { name: "book_tree_versions", owner: "DNA", role: "linear save points (snapshot_book_tree RPC)", priv: true },
  { name: "dna_chats", owner: "DNA", role: "chat surface state", priv: true },
  { name: "pages", owner: "reader", role: "exit projection — render target, never agent-edited" },
  { name: "ai_calls", owner: "shared", role: "every LLM call, logged via _shared/llm.ts chokepoint" },
];

type Change = { date: string; title: string; body: string };
const CHANGES: Change[] = [
  { date: "2026-07-11", title: "Brief/premise reads", body: "read-logline (brief_fit_flag) and read-premise (logline_fit_flag) close the gap between the deterministic logline anatomy lints and the shape/synopsis reads; grounded in craft-kb.ts's LOGLINE_CRAFT + PREMISE_JUDGE_CRITERIA (shared with dna-expand's premise self-eval)" },
  { date: "2026-07-06", title: "Verify layer", body: "LintConfig + genre presets · brief-compile · synopsis read (craft_flag) · proseLints · arc threads (dead_arc / static_relationship) · cold read (reader_confusion) · decision journal (⑂) · unmarked_travel" },
  { date: "2026-07-04", title: "Timeline + vertical-fit lints", body: "shape_unmapped · ending_feel_mismatch · beat_polarity_undelivered · scene_reading_departs; shape read = paid semantic ceiling (movement_unfit)" },
  { date: "2026-07-03", title: "Scene ledger unification", body: "three between-scenes reads folded into ledgerAt (id-keyed) + entityRegistryBlock + facet exposure" },
  { date: "2026-07-03", title: "One-studio consolidation", body: "DnaTreePage is the ONE surface (overview · tree · taste); vanilla /dna studio deprecated" },
  { date: "2026-07-02", title: "Tree versions", body: "linear save points + diff-since-last + restore; auto-checkpoint on auto-accept arm" },
];

const SECTIONS = [
  { id: "seam", label: "The Seam" },
  { id: "ladder", label: "The Ladder" },
  { id: "journey", label: "The Journey" },
  { id: "flow", label: "Information Flow" },
  { id: "driver", label: "The Driver" },
  { id: "lints", label: "Linters" },
  { id: "ledgers", label: "Ledgers" },
  { id: "verify", label: "Verify Loop" },
  { id: "provenance", label: "Provenance" },
  { id: "data", label: "Data Model" },
  { id: "deploy", label: "Deploy Split" },
  { id: "changes", label: "Recent" },
];

// ─────────────────────────────────────────────────────────────────────────────
// PRESENTATION
// ─────────────────────────────────────────────────────────────────────────────

function Arrow({ label, down }: { label?: string; down?: boolean }) {
  return (
    <div className={`arch-arrow ${down ? "down" : ""}`}>
      <span className="arch-arrow-line" />
      {label && <span className="arch-arrow-label">{label}</span>}
      <span className="arch-arrow-head">{down ? "▼" : "▸"}</span>
    </div>
  );
}

function SectionTitle({ n, k, title, sub }: { n: string; k: string; title: string; sub: string }) {
  return (
    <header className="arch-sec-head">
      <span className="arch-sec-n">{n}</span>
      <div>
        <div className="arch-sec-kicker">{k}</div>
        <h2 className="arch-sec-title">{title}</h2>
        <p className="arch-sec-sub">{sub}</p>
      </div>
    </header>
  );
}

export default function DnaArchitecturePage() {
  const [active, setActive] = useState("seam");
  const [lintFilter, setLintFilter] = useState<"all" | "error" | "warn">("all");
  const rootRef = useRef<HTMLDivElement>(null);

  // scrollspy — highlight the nav item for the section in view
  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: [0, 0.25, 0.5, 1] },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const lintFamilies = useMemo(() => {
    const shown = LINTS.filter((l) => lintFilter === "all" || l.sev === lintFilter);
    const groups = new Map<string, Lint[]>();
    for (const l of shown) { const g = groups.get(l.family) ?? []; g.push(l); groups.set(l.family, g); }
    return [...groups.entries()];
  }, [lintFilter]);

  const errorCount = LINTS.filter((l) => l.sev === "error").length;

  return (
    <div className="arch-root" ref={rootRef}>
      <style>{CSS}</style>

      {/* ── side rail ─────────────────────────────────────────── */}
      <nav className="arch-rail" aria-label="sections">
        <div className="arch-rail-brand">
          <span className="arch-helix">§</span>
          <span>DNA<em>atlas</em></span>
        </div>
        <ol>
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className={active === s.id ? "on" : ""}>
                <span className="arch-rail-tick" />
                {s.label}
              </a>
            </li>
          ))}
        </ol>
        <a className="arch-rail-src" href="/docs/dna/architecture.md">docs/dna/architecture.md ↗</a>
      </nav>

      <main className="arch-main">
        {/* ── hero ──────────────────────────────────────────────── */}
        <section className="arch-hero">
          <div className="arch-hero-grid" aria-hidden />
          <div className="arch-hero-inner">
            <div className="arch-eyebrow">
              <span className="arch-dot" /> ARCHITECTURE ATLAS · admin · book-agnostic
            </div>
            <h1 className="arch-h1">
              Novel <span className="arch-h1-accent">DNA</span>
              <span className="arch-h1-sub">the whole machine that builds a book</span>
            </h1>
            <p className="arch-lede">
              The book is one self-similar <code>book_nodes</code> tree — the <b>genotype</b>, the source
              of truth. Each rung down is <b>higher resolution, lower authority over causality</b>. The last
              step <b>transcribes</b> the tree into <code>pages</code> — the <b>phenotype</b> the reader sees.
            </p>
            <div className="arch-legend">
              {[["▭", "store / table"], ["( )", "pure engine fn"], ["⬡", "edge fn"], ["▷", "agent tool"], ["→", "data flow"], ["⇢", "derives (no storage)"]].map(([g, l]) => (
                <span key={l} className="arch-legend-item"><b>{g}</b>{l}</span>
              ))}
            </div>
          </div>
        </section>

        {/* ── 1 · the seam ──────────────────────────────────────── */}
        <section id="seam" className="arch-sec">
          <SectionTitle n="01" k="the boundary" title="The Seam — books in, pages out" sub="DNA owns a private model; it couples to the rest of the app through two narrow contracts only." />
          <div className="arch-seam">
            <div className="arch-seam-col">
              <div className="arch-tag">outside DNA</div>
              <div className="arch-node store">▭ books row<span>name · brief · foundations · canon · craft_notes</span></div>
            </div>
            <Arrow label="brief in" />
            <div className="arch-seam-col arch-private">
              <div className="arch-tag accent">DNA — private model</div>
              <div className="arch-node engine">( ) generate · revise · meter · verify</div>
              <div className="arch-node store priv">▭ book_nodes — the genotype tree</div>
              <div className="arch-node engine">( ) novelDnaRender.reconcileDna()</div>
            </div>
            <Arrow label="render out" />
            <div className="arch-seam-col">
              <div className="arch-tag">outside DNA</div>
              <div className="arch-node store">▭ pages<span>the projection the reader reads</span></div>
            </div>
          </div>
          <p className="arch-note">Render &amp; publish are <b>deliberate author gestures</b> — the agent cannot cross the seam.</p>
        </section>

        {/* ── 2 · the ladder ────────────────────────────────────── */}
        <section id="ladder" className="arch-sec">
          <SectionTitle n="02" k="the genotype" title="The Ladder — one self-similar tree" sub="LADDER_KINDS is a typed, ordered sequence. Entity kinds hang off the pillar (PARENT_KIND). Rungs colored on a cool→warm resolution ramp." />
          <div className="arch-ladder">
            <div className="arch-spine" aria-hidden />
            {RUNGS.map((r) => (
              <div className="arch-rung" key={r.kind} style={{ ["--rc" as string]: r.color }}>
                <div className="arch-rung-node"><span>{r.n}</span></div>
                <div className="arch-rung-card">
                  <div className="arch-rung-top">
                    <b className="arch-rung-kind">{r.kind}</b>
                    <span className="arch-rung-lvl">{r.level}</span>
                    {r.tag && <span className="arch-rung-tag">{r.tag}</span>}
                  </div>
                  <div className="arch-rung-row"><i>produces</i>{r.produces}</div>
                  <div className="arch-rung-row"><i>created by</i>{r.createdBy}</div>
                  <div className="arch-rung-row mech"><i>mechanic</i>{r.mechanic}</div>
                  {r.kind === "pillar" && (
                    <div className="arch-entities">
                      <span className="arch-entities-label">hub-and-spoke · ENTITY_KINDS ⇢</span>
                      {ENTITIES.map((e) => <span key={e} className="arch-chip">{e}</span>)}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div className="arch-rung transcribe" style={{ ["--rc" as string]: "#e879f9" }}>
              <div className="arch-rung-node xcribe"><span>✎</span></div>
              <div className="arch-rung-card">
                <div className="arch-rung-top"><b className="arch-rung-kind">prose</b><span className="arch-rung-lvl">draft</span><span className="arch-rung-tag">scene.content.prose</span></div>
                <div className="arch-rung-row"><i>produces</i>{PROSE.produces}</div>
                <div className="arch-rung-row"><i>created by</i>{PROSE.createdBy}</div>
                <div className="arch-rung-row mech"><i>mechanic</i>{PROSE.mechanic}</div>
              </div>
            </div>
          </div>
          <div className="arch-axis"><span>abstract</span><span className="arch-axis-line" /><span>resolution ↑ · causal authority ↓</span><span className="arch-axis-line" /><span>concrete</span></div>
        </section>

        {/* ── 3 · the journey ───────────────────────────────────── */}
        <section id="journey" className="arch-sec">
          <SectionTitle n="03" k="the driver walks it down" title="The Journey — five gated stages" sub="dnaJourney.ts. Each stage is locked until the prior completes; currentObjective derives the one next rung live and injects it as an anchor, not a fence." />
          <div className="arch-steps">
            {STAGES.map((s, i) => (
              <div className="arch-step" key={s.key}>
                <div className="arch-step-head"><b>{s.label}</b>{i < STAGES.length - 1 && <span className="arch-step-arrow">→</span>}</div>
                <code className="arch-step-kinds">{s.kinds}</code>
                <div className="arch-step-by">{s.produced}</div>
                <div className="arch-step-mech">{s.mechanic}</div>
              </div>
            ))}
            <div className="arch-step gate"><div className="arch-step-head"><b>⎋ render</b></div><code className="arch-step-kinds">author gesture</code><div className="arch-step-by">→ pages</div></div>
          </div>
          <div className="arch-formula">
            <div><span className="arch-formula-k">dnaHealth.completeness</span> = 0.5·(stagesDone / 5) + 0.5·contentFill</div>
            <div><span className="arch-formula-k">dnaHealth.strength</span> = 1 − (errors + 0.4·warns) / max(8, nodes) &nbsp;<em>· errors weigh 2.5× warns</em></div>
          </div>
        </section>

        {/* ── 4 · information flow ──────────────────────────────── */}
        <section id="flow" className="arch-sec">
          <SectionTitle n="04" k="the system" title="Information Flow — web · edge · db" sub="How a build request travels web → edge → db → render. Everything below book_nodes is a pure function of the tree — nothing derived is stored." />
          <div className="arch-lanes">
            <div className="arch-lane">
              <div className="arch-lane-head">WEB · apps/web/src/features/dna</div>
              {["AgentRail — the one agent surface", "DnaTreePage — overview · tree · taste", "useAutoAccept · agentThread.ts", "novelDna.ts (pure engine) · dnaJourney · dnaSchema · novelDnaRender"].map((x) => <div key={x} className="arch-lane-item">{x}</div>)}
            </div>
            <div className="arch-lane-gap">⇄</div>
            <div className="arch-lane">
              <div className="arch-lane-head edge">EDGE · supabase/functions (via _shared: llm · task · access)</div>
              {["⬡ book-agent — the tool loop", "⬡ dna-expand — the generator", "⬡ dna-chat", "⬡ read-meters · read-shape · read-synopsis · read-confusion · read-facts", "⬡ read-logline · read-premise"].map((x) => <div key={x} className="arch-lane-item edge">{x}</div>)}
            </div>
            <div className="arch-lane-gap">⇄</div>
            <div className="arch-lane">
              <div className="arch-lane-head db">POSTGRES</div>
              {["▭ book_nodes", "▭ book_agent_runs", "▭ book_agent_sessions", "▭ book_tree_versions", "▭ ai_calls (llm log)", "▭ pages (exit)"].map((x) => <div key={x} className="arch-lane-item db">{x}</div>)}
            </div>
          </div>
          <p className="arch-note">Deploy split: web engine + UI (<code>features/dna/</code>) · edge fns (<code>supabase/functions/</code>) · dev bridge (<code>scripts/eval-bridge.mjs</code>, mirror every edge change) · schema lock (<code>dna-schema.json ↔ dnaSchema.ts</code>).</p>
        </section>

        {/* ── 5 · the driver ────────────────────────────────────── */}
        <section id="driver" className="arch-sec">
          <SectionTitle n="05" k="one agent thread per book" title="The Driver — book-agent + propose/commit" sub="Generation has two exits: auto-land as accepted nodes, or reviewable ops (phantoms → apply/discard in AgentRail). Auto-accept can arm it to walk the whole ladder." />
          <div className="arch-tools">
            {(["read", "propose", "gate"] as const).map((k) => (
              <div key={k} className={`arch-tool-group ${k}`}>
                <div className="arch-tool-group-h">{k === "read" ? "sense" : k === "propose" ? "propose" : "control"}</div>
                {TOOLS.filter((t) => t.kind === k).map((t) => (
                  <div key={t.name} className="arch-tool"><span className="arch-tool-glyph">▷</span><code>{t.name}</code><em>{t.what}</em></div>
                ))}
              </div>
            ))}
          </div>
          <div className="arch-commit">
            <div className="arch-commit-in">propose_options · propose_node_ops · propose_expansion</div>
            <div className="arch-commit-split">
              <div className="arch-commit-exit"><b>manual</b>→ phantoms in AgentRail · apply / discard</div>
              <div className="arch-commit-exit auto"><b>auto-accept armed</b>→ auto-land as accepted nodes + snapshot a tree version · each fork journaled ⑂</div>
            </div>
          </div>
        </section>

        {/* ── 6 · linters ───────────────────────────────────────── */}
        <section id="lints" className="arch-sec">
          <SectionTitle n="06" k="the sensing half" title="Linters — the deterministic floor" sub="Generation down the ladder is dead-reckoning; lints + prose read-repair are the sensing half. validate() aggregates structural + causal + dead-field; verticals/prose/sketch run per surface. LintConfig is derived per-book from the brief (genre preset)." />
          <div className="arch-lint-toolbar">
            <div className="arch-seg">
              {(["all", "error", "warn"] as const).map((f) => (
                <button key={f} className={lintFilter === f ? "on" : ""} onClick={() => setLintFilter(f)}>
                  {f}{f === "error" ? ` · ${errorCount}` : f === "warn" ? ` · ${LINTS.length - errorCount}` : ` · ${LINTS.length}`}
                </button>
              ))}
            </div>
            <span className="arch-lint-cfg">lintConfigForBrief() → the linter's “.eslintrc”</span>
          </div>
          <div className="arch-lint-grid">
            {lintFamilies.map(([fam, items]) => (
              <div className="arch-lint-fam" key={fam}>
                <div className="arch-lint-fam-h">{fam}</div>
                {items.map((l) => (
                  <div key={l.code} className={`arch-lint ${l.sev}`}>
                    <span className={`arch-sev ${l.sev}`}>{l.sev === "error" ? "●" : "▲"}</span>
                    <code>{l.code}</code>
                    <span className="arch-lint-fn">{l.fn}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>

        {/* ── 7 · ledgers ───────────────────────────────────────── */}
        <section id="ledgers" className="arch-sec">
          <SectionTitle n="07" k="computed views over the tree" title="Ledgers — grounded context, purely derived" sub="Every ledger is a pure derivation — the tree is the only store. They give the generator grounded context (“story so far”) and the verifier something to diff against." />
          <div className="arch-ledger-grid">
            {LEDGERS.map((l, i) => (
              <div className="arch-ledger" key={l.name}>
                <span className="arch-ledger-n">{String(i + 1).padStart(2, "0")}</span>
                <div className="arch-ledger-name">{l.name}</div>
                <div className="arch-ledger-what">{l.what}</div>
                <code className="arch-ledger-fns">{l.fns}</code>
              </div>
            ))}
          </div>
        </section>

        {/* ── 8 · verify loop ───────────────────────────────────── */}
        <section id="verify" className="arch-sec">
          <SectionTitle n="08" k="generate ↔ verify" title="The Verify Loop — observed vs planned" sub="After generating, an experiential read produces observed traces; traceDiff compares observed vs planned; the gap can cascade a fix back up the ladder. Reads are paid LLM passes; lints are the deterministic floor." />
          <div className="arch-loop">
            <div className="arch-loop-node gen">generate<span>dead-reckoning down the ladder</span></div>
            <Arrow />
            <div className="arch-loop-node store">▭ book_nodes<span>planned trace</span></div>
            <Arrow />
            <div className="arch-loop-reads">
              {READS.map((r) => <div key={r.fn} className="arch-read">⬡ <code>{r.fn}</code><span>{r.out}</span></div>)}
            </div>
            <Arrow />
            <div className="arch-loop-node diff">traceDiff<span>planned vs observed → TraceGap[]</span></div>
          </div>
          <div className="arch-cascade"><span className="arch-cascade-arrow">↺</span> gap cascades up the ladder → re-generate · or AgentRail auto-repairs the tail</div>
          <p className="arch-note"><b>Prose is a special two-hop</b> (escapes the ~150s worker ceiling): <code>prepare</code> assembles the prompt + a curated render brief (focus · mustHonor · avoid); the browser streams off-worker; a rolling incremental digest (<code>prose_digest</code>, src/prev hash chain) keeps continuity at O(1)/page; read-repair fixes the tail.</p>
        </section>

        {/* ── 9 · provenance ────────────────────────────────────── */}
        <section id="provenance" className="arch-sec">
          <SectionTitle n="09" k="the cross-cutting strand" title="Staleness &amp; Provenance" sub="Runs through every rung. Keeps derived rungs honest when an upstream node changes, and carries author intent verbatim downward." />
          <div className="arch-prov">
            <div className="arch-prov-flow">
              <span className="arch-prov-step">edit a node</span><i>→</i>
              <span className="arch-prov-step">inputHash() re-stamped</span><i>→</i>
              <span className="arch-prov-step">isStale / isProseStale / isSketchStale</span><i>→</i>
              <span className="arch-prov-step warn">flagged stale — not auto-clobbered</span>
            </div>
            <div className="arch-prov-cards">
              <div className="arch-prov-card"><b>Hash chain</b>inputHash · stampInput · stampProse · stampSketch — compares current input-set hash to the stamped one</div>
              <div className="arch-prov-card"><b>Locks</b>a <code>locked</code> node is injected <em>verbatim</em> into every downstream pass — the hard constraint a pin propagates as</div>
              <div className="arch-prov-card"><b>Provenance</b>every node stamped <code>source</code> (authored / derived / instrument) · <code>status</code> · <code>locked</code> — the Authoring plane</div>
            </div>
          </div>
        </section>

        {/* ── 10 · data model ───────────────────────────────────── */}
        <section id="data" className="arch-sec">
          <SectionTitle n="10" k="what is stored" title="Data Model" sub="Eight tables. book_nodes is the only source of truth; every derived view is recomputed live." />
          <div className="arch-tables">
            {TABLES.map((t) => (
              <div className={`arch-table-row ${t.priv ? "priv" : ""}`} key={t.name}>
                <code>{t.name}</code>
                <span className={`arch-owner ${t.owner}`}>{t.owner}</span>
                <span className="arch-table-role">{t.role}</span>
                {t.priv && <span className="arch-lock">private</span>}
              </div>
            ))}
          </div>
        </section>

        {/* ── 11 · deploy split ─────────────────────────────────── */}
        <section id="deploy" className="arch-sec">
          <SectionTitle n="11" k="physically two targets, logically one" title="Deploy Split &amp; Parity" sub="The Supabase CLI deploys fns only from supabase/functions/; they ride a shared kernel used by 13–19 other fns. The engine is parity-locked across the web + edge twins." />
          <div className="arch-deploy">
            <div className="arch-deploy-card"><b>Web engine + UI</b><code>apps/web/src/features/dna/</code>pure engine runs client-side · read FEATURE.md first</div>
            <div className="arch-deploy-card"><b>Edge fns</b><code>supabase/functions/&lt;name&gt;/</code>ride _shared/&#123;llm · task · access · brief&#125;</div>
            <div className="arch-deploy-card"><b>Dev bridge</b><code>scripts/eval-bridge.mjs</code>reimplements the edge pipeline for localhost:8787 — mirror every edge change</div>
            <div className="arch-deploy-card"><b>Parity + schema lock</b><code>novelDna.parity.test.ts · dnaSchema.artifact.test.ts</code>fail on twin drift or schema drift</div>
          </div>
        </section>

        {/* ── 12 · recent ───────────────────────────────────────── */}
        <section id="changes" className="arch-sec">
          <SectionTitle n="12" k="what landed lately" title="Recent Changes" sub="Newest first. All engine changes are parity-locked across the web engine and the edge twin." />
          <div className="arch-timeline">
            {CHANGES.map((c) => (
              <div className="arch-tl-item" key={c.title + c.date}>
                <div className="arch-tl-dot" />
                <time>{c.date}</time>
                <div className="arch-tl-body"><b>{c.title}</b><p>{c.body}</p></div>
              </div>
            ))}
          </div>
          <footer className="arch-foot">Novel DNA · architecture atlas · generated from docs/dna/architecture.md · book-agnostic · admin</footer>
        </section>
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SCOPED STYLES — dark "blueprint / genome atlas". Everything under .arch-root.
// ─────────────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@0,400;0,500;1,400;1,500&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');

.arch-root{
  --bg:#0a0e13; --bg2:#0d1219; --panel:#111823; --panel2:#0f151e;
  --ink:#e6ecf2; --muted:#93a1b0; --faint:#5d6b7a; --line:rgba(120,150,180,.14); --line2:rgba(120,150,180,.28);
  --cy:#4fd1c5; --cy2:#38bdf8; --am:#f5a623; --err:#f87171; --warn:#fbbf24; --grn:#a3e635;
  --mono:'IBM Plex Mono',ui-monospace,monospace; --sans:'IBM Plex Sans',system-ui,sans-serif; --serif:'Newsreader',Georgia,serif;
  position:fixed; inset:0; overflow-y:auto; overflow-x:hidden;
  background:radial-gradient(1200px 700px at 78% -10%, rgba(56,189,248,.10), transparent 60%),radial-gradient(900px 600px at 8% 8%, rgba(79,209,197,.07), transparent 55%),var(--bg);
  color:var(--ink); font-family:var(--sans); font-size:14px; line-height:1.55;
  -webkit-font-smoothing:antialiased;
}
.arch-root *{box-sizing:border-box}
.arch-root code{font-family:var(--mono); font-size:.85em}
.arch-root ::selection{background:rgba(79,209,197,.28)}
.arch-root ::-webkit-scrollbar{width:10px;height:10px}
.arch-root ::-webkit-scrollbar-thumb{background:var(--line2);border-radius:8px}

/* side rail */
.arch-rail{position:fixed; left:0; top:0; bottom:0; width:210px; padding:26px 18px; border-right:1px solid var(--line); background:linear-gradient(180deg,rgba(13,18,25,.9),rgba(10,14,19,.9)); backdrop-filter:blur(8px); z-index:20; display:flex; flex-direction:column; gap:18px}
.arch-rail-brand{display:flex; align-items:center; gap:9px; font-family:var(--mono); font-weight:600; letter-spacing:.06em; font-size:15px}
.arch-rail-brand em{color:var(--cy); font-style:normal; font-weight:400; opacity:.85}
.arch-helix{display:inline-grid; place-items:center; width:26px; height:26px; border:1px solid var(--cy); border-radius:7px; color:var(--cy); box-shadow:0 0 18px rgba(79,209,197,.35) inset}
.arch-rail ol{list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:1px; counter-reset:s}
.arch-rail a{display:flex; align-items:center; gap:9px; padding:6px 8px; border-radius:7px; color:var(--muted); text-decoration:none; font-size:12.5px; transition:.18s}
.arch-rail-tick{width:14px; height:1px; background:var(--line2); transition:.18s}
.arch-rail a:hover{color:var(--ink); background:rgba(120,150,180,.06)}
.arch-rail a.on{color:var(--cy); background:rgba(79,209,197,.08)}
.arch-rail a.on .arch-rail-tick{width:22px; height:2px; background:var(--cy); box-shadow:0 0 8px var(--cy)}
.arch-rail-src{margin-top:auto; font-family:var(--mono); font-size:10.5px; color:var(--faint); text-decoration:none}
.arch-rail-src:hover{color:var(--cy)}

.arch-main{margin-left:210px; max-width:1120px; padding:0 clamp(20px,5vw,72px) 120px}

/* hero */
.arch-hero{position:relative; padding:clamp(56px,11vh,120px) 0 clamp(40px,7vh,72px); overflow:hidden}
.arch-hero-grid{position:absolute; inset:-2px; background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px); background-size:34px 34px; mask-image:radial-gradient(circle at 40% 20%, #000 0%, transparent 72%); opacity:.6}
.arch-hero-inner{position:relative; animation:archUp .7s cubic-bezier(.2,.7,.2,1) both}
.arch-eyebrow{display:inline-flex; align-items:center; gap:9px; font-family:var(--mono); font-size:11px; letter-spacing:.16em; color:var(--muted); text-transform:uppercase; padding:5px 11px; border:1px solid var(--line2); border-radius:999px; background:rgba(255,255,255,.02)}
.arch-dot{width:7px; height:7px; border-radius:50%; background:var(--cy); box-shadow:0 0 10px var(--cy); animation:archPulse 2.4s infinite}
.arch-h1{font-family:var(--serif); font-weight:400; font-size:clamp(44px,8vw,88px); line-height:.98; letter-spacing:-.02em; margin:20px 0 0}
.arch-h1-accent{font-style:italic; color:transparent; background:linear-gradient(92deg,var(--cy),var(--cy2)); -webkit-background-clip:text; background-clip:text}
.arch-h1-sub{display:block; font-family:var(--mono); font-size:clamp(12px,1.6vw,15px); letter-spacing:.02em; color:var(--muted); margin-top:16px; font-weight:400}
.arch-lede{max-width:64ch; margin:26px 0 0; font-size:clamp(15px,1.8vw,17px); color:#c3cdd7; font-family:var(--serif)}
.arch-lede code{font-family:var(--mono); font-size:.82em; color:var(--cy); background:rgba(79,209,197,.1); padding:1px 6px; border-radius:5px}
.arch-lede b{color:var(--ink); font-weight:500}
.arch-legend{display:flex; flex-wrap:wrap; gap:8px; margin-top:30px}
.arch-legend-item{display:inline-flex; align-items:center; gap:7px; font-size:11.5px; color:var(--muted); font-family:var(--mono); padding:5px 10px; border:1px solid var(--line); border-radius:7px; background:var(--panel2)}
.arch-legend-item b{color:var(--cy); font-weight:600}

/* sections */
.arch-sec{padding:clamp(46px,8vh,82px) 0; border-top:1px solid var(--line); scroll-margin-top:20px}
.arch-sec-head{display:flex; gap:20px; align-items:flex-start; margin-bottom:34px}
.arch-sec-n{font-family:var(--mono); font-size:13px; color:var(--cy); border:1px solid var(--line2); border-radius:8px; padding:7px 10px; letter-spacing:.05em; box-shadow:0 0 24px rgba(79,209,197,.12) inset; flex-shrink:0}
.arch-sec-kicker{font-family:var(--mono); font-size:11px; letter-spacing:.18em; text-transform:uppercase; color:var(--faint)}
.arch-sec-title{font-family:var(--serif); font-weight:500; font-size:clamp(26px,4vw,38px); letter-spacing:-.015em; margin:4px 0 8px; line-height:1.05}
.arch-sec-sub{max-width:76ch; color:var(--muted); margin:0; font-size:14px}
.arch-note{margin:22px 0 0; font-size:12.5px; color:var(--faint); border-left:2px solid var(--line2); padding-left:14px}
.arch-note code{color:var(--cy)} .arch-note b{color:var(--muted)}

/* seam */
.arch-seam{display:flex; align-items:stretch; gap:6px; flex-wrap:wrap}
.arch-seam-col{flex:1; min-width:220px; display:flex; flex-direction:column; gap:8px}
.arch-private{padding:14px; border:1px dashed var(--line2); border-radius:14px; background:linear-gradient(180deg,rgba(79,209,197,.05),transparent)}
.arch-tag{font-family:var(--mono); font-size:10.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--faint)}
.arch-tag.accent{color:var(--cy)}
.arch-node{border:1px solid var(--line2); border-radius:11px; padding:13px 15px; background:var(--panel); font-family:var(--mono); font-size:13px; display:flex; flex-direction:column; gap:3px}
.arch-node span{font-size:11px; color:var(--faint)}
.arch-node.store{border-color:rgba(245,166,35,.35); background:linear-gradient(180deg,rgba(245,166,35,.06),var(--panel))}
.arch-node.store.priv{border-color:rgba(79,209,197,.4); background:linear-gradient(180deg,rgba(79,209,197,.08),var(--panel))}
.arch-node.engine{color:#cdd6df}

/* arrow connector */
.arch-arrow{display:flex; align-items:center; gap:6px; padding:0 4px; color:var(--cy)}
.arch-arrow.down{flex-direction:column; padding:6px 0}
.arch-arrow-line{height:1px; width:26px; background:linear-gradient(90deg,transparent,var(--cy)); flex-shrink:0}
.arch-arrow.down .arch-arrow-line{width:1px; height:22px; background:linear-gradient(180deg,transparent,var(--cy))}
.arch-arrow-head{font-size:11px}
.arch-arrow-label{font-family:var(--mono); font-size:10px; letter-spacing:.08em; color:var(--muted); white-space:nowrap}

/* ladder */
.arch-ladder{position:relative; padding-left:8px}
.arch-spine{position:absolute; left:29px; top:14px; bottom:40px; width:2px; background:linear-gradient(180deg,#38bdf8,#4fd1c5,#a3e635,#fbbf24,#fb923c,#f87171,#e879f9); border-radius:2px; box-shadow:0 0 22px rgba(120,180,220,.3)}
.arch-rung{position:relative; display:flex; gap:22px; padding:9px 0; align-items:flex-start; animation:archUp .5s both}
.arch-rung:nth-child(2){animation-delay:.03s}.arch-rung:nth-child(3){animation-delay:.06s}.arch-rung:nth-child(4){animation-delay:.09s}.arch-rung:nth-child(5){animation-delay:.12s}.arch-rung:nth-child(6){animation-delay:.15s}.arch-rung:nth-child(7){animation-delay:.18s}
.arch-rung-node{position:relative; z-index:2; width:42px; height:42px; flex-shrink:0; border-radius:50%; display:grid; place-items:center; background:var(--bg2); border:2px solid var(--rc); color:var(--rc); font-family:var(--mono); font-weight:600; box-shadow:0 0 20px color-mix(in srgb, var(--rc) 45%, transparent)}
.arch-rung-node.xcribe{font-size:11px}
.arch-rung-card{flex:1; border:1px solid var(--line); border-left:3px solid var(--rc); border-radius:12px; padding:14px 16px; background:linear-gradient(180deg,var(--panel),var(--panel2)); transition:.2s}
.arch-rung-card:hover{border-color:var(--line2); transform:translateX(3px); box-shadow:-8px 0 24px -12px color-mix(in srgb, var(--rc) 60%, transparent)}
.arch-rung-top{display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; margin-bottom:9px}
.arch-rung-kind{font-family:var(--mono); font-size:16px; color:var(--rc); font-weight:600}
.arch-rung-lvl{font-family:var(--mono); font-size:11px; color:var(--faint); border:1px solid var(--line2); border-radius:5px; padding:1px 6px}
.arch-rung-tag{font-size:11px; color:var(--muted)}
.arch-rung-row{display:grid; grid-template-columns:78px 1fr; gap:12px; font-size:12.5px; color:#c3cdd7; padding:3px 0}
.arch-rung-row i{font-family:var(--mono); font-style:normal; font-size:10.5px; letter-spacing:.08em; text-transform:uppercase; color:var(--faint); padding-top:1px}
.arch-rung-row.mech{color:var(--muted)}
.arch-entities{display:flex; flex-wrap:wrap; gap:6px; margin-top:12px; padding-top:12px; border-top:1px dashed var(--line2); align-items:center}
.arch-entities-label{font-family:var(--mono); font-size:10.5px; color:var(--grn); letter-spacing:.05em; margin-right:4px}
.arch-chip{font-family:var(--mono); font-size:11px; color:#c9d6b8; border:1px solid rgba(163,230,53,.3); background:rgba(163,230,53,.06); padding:3px 8px; border-radius:6px}
.arch-axis{display:flex; align-items:center; gap:12px; margin:24px 0 0 8px; font-family:var(--mono); font-size:11px; color:var(--faint); letter-spacing:.06em}
.arch-axis-line{flex:1; height:1px; background:linear-gradient(90deg,var(--cy2),var(--err)); opacity:.4}

/* journey steps */
.arch-steps{display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:10px}
.arch-step{border:1px solid var(--line); border-radius:12px; padding:14px; background:var(--panel2); position:relative; transition:.2s}
.arch-step:hover{border-color:var(--cy); box-shadow:0 0 0 1px rgba(79,209,197,.2)}
.arch-step.gate{border-style:dashed; border-color:rgba(245,166,35,.4)}
.arch-step-head{display:flex; align-items:center; justify-content:space-between; font-size:14px; margin-bottom:9px}
.arch-step-arrow{color:var(--cy); font-family:var(--mono)}
.arch-step-kinds{display:block; font-size:11px; color:var(--cy); background:rgba(79,209,197,.07); border-radius:6px; padding:5px 8px; margin-bottom:8px; word-break:break-word}
.arch-step-by{font-size:11.5px; color:var(--muted)}
.arch-step-mech{font-size:11px; color:var(--faint); margin-top:6px; font-style:italic}
.arch-formula{margin-top:18px; border:1px solid var(--line); border-radius:12px; padding:14px 16px; background:var(--panel2); font-family:var(--mono); font-size:12.5px; color:#c3cdd7; display:flex; flex-direction:column; gap:7px}
.arch-formula-k{color:var(--cy)} .arch-formula em{color:var(--faint); font-style:normal}

/* lanes */
.arch-lanes{display:flex; gap:8px; align-items:stretch; flex-wrap:wrap}
.arch-lane{flex:1; min-width:230px; border:1px solid var(--line); border-radius:14px; padding:6px; background:var(--panel2); display:flex; flex-direction:column; gap:6px}
.arch-lane-head{font-family:var(--mono); font-size:11px; letter-spacing:.05em; color:var(--cy2); padding:9px 10px 4px; text-transform:uppercase}
.arch-lane-head.edge{color:var(--cy)} .arch-lane-head.db{color:var(--am)}
.arch-lane-item{font-family:var(--mono); font-size:12px; color:#cbd5df; border:1px solid var(--line); border-radius:9px; padding:10px 11px; background:var(--panel); transition:.18s}
.arch-lane-item:hover{border-color:var(--line2); transform:translateY(-1px)}
.arch-lane-item.edge{border-left:2px solid var(--cy)} .arch-lane-item.db{border-left:2px solid var(--am)}
.arch-lane-gap{display:grid; place-items:center; font-size:20px; color:var(--faint); align-self:center}

/* driver tools */
.arch-tools{display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:10px}
.arch-tool-group{border:1px solid var(--line); border-radius:12px; padding:12px; background:var(--panel2)}
.arch-tool-group.read{border-top:2px solid var(--cy2)}
.arch-tool-group.propose{border-top:2px solid var(--grn)}
.arch-tool-group.gate{border-top:2px solid var(--am)}
.arch-tool-group-h{font-family:var(--mono); font-size:10.5px; letter-spacing:.14em; text-transform:uppercase; color:var(--faint); margin-bottom:9px}
.arch-tool{display:flex; align-items:baseline; gap:8px; padding:6px 0; border-bottom:1px solid var(--line)}
.arch-tool:last-child{border-bottom:none}
.arch-tool-glyph{color:var(--cy); font-size:11px}
.arch-tool code{color:var(--ink); font-size:12.5px}
.arch-tool em{color:var(--faint); font-size:11px; font-style:normal; margin-left:auto; text-align:right}
.arch-commit{margin-top:14px; border:1px solid var(--line); border-radius:14px; padding:16px; background:var(--panel2)}
.arch-commit-in{font-family:var(--mono); font-size:12px; color:var(--cy); text-align:center; padding-bottom:14px}
.arch-commit-split{display:flex; gap:12px; flex-wrap:wrap}
.arch-commit-exit{flex:1; min-width:220px; border:1px solid var(--line2); border-radius:11px; padding:13px; font-size:12.5px; color:var(--muted); background:var(--panel)}
.arch-commit-exit b{color:var(--ink); display:block; font-family:var(--mono); font-size:11px; margin-bottom:5px}
.arch-commit-exit.auto{border-color:rgba(79,209,197,.35); background:linear-gradient(180deg,rgba(79,209,197,.06),var(--panel))}
.arch-commit-exit.auto b{color:var(--cy)}

/* lints */
.arch-lint-toolbar{display:flex; align-items:center; gap:16px; margin-bottom:18px; flex-wrap:wrap}
.arch-seg{display:inline-flex; border:1px solid var(--line2); border-radius:9px; overflow:hidden; background:var(--panel2)}
.arch-seg button{font-family:var(--mono); font-size:11.5px; color:var(--muted); background:none; border:none; padding:7px 13px; cursor:pointer; border-right:1px solid var(--line); transition:.15s}
.arch-seg button:last-child{border-right:none}
.arch-seg button:hover{color:var(--ink); background:rgba(120,150,180,.06)}
.arch-seg button.on{color:var(--bg); background:var(--cy)}
.arch-lint-cfg{font-family:var(--mono); font-size:11px; color:var(--faint)}
.arch-lint-grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:12px}
.arch-lint-fam{border:1px solid var(--line); border-radius:12px; padding:12px 14px; background:var(--panel2)}
.arch-lint-fam-h{font-family:var(--serif); font-size:16px; color:var(--ink); margin-bottom:10px; letter-spacing:-.01em}
.arch-lint{display:flex; align-items:baseline; gap:9px; padding:6px 0; border-top:1px solid var(--line)}
.arch-lint code{font-size:12.5px; color:var(--ink)}
.arch-lint.error code{color:#fca5a5}
.arch-sev{font-size:9px; flex-shrink:0}
.arch-sev.error{color:var(--err)} .arch-sev.warn{color:var(--warn)}
.arch-lint-fn{margin-left:auto; font-family:var(--mono); font-size:10.5px; color:var(--faint); text-align:right}

/* ledgers */
.arch-ledger-grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:12px}
.arch-ledger{position:relative; border:1px solid var(--line); border-radius:12px; padding:16px 15px 14px; background:linear-gradient(180deg,var(--panel),var(--panel2)); overflow:hidden; transition:.2s}
.arch-ledger:hover{border-color:var(--cy); transform:translateY(-2px)}
.arch-ledger-n{position:absolute; top:8px; right:12px; font-family:var(--serif); font-style:italic; font-size:30px; color:var(--line2)}
.arch-ledger-name{font-family:var(--mono); font-size:13.5px; color:var(--cy); font-weight:600; margin-bottom:7px; max-width:80%}
.arch-ledger-what{font-size:12.5px; color:#c3cdd7; margin-bottom:11px}
.arch-ledger-fns{display:block; font-size:11px; color:var(--faint); line-height:1.5; border-top:1px dashed var(--line2); padding-top:9px}

/* verify loop */
.arch-loop{display:flex; align-items:center; gap:4px; flex-wrap:wrap}
.arch-loop-node{border:1px solid var(--line2); border-radius:12px; padding:14px 16px; background:var(--panel); font-family:var(--mono); font-size:13px; display:flex; flex-direction:column; gap:4px; min-width:130px}
.arch-loop-node span{font-size:10.5px; color:var(--faint); font-family:var(--sans)}
.arch-loop-node.gen{border-color:rgba(163,230,53,.4)}
.arch-loop-node.store{border-color:rgba(79,209,197,.4)}
.arch-loop-node.diff{border-color:rgba(245,166,35,.4)}
.arch-loop-reads{display:flex; flex-direction:column; gap:5px; border:1px dashed var(--line2); border-radius:12px; padding:8px; background:rgba(79,209,197,.03)}
.arch-read{font-family:var(--mono); font-size:11px; color:var(--cy); display:flex; align-items:baseline; gap:7px}
.arch-read span{color:var(--faint); font-family:var(--sans); font-size:10.5px}
.arch-cascade{margin-top:14px; display:inline-flex; align-items:center; gap:10px; font-family:var(--mono); font-size:12px; color:var(--am); border:1px solid rgba(245,166,35,.3); border-radius:999px; padding:8px 16px; background:rgba(245,166,35,.05)}
.arch-cascade-arrow{font-size:16px}

/* provenance */
.arch-prov-flow{display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:18px}
.arch-prov-step{font-family:var(--mono); font-size:12px; color:#cbd5df; border:1px solid var(--line2); border-radius:9px; padding:9px 13px; background:var(--panel)}
.arch-prov-step.warn{color:var(--warn); border-color:rgba(251,191,36,.35)}
.arch-prov-flow i{color:var(--cy); font-style:normal; font-family:var(--mono)}
.arch-prov-cards{display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:12px}
.arch-prov-card{border:1px solid var(--line); border-radius:12px; padding:14px; background:var(--panel2); font-size:12.5px; color:#c3cdd7}
.arch-prov-card b{display:block; color:var(--cy); font-family:var(--mono); font-size:12px; margin-bottom:6px}
.arch-prov-card code{color:var(--am)} .arch-prov-card em{color:var(--ink); font-style:normal}

/* data model */
.arch-tables{border:1px solid var(--line); border-radius:14px; overflow:hidden; background:var(--panel2)}
.arch-table-row{display:flex; align-items:center; gap:14px; padding:12px 16px; border-top:1px solid var(--line)}
.arch-table-row:first-child{border-top:none}
.arch-table-row.priv{background:rgba(79,209,197,.03)}
.arch-table-row code{font-size:13px; color:var(--ink); min-width:180px}
.arch-owner{font-family:var(--mono); font-size:10px; letter-spacing:.06em; text-transform:uppercase; padding:2px 8px; border-radius:5px; border:1px solid var(--line2)}
.arch-owner.DNA,.arch-owner.dna{color:var(--cy); border-color:rgba(79,209,197,.35)}
.arch-owner.editor,.arch-owner.reader{color:var(--am); border-color:rgba(245,166,35,.3)}
.arch-owner.shared{color:var(--muted)}
.arch-table-role{flex:1; font-size:12.5px; color:var(--muted)}
.arch-lock{font-family:var(--mono); font-size:10px; color:var(--cy); opacity:.7}

/* deploy */
.arch-deploy{display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:12px}
.arch-deploy-card{border:1px solid var(--line); border-radius:12px; padding:15px; background:var(--panel2); font-size:12.5px; color:var(--muted)}
.arch-deploy-card b{display:block; font-family:var(--serif); font-size:16px; color:var(--ink); margin-bottom:8px}
.arch-deploy-card code{display:block; font-size:11px; color:var(--cy); background:rgba(79,209,197,.07); padding:6px 8px; border-radius:6px; margin-bottom:9px; word-break:break-all}

/* timeline */
.arch-timeline{position:relative; padding-left:18px}
.arch-timeline:before{content:""; position:absolute; left:3px; top:6px; bottom:6px; width:2px; background:linear-gradient(180deg,var(--cy),transparent)}
.arch-tl-item{position:relative; display:flex; gap:16px; padding:10px 0; align-items:baseline}
.arch-tl-dot{position:absolute; left:-18px; top:15px; width:8px; height:8px; border-radius:50%; background:var(--cy); box-shadow:0 0 10px var(--cy)}
.arch-tl-item time{font-family:var(--mono); font-size:11px; color:var(--faint); min-width:82px}
.arch-tl-body b{font-family:var(--mono); font-size:13.5px; color:var(--ink)}
.arch-tl-body p{margin:4px 0 0; font-size:12.5px; color:var(--muted)}
.arch-foot{margin-top:40px; padding-top:20px; border-top:1px solid var(--line); font-family:var(--mono); font-size:11px; color:var(--faint); text-align:center; letter-spacing:.04em}

@keyframes archUp{from{opacity:0; transform:translateY(14px)}to{opacity:1; transform:none}}
@keyframes archPulse{0%,100%{opacity:1}50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){.arch-root *{animation:none!important}}

@media (max-width:860px){
  .arch-rail{position:static; width:auto; flex-direction:row; align-items:center; gap:12px; overflow-x:auto; padding:12px 16px}
  .arch-rail ol{flex-direction:row; gap:2px} .arch-rail-tick{display:none} .arch-rail-src{margin:0}
  .arch-rail-brand{position:sticky; left:0}
  .arch-main{margin-left:0}
  .arch-root{position:static; height:auto; min-height:100%}
}
`;
