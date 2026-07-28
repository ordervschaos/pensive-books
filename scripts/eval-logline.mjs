#!/usr/bin/env node
// eval-logline — single-turn eval of the brief → logline forge (knowledgebase/agents/eval.md applied).
//
// System under test: the DEPLOYED dna-expand edge fn, target:"logline" — the real production path
// (real prompt bytes, real provider via the ai_provider switch, logged to ai_calls). No local prompt
// mirror (see project memory: eval-bridge drift). Grading combines:
//   • code-based graders — shape checks (≤2 sentences, no label/quotes/JSON, not a verbatim restate)
//     + per-task must_mention / must_avoid regexes (distinctive-element survival)
//   • model-based grader — the DEPLOYED read-logline judge (LOGLINE_CRAFT axes, 1–5 each)
//   • tracked metrics — tokens/latency/provider read back from ai_calls via the returned callId
// A trial passes only if ALL graders pass (binary scoring); axis scores give the partial-credit view.
//
//   node scripts/eval-logline.mjs                  # all tasks, 2 trials each
//   node scripts/eval-logline.mjs --trials 3       # more trials (pass@1 vs pass^k spread)
//   node scripts/eval-logline.mjs --refs           # grade the REFERENCE solutions instead (no generation):
//                                                  #   validates tasks are solvable + graders are fair
//   node scripts/eval-logline.mjs --only memory-tax --keep
//
// Transcripts → scripts/.eval-logline.jsonl ; report → scripts/.eval-logline-report.md (both gitignored).
// Scratch books are created per task (owner = dev user) and deleted at the end unless --keep.
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const env = Object.fromEntries(
  readFileSync(join(repoRoot, ".env.local"), "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const SUPABASE_URL = `https://${env.VITE_SUPABASE_PROJECT_ID}.supabase.co`;
const SR = env.SERVICE_ROLE_SECRET;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const sb = { apikey: SR, Authorization: `Bearer ${SR}` };
const OWNER = "91f66fef-e7f0-455d-833e-080fd65d8aed"; // the dev user (same as dna-short-story.mjs)

const args = process.argv.slice(2);
const argVal = (f, d) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : d; };
const TRIALS = Number(argVal("--trials", 2));
const REFS = args.includes("--refs");
const KEEP = args.includes("--keep");
const ONLY = argVal("--only", null);

const OUT_JSONL = join(here, ".eval-logline.jsonl");
const OUT_MD = join(here, ".eval-logline-report.md");
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const suite = JSON.parse(readFileSync(join(here, "eval-logline-tasks.json"), "utf8"));
let tasks = suite.tasks;
if (ONLY) tasks = tasks.filter((t) => t.id === ONLY);
if (!tasks.length) { console.error(`no tasks match --only ${ONLY}`); process.exit(1); }

const rest = async (path, opts = {}) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { ...sb, "content-type": "application/json", Prefer: "return=representation", ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(`REST ${path}: ${r.status} ${await r.text()}`);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
};

// ── Auth: mint a REAL user session (admin generate_link → verify), so the edge fns run their normal
// user-auth + RLS path — the eval exercises production auth, not a service-role side door. ───────────
async function mintUserJwt() {
  const u = await (await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${OWNER}`, { headers: sb })).json();
  if (!u?.email) throw new Error(`dev user ${OWNER} not found: ${JSON.stringify(u).slice(0, 200)}`);
  const linkRes = await (await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: "POST", headers: { ...sb, "content-type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email: u.email }),
  })).json();
  const tokenHash = linkRes.hashed_token ?? linkRes.properties?.hashed_token;
  if (!tokenHash) throw new Error(`generate_link failed: ${JSON.stringify(linkRes).slice(0, 300)}`);
  const session = await (await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: "POST", headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ type: "magiclink", token_hash: tokenHash }),
  })).json();
  if (!session.access_token) throw new Error(`verify failed: ${JSON.stringify(session).slice(0, 300)}`);
  return session.access_token;
}

const fnCall = async (jwt, fn, body, timeoutMs = 180_000) => {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw new Error(`${fn}: ${r.status} ${data.error ?? JSON.stringify(data).slice(0, 200)}`);
  return data;
};

// ── Environment setup: one scratch book + empty seed node per task. dna-expand's logline branch only
// READS (the client normally writes the result), so trials share the book without contaminating state. ──
async function setupBook(task) {
  const [book] = await rest("books", {
    method: "POST",
    body: JSON.stringify({ name: `[eval] logline — ${task.id}`, owner_id: OWNER, brief: task.brief, is_public: false }),
  });
  const seed = { id: randomUUID(), book_id: book.id, parent_id: null, level: 0, kind: "seed", position: 0, content: {}, authoring: { source: "user" } };
  await rest("book_nodes", { method: "POST", body: JSON.stringify([seed]) });
  return { bookId: book.id, seedId: seed.id };
}

// ── Code-based graders — grade the OUTPUT, not the path; each assertion stays loose enough that a
// valid creative logline can't fail it (avoid the brittleness the eval doc warns about). ─────────────
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
function deterministicChecks(logline, task) {
  const checks = [];
  const add = (name, pass, detail = "") => checks.push({ name, pass, detail });
  const t = logline.trim();
  add("nonempty", t.length > 0);
  const sentences = t.split(/(?<=[.!?])\s+(?=[A-Z"“])/).filter((s) => s.trim().length > 1);
  add("max_two_sentences", sentences.length <= 2, `${sentences.length} sentences`);
  const words = t.split(/\s+/).length;
  add("word_budget", words <= 80, `${words} words`);
  add("no_label", !/^\s*(logline|premise|title)\s*[:—–-]/i.test(t));
  add("no_wrapper_quotes", !(/^["“]/.test(t) && /["”]$/.test(t)));
  add("no_json_or_fence", !/^[{[`]/.test(t));
  // "Do NOT restate the raw idea verbatim" — the idea's normalized text must not appear wholesale,
  // and near-total token overlap (Jaccard ≥ .85) also counts as a restate.
  const idea = norm(task.brief.idea ?? "");
  const out = norm(t);
  const ideaTokens = new Set(idea.split(" ")), outTokens = new Set(out.split(" "));
  const inter = [...ideaTokens].filter((w) => outTokens.has(w)).length;
  const jaccard = inter / (ideaTokens.size + outTokens.size - inter || 1);
  add("not_verbatim_restate", !(idea.length > 20 && out.includes(idea)) && jaccard < 0.85, `jaccard=${jaccard.toFixed(2)}`);
  for (const re of task.must_mention ?? []) add(`must_mention:${re}`, new RegExp(re, "i").test(t));
  for (const re of task.must_avoid ?? []) add(`must_avoid:${re}`, !new RegExp(re, "i").test(t));
  return checks;
}

// ── Model-based grader: the production judge. Pass = all 4 axes returned, every axis ≥ 3, mean ≥ 3.5. ──
const JUDGE_AXES = 4;
async function judgeChecks(jwt, bookId, logline) {
  const { brief_fit } = await fnCall(jwt, "read-logline", { bookId, input: { logline } });
  const axes = brief_fit ?? [];
  const mean = axes.length ? axes.reduce((s, a) => s + a.score, 0) / axes.length : 0;
  const complete = axes.length === JUDGE_AXES;
  const allOk = complete && axes.every((a) => a.score >= 3);
  return {
    axes, mean: Number(mean.toFixed(2)), complete,
    pass: allOk && mean >= 3.5,
    detail: complete ? axes.map((a) => `${a.axis}=${a.score}`).join(" ") : `judge_incomplete (${axes.length}/${JUDGE_AXES} axes)`,
  };
}

async function metricsFor(callId) {
  if (!callId) return null;
  const rows = await rest(`ai_calls?id=eq.${callId}&select=model,provider,input_tokens,output_tokens,latency_ms,stop_reason,status`);
  return rows?.[0] ?? null;
}

// Retry helper — reasoning-model calls are non-deterministic: dna-expand can return an empty logline
// (reasoning overran max_tokens) and the judge can emit malformed JSON. Neither is a quality signal, so
// the harness self-heals with a few attempts before counting a real result (eval doc: handle non-determinism).
async function retry(label, fn, attempts = 3) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try {
      const v = await fn();
      if (v != null) return v;
    } catch (e) { last = e; }
    if (i < attempts) log(`  ${label}: attempt ${i} failed${last ? ` (${String(last.message).slice(0, 80)})` : " (empty)"} — retrying`);
  }
  if (last) throw last;
  return null;
}

async function runTrial(jwt, task, envRef, trialIdx) {
  const t0 = Date.now();
  let logline, callId = null, metrics = null;
  if (REFS) {
    logline = task.reference;
  } else {
    const res = await retry("generate", async () => {
      const r = await fnCall(jwt, "dna-expand", { bookId: envRef.bookId, nodeId: envRef.seedId, target: "logline" });
      const text = (r.logline ?? "").trim();
      return text ? { text, callId: r.callId ?? null } : null; // empty → retry
    });
    logline = res.text;
    callId = res.callId;
    metrics = await metricsFor(callId).catch(() => null);
  }
  const det = deterministicChecks(logline, task);
  const judge = await retry("judge", () => judgeChecks(jwt, envRef.bookId, logline));
  const detPass = det.every((c) => c.pass);
  const trial = {
    task: task.id, trial: trialIdx, mode: REFS ? "reference" : "generated",
    logline, pass: detPass && judge.pass, det_pass: detPass, judge_pass: judge.pass,
    checks: det.filter((c) => !c.pass).map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ""}`),
    judge, callId, metrics, wall_ms: Date.now() - t0,
  };
  appendFileSync(OUT_JSONL, JSON.stringify(trial) + "\n");
  log(`${task.id} #${trialIdx}: ${trial.pass ? "PASS" : "FAIL"} — judge ${judge.detail}${trial.checks.length ? ` — failed: ${trial.checks.join(", ")}` : ""}`);
  return trial;
}

// ── Main ─────────────────────────────────────────────────────────────────────────────────────────────
const trialsPerTask = REFS ? 1 : TRIALS;
log(`${REFS ? "REFERENCE" : "LIVE"} run: ${tasks.length} tasks × ${trialsPerTask} trial(s) = ${tasks.length * trialsPerTask * (REFS ? 1 : 2)} LLM calls (gen + judge)`);
const jwt = await mintUserJwt();
log(`minted user session for dev user`);
appendFileSync(OUT_JSONL, JSON.stringify({ run_started: new Date().toISOString(), mode: REFS ? "refs" : "live", trials: trialsPerTask }) + "\n");

const createdBooks = [];
const results = [];
// Small pool (3 tasks in flight) — kind to the edge worker, still ~3× faster than serial.
const queue = [...tasks];
await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
  for (let task = queue.shift(); task; task = queue.shift()) {
    try {
      const envRef = await setupBook(task);
      createdBooks.push(envRef.bookId);
      const trials = [];
      for (let i = 1; i <= trialsPerTask; i++) trials.push(await runTrial(jwt, task, envRef, i));
      results.push({ task, trials });
    } catch (e) {
      log(`${task.id}: ERROR ${e.message}`);
      results.push({ task, trials: [], error: String(e.message) });
    }
  }
}));

// ── Aggregate: pass@1 (per-trial success rate) + pass^k (all trials pass) per task. ─────────────────
const rows = results.map(({ task, trials, error }) => {
  const n = trials.length;
  const passes = trials.filter((t) => t.pass).length;
  const meanAxis = n ? (trials.reduce((s, t) => s + t.judge.mean, 0) / n).toFixed(2) : "—";
  const tokens = trials.map((t) => t.metrics?.output_tokens).filter((x) => x != null);
  return {
    id: task.id, error,
    pass1: n ? (passes / n).toFixed(2) : "—",
    passK: n ? (passes === n ? "✓" : "✗") : "—",
    meanAxis,
    outTok: tokens.length ? Math.round(tokens.reduce((a, b) => a + b, 0) / tokens.length) : null,
    latency: trials[0]?.metrics?.latency_ms ?? null,
  };
});
const overall = results.flatMap((r) => r.trials);
const overallPass1 = overall.length ? (overall.filter((t) => t.pass).length / overall.length) : 0;

const md = [];
md.push(`# Logline eval — ${REFS ? "reference-solution check" : "live run"} (${new Date().toISOString().slice(0, 16)})`);
md.push(`\nSystem under test: deployed \`dna-expand\` target=logline · judge: deployed \`read-logline\` · ${trialsPerTask} trial(s)/task`);
md.push(`\n**Overall pass@1: ${(overallPass1 * 100).toFixed(0)}%** (${overall.filter((t) => t.pass).length}/${overall.length} trials)\n`);
md.push(`| task | pass@1 | pass^${trialsPerTask} | mean axis | out tokens | latency ms |`);
md.push(`|---|---|---|---|---|---|`);
for (const r of rows) md.push(`| ${r.id}${r.error ? " ⚠️" : ""} | ${r.pass1} | ${r.passK} | ${r.meanAxis} | ${r.outTok ?? "—"} | ${r.latency ?? "—"} |`);
md.push(`\n## Transcripts (read these — the eval doc's step 6)\n`);
for (const { task, trials, error } of results) {
  md.push(`### ${task.id}${error ? ` — ERROR: ${error}` : ""}`);
  for (const t of trials) {
    md.push(`- **#${t.trial} ${t.pass ? "PASS" : "FAIL"}** — ${t.judge.detail}${t.checks.length ? ` — failed checks: ${t.checks.join(", ")}` : ""}`);
    md.push(`  > ${t.logline.replace(/\n/g, " ")}`);
    for (const a of t.judge.axes ?? []) if (a.note) md.push(`  - ${a.axis} ${a.score}: ${a.note}`);
  }
  md.push("");
}
writeFileSync(OUT_MD, md.join("\n"));
log(`report → ${OUT_MD}`);
console.log("\n" + md.slice(0, 5 + rows.length).join("\n"));

if (!KEEP && createdBooks.length) {
  for (const id of createdBooks) {
    await rest(`book_nodes?book_id=eq.${id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    await rest(`books?id=eq.${id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  }
  log(`cleaned up ${createdBooks.length} scratch books`);
} else if (createdBooks.length) {
  log(`kept scratch books: ${createdBooks.join(", ")}`);
}
