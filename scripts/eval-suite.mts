// eval-suite — run the premise eval as a SUITE: N trials × M fixtures, then aggregate.
//
// This is the piece that makes any number here mean something. Generation is stochastic: a single run per
// configuration is one sample of a distribution, and two single runs differ for reasons that have nothing
// to do with the change being tested. The suite reports mean AND spread, so a difference can be compared
// against the noise it has to beat.
//
//   pnpm dna:suite --trials 3                        # every fixture, 3 trials each
//   pnpm dna:suite --trials 3 --tasks thin-brief     # one fixture
//   pnpm dna:suite --trials 2 --label baseline       # tag the run for later comparison
//   pnpm dna:suite --trials 3 --concurrency 2        # faster, but see the caveat below
//
// Runs SEQUENTIALLY by default on purpose. Trajectory metrics include latency and wall-clock, and running
// several books at once makes them contend for the same provider and worker pool — which shows up as the
// agent being "slower" when it is only being crowded. Raise --concurrency when you care about total
// elapsed time more than faithful timing.
//
// Report → scripts/.agent-suite-<label>.json (+ a printed table).
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argVal = (f: string, d?: string) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : d; };
const TRIALS = Number(argVal("--trials", "3"));
const CONCURRENCY = Math.max(1, Number(argVal("--concurrency", "1")));
const LABEL = argVal("--label", "run")!;
const AUTHOR = argVal("--author", "llm")!;
const MAX_CHAT = argVal("--max-chat", "12")!;
const MAX_STEPS = argVal("--max-steps", "30")!;
const NO_JUDGES = args.includes("--no-judges");
// A/B arms (book-agent/variants.ts). Comma-separated; an EMPTY entry means production (no variant).
//   --variants ,no_converge   → two arms: production and the no_converge control
// Arms are interleaved rather than run back-to-back: running all of A then all of B is time-confounded —
// provider load and model updates drift between the halves and cannot be separated from the change.
const ARMS = (argVal("--variants") ?? "").split(",").map((v) => v.trim());

const suite = JSON.parse(readFileSync(join(here, "eval-premise-tasks.json"), "utf8")) as { tasks: { id: string }[] };
const TASKS = (argVal("--tasks") ?? "").split(",").filter(Boolean);
const taskIds = TASKS.length ? TASKS : suite.tasks.map((t) => t.id);

const stamp = () => new Date().toISOString().slice(11, 19);
const log = (m: string) => console.log(`[${stamp()}] [suite] ${m}`);

// Streams the child's output as it arrives, prefixed, as well as capturing it for parsing. Buffering it
// silently until exit was a real usability defect: a run takes ~15 minutes with the LLM author, and with no
// output there is no way to tell a slow run from a hung one — which is exactly the question you have at
// minute twelve.
function sh(cmd: string, cmdArgs: string[], tag: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, cmdArgs, { cwd: join(here, ".."), env: process.env });
    let out = "";
    let pending = "";
    const pump = (chunk: string) => {
      out += chunk;
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const l of lines) if (l.trim() && !l.startsWith(">")) console.log(`    ${tag} │ ${l.trim()}`);
    };
    p.stdout.on("data", (d) => pump(String(d)));
    p.stderr.on("data", (d) => pump(String(d)));
    p.on("close", (code) => resolve({ code: code ?? 1, out }));
  });
}

const TSX = join(here, "..", "node_modules", ".bin", "tsx");
const TSCFG = join(here, "harness", "tsconfig.json");

interface Trial {
  taskId: string; trial: number; variant: string; bookId: number | null;
  stopReason: string | null; gate: boolean | null;
  checksPassed: number | null; checksTotal: number | null;
  loglineMean: number | null; premiseMean: number | null;
  turns: number | null; aiCalls: number | null; reads: number | null;
  cacheReadRatio: number | null; errors: number | null; wallClockMs: number | null;
  pushes: number | null; fallbacks: number | null; nudges: number | null;
  failure?: string;
}

async function runOne(taskId: string, trial: number, variant: string): Promise<Trial> {
  const base: Trial = {
    taskId, trial, variant, bookId: null, stopReason: null, gate: null, checksPassed: null, checksTotal: null,
    loglineMean: null, premiseMean: null, turns: null, aiCalls: null, reads: null,
    cacheReadRatio: null, errors: null, wallClockMs: null, pushes: null, fallbacks: null, nudges: null,
  };
  log(`${taskId} trial ${trial}/${TRIALS}${variant ? ` [${variant}]` : " [prod]"} — driving…`);
  const run = await sh(TSX, ["--tsconfig", TSCFG, join(here, "agent-build-run.mts"),
    "--task", taskId, "--author", AUTHOR, "--max-chat", MAX_CHAT, "--max-steps", MAX_STEPS,
    ...(variant ? ["--variant", variant] : [])], `${taskId}#${trial}${variant ? `·${variant}` : ""}`);
  const resultPath = run.out.match(/RESULT_JSON=(.+)/)?.[1]?.trim();
  if (!resultPath) {
    return { ...base, failure: `driver produced no result (exit ${run.code}): ${run.out.trim().slice(-300)}` };
  }
  const r = JSON.parse(readFileSync(resultPath, "utf8"));
  const withRun: Trial = {
    ...base, bookId: r.bookId, stopReason: r.stopReason, wallClockMs: r.wallClockMs, turns: r.turns,
    pushes: r.author?.pushes ?? null, fallbacks: r.author?.fallbackUses ?? null, nudges: r.author?.nudges ?? null,
  };

  log(`${taskId} trial ${trial} — book ${r.bookId} · ${r.stopReason} · grading…`);
  const gradeArgs = ["--tsconfig", TSCFG, join(here, "eval-premise.mts"), "--book", String(r.bookId), "--task", taskId];
  if (NO_JUDGES) gradeArgs.push("--no-judges");
  const grade = await sh(TSX, gradeArgs, `${taskId}#${trial}·grade`);
  const evalPath = join(here, `.agent-eval-${r.bookId}.json`);
  let g: Record<string, never> | null = null;
  try { g = JSON.parse(readFileSync(evalPath, "utf8")); } catch { /* fall through */ }
  if (!g) return { ...withRun, failure: `grader produced no report (exit ${grade.code}): ${grade.out.trim().slice(-300)}` };

  const det = (g as never as { deterministic: { gate: boolean | null; checks: { pass: boolean }[] } }).deterministic;
  const traj = (g as never as { trajectory: Record<string, number | null> }).trajectory;
  const judges = (g as never as { judges: Record<string, { mean?: number } | string> }).judges ?? {};
  const meanOf = (k: string) => (typeof judges[k] === "object" && judges[k] ? (judges[k] as { mean?: number }).mean ?? null : null);

  return {
    ...withRun,
    gate: det?.gate ?? null,
    checksPassed: det?.checks?.filter((c) => c.pass).length ?? null,
    checksTotal: det?.checks?.length ?? null,
    loglineMean: meanOf("logline"),
    premiseMean: meanOf("premise"),
    aiCalls: traj?.aiCalls ?? null,
    reads: traj?.reads ?? null,
    cacheReadRatio: traj?.cacheReadRatio ?? null,
    errors: traj?.errors ?? null,
  };
}

// ── stats ───────────────────────────────────────────────────────────────────────────────────────────
const nums = (xs: (number | null)[]) => xs.filter((x): x is number => typeof x === "number" && !Number.isNaN(x));
function stat(xs: (number | null)[]) {
  const v = nums(xs);
  if (!v.length) return { n: 0, mean: null as number | null, sd: null as number | null, min: null as number | null, max: null as number | null };
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  // Sample standard deviation (n-1). With n=2 or 3 this is a very rough estimate — it is here to say
  // "roughly how noisy", not to support a significance claim.
  const sd = v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1)) : 0;
  return { n: v.length, mean: +mean.toFixed(3), sd: +sd.toFixed(3), min: Math.min(...v), max: Math.max(...v) };
}
const fmt = (s: ReturnType<typeof stat>, d = 2) =>
  s.mean === null ? "—" : `${s.mean.toFixed(d)} ±${(s.sd ?? 0).toFixed(d)}`;

// ── main ────────────────────────────────────────────────────────────────────────────────────────────
// Arm INNERMOST so the order is A,B,A,B… — any drift over the sweep hits both arms equally.
const jobs: { taskId: string; trial: number; variant: string }[] = [];
for (const taskId of taskIds) for (let t = 1; t <= TRIALS; t++) for (const variant of ARMS) jobs.push({ taskId, trial: t, variant });

log(`${taskIds.length} fixture(s) × ${TRIALS} trial(s) = ${jobs.length} runs · author=${AUTHOR} · concurrency=${CONCURRENCY}`);
// A premise run is ~15 min with the LLM author (it adds a model round-trip per conversational turn), so a
// full 3×3 sweep is a couple of hours sequentially. Say so up front rather than letting it be a surprise.
log(`~15 min per run → rough estimate ${Math.round((jobs.length * 15) / CONCURRENCY)} min`);
const started = Date.now();
const results: Trial[] = [];
let cursor = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  for (;;) {
    const i = cursor++;
    if (i >= jobs.length) return;
    const { taskId, trial, variant } = jobs[i];
    results.push(await runOne(taskId, trial, variant).catch((e) => ({
      taskId, trial, variant, bookId: null, stopReason: null, gate: null, checksPassed: null, checksTotal: null,
      loglineMean: null, premiseMean: null, turns: null, aiCalls: null, reads: null, cacheReadRatio: null,
      errors: null, wallClockMs: null, pushes: null, fallbacks: null, nudges: null, failure: String(e),
    })));
  }
}));
results.sort((a, b) => a.taskId.localeCompare(b.taskId) || a.trial - b.trial || a.variant.localeCompare(b.variant));

// Per-ARM roll-up — the actual A/B read. `pushes` is the convergence metric: how often the scripted author
// had to DEMAND the artifact rather than the agent deciding it was done.
const perVariant = ARMS.map((variant) => {
  const rs = results.filter((r) => r.variant === variant && !r.failure);
  return {
    variant: variant || "(production)",
    trials: rs.length,
    gateRate: rs.length ? +(rs.filter((r) => r.gate).length / rs.length).toFixed(2) : null,
    pushes: stat(rs.map((r) => r.pushes)),
    logline: stat(rs.map((r) => r.loglineMean)),
    premise: stat(rs.map((r) => r.premiseMean)),
    wallClockMs: stat(rs.map((r) => r.wallClockMs)),
    aiCalls: stat(rs.map((r) => r.aiCalls)),
  };
});

const perTask = taskIds.map((taskId) => {
  const rs = results.filter((r) => r.taskId === taskId);
  const graded = rs.filter((r) => !r.failure);
  return {
    taskId,
    trials: rs.length,
    failures: rs.filter((r) => r.failure).length,
    gateRate: graded.length ? +(graded.filter((r) => r.gate).length / graded.length).toFixed(2) : null,
    checks: stat(graded.map((r) => (r.checksTotal ? (r.checksPassed ?? 0) / r.checksTotal : null))),
    logline: stat(graded.map((r) => r.loglineMean)),
    premise: stat(graded.map((r) => r.premiseMean)),
    aiCalls: stat(graded.map((r) => r.aiCalls)),
    reads: stat(graded.map((r) => r.reads)),
    cacheReadRatio: stat(graded.map((r) => r.cacheReadRatio)),
    pushes: stat(graded.map((r) => r.pushes)),
    fallbacks: stat(graded.map((r) => r.fallbacks)),
    wallClockMs: stat(graded.map((r) => r.wallClockMs)),
  };
});

const report = { label: LABEL, author: AUTHOR, trials: TRIALS, taskIds, arms: ARMS, perVariant, elapsedMs: Date.now() - started, perTask, results };
const out = join(here, `.agent-suite-${LABEL}.json`);
writeFileSync(out, JSON.stringify(report, null, 2));

console.log(`\n── suite "${LABEL}" · author=${AUTHOR} · ${TRIALS} trial(s) · ${Math.round((Date.now() - started) / 1000)}s ──`);
console.log("fixture         gate   checks        logline       premise       ai-calls      pushes    fails");
for (const p of perTask) {
  console.log(
    `${p.taskId.padEnd(15)} ${(p.gateRate === null ? "—" : `${Math.round(p.gateRate * 100)}%`).padEnd(6)} ` +
    `${fmt(p.checks).padEnd(13)} ${fmt(p.logline).padEnd(13)} ${fmt(p.premise).padEnd(13)} ` +
    `${fmt(p.aiCalls, 1).padEnd(13)} ${fmt(p.pushes, 1).padEnd(9)} ${p.failures}`,
  );
}
if (ARMS.length > 1) {
  console.log(`\n── A/B by arm (interleaved) ──`);
  console.log(`${"arm".padEnd(18)} ${"n".padStart(3)} ${"gate".padStart(5)} ${"pushes".padStart(12)} ${"logline".padStart(12)} ${"premise".padStart(12)}`);
  for (const v of perVariant) {
    const f = (x: { mean: number | null; sd: number | null } | null) =>
      x?.mean == null ? "—".padStart(12) : `${x.mean.toFixed(2)}±${(x.sd ?? 0).toFixed(2)}`.padStart(12);
    console.log(`${v.variant.padEnd(18)} ${String(v.trials).padStart(3)} ${String(v.gateRate ?? "—").padStart(5)} ${f(v.pushes)} ${f(v.logline)} ${f(v.premise)}`);
  }
  console.log(`\nLower \`pushes\` = the agent converged on its own rather than being told to.`);
  console.log(`Read the ±sd before the means: if the spread overlaps, the arms are not distinguishable at this n.`);
}
console.log(`\nmean ±sd across trials. With ${TRIALS} trials the sd is indicative only — it says how noisy,`);
console.log(`not whether a difference is real. A gap smaller than the sd is not a result.`);
for (const r of results.filter((x) => x.failure)) console.log(`  ✗ ${r.taskId} trial ${r.trial}: ${r.failure}`);
console.log(`\nwrote ${out}`);
