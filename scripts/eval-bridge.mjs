#!/usr/bin/env node
// Local bridge between the web UI and Claude Code. The browser can't run a CLI,
// so this tiny server does it: routes AI calls to `claude -p` (headless Claude Code)
// instead of the Anthropic API, costing nothing extra on a CC subscription.
//
//   node scripts/eval-bridge.mjs            # listens on http://localhost:8787
//
//   GET  /eval/:bookId      -> existing report  { status: 'done'|'none', result? }
//   POST /eval/:bookId      -> run evaluation   { status: 'done'|'error', result?, error? }
//   POST /spine-to-objectives/:bookId -> outline { structure, pages[] } | { error }
//   POST /beat-to-prose      -> render prose      { text } | { error }
//   POST /revise-prose       -> revise prose      { text } | { error }
//
// Env:
//   EVAL_BRIDGE_PORT   default 8787
//   EVAL_CLAUDE_FLAGS  default "--dangerously-skip-permissions"
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const reportsDir = join(repoRoot, "reports");
const PORT = Number(process.env.EVAL_BRIDGE_PORT || 8787);
const CLAUDE_FLAGS = (process.env.EVAL_CLAUDE_FLAGS || "--dangerously-skip-permissions").split(" ").filter(Boolean);
// `claude -p` latency on the CC subscription is congestion-bound and wildly variable (2–21 min,
// occasionally a dropped socket). Past this many ms we kill the child and fail fast so the caller
// can retry/re-roll instead of stranding (and never leave a zombie 'running' ai_calls row). 0 = off.
const CLAUDE_TIMEOUT_MS = Number(process.env.EVAL_CLAUDE_TIMEOUT_MS ?? 6 * 60 * 1000);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization",
};
const json = (res, code, body) =>
  res.writeHead(code, { ...cors, "content-type": "application/json" }).end(JSON.stringify(body));

// ── Env + Supabase REST ───────────────────────────────────────────────────────
const envVars = Object.fromEntries(
  readFileSync(join(repoRoot, ".env.local"), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const SUPABASE_URL = `https://${envVars.VITE_SUPABASE_PROJECT_ID}.supabase.co`;
const SUPABASE_KEY = envVars.SERVICE_ROLE_SECRET;
const ANON_KEY = envVars.VITE_SUPABASE_ANON_KEY;

const sbHeaders = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

// ── Authorization ─────────────────────────────────────────────────────────────
// The bridge writes with the service role (bypasses RLS), and it listens on localhost with CORS '*'
// — so without a check, ANY caller (including a malicious site open in the same browser) could run
// AI + write rows for ANY book. We close that by requiring the caller to prove they can edit THIS
// book, using the SAME predicate the edge functions use: the client forwards its Supabase access
// token (see apps/web/src/lib/bridge.ts), and we call user_can_edit_book() AS that user. Running the
// RPC under the user's JWT (anon key + their bearer) resolves auth.uid() correctly; an invalid or
// missing token can't satisfy the predicate, so it's denied. This is true parity with prod.
function bearerToken(req) {
  const h = req.headers.authorization || req.headers.Authorization;
  const m = h && String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

async function userCanEditBook(token, bookId) {
  if (!token || !ANON_KEY) return false;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/user_can_edit_book`, {
    method: "POST",
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ _book_id: bookId }),
  });
  if (!r.ok) return false;
  return (await r.json()) === true;
}

// Gate a handler: returns true if the caller may edit `bookId`, else writes a 403 and returns false.
async function authorize(req, res, bookId) {
  const ok = await userCanEditBook(bearerToken(req), bookId);
  if (!ok) {
    json(res, 403, { error: "Not authorized to edit this book." });
    return false;
  }
  return true;
}

async function fetchBook(bookId) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/books?id=eq.${bookId}&select=name%2Cbrief%2Cbible%2Cspine`,
    { headers: sbHeaders }
  );
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  const rows = await r.json();
  return rows?.[0] ?? null;
}

// All non-archived pages in order — for the objective map, preceding prose, story so far.
async function fetchPages(bookId) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/pages?book_id=eq.${bookId}&archived=eq.false&select=id,page_index,page_type,title,content,metadata&order=page_index.asc`,
    { headers: sbHeaders }
  );
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return await r.json();
}

// Persist a completed evaluation to book_evaluations — the same table the edge function
// writes — so a local-bridge run shows up in the UI exactly like a prod run (the client reads
// evaluations from the table in both modes now; the bridge differs only in *where the AI runs*).
// created_by is left null (the bridge has no auth user); the service role bypasses RLS.
// Insert a 'pending' book_evaluations row BEFORE the (slow) local eval runs, so a refresh mid-run
// finds it and resumes the loader — matching the edge function's insert-pending-first pattern.
// Returns the new row's id (or null on failure; the eval still runs, just not refresh-durable).
async function startEvaluation(bookId) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/book_evaluations`, {
    method: "POST",
    headers: { ...sbHeaders, "content-type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ book_id: bookId, kind: "fiction", model: "claude-code-local", status: "pending" }),
  });
  if (!r.ok) { console.error(`bridge eval: couldn't create pending row: ${r.status} ${await r.text()}`); return null; }
  const rows = await r.json();
  return rows?.[0]?.id ?? null;
}

// Flip the pending row to its terminal state. The UPDATE fires Realtime, so a watching/refreshed
// client learns the result without polling (book_evaluations is in the realtime publication).
async function finishEvaluation(id, patch) {
  await fetch(`${SUPABASE_URL}/rest/v1/book_evaluations?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...sbHeaders, "content-type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
}

// Fallback for when no pending row was created (couldn't insert up front): write a done row so the
// report still lands in the table.
async function persistEvaluation(bookId, result) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/book_evaluations`, {
    method: "POST",
    headers: { ...sbHeaders, "content-type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ book_id: bookId, kind: "fiction", model: "claude-code-local", status: "done", result }),
  });
  if (!r.ok) return { error: `Supabase ${r.status}: ${await r.text()}` };
  const rows = await r.json();
  return { row: rows?.[0] ?? null };
}

// ── book_generations parity ─────────────────────────────────────────────────
// The web UI now watches a book_generations task row for scaffold/bible/page generation (so a
// refresh resumes the loader / proposal). The bridge writes the SAME rows — insert 'running',
// then update 'ready'/'error' when local Claude Code finishes — so dev behaves identically to prod.
// created_by is left null (the bridge has no auth user); the service role bypasses RLS.
async function insertGeneration(bookId, fields) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/book_generations`, {
    method: "POST",
    headers: { ...sbHeaders, "content-type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ book_id: bookId, status: "running", ...fields }),
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return (await r.json())?.[0] ?? null;
}

async function updateGeneration(id, patch) {
  await fetch(`${SUPABASE_URL}/rest/v1/book_generations?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...sbHeaders, "content-type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
}

// Run a generation `work()` against a freshly-inserted row, writing the terminal state. Mirrors the
// edge functions' runInBackground, minus the background (the bridge has no wall-clock cap).
async function runGeneration(bookId, fields, work) {
  const row = await insertGeneration(bookId, fields);
  if (!row) return { error: "could not create generation row" };
  try {
    const patch = await work();
    await updateGeneration(row.id, patch);
    return { generation: { ...row, ...patch } };
  } catch (e) {
    await updateGeneration(row.id, { status: "error", error: String(e?.message ?? e).slice(0, 1000) });
    return { error: String(e?.message ?? e) };
  }
}

// Merge a summary into a page's metadata (preserving objective), via REST PATCH.
async function persistSummary(pageId, summary) {
  const g = await fetch(`${SUPABASE_URL}/rest/v1/pages?id=eq.${pageId}&select=metadata`, { headers: sbHeaders });
  const cur = (await g.json())?.[0]?.metadata ?? {};
  await fetch(`${SUPABASE_URL}/rest/v1/pages?id=eq.${pageId}`, {
    method: "PATCH",
    headers: { ...sbHeaders, "content-type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ metadata: { ...cur, summary } }),
  });
}

function tiptapToText(node) {
  if (!node || typeof node !== "object") return "";
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  let out = "";
  for (const child of node.content ?? []) out += tiptapToText(child);
  if (["paragraph", "heading", "blockquote", "listItem", "codeBlock"].includes(node.type)) out += "\n\n";
  return out;
}

// buildDoc — port of supabase/functions/_shared/build-doc.ts: prose (with inline *italic*/**bold**)
// → a TipTap doc (leading h1 title + paragraphs). Used by the auto-revise loop to write revised pages
// (in dev the bridge writes pages itself, since there's no per-page client in the loop).
function inlineMarkdownToNodes(text) {
  const nodes = [];
  const re = /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push({ type: "text", text: text.slice(last, m.index) });
    if (m[1]) nodes.push({ type: "text", text: m[2], marks: [{ type: "bold" }] });
    else nodes.push({ type: "text", text: m[4], marks: [{ type: "italic" }] });
    last = re.lastIndex;
  }
  if (last < text.length) nodes.push({ type: "text", text: text.slice(last) });
  return nodes.filter((n) => n.text.length > 0);
}

function buildDoc(title, prose) {
  const paras = prose.split(/\n{2,}/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean)
    .map((p) => { const content = inlineMarkdownToNodes(p); return content.length ? { type: "paragraph", content } : { type: "paragraph" }; });
  return { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: title ? [{ type: "text", text: title }] : [] }, ...paras] };
}

async function writePageContent(pageId, title, text) {
  await fetch(`${SUPABASE_URL}/rest/v1/pages?id=eq.${pageId}`, {
    method: "PATCH",
    headers: { ...sbHeaders, "content-type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ content: buildDoc(title, text) }),
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
  });
}

// Cache book_id → owner_id so we only look it up once per bridge session.
const bookOwnerCache = new Map();
async function getBookOwner(bookId) {
  if (!bookId) return null;
  if (bookOwnerCache.has(bookId)) return bookOwnerCache.get(bookId);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/books?id=eq.${bookId}&select=owner_id`, { headers: sbHeaders });
    const rows = await res.json().catch(() => []);
    const ownerId = Array.isArray(rows) && rows[0]?.owner_id ? rows[0].owner_id : null;
    bookOwnerCache.set(bookId, ownerId);
    return ownerId;
  } catch {
    return null;
  }
}

// Log one AI call to ai_calls (source='bridge') so local Claude-Code runs are analyzable alongside
// prod's edge calls. The bridge bakes the system prompt into the user message, so `system` stays
// null and the assembled prompt goes in `input` (same messages shape the edge rows use). Best-effort
// — a logging failure must never break the bridge response. Links to a task row are omitted here
// (dev convenience); prod records the full (task_table, task_id) join.
async function logAiCall({ bookId = null, fn, prompt = null, output = null, error = null, latencyMs = null }) {
  try {
    const userId = await getBookOwner(bookId);
    await fetch(`${SUPABASE_URL}/rest/v1/ai_calls`, {
      method: "POST",
      headers: { ...sbHeaders, "content-type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({
        book_id: bookId,
        user_id: userId,
        fn,
        source: "bridge",
        model: "claude-code-local",
        input: prompt == null ? null : [{ role: "user", content: prompt }],
        output,
        latency_ms: latencyMs,
        error,
        status: error ? "error" : "done",
      }),
    });
  } catch (e) {
    console.error("bridge ai_calls log failed (non-fatal):", e.message);
  }
}

// Insert a 'running' row BEFORE the local claude run, so a long call is visible in /admin while it's
// still going (the bridge otherwise only logs on subprocess close). Returns the row id (or null →
// fall back to a single terminal insert via logAiCall). Best-effort.
async function logAiStart({ bookId = null, fn, prompt = null }) {
  try {
    const userId = await getBookOwner(bookId);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/ai_calls`, {
      method: "POST",
      headers: { ...sbHeaders, "content-type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({
        book_id: bookId,
        user_id: userId,
        fn,
        source: "bridge",
        model: "claude-code-local",
        input: prompt == null ? null : [{ role: "user", content: prompt }],
        status: "running",
      }),
    });
    const rows = await res.json().catch(() => []);
    return Array.isArray(rows) && rows[0]?.id != null ? rows[0].id : null;
  } catch (e) {
    console.error("bridge ai_calls start log failed (non-fatal):", e.message);
    return null;
  }
}

async function logAiEnd(id, { output = null, error = null, latencyMs = null }) {
  if (id == null) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/ai_calls?id=eq.${id}`, {
      method: "PATCH",
      headers: { ...sbHeaders, "content-type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ output, error, latency_ms: latencyMs, status: error ? "error" : "done" }),
    });
  } catch (e) {
    console.error("bridge ai_calls end log failed (non-fatal):", e.message);
  }
}

// ── Claude runner ─────────────────────────────────────────────────────────────
// captureStdout=true: buffer + return stdout as `text`.
// captureStdout=false (eval): just pipe to terminal; result comes from a file.
// `meta` ({ fn, bookId }), when given, logs the call (prompt + output/error + latency) to ai_calls.
// `noTools`: run `claude -p` with the agentic toolset DISABLED (`--tools ""`), so it does a single
// model completion instead of reading the repo / multi-step tool work. The prompt-based generators
// (scaffold, bible, revise-outline, beat-to-prose, summarize) are self-contained "return this answer" prompts — with
// tools on, claude treats them as agentic tasks and can run for many minutes or hang (the cause of
// the 7–30 min replan runs + `exit 1`). The judge and the `/evaluate-book` slash command DO want
// tools (they read the repo), so they leave noTools off.
function runClaude(prompt, captureStdout = false, meta = null, { noTools = false } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    // Insert the 'running' row up front so the call shows in /admin while in flight (the close
    // handler below updates it to done/error). logId is a promise; close() awaits it.
    const logIdP = meta ? logAiStart({ ...meta, prompt }) : Promise.resolve(null);
    const args = ["-p", prompt, ...CLAUDE_FLAGS, ...(noTools ? ["--tools", ""] : [])];
    console.log(`→ claude -p "${prompt.slice(0, 80).replace(/\n/g, " ")}…"`);
    // stdin = /dev/null so `claude -p` gets immediate EOF instead of waiting on an empty pipe
    // ("no stdin data received in 3s…"); the prompt is passed via the -p arg, not stdin.
    const child = spawn("claude", args, { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => {
      if (captureStdout) stdout += d;
      process.stdout.write(d);
    });
    child.stderr.on("data", (d) => (stderr += d));

    // Settle exactly once — a timeout kill triggers 'close' too, so guard against a double-resolve.
    let settled = false;
    const finish = async ({ output = null, error = null }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const latencyMs = Date.now() - started;
      if (meta) {
        const id = await logIdP;
        if (id != null) await logAiEnd(id, { output, error, latencyMs });
        else logAiCall({ ...meta, prompt, output, error, latencyMs }); // start insert didn't land
      }
      resolve(error != null ? { error } : { text: output });
    };

    let timedOut = false;
    const timer = CLAUDE_TIMEOUT_MS > 0
      ? setTimeout(() => {
          timedOut = true;
          console.warn(`✗ claude -p exceeded ${CLAUDE_TIMEOUT_MS / 1000}s — killing`);
          child.kill("SIGTERM");
          setTimeout(() => child.kill("SIGKILL"), 2000).unref?.();
        }, CLAUDE_TIMEOUT_MS)
      : null;
    timer?.unref?.(); // don't keep the bridge alive just for this timer

    child.on("error", (e) => finish({ error: `failed to spawn claude: ${e.message}` }));
    child.on("close", (code) => {
      if (timedOut) return finish({ error: `claude timed out after ${CLAUDE_TIMEOUT_MS / 1000}s` });
      if (code !== 0) return finish({ error: `claude exited ${code}: ${stderr.slice(-500)}` });
      finish({ output: stdout.trim() });
    });
  });
}

// ── Brief helpers (mirrors the edge functions) ────────────────────────────────
function briefContext(brief) {
  if (!brief) return "(no brief set — infer a sensible neutral voice)";
  const lines = [];
  const b = brief.scope?.band;
  const wt = brief.scope?.word_target;
  if (b || wt) lines.push(`- Scope: ${[b, wt ? `≈${wt} words` : null].filter(Boolean).join(" · ")}`);
  if (brief.genre) lines.push(`- Genre: ${brief.genre}`);
  if (brief.audience) lines.push(`- Audience: ${brief.audience}`);
  if (brief.premise) lines.push(`- Premise: ${brief.premise}`);
  if (brief.tone?.length) lines.push(`- Tone: ${brief.tone.join(", ")}`);
  if (brief.success_criteria) lines.push(`- Success looks like: ${brief.success_criteria}`);
  return lines.length ? lines.join("\n") : "(brief is empty — infer a sensible neutral voice)";
}

// ── /eval — existing behaviour ────────────────────────────────────────────────
function loadReport(bookId) {
  const jsonPath = join(reportsDir, `${bookId}-read.json`);
  if (existsSync(jsonPath)) {
    try { return { result: JSON.parse(readFileSync(jsonPath, "utf8")) }; }
    catch (e) { return { error: `bad ${bookId}-read.json: ${e.message}` }; }
  }
  if (!existsSync(reportsDir)) return null;
  const md = readdirSync(reportsDir).find((f) => f.startsWith(`${bookId}-`) && f.endsWith("-read.md"));
  if (!md) return null;
  const m = readFileSync(join(reportsDir, md), "utf8").match(/```json\s*([\s\S]*?)```/);
  if (!m) return null;
  try { return { result: JSON.parse(m[1]) }; }
  catch (e) { return { error: `couldn't parse JSON block in ${md}: ${e.message}` }; }
}

function runEvaluation(bookId) {
  return new Promise((resolve) => {
    const args = ["-p", `/evaluate-book ${bookId}`, ...CLAUDE_FLAGS];
    console.log(`→ claude ${args.join(" ")}`);
    const child = spawn("claude", args, { cwd: repoRoot });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    child.stdout.on("data", (d) => process.stdout.write(d));
    child.on("error", (e) => resolve({ error: `failed to spawn claude: ${e.message}` }));
    child.on("close", (code) => {
      if (code !== 0) return resolve({ error: `claude exited ${code}: ${stderr.slice(-500)}` });
      const report = loadReport(bookId);
      if (!report?.result) return resolve({ error: report?.error || "no report produced" });
      resolve({ result: report.result });
    });
  });
}

// ── /spine-to-objectives ──────────────────────────────────────────────────────
const SCAFFOLD_INSTRUCTIONS = `You are a book architect. Given the book's SPINE (its throughline) — or, if no spine is set, the author's brief — design the book's chapters and pages as OBJECTIVES, not prose. The outline must realize the spine: every page serves the book-level aim.

Choose a structure appropriate to the genre and scope (e.g. Save the Cat or the Hero's Journey for commercial fiction; the Fichtean curve for thrillers; a five-part arc for self-help; a curated arc for memoir). Lay the book out as an ordered list of pages:
- "section" pages are chapter/part dividers (a title; an objective is optional).
- "text" pages are where prose will go; each MUST have a concise objective stating what that page must achieve (the beat it delivers, in one sentence).

Keep the size proportional to the scope: a short story is a handful of text pages; a novel is chapters (section pages) each followed by several text pages.

Output JSON ONLY (no prose, no fences), exactly:
{ "structure": "<the structure you chose>", "pages": [ { "pageType": "section", "title": "...", "objective": "" }, { "pageType": "text", "title": "...", "objective": "..." } ] }`;

async function runScaffold(bookId) {
  const book = await fetchBook(bookId);
  if (!book) return { error: "Book not found" };
  const spine = book.spine?.text?.trim() || null;

  const prompt = `${SCAFFOLD_INSTRUCTIONS}

BOOK: ${book.name}${spine ? `\n\nBOOK SPINE (the throughline — the outline must realize this):\n${spine}` : ""}

BRIEF:
${briefContext(book.brief)}

Design the outline. JSON only.`;

  const out = await runClaude(prompt, true, { fn: "spine-to-objectives", bookId }, { noTools: true });
  if (out.error) return out;

  let raw = out.text.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  else {
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first !== -1 && last > first) raw = raw.slice(first, last + 1);
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.pages) || parsed.pages.length === 0) throw new Error("no pages");
    parsed.pages = parsed.pages
      .filter((p) => p && (p.pageType === "section" || p.pageType === "text") && typeof p.title === "string")
      .map((p) => ({ pageType: p.pageType, title: p.title.trim(), objective: (p.objective ?? "").trim() }));
    return { structure: String(parsed.structure ?? "").trim(), pages: parsed.pages };
  } catch (e) {
    return { error: `Could not parse scaffold JSON: ${e.message}` };
  }
}

// ── /bible ──────────────────────────────────────────────────────────────────
const BIBLE_INSTRUCTIONS = `You are a story bible editor. From an author's brief, draft the book's "bible" — the established facts every page must stay consistent with. Output MARKDOWN (not JSON), concise and scannable, with these sections (omit any that don't apply to the genre):

## Premise
## Characters        (name — role; their want, their wound/flaw; voice in one line)
## World & Setting   (time, place, rules/constraints that matter)
## Style & Voice     (POV, tense, tone, diction notes)
## Names & Terms     (proper nouns to keep consistent)

Keep it a reference, not prose — bullet points and short lines. Invent sensible specifics where the brief is silent, so the author has something concrete to edit. No preamble.`;

async function runBible(bookId) {
  const book = await fetchBook(bookId);
  if (!book) return { error: "Book not found" };

  const prompt = `${BIBLE_INSTRUCTIONS}

BOOK: ${book.name}

BRIEF:
${briefContext(book.brief)}

Draft the bible. Markdown only.`;

  const out = await runClaude(prompt, true, { fn: "generate-bible", bookId }, { noTools: true });
  if (out.error) return out;
  const text = out.text.trim();
  if (!text) return { error: "Claude returned no text content" };
  return { text };
}

// ── /generate-voice ───────────────────────────────────────────────────────────
// Mirrors supabase/functions/generate-voice: draft 3 candidate voice samples for the picker.
const VOICE_INSTRUCTIONS = `You are a literary stylist. From a book's brief, spine, and bible, write THREE distinct candidate VOICE SAMPLES — short passages of finished prose that each commit to a different, specific take on how this book could sound. The author will pick one to anchor the whole book's voice.

Each sample:
- 300–450 words of actual PROSE from somewhere in the book (an opening, a charged moment) — not a description of the voice, the voice itself.
- A DISTINCT register from the other two (e.g. spare vs. lush; wry vs. earnest; close-third vs. first-person) so the choice is real.
- True to the genre, audience, and tone in the brief; consistent with any bible facts.
- Voice-forward: rhythm, diction, sentence shapes, restraint. Show range within a committed style.
- NO clichés or AI tells ("a testament to", "in a world where", "little did they know", "sent shivers down", "couldn't help but", tidy moral endings).

Output using XML tags ONLY (no other text), exactly:
<samples>
<sample>PASSAGE 1</sample>
<sample>PASSAGE 2</sample>
<sample>PASSAGE 3</sample>
</samples>`;

async function runVoice(bookId) {
  const book = await fetchBook(bookId);
  if (!book) return { error: "Book not found" };
  const spine = book.spine?.text?.trim() || null;
  const bible = book.bible?.text?.trim() || null;

  const prompt = `${VOICE_INSTRUCTIONS}

BOOK: ${book.name}${spine ? `\n\nSPINE (the throughline):\n${spine}` : ""}

BRIEF:
${briefContext(book.brief)}${bible ? `\n\nBIBLE (facts to stay consistent with):\n${bible}` : ""}

Write the three voice samples. XML tags only.`;

  const out = await runClaude(prompt, true, { fn: "generate-voice", bookId }, { noTools: true });
  if (out.error) return out;

  // Primary: XML tags (prose can contain quotes without escaping issues). JSON fallback for safety.
  const text = out.text.trim();
  const xml = [...text.matchAll(/<sample>([\s\S]*?)<\/sample>/g)].map((m) => m[1].trim()).filter(Boolean);
  if (xml.length > 0) return { samples: xml.slice(0, 3) };
  try {
    let raw = text;
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) raw = fence[1].trim();
    else { const a = raw.indexOf("{"), b = raw.lastIndexOf("}"); if (a !== -1 && b > a) raw = raw.slice(a, b + 1); }
    const parsed = JSON.parse(raw);
    const samples = Array.isArray(parsed.samples) ? parsed.samples.map((s) => String(s ?? "").trim()).filter(Boolean).slice(0, 3) : [];
    if (samples.length === 0) throw new Error("no samples");
    return { samples };
  } catch (e) {
    return { error: `Could not parse voice samples: ${e.message}` };
  }
}

// ── /auto-revise ──────────────────────────────────────────────────────────────
// Mirrors supabase/functions/auto-revise: the closed loop eval → revise critical/major pages →
// re-eval. The bridge runs it LINEARLY (no self-chain; no wall-clock cap) and writes the SAME
// book_generations row (kind 'auto_revise') so the AutoRevise UI watches it identically.
const AR_MAX_PAGES = 30, AR_MAX_ISSUES = 8;

// Run one editor's read end to end: insert a pending book_evaluations row, run the local eval, flip
// the row to done/error. Returns { result, evalId } or { error }.
async function runOneEvaluation(bookId) {
  const evalId = await startEvaluation(bookId);
  const out = await runEvaluation(bookId);
  if (out.error) {
    if (evalId) await finishEvaluation(evalId, { status: "error", error: out.error.slice(0, 1000) });
    return { error: out.error };
  }
  if (evalId) await finishEvaluation(evalId, { status: "done", result: out.result });
  else await persistEvaluation(bookId, out.result);
  return { result: out.result, evalId };
}

// Group the eval's CRITICAL (high) + MAJOR (medium) page-anchored issues into a per-page queue, in
// reading order. Whole-book issues (no page_ref) are left for the human read. Mirrors prod buildQueue.
function buildAutoReviseQueue(result, pages) {
  const byPage = new Map();
  for (const s of result?.sections ?? []) {
    for (const raw of s.issues ?? []) {
      if (raw.severity !== "high" && raw.severity !== "medium") continue;
      const pid = raw.page_ref?.id;
      if (typeof pid !== "number") continue;
      const note = String(raw.note ?? "").trim();
      if (!note) continue;
      const issue = { section: s.id, severity: raw.severity === "high" ? "critical" : "major", note, evidence: raw.evidence, suggestion: raw.suggestion };
      const list = byPage.get(pid) ?? [];
      if (list.length < AR_MAX_ISSUES) { list.push(issue); byPage.set(pid, list); }
    }
  }
  const queue = [];
  for (const p of pages) {
    if (p.page_type !== "text") continue;
    const issues = byPage.get(p.id);
    if (issues?.length) queue.push({ pageId: p.id, title: p.title, objective: p.metadata?.objective, issues });
    if (queue.length >= AR_MAX_PAGES) break;
  }
  return queue;
}

async function runAutoReviseBridge(bookId) {
  const row = await insertGeneration(bookId, { kind: "auto_revise", scope: "book", input: {}, progress: { phase: "eval", label: "Evaluating the draft", revised: 0, failures: 0 } });
  if (!row) return { error: "could not create generation row" };
  try {
    // Phase 1 — eval.
    const first = await runOneEvaluation(bookId);
    if (first.error) throw new Error(first.error);
    const pages = await fetchPages(bookId);
    const queue = buildAutoReviseQueue(first.result, pages);
    if (queue.length === 0) {
      await updateGeneration(row.id, { status: "done", progress: { phase: "done", evalId: first.evalId, total: 0, revised: 0, label: "Done — no critical or major page-level issues to fix" } });
      return { generation: row };
    }
    // Phase 2 — revise each queued page, writing the new prose ourselves.
    await updateGeneration(row.id, { progress: { phase: "revise", evalId: first.evalId, total: queue.length, revised: 0, failures: 0, label: `Revising 0/${queue.length}` } });
    let revised = 0, failures = 0;
    for (const item of queue) {
      try {
        const unit = await runUnit({ bookId, pageId: item.pageId, level: "page", mode: "revise", objective: item.objective, issues: item.issues });
        if (unit.error) throw new Error(unit.error);
        if (unit.text) { await writePageContent(item.pageId, item.title, unit.text); revised++; }
      } catch (e) {
        failures++;
        console.error(`bridge auto-revise: page ${item.pageId} failed: ${e.message}`);
      }
      await updateGeneration(row.id, { progress: { phase: "revise", evalId: first.evalId, total: queue.length, revised, failures, label: `Revising ${revised}/${queue.length}` } });
    }
    // Phase 3 — re-eval so the result is comparable.
    await updateGeneration(row.id, { progress: { phase: "reeval", total: queue.length, revised, failures, label: "Re-reading the revised draft" } });
    const second = await runOneEvaluation(bookId);
    await updateGeneration(row.id, { status: "done", progress: { phase: "done", revised, failures, reEvalId: second.evalId, label: `Done — revised ${revised} page${revised === 1 ? "" : "s"}; re-read ready` } });
    return { generation: row };
  } catch (e) {
    await updateGeneration(row.id, { status: "error", error: String(e?.message ?? e).slice(0, 1000) });
    return { error: String(e?.message ?? e) };
  }
}

// ── /revise-outline ──────────────────────────────────────────────────────────
// Mirrors supabase/functions/revise-outline: instruction/evaluation -> a reviewable revision plan
// (the objective-tree diff). NO mutation — the plan is returned for review.
const REPLAN_INSTRUCTIONS = `You are a book doctor revising an EXISTING book based on the author's instruction and/or a developmental editor's evaluation. You work in OBJECTIVES (what each page must achieve), not prose.

You are given: the brief, the bible, the CURRENT outline (each page with its real [id], type, title, and objective), and — depending on the request — an author's instruction and/or a full editorial evaluation. The AUTHOR'S INSTRUCTION, when present, is the primary directive: do what it asks. The evaluation is the editor's diagnosis to act on. Diagnose the STRUCTURAL changes needed — fulfilling the author's intent, plus problems the evaluation raises (passive protagonist, missing obligatory/"fix these first" scenes, abandoned setups, a sagging middle, redundancy) — and fix them at the level of objectives and structure.

Produce a REVISION PLAN: the book's NEW page list in final reading order, plus the existing pages to delete. For each page entry use one op:
- "keep":     unchanged. (ref = its id; carry its title/objective forward)
- "revise":   keep the page and its objective, but its prose needs fixing per the evaluation. (ref = id)
- "retarget": change the page's objective. Set "objective" to the NEW objective and "rebuild" to "rewrite" (objective changed materially) or "revise" (a minor shift → adapt existing prose). (ref = id)
- "add":      a NEW page (ref = null). Give pageType, a title, and an objective. Use this for the missing beats/scenes the evaluation calls for.
Reorder simply by placing entries in the desired final order. Separately, list in "deletes" any existing pages to remove.

Rules:
- Use ONLY the real [id]s given. Every existing page MUST appear in "pages" (with its ref) or in "deletes" — never drop a page silently.
- "section" pages are dividers; "text" pages carry prose (keep an objective on every text page).
- Be surgical: mark "keep" for what works; change only what the evaluation flags.
- Address the verdict's "priorities" first — highest leverage.

Output JSON ONLY (no prose, no fences), exactly:
{ "summary": "...", "pages": [ { "ref": <id|null>, "op": "keep|revise|retarget|add", "pageType": "section|text", "title": "...", "objective": "...", "rebuild": "rewrite|revise", "why": "..." } ], "deletes": [ { "ref": <id>, "why": "..." } ] }`;

// Plan-only variant: reshape the OUTLINE (objectives + structure) and never rewrite prose. Mirrors
// SYSTEM_PLAN_ONLY in supabase/functions/revise-outline.
const REPLAN_PLAN_ONLY_INSTRUCTIONS = `You are a book architect revising an EXISTING book's OUTLINE based on the author's instruction. You work purely in the PLAN: each page's objective (what it must achieve) and the book's structure (which pages exist, and in what order). You do NOT touch prose — pages whose objective changes will be re-rendered later by the author.

You are given: the brief, the bible, the CURRENT outline (each page with its real [id], type, title, and objective), and the author's instruction (the primary directive). Make the structural and objective changes the instruction asks for, and only those.

Produce a REVISION PLAN: the book's NEW page list in final reading order, plus the existing pages to delete. For each page entry use one op:
- "keep":     unchanged. (ref = its id; carry its title/objective forward)
- "retarget": change the page's objective. Set "objective" to the NEW objective. (ref = id)
- "add":      a NEW page (ref = null). Give pageType, a title, and an objective.
Reorder by placing entries in the desired final order. Separately, list in "deletes" any existing pages to remove.

NEVER use a "revise" op and NEVER rewrite or adapt prose — this step changes the plan only.

Rules:
- Use ONLY the real [id]s given. Every existing page MUST appear in "pages" (with its ref) or in "deletes" — never drop a page silently.
- "section" pages are dividers; "text" pages carry prose (keep an objective on every text page).
- Be surgical: mark "keep" for what already fits; change only what the instruction requires.

Output JSON ONLY (no prose, no fences), exactly:
{ "summary": "...", "pages": [ { "ref": <id|null>, "op": "keep|retarget|add", "pageType": "section|text", "title": "...", "objective": "...", "why": "..." } ], "deletes": [ { "ref": <id>, "why": "..." } ] }`;

function outlineContext(pages) {
  return pages
    .map((p) => {
      const obj = p.metadata?.objective?.trim();
      if (p.page_type === "section") return `[id=${p.id}] # ${p.title || "(untitled section)"}${obj ? ` — ${obj}` : ""}`;
      return `[id=${p.id}] - "${p.title || "(untitled)"}"${obj ? ` — ${obj}` : ""}`;
    })
    .join("\n");
}

function evalContext(ev) {
  const v = ev.verdict ?? {};
  const head = [
    v.genre_contract ? `Genre contract: ${v.genre_contract}` : "",
    v.stance ? `Stance: ${v.stance}` : "",
    v.letter ? `Editorial letter: ${v.letter}` : "",
    v.priorities?.length ? `Fix these first:\n${v.priorities.map((p, i) => `  ${i + 1}. ${p}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");
  const sections = (ev.sections ?? [])
    .map((s) => {
      const issues = (s.issues ?? [])
        .map((is) => {
          const sev = is.severity ? `[${is.severity}] ` : "";
          const page = is.page_ref?.id != null ? ` (page id ${is.page_ref.id})` : "";
          const sug = is.suggestion ? `  → ${is.suggestion}` : "";
          return `  - ${sev}${is.note}${page}${sug}`;
        })
        .join("\n");
      return `## ${s.title}${s.stance ? ` — ${s.stance}` : ""}${s.assessment ? `\n${s.assessment}` : ""}${issues ? `\n${issues}` : ""}`;
    })
    .join("\n\n");
  return `${head}\n\n${sections}`.trim();
}

// Parse + sanitize the plan with the same guardrails as the edge function.
function parsePlan(text, existing, planOnly = false) {
  let raw = text.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  else {
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first !== -1 && last > first) raw = raw.slice(first, last + 1);
  }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { return { error: `Could not parse revision plan JSON: ${e.message}` }; }
  if (!Array.isArray(parsed.pages)) return { error: "Revision plan has no pages." };

  const byId = new Map(existing.map((p) => [p.id, p]));
  const validIds = new Set(existing.map((p) => p.id));
  const ops = new Set(["keep", "revise", "retarget", "add"]);
  const seen = new Set();
  const pages = [];
  for (const p of parsed.pages) {
    let op = ops.has(p?.op) ? p.op : "keep";
    if (planOnly && op === "revise") op = "keep"; // outline edits never carry a prose-only revise
    if (op === "add") {
      if (typeof p.title !== "string" || !p.title.trim()) continue;
      pages.push({ ref: null, op: "add", pageType: p.pageType === "section" ? "section" : "text", title: p.title.trim(), objective: (p.objective ?? "").trim(), why: typeof p.why === "string" ? p.why.trim() : "" });
      continue;
    }
    const ref = typeof p.ref === "number" ? p.ref : null;
    if (ref == null || !validIds.has(ref) || seen.has(ref)) continue;
    seen.add(ref);
    const cur = byId.get(ref);
    pages.push({
      ref, op,
      pageType: cur.page_type === "section" ? "section" : "text",
      title: typeof p.title === "string" && p.title.trim() ? p.title.trim() : (cur.title ?? ""),
      objective: (p.objective ?? cur.metadata?.objective ?? "").trim(),
      rebuild: planOnly ? undefined : p.rebuild === "rewrite" ? "rewrite" : p.rebuild === "revise" ? "revise" : undefined,
      why: typeof p.why === "string" ? p.why.trim() : "",
    });
  }
  const deletes = [];
  const deletedIds = new Set();
  for (const d of Array.isArray(parsed.deletes) ? parsed.deletes : []) {
    const ref = typeof d?.ref === "number" ? d.ref : null;
    if (ref == null || !validIds.has(ref) || seen.has(ref) || deletedIds.has(ref)) continue;
    deletedIds.add(ref);
    deletes.push({ ref, why: typeof d.why === "string" ? d.why.trim() : "" });
  }
  for (const p of existing) {
    if (!seen.has(p.id) && !deletedIds.has(p.id)) {
      pages.push({ ref: p.id, op: "keep", pageType: p.page_type === "section" ? "section" : "text", title: p.title ?? "", objective: (p.metadata?.objective ?? "").trim(), why: "" });
    }
  }
  return { summary: String(parsed.summary ?? "").trim(), pages, deletes, planOnly: planOnly || undefined };
}

async function runReplan(bookId, evaluation, instruction, planOnly = false) {
  const book = await fetchBook(bookId);
  if (!book) return { error: "Book not found" };
  const instr = (instruction ?? "").trim();
  // Fall back to the stored report only when there's no explicit ask — don't silently fold the
  // old editor's notes into a pure free-text instruction (keeps parity with the edge function).
  const ev = evaluation ?? (instr ? undefined : loadReport(bookId)?.result);
  const hasEval = !!ev?.verdict && Array.isArray(ev.sections);
  if (!hasEval && !instr) return { error: "An instruction or a valid evaluation is required" };

  const pages = await fetchPages(bookId);
  if (!pages.length) return { error: "Book has no pages to revise" };

  const prompt = `${planOnly ? REPLAN_PLAN_ONLY_INSTRUCTIONS : REPLAN_INSTRUCTIONS}

BOOK: ${book.name}

BRIEF (the voice contract):
${briefContext(book.brief)}${book.bible?.text?.trim() ? `\n\nBOOK BIBLE (established facts):\n${book.bible.text.trim()}` : ""}

CURRENT OUTLINE (edit against these real ids):
${outlineContext(pages)}${instr ? `\n\nAUTHOR'S INSTRUCTION (primary directive):\n${instr}` : ""}${hasEval ? `\n\nEDITOR'S EVALUATION:\n${evalContext(ev)}` : ""}

Produce the revision plan. JSON only.`;

  const out = await runClaude(prompt, true, { fn: "revise-outline", bookId }, { noTools: true });
  if (out.error) return out;
  return parsePlan(out.text, pages, planOnly);
}

// ── /objective-to-beat ─────────────────────────────────────────────────────────
// Mirrors supabase/functions/objective-to-beat: objective → a one-paragraph beat (the plan of what the
// page does), in book context. No mutation — the client writes metadata.beat + stamps the edge.
const BEAT_INSTRUCTIONS = `You are a book architect writing a BEAT — a single paragraph that plans, in concrete order, what ONE page of the book does to fulfil its objective. A beat sits between the OBJECTIVE (what the page must achieve) and the PROSE (the actual words): it commits to the specific moves, turns, and images — the "how" — without writing the page itself.

Rules:
- Output ONE paragraph (3–6 sentences). No title, no heading, no preamble, no markdown, no meta commentary — just the beat.
- It is a PLAN, not prose: say what happens and in what order; do NOT write the page's actual sentences or dialogue.
- Fulfil the page's objective exactly. Honour the book's brief (genre, audience, tone, premise) and the book spine as the voice/throughline contract.
- Keep continuity: lead from what the preceding pages set up, don't repeat a neighbouring page's beat, and set up what follows.`;

async function runObjectiveToBeat(body) {
  const { bookId, pageId, objective } = body;
  if (!bookId || !pageId) return { error: "bookId and pageId required" };
  const obj = (objective ?? "").trim();
  if (!obj) return { error: "objective required" };

  const book = await fetchBook(bookId);
  if (!book) return { error: "Book not found" };
  const pages = await fetchPages(bookId);
  const spine = book.spine?.text?.trim() || null;

  const prompt = `${BEAT_INSTRUCTIONS}

BOOK: ${book.name}

BRIEF (the voice contract):
${briefContext(book.brief)}${spine ? `\n\nBOOK SPINE (the throughline):\n${spine}` : ""}

OUTLINE (for continuity):
${outlineContext(pages)}

THIS PAGE'S OBJECTIVE:
${obj}

Write the beat for THIS PAGE. One paragraph, plan only.`;

  // candidates>1 → sample N un-judged takes for the serial human-pick UI. The bridge has no
  // temperature knob, but separate `claude -p` calls vary enough to offer a real choice.
  const n = Math.max(1, Math.min(Number(body.candidates) || 1, 5));
  if (n > 1) {
    const outs = await Promise.all(
      Array.from({ length: n }, () => runClaude(prompt, true, { fn: "objective-to-beat", bookId }, { noTools: true })),
    );
    const takes = outs.map((o) => (o.text ?? "").trim()).filter(Boolean);
    if (takes.length === 0) return { error: "Claude returned no beat." };
    return { candidates: takes };
  }

  const out = await runClaude(prompt, true, { fn: "objective-to-beat", bookId }, { noTools: true });
  if (out.error) return out;
  return { beat: (out.text ?? "").trim() };
}

// ── /prose-to-beat ────────────────────────────────────────────────────────────
// Mirrors supabase/functions/prose-to-beat: prose → the beat it implements (reverse-outlining). No
// mutation — the client writes metadata.beat + reconciles the objective_beat & beat_prose edges.
const DISTILL_BEAT_INSTRUCTIONS = `You are a book architect REVERSE-OUTLINING a page: given the page's finished PROSE, write the BEAT it implements — a single paragraph that states, in concrete order, what the page actually does (its moves, turns, and images). You are abstracting the prose UP into its plan, not editing or judging it.

Rules:
- Output ONE paragraph (3–6 sentences). No title, no heading, no preamble, no markdown, no meta commentary — just the beat.
- It is a PLAN that describes what the prose DOES, in order — not a summary of the plot and not the prose itself. Capture the structure (what happens first, then, the turn), not the wording.
- Be faithful to the prose as written (this is reverse-outlining); use the objective only to frame the level of abstraction, not to "correct" the prose.
- Stay in the register the brief and book spine imply.`;

async function runProseToBeat(body) {
  const { bookId, pageId, proseText } = body;
  if (!bookId || !pageId) return { error: "bookId and pageId required" };
  const prose = (proseText ?? "").trim();
  if (!prose) return { error: "proseText required" };

  const book = await fetchBook(bookId);
  if (!book) return { error: "Book not found" };
  const pages = await fetchPages(bookId);
  const current = pages.find((p) => p.id === pageId) ?? null;
  const objective = (current?.metadata?.objective ?? "").trim();
  const spine = book.spine?.text?.trim() || null;

  const prompt = `${DISTILL_BEAT_INSTRUCTIONS}

BOOK: ${book.name}

BRIEF:
${briefContext(book.brief)}${spine ? `\n\nBOOK SPINE:\n${spine}` : ""}${objective ? `\n\nTHIS PAGE'S OBJECTIVE (for framing the abstraction level only):\n${objective}` : ""}

THE PAGE'S PROSE${current?.title ? ` ("${current.title}")` : ""} — reverse-outline this into its beat:
"""
${prose.slice(0, 12000)}
"""

Write the beat this prose implements. One paragraph, plan only.`;

  const out = await runClaude(prompt, true, { fn: "prose-to-beat", bookId }, { noTools: true });
  if (out.error) return out;
  return { beat: (out.text ?? "").trim() };
}

// ── /brief-to-spine ───────────────────────────────────────────────────────────
// Mirrors supabase/functions/brief-to-spine: brief → the book spine (the throughline). No mutation —
// the client writes books.spine = { text, brief_hash }.
const BRIEF_TO_SPINE_INSTRUCTIONS = `You are a book architect writing the BOOK SPINE — the throughline of the whole book. In 1–2 short paragraphs, state what this book is fundamentally DOING: its central objective/promise and the arc from beginning to end. This is the book-level objective every page will serve.

Rules:
- Output 1–2 short paragraphs. No title, no heading, no preamble, no markdown, no meta commentary — just the spine.
- It is the structural throughline, NOT a blurb or marketing copy and NOT a chapter list. Name the central aim, the through-arc, and what changes by the end.
- Derive it from the brief (genre, audience, premise, tone). Honour them as the voice/intent contract.
- If an outline is given, stay consistent with it, but write the spine at the BOOK level — above any single page.`;

async function runBriefToSpine(body) {
  const { bookId } = body;
  if (!bookId) return { error: "bookId required" };
  const book = await fetchBook(bookId);
  if (!book) return { error: "Book not found" };
  const pages = await fetchPages(bookId);
  const outline = pages
    .map((p) => {
      const obj = p.metadata?.objective?.trim();
      if (p.page_type === "section") return `# ${p.title || "(untitled section)"}${obj ? ` — ${obj}` : ""}`;
      return `- "${p.title || "(untitled)"}"${obj ? ` — ${obj}` : ""}`;
    })
    .join("\n");

  const prompt = `${BRIEF_TO_SPINE_INSTRUCTIONS}

BOOK: ${book.name}

BRIEF (the voice/intent contract):
${briefContext(book.brief)}${outline ? `\n\nCURRENT OUTLINE (for consistency — write the spine ABOVE these):\n${outline}` : ""}

Write the book spine. 1–2 short paragraphs, the throughline only.`;

  const out = await runClaude(prompt, true, { fn: "brief-to-spine", bookId }, { noTools: true });
  if (out.error) return out;
  return { spine: (out.text ?? "").trim() };
}

// ── /revise-node ──────────────────────────────────────────────────────────────
// Mirrors supabase/functions/revise-node: revise a short plan node (spine/objective/beat) against an
// instruction, preserving what works. The signal-driven preserve path for the small layers.
const NODE_SHAPE = {
  spine: "the BOOK SPINE — the throughline of the whole book, 1–2 short paragraphs naming its central aim and arc",
  objective: "a page OBJECTIVE — 1–2 sentences stating what that page must achieve (its job in the book)",
  beat: "a page BEAT — one paragraph planning, in order, what the page does to fulfil its objective",
};

async function runReviseNode(body) {
  const { bookId, layer, current, instruction } = body;
  if (!bookId) return { error: "bookId required" };
  if (!NODE_SHAPE[layer]) return { error: "layer must be spine|objective|beat" };
  const cur = (current ?? "").trim();
  const instr = (instruction ?? "").trim();
  if (!cur) return { error: "nothing to revise" };
  if (!instr) return { error: "instruction required" };

  const book = await fetchBook(bookId);
  if (!book) return { error: "Book not found" };
  const spine = book.spine?.text?.trim() || null;

  const system = `You are revising ${NODE_SHAPE[layer]}. Apply the author's INSTRUCTION while PRESERVING what already works — change only what the instruction asks for, keep the rest. This is a revision, not a rewrite from scratch.

Rules:
- Output only the revised ${layer}. No title, no heading, no preamble, no markdown, no meta commentary, no list of changes.
- Keep the same kind of statement and length as the original (it is ${NODE_SHAPE[layer]}).
- Honour the book's brief (genre, audience, tone) and stay consistent with the book spine if given.`;

  const prompt = `${system}

BOOK: ${book.name}

BRIEF:
${briefContext(book.brief)}${spine && layer !== "spine" ? `\n\nBOOK SPINE:\n${spine}` : ""}

CURRENT ${layer.toUpperCase()}:
${cur}

AUTHOR'S INSTRUCTION:
${instr}

Return the revised ${layer} only.`;

  const out = await runClaude(prompt, true, { fn: "revise-node", bookId }, { noTools: true });
  if (out.error) return out;
  return { text: (out.text ?? "").trim() };
}

// ── /beat-to-objective ────────────────────────────────────────────────────────
// Mirrors supabase/functions/beat-to-objective: beat → the page objective it serves (reverse, up).
const BEAT_TO_OBJECTIVE_INSTRUCTIONS = `You are a book architect ABSTRACTING UP: given a page's BEAT (a paragraph planning, in order, what the page does), write the page's OBJECTIVE — a single short statement (1–2 sentences) of what that page must ACHIEVE in the book: its job, not its moves. You are stepping up one level of abstraction, from the concrete plan to the page's purpose.

Rules:
- Output the objective only: 1–2 sentences, no title, no heading, no preamble, no markdown, no meta commentary.
- State the page's JOB (what it accomplishes / what changes), not a retelling of the beat's steps and not prose.
- Be faithful to what the beat actually does (this is reverse-outlining); the spine only frames the level of abstraction.`;

async function runBeatToObjective(body) {
  const { bookId, pageId, beat } = body;
  if (!bookId || !pageId) return { error: "bookId and pageId required" };
  const beatText = (beat ?? "").trim();
  if (!beatText) return { error: "beat required" };
  const book = await fetchBook(bookId);
  if (!book) return { error: "Book not found" };
  const pages = await fetchPages(bookId);
  const current = pages.find((p) => p.id === pageId) ?? null;
  const spine = book.spine?.text?.trim() || null;

  const prompt = `${BEAT_TO_OBJECTIVE_INSTRUCTIONS}

BOOK: ${book.name}

BRIEF:
${briefContext(book.brief)}${spine ? `\n\nBOOK SPINE (for framing the abstraction level):\n${spine}` : ""}

THE PAGE'S BEAT${current?.title ? ` ("${current.title}")` : ""} — abstract this up into the page's objective:
${beatText}

Write the objective this beat serves. 1–2 sentences, the page's job only.`;

  const out = await runClaude(prompt, true, { fn: "beat-to-objective", bookId }, { noTools: true });
  if (out.error) return out;
  return { objective: (out.text ?? "").trim() };
}

// ── /objectives-to-spine ──────────────────────────────────────────────────────
// Mirrors supabase/functions/objectives-to-spine: the book's outline → the spine (reverse, N→1).
const OBJECTIVES_TO_SPINE_INSTRUCTIONS = `You are a book architect ABSTRACTING UP: given the book's full outline (its chapters and pages, each with its objective), write the BOOK SPINE — the throughline. In 1–2 short paragraphs, state what this book is fundamentally DOING across all these pages: its central objective/promise and the arc from beginning to end.

Rules:
- Output 1–2 short paragraphs. No title, no heading, no preamble, no markdown, no meta commentary — just the spine.
- It is the structural throughline that the pages collectively realize — NOT a blurb, NOT a chapter list, NOT a summary of each page. Name the central aim, the through-arc, and what changes by the end.
- Be faithful to what the outline actually does (this is reverse-outlining); the brief only frames the register.`;

async function runObjectivesToSpine(body) {
  const { bookId } = body;
  if (!bookId) return { error: "bookId required" };
  const book = await fetchBook(bookId);
  if (!book) return { error: "Book not found" };
  const pages = await fetchPages(bookId);
  if (!pages.some((p) => p.metadata?.objective?.trim())) return { error: "no page objectives to distill a spine from" };
  const outline = pages
    .map((p) => {
      const obj = p.metadata?.objective?.trim();
      if (p.page_type === "section") return `# ${p.title || "(untitled section)"}${obj ? ` — ${obj}` : ""}`;
      return `- "${p.title || "(untitled)"}"${obj ? ` — ${obj}` : ""}`;
    })
    .join("\n");

  const prompt = `${OBJECTIVES_TO_SPINE_INSTRUCTIONS}

BOOK: ${book.name}

BRIEF (for register only):
${briefContext(book.brief)}

THE BOOK'S OUTLINE (chapters & pages with objectives) — abstract this up into the spine:
${outline}

Write the book spine the outline realizes. 1–2 short paragraphs, the throughline only.`;

  const out = await runClaude(prompt, true, { fn: "objectives-to-spine", bookId }, { noTools: true });
  if (out.error) return out;
  return { spine: (out.text ?? "").trim() };
}

// ── /unit ─────────────────────────────────────────────────────────────────────
// Kept at parity with _shared/generate-unit-core (beatToProse/revisePage) so local testing exercises
// the same context (bible + objective map + story so far + preceding prose) and summary.
const UNIT_SYSTEM = `You are a skilled prose writer helping an author render their book.
The author works in OBJECTIVES: a short statement of what a unit of the book must achieve.
Your job is to write the prose that achieves the given objective, in the book's voice and
consistent with the rest of the book.

Rules:
- Write ONLY the prose. No preamble, no titles, no headings (no "#" lines), no markdown
  fences, no meta commentary. The page already has its title — never restate it.
- Honor the book's brief — genre, audience, tone, premise — as the voice contract.
- Use the bible, outline, and preceding prose ONLY for consistency — keep names, facts, and
  tone aligned, and don't repeat what's already been written. Do NOT continue or finish a
  sentence from the preceding prose: begin this unit cleanly with a new sentence.
- Write a COMPLETE passage that ends at a natural stopping point — a finished sentence.
  Never stop mid-sentence.
- Serve the objective precisely; do not wander beyond what it asks.
- Match the requested length: a single paragraph means ONE paragraph.`;

const UNIT_SYSTEM_REVISE = `You are a developmental line editor revising a page of an author's book to address specific editorial notes.

Rules:
- Output ONLY the revised page prose. No preamble, no titles, no headings ("#" lines), no
  markdown fences, no meta commentary, no list of what you changed.
- Address EVERY note. Make the concrete change each note calls for — don't merely gesture at it.
- PRESERVE what works: keep the page's strengths, structure, and the author's voice. Change
  only what the notes require — this is a revision, not a rewrite from scratch.
- Honor the book's brief (genre, audience, tone, premise) and stay consistent with the bible
  and the surrounding pages (names, facts, continuity).
- Return a COMPLETE page that ends on a finished sentence.`;

// Editor notes → a compact bulleted list for the revise prompt.
function formatIssues(issues) {
  return (issues ?? [])
    .map((is) => {
      const sev = is.severity ? `[${is.severity}] ` : "";
      const cat = is.section ? `(${is.section}) ` : "";
      const ev = is.evidence ? `  evidence: "${is.evidence}"` : "";
      const sug = is.suggestion ? `  → ${is.suggestion}` : "";
      return `- ${sev}${cat}${is.note}${ev}${sug}`;
    })
    .join("\n");
}

const PRECEDING_PAGES = 2;

async function runUnit(body) {
  const { bookId, pageId, level, objective, pageObjective, precedingText, issues } = body;
  const mode = body.mode === "revise" ? "revise" : "write";
  if (!bookId || !level) return { error: "bookId and level required" };
  if (level !== "paragraph" && level !== "page") return { error: "level must be paragraph or page" };
  if (mode === "write" && !objective?.trim()) return { error: "objective required" };
  if (mode === "revise" && (!Array.isArray(issues) || issues.length === 0)) return { error: "issues required for revise" };

  const book = await fetchBook(bookId);
  if (!book) return { error: "Book not found" };
  const bible = book.bible?.text?.trim() || null;

  // Context (mirrors buildUnitContext in the edge function).
  const pages = await fetchPages(bookId);
  const current = pageId != null ? pages.find((p) => p.id === pageId) ?? null : null;
  // Resolution ladder: write prose from the page's BEAT when present (the concrete plan), else the
  // objective. Write mode + page level only — mirrors generate-unit-core.
  const beat = mode === "write" && level === "page" ? (current?.metadata?.beat?.trim() || null) : null;
  const currentText = mode === "revise" && current ? tiptapToText(current.content).trim() : null;
  if (mode === "revise" && !currentText) return { error: "Page has no prose to revise" };
  const objectiveMap = pages
    .map((p) => {
      const obj = p.metadata?.objective?.trim();
      const here = current && p.id === current.id ? "  ← you are here" : "";
      if (p.page_type === "section") return `\n# ${p.title || "(untitled section)"}${obj ? ` — ${obj}` : ""}${here}`;
      return `- "${p.title || "(untitled)"}"${obj ? ` — ${obj}` : ""}${here}`;
    })
    .join("\n");

  let storySoFar = null, precedingProse = null;
  if ((level === "page" || mode === "revise") && current) {
    const priorText = pages.filter((p) => p.page_type === "text" && p.page_index < current.page_index);
    const soFar = priorText
      .slice(0, Math.max(0, priorText.length - PRECEDING_PAGES))
      .map((p) => p.metadata?.summary?.trim())
      .filter(Boolean);
    storySoFar = soFar.length ? soFar.join("\n") : null;
    const chunks = priorText
      .slice(-PRECEDING_PAGES)
      .map((p) => { const t = tiptapToText(p.content).trim(); return t ? `### ${p.title || "(untitled)"}\n${t}` : ""; })
      .filter(Boolean);
    precedingProse = chunks.length ? chunks.join("\n\n") : null;
  }

  const parts = [
    mode === "revise" ? UNIT_SYSTEM_REVISE : UNIT_SYSTEM,
    "",
    `BOOK: ${book.name}`,
    `\nBRIEF (the voice contract):\n${briefContext(book.brief)}`,
  ];
  if (bible) parts.push(`\nBOOK BIBLE (established facts — characters, world, style; stay strictly consistent):\n${bible}`);
  if (objectiveMap) parts.push(`\nOUTLINE (the book's pages and their objectives, in order):\n${objectiveMap}`);
  if (storySoFar) parts.push(`\nSTORY SO FAR (summaries of earlier pages, for continuity):\n${storySoFar}`);
  if (mode === "revise") {
    if (precedingProse) parts.push(`\nPRECEDING PROSE (the page(s) just before this one — for continuity of voice and facts ONLY):\n"""\n${precedingProse}\n"""`);
    if (objective?.trim()) parts.push(`\nThis page is meant to achieve: ${objective.trim()}`);
    parts.push(`\nCURRENT PAGE PROSE (revise this in place):\n"""\n${currentText}\n"""`);
    parts.push(`\nTHE EDITOR'S NOTES TO ADDRESS ON THIS PAGE:\n${formatIssues(issues)}`);
    parts.push(`\nRevise the page to address every note above while preserving its strengths, the book's voice, and continuity with the rest of the book. Return the full revised page prose only.`);
  } else {
    if (precedingProse) parts.push(`\nPRECEDING PROSE (the pages just before this one — for continuity of voice and facts ONLY; do not continue or finish its last sentence, and don't repeat it):\n"""\n${precedingProse}\n"""`);
    if (pageObjective?.trim()) parts.push(`\nThis paragraph sits on a page whose objective is: ${pageObjective.trim()}`);
    if (precedingText?.trim()) parts.push(`\nThe prose immediately before this paragraph (continue naturally):\n"""\n${precedingText.trim()}\n"""`);
    parts.push(
      level === "paragraph"
        ? `\nWrite ONE paragraph that achieves this objective:\n${objective.trim()}`
        : beat
          ? `\nWrite the prose for a page (multiple paragraphs as needed) that realizes this BEAT — the page's plan for what happens, in order — while fulfilling its objective.\nOBJECTIVE (the aim): ${objective.trim()}\nBEAT (follow this plan): ${beat}`
          : `\nWrite the prose for a page that achieves this objective (multiple paragraphs as needed):\n${objective.trim()}`
    );
  }

  const out = await runClaude(parts.join("\n"), true, { fn: mode === "revise" ? "revise-prose" : "beat-to-prose", bookId }, { noTools: true });
  if (out.error) return out;

  let text = out.text.trim();
  const fence = text.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  // Drop any leading markdown heading lines (model restating the page title).
  { const lines = text.split("\n"); let i = 0; while (i < lines.length && (lines[i].trim() === "" || /^#{1,6}\s+/.test(lines[i].trim()))) i++; const s = lines.slice(i).join("\n").trim(); if (s) text = s; }
  if (!text) return { error: "Claude returned no text content" };

  // Persist a "story so far" summary for this page (best-effort), like the edge function.
  if (level === "page" && pageId) {
    try {
      const s = await runClaude(`Summarize this page of a book in 1-2 sentences: what happens and any new facts (characters, places, changes in state) a later page would need to stay consistent. Plain text only, no preamble.\n\n${text.slice(0, 12000)}`, true, { fn: "summarize", bookId }, { noTools: true });
      const summary = s.text?.trim();
      if (summary) await persistSummary(pageId, summary);
    } catch (e) {
      console.error("bridge unit: summary step failed (non-fatal):", e.message);
    }
  }

  return { text };
}

// ── /eval-call — on-demand judge of one logged ai_call (phase 2) ───────────────
// Mirrors supabase/functions/evaluate-ai-call, but runs via local Claude Code — which has the repo,
// so the judge can ground "code" amendments in the real prompt-assembly files. Writes the same
// ai_call_evals row the edge function writes, so analysis is identical across backends.
const JUDGE_MODEL_LOCAL = "claude-code-local";

// Where each fn assembles its prompt — given to the local judge so "code" amendments can be specific.
const FN_PROMPT_SOURCE = {
  "beat-to-prose": "supabase/functions/beat-to-prose/index.ts + _shared/generate-unit-core.ts (beatToProse; bridge runUnit)",
  "revise-prose": "supabase/functions/revise-prose/index.ts + _shared/generate-unit-core.ts (revisePage; bridge runUnit)",
  "summarize": "supabase/functions/_shared/generate-unit-core.ts (summarize)",
  "spine-to-objectives": "supabase/functions/spine-to-objectives/index.ts (and scripts/eval-bridge.mjs runScaffold)",
  "generate-bible": "supabase/functions/generate-bible/index.ts (and scripts/eval-bridge.mjs runBible)",
  "revise-outline": "supabase/functions/revise-outline/index.ts (and scripts/eval-bridge.mjs runReplan)",
  "objective-to-beat": "supabase/functions/objective-to-beat/index.ts (and scripts/eval-bridge.mjs runObjectiveToBeat)",
  "prose-to-beat": "supabase/functions/prose-to-beat/index.ts (and scripts/eval-bridge.mjs runProseToBeat)",
  "brief-to-spine": "supabase/functions/brief-to-spine/index.ts (and scripts/eval-bridge.mjs runBriefToSpine)",
  "beat-to-objective": "supabase/functions/beat-to-objective/index.ts (and scripts/eval-bridge.mjs runBeatToObjective)",
  "objectives-to-spine": "supabase/functions/objectives-to-spine/index.ts (and scripts/eval-bridge.mjs runObjectivesToSpine)",
  "revise-node": "supabase/functions/revise-node/index.ts (and scripts/eval-bridge.mjs runReviseNode)",
  "scan-page": "supabase/functions/scan-threads/index.ts (callHaiku)",
  "evaluate-book": "supabase/functions/evaluate-book/index.ts (runTriage/runGroup/runVerdict)",
};

async function fetchAiCall(id) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/ai_calls?id=eq.${id}&select=id,book_id,fn,system,input,output`,
    { headers: sbHeaders }
  );
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return (await r.json())?.[0] ?? null;
}

async function insertCallEval(call) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/ai_call_evals`, {
    method: "POST",
    headers: { ...sbHeaders, "content-type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ ai_call_id: call.id, book_id: call.book_id, status: "running", judge_model: JUDGE_MODEL_LOCAL }),
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return (await r.json())?.[0] ?? null;
}

async function updateCallEval(id, patch) {
  await fetch(`${SUPABASE_URL}/rest/v1/ai_call_evals?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...sbHeaders, "content-type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
}

// The logged input is a messages array; flatten it back to readable context for the judge.
function contextFromInput(input) {
  if (input == null) return "(no context recorded)";
  if (typeof input === "string") return input;
  if (!Array.isArray(input)) return JSON.stringify(input);
  return input
    .map((m) => {
      const c = m?.content;
      if (typeof c === "string") return c;
      if (Array.isArray(c)) return c.map((b) => (typeof b === "string" ? b : b?.text ?? "")).join("\n");
      return "";
    })
    .join("\n\n");
}

function parseJudgement(text) {
  let raw = text.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  else {
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first !== -1 && last > first) raw = raw.slice(first, last + 1);
  }
  const parsed = JSON.parse(raw);
  const s = parsed.scores ?? {};
  const clamp = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : 0; };
  return {
    scores: {
      objective_fidelity: clamp(s.objective_fidelity),
      context_use: clamp(s.context_use),
      instruction_following: clamp(s.instruction_following),
      quality: clamp(s.quality),
    },
    verdict: String(parsed.verdict ?? "").trim(),
    findings: Array.isArray(parsed.findings) ? parsed.findings : [],
    amendments: Array.isArray(parsed.amendments) ? parsed.amendments : [],
  };
}

async function runCallEval(call) {
  const ctx = contextFromInput(call.input);
  const source = FN_PROMPT_SOURCE[call.fn] ?? `supabase/functions/${call.fn}/index.ts`;
  const prompt =
    `You are a strict evaluation judge for an AI book-writing system. You ALSO have access to this ` +
    `repository, so your "code" amendments can name the real file/function to change.\n\n` +
    `You are given one AI call: the INSTRUCTIONS (system), the CONTEXT (the assembled prompt), and ` +
    `the OUTPUT it produced. Judge ONLY whether the output served the instructions and context it ` +
    `was given.\n\n` +
    `Score each 1-5 (5=excellent): objective_fidelity (achieved what was asked), context_use ` +
    `(honored the bible/continuity/outline given), instruction_following (obeyed format/length/` +
    `"no headings"/JSON-only constraints), quality (well-crafted for its kind).\n\n` +
    `For "code"-target amendments, you MAY read the prompt-assembly code for this call type ` +
    `(fn="${call.fn}"): ${source}. Name the specific function/lines to change.\n\n` +
    `Output ONLY this JSON (no prose, no fences):\n` +
    `{ "scores": { "objective_fidelity": <1-5>, "context_use": <1-5>, "instruction_following": <1-5>, ` +
    `"quality": <1-5> }, "verdict": "<one short line>", "findings": [ { "criterion": "<one of the ` +
    `four>", "severity": "high|medium|low", "note": "<problem>", "evidence": "<quote from output>" } ], ` +
    `"amendments": [ { "target": "output|prompt|code", "suggestion": "<fix>", "rationale": "<why>" } ] }\n\n` +
    `CALL TYPE (fn): ${call.fn}\n\nINSTRUCTIONS (system):\n${call.system ?? "(none — baked into the context)"}\n\n` +
    `CONTEXT:\n"""\n${ctx.slice(0, 24000)}\n"""\n\nOUTPUT:\n"""\n${(call.output ?? "(no output)").slice(0, 16000)}\n"""\n\nJSON only.`;

  const out = await runClaude(prompt, true, { fn: "judge-ai-call", bookId: call.book_id });
  if (out.error) throw new Error(out.error);
  return parseJudgement(out.text);
}

// ── Server ────────────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") return res.writeHead(204, cors).end();

  try {
    return await route(req, res);
  } catch (e) {
    // A thrown handler (e.g. Supabase fetch error) must not take down the server —
    // the clients retry per request and expect the bridge to stay up.
    console.error("bridge request failed:", e?.message ?? e);
    if (!res.headersSent) return json(res, 500, { error: String(e?.message ?? e) });
  }
});

async function route(req, res) {
  const url = req.url ?? "";

  const evalMatch = url.match(/^\/eval\/(\d+)\/?$/);
  if (evalMatch) {
    const bookId = Number(evalMatch[1]);
    if (req.method === "GET") {
      const report = loadReport(bookId);
      if (report?.result) return json(res, 200, { status: "done", result: report.result });
      return json(res, 200, { status: "none", ...(report?.error && { error: report.error }) });
    }
    if (req.method === "POST") {
      if (!(await authorize(req, res, bookId))) return;
      console.log(`Evaluating book ${bookId}…`);
      // Insert the pending row first so a refresh mid-run resumes the loader (parity with the edge
      // function); then run the slow local eval and flip the row terminal.
      const evalId = await startEvaluation(bookId);
      const startedEval = Date.now();
      const out = await runEvaluation(bookId);
      // Coarse log: the eval's real prompts are built INSIDE the spawned `claude` session (the
      // /evaluate-book slash command), invisible to the bridge — so we record the command + the
      // resulting report, not the internal context. Prod's edge eval logs each phase's full prompt.
      await logAiCall({
        fn: "evaluate-book",
        bookId,
        prompt: `/evaluate-book ${bookId}`,
        output: out.error ? null : JSON.stringify(out.result),
        error: out.error ?? null,
        latencyMs: Date.now() - startedEval,
      });
      if (out.error) {
        if (evalId != null) await finishEvaluation(evalId, { status: "error", error: out.error });
        return json(res, 500, { status: "error", error: out.error });
      }
      if (evalId != null) {
        await finishEvaluation(evalId, { status: "done", result: out.result });
      } else {
        // No pending row was created — fall back to writing a done row so the report still persists.
        const saved = await persistEvaluation(bookId, out.result);
        if (saved.error) console.error(`bridge eval: failed to persist to book_evaluations: ${saved.error}`);
      }
      return json(res, 200, { status: "done", result: out.result });
    }
    return json(res, 405, { error: "method not allowed" });
  }

  const scaffoldMatch = url.match(/^\/spine-to-objectives\/(\d+)\/?$/);
  if (scaffoldMatch) {
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    const bookId = Number(scaffoldMatch[1]);
    if (!(await authorize(req, res, bookId))) return;
    console.log(`Generating scaffold for book ${bookId}…`);
    // Write the same book_generations row the edge fn does (insert running → ready), so the UI
    // watches the row identically in dev.
    const out = await runGeneration(bookId, { kind: "scaffold", scope: "book", input: {} }, async () => {
      const scaffold = await runScaffold(bookId);
      if (scaffold.error) throw new Error(scaffold.error);
      return { status: "ready", result: scaffold };
    });
    if (out.error) return json(res, 500, { error: out.error });
    return json(res, 200, { status: "running", generation: out.generation });
  }

  const voiceMatch = url.match(/^\/generate-voice\/(\d+)\/?$/);
  if (voiceMatch) {
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    const bookId = Number(voiceMatch[1]);
    if (!(await authorize(req, res, bookId))) return;
    console.log(`Drafting voice samples for book ${bookId}…`);
    // Same book_generations row the edge fn writes (insert running → ready), so the picker watches it.
    const out = await runGeneration(bookId, { kind: "voice", scope: "book", input: {} }, async () => {
      const voice = await runVoice(bookId);
      if (voice.error) throw new Error(voice.error);
      return { status: "ready", result: { samples: voice.samples } };
    });
    if (out.error) return json(res, 500, { error: out.error });
    return json(res, 200, { status: "running", generation: out.generation });
  }

  const autoReviseMatch = url.match(/^\/auto-revise\/(\d+)\/?$/);
  if (autoReviseMatch) {
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    const bookId = Number(autoReviseMatch[1]);
    if (!(await authorize(req, res, bookId))) return;
    console.log(`Auto-revising book ${bookId} (eval → revise → re-eval)…`);
    const out = await runAutoReviseBridge(bookId);
    if (out.error) return json(res, 500, { error: out.error });
    return json(res, 200, { status: "running", generation: out.generation });
  }

  const bibleMatch = url.match(/^\/bible\/(\d+)\/?$/);
  if (bibleMatch) {
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    const bookId = Number(bibleMatch[1]);
    if (!(await authorize(req, res, bookId))) return;
    console.log(`Drafting bible for book ${bookId}…`);
    const out = await runGeneration(bookId, { kind: "bible", scope: "book", input: { source: "brief" } }, async () => {
      const bible = await runBible(bookId);
      if (bible.error) throw new Error(bible.error);
      return { status: "ready", result: { text: bible.text } };
    });
    if (out.error) return json(res, 500, { error: out.error });
    return json(res, 200, { status: "running", generation: out.generation });
  }

  if (url === "/page" || url === "/page/") {
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    const body = await readBody(req);
    if (!(await authorize(req, res, Number(body.bookId)))) return;
    const mode = body.mode === "revise" ? "revise" : "write";
    console.log(`Generating page (book ${body.bookId}, page ${body.pageId}, ${mode})…`);
    const out = await runGeneration(
      body.bookId,
      { kind: mode === "revise" ? "page_revise" : "page_write", scope: "page", target_page_id: body.pageId, input: { objective: body.objective ?? null, mode, issues: body.issues ?? null } },
      async () => {
        const unit = await runUnit({ ...body, level: "page", mode });
        if (unit.error) throw new Error(unit.error);
        if (!unit.text) throw new Error("The editor returned no text.");
        return { status: "ready", result: { text: unit.text } };
      }
    );
    if (out.error) return json(res, 500, { error: out.error });
    return json(res, 200, { status: "running", generation: out.generation });
  }

  const replanMatch = url.match(/^\/revise-outline\/(\d+)\/?$/);
  if (replanMatch) {
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    const bookId = Number(replanMatch[1]);
    if (!(await authorize(req, res, bookId))) return;
    const body = await readBody(req);
    console.log(`Replanning book ${bookId}${body.instruction ? " from instruction" : ""}${body.evaluation ? " from evaluation" : ""}${body.planOnly ? " (outline only)" : ""}…`);
    const out = await runReplan(bookId, body.evaluation, body.instruction, body.planOnly === true);
    if (out.error) return json(res, 500, { error: out.error });
    return json(res, 200, out);
  }

  // beat-to-prose (write) + revise-prose (revise) — two endpoints over the shared runUnit.
  if (url === "/beat-to-prose" || url === "/beat-to-prose/") {
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    const body = await readBody(req);
    if (!(await authorize(req, res, Number(body.bookId)))) return;
    console.log(`beat-to-prose (book ${body.bookId}, level: ${body.level})…`);
    const out = await runUnit({ ...body, mode: "write" });
    if (out.error) return json(res, 500, { error: out.error });
    return json(res, 200, out);
  }

  if (url === "/revise-prose" || url === "/revise-prose/") {
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    const body = await readBody(req);
    if (!(await authorize(req, res, Number(body.bookId)))) return;
    console.log(`revise-prose (book ${body.bookId}, page ${body.pageId})…`);
    const out = await runUnit({ ...body, level: "page", mode: "revise" });
    if (out.error) return json(res, 500, { error: out.error });
    return json(res, 200, out);
  }

  if (url === "/objective-to-beat" || url === "/objective-to-beat/") {
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    const body = await readBody(req);
    if (!(await authorize(req, res, Number(body.bookId)))) return;
    console.log(`Writing beat (book ${body.bookId}, page ${body.pageId})…`);
    const out = await runObjectiveToBeat(body);
    if (out.error) return json(res, 500, { error: out.error });
    return json(res, 200, out);
  }

  if (url === "/prose-to-beat" || url === "/prose-to-beat/") {
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    const body = await readBody(req);
    if (!(await authorize(req, res, Number(body.bookId)))) return;
    console.log(`Distilling beat from prose (book ${body.bookId}, page ${body.pageId})…`);
    const out = await runProseToBeat(body);
    if (out.error) return json(res, 500, { error: out.error });
    return json(res, 200, out);
  }

  if (url === "/brief-to-spine" || url === "/brief-to-spine/") {
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    const body = await readBody(req);
    if (!(await authorize(req, res, Number(body.bookId)))) return;
    console.log(`Writing book spine (book ${body.bookId})…`);
    const out = await runBriefToSpine(body);
    if (out.error) return json(res, 500, { error: out.error });
    return json(res, 200, out);
  }

  if (url === "/revise-node" || url === "/revise-node/") {
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    const body = await readBody(req);
    if (!(await authorize(req, res, Number(body.bookId)))) return;
    console.log(`Revising ${body.layer} (book ${body.bookId})…`);
    const out = await runReviseNode(body);
    if (out.error) return json(res, 500, { error: out.error });
    return json(res, 200, out);
  }

  if (url === "/beat-to-objective" || url === "/beat-to-objective/") {
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    const body = await readBody(req);
    if (!(await authorize(req, res, Number(body.bookId)))) return;
    console.log(`Distilling objective from beat (book ${body.bookId}, page ${body.pageId})…`);
    const out = await runBeatToObjective(body);
    if (out.error) return json(res, 500, { error: out.error });
    return json(res, 200, out);
  }

  if (url === "/objectives-to-spine" || url === "/objectives-to-spine/") {
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    const body = await readBody(req);
    if (!(await authorize(req, res, Number(body.bookId)))) return;
    console.log(`Distilling spine from outline (book ${body.bookId})…`);
    const out = await runObjectivesToSpine(body);
    if (out.error) return json(res, 500, { error: out.error });
    return json(res, 200, out);
  }

  const evalCallMatch = url.match(/^\/eval-call\/(\d+)\/?$/);
  if (evalCallMatch) {
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    const aiCallId = Number(evalCallMatch[1]);
    const call = await fetchAiCall(aiCallId);
    if (!call) return json(res, 404, { error: "AI call not found" });
    // Authorize against the call's book — same per-book edit check as every other endpoint.
    if (!(await authorize(req, res, Number(call.book_id)))) return;
    console.log(`Judging ai_call ${aiCallId} (fn=${call.fn}, book ${call.book_id})…`);
    const row = await insertCallEval(call);
    if (!row) return json(res, 500, { error: "could not create eval row" });
    try {
      const j = await runCallEval(call);
      await updateCallEval(row.id, { status: "done", ...j });
      return json(res, 200, { status: "done", eval: { ...row, ...j } });
    } catch (e) {
      await updateCallEval(row.id, { status: "error", error: String(e?.message ?? e).slice(0, 1000) });
      return json(res, 500, { error: String(e?.message ?? e) });
    }
  }

  return json(res, 404, { error: "use /eval/:bookId, /spine-to-objectives/:bookId, /bible/:bookId, /eval-call/:aiCallId, or POST /beat-to-prose" });
}

server.listen(PORT, () => {
  console.log(`eval-bridge listening on http://localhost:${PORT}  (repo: ${repoRoot})`);
  console.log(`  GET/POST /eval/:bookId   POST /spine-to-objectives/:bookId   POST /bible/:bookId   POST /revise-outline/:bookId   POST /beat-to-prose   POST /revise-prose   POST /objective-to-beat   POST /prose-to-beat   POST /brief-to-spine   POST /beat-to-objective   POST /objectives-to-spine   POST /revise-node`);
});
