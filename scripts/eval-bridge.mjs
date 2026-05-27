#!/usr/bin/env node
// Local bridge between the web UI and Claude Code. The browser can't run a CLI,
// so this tiny server does it: routes AI calls to `claude -p` (headless Claude Code)
// instead of the Anthropic API, costing nothing extra on a CC subscription.
//
//   node scripts/eval-bridge.mjs            # listens on http://localhost:8787
//
//   GET  /eval/:bookId      -> existing report  { status: 'done'|'none', result? }
//   POST /eval/:bookId      -> run evaluation   { status: 'done'|'error', result?, error? }
//   POST /scaffold/:bookId  -> generate scaffold { structure, pages[] } | { error }
//   POST /unit              -> generate prose    { text } | { error }
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

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
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

async function fetchBook(bookId) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/books?id=eq.${bookId}&select=name%2Cbrief`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  const rows = await r.json();
  return rows?.[0] ?? null;
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
  });
}

// ── Claude runner ─────────────────────────────────────────────────────────────
// captureStdout=true: buffer + return stdout as `text`.
// captureStdout=false (eval): just pipe to terminal; result comes from a file.
function runClaude(prompt, captureStdout = false) {
  return new Promise((resolve) => {
    const args = ["-p", prompt, ...CLAUDE_FLAGS];
    console.log(`→ claude -p "${prompt.slice(0, 80).replace(/\n/g, " ")}…"`);
    const child = spawn("claude", args, { cwd: repoRoot });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => {
      if (captureStdout) stdout += d;
      process.stdout.write(d);
    });
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => resolve({ error: `failed to spawn claude: ${e.message}` }));
    child.on("close", (code) => {
      if (code !== 0) return resolve({ error: `claude exited ${code}: ${stderr.slice(-500)}` });
      resolve({ text: stdout.trim() });
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

// ── /scaffold ─────────────────────────────────────────────────────────────────
const SCAFFOLD_INSTRUCTIONS = `You are a book architect. Given an author's brief, design the book's SCAFFOLD — its chapters and pages — as objectives, not prose.

Choose a structure appropriate to the genre and scope (e.g. Save the Cat or the Hero's Journey for commercial fiction; the Fichtean curve for thrillers; a five-part arc for self-help; a curated arc for memoir). Lay the book out as an ordered list of pages:
- "section" pages are chapter/part dividers (a title; an objective is optional).
- "text" pages are where prose will go; each MUST have a concise objective stating what that page must achieve (the beat it delivers, in one sentence).

Keep the size proportional to the scope: a short story is a handful of text pages; a novel is chapters (section pages) each followed by several text pages.

Output JSON ONLY (no prose, no fences), exactly:
{ "structure": "<the structure you chose>", "pages": [ { "pageType": "section", "title": "...", "objective": "" }, { "pageType": "text", "title": "...", "objective": "..." } ] }`;

async function runScaffold(bookId) {
  const book = await fetchBook(bookId);
  if (!book) return { error: "Book not found" };

  const prompt = `${SCAFFOLD_INSTRUCTIONS}

BOOK: ${book.name}

BRIEF:
${briefContext(book.brief)}

Design the scaffold. JSON only.`;

  const out = await runClaude(prompt, true);
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

  const out = await runClaude(prompt, true);
  if (out.error) return out;
  const text = out.text.trim();
  if (!text) return { error: "Claude returned no text content" };
  return { text };
}

// ── /unit ─────────────────────────────────────────────────────────────────────
const UNIT_SYSTEM = `You are a skilled prose writer helping an author render their book.
The author works in OBJECTIVES: a short statement of what a unit of the book must achieve.
Your job is to write the prose that achieves the given objective, in the book's voice.

Rules:
- Write ONLY the prose. No preamble, no headings, no markdown fences, no meta commentary.
- Honor the book's brief — genre, audience, tone, premise — as the voice contract.
- Serve the objective precisely; do not wander beyond what it asks.
- Match the requested length: a single paragraph means ONE paragraph.`;

async function runUnit(body) {
  const { bookId, level, objective, pageObjective, precedingText } = body;
  if (!bookId || !level || !objective?.trim()) return { error: "bookId, level, objective required" };
  if (level !== "paragraph" && level !== "page") return { error: "level must be paragraph or page" };

  const book = await fetchBook(bookId);
  if (!book) return { error: "Book not found" };

  const parts = [
    UNIT_SYSTEM,
    "",
    `BOOK: ${book.name}`,
    `\nBRIEF (the voice contract):\n${briefContext(book.brief)}`,
  ];
  if (pageObjective?.trim()) parts.push(`\nThis paragraph sits on a page whose objective is: ${pageObjective.trim()}`);
  if (precedingText?.trim()) parts.push(`\nThe prose immediately before this unit (continue naturally, do not repeat it):\n"""\n${precedingText.trim()}\n"""`);
  parts.push(
    level === "paragraph"
      ? `\nWrite ONE paragraph that achieves this objective:\n${objective.trim()}`
      : `\nWrite the prose for a page that achieves this objective (multiple paragraphs as needed):\n${objective.trim()}`
  );

  const out = await runClaude(parts.join("\n"), true);
  if (out.error) return out;

  let text = out.text.trim();
  const fence = text.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  if (!text) return { error: "Claude returned no text content" };
  return { text };
}

// ── Server ────────────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") return res.writeHead(204, cors).end();

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
      console.log(`Evaluating book ${bookId}…`);
      const out = await runEvaluation(bookId);
      if (out.error) return json(res, 500, { status: "error", error: out.error });
      return json(res, 200, { status: "done", result: out.result });
    }
    return json(res, 405, { error: "method not allowed" });
  }

  const scaffoldMatch = url.match(/^\/scaffold\/(\d+)\/?$/);
  if (scaffoldMatch) {
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    const bookId = Number(scaffoldMatch[1]);
    console.log(`Generating scaffold for book ${bookId}…`);
    const out = await runScaffold(bookId);
    if (out.error) return json(res, 500, { error: out.error });
    return json(res, 200, out);
  }

  const bibleMatch = url.match(/^\/bible\/(\d+)\/?$/);
  if (bibleMatch) {
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    const bookId = Number(bibleMatch[1]);
    console.log(`Drafting bible for book ${bookId}…`);
    const out = await runBible(bookId);
    if (out.error) return json(res, 500, { error: out.error });
    return json(res, 200, out);
  }

  if (url === "/unit" || url === "/unit/") {
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    const body = await readBody(req);
    console.log(`Generating unit (book ${body.bookId}, level: ${body.level})…`);
    const out = await runUnit(body);
    if (out.error) return json(res, 500, { error: out.error });
    return json(res, 200, out);
  }

  return json(res, 404, { error: "use /eval/:bookId, /scaffold/:bookId, /bible/:bookId, or POST /unit" });
});

server.listen(PORT, () => {
  console.log(`eval-bridge listening on http://localhost:${PORT}  (repo: ${repoRoot})`);
  console.log(`  GET/POST /eval/:bookId   POST /scaffold/:bookId   POST /unit`);
});
