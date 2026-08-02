// eval-premise — grades a premise-rung run. Three grader families, mirroring eval-logline.mjs's structure
// (deterministic + model judge + tracked metrics) and adding the one it lacks: TRAJECTORY.
//
//   A · deterministic — did it get there? gate reached, sub-steps done, required fields present,
//       must_mention/must_avoid over the produced logline + dramatic question, logline shape checks.
//   B · trajectory    — HOW it got there: turns, step histogram, read round-trips per turn, author
//       questions, tokens, cache-read ratio, latency, errors. Read from ai_calls + book_agent_runs, which
//       already log every call. This is the family nothing else in the repo covers.
//   C · model judges  — the DEPLOYED read-logline + read-premise functions, using the app's OWN input
//       builders (buildBriefFitInput / buildLoglineFitInput) so the judge sees exactly what the UI sends.
//
//   pnpm dna:grade --book 1343 --task thin-brief        # grade a completed run
//   pnpm dna:grade --task thin-brief --refs --book 1343 # grade the REFERENCE answers instead
//   pnpm dna:grade --book 1343 --task thin-brief --no-judges   # A + B only (free, no AI calls)
//
// --refs is the CALIBRATION run: reference answers are known-good, so they must pass every grader. If they
// don't, the task or the graders are broken — and any verdict from a real run is meaningless. Run it once
// per fixture before trusting a single number.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { supabase } from "@/integrations/supabase/client";
import { buildBriefFitInput, buildLoglineFitInput, type DnaNode } from "@/features/dna/lib/novelDna";
import { errText, ladder, loadBrief, loadNodes, loadThread, premiseProgress } from "./harness/thread.ts";
import { rest } from "./harness/env.ts";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argVal = (f: string, d?: string) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : d; };
const BOOK = Number(argVal("--book", "0"));
const TASK_ID = argVal("--task");
const REFS = args.includes("--refs");
const NO_JUDGES = args.includes("--no-judges");
if (!BOOK) throw new Error("usage: pnpm dna:grade --book <id> [--task <id>] [--refs] [--no-judges]");

interface Task {
  id: string;
  must_mention?: string[];
  must_avoid?: string[];
  reference?: { logline?: string; dramatic_question?: string };
}
const task: Task | null = TASK_ID
  ? (JSON.parse(readFileSync(join(here, "eval-premise-tasks.json"), "utf8")) as { tasks: Task[] })
      .tasks.find((t) => t.id === TASK_ID) ?? null
  : null;
if (TASK_ID && !task) throw new Error(`no task '${TASK_ID}'`);
if (REFS && !task?.reference) throw new Error("--refs needs a task with a `reference` block");

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "n/a");

// ── A · deterministic ───────────────────────────────────────────────────────────────────────────────
function shapeChecks(logline: string) {
  const sentences = logline.split(/[.!?]+(?:\s|$)/).filter((s) => s.trim()).length;
  return [
    { check: "logline_present", pass: !!logline.trim() },
    { check: "logline_max_2_sentences", pass: sentences <= 2, detail: `${sentences} sentence(s)` },
    { check: "logline_no_label_prefix", pass: !/^\s*(logline|premise)\s*[:\-—]/i.test(logline) },
    { check: "logline_not_quoted", pass: !/^\s*["'`]/.test(logline) },
    { check: "logline_not_json", pass: !/^\s*[{[]/.test(logline) },
  ];
}

function deterministic(logline: string, question: string, nodes: DnaNode[], brief: unknown) {
  const progress = premiseProgress(nodes, brief);
  const text = `${logline}\n${question}`;
  const checks = [
    ...shapeChecks(logline),
    { check: "dramatic_question_present", pass: !!question.trim() },
    ...(task?.must_mention ?? []).map((p) => ({ check: `must_mention /${p}/`, pass: new RegExp(p, "i").test(text) })),
    ...(task?.must_avoid ?? []).map((p) => ({ check: `must_avoid /${p}/`, pass: !new RegExp(p, "i").test(text) })),
  ];
  // In --refs mode the graded text is the fixture's reference, not the tree's content — so the tree-derived
  // gate and sub-steps say nothing about it. Report them as n/a rather than printing a "not reached" that
  // reads as a reference failure.
  return {
    gate: REFS ? null : progress.complete,
    substeps: REFS ? null : progress.substeps,
    checks, passed: checks.every((c) => c.pass),
  };
}

// ── B · trajectory ──────────────────────────────────────────────────────────────────────────────────
interface AiCall {
  fn: string; model: string | null; provider: string | null; status: string; error: string | null;
  input_tokens: number | null; output_tokens: number | null;
  cache_read_tokens: number | null; cache_write_tokens: number | null; latency_ms: number | null;
}

async function trajectory(bookId: number) {
  const row = await loadThread(bookId);
  const calls = await rest<AiCall[]>(
    `ai_calls?book_id=eq.${bookId}&select=fn,model,provider,status,error,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,latency_ms&order=id.asc`,
  );
  const steps = row?.steps ?? [];
  const hist: Record<string, number> = {};
  for (const s of steps) hist[s.t] = (hist[s.t] ?? 0) + 1;

  const sum = (k: keyof AiCall) => calls.reduce((a, c) => a + (Number(c[k]) || 0), 0);
  const input = sum("input_tokens"), cacheRead = sum("cache_read_tokens");
  const turns = row?.turns ?? 0;

  return {
    turns,
    steps: steps.length,
    stepHistogram: hist,
    reads: hist.read ?? 0,
    // Now #1's bar. NB `book_agent_runs.turns` counts turns for the CURRENT user message, not the whole
    // conversation — it resets each time the author speaks. So reads-per-turn is only meaningful on a
    // single-message run; per AI CALL is the stable denominator across a multi-message conversation.
    readsPerTurn: turns ? +(((hist.read ?? 0) / turns).toFixed(2)) : null,
    readsPerAiCall: calls.length ? +(((hist.read ?? 0) / calls.length).toFixed(2)) : null,
    asks: hist.ask ?? 0,
    applied: hist.applied ?? 0,
    discarded: hist.discarded ?? 0,
    aiCalls: calls.length,
    byFn: calls.reduce<Record<string, number>>((a, c) => ({ ...a, [c.fn]: (a[c.fn] ?? 0) + 1 }), {}),
    providers: [...new Set(calls.map((c) => c.provider).filter(Boolean))],
    models: [...new Set(calls.map((c) => c.model).filter(Boolean))],
    inputTokens: input,
    outputTokens: sum("output_tokens"),
    cacheReadTokens: cacheRead,
    cacheWriteTokens: sum("cache_write_tokens"),
    // The other Now #1 bar: cache-read should dominate input on a healthy multi-turn loop.
    cacheReadRatio: input + cacheRead ? +(cacheRead / (input + cacheRead)).toFixed(3) : null,
    totalLatencyMs: sum("latency_ms"),
    errors: calls.filter((c) => c.status === "error" || c.error).length,
    threadStatus: row?.status ?? null,
    threadError: row?.error ?? null,
  };
}

// ── C · model judges (the deployed read-logline / read-premise) ─────────────────────────────────────
async function judge(fn: string, bookId: number, input: unknown) {
  const { data, error } = await supabase.functions.invoke(fn, { body: { bookId, input } });
  if (error) throw new Error(`${fn}: ${errText(error)}`);
  return data as Record<string, { axis: string; score: number; note?: string }[]>;
}

function axisTable(rows: { axis: string; score: number; note?: string }[] | undefined) {
  if (!rows?.length) return { axes: [], mean: null as number | null };
  const mean = +(rows.reduce((a, r) => a + (Number(r.score) || 0), 0) / rows.length).toFixed(2);
  return { axes: rows.map((r) => ({ axis: r.axis, score: r.score, note: r.note })), mean };
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────────
const nodes = await loadNodes(BOOK);
const brief = await loadBrief(BOOK);
const seed = nodes.find((n) => n.kind === "seed");
const premise = nodes.find((n) => n.kind === "premise");

const producedLogline = String((seed?.content as { logline?: string })?.logline ?? "");
const producedQuestion = String((premise?.content as { dramatic_question?: string })?.dramatic_question ?? "");
const logline = REFS ? task!.reference!.logline ?? "" : producedLogline;
const question = REFS ? task!.reference!.dramatic_question ?? "" : producedQuestion;

const det = deterministic(logline, question, nodes, brief);
const traj = await trajectory(BOOK);

let judges: Record<string, unknown> = {};
if (!NO_JUDGES) {
  try {
    // Reuse the app's OWN builders so the judge sees exactly the payload the UI sends. In --refs mode the
    // reference text is spliced over the produced one so the SAME judge grades the known-good answer.
    const briefInput = buildBriefFitInput(nodes) ?? {};
    const loglineInput = buildLoglineFitInput(nodes) ?? {};
    const bi = REFS ? { ...briefInput, logline } : briefInput;
    const li = REFS ? { ...loglineInput, logline, dramatic_question: question } : loglineInput;
    const [lj, pj] = await Promise.all([
      judge("read-logline", BOOK, bi).catch((e) => ({ __error: errText(e) })),
      judge("read-premise", BOOK, li).catch((e) => ({ __error: errText(e) })),
    ]);
    judges = {
      logline: (lj as { __error?: string }).__error ?? axisTable((lj as { brief_fit?: never[] }).brief_fit),
      premise: (pj as { __error?: string }).__error ?? axisTable((pj as { premise_fit?: never[] }).premise_fit),
    };
  } catch (e) {
    judges = { error: errText(e) };
  }
}

const report = { bookId: BOOK, taskId: task?.id ?? null, mode: REFS ? "refs" : "run", ladder: ladder(nodes), logline, dramatic_question: question, deterministic: det, trajectory: traj, judges };

console.log(`\n── premise eval · book ${BOOK}${task ? ` · task ${task.id}` : ""}${REFS ? " · REFERENCE ANSWERS" : ""} ──`);
console.log(`logline:  ${logline || "(none)"}`);
console.log(`question: ${question || "(none)"}`);
const gateLabel = REFS ? "gate n/a (grading reference text)" : det.gate ? "gate REACHED" : "gate not reached";
console.log(`\nA · deterministic — ${gateLabel}, ${det.checks.filter((c) => c.pass).length}/${det.checks.length} checks`);
for (const c of det.checks) console.log(`   ${c.pass ? "✓" : "✗"} ${c.check}${c.detail ? ` (${c.detail})` : ""}`);
console.log(`\nB · trajectory${REFS ? " (the book's own run — not attributable to the reference text)" : ""} — ${traj.turns} turns · ${traj.aiCalls} ai calls · ${traj.errors} errors`);
console.log(`   reads ${traj.reads} (${traj.readsPerAiCall ?? "n/a"}/ai-call · ${traj.readsPerTurn ?? "n/a"}/turn, turns reset per user msg) · asks ${traj.asks} · applied ${traj.applied} · discarded ${traj.discarded}`);
console.log(`   tokens in ${traj.inputTokens} / out ${traj.outputTokens} · cache-read ${traj.cacheReadTokens} (${pct(traj.cacheReadTokens, traj.inputTokens + traj.cacheReadTokens)} of prefill)`);
console.log(`   providers ${traj.providers.join(",") || "n/a"} · ${Math.round(traj.totalLatencyMs / 1000)}s of model time`);
if (!NO_JUDGES) console.log(`\nC · judges — ${JSON.stringify(judges, null, 2).slice(0, 1500)}`);

const out = join(here, `.agent-eval-${BOOK}${REFS ? "-refs" : ""}.json`);
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`\nwrote ${out}`);
