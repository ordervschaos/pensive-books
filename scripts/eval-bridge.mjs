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
import { readdirSync, readFileSync, existsSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { distinctivePhrases, approxTokens } from "./lib/prose-lints.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const reportsDir = join(repoRoot, "reports");
const PORT = Number(process.env.EVAL_BRIDGE_PORT || 8787);
const CLAUDE_FLAGS = (process.env.EVAL_CLAUDE_FLAGS || "--dangerously-skip-permissions").split(" ").filter(Boolean);
// `claude -p` latency on the CC subscription is congestion-bound and wildly variable (2–21 min,
// occasionally a dropped socket). Past this many ms we kill the child and fail fast so the caller
// can retry/re-roll instead of stranding (and never leave a zombie 'running' ai_calls row). 0 = off.
const CLAUDE_TIMEOUT_MS = Number(process.env.EVAL_CLAUDE_TIMEOUT_MS ?? 6 * 60 * 1000);

// Model routing — override via env to switch tiers without code changes.
// E.g. EVAL_PROSE_MODEL=sonnet to cut cost on bulk rewrites.
const MODEL_PLANNING = process.env.EVAL_PLANNING_MODEL || "opus"; // structural decisions, beat/outline work
const MODEL_PROSE    = process.env.EVAL_PROSE_MODEL    || "opus"; // prose writing (default opus, can be overridden to sonnet)
const MODEL_SUMMARY  = process.env.EVAL_SUMMARY_MODEL  || "haiku"; // short summaries, image-prompt composition

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
    `${SUPABASE_URL}/rest/v1/books?id=eq.${bookId}&select=name%2Cbrief%2Cbible%2Cspine%2Cfoundations%2Ccanon%2Csteers%2Ccraft_notes`,
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
// (legacy callers without time; new path uses bridgePersistSummary)
async function persistSummary(pageId, summary) {
  const g = await fetch(`${SUPABASE_URL}/rest/v1/pages?id=eq.${pageId}&select=metadata`, { headers: sbHeaders });
  const cur = (await g.json())?.[0]?.metadata ?? {};
  await fetch(`${SUPABASE_URL}/rest/v1/pages?id=eq.${pageId}`, {
    method: "PATCH",
    headers: { ...sbHeaders, "content-type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ metadata: { ...cur, summary } }),
  });
}

// F3c: persist summary AND story-time stamp (mirrors persistSummary in generate-unit-core.ts).
async function bridgePersistSummary(pageId, summary, time) {
  const g = await fetch(`${SUPABASE_URL}/rest/v1/pages?id=eq.${pageId}&select=metadata`, { headers: sbHeaders });
  const cur = (await g.json())?.[0]?.metadata ?? {};
  const metadata = { ...cur, summary };
  if (time) metadata.time = time;
  await fetch(`${SUPABASE_URL}/rest/v1/pages?id=eq.${pageId}`, {
    method: "PATCH",
    headers: { ...sbHeaders, "content-type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ metadata }),
  });
}

// F3c: summarize prose and extract story-time stamp — mirrors the generate-unit-core summarizer
// which now returns { summary, time? } JSON envelope instead of a plain string.
async function bridgeSummarize(prose, bookId) {
  const systemPrompt = `Summarize this page of a book and extract any story-time cue.
Output JSON ONLY (no prose, no fences):
{"summary":"1-2 sentences: what happens and any new facts a later page needs","time":{"when":"time of day/story moment if clear","elapsed":"duration since story start if clear"}}
Omit "time" or its sub-keys if they cannot be inferred from the prose. "summary" is required.`;
  const s = await runClaude(`${systemPrompt}\n\n${prose.slice(0, 12000)}`, true, { fn: "summarize", bookId }, { noTools: true, model: MODEL_SUMMARY });
  const raw = (s.text ?? "").trim();
  if (!raw) return { summary: "" };
  // Try JSON envelope first; fall back to treating the whole response as a plain summary.
  try {
    let json = raw;
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) json = fence[1].trim();
    else { const f = raw.indexOf("{"), l = raw.lastIndexOf("}"); if (f !== -1 && l > f) json = raw.slice(f, l + 1); }
    const parsed = JSON.parse(json);
    const summary = typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim() : raw;
    const timeRaw = parsed.time && typeof parsed.time === "object" ? parsed.time : null;
    const when = typeof timeRaw?.when === "string" && timeRaw.when.trim() ? timeRaw.when.trim() : undefined;
    const elapsed = typeof timeRaw?.elapsed === "string" && timeRaw.elapsed.trim() ? timeRaw.elapsed.trim() : undefined;
    const time = (when || elapsed) ? { when, elapsed } : undefined;
    return { summary, time };
  } catch {
    return { summary: raw };
  }
}

// F2: extract character + relationship states from prose (one call, returns both).
// Mirrors extractStates + parseExtractedStates in generate-unit-core.ts.
async function bridgeMaybeExtractStates(bookId, pageId, prose) {
  // Fetch the page list to find the prior snapshots.
  const r = await fetch(`${SUPABASE_URL}/rest/v1/pages?book_id=eq.${bookId}&archived=eq.false&select=id,page_index,metadata&order=page_index.asc`, { headers: sbHeaders });
  const list = (await r.json()) ?? [];
  const cur = list.find((p) => p.id === pageId);
  if (!cur) return;

  const priorCs = list.filter((p) => p.page_index < cur.page_index && (p.metadata?.character_states?.length ?? 0) > 0);
  const priorRel = list.filter((p) => p.page_index < cur.page_index && (p.metadata?.relationship_states?.length ?? 0) > 0);
  const priorChars = priorCs.at(-1)?.metadata?.character_states ?? [];
  const priorRelStates = priorRel.at(-1)?.metadata?.relationship_states ?? [];

  const priorCharsBlock = priorChars.length ? JSON.stringify(priorChars) : "(none yet — first page with characters)";
  const priorRelBlock = priorRelStates.length ? JSON.stringify(priorRelStates) : "(none yet)";

  const systemPrompt = `You track character and relationship state across a story for continuity. Given the PRIOR states and a NEW page of prose, output the UPDATED state of EVERY character AND EVERY relationship.
Rules for characters: carry forward unchanged characters exactly; update knows/feels/has/believes for any the page affected; keep want and wound stable once set; add a character only if they clearly matter going forward. Be terse; omit empty fields.
Rules for relationships: carry forward unchanged dyads exactly; update charge/note when the page clearly shifts a dyad; add a dyad only if the page establishes a significant bond. Use the pair format "Name A / Name B" consistently. Be terse.
Output JSON ONLY (no prose, no fences):
{"characters":[{"name":"","want":"","wound":"","believes":"","knows":[""],"feels":"","has":[""]}],"relationship_states":[{"pair":"Name A / Name B","charge":"","note":""}]}`;

  const userContent = `PRIOR CHARACTER STATES:\n${priorCharsBlock}\n\nPRIOR RELATIONSHIP STATES:\n${priorRelBlock}\n\nNEW PAGE PROSE:\n${prose.slice(0, 12000)}\n\nOutput the updated states for every character and every relationship. JSON only.`;
  const out = await runClaude(`${systemPrompt}\n\n${userContent}`, true, { fn: "extract-character-states", bookId }, { noTools: true, model: MODEL_SUMMARY });
  const text = (out.text ?? "").trim();
  if (!text) return;

  // Parse the JSON envelope.
  let parsed;
  try {
    let json = text;
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) json = fence[1].trim();
    else { const f = text.indexOf("{"), l = text.lastIndexOf("}"); if (f !== -1 && l > f) json = text.slice(f, l + 1); }
    parsed = JSON.parse(json);
  } catch { return; }

  const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const arr = (v) => { if (!Array.isArray(v)) return undefined; const o = v.map((x) => String(x ?? "").trim()).filter(Boolean); return o.length ? o : undefined; };
  const characters = Array.isArray(parsed.characters)
    ? parsed.characters.map((c) => ({ name: str(c.name) ?? "", want: str(c.want), wound: str(c.wound), believes: str(c.believes), knows: arr(c.knows), feels: str(c.feels), has: arr(c.has) })).filter((c) => c.name).slice(0, 24)
    : [];
  const relationship_states = Array.isArray(parsed.relationship_states)
    ? parsed.relationship_states.map((r) => ({ pair: str(r.pair) ?? "", charge: str(r.charge) ?? "", note: str(r.note) })).filter((r) => r.pair && r.charge).slice(0, 32)
    : [];

  if (characters.length || relationship_states.length) {
    const gp = await fetch(`${SUPABASE_URL}/rest/v1/pages?id=eq.${pageId}&select=metadata`, { headers: sbHeaders });
    const existing = (await gp.json())?.[0]?.metadata ?? {};
    const metadata = { ...existing };
    if (characters.length) metadata.character_states = characters;
    if (relationship_states.length) metadata.relationship_states = relationship_states;
    await fetch(`${SUPABASE_URL}/rest/v1/pages?id=eq.${pageId}`, {
      method: "PATCH",
      headers: { ...sbHeaders, "content-type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ metadata }),
    });
  }

  // F3b: fold world deltas from this page into books.bible.facts (best-effort).
  await bridgeMaybeFoldWorldFacts(bookId, pageId).catch((e) => console.error("bridge: world-facts fold failed (non-fatal):", e.message));
}

// F3b: fold extracted_delta entries of type "world" from this page into books.bible.facts.
// Mirrors maybeFoldWorldFacts in generate-unit-core.ts.
async function bridgeMaybeFoldWorldFacts(bookId, pageId) {
  const gp = await fetch(`${SUPABASE_URL}/rest/v1/pages?id=eq.${pageId}&select=page_index,metadata`, { headers: sbHeaders });
  const pg = (await gp.json())?.[0];
  if (!pg) return;
  const worldDeltas = (pg.metadata?.extracted_delta ?? []).filter((d) => d.type === "world");
  if (!worldDeltas.length) return;

  const gb = await fetch(`${SUPABASE_URL}/rest/v1/books?id=eq.${bookId}&select=bible`, { headers: sbHeaders });
  const bookRow = (await gb.json())?.[0];
  const existingBible = (bookRow?.bible ?? {});
  const existingFacts = Array.isArray(existingBible.facts) ? existingBible.facts : [];
  const existingTexts = new Set(existingFacts.map((f) => f.fact.trim().toLowerCase()));
  const newFacts = [];
  for (const d of worldDeltas) {
    const factText = d.to?.trim() || `${d.subject}: ${d.to}`.trim();
    if (!factText || existingTexts.has(factText.toLowerCase())) continue;
    existingTexts.add(factText.toLowerCase());
    newFacts.push({ fact: factText, page_index: pg.page_index });
  }
  if (!newFacts.length) return;
  await fetch(`${SUPABASE_URL}/rest/v1/books?id=eq.${bookId}`, {
    method: "PATCH",
    headers: { ...sbHeaders, "content-type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ bible: { ...existingBible, facts: [...existingFacts, ...newFacts] } }),
  });
}

// F3b: build open-loops block from book_thread_anchors (fixes the dropped flat-column bug).
// Mirrors buildOpenLoops in generate-unit-core.ts.
async function bridgeBuildOpenLoops(bookId, pages, current) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/book_threads?book_id=eq.${bookId}&select=name,description,book_thread_anchors(page_id,role)`, { headers: sbHeaders });
  if (!r.ok) return null;
  const threads = (await r.json()) ?? [];
  if (!threads.length) return null;

  const pageIndexOf = (pid) => {
    if (pid == null) return null;
    const p = pages.find((x) => x.id === pid);
    return p ? p.page_index : null;
  };
  const ci = current.page_index;
  const lines = [];
  for (const t of threads) {
    const anchors = t.book_thread_anchors ?? [];
    const desc = t.description ? ` — ${t.description}` : "";
    if (anchors.some((a) => a.page_id === current.id && a.role === "promise")) {
      lines.push(`- SEED "${t.name}"${desc}: plant this naturally; it pays off LATER, so do NOT resolve it here.`);
      continue;
    }
    if (anchors.some((a) => a.page_id === current.id && a.role === "resolution")) {
      lines.push(`- PAY OFF "${t.name}"${desc}: deliver this promise here; make it feel earned.`);
      continue;
    }
    const promisePageId = anchors.find((a) => a.role === "promise")?.page_id ?? null;
    const resolutionPageId = anchors.find((a) => a.role === "resolution")?.page_id ?? null;
    const si = pageIndexOf(promisePageId);
    const pi = pageIndexOf(resolutionPageId);
    if (si != null && si < ci && (pi == null || pi > ci)) {
      lines.push(`- WITHHOLD "${t.name}"${desc}: already in play; keep it alive but do NOT resolve it here.`);
    }
  }
  return lines.length ? `OPEN LOOPS (promises in play on this page — manage them deliberately):\n${lines.join("\n")}` : null;
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

// Body text excluding the leading title heading — decides if a page is still "empty".
function bgBodyText(content) {
  if (!content || typeof content !== "object") return typeof content === "string" ? content.trim() : "";
  if (!Array.isArray(content.content)) return "";
  const nodes = content.content[0]?.type === "heading" ? content.content.slice(1) : content.content;
  return nodes.map((n) => tiptapToText(n)).join("").trim();
}

// ── Plan-provenance stamping (port of _shared/plan-provenance.ts) ─────────────
// The single-page bridge routes return text and let the CLIENT stamp the dirty-graph edges; the bulk
// generate-book route has no client in the loop, so it stamps them itself. metaHash MUST stay
// byte-for-byte identical to apps/web/src/lib/planProvenance.ts (the same texts are hashed in both).
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
function metaHash(text) {
  return cyrb53(String(text ?? "").trim().replace(/\s+/g, " ")).toString(16);
}

async function readMeta(pageId) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/pages?id=eq.${pageId}&select=metadata`, { headers: sbHeaders });
  return (await r.json())?.[0]?.metadata ?? {};
}
async function patchMeta(pageId, metadata) {
  await fetch(`${SUPABASE_URL}/rest/v1/pages?id=eq.${pageId}`, {
    method: "PATCH",
    headers: { ...sbHeaders, "content-type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ metadata }),
  });
}
// Persist a fresh beat + stamp the objective→beat edge (mirrors stampBeat).
async function stampBeatMeta(pageId, objective, beat) {
  const metadata = await readMeta(pageId);
  metadata.beat = beat;
  metadata.sync = { ...(metadata.sync ?? {}), objective_beat: { p: metaHash(objective), c: metaHash(beat) } };
  await patchMeta(pageId, metadata);
}
// Stamp prose provenance after prose is written (mirrors stampProse). Reads metadata fresh so it
// preserves the summary runUnit just persisted.
async function stampProseMeta(pageId, objective, prose) {
  const metadata = await readMeta(pageId);
  const beat = typeof metadata.beat === "string" ? metadata.beat.trim() : "";
  if (beat) {
    metadata.sync = { ...(metadata.sync ?? {}), beat_prose: { p: metaHash(beat), c: metaHash(prose ?? "") } };
    delete metadata.prose_src_hash;
  } else {
    metadata.prose_src_hash = metaHash(objective);
    if (metadata.sync) delete metadata.sync.beat_prose;
  }
  await patchMeta(pageId, metadata);
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
function runClaude(prompt, captureStdout = false, meta = null, { noTools = false, model = null } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    // Insert the 'running' row up front so the call shows in /admin while in flight (the close
    // handler below updates it to done/error). logId is a promise; close() awaits it.
    const logIdP = meta ? logAiStart({ ...meta, prompt }) : Promise.resolve(null);
    const args = ["-p", prompt, ...CLAUDE_FLAGS, ...(model ? ["--model", model] : []), ...(noTools ? ["--tools", ""] : [])];
    console.log(`→ claude -p "${prompt.slice(0, 80).replace(/\n/g, " ")}…"`);
    try {
      const ts = new Date().toISOString();
      const fn = meta?.fn ?? "unknown";
      const bookId = meta?.bookId ?? "—";
      const mdl = model ?? "default";
      const header = `\n${"═".repeat(80)}\n[${ts}]  fn=${fn}  book=${bookId}  model=${mdl}  noTools=${noTools}\n${"─".repeat(80)}\n`;
      appendFileSync(join(repoRoot, "bridge-calls.log"), header + prompt + "\n");
    } catch { /* non-fatal */ }
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

// Level → full permission sentence. Mirrors HEAT_LEVEL_SENTENCES in supabase/functions/_shared/brief.ts.
const HEAT_LEVEL_SENTENCES = {
  closed: "Closed-door — fade before explicit content; intimacy implied, not shown.",
  warm: "Warm — sensual and on the page (desire, touch, tension) but not graphic.",
  explicit: "EXPLICIT — graphic and on the page; depict intimacy fully.",
};

// Render the binding non-voice deliverables as an imperative MANDATE block.
// Mirrors mandateContext in supabase/functions/_shared/brief.ts.
// Returns "" when none of the mandate fields are present.
function mandateContext(brief) {
  if (!brief) return "";
  const lines = [];
  if (brief.success_criteria?.trim()) {
    lines.push(`- Must deliver on: ${brief.success_criteria.trim()}`);
  }
  // C5: derive the AI heat instruction from the author's content_type (legacy `heat` honored).
  const ct = brief.content_type ?? brief.heat;
  if (ct) {
    const level = typeof ct === "string" ? undefined : ct.level;
    const note = typeof ct === "string" ? undefined : ct.note;
    const sentence = level
      ? (HEAT_LEVEL_SENTENCES[level] ?? level)
      : (typeof ct === "string" ? ct.trim() : "");
    const heatStr = [sentence, note].filter(Boolean).join(" — ");
    if (heatStr) lines.push(`- Heat / explicitness: ${heatStr}`);
  }
  if (brief.scope?.band) {
    const wt = brief.scope.word_target ? ` of ≈${brief.scope.word_target} words` : "";
    lines.push(`- Length: this is a ${brief.scope.band}${wt} — write to that length; do not stop short.`);
  }
  if (brief.genre?.trim()) {
    lines.push(`- Genre obligation: honor the "${brief.genre.trim()}" promise FULLY and ON THE PAGE — e.g. a comedy must stay funny throughout, an ecchi/romance must actually be sensual on the page, never fade to black at the decisive moment.`);
  }
  return lines.join("\n");
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

Preserve the brief's MANDATE — heat/explicitness, comedy, and set-piece specifics — verbatim. The layer you write must be AT LEAST as committed as its source: never soften, abstract, or fade-to-black a mandated beat. If the brief calls for something explicit, sensual, or funny, that obligation must survive into your output, not get laundered into tasteful vagueness.

Choose a structure appropriate to the genre and scope (e.g. Save the Cat or the Hero's Journey for commercial fiction; the Fichtean curve for thrillers; a five-part arc for self-help; a curated arc for memoir). Lay the book out as an ordered list of pages:
- "section" pages are chapter/part dividers (a title; an objective is optional).
- "text" pages are where prose will go; each MUST have a concise objective stating what that page must achieve (the beat it delivers, in one sentence).

Keep the size proportional to the scope: a short story is a handful of text pages; a novel is chapters (section pages) each followed by several text pages.

Output JSON ONLY (no prose, no fences), exactly:
{ "structure": "<the structure you chose>", "pages": [ { "pageType": "section", "title": "...", "objective": "" }, { "pageType": "text", "title": "...", "objective": "..." } ] }`;

// Mirrors FOUNDATIONS_ADDENDUM in supabase/functions/spine-to-objectives (pin-driven flow §3.4).
const SCAFFOLD_FOUNDATIONS_ADDENDUM = `

This book has SETTLED FOUNDATIONS (argument, ending, cast, tentpole moments — given in the input).
Honor them as hard constraints: anything marked PINNED is the author's and must survive verbatim
into the plan; KILLED directions must not appear.

Two additions to your output:

1. Each "text" page also gets "delta" — what this page CHANGES in the narrative state (1–3 entries,
   coarse). A page that changes nothing is a dead page; don't plan one. Each entry:
   { "type": "character" | "thread" | "value" | "world",
     "subject": "<character name / thread name / value name / world fact>",
     "from": "<state before (optional)>", "to": "<state after>" }

2. Top-level "tentpolePlacements": place EVERY non-killed tentpole moment on exactly ONE text page
   (the page whose objective realizes that moment). Pinned tentpoles MUST all be placed.
   [{ "tentpoleId": "<the tentpole's [id] from the input>", "pageIndex": <index into pages[]> }]`;

async function runScaffold(bookId) {
  const book = await fetchBook(bookId);
  if (!book) return { error: "Book not found" };
  const spine = book.spine?.text?.trim() || null;
  const foundations = book.foundations ?? null;

  const _soMandate = mandateContext(book.brief);
  const prompt = `${SCAFFOLD_INSTRUCTIONS}${foundations ? SCAFFOLD_FOUNDATIONS_ADDENDUM : ""}

BOOK: ${book.name}${spine ? `\n\nBOOK SPINE (the throughline — the outline must realize this):\n${spine}` : ""}

BRIEF — binding contract (voice AND deliverables):
${briefContext(book.brief)}${_soMandate ? `\n\nMANDATE — NON-NEGOTIABLE (the book has FAILED if any of these are not delivered; do not treat them as flavor):\n${_soMandate}` : ""}${canonSection(book.canon)}${foundations ? `\n\nSETTLED FOUNDATIONS (pinned items are immutable constraints):\n${foundationsContext(foundations)}` : ""}

Design the outline. JSON only.`;

  const out = await runClaude(prompt, true, { fn: "spine-to-objectives", bookId }, { noTools: true, model: MODEL_PLANNING });
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
    const DELTA_TYPES = new Set(["character", "thread", "value", "world"]);
    const cleanDelta = (arr) => {
      if (!Array.isArray(arr)) return undefined;
      const out = arr
        .filter((d) => d && DELTA_TYPES.has(d.type) && typeof d.subject === "string" && d.subject.trim() && typeof d.to === "string" && d.to.trim())
        .map((d) => ({ type: d.type, subject: d.subject.trim(), to: d.to.trim(), ...(typeof d.from === "string" && d.from.trim() ? { from: d.from.trim() } : {}) }));
      return out.length ? out : undefined;
    };
    parsed.pages = parsed.pages
      .filter((p) => p && (p.pageType === "section" || p.pageType === "text") && typeof p.title === "string")
      .map((p) => {
        const d = p.pageType === "text" ? cleanDelta(p.delta) : undefined;
        return { pageType: p.pageType, title: p.title.trim(), objective: (p.objective ?? "").trim(), ...(d ? { delta: d } : {}) };
      });
    const n = parsed.pages.length;
    const tentpolePlacements = (Array.isArray(parsed.tentpolePlacements) ? parsed.tentpolePlacements : [])
      .filter((tp) => tp && typeof tp.tentpoleId === "string" && tp.tentpoleId.trim() &&
        Number.isInteger(tp.pageIndex) && tp.pageIndex >= 0 && tp.pageIndex < n && parsed.pages[tp.pageIndex].pageType === "text")
      .map((tp) => ({ tentpoleId: tp.tentpoleId.trim(), pageIndex: tp.pageIndex }));
    return { structure: String(parsed.structure ?? "").trim(), pages: parsed.pages, tentpolePlacements };
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

  const out = await runClaude(prompt, true, { fn: "generate-bible", bookId }, { noTools: true, model: MODEL_PLANNING });
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

  const out = await runClaude(prompt, true, { fn: "generate-voice", bookId }, { noTools: true, model: MODEL_PROSE });
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

  const out = await runClaude(prompt, true, { fn: "revise-outline", bookId }, { noTools: true, model: MODEL_PLANNING });
  if (out.error) return out;
  return parsePlan(out.text, pages, planOnly);
}

// ── /revise-beats ─────────────────────────────────────────────────────────────
// Mirrors supabase/functions/revise-beats: instruction and/or a knowledge-base LENS -> a reviewable
// beat-sheet revision plan (each page carries objective AND beat). Always plan-only. NO mutation.
const REVISE_BEATS_INSTRUCTIONS = `You are a book doctor revising a book's BEAT SHEET — the ordered spine of beats that decides whether the story actually works. Beats are the load-bearing layer: they determine whether the outline (and even the premise) holds. Prose is replaceable and is NOT your concern here.

You work in two coupled layers per page:
- OBJECTIVE — what the page must achieve (its contract).
- BEAT — the concrete dramatic unit that fulfills it (what happens, to whom, the turn/change).

You are given: the brief, the spine, the settled FOUNDATIONS (argument, ending, cast with want/wound/lie, tentpoles), the CURRENT BEAT SHEET (each page with its real [id], type, title, objective, beat), any tracked threads, the author's INSTRUCTION, and — optionally — a STRUCTURAL LENS to diagnose against.

Diagnose what the beat sheet needs and produce a REVISION PLAN: the book's NEW page list in final reading order, plus existing pages to delete. You may: rewrite a beat (keep the page; supply a stronger "beat"); retarget an objective (op "retarget"; supply the new "objective" AND a "beat"); ADD a page (op "add") — including a CHARACTER-INTRODUCTION beat where a character appears with no proper introduction, or a missing structural beat (a real midpoint, an escalation, a payoff); DELETE a page (list it in "deletes") — cut redundant/inert/pace-killing beats; REORDER by placing entries in the desired final order; mark a section "add"/"delete" to add/remove a CHAPTER.

Rules:
- Use ONLY the real [id]s given. Every existing page MUST appear in "pages" (with its ref) or in "deletes" — never drop a page silently.
- "section" pages are dividers; "text" pages carry a beat. Give every text page an objective AND a beat.
- Be SURGICAL. Mark "keep" (carry title/objective/beat forward) for beats that already work; change only what the instruction/lens demands.
- The BRIEF, SPINE, and pinned FOUNDATIONS win over any lens. A lens is a diagnostic frame to find what's MISSING or SAGGING — never a template to force the book into. Respect pinned cast lines and the settled ending.
- TRACKED THREADS are promises: do NOT delete or move a page that sets up or pays off an open thread without relocating that beat.
- PLAN-ONLY: never write prose, never use a "revise" op, never set "rebuild". Note PACE in each changed entry's "why".

Output JSON ONLY (no prose, no fences), exactly:
{ "summary": "...", "pages": [ { "ref": <id|null>, "op": "keep|retarget|add", "pageType": "section|text", "title": "...", "objective": "...", "beat": "...", "why": "..." } ], "deletes": [ { "ref": <id>, "why": "..." } ] }`;

// The condensed beat skeletons — mirrors supabase/functions/_shared/lens.ts (keep faithful).
const LENS_BLOCKS = {
  "save-the-cat": `STRUCTURAL LENS — Save the Cat! Beat Sheet (commercial fiction; tight, measurable pacing).\nUse as a DIAGNOSTIC FRAME, not a template; the brief/spine/foundations win.\n1 Opening Image (0–1%) · 2 Theme Stated (~5%) · 3 Setup (1–10%) · 4 Catalyst (~10%) · 5 Debate (10–20%) · 6 Break Into 2 (~20%) · 7 B Story (~22%) · 8 Fun and Games (20–50%) · 9 Midpoint (~50%, false victory/defeat) · 10 Bad Guys Close In (50–75%) · 11 All Is Lost (~75%) · 12 Dark Night of the Soul (75–80%) · 13 Break Into 3 (~80%) · 14 Finale (80–99%) · 15 Final Image (99–100%, inverse of opening).\nBest at catching: a mechanical/missing Midpoint, a Theme-Stated↔Final-Image pair that don't answer each other, Fun-and-Games that doesn't deliver the genre's appeal.`,
  "story-circle": `STRUCTURAL LENS — Dan Harmon's Story Circle (character-driven, episodic; a lighter monomyth).\nUse as a DIAGNOSTIC FRAME, not a template.\n1 You (comfort) · 2 Need · 3 Go (cross threshold) · 4 Search (adapt to chaos) · 5 Find · 6 Take (the load-bearing beat — pay a heavy price) · 7 Return · 8 Change.\nBest at catching: a step-6 Take that costs nothing (the circle doesn't turn), a step-8 that returns the character unchanged.`,
  "heros-journey": `STRUCTURAL LENS — The Hero's Journey (fantasy/sci-fi/epic; one transformative protagonist).\nUse as a DIAGNOSTIC FRAME, not a template.\n1 Ordinary World · 2 Call to Adventure · 3 Refusal · 4 Meeting the Mentor · 5 Crossing the First Threshold · 6 Tests, Allies, Enemies · 7 Approach to the Inmost Cave · 8 The Ordeal (~midpoint) · 9 Reward · 10 The Road Back · 11 The Resurrection (climax) · 12 Return with the Elixir.\nBest at catching: an underwritten Mentor (4) and Resurrection (11); a passive hero who doesn't CHOOSE the threshold or EARN the resurrection.`,
  "fichtean-curve": `STRUCTURAL LENS — The Fichtean Curve (thrillers/mystery/suspense; relentless momentum).\nUse as a DIAGNOSTIC FRAME, not a template.\n1 Open in medias res (crisis on page one; no first-act world-building) · 2 Weave backstory into conflict (exposition inside tension) · 3 Build through 3+ escalating crises with brief mini-resolutions (tension floor rises each time) · 4 Spike to the climax · 5 Compress the denouement.\nBest at catching: an opening that establishes normalcy; flat escalation (crisis #3 no bigger than #1); a bloated tidy ending.`,
  "romancing-the-beat": `STRUCTURAL LENS — Romancing the Beat (romance / any relationship-centered story).\nUse as a DIAGNOSTIC FRAME, not a template.\n1 Meet Cute/Ugly · 2 The "No Way" (each lead's wound says it's impossible) · 3 Adhesion (a device that stops them walking away) · 4 The Dark Night / Black Moment (relationship shatters) · 5 The Grand Gesture & Wake-Up · 6 HEA/HFN (mandatory positive payoff).\nBest at catching: a breakup (4) with no real cost; plot that doesn't pressure the RELATIONSHIP; a weak Adhesion (3) that stalls the middle.`,
};

// Parse + sanitize, carrying the beat per page (mirrors _shared/revision-plan.ts with beat).
function parseBeatPlan(text, existing) {
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
  const ops = new Set(["keep", "retarget", "add"]);
  const seen = new Set();
  const pages = [];
  for (const p of parsed.pages) {
    let op = ops.has(p?.op) ? p.op : "keep"; // plan-only: collapse any other op to keep
    if (op === "add") {
      if (typeof p.title !== "string" || !p.title.trim()) continue;
      pages.push({ ref: null, op: "add", pageType: p.pageType === "section" ? "section" : "text", title: p.title.trim(), objective: (p.objective ?? "").trim(), beat: (p.beat ?? "").trim() || undefined, why: typeof p.why === "string" ? p.why.trim() : "" });
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
      beat: ((p.beat ?? cur.metadata?.beat ?? "").trim()) || undefined,
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
      pages.push({ ref: p.id, op: "keep", pageType: p.page_type === "section" ? "section" : "text", title: p.title ?? "", objective: (p.metadata?.objective ?? "").trim(), beat: ((p.metadata?.beat ?? "").trim()) || undefined, why: "" });
    }
  }
  return { summary: String(parsed.summary ?? "").trim(), pages, deletes, planOnly: true };
}

function beatSheetContext(pages) {
  return pages
    .map((p) => {
      if (p.page_type === "section") return `[id=${p.id}] # ${p.title || "(untitled section)"}`;
      const obj = p.metadata?.objective?.trim();
      const beat = p.metadata?.beat?.trim();
      let line = `[id=${p.id}] - "${p.title || "(untitled)"}"`;
      if (obj) line += `\n  objective: ${obj}`;
      line += beat ? `\n  beat: ${beat}` : `\n  beat: (none yet)`;
      return line;
    })
    .join("\n");
}

async function runReviseBeats(bookId, instruction, lens) {
  const book = await fetchBook(bookId);
  if (!book) return { error: "Book not found" };
  const instr = (instruction ?? "").trim();
  const lensId = (lens ?? "").trim() || null;
  if (!instr && !lensId) return { error: "An instruction or a structural lens is required" };

  const pages = await fetchPages(bookId);
  if (!pages.length) return { error: "Book has no pages to revise" };

  const f = book.foundations ?? null;
  const spineText = book.spine?.text?.trim() || null;
  const lensBlock = lensId ? LENS_BLOCKS[lensId] : null;

  const prompt = `${REVISE_BEATS_INSTRUCTIONS}

BOOK: ${book.name}

BRIEF (the voice contract):
${briefContext(book.brief)}${spineText ? `\n\nSPINE (the book in one arc):\n${spineText}` : ""}${f ? `\n\nFOUNDATIONS (settled — pinned lines are immutable):\n${foundationsContext(f)}` : ""}

CURRENT BEAT SHEET (edit against these real ids):
${beatSheetContext(pages)}${instr ? `\n\nAUTHOR'S INSTRUCTION (primary directive):\n${instr}` : ""}${lensBlock ? `\n\n${lensBlock}` : ""}

Produce the beat revision plan. JSON only.`;

  const out = await runClaude(prompt, true, { fn: "revise-beats", bookId }, { noTools: true, model: MODEL_PLANNING });
  if (out.error) return out;
  return parseBeatPlan(out.text, pages);
}

// ── /beats-agent ──────────────────────────────────────────────────────────────
// Mirrors supabase/functions/beats-agent: the conversational BEAT EDITOR. One model call per author
// message; returns a JSON envelope { reply, plan }. Single writer of the beat_chats thread.
const BEAT_CRITERIA = `FICTION CRITERIA — the beat-relevant slice (judge the PLAN, not prose). Identify the genre contract first.
1. CHARACTER — protagonist proactivity (clear want + need, drives beats; red flag: passive); character arc (measurable before/after tied to plot); cast differentiation & function; character–plot integration (consequences flow from decisions).
2. PLOT — opening hook (a question, fast tone/genre); plot logic (reveals inevitable in hindsight, setups pay off, no deus ex machina); obligatory scenes (the premise/genre's promised scenes are present + weighted); stakes (concrete, escalating); beat necessity (every beat advances plot/character/theme; red flag: detachable/redundant beats).
3. PACING — ebb and flow (speed matches the moment; red flag: uniform pacing, stalled middle, rushed ending); each beat earns its space.
4. GENRE CONTRACT — the beat sheet honors the declared genre's core promise beat for beat.
5. THEME — the argument is dramatized through choice/cost/consequence, not asserted.`;

const BEATS_AGENT_INSTRUCTIONS = `You are the BEAT EDITOR — a sharp, warm developmental editor in conversation with an author about their book's BEAT SHEET (objectives + beats per page). Beats are the load-bearing layer; prose is downstream and replaceable — never your concern.

You choose per message: TALK (answer, summarize, talk through — be specific, cite real pages by title, never generic); EVALUATE against the FICTION CRITERIA when asked or when it's the honest answer (name the criterion, point at exact pages, say what's strong and what sags, end with the highest-leverage fix); or PROPOSE A CHANGE — a beat REVISION PLAN (rewrite beats, retarget objectives, add pages incl. a missing midpoint/escalation/character-introduction, delete inert pages, reorder). The author reviews and applies it — you never mutate anything.

OUTPUT — reply to the author in plain MARKDOWN prose (use **bold**, lists, and line breaks freely). If — and ONLY if — this message proposes a change to the beat sheet, append at the very END a single fenced \`\`\`json code block holding the plan, with nothing after it:
\`\`\`json
{ "summary": "...", "pages": [ { "ref": <id|null>, "op": "keep|retarget|add", "pageType": "section|text", "title": "...", "objective": "...", "beat": "...", "why": "..." } ], "deletes": [ { "ref": <id>, "why": "..." } ] }
\`\`\`
When you are talking, evaluating, or answering — append NO code block. When you do propose, the prose above briefly says what changed.
- PLAN RULES: use ONLY real [id]s; every existing page MUST appear in "pages" or "deletes" — never drop one silently. "section" = divider; "text" pages carry an objective AND a beat. Reorder by final order. Be surgical ("keep" what works). Honor pinned foundations and tracked-thread anchors. Never write prose; never use a "revise" op.`;

async function getBeatChat(bookId) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/beat_chats?book_id=eq.${bookId}&select=id,messages,pending_plan`, { headers: sbHeaders });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return (await r.json())?.[0] ?? null;
}
async function upsertBeatChat(bookId, existingId, patch) {
  if (existingId) {
    await fetch(`${SUPABASE_URL}/rest/v1/beat_chats?id=eq.${existingId}`, {
      method: "PATCH", headers: { ...sbHeaders, "content-type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(patch),
    });
    return existingId;
  }
  const r = await fetch(`${SUPABASE_URL}/rest/v1/beat_chats`, {
    method: "POST", headers: { ...sbHeaders, "content-type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ book_id: bookId, ...patch }),
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return (await r.json())?.[0]?.id ?? null;
}

async function runBeatsAgent(bookId, message) {
  const msg = (message ?? "").trim();
  if (!msg) return { error: "message is required" };
  const book = await fetchBook(bookId);
  if (!book) return { error: "Book not found" };
  const pages = await fetchPages(bookId);

  const existing = await getBeatChat(bookId);
  const history = Array.isArray(existing?.messages) ? existing.messages : [];
  const withUser = [...history, { role: "user", text: msg, ts: new Date().toISOString() }];
  const chatId = await upsertBeatChat(bookId, existing?.id, { messages: withUser, status: "thinking", error: null });

  try {
    // "Plan all beats" is a bulk generation op that times out when sent as a single claude -p call.
    // Writes each beat directly to the DB so the author sees them arrive in real-time.
    if (msg.startsWith("Plan a beat for every page that has an objective but no beat")) {
      console.log(`planAllBeatsLocal (beats-agent) for book ${bookId} (${pages.length} pages)…`);
      const { reply } = await planAllBeatsLocal(bookId, pages, {
        onProgress: async (done, total) => {
          const prog = { role: "assistant", text: `Planning beats… ${done}/${total}`, ts: new Date().toISOString() };
          await upsertBeatChat(bookId, chatId, { messages: [...withUser, prog], status: "thinking" });
        },
      });
      const assistant = { role: "assistant", text: reply, ts: new Date().toISOString() };
      await upsertBeatChat(bookId, chatId, { messages: [...withUser, assistant], status: "idle" });
      return { reply, plan: null };
    }

    const f = book.foundations ?? null;
    const spineText = book.spine?.text?.trim() || null;
    const context =
      `BOOK: ${book.name}\n\nBRIEF (the voice contract):\n${briefContext(book.brief)}` +
      (spineText ? `\n\nSPINE:\n${spineText}` : "") +
      (f ? `\n\nFOUNDATIONS (settled — pinned lines are immutable):\n${foundationsContext(f)}` : "") +
      `\n\nCURRENT BEAT SHEET (real page ids):\n${beatSheetContext(pages)}` +
      `\n\nFICTION CRITERIA (use when evaluating):\n${BEAT_CRITERIA}`;
    const transcript = withUser.slice(-24).map((m) => `${m.role === "user" ? "AUTHOR" : "EDITOR"}: ${m.text}`).join("\n\n");
    const prompt = `${BEATS_AGENT_INSTRUCTIONS}\n\n${context}\n\n— — — CONVERSATION SO FAR — — —\n${transcript}\n\nRespond to the latest AUTHOR message.`;

    const out = await runClaude(prompt, true, { fn: "beats-agent", bookId }, { noTools: true, model: MODEL_PLANNING });
    if (out.error) throw new Error(out.error);

    // Prose is markdown; a proposed change rides in a TRAILING ```json block (mirrors beats-agent edge fn).
    let reply = out.text.trim(), plan = null;
    const m = out.text.match(/```(?:json)?\s*([\s\S]*?)```\s*$/);
    if (m && m.index != null) {
      const before = out.text.slice(0, m.index).trim();
      const parsed = parseBeatPlan(m[1], pages);
      if (parsed && !parsed.error) { plan = parsed; reply = before || "Here's a proposed revision — review it below."; }
    }

    const assistant = { role: "assistant", text: reply, ts: new Date().toISOString(), plan: plan?.summary };
    await upsertBeatChat(bookId, chatId, {
      messages: [...withUser, assistant],
      pending_plan: plan ?? existing?.pending_plan ?? null,
      status: "idle",
    });
    return { reply, plan };
  } catch (e) {
    await upsertBeatChat(bookId, chatId, { status: "error", error: String(e?.message ?? e).slice(0, 500), messages: withUser });
    return { error: String(e?.message ?? e) };
  }
}

// ── /revise-chat ──────────────────────────────────────────────────────────────
// Mirrors supabase/functions/revise-chat + _shared/revision-chat.ts: ONE conversational reviser
// parameterized by LAYER (foundations | spine | beats). One model call per author message; single
// writer of the (book, layer) revision_chats thread. A proposed change rides in pending_proposal as a
// { summary, patch:{ layer, data } } envelope.
const SPINE_AGENT_INSTRUCTIONS = `You are the SPINE EDITOR — a developmental editor in conversation with an author about their book's SPINE: the whole book as ONE causal arc (~250-500 words), from beginning, through its tentpole moments, to its settled ending. The beat sheet and prose are downstream — not your concern.

You choose per message: TALK; PRESSURE-TEST the spine's integrity (does it realize the argument and land the settled ending? every pinned tentpole placed? causal chain unbroken — therefore/but, not and-then? midpoint a real turn? — name the weak link + highest-leverage fix); or PROPOSE A CHANGE — the full revised spine (still realizing the argument, landing the settled ending, passing through every PINNED tentpole; pinned foundations immutable).

OUTPUT — reply in plain MARKDOWN. If — and ONLY if — proposing a change, append at the very END a single fenced \`\`\`json block, nothing after it:
\`\`\`json
{ "summary": "<one line: what changed and why>", "text": "<the full revised spine, ~250-500 words>" }
\`\`\`
When talking or pressure-testing, append NO code block. "text" is the COMPLETE new spine. Never write beats or prose.`;

const OUTLINE_AGENT_INSTRUCTIONS = `You are the OUTLINE EDITOR — a developmental editor in conversation with an author about their book's OUTLINE: the ordered structure of CHAPTERS (sections) and PAGES, and a clear OBJECTIVE for each page (what that page must accomplish for the story). The outline turns the spine into a page-by-page plan. BEATS and PROSE are downstream — NOT your concern: never write a beat or prose.

You can do these things, and you choose per message:
1. TALK — answer, talk through structure, weigh a trade-off. Be specific; cite real pages by title.
2. PRESSURE-TEST — when asked (or when honest): does the sequence realize the spine? does every page earn its place with a real objective? are the chapters shaped well? is anything missing (a setup, an escalation) or redundant? Name the weak link and the highest-leverage fix.
3. GENERATE — when there is NO outline yet (or the author asks to draft / create one): UNLESS they've settled on a shape, FIRST offer 2–3 distinct structural shapes the outline could take (different chapter breaks / pacing on the SAME spine) as short prose sketches, NO json, and invite a pick. Once chosen (or asked outright), deliver the full outline plan.
4. PROPOSE A CHANGE — when the author wants the outline drafted or changed (or you've agreed on a fix): produce an outline REVISION PLAN. You may add pages and chapters (sections), retarget objectives, delete redundant pages, and reorder. The author reviews and applies it — you mutate nothing.

OUTPUT — reply to the author in plain MARKDOWN prose. If — and ONLY if — this message DELIVERS an outline plan to apply, append at the very END a single fenced \`\`\`json code block holding the plan, with nothing after it:
\`\`\`json
{ "summary": "...", "pages": [ { "ref": <id|null>, "op": "keep|retarget|add", "pageType": "section|text", "title": "...", "objective": "...", "why": "..." } ], "deletes": [ { "ref": <id>, "why": "..." } ] }
\`\`\`
When talking, pressure-testing, or merely OFFERING SHAPES to choose from, append NO code block.
- PLAN RULES: use ONLY the real [id]s given; every existing page MUST appear in "pages" (with its ref) or in "deletes" — never drop one silently. "section" = chapter/part divider (no objective); "text" pages each need an OBJECTIVE. Reorder by placing entries in final order. Be surgical — "keep" what works. NEVER write a "beat" field, never write prose, never use a "revise" op. Honor pinned foundations and the spine.`;

const FOUNDATIONS_AGENT_INSTRUCTIONS = `You are the FOUNDATIONS EDITOR — a developmental editor in conversation with an author about their book's FOUNDATIONS: the ARGUMENT (the claim the whole story argues), the ENDING, the CAST (each with want / wound / lie, plus an optional history, idiolect, and physical tag), the RELATIONSHIPS between cast members, the WORLD (setting / period / rules), the NARRATION mode (person / tense / distance), the TENTPOLE MOMENTS, and the VOICE exemplar. Foundations sit just under the brief — the brief is the frozen contract and is NEVER yours to touch. The spine, beats, and prose are downstream — not your concern.

You can do these things, and you choose per message:
1. TALK — answer, talk through an idea, weigh a trade-off. Be specific.
2. PRESSURE-TEST — test the foundations' integrity: is the argument a real claim (not a topic)? does the ending pay the argument's cost? does each cast member's want/wound/lie cohere and drive an arc? do the tentpoles BOTH dramatize the argument AND deliver the brief's genre promise on the page? (For a heat/comedy/genre-forward brief the tentpole bank IS the genre engine — its first job is the genre's core appeal rendered explicitly, not argument-proof; NEVER treat that engine as a weakness to "balance away" with stakes/plot, and any new tentpoles must keep the genre mix the brief demands.) Name the weak link and the highest-leverage fix.
3. GENERATE — when the foundations are largely EMPTY (or the author asks to draft / create / explore them): UNLESS the author has already settled on a direction, FIRST offer 2–3 DISTINCT directions the foundations could take — each a different ARGUMENT and the ending, cast shape, and signature moments it implies — as short prose sketches (numbered), with NO json block, and invite the author to pick or blend. Only once the author has chosen (or asked outright for the full draft) do you deliver the complete foundations (as in PROPOSE).
4. PROPOSE A CHANGE — when the author wants foundations drafted or changed (or you've agreed on a fix / they've picked a direction). You may set/revise the ARGUMENT, ENDING, and VOICE text; add/revise CAST members (including each one's history, idiolect, and physical tag); add/revise the RELATIONSHIPS between them; set/revise the WORLD (setting, period, rules); set/revise the NARRATION mode (person: first/close-third/omniscient, tense: past/present, and an optional distance note); and add/revise/reorder TENTPOLE moments. PINNED lines, pinned cast fields, pinned relationships, a pinned world, and a pinned narration are IMMUTABLE — never change or drop them. Honor the brief.

OUTPUT — reply to the author in plain MARKDOWN. If — and ONLY if — this message DELIVERS foundations to apply (a fresh draft or a revision), append at the very END a single fenced \`\`\`json code block, with nothing after it. Include ONLY the keys you are setting (a fresh draft sets all of them):
\`\`\`json
{ "summary": "<one line: what changed and why>",
  "argument": "<~2 sentence claim>",
  "ending": "<the ending, concrete>",
  "voice": "<the voice exemplar prose>",
  "cast": [ { "id": "<existing id, or omit for a new member>", "name": "...", "role": "protagonist|major|minor", "want": "...", "wound": "...", "lie": "...", "history": "<formative backstory that colors how they speak & what they notice>", "idiolect": "<how they speak — diction, tics, register>", "tag": "<a trackable physical or gesture marker>" } ],
  "relationships": [ { "id": "<existing id, or omit for new>", "a": "<cast id or exact name>", "b": "<cast id or exact name>", "bond": "<the charge between them, one line>" } ],
  "world": { "setting": "...", "period": "...", "rules": ["<a load-bearing constraint prose must respect>", "..."] },
  "narration": { "person": "first|close-third|omniscient", "tense": "past|present", "distance": "<optional one-line note on psychic distance>" },
  "tentpoles": [ { "id": "<existing id, or omit for new>", "text": "<the moment>", "status": "pinned|fluid" } ] }
\`\`\`
When talking or pressure-testing, append NO code block. If you send "cast", "tentpoles", or "relationships", send the COMPLETE list (every item that should remain) — anything omitted is dropped, except pinned/killed items which always survive. Use existing [id]s to revise an item; omit id to add. history/idiolect/tag are optional and not pinnable — set them freely. For a relationship to a brand-new member, reference that member by their exact name in "a"/"b". Never touch the brief; never write spine, beats, or prose.`;

// Port of _shared/revision-chat.ts sanitizeFoundations — pin-honoring merge of a proposed patch.
function sanitizeFoundationsPatch(parsed, f) {
  const patch = {};
  const trim = (v) => (typeof v === "string" ? v.trim() : "");
  if (typeof parsed.argument === "string" && !f.argument?.pinned) { const t = trim(parsed.argument); if (t) patch.argument = t; }
  if (typeof parsed.ending === "string" && !f.ending?.pinned) { const t = trim(parsed.ending); if (t) patch.ending = t; }
  if (typeof parsed.voice === "string" && !f.voice_exemplar?.pinned) { const t = trim(parsed.voice); if (t) patch.voice = t; }

  if (Array.isArray(parsed.cast)) {
    const existing = new Map((f.cast ?? []).map((c) => [c.id, c]));
    const out = []; const used = new Set();
    for (const raw of parsed.cast) {
      const name = trim(raw.name); if (!name) continue;
      const prior = typeof raw.id === "string" ? existing.get(raw.id) : undefined;
      const pf = prior?.pinned_fields ?? [];
      const pick = (k) => (pf.includes(k) ? (prior[k] ?? "") : trim(raw[k]) || (prior?.[k] ?? ""));
      out.push({
        id: prior?.id ?? bridgeUid(),
        name: pf.length ? (prior?.name ?? name) : name,
        role: raw.role === "protagonist" ? "protagonist" : raw.role === "minor" ? "minor" : (prior?.role ?? "major"),
        want: pick("want"), wound: pick("wound"), lie: pick("lie"),
        pinned_fields: pf,
        ...(prior?.appearance ? { appearance: prior.appearance } : {}),
        ...(prior?.portraits ? { portraits: prior.portraits } : {}),
        // F1: per-character voice/history — take the PROPOSED value, else keep the stored one. These
        // aren't pinnable, so the chat may freely revise them; a missing key preserves the prior value.
        ...(trim(raw.history) || prior?.history ? { history: trim(raw.history) || prior?.history } : {}),
        ...(trim(raw.idiolect) || prior?.idiolect ? { idiolect: trim(raw.idiolect) || prior?.idiolect } : {}),
        ...(trim(raw.tag) || prior?.tag ? { tag: trim(raw.tag) || prior?.tag } : {}),
      });
      if (prior) used.add(prior.id);
    }
    for (const c of f.cast ?? []) if (!used.has(c.id) && (c.pinned_fields?.length ?? 0) > 0) out.push(c);
    if (out.length) patch.cast = out;
  }

  if (Array.isArray(parsed.tentpoles)) {
    const existing = new Map((f.tentpoles ?? []).map((t) => [t.id, t]));
    const out = []; const used = new Set();
    for (const raw of parsed.tentpoles) {
      const prior = typeof raw.id === "string" ? existing.get(raw.id) : undefined;
      if (prior && (prior.status === "pinned" || prior.status === "killed")) { out.push(prior); used.add(prior.id); continue; }
      const text = trim(raw.text); if (!text) continue;
      out.push({
        id: prior?.id ?? bridgeUid(), text,
        source: prior?.source ?? "ai",
        status: raw.status === "pinned" ? "pinned" : raw.status === "killed" ? "killed" : (prior?.status ?? "fluid"),
        ...(prior?.placed_page_id != null ? { placed_page_id: prior.placed_page_id } : {}),
      });
      if (prior) used.add(prior.id);
    }
    for (const t of f.tentpoles ?? []) if (!used.has(t.id) && (t.status === "pinned" || t.status === "killed")) out.push(t);
    if (out.length) patch.tentpoles = out;
  }

  // F2: relationships — carry the stored list through; a patch that doesn't touch relationships
  // must not drop them. Pinned relationships survive unchanged (model can add/update non-pinned).
  if (Array.isArray(parsed.relationships)) {
    // a/b may be a cast id OR a member name (the model often references a brand-new member by name
    // before it has an id). Resolve against the POST-PATCH cast so new members are reachable.
    const finalCast = patch.cast ?? f.cast ?? [];
    const castIds = new Set(finalCast.map((c) => c.id));
    const nameToId = new Map(finalCast.map((c) => [c.name.toLowerCase(), c.id]));
    const resolveRef = (v) => (castIds.has(v) ? v : nameToId.get(v.toLowerCase()) ?? "");
    const existingRel = new Map((f.relationships ?? []).map((r) => [r.id, r]));
    const outRel = []; const usedRel = new Set();
    for (const raw of parsed.relationships) {
      const id = typeof raw.id === "string" ? raw.id : "";
      const prior = id ? existingRel.get(id) : undefined;
      // Pinned relationships are immutable — restore verbatim.
      if (prior?.pinned) { outRel.push(prior); usedRel.add(prior.id); continue; }
      const bond = trim(raw.bond);
      const a = resolveRef(trim(raw.a)); const b = resolveRef(trim(raw.b));
      if (!bond || !a || !b) continue;
      outRel.push({ id: prior?.id ?? bridgeUid(), a, b, bond, ...(raw.pinned === true ? { pinned: true } : {}) });
      if (prior) usedRel.add(prior.id);
    }
    // Pinned relationships the model omitted survive untouched.
    for (const r of f.relationships ?? []) if (!usedRel.has(r.id) && r.pinned) outRel.push(r);
    if (outRel.length) patch.relationships = outRel;
  } else if (f.relationships?.length) {
    // Model didn't touch relationships — carry the whole stored list through unchanged.
    patch.relationships = f.relationships;
  }

  // F3a: world — carry the stored node through; honor its pinned flag (immutable when pinned).
  if (parsed.world && typeof parsed.world === "object" && !Array.isArray(parsed.world)) {
    const raw = parsed.world;
    if (f.world?.pinned) {
      // World is pinned — ignore any proposed change, keep the stored node.
      patch.world = f.world;
    } else {
      const setting = trim(raw.setting) || f.world?.setting;
      const period = trim(raw.period) || f.world?.period;
      const rules = Array.isArray(raw.rules)
        ? raw.rules.map(String).filter(Boolean)
        : f.world?.rules;
      const pinned = raw.pinned === true ? true : f.world?.pinned;
      patch.world = { ...(setting ? { setting } : {}), ...(period ? { period } : {}), ...(rules?.length ? { rules } : {}), ...(pinned ? { pinned } : {}) };
    }
  } else if (f.world) {
    // Model didn't touch world — carry the stored node through unchanged.
    patch.world = f.world;
  }

  // F4a: narration — accept a proposed mode unless pinned; otherwise carry the stored node through.
  if (parsed.narration && typeof parsed.narration === "object" && !Array.isArray(parsed.narration)) {
    const raw = parsed.narration;
    if (f.narration?.pinned) {
      patch.narration = f.narration;
    } else {
      const person = raw.person === "first" || raw.person === "close-third" || raw.person === "omniscient" ? raw.person : f.narration?.person;
      const tense = raw.tense === "past" || raw.tense === "present" ? raw.tense : f.narration?.tense;
      const distance = trim(raw.distance) || f.narration?.distance;
      const pinned = raw.pinned === true ? true : f.narration?.pinned;
      patch.narration = { ...(person ? { person } : {}), ...(tense ? { tense } : {}), ...(distance ? { distance } : {}), ...(pinned ? { pinned } : {}) };
    }
  } else if (f.narration) {
    patch.narration = f.narration;
  }

  return Object.keys(patch).length ? patch : null;
}

async function getRevisionChat(bookId, layer) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/revision_chats?book_id=eq.${bookId}&layer=eq.${layer}&select=id,messages,pending_proposal`, { headers: sbHeaders });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return (await r.json())?.[0] ?? null;
}
async function upsertRevisionChat(bookId, layer, existingId, patch) {
  if (existingId) {
    await fetch(`${SUPABASE_URL}/rest/v1/revision_chats?id=eq.${existingId}`, {
      method: "PATCH", headers: { ...sbHeaders, "content-type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(patch),
    });
    return existingId;
  }
  const r = await fetch(`${SUPABASE_URL}/rest/v1/revision_chats`, {
    method: "POST", headers: { ...sbHeaders, "content-type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ book_id: bookId, layer, ...patch }),
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return (await r.json())?.[0]?.id ?? null;
}

async function runReviseChat(bookId, layer, message) {
  const msg = (message ?? "").trim();
  if (!msg) return { error: "message is required" };
  if (!["foundations", "spine", "beats", "outline"].includes(layer)) return { error: "a valid layer is required" };
  const book = await fetchBook(bookId);
  if (!book) return { error: "Book not found" };

  const existing = await getRevisionChat(bookId, layer);
  const history = Array.isArray(existing?.messages) ? existing.messages : [];
  const withUser = [...history, { role: "user", text: msg, ts: new Date().toISOString() }];
  const chatId = await upsertRevisionChat(bookId, layer, existing?.id, { messages: withUser, status: "thinking", error: null });

  try {
    const f = book.foundations ?? null;
    const spineText = book.spine?.text?.trim() || null;
    let system, context, sanitize;
    if (layer === "beats") {
      const pages = await fetchPages(bookId);
      // "Plan all beats" is a bulk generation op — one giant claude -p call times out on large books.
      // Detect the known generate-chip prompt and route through the per-page specialist instead.
      if (msg.startsWith("Plan a beat for every page that has an objective but no beat")) {
        console.log(`planAllBeatsLocal for book ${bookId} (${pages.length} pages)…`);
        const { reply } = await planAllBeatsLocal(bookId, pages, {
          onProgress: async (done, total) => {
            const prog = { role: "assistant", text: `Planning beats… ${done}/${total}`, ts: new Date().toISOString() };
            await upsertRevisionChat(bookId, layer, chatId, { messages: [...withUser, prog], status: "thinking" });
          },
        });
        const assistant = { role: "assistant", text: reply, ts: new Date().toISOString() };
        await upsertRevisionChat(bookId, layer, chatId, {
          messages: [...withUser, assistant],
          pending_proposal: existing?.pending_proposal ?? null,
          status: "idle",
        });
        return { reply, proposal: null };
      }
      system = BEATS_AGENT_INSTRUCTIONS;
      const _beatsMandate = mandateContext(book.brief);
      const _beatsSteer = typeof book.steers?.beats === "string" ? book.steers.beats.trim() : "";
      context =
        `BOOK: ${book.name}\n\nBRIEF — the contract (voice AND deliverables):\n${briefContext(book.brief)}` +
        (_beatsMandate ? `\n\nMANDATE — NON-NEGOTIABLE (the book has FAILED if any of these are not delivered; do not treat them as flavor. The beats are where a mandated property is delivered or quietly faded — every beat must render the mandated genre ON the page, as a recurring engine where the brief implies it; NEVER launder a mandated property into euphemism or fade-to-black):\n${_beatsMandate}` : "") +
        (spineText ? `\n\nSPINE:\n${spineText}` : "") +
        (f ? `\n\nFOUNDATIONS (settled — pinned lines are immutable):\n${foundationsContext(f)}` : "") +
        `\n\nCURRENT BEAT SHEET (real page ids):\n${beatSheetContext(pages)}` +
        `\n\nFICTION CRITERIA (use when evaluating):\n${BEAT_CRITERIA}` +
        (_beatsSteer ? `\n\nAUTHOR'S STEER FOR THIS STEP (honor it as a strong instruction shaping THIS output; it never overrides the brief, the spine, or any PINNED constraint):\n${_beatsSteer}` : "");
      sanitize = (parsed) => { const plan = parseBeatPlan(JSON.stringify(parsed), pages); return plan && !plan.error ? { layer: "beats", data: plan } : null; };
    } else if (layer === "spine") {
      system = SPINE_AGENT_INSTRUCTIONS;
      const _spineMandate = mandateContext(book.brief);
      const _spineSteer = typeof book.steers?.spine === "string" ? book.steers.spine.trim() : "";
      context =
        `BOOK: ${book.name}\n\nBRIEF (the contract):\n${briefContext(book.brief)}` +
        (_spineMandate ? `\n\nMANDATE — NON-NEGOTIABLE (the book has FAILED if any of these are not delivered; do not treat them as flavor — render each mandated property explicitly in the spine, as a recurring engine where the genre implies it; NEVER launder one into euphemism or fade):\n${_spineMandate}` : "") +
        (f ? `\n\nFOUNDATIONS (settled — pinned lines immutable; every pinned tentpole MUST survive in the spine):\n${foundationsContext(f)}` : "") +
        `\n\nCURRENT SPINE:\n${spineText || "(no spine yet)"}` +
        (_spineSteer ? `\n\nAUTHOR'S STEER FOR THIS STEP (honor it as a strong instruction shaping THIS output; it never overrides the brief, the spine, or any PINNED constraint):\n${_spineSteer}` : "");
      sanitize = (parsed) => { const t = (typeof parsed.text === "string" ? parsed.text.trim() : ""); return t ? { layer: "spine", data: { text: t } } : null; };
    } else if (layer === "outline") {
      const pages = await fetchPages(bookId);
      system = OUTLINE_AGENT_INSTRUCTIONS;
      const _outlineMandate = mandateContext(book.brief);
      const _outlineSteer = typeof book.steers?.outline === "string" ? book.steers.outline.trim() : "";
      context =
        `BOOK: ${book.name}\n\nBRIEF — the contract (voice AND deliverables):\n${briefContext(book.brief)}` +
        (_outlineMandate ? `\n\nMANDATE — NON-NEGOTIABLE (the book has FAILED if any of these are not delivered; do not treat them as flavor. Every page's objective must carry the mandated genre where the brief implies it; structure the book so the mandated properties land ON the page as a recurring engine — never structure a mandated property out or relegate it to a single page):\n${_outlineMandate}` : "") +
        (spineText ? `\n\nSPINE (the book in one arc — the outline must realize this):\n${spineText}` : "") +
        (f ? `\n\nFOUNDATIONS (settled — pinned lines are immutable):\n${foundationsContext(f)}` : "") +
        `\n\nCURRENT OUTLINE (real page ids):\n${outlineContext(pages)}` +
        (_outlineSteer ? `\n\nAUTHOR'S STEER FOR THIS STEP (honor it as a strong instruction shaping THIS output; it never overrides the brief, the spine, or any PINNED constraint):\n${_outlineSteer}` : "");
      sanitize = (parsed) => { const plan = parseBeatPlan(JSON.stringify(parsed), pages); return plan && !plan.error ? { layer: "outline", data: plan } : null; };
    } else {
      const ff = f ?? {};
      const castIds = ff.cast?.length
        ? ff.cast.map((c) => { const pf = c.pinned_fields ?? []; const fld = (k) => (c[k] ? `\n    ${k}: ${c[k]}${pf.includes(k) ? " [PINNED — immutable]" : ""}` : ""); const extra = (k) => (c[k] ? `\n    ${k}: ${c[k]}` : ""); return `[id=${c.id}] ${c.name} (${c.role ?? "major"})${fld("want")}${fld("wound")}${fld("lie")}${extra("history")}${extra("idiolect")}${extra("tag")}`; }).join("\n")
        : "(no cast yet)";
      system = FOUNDATIONS_AGENT_INSTRUCTIONS;
      const _foundMandate = mandateContext(book.brief);
      const _foundSteer = typeof book.steers?.foundations === "string" ? book.steers.foundations.trim() : "";
      context =
        `BOOK: ${book.name}\n\nBRIEF (the frozen contract — never propose changing it):\n${briefContext(book.brief)}` +
        (_foundMandate ? `\n\nMANDATE — NON-NEGOTIABLE (the book has FAILED if any of these are not delivered; do not treat them as flavor. The TENTPOLES are this brief's genre engine — every set-piece you propose or keep must serve these, rendered explicitly on the page; never propose tentpoles that dilute the mandated genre, and never frame the existing genre engine as a weakness to balance away):\n${_foundMandate}` : "") +
        `\n\nCURRENT FOUNDATIONS (settled — PINNED lines are immutable):\n${foundationsContext(ff)}` +
        `\n\nCAST (with ids — reference an [id] to revise a member):\n${castIds}` +
        (_foundSteer ? `\n\nAUTHOR'S STEER FOR THIS STEP (honor it as a strong instruction shaping THIS output; it never overrides the brief, the spine, or any PINNED constraint):\n${_foundSteer}` : "");
      sanitize = (parsed) => { const data = sanitizeFoundationsPatch(parsed, ff); return data ? { layer: "foundations", data } : null; };
    }

    const transcript = withUser.slice(-24).map((m) => `${m.role === "user" ? "AUTHOR" : "EDITOR"}: ${m.text}`).join("\n\n");
    const prompt = `${system}\n\n${context}\n\n— — — CONVERSATION SO FAR — — —\n${transcript}\n\nRespond to the latest AUTHOR message.`;

    const out = await runClaude(prompt, true, { fn: "revise-chat", bookId }, { noTools: true, model: MODEL_PLANNING });
    if (out.error) throw new Error(out.error);

    // A proposed change rides in a TRAILING ```json block (mirrors the edge fn).
    let reply = out.text.trim(), proposal = null;
    const m = out.text.match(/```(?:json)?\s*([\s\S]*?)```\s*$/);
    if (m && m.index != null) {
      try {
        const parsed = JSON.parse(m[1].trim());
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const patch = sanitize(parsed);
          if (patch) {
            const summary = (typeof parsed.summary === "string" && parsed.summary.trim()) ? parsed.summary.trim() : ((patch.layer === "beats" || patch.layer === "outline") ? patch.data.summary : "Proposed revision");
            proposal = { summary, patch };
            reply = out.text.slice(0, m.index).trim() || "Here's a proposed revision — review it below.";
          }
        }
      } catch { /* malformed trailing block → keep whole text as prose */ }
    }

    const assistant = { role: "assistant", text: reply, ts: new Date().toISOString(), plan: proposal?.summary };
    await upsertRevisionChat(bookId, layer, chatId, {
      messages: [...withUser, assistant],
      pending_proposal: proposal ?? existing?.pending_proposal ?? null,
      status: "idle",
    });
    return { reply, proposal };
  } catch (e) {
    await upsertRevisionChat(bookId, layer, chatId, { status: "error", error: String(e?.message ?? e).slice(0, 500), messages: withUser });
    return { error: String(e?.message ?? e) };
  }
}

// ── /objective-to-beat ─────────────────────────────────────────────────────────
// Mirrors supabase/functions/objective-to-beat: objective → a one-paragraph beat (the plan of what the
// page does), in book context. No mutation — the client writes metadata.beat + stamps the edge.
const BEAT_INSTRUCTIONS = `You are a book architect writing a BEAT — a single paragraph that plans, in concrete order, what ONE page of the book does to fulfil its objective. A beat sits between the OBJECTIVE (what the page must achieve) and the PROSE (the actual words): it commits to the specific moves, turns, and images — the "how" — without writing the page itself.

A beat is where the story's ENGINE lives. Weave these into the paragraph (as flowing plan-prose, never a bullet list):
- CAUSALITY: connect to the PREVIOUS beat with "therefore" or "but" — this page happens BECAUSE of, or pushes AGAINST, what just happened. Never "and then" (events that merely follow in time). If there is no previous beat, set the engine running: open a want and an obstacle.
- A VALUE FLIP: one thing that matters here (safety, trust, hope, control, intimacy, power…) shifts from + to − or − to + across the page. Make clear what flips and which way.
- SUBTEXT: at least one moment where what a character SAYS is not what they MEAN — a said-vs-meant gap the reader feels.
- A CONCRETE IMAGE: one specific sensory anchor — an object, a gesture, a detail of place — that the page turns on, not an abstraction.
- THREADS: if told to SEED a thread, plant it so it reads as natural now but lands later; if told to PAY OFF a thread, deliver the promise so it feels earned.

Rules:
- Output ONE paragraph (3–6 sentences). No title, no heading, no preamble, no markdown, no bullet list, no meta commentary — just the beat.
- It is a PLAN, not prose: say what happens and in what order; do NOT write the page's actual sentences or dialogue.
- Fulfil the page's objective exactly. Honour the brief (genre, audience, tone, premise) and the spine as the voice/throughline contract.
- Preserve the brief's MANDATE — heat/explicitness, comedy, and set-piece specifics — verbatim. The layer you write must be AT LEAST as committed as its source: never soften, abstract, or fade-to-black a mandated beat. If the brief calls for something explicit, sensual, or funny, that obligation must survive into your output, not get laundered into tasteful vagueness.`;

async function runObjectiveToBeat(body) {
  const { bookId, pageId, objective } = body;
  if (!bookId || !pageId) return { error: "bookId and pageId required" };
  const obj = (objective ?? "").trim();
  if (!obj) return { error: "objective required" };

  const book = await fetchBook(bookId);
  if (!book) return { error: "Book not found" };
  const pages = await fetchPages(bookId);
  const spine = book.spine?.text?.trim() || null;
  const foundations = book.foundations ?? null;

  // F2-c: build relationship context for the beat prompt.
  // Walk back to find the most recent prior page with relationship_states; fall back to
  // foundations.relationships as baseline descriptors if no page state exists yet.
  const current = pages.find((p) => p.id === pageId) ?? null;
  let relCtxBlock = null;
  if (current) {
    const priorRel = pages.filter((p) => p.page_index < current.page_index && (p.metadata?.relationship_states?.length ?? 0) > 0);
    const latestRel = priorRel.at(-1)?.metadata?.relationship_states;
    if (latestRel?.length) {
      const lines = latestRel.map((r) => `- ${r.pair}: ${r.charge}${r.note ? ` (${r.note})` : ""}`);
      relCtxBlock = `RELATIONSHIP CHARGES (as of the previous page — a value-flip here can target one of these bonds):\n${lines.join("\n")}`;
    } else {
      const base = foundations?.relationships ?? [];
      if (base.length) {
        const castMap = new Map((foundations?.cast ?? []).map((c) => [c.id, c.name]));
        const lines = base.map((r) => {
          const aName = castMap.get(r.a) ?? r.a;
          const bName = castMap.get(r.b) ?? r.b;
          return `- ${aName} / ${bName}: ${r.bond}`;
        });
        relCtxBlock = `RELATIONSHIP BASELINE (no runtime charges yet — these are the stable dyads; a value-flip here can target one):\n${lines.join("\n")}`;
      }
    }
  }

  const _beatMandate = mandateContext(book.brief);
  // C4: per-page length budget — flat allocation: word_target / content-page count.
  const _beatWordTarget = book.brief?.scope?.word_target ?? 0;
  const _beatContentCount = pages.filter((p) => p.page_type !== "section").length;
  const _beatPerPageTarget = (_beatWordTarget > 0 && _beatContentCount > 0) ? Math.round(_beatWordTarget / _beatContentCount) : 0;
  const prompt = `${BEAT_INSTRUCTIONS}

BOOK: ${book.name}

BRIEF — binding contract (voice AND deliverables):
${briefContext(book.brief)}${_beatMandate ? `\n\nMANDATE — NON-NEGOTIABLE (the book has FAILED if any of these are not delivered; do not treat them as flavor):\n${_beatMandate}` : ""}${canonSection(book.canon)}${spine ? `\n\nBOOK SPINE (the throughline):\n${spine}` : ""}

OUTLINE (for continuity):
${outlineContext(pages)}${relCtxBlock ? `\n\n${relCtxBlock}` : ""}${_beatPerPageTarget > 0 ? `\n\nTARGET LENGTH: the prose written from this beat should run ~${_beatPerPageTarget} words — plan enough concrete moments and texture to fill that, neither padding nor rushing.` : ""}

THIS PAGE'S OBJECTIVE:
${obj}

Write the beat for THIS PAGE. One paragraph, plan only.`;

  // candidates>1 → sample N un-judged takes for the serial human-pick UI. The bridge has no
  // temperature knob, but separate `claude -p` calls vary enough to offer a real choice.
  const n = Math.max(1, Math.min(Number(body.candidates) || 1, 5));
  if (n > 1) {
    const outs = await Promise.all(
      Array.from({ length: n }, () => runClaude(prompt, true, { fn: "objective-to-beat", bookId }, { noTools: true, model: MODEL_PLANNING })),
    );
    const takes = outs.map((o) => (o.text ?? "").trim()).filter(Boolean);
    if (takes.length === 0) return { error: "Claude returned no beat." };
    return { candidates: takes };
  }

  const out = await runClaude(prompt, true, { fn: "objective-to-beat", bookId }, { noTools: true, model: MODEL_PLANNING });
  if (out.error) return out;
  return { beat: (out.text ?? "").trim() };
}

// Plan beats for all un-beaten pages using runObjectiveToBeat (per-page specialist) rather than a
// single chat-model call, which times out on large books. Writes each beat to the DB immediately so
// the author sees beats appear in the beat sheet in real-time (no "review then apply" step needed).
// `onProgress(done, total)` is called after each successful write so callers can push chat updates.
async function planAllBeatsLocal(bookId, pages, { onProgress } = {}) {
  const toBeat = pages.filter(
    (p) => (p.page_type === "text" || !p.page_type) &&
           (p.metadata?.objective ?? "").trim() &&
           !(p.metadata?.beat ?? "").trim()
  );
  if (toBeat.length === 0) {
    return { reply: "All pages already have beats — nothing to plan.", proposal: null };
  }
  const total = toBeat.length;
  let done = 0, failed = 0;
  // Sequential front-to-back: each call reads the full outline for continuity so order matters.
  for (const page of toBeat) {
    console.log(`  beat ${done + 1}/${total}: page ${page.id} (${page.title ?? "untitled"})…`);
    const out = await runObjectiveToBeat({ bookId, pageId: page.id, objective: page.metadata.objective });
    if (out.error || !out.beat) {
      failed++;
      console.warn(`  ✗ page ${page.id}: ${out.error ?? "no beat"}`);
    } else {
      await stampBeatMeta(page.id, page.metadata.objective, out.beat);
      done++;
      if (onProgress) await onProgress(done, total);
    }
  }
  if (done === 0) {
    return { reply: `Couldn't plan any beats — ${failed} page${failed === 1 ? "" : "s"} failed. Try again.`, proposal: null };
  }
  const reply = `Planned ${done} beat${done === 1 ? "" : "s"}${failed ? ` (${failed} skipped)` : ""}. They're live in your beat sheet now — ask me to evaluate or revise any of them.`;
  return { reply, proposal: null };
}

// ── /scene-image-prompt + /character-portrait-prompt ──────────────────────────
// Mirrors the COMPOSE (mode:"prompt") path of supabase/functions/generate-scene-image and
// generate-character-portrait, but runs on local Claude Code (claude-local) instead of the Anthropic
// API. Only the text prompt-compose runs here; the actual image render stays on the edge fn (OpenRouter),
// which the client calls directly. Returns { prompt }.
const SCENE_IMAGE_PROMPT_SYSTEM = `You compose ONE structured image prompt for a single scene of a novel. The author will edit it, then it is sent VERBATIM to an image model — so it must be complete and self-contained.

You are given recent story beats for continuity and the BEAT TO DEPICT. Depict ONLY the beat-to-depict; let the preceding beats inform mood and continuity but never render them.

The image's job is IMMERSION, not exposition. The PROSE tells the story; the picture only has to pull the reader close to a character in a real, lived-in moment. So:
- Choose ONE focal character — whoever the beat centres on — and build the whole frame around them: their face, their expression, what they are doing right now.
- Other named characters may be present, but stage them naturally inside the action — interacting, turned away, partly in frame, or soft in the background. NEVER line the cast up shoulder-to-shoulder, give them equal weight, or have anyone pose for or look at the camera (unless the beat is literally a portrait or photograph).
- Favour an intimate, cinematic shot — a close-up, medium close-up, or over-the-shoulder on the focal character — over a wide group shot. Vary the angle from scene to scene. Catch the instant candidly, as if the camera happened to catch it mid-action.

Output EXACTLY these labelled lines, in this order, each on its own line, nothing before or after:

SUBJECT: the FOCAL character — name them, the key appearance details given, and their exact expression and action in this moment. If others are present, add them briefly and SUBORDINATELY (where they are, what they're doing) — not as co-equal portraits.
SETTING: where it happens, the time of day, and the telling environmental details.
ACTION: the single moment being depicted, drawn from the beat.
COMPOSITION: an intimate, candid camera — shot type (favour close / medium / over-the-shoulder), the focal point held on the focal character, plus angle and depth of field. Explicitly avoid a flat line-up or a posed group.
LIGHTING: the quality, direction, and colour of the light.
MOOD: the emotional atmosphere.
STYLE: the rendering look. If a HOUSE LOOK is given, this line MUST honour it; otherwise default to cinematic, painterly digital illustration with a rich, atmospheric, naturalistic palette. Keep this line concrete and consistent from scene to scene.
EXCLUDE: no text, captions, watermarks, or signatures; no posing for the camera; no symmetrical, evenly-spaced cast line-up.

Render every named character faithfully to the appearance given. Be concrete and visual — avoid plot abstractions a camera cannot see. Weave any author art direction into the relevant lines.

Here is one worked example of the calibre, density, and focal staging to match. It is ILLUSTRATIVE ONLY — the names, setting, mood and STYLE in YOUR output must come from the beat, cast, and HOUSE LOOK you are given, never copied from this example:

SUBJECT: Mara positioned at the room's edge, brown-haired and lithe, her bright dark reflective eyes locked on Cassian's in the instant of mutual recognition, soft lips slightly parted, her defiant composure visibly faltering—caught before she can rebuild her mask. Cassian mid-performance gesture, eyes flicked to find a believer and landing on her instead. Wenna nearby with practiced composure, the flustered merchant beginning to retreat.
SETTING: An intimate interior of the estate, lived-in and warmed, afternoon light filtering through, the space where Cassian conducts his persuasions—quiet, lined with the textures of someone who belongs.
ACTION: The moment Cassian's eyes flick across the room mid-deadpan to find a believer, landing instead on Mara, the unconvinced witness—their gazes locking in mutual recognition, her cataloguing mask slipping visibly.
COMPOSITION: Medium close-up focused primarily on Mara at the room's edge, her face the clear focal point, her bright eyes and soft lips candidly in the moment of being truly seen, shot at a slight angle that brings Cassian's face into the frame at her side but secondary and softer. Wenna and the merchant staged naturally in the background, no posed arrangement or symmetrical spacing.
LIGHTING: Warm directional light falling across Mara's face in the manner of classical chiaroscuro, catching the brightness in her eyes, casting pools of rich amber and deep shadow through the room, modeling form with old-master subtlety.
MOOD: Electrified mutual recognition; the shock of being truly seen when unguarded; the moment when performance falters and something genuine breaks through.
STYLE: Rich oil painting with visible brushwork and impasto texture throughout, classical old-master lighting, deep saturated old-master palette of warm siennas, ochres, and umbers with cool shadow-tones, rendered in the manner of golden-age portraiture.
EXCLUDE: No text, captions, watermarks, or signatures; no posed group line-up or symmetrically spaced cast; no one posing for or looking at the camera; Mara and Cassian caught in a candid moment of genuine connection.`;

const PORTRAIT_PROMPT_SYSTEM = `You compose ONE structured image prompt for a character REFERENCE PORTRAIT for a novel. The author will edit it, then it is sent VERBATIM to an image model — so it must be complete and self-contained.

Given the character's name, role, appearance, and inner life, output EXACTLY these labelled lines, in this order, each on its own line, nothing before or after:

SUBJECT: the character's face, apparent age, build, hair, and distinguishing features, their typical dress, and an expression that reflects who they are — a believable, specific person.
FRAMING: head-and-shoulders character reference portrait.
BACKGROUND: neutral, with even soft lighting.
STYLE: the rendering look. If a HOUSE LOOK is given, this line MUST honour it; otherwise default to photorealistic. Keep features consistent and suitable as a reusable reference.
EXCLUDE: no text, captions, watermarks, or signatures.

Weave any author art direction into the relevant lines.`;

function castNamedIn(text, name) {
  const n = (name ?? "").trim();
  if (!n) return false;
  return new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
}

async function runSceneImagePrompt(body) {
  const { bookId, pageId, instruction, style } = body;
  if (!bookId || !pageId) return { error: "bookId and pageId required" };
  const book = await fetchBook(bookId);
  if (!book) return { error: "Book not found" };
  const pages = await fetchPages(bookId);
  const here = pages.findIndex((p) => p.id === pageId);
  if (here === -1) return { error: "Page not found in this book" };
  const beat = (pages[here].metadata?.beat ?? "").trim();
  if (!beat) return { error: "Plan the beat first — the scene is drawn from it." };

  const priorBeats = pages.slice(0, here).map((p) => (p.metadata?.beat ?? "").trim()).filter(Boolean).slice(-2);
  const cast = book.foundations?.cast ?? [];
  // Explicit per-compose `style` overrides the book house look (mirror of the edge fn).
  const houseLook = (style?.trim() || book.foundations?.art_direction || "").trim();
  const present = cast.filter((m) => castNamedIn(beat, m.name));
  const castNotes = present.map((m) => `- ${m.name}${m.appearance?.trim() ? `: ${m.appearance.trim()}` : ""}`).join("\n");

  const userContent = [
    priorBeats.length ? `RECENT BEATS (for continuity — do NOT depict):\n${priorBeats.map((b, i) => `${i + 1}. ${b}`).join("\n\n")}` : null,
    `BEAT TO DEPICT:\n${beat}`,
    castNotes ? `CHARACTERS PRESENT (render faithfully):\n${castNotes}` : null,
    houseLook ? `HOUSE LOOK (the book's settled visual style — the STYLE line MUST honour this so every scene looks like one book):\n${houseLook}` : null,
    instruction?.trim() ? `ART DIRECTION (author — honor this):\n${instruction.trim()}` : null,
    "Write the image prompt.",
  ].filter(Boolean).join("\n\n");

  const out = await runClaude(`${SCENE_IMAGE_PROMPT_SYSTEM}\n\n${userContent}`, true, { fn: "scene-image-prompt", bookId }, { noTools: true, model: MODEL_SUMMARY });
  if (out.error) return out;
  const prompt = (out.text ?? "").trim();
  return prompt ? { prompt } : { error: "Could not compose a scene prompt." };
}

// Structured-spec composer (mirror of the edge fn's SPEC_SYSTEM) — emits JSON the studio rail edits
// field-by-field; the client flattens it back to the labelled prompt at render time.
const SCENE_SPEC_SYSTEM = `You compose a STRUCTURED scene spec for a single scene of a novel. The author edits it field-by-field, then it is rendered as an image — so each field must be concrete and visual.

You are given recent story beats for continuity and the BEAT TO DEPICT. Depict ONLY the beat-to-depict.

The image's job is IMMERSION, not exposition. Choose ONE focal character — whoever the beat centres on — as the FIRST subject, and build the frame around them. Other named characters may be present, staged naturally and SUBORDINATELY (in the action, turned away, partly in frame, soft in the background) — never a posed, evenly-spaced cast line-up, never anyone facing the camera unless the beat is literally a portrait. Favour an intimate, candid shot (close / medium / over-the-shoulder), varying the angle.

Output ONLY a JSON object (no prose, no markdown fence) with exactly this shape:
{
  "subjects": [
    { "name": "the character's name", "build": "physique / age read / height", "clothing": "what they are wearing", "expression": "their exact expression in this moment", "action": "what they are doing right now" }
  ],
  "setting": "where it happens, time of day, telling environmental details",
  "action": "the single moment being depicted, drawn from the beat",
  "composition": "intimate candid camera — shot type (favour close/medium/over-the-shoulder), the focal point held on the first subject, plus angle and depth of field; explicitly avoid a flat line-up",
  "lighting": "quality, direction, and colour of the light",
  "mood": "the emotional atmosphere",
  "exclude": "things to keep out (text, watermarks, posed line-ups, facing camera)"
}

Rules:
- The FIRST subject is the focal character. List only characters actually in the frame.
- Fill build/clothing faithfully from each character's given appearance; infer sensibly when the appearance is thin, but never invent contradicting details.
- Be concrete and visual everywhere — avoid plot abstractions a camera cannot see.
- Do NOT include a "style" field — the rendering look is applied separately by the author's house look.
- Weave any author art direction into the relevant fields.`;

function parseSpecJson(text) {
  const t = (text ?? "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try { const o = JSON.parse(t.slice(start, end + 1)); return o && typeof o === "object" ? o : null; }
  catch { return null; }
}

async function runSceneImageSpec(body) {
  const { bookId, pageId, instruction, style } = body;
  if (!bookId || !pageId) return { error: "bookId and pageId required" };
  const book = await fetchBook(bookId);
  if (!book) return { error: "Book not found" };
  const pages = await fetchPages(bookId);
  const here = pages.findIndex((p) => p.id === pageId);
  if (here === -1) return { error: "Page not found in this book" };
  const beat = (pages[here].metadata?.beat ?? "").trim();
  if (!beat) return { error: "Plan the beat first — the scene is drawn from it." };

  const priorBeats = pages.slice(0, here).map((p) => (p.metadata?.beat ?? "").trim()).filter(Boolean).slice(-2);
  const cast = book.foundations?.cast ?? [];
  const houseLook = (style?.trim() || book.foundations?.art_direction || "").trim();
  const present = cast.filter((m) => castNamedIn(beat, m.name));
  const castNotes = present.map((m) => `- ${m.name}${m.appearance?.trim() ? `: ${m.appearance.trim()}` : ""}`).join("\n");

  const userContent = [
    priorBeats.length ? `RECENT BEATS (for continuity — do NOT depict):\n${priorBeats.map((b, i) => `${i + 1}. ${b}`).join("\n\n")}` : null,
    `BEAT TO DEPICT:\n${beat}`,
    castNotes ? `CHARACTERS PRESENT (render faithfully):\n${castNotes}` : null,
    houseLook ? `HOUSE LOOK (the book's settled visual style — honour this so every scene looks like one book):\n${houseLook}` : null,
    instruction?.trim() ? `ART DIRECTION (author — honor this):\n${instruction.trim()}` : null,
    "Output the scene spec as JSON.",
  ].filter(Boolean).join("\n\n");

  const out = await runClaude(`${SCENE_SPEC_SYSTEM}\n\n${userContent}`, true, { fn: "scene-image-spec", bookId }, { noTools: true, model: MODEL_SUMMARY });
  if (out.error) return out;
  const spec = parseSpecJson(out.text ?? "");
  return spec ? { spec } : { error: "Could not compose a scene spec." };
}

// Spec REVISE (the Scene editor's chat) — mirror of the edge fn's REVISE_SPEC_SYSTEM.
const SCENE_SPEC_REVISE_SYSTEM = `You revise a STRUCTURED scene spec for a single scene of a novel, in a chat with the author. You are given the CURRENT SPEC and the author's requested CHANGE. Apply the change and return the FULL updated spec — but ONLY alter what the change implies; keep every other field exactly as it was.

The spec shape (same as composing): "subjects" is an array of { "name", "build", "clothing", "expression", "action" } with the FIRST subject being the focal character; plus "setting", "action", "composition", "lighting", "mood", "exclude". Keep the same focal-staging discipline (one focal subject, others subordinate, no posed line-ups, candid intimate framing).

Output ONLY a JSON object (no prose, no markdown fence) of that exact shape, PLUS one extra field "note": a single short sentence, first person and past tense, saying what you changed.

Rules:
- Be concrete and visual. Do NOT include a "style" field. Never invent details that contradict the cast appearances or the beat.
- If the change adds or removes a character, update "subjects" accordingly (and re-pick the focal subject only if the change asks for it).`;

async function runSceneImageReviseSpec(body) {
  const { bookId, pageId, instruction, currentSpec, refCount = 0 } = body;
  if (!bookId || !pageId) return { error: "bookId and pageId required" };
  if (!instruction?.trim()) return { error: "Say what to change." };
  const book = await fetchBook(bookId);
  if (!book) return { error: "Book not found" };
  const pages = await fetchPages(bookId);
  const here = pages.findIndex((p) => p.id === pageId);
  if (here === -1) return { error: "Page not found in this book" };
  const beat = (pages[here].metadata?.beat ?? "").trim();
  if (!beat) return { error: "Plan the beat first — the scene is drawn from it." };

  const priorBeats = pages.slice(0, here).map((p) => (p.metadata?.beat ?? "").trim()).filter(Boolean).slice(-2);
  const cast = book.foundations?.cast ?? [];
  const present = cast.filter((m) => castNamedIn(beat, m.name));
  const castNotes = present.map((m) => `- ${m.name}${m.appearance?.trim() ? `: ${m.appearance.trim()}` : ""}`).join("\n");

  const refBlock = refCount > 1
    ? `REFERENCE IMAGES: the author attached ${refCount} reference images you cannot see, in order — reference 1, 2, … through ${refCount}. Their change may take a DIFFERENT element from each (e.g. the camera angle from one, a character's face or outfit from another). Apply each to the relevant field(s) and add a short cue naming the source, like "(the camera angle of reference 1)" or "(her face from reference 2)", so the renderer applies the right element from the right image.`
    : refCount === 1
      ? `REFERENCE IMAGE: the author attached 1 reference image you cannot see. Their change says what to take from it — weave that into the relevant field(s) and add a short cue like "(matching the attached reference)" so the renderer (which CAN see it) applies it.`
      : null;
  const userContent = [
    priorBeats.length ? `RECENT BEATS (for continuity — do NOT depict):\n${priorBeats.map((b, i) => `${i + 1}. ${b}`).join("\n\n")}` : null,
    `BEAT TO DEPICT:\n${beat}`,
    castNotes ? `CHARACTERS PRESENT (render faithfully):\n${castNotes}` : null,
    `CURRENT SPEC (revise THIS — keep everything the change does not mention):\n${JSON.stringify(currentSpec ?? {}, null, 2)}`,
    refBlock,
    `AUTHOR'S CHANGE:\n${instruction.trim()}`,
    `Apply the change and output the FULL updated spec as JSON, with an extra "note" field summarising what you changed.`,
  ].filter(Boolean).join("\n\n");

  const out = await runClaude(`${SCENE_SPEC_REVISE_SYSTEM}\n\n${userContent}`, true, { fn: "scene-image-revise-spec", bookId }, { noTools: true, model: MODEL_SUMMARY });
  if (out.error) return out;
  const obj = parseSpecJson(out.text ?? "");
  if (!obj) return { error: "Could not revise the scene spec." };
  const note = typeof obj.note === "string" ? obj.note.trim() : "";
  delete obj.note;
  return { spec: obj, note };
}

async function runCharacterPortraitPrompt(body) {
  const { bookId, castId, instruction } = body;
  if (!bookId || !castId) return { error: "bookId and castId required" };
  const book = await fetchBook(bookId);
  if (!book) return { error: "Book not found" };
  const member = (book.foundations?.cast ?? []).find((m) => m.id === castId);
  if (!member) return { error: "Character not found in this book's cast" };
  const houseLook = (book.foundations?.art_direction ?? "").trim();

  const userContent = [
    `NAME: ${member.name}`,
    member.role ? `ROLE: ${member.role}` : null,
    member.appearance?.trim() ? `APPEARANCE: ${member.appearance.trim()}` : null,
    member.want?.trim() ? `WANTS: ${member.want.trim()}` : null,
    member.wound?.trim() ? `WOUND (informs expression): ${member.wound.trim()}` : null,
    houseLook ? `HOUSE LOOK (the book's settled visual style — the STYLE line MUST honour this so the cast looks like one book): ${houseLook}` : null,
    instruction?.trim() ? `ART DIRECTION (author — honor this): ${instruction.trim()}` : null,
    "Write the portrait prompt.",
  ].filter(Boolean).join("\n");

  const out = await runClaude(`${PORTRAIT_PROMPT_SYSTEM}\n\n${userContent}`, true, { fn: "character-portrait-prompt", bookId }, { noTools: true, model: MODEL_SUMMARY });
  if (out.error) return out;
  const prompt = (out.text ?? "").trim();
  return prompt ? { prompt } : { error: "Could not compose a portrait prompt." };
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

  const out = await runClaude(prompt, true, { fn: "prose-to-beat", bookId }, { noTools: true, model: MODEL_PLANNING });
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

  const out = await runClaude(prompt, true, { fn: "brief-to-spine", bookId }, { noTools: true, model: MODEL_PLANNING });
  if (out.error) return out;
  return { spine: (out.text ?? "").trim() };
}

// ── /spine-options ────────────────────────────────────────────────────────────
// Mirrors supabase/functions/spine-options: generate 3 wide alternative spines from the brief.
const SPINE_OPTIONS_SYSTEM = `You are a book architect generating ALTERNATIVE SPINES from an author's brief.

A SPINE is the book's throughline: 1–2 short paragraphs stating what this book is fundamentally DOING — its central objective/promise and the arc from beginning to end. It is not a blurb or marketing copy. It names the central aim, the through-arc, and what changes by the end.

Generate exactly 3 ALTERNATIVES. Each must:
- Honor the brief (genre, audience, premise, tone, scope) as the non-negotiable contract
- Be GENUINELY DIFFERENT from each other — pull different threads from the premise, foreground different tensions, land on different emotional arcs
- Vary in register: one could be intimate and interior, one structural and external, one thematic/philosophical
- If a current spine is provided, vary away from it — don't paraphrase it

Output JSON ONLY (no prose, no fences):
{ "options": ["<1–2 paragraphs>", "<1–2 paragraphs>", "<1–2 paragraphs>"] }`;

async function runSpineOptions(body) {
  const { bookId } = body;
  if (!bookId) return { error: "bookId required" };
  const book = await fetchBook(bookId);
  if (!book) return { error: "Book not found" };
  const current = book.spine?.text?.trim() || null;

  const userContent =
    `BOOK: ${book.name}\n\nBRIEF:\n${briefContext(book.brief)}` +
    (current ? `\n\nCURRENT SPINE (what's there now — vary away from it):\n${current}` : "\n\n(No spine set yet.)") +
    `\n\nGenerate 3 wide-varying alternative spines. JSON only.`;

  const prompt = `${SPINE_OPTIONS_SYSTEM}\n\n${userContent}`;
  const out = await runClaude(prompt, true, { fn: "spine-options", bookId }, { noTools: true, model: MODEL_PLANNING });
  if (out.error) return out;
  try {
    const raw = (out.text ?? "").trim();
    let json = raw;
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) json = fence[1].trim();
    else {
      const f = raw.indexOf("{"), l = raw.lastIndexOf("}");
      if (f !== -1 && l > f) json = raw.slice(f, l + 1);
    }
    const parsed = JSON.parse(json);
    const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.options) ? parsed.options : []);
    const options = arr.map((s) => String(s).trim()).filter(Boolean);
    if (options.length === 0) return { error: "No options returned" };
    return { options };
  } catch (e) {
    return { error: `Could not parse options JSON: ${e.message}` };
  }
}

// ── /revise-scaffold ──────────────────────────────────────────────────────────
// Mirrors supabase/functions/revise-scaffold: revise a proposed outline from an author instruction.
const REVISE_SCAFFOLD_INSTRUCTIONS = `You are a book architect revising an EXISTING outline (objectives only — no prose). The author's INSTRUCTION is the primary directive: do what it asks while PRESERVING what already works. Brief and spine stay in context throughout.

You may change objectives, re-order pages, add or cut pages, and re-anchor threads as needed — but be surgical: change only what the instruction requires.

Output JSON ONLY (no prose, no fences), exactly:
{ "structure": "<the structure>", "pages": [ { "pageType": "section", "title": "...", "objective": "" }, { "pageType": "text", "title": "...", "objective": "..." } ], "threads": [ { "name": "...", "description": "...", "setupPageIndex": <index>, "payoffPageIndex": <index>, "targetDistance": <approx words> } ] }`;

function parseScaffoldJson(text) {
  let raw = text.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  else {
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first !== -1 && last > first) raw = raw.slice(first, last + 1);
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.pages) || parsed.pages.length === 0) throw new Error("no pages");
  parsed.pages = parsed.pages
    .filter((p) => p && (p.pageType === "section" || p.pageType === "text") && typeof p.title === "string")
    .map((p) => ({ pageType: p.pageType, title: p.title.trim(), objective: (p.objective ?? "").trim() }));
  const n = parsed.pages.length;
  const validIndex = (v) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < n ? v : null;
  const threads = (Array.isArray(parsed.threads) ? parsed.threads : [])
    .filter((t) => t && typeof t.name === "string" && t.name.trim())
    .map((t) => ({
      name: t.name.trim(),
      description: typeof t.description === "string" ? t.description.trim() : "",
      setupPageIndex: validIndex(t.setupPageIndex),
      payoffPageIndex: validIndex(t.payoffPageIndex),
      targetDistance: typeof t.targetDistance === "number" && t.targetDistance > 0 ? Math.round(t.targetDistance) : null,
    }));
  return { structure: String(parsed.structure ?? "").trim(), pages: parsed.pages, threads };
}

async function runReviseScaffold(body) {
  const { bookId, scaffold, instruction } = body;
  if (!bookId) return { error: "bookId required" };
  const instr = (instruction ?? "").trim();
  if (!instr) return { error: "instruction required" };
  if (!scaffold?.pages?.length) return { error: "scaffold with pages required" };

  const book = await fetchBook(bookId);
  if (!book) return { error: "Book not found" };
  const spine = book.spine?.text?.trim() || null;
  const bible = book.bible?.text?.trim() || null;

  const prompt = `${REVISE_SCAFFOLD_INSTRUCTIONS}

BOOK: ${book.name}${spine ? `\n\nBOOK SPINE (the throughline — the outline must realize this):\n${spine}` : ""}

BRIEF:
${briefContext(book.brief)}${bible ? `\n\nBOOK BIBLE (established facts):\n${bible}` : ""}

CURRENT OUTLINE (JSON):
${JSON.stringify({ structure: scaffold.structure ?? "", pages: scaffold.pages, threads: scaffold.threads ?? [] })}

AUTHOR'S INSTRUCTION:
${instr}

Return the revised outline. JSON only.`;

  const out = await runClaude(prompt, true, { fn: "revise-scaffold", bookId }, { noTools: true, model: MODEL_PLANNING });
  if (out.error) return out;
  try {
    return parseScaffoldJson(out.text);
  } catch (e) {
    return { error: `Could not parse scaffold JSON: ${e.message}` };
  }
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

  const out = await runClaude(prompt, true, { fn: "revise-node", bookId }, { noTools: true, model: MODEL_PLANNING });
  if (out.error) return out;
  return { text: (out.text ?? "").trim() };
}

// ── /objective-options ───────────────────────────────────────────────────────
// Mirrors supabase/functions/objective-options: generate 3 wide alternative objectives for a slot.
const OBJECTIVE_OPTIONS_SYSTEM = `You are a book architect generating ALTERNATIVE OBJECTIVES for one outline slot.

An OBJECTIVE is 1–2 sentences stating what a page must achieve — its job in the story, not what happens beat-by-beat. The objective is the contract the beat and prose will fulfill.

You will be given the committed objectives for all pages before this slot as the story-so-far context. Use them as the causal foundation — something has to happen here that follows from where the story has arrived.

Generate exactly 3 ALTERNATIVES. Each must:
- Connect causally to the committed prefix (follow "therefore" or "but" from what came before)
- Honor the spine's throughline
- Be GENUINELY DIFFERENT from each other — different angle, direction, or emotional register
- Vary in ambition across the set: one quieter interior move, one larger external turn, one unexpected diagonal

Each option is a clean OBJECTIVE — 1–2 sentences of what the page must achieve. Do NOT label it with the technique ("Unexpected diagonal:", "Plant the mother:", etc.), do NOT add meta-commentary or stage directions, do NOT mention the reader. Just the objective itself.

Output JSON ONLY (no prose, no fences):
{ "options": ["<option 1>", "<option 2>", "<option 3>"] }`;

// slots: [{ pageType, title, objective }]; build the prefix from everything before targetIdx.
function objectivePrefixContext(slots, targetIdx) {
  const target = slots[targetIdx] ?? null;
  const lines = [];
  for (let i = 0; i < targetIdx; i++) {
    const p = slots[i];
    if (p.pageType === "section") {
      lines.push(`# ${p.title || "(untitled section)"}`);
    } else {
      const obj = p.objective?.trim();
      lines.push(`- "${p.title || "(untitled)"}" — ${obj || "(no objective yet)"}`);
    }
  }
  return {
    prefix: lines.join("\n") || "(this is the first page — no preceding objectives)",
    current: target?.objective?.trim() || "",
    title: target?.title?.trim() || "(untitled)",
  };
}

function parseObjectiveOptions(text) {
  let raw = text.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  else {
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first !== -1 && last > first) raw = raw.slice(first, last + 1);
  }
  const parsed = JSON.parse(raw);
  const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.options) ? parsed.options : []);
  return arr.map((s) => String(s).trim()).filter(Boolean);
}

async function runObjectiveOptions(body) {
  const { bookId, pageId, scaffold, pageIndex } = body;
  if (!bookId) return { error: "bookId required" };
  const draftMode = Array.isArray(scaffold?.pages) && typeof pageIndex === "number";
  if (!draftMode && !pageId) return { error: "pageId, or scaffold+pageIndex, required" };

  const book = await fetchBook(bookId);
  if (!book) return { error: "Book not found" };

  let slots, targetIdx;
  if (draftMode) {
    slots = scaffold.pages.map((p) => ({ pageType: p.pageType, title: p.title, objective: p.objective }));
    targetIdx = pageIndex;
    if (targetIdx < 0 || targetIdx >= slots.length) return { error: "pageIndex out of range" };
  } else {
    const pages = await fetchPages(bookId);
    targetIdx = pages.findIndex((p) => p.id === pageId);
    if (targetIdx === -1) return { error: "Page not found" };
    slots = pages.map((p) => ({ pageType: p.page_type, title: p.title, objective: p.metadata?.objective }));
  }

  const { prefix, current, title } = objectivePrefixContext(slots, targetIdx);
  const spine = book.spine?.text?.trim() || null;

  const userContent =
    `BOOK: ${book.name}\n\nBRIEF:\n${briefContext(book.brief)}` +
    (spine ? `\n\nBOOK SPINE (the throughline — alternatives must serve it):\n${spine}` : "") +
    `\n\nOBJECTIVES SO FAR (story-so-far — use as causal foundation):\n${prefix}` +
    `\n\nTHIS SLOT: "${title}"` +
    (current ? `\n\nCURRENT OBJECTIVE (what's there now — vary away from it):\n${current}` : "\n\n(No objective set yet for this slot.)") +
    `\n\nGenerate 3 wide-varying alternatives for this slot. JSON only.`;

  const prompt = `${OBJECTIVE_OPTIONS_SYSTEM}\n\n${userContent}`;
  const out = await runClaude(prompt, true, { fn: "objective-options", bookId }, { noTools: true, model: MODEL_PLANNING });
  if (out.error) return out;
  try {
    const options = parseObjectiveOptions(out.text ?? "");
    if (options.length === 0) return { error: "No options returned" };
    return { options };
  } catch (e) {
    return { error: `Could not parse options JSON: ${e.message}` };
  }
}

// ── foundations options + spine routes ───────────────────────────────────────
// Mirrors supabase/functions/_shared/foundations-core.ts (the pin-driven flow's candidate workers).
const FOUNDATIONS_STEP_SYSTEM = {
  argument: `You are a book architect proposing the book's ARGUMENT — the claim the whole story argues (e.g. "loyalty to a dead man can cost you every living one"). Generate exactly 3 candidates, genuinely different claims pulled from different tensions in the brief. Each: ~2 sentences, plus the ending it implies in one line.

Output JSON ONLY:
{ "candidates": [{ "text": "<~2 sentence claim>", "implied_ending": "<one line>" }, …] }`,
  ending: `You are a book architect proposing ENDINGS consistent with the book's selected argument. Generate exactly 3 candidates — same argument, different final images/costs/resolutions. Each ~2–3 sentences, concrete (who stands where, what it cost), not a synopsis.

Output JSON ONLY:
{ "candidates": [{ "text": "<the ending>" }, …] }`,
  cast: `You are a book architect proposing three complete CAST CONFIGURATIONS for this story. Each configuration stands alone: one protagonist and one or two major characters, each with want (external goal), wound (the unhealed injury driving them), and lie (the false belief the arc will break). Across the three options vary the protagonist's core wound and lie — each should represent a genuinely different human story pulled from different tensions in the brief. The major characters in each option should serve that specific protagonist's arc.

For each character also include:
- history: 1–2 sentence formative backstory that explains how they got their wound/lie
- idiolect: one line describing how they speak — diction, verbal tics, register (e.g. "speaks in short declaratives, never asks questions, drops g's")
- tag: one trackable physical or gesture marker (e.g. "always straightens objects on any surface near her")

For each proposal also include a "relationships" array capturing the key dyads among that proposal's members: { "a": "<member name>", "b": "<member name>", "bond": "<one line describing the relationship charge>" }.

Output JSON ONLY:
{ "proposals": [{ "label": "Option A", "members": [{ "name": "…", "role": "protagonist" | "major", "want": "…", "wound": "…", "lie": "…", "history": "…", "idiolect": "…", "tag": "…" }, …], "relationships": [{ "a": "…", "b": "…", "bond": "…" }, …] }, { "label": "Option B", "members": […], "relationships": […] }, { "label": "Option C", "members": […], "relationships": […] }] }`,

  world: `You are a book architect proposing the WORLD/SETTING for this story — a pinned, concrete artifact that all subsequent prose must stay consistent with. Ground every detail in the brief and the settled foundations; do not invent genre or setting that contradicts them. For non-genre stories, rules can be social, economic, or institutional constraints rather than magic or physics.

Propose exactly one world definition with:
- setting: where (and what kind of place) the story lives — specific enough to paint a picture
- period: when (era, season, moment in history, or "contemporary")
- rules: 3–5 load-bearing constraints of this story-world — the things prose must never contradict (physical laws if genre, social hierarchies, economic realities, institutional rules, etc.)

Output JSON ONLY:
{ "world": { "setting": "…", "period": "…", "rules": ["…", "…", "…"] } }`,

  tentpoles: `You are a book architect proposing TENTPOLE MOMENTS — vivid, concrete scenes the author can already see (1–3 sentences each, a moment not a summary). Generate exactly 6 proposals, spread across the book's whole arc, consistent with the settled argument/ending/cast. Never duplicate an existing tentpole; never resemble a killed direction.

Output JSON ONLY:
{ "candidates": [{ "text": "<the moment>" }, …] }`,
  voice: `You are a prose stylist. Render the given TENTPOLE MOMENT as ~120 words of finished prose in 3 DISTINCT voices — different sentence rhythm, distance, temperature. Label each with a 2–4 word descriptor (e.g. "spare and cold", "lush close-third"). Same moment, three soundscapes.

Output JSON ONLY:
{ "candidates": [{ "label": "<descriptor>", "text": "<~120 words>" }, …] }`,
};

const bridgeUid = () => crypto.randomUUID().slice(0, 8);

// The settled foundations rendered as hard constraints (pinned = immutable) — mirrors settledContext.
function foundationsContext(f) {
  const lines = [];
  const node = (label, n) => {
    if (n?.text?.trim()) lines.push(`${label}${n.pinned ? " (PINNED by the author — immutable, honor verbatim)" : ""}:\n${n.text.trim()}`);
  };
  node("ARGUMENT (the book's claim)", f.argument);
  node("ENDING", f.ending);
  if (f.cast?.length) {
    const cast = f.cast.map((c) => {
      const pf = c.pinned_fields ?? [];
      const line = (k) => (c[k] ? `  ${k}: ${c[k]}${pf.includes(k) ? " [PINNED]" : ""}` : null);
      const parts = [`- ${c.name} (${c.role ?? "major"})`, line("want"), line("wound"), line("lie")];
      if (c.history) parts.push(`  history: ${c.history}`);
      if (c.idiolect) parts.push(`  idiolect: ${c.idiolect}`);
      if (c.tag) parts.push(`  tag: ${c.tag}`);
      return parts.filter(Boolean).join("\n");
    }).join("\n");
    lines.push(`CAST (pinned lines are immutable):\n${cast}`);
  }
  // F2: render RELATIONSHIPS block (resolve a/b ids→names via cast map)
  if (f.relationships?.length) {
    const castMap = new Map((f.cast ?? []).map((c) => [c.id, c.name]));
    const rels = f.relationships.map((r) => {
      const nameA = castMap.get(r.a) ?? r.a;
      const nameB = castMap.get(r.b) ?? r.b;
      return `- ${nameA} ↔ ${nameB}: ${r.bond}${r.pinned ? " [PINNED]" : ""}`;
    }).join("\n");
    lines.push(`RELATIONSHIPS (pinned lines are immutable):\n${rels}`);
  }
  // F3a: render WORLD block
  if (f.world && (f.world.setting || f.world.period || (f.world.rules?.length))) {
    const pinSuffix = f.world.pinned ? " [PINNED]" : "";
    const worldLines = [];
    if (f.world.setting) worldLines.push(`setting: ${f.world.setting}${pinSuffix}`);
    if (f.world.period) worldLines.push(`period: ${f.world.period}${pinSuffix}`);
    if (f.world.rules?.length) {
      f.world.rules.forEach((rule) => worldLines.push(`rule: ${rule}${pinSuffix}`));
    }
    lines.push(`WORLD (pinned lines are immutable):\n${worldLines.join("\n")}`);
  }
  const live = (f.tentpoles ?? []).filter((t) => t.status !== "killed");
  const killed = (f.tentpoles ?? []).filter((t) => t.status === "killed");
  if (live.length) lines.push(`TENTPOLE MOMENTS (id · status · text — pinned ones MUST survive into any structure):\n${live.map((t) => `- [${t.id}] (${t.status}) ${t.text}`).join("\n")}`);
  if (killed.length) lines.push(`KILLED DIRECTIONS (the author rejected these — do NOT propose anything like them):\n${killed.map((t) => `- ${t.text}`).join("\n")}`);
  node("VOICE EXEMPLAR", f.voice_exemplar);
  // F4a: NARRATION block — mirrors settledContext in foundations-core.ts
  if (f.narration && (f.narration.person || f.narration.tense || f.narration.distance)) {
    const n = f.narration;
    const bits = [n.person, n.tense ? `${n.tense} tense` : null, n.distance].filter(Boolean);
    if (bits.length) lines.push(`NARRATION (the book's default narrative mode)${n.pinned ? " [PINNED]" : ""}:\n${bits.join(", ")}`);
  }
  return lines.length ? lines.join("\n\n") : "(nothing settled yet)";
}

// The sequel canon packet rendered as the CANON block (docs/pinned_method.md §8) — mirrors
// canonContext in supabase/functions/_shared/canon-core.ts. Null-safe: returns "" when not a sequel.
function canonBlock(canon) {
  if (!canon) return "";
  const lines = [
    `This book is a SEQUEL to "${canon.parent_title}". Everything below is CANON — settled fact from the previous book. Honor it exactly; never contradict it; never retell it. This book's own argument, ending and structure must be NEW, not a restatement of the previous book's.`,
  ];
  if (canon.summary?.trim()) lines.push(`PREVIOUS BOOK — WHAT HAPPENED (the throughline):\n${canon.summary.trim()}`);
  if (canon.ending?.trim()) lines.push(`HOW IT ENDED:\n${canon.ending.trim()}`);
  if (canon.cast?.length) {
    const cast = canon.cast.map((c) => {
      const line = (k) => (c[k] ? `  ${k} (as the last book left it): ${c[k]}` : null);
      return [`- ${c.name} (${c.role ?? "major"})`, line("want"), line("wound"), line("lie")].filter(Boolean).join("\n");
    }).join("\n");
    lines.push(`CAST AS THE PREVIOUS BOOK LEFT THEM (identities are canon; their inner state should have MOVED since — a resolved lie does not reappear intact):\n${cast}`);
  }
  if (canon.character_states?.length) {
    const states = canon.character_states.map((s) => {
      const bits = [
        s.believes ? `believes: ${s.believes}` : null,
        s.knows?.length ? `knows: ${s.knows.join("; ")}` : null,
        s.feels ? `feels: ${s.feels}` : null,
        s.has?.length ? `has: ${s.has.join("; ")}` : null,
      ].filter(Boolean).join(" · ");
      return `- ${s.name}${bits ? ` — ${bits}` : ""}`;
    }).join("\n");
    lines.push(`WHERE EACH CHARACTER STOOD ON THE FINAL PAGE:\n${states}`);
  }
  if (canon.final_state) {
    const sect = (label, rec) => {
      const entries = Object.entries(rec ?? {});
      if (entries.length) lines.push(`${label}:\n${entries.map(([k, v]) => `- ${k}: ${v}`).join("\n")}`);
    };
    sect("WORLD STATE AT THE END (canon facts)", canon.final_state.world);
    sect("VALUES WHERE THE LAST BOOK LEFT THEM", canon.final_state.value);
  }
  if (canon.resolved_threads?.length) {
    lines.push(`RESOLVED THREADS (already paid off — do NOT re-open these as if unresolved):\n${canon.resolved_threads.map((t) => `- ${t.name}${t.description ? ` — ${t.description}` : ""}`).join("\n")}`);
  }
  if (canon.carried_threads?.length) {
    lines.push(`THREADS STILL OPEN FROM THE PREVIOUS BOOK (this book's inherited hooks — honor them or consciously abandon them, never forget them):\n${canon.carried_threads.map((t) => `- ${t.name}${t.description ? ` — ${t.description}` : ""}`).join("\n")}`);
  }
  return lines.join("\n\n");
}

// Wraps canonBlock with the section header used everywhere a prompt gains the addendum.
function canonSection(canon) {
  const block = canonBlock(canon);
  return block ? `\n\nCANON (settled facts from the previous book — honor, never contradict, never retell):\n${block}` : "";
}

// Mirrors CAST_SEQUEL_ADDENDUM in foundations-core.ts (§8.4 cast rule).
const CAST_SEQUEL_ADDENDUM = `

THIS BOOK IS A SEQUEL. The CANON block lists the cast as the previous book left them. Keep those characters' names and identities exactly; propose where each is NOW — a new want/wound/lie grown out of how the last book resolved (a resolved lie does not reappear intact; a paid-off want leaves a vacuum that implies a new want). You may also add new characters.`;

function parseLooseJson(text) {
  let raw = (text ?? "").trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  else {
    const f = raw.search(/[{[]/);
    const l = Math.max(raw.lastIndexOf("}"), raw.lastIndexOf("]"));
    if (f !== -1 && l > f) raw = raw.slice(f, l + 1);
  }
  return JSON.parse(raw);
}

async function runFoundationsOptions(body) {
  const { bookId, step } = body;
  if (!bookId || !FOUNDATIONS_STEP_SYSTEM[step]) return { error: "bookId and a valid step required" };
  const book = await fetchBook(bookId);
  if (!book) return { error: "Book not found" };
  const f = book.foundations ?? {};

  let stepInput = "";
  if (step === "ending" && !f.argument?.text?.trim()) return { error: "Select an argument first." };
  if (step === "voice") {
    const live = (f.tentpoles ?? []).filter((t) => t.status !== "killed");
    const moment = live.find((t) => t.status === "pinned") ?? live[0];
    if (!moment) return { error: "Add at least one tentpole moment first." };
    stepInput = `\n\nTENTPOLE MOMENT TO RENDER:\n${moment.text}`;
  }
  if (body.prompt?.trim()) {
    stepInput += `\n\nAUTHOR'S DIRECTION:\n${body.prompt.trim()}`;
  }

  const _fsMandate = mandateContext(book.brief);
  const prompt = `${FOUNDATIONS_STEP_SYSTEM[step]}${book.canon && step === "cast" ? CAST_SEQUEL_ADDENDUM : ""}\n\nBOOK: ${book.name}\n\nBRIEF — binding contract (voice AND deliverables):\n${briefContext(book.brief)}${_fsMandate ? `\n\nMANDATE — NON-NEGOTIABLE (the book has FAILED if any of these are not delivered; do not treat them as flavor):\n${_fsMandate}` : ""}${canonSection(book.canon)}\n\nSETTLED FOUNDATIONS SO FAR:\n${foundationsContext(f)}${stepInput}\n\nGenerate the candidates. JSON only.`;
  const out = await runClaude(prompt, true, { fn: `foundations-${step}`, bookId }, { noTools: true, model: MODEL_PLANNING });
  if (out.error) return out;
  try {
    const raw = parseLooseJson(out.text);

    // F3a: world step returns a single { world } node directly (not a candidates list).
    if (step === "world") {
      const w = raw.world ?? {};
      const world = {
        ...(w.setting ? { setting: String(w.setting).trim() } : {}),
        ...(w.period ? { period: String(w.period).trim() } : {}),
        ...(Array.isArray(w.rules) && w.rules.length ? { rules: w.rules.map((r) => String(r).trim()).filter(Boolean) } : {}),
      };
      if (!world.setting && !world.period && !world.rules?.length) return { error: "Claude returned an empty world node." };
      return { world };
    }

    // F1+F2: cast step returns { proposals } — 3 complete cast configs, not a flat candidates list.
    if (step === "cast") {
      const rawProposals = Array.isArray(raw.proposals) ? raw.proposals : [];
      if (rawProposals.length === 0) return { error: "No cast proposals returned" };
      const proposals = rawProposals.map((prop) => {
        const members = (Array.isArray(prop.members) ? prop.members : []).map((c) => ({
          id: bridgeUid(),
          name: String(c.name ?? "").trim(),
          role: c.role === "protagonist" ? "protagonist" : "major",
          want: String(c.want ?? "").trim(),
          wound: String(c.wound ?? "").trim(),
          lie: String(c.lie ?? "").trim(),
          pinned_fields: [],
          ...(c.history ? { history: String(c.history).trim() } : {}),
          ...(c.idiolect ? { idiolect: String(c.idiolect).trim() } : {}),
          ...(c.tag ? { tag: String(c.tag).trim() } : {}),
        })).filter((c) => c.name);
        // Resolve relationship name references → freshly-assigned member ids; drop unresolvable.
        const nameToId = new Map(members.map((m) => [m.name.toLowerCase(), m.id]));
        const relationships = (Array.isArray(prop.relationships) ? prop.relationships : [])
          .map((r) => {
            const aId = nameToId.get(String(r.a ?? "").trim().toLowerCase());
            const bId = nameToId.get(String(r.b ?? "").trim().toLowerCase());
            if (!aId || !bId) return null;
            const bond = String(r.bond ?? "").trim();
            if (!bond) return null;
            return { id: bridgeUid(), a: aId, b: bId, bond };
          })
          .filter(Boolean);
        return {
          label: String(prop.label ?? "").trim() || "Option",
          members,
          ...(relationships.length ? { relationships } : {}),
        };
      }).filter((p) => p.members.length > 0);
      if (proposals.length === 0) return { error: "Claude returned no cast proposals." };
      return { proposals };
    }

    const arr = Array.isArray(raw.candidates) ? raw.candidates : [];
    if (arr.length === 0) return { error: "No candidates returned" };
    let candidates;
    if (step === "tentpoles") {
      candidates = arr.map((c) => ({ id: bridgeUid(), text: String(c.text ?? "").trim(), source: "ai", status: "fluid" })).filter((c) => c.text);
    } else {
      candidates = arr.map((c) => ({
        id: bridgeUid(), text: String(c.text ?? "").trim(),
        ...(c.implied_ending ? { implied_ending: String(c.implied_ending).trim() } : {}),
        ...(c.label ? { label: String(c.label).trim() } : {}),
      })).filter((c) => c.text);
    }
    return { candidates };
  } catch (e) {
    return { error: `Could not parse candidates JSON: ${e.message}` };
  }
}

// ── /ai-run ───────────────────────────────────────────────────────────────────
// Mirrors supabase/functions/ai-run: the durable harness for short ops. The bridge has no wall-clock
// cap, so it inserts the running row, runs the worker, and writes the terminal row synchronously
// (runGeneration) — the client watches the SAME book_generations row over Realtime either way.
async function aiRunWorker(kind, params, bookId) {
  const fail = (out) => { if (out.error) throw new Error(out.error); return out; };
  switch (kind) {
    case "objective_options":
      return { options: fail(await runObjectiveOptions({ bookId, ...params })).options };
    case "spine":
      return { text: fail(await runBriefToSpine({ bookId })).spine };
    case "spine_options":
      return { options: fail(await runSpineOptions({ bookId })).options };
    case "node_revise":
      return { text: fail(await runReviseNode({ bookId, ...params })).text };
    case "beat_candidates":
      return { options: fail(await runObjectiveToBeat({ bookId, pageId: params.pageId, objective: params.objective, candidates: 3 })).candidates };
    case "foundations_options": {
      const fo = fail(await runFoundationsOptions({ bookId, step: params.step, prompt: params.prompt }));
      // cast returns { proposals }, world returns { world }, others return { candidates }
      if (fo.proposals) return { proposals: fo.proposals };
      if (fo.world) return { world: fo.world };
      return { candidates: fo.candidates };
    }
    default:
      throw new Error(`Unknown ai-run kind: ${kind}`);
  }
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

  const out = await runClaude(prompt, true, { fn: "beat-to-objective", bookId }, { noTools: true, model: MODEL_PLANNING });
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

  const out = await runClaude(prompt, true, { fn: "objectives-to-spine", bookId }, { noTools: true, model: MODEL_PLANNING });
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
- Honor the book's brief as a non-negotiable contract — its VOICE (genre, audience, tone, premise)
  AND its MANDATE (what the book must deliver: the success criteria, heat/explicitness, genre
  obligations, and length). When a voice sample is provided it is the strongest STYLE anchor:
  match its register, rhythm, and diction above all else, including above the register of any beat
  or objective text. But style anchoring governs HOW the page reads, never WHAT it delivers — it is
  never license to soften, abstract, or fade-to-black a mandated beat, nor to fall short of length.
- The beat is a STORY PLAN — follow what it says must happen and in what order, but ignore
  its prose style entirely. The beat tells you WHAT; the brief and voice sample tell you HOW.
- Use the outline and preceding prose for consistency, facts, AND dramatic irony. The reader
  has seen every preceding page; you may write for that shared awareness even when the POV
  character hasn't — let the reader know more than the narrator does when the story calls for it.
  Do NOT repeat what's already been written; do NOT continue or finish a sentence from the
  preceding prose — begin this unit cleanly with a new sentence.
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

const VOICE_TELLS = `"a testament to", "in a world where", "little did they know", "sent shivers down", "couldn't help but", "a mix of … and …", "navigating the complexities of", and neat moral-of-the-story endings`;

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
  // Voice: foundations.voice_exemplar is canonical; bible.voice_sample is a legacy read-fallback only.
  const voiceSample = book.foundations?.voice_exemplar?.text?.trim() || book.bible?.voice_sample?.trim() || null;
  const steerText = typeof book.steers?.prose === "string" ? book.steers.prose.trim() : "";
  const foundations = book.foundations ?? null;
  // F4a: prose-layer craft note from books.craft_notes
  const craftNoteProse = book.craft_notes?.["prose"] ?? book.craft_notes?.["foundations"] ?? null;
  // F4a: book-level narration defaults — now from books.foundations.narration (bible.narration is legacy).
  const narration = book.foundations?.narration ?? null;

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

  // F2: character and relationship states from the most-recent prior page that carries them.
  let characterStates = null, relationshipStates = null;
  if (level === "page" && current) {
    const priorCs = pages.filter((p) => p.page_index < current.page_index && (p.metadata?.character_states?.length ?? 0) > 0);
    const latestCs = priorCs.at(-1)?.metadata?.character_states;
    if (latestCs?.length) {
      const lines = latestCs.map((c) => {
        const arc = [c.want && `wants ${c.want}`, c.wound && `wound: ${c.wound}`].filter(Boolean).join("; ");
        const now = [c.knows?.length ? `knows ${c.knows.join("; ")}` : "", c.feels ? `feels ${c.feels}` : "", c.has?.length ? `has ${c.has.join("; ")}` : "", c.believes ? `believes ${c.believes}` : ""].filter(Boolean).join(", ");
        return `- ${c.name}${arc ? ` (${arc})` : ""}: ${now || "—"}`;
      });
      characterStates = `CHARACTER STATES (as of the previous page — keep each character consistent with what they currently know, feel, have and believe; do not reset them, and let what happens here move them):\n${lines.join("\n")}`;
    }
    const priorRel = pages.filter((p) => p.page_index < current.page_index && (p.metadata?.relationship_states?.length ?? 0) > 0);
    const latestRel = priorRel.at(-1)?.metadata?.relationship_states;
    if (latestRel?.length) {
      const lines = latestRel.map((r) => `- ${r.pair}: ${r.charge}${r.note ? ` (${r.note})` : ""}`);
      relationshipStates = `RELATIONSHIP STATES (as of the previous page — let these charges drive the scene; flips here should feel earned):\n${lines.join("\n")}`;
    }
  }

  // F3b: open loops via book_thread_anchors (fixed — no longer reads dropped flat columns).
  let openLoops = null;
  if (level === "page" && current) {
    openLoops = await bridgeBuildOpenLoops(bookId, pages, current);
  }

  // F3b: established facts from bible.facts with page_index < current.
  let establishedFacts = null;
  if (level === "page" && current) {
    const facts = book.bible?.facts ?? [];
    const prior = facts.filter((f) => typeof f.page_index === "number" && f.page_index < current.page_index);
    if (prior.length) {
      establishedFacts = `ESTABLISHED FACTS (do not contradict — these were set in earlier pages):\n${prior.map((f) => `- ${f.fact}`).join("\n")}`;
    }
  }

  // F3c: story-time from the current page's planned metadata.time.
  let storyTime = null;
  if (level === "page" && current) {
    const t = current.metadata?.time;
    if (t) {
      const parts2 = [t.when && `when: ${t.when}`, t.elapsed && `elapsed: ${t.elapsed}`].filter(Boolean);
      if (parts2.length) storyTime = parts2.join("; ");
    }
  }

  // F4a: POV character from current page metadata.
  const pov = (level === "page" && current?.metadata?.pov) ? current.metadata.pov : null;

  // F1: CAST VOICES block — mirrors renderCastVoices in generate-unit-core.
  const castVoicesBlock = (() => {
    const cast = foundations?.cast ?? [];
    const lines = cast
      .filter((m) => m.idiolect?.trim() || m.history?.trim() || m.tag?.trim())
      .map((m) => {
        const label = [m.name, m.tag?.trim() && `— ${m.tag.trim()}`].filter(Boolean).join(" ");
        const body2 = [`speaks ${m.idiolect?.trim() || "—"}`, m.history?.trim()].filter(Boolean).join(". ");
        return `- ${label}: ${body2}`;
      });
    if (!lines.length) return null;
    return `CAST VOICES (render each character's dialogue in their idiolect; let a character's history color what they notice and how they phrase things):\n${lines.join("\n")}`;
  })();

  // F3a: WORLD block — mirrors renderWorld in generate-unit-core.
  const worldBlock = (() => {
    const world = foundations?.world;
    if (!world) return null;
    const wParts = [];
    if (world.setting?.trim()) wParts.push(world.setting.trim());
    if (world.period?.trim()) wParts.push(`period: ${world.period.trim()}`);
    if (world.rules?.length) wParts.push(`rules:\n${world.rules.map((r) => `- ${r}`).join("\n")}`);
    if (!wParts.length) return null;
    return `WORLD (setting, period, and rules — never contradict these):\n${wParts.join("\n")}`;
  })();

  // F4a: NARRATION block — mirrors renderNarration in generate-unit-core.
  const narrationBlock = (() => {
    if (!narration) return null;
    const nParts = [narration.person && `in ${narration.person}`, narration.tense && `${narration.tense} tense`, narration.distance?.trim()].filter(Boolean);
    if (!nParts.length) return null;
    return `NARRATION (the book's default narrative mode — honor it):\nNarrate ${nParts.join(", ")}.`;
  })();

  const _unitMandate = mandateContext(book.brief);
  const parts = [
    mode === "revise" ? UNIT_SYSTEM_REVISE : UNIT_SYSTEM,
    "",
    `BOOK: ${book.name}`,
    `\nBRIEF — binding contract (voice AND deliverables):\n${briefContext(book.brief)}`,
    _unitMandate ? `\nMANDATE — NON-NEGOTIABLE (the book has FAILED if any of these are not delivered; do not treat them as flavor):\n${_unitMandate}` : "",
  ];
  { const c = canonBlock(book.canon); if (c) parts.push(`\nCANON (settled facts from the previous book — honor, never contradict, never retell):\n${c}`); }
  if (voiceSample) parts.push(`\nVOICE SAMPLE (write in THIS voice — match its rhythm, sentence shapes, diction and restraint; this exemplar is a stronger style anchor than any instruction):\n"""\n${voiceSample}\n"""\nAvoid AI-tell crutches: ${VOICE_TELLS}.`);
  // F1: per-character voice differentiation (after voice sample)
  if (castVoicesBlock) parts.push(`\n${castVoicesBlock}`);
  // F3a: pinned world/setting node
  if (worldBlock) parts.push(`\n${worldBlock}`);
  // F4a: book-level narration defaults
  if (narrationBlock) parts.push(`\n${narrationBlock}`);
  // F4a: prose-layer craft note authored in the studio
  if (craftNoteProse?.trim()) parts.push(`\nCRAFT NOTE (author's guidance for this book's prose — apply it):\n${craftNoteProse.trim()}`);
  if (objectiveMap) parts.push(`\nOUTLINE (the book's pages and their objectives, in order):\n${objectiveMap}`);
  if (storySoFar) parts.push(`\nSTORY SO FAR (summaries of earlier pages, for continuity):\n${storySoFar}`);
  if (mode === "revise") {
    if (precedingProse) parts.push(`\nPRECEDING PROSE (the page(s) just before this one — for continuity of voice, facts, and dramatic irony; the reader has seen everything here):\n"""\n${precedingProse}\n"""`);
    if (objective?.trim()) parts.push(`\nThis page is meant to achieve: ${objective.trim()}`);
    if (characterStates) parts.push(`\n${characterStates}`);
    if (relationshipStates) parts.push(`\n${relationshipStates}`);
    if (openLoops) parts.push(`\n${openLoops}`);
    if (establishedFacts) parts.push(`\n${establishedFacts}`);
    if (storyTime) parts.push(`\nSTORY TIME: ${storyTime}`);
    if (pov) parts.push(`\nPOV: ${pov}`);
    parts.push(`\nCURRENT PAGE PROSE (revise this in place):\n"""\n${currentText}\n"""`);
    parts.push(`\nTHE EDITOR'S NOTES TO ADDRESS ON THIS PAGE:\n${formatIssues(issues)}`);
    parts.push(`\nRevise the page to address every note above while preserving its strengths, the book's voice, and continuity with the rest of the book. Return the full revised page prose only.`);
  } else {
    if (precedingProse) parts.push(`\nPRECEDING PROSE (the pages just before this one — for continuity of voice, facts, and dramatic irony; the reader has seen everything here, so you may write for that shared awareness even when the POV character hasn't; do not continue or finish its last sentence, and do not repeat what's already been said):\n"""\n${precedingProse}\n"""`);
    if (level === "page" && characterStates) parts.push(`\n${characterStates}`);
    // F2: relationship states alongside character states (page-level only)
    if (level === "page" && relationshipStates) parts.push(`\n${relationshipStates}`);
    if (level === "page" && openLoops) parts.push(`\n${openLoops}`);
    // F3b: established facts the model must not contradict (page-level only)
    if (level === "page" && establishedFacts) parts.push(`\n${establishedFacts}`);
    // F3c: story-time orientation
    if (level === "page" && storyTime) parts.push(`\nSTORY TIME: ${storyTime}`);
    // F4a: POV character
    if (level === "page" && pov) parts.push(`\nPOV: ${pov}`);
    if (pageObjective?.trim()) parts.push(`\nThis paragraph sits on a page whose objective is: ${pageObjective.trim()}`);
    if (precedingText?.trim()) parts.push(`\nThe prose immediately before this paragraph (continue naturally):\n"""\n${precedingText.trim()}\n"""`);
    // C4: per-page word target injection (page level only, write mode).
    if (level === "page") {
      const _unitWordTarget = book.brief?.scope?.word_target ?? 0;
      const _unitContentCount = _unitWordTarget > 0 ? pages.filter((p) => p.page_type !== "section").length : 0;
      const _unitPerPageTarget = (_unitWordTarget > 0 && _unitContentCount > 0) ? Math.round(_unitWordTarget / _unitContentCount) : 0;
      if (_unitPerPageTarget > 0) {
        parts.push(`\nTARGET LENGTH: aim for ~${_unitPerPageTarget} words for this page. This is a hard requirement from the brief's length mandate — do not stop short; write the full scene.`);
      }
    }
    parts.push(
      level === "paragraph"
        ? `\nWrite ONE paragraph that achieves this objective:\n${objective.trim()}`
        : beat
          ? `\nWrite the prose for a page (multiple paragraphs as needed) that realizes this BEAT. The beat is the STORY PLAN — follow what it says must happen and in what order; do not imitate its prose style. All voice, tone, and register come from the brief and voice sample above.\nOBJECTIVE (the aim): ${objective.trim()}\nBEAT (the story plan — what must happen, not how to sound): ${beat}`
          : `\nWrite the prose for a page that achieves this objective (multiple paragraphs as needed):\n${objective.trim()}`
    );
    if (steerText) parts.push(`\n\nAUTHOR'S STEER FOR THIS STEP (honor it as a strong instruction shaping THIS output; it never overrides the brief or the voice sample):\n${steerText}`);
  }

  const out = await runClaude(parts.join("\n"), true, { fn: mode === "revise" ? "revise-prose" : "beat-to-prose", bookId }, { noTools: true, model: MODEL_PROSE });
  if (out.error) return out;

  let text = out.text.trim();
  const fence = text.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  // Drop any leading markdown heading lines (model restating the page title).
  { const lines = text.split("\n"); let i = 0; while (i < lines.length && (lines[i].trim() === "" || /^#{1,6}\s+/.test(lines[i].trim()))) i++; const s = lines.slice(i).join("\n").trim(); if (s) text = s; }
  if (!text) return { error: "Claude returned no text content" };

    // Persist a "story so far" summary (+ F3c: story-time) for this page (best-effort).
  if (level === "page" && pageId) {
    try {
      const sumResult = await bridgeSummarize(text, bookId);
      if (sumResult.summary) await bridgePersistSummary(pageId, sumResult.summary, sumResult.time ?? null);
    } catch (e) {
      console.error("bridge unit: summary step failed (non-fatal):", e.message);
    }
    // F2: extract character + relationship states and persist them (best-effort).
    try {
      await bridgeMaybeExtractStates(bookId, pageId, text);
    } catch (e) {
      console.error("bridge unit: state extraction failed (non-fatal):", e.message);
    }
  }

  return { text };
}

// ── /generate-book — bulk "build the draft" (beats → optional pause → prose) ──
// Local parity for supabase/functions/generate-book: plan a beat for every objective-bearing page
// that lacks one, then write prose for every empty one — writing the SAME book_generations row
// (kind 'write_all'/'rerender_stale') the edge fn writes, so the studio watches it identically. The
// edge fn self-chains ONE unit per invocation (the worker's wall-clock cap); the bridge has no cap,
// so it runs the whole cascade in one async pass, patching progress between units. Two cheap edge
// niceties are dropped here (not load-bearing for dev): best-of-3 beat judging (single sample) and
// character-ledger extraction (the bridge's runUnit doesn't read the ledger anyway). Provenance
// stamps and per-page summaries — which the dirty graph and continuity DO depend on — are mirrored.
async function runGenerateBook(body) {
  const bookId = Number(body.bookId);
  const rerenderIds = Array.isArray(body.pageIds) ? body.pageIds.filter((n) => typeof n === "number") : [];
  const rerender = rerenderIds.length > 0;
  const pauseAfterBeats = body.pauseAfterBeats === true && !rerender;

  const book = await fetchBook(bookId);
  if (!book) return { error: "Book not found" };
  const allPages = (await fetchPages(bookId)).filter((p) => p.page_type === "text");

  const proseRemaining = rerender
    ? allPages.filter((p) => rerenderIds.includes(p.id) && p.metadata?.objective?.trim()).map((p) => p.id)
    : allPages.filter((p) => p.metadata?.objective?.trim() && !bgBodyText(p.content)).map((p) => p.id);
  if (proseRemaining.length === 0) {
    return { error: rerender ? "None of those pages can be re-rendered (no objective)." : "No empty pages with an objective were found." };
  }

  const beatsRemaining = rerender
    ? []
    : allPages.filter((p) => p.metadata?.objective?.trim() && !(p.metadata?.beat ?? "").trim()).map((p) => p.id);
  const stage = beatsRemaining.length > 0 ? "beats" : "prose";

  const progress = {
    done: 0, total: proseRemaining.length, remaining: proseRemaining, failures: 0,
    stage, beatsRemaining, beatsTotal: beatsRemaining.length, beatsDone: 0, pauseAfterBeats, rerender,
    phase: stage === "beats" ? `Planning beats 0/${beatsRemaining.length}` : `Writing 0/${proseRemaining.length}`,
  };
  const row = await insertGeneration(bookId, { kind: rerender ? "rerender_stale" : "write_all", scope: "book", input: { rerender, pauseAfterBeats }, progress });
  if (!row) return { error: "could not create generation row" };

  // Fire-and-forget: the client watches the row over Realtime (parity with the edge's 202 + background).
  driveGenerateBook(row.id, bookId, pauseAfterBeats, progress).catch(async (e) => {
    await updateGeneration(row.id, { status: "error", error: String(e?.message ?? e).slice(0, 1000) });
  });
  return { generation: row };
}

// Beats stage (if any) → optional pause → prose stage. Runs to completion; patches progress as it goes.
async function driveGenerateBook(genId, bookId, pauseAfterBeats, progress) {
  let failures = progress.failures ?? 0;
  const beats = progress.beatsRemaining ?? [];
  if (beats.length > 0) {
    let beatsDone = 0;
    for (const pageId of beats) {
      const meta = await readMeta(pageId);
      const objective = meta?.objective?.trim();
      if (!objective) continue; // no longer eligible — drop silently
      if ((meta.beat ?? "").trim()) { beatsDone++; continue; } // already has a beat
      try {
        const out = await runObjectiveToBeat({ bookId, pageId, objective });
        if (out.error || !out.beat) throw new Error(out.error ?? "no beat");
        await stampBeatMeta(pageId, objective, out.beat);
        beatsDone++;
      } catch (e) {
        failures++;
        console.error(`generate-book: beat for page ${pageId} failed:`, e.message);
      }
      await updateGeneration(genId, { progress: { ...progress, beatsDone, failures, phase: `Planning beats ${beatsDone}/${progress.beatsTotal}` } });
    }
    progress = { ...progress, beatsRemaining: [], beatsDone, failures, stage: "prose" };
    if (pauseAfterBeats) {
      await updateGeneration(genId, { status: "ready", progress: { ...progress, phase: "beats_done" } });
      return;
    }
    await updateGeneration(genId, { progress: { ...progress, phase: `Writing 0/${progress.total}` } });
  }
  await driveProse(genId, bookId, progress);
}

// Prose stage: write each remaining page (clobber-safe), patch progress, finish 'done'.
async function driveProse(genId, bookId, progress) {
  const remaining = [...(progress.remaining ?? [])];
  const rerender = progress.rerender === true;
  let done = progress.done ?? 0;
  let failures = progress.failures ?? 0;
  for (let i = 0; i < remaining.length; i++) {
    const pageId = remaining[i];
    // Re-read the page fresh (clobber-safe + fresh objective/title).
    const r = await fetch(`${SUPABASE_URL}/rest/v1/pages?id=eq.${pageId}&select=id,title,content,metadata`, { headers: sbHeaders });
    const page = (await r.json())?.[0];
    const objective = page?.metadata?.objective?.trim();
    const alreadyWritten = page ? bgBodyText(page.content) : true;
    // Fill mode skips a page that already has prose; re-render is an explicit overwrite.
    if (page && objective && (rerender || !alreadyWritten)) {
      try {
        const unit = await runUnit({ bookId, pageId, level: "page", objective, mode: "write" });
        if (unit.error || !unit.text) throw new Error(unit.error ?? "no prose");
        await writePageContent(pageId, page.title, unit.text);
        await stampProseMeta(pageId, objective, unit.text);
      } catch (e) {
        failures++;
        console.error(`generate-book: page ${pageId} failed:`, e.message);
      }
    }
    done++;
    await updateGeneration(genId, { progress: { ...progress, remaining: remaining.slice(i + 1), done, failures, phase: `Writing ${done}/${progress.total}` } });
  }
  await updateGeneration(genId, { status: "done", progress: { ...progress, remaining: [], done, failures, phase: "Done" } });
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
  "revise-scaffold": "supabase/functions/revise-scaffold/index.ts (and scripts/eval-bridge.mjs runReviseScaffold)",
  "objective-options": "supabase/functions/objective-options/index.ts (and scripts/eval-bridge.mjs runObjectiveOptions)",
  "spine-options": "supabase/functions/spine-options/index.ts (and scripts/eval-bridge.mjs runSpineOptions)",
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

  const out = await runClaude(prompt, true, { fn: "judge-ai-call", bookId: call.book_id }, { model: MODEL_PLANNING });
  if (out.error) throw new Error(out.error);
  return parseJudgement(out.text);
}

// ── Server ────────────────────────────────────────────────────────────────────
// ── mandate gate (conformance backstop) — mirrors supabase/functions/_shared/mandate-gate.ts ──
const GATE_JUDGE_SYSTEM =
  `You are a CONFORMANCE AUDITOR for a book-generation pipeline. You are given a book's brief MANDATE ` +
  `(what the author promised the finished book would deliver) and its full manuscript. For each axis, ` +
  `judge strictly and from evidence whether the FINISHED PROSE delivers the mandate — a delivery check, ` +
  `not a quality review. The key failure to catch: a mandate LAUNDERED OUT — an explicit/sensual heat ` +
  `requirement the prose quietly fades-to-black, or a comedy mandate the book abandons as it gets earnest.\n\n` +
  `Judge exactly these axes:\n` +
  `- "heat": does intimacy render at the mandated explicitness? If the MANDATE (content type, or an ` +
  `ecchi/romance genre, or a "turning on"/"scintillating" success criterion) implies on-the-page heat, do ` +
  `key intimate scenes appear ON THE PAGE, or fade to black at the decisive moment? FAIL=faded/absent, ` +
  `PARTIAL=timid/uneven, PASS=delivered.\n` +
  `- "genre": is the genre obligation honored THROUGHOUT (a comedy stays funny)? FAIL=drifts, PARTIAL=slips, PASS=sustained.\n` +
  `- "success": are the author's success_criteria met by the finished book?\n` +
  `If an axis is not mandated, return verdict "pass" with detail "not mandated".\n\n` +
  `Return ONLY this JSON: {"axes":[{"axis":"heat","verdict":"pass|partial|fail","detail":"<one line>","evidence":"<short quote or page title>"}]}`;

function gateLength(target, wc) {
  if (!target) return { axis: "length", verdict: "pass", detail: "No word target set — length not mandated.", evidence: `${wc} words` };
  const ratio = wc / target, pct = Math.round(ratio * 100);
  const evidence = `${wc.toLocaleString()} / ${target.toLocaleString()} words (${pct}%)`;
  if (ratio >= 0.85 && ratio <= 1.25) return { axis: "length", verdict: "pass", detail: "Within range of the target length.", evidence };
  if (ratio < 0.85 && ratio >= 0.6) return { axis: "length", verdict: "partial", detail: "Runs short of the target length.", evidence };
  if (ratio > 1.25 && ratio <= 1.5) return { axis: "length", verdict: "partial", detail: "Runs over the target length.", evidence };
  if (ratio < 0.6) return { axis: "length", verdict: "fail", detail: "Far below the target length — unfinished against scope.", evidence };
  return { axis: "length", verdict: "fail", detail: "Far over the target length.", evidence };
}

async function runMandateGate(bookId) {
  const book = await fetchBook(bookId);
  if (!book) return { error: "Book not found" };
  const brief = book.brief ?? {};
  const pages = await fetchPages(bookId);
  if (!pages.length) return { error: "Book has no pages to check." };

  let wordCount = 0;
  const manuscript = pages.map((p) => {
    if ((p.page_type ?? "") === "section") return `\n\n## ${p.title ?? ""}\n`;
    const text = tiptapToText(p.content).trim();
    wordCount += text ? text.split(/\s+/).filter(Boolean).length : 0;
    return `\n\n----- ${p.title ?? `Page ${p.page_index}`} -----\n${text}`;
  }).join("");

  const target = brief.scope?.word_target ?? null;
  const lengthAxis = gateLength(target, wordCount);

  const mandate = mandateContext(brief) || "(no explicit mandate set)";
  const user =
    `BRIEF MANDATE (what the book promised to deliver):\n${mandate}\n\n` +
    `GENRE: ${brief.genre ?? "(unset)"}\nSUCCESS CRITERIA: ${brief.success_criteria ?? "(unset)"}\n\n` +
    `Judge the manuscript below against the mandate. JSON only.\n\nFULL MANUSCRIPT:\n${manuscript}`;
  const out = await runClaude(`${GATE_JUDGE_SYSTEM}\n\n${user}`, true, { fn: "mandate-gate", bookId }, { noTools: true, model: MODEL_PLANNING });
  if (out.error) return { error: out.error };
  let proseAxes;
  try { proseAxes = (parseLooseJson(out.text).axes ?? []).filter((a) => a && a.axis && a.verdict); }
  catch { proseAxes = [{ axis: "heat", verdict: "partial", detail: "Judge response could not be parsed — inspect by hand.", evidence: out.text.slice(0, 160) }]; }

  const axes = [lengthAxis, ...proseAxes];
  const overall = axes.some((a) => a.verdict === "fail") ? "fail" : axes.some((a) => a.verdict === "partial") ? "partial" : "pass";
  return { report: { overall, axes, wordCount, wordTarget: target } };
}

// ── /dna-expand (mirrors supabase/functions/dna-expand) ───────────────────────
// Single-field expand for the Novel DNA tree: generate a node's next rung as ONE authoritative version
// (not 2–3 proposals). Scene → prose fills the scene's text. See docs/novel-dna-spec.md §6.
// [EXP:preconditions] EXPERIMENT (removable) — must match novelDna.ts + dna-expand/index.ts. Flip to false
// to disable; grep "[EXP:preconditions]" to remove.
const EXP_PRECONDITIONS = true;
// DNA_SPEC removed — generation config now lives in the node_type_configs DB table.
// The bridge fetches config from Supabase (same as the edge fn) so both stay in sync.
async function fetchNodeTypeConfig(target) {
  if (!target) return null;
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/node_type_configs?target=eq.${encodeURIComponent(target)}&select=target,child_kind,child_level,role,count,schema_json,slots&limit=1`,
    { headers: sbHeaders }
  );
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0] ?? null;
}
// Placeholder to keep line numbers stable for the DNA_SPEC entries that were here.
const _DNA_SPEC_MOVED_TO_DB = true;
// ── begin DNA_SPEC stubs (now in DB) ──
// relationships, set-pieces, threads, games, movements, beats, scenes, voice_profile — all in DB now.
// ── end DNA_SPEC stubs ──
const DNA_ENTITY_KINDS = new Set(["character", "relationship", "tentpole", "world_fact", "thread", "game", "voice_profile"]);
function scenesInOrderBridge(allNodes) {
  const out = [];
  const childrenSorted = (pid) => allNodes.filter((n) => n.parent_id === pid).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const walk = (n) => {
    if (n.kind === "scene") out.push(n);
    for (const c of childrenSorted(n.id)) if (!DNA_ENTITY_KINDS.has(c.kind)) walk(c);
  };
  for (const root of allNodes.filter((n) => n.parent_id === null)) walk(root);
  return out;
}
// mode controls how many preceding pages are fed verbatim:
//   "default" → last 3 (production behavior)   "last1" → only the immediately-preceding page
//   "all"     → every prior page in reading order (the prose-context experiment, arm B)
function buildPrevProseBlockBridge(allNodes, currentId, mode = "default") {
  const ordered = scenesInOrderBridge(allNodes);
  const idx = ordered.findIndex((s) => s.id === currentId);
  if (idx <= 0) return "";
  const start = mode === "all" ? 0 : mode === "last1" ? Math.max(0, idx - 1) : Math.max(0, idx - 3);
  const prev = ordered.slice(start, idx).filter((s) => String(s.content?.prose?.text ?? "").trim());
  if (!prev.length) return "";
  return "PRECEDING PAGES (maintain continuity of voice, cadence, and character — do NOT repeat phrases, images, or sentence patterns used here):\n" +
    prev.map((s, i) => `--- Page ${idx - prev.length + i + 1} ---\n${s.content.prose.text}`).join("\n\n");
}

// proseWindow / prevProseOverride / captureContext are experiment hooks (default: production behavior):
//   proseWindow       → which preceding-page window to feed verbatim (see buildPrevProseBlockBridge)
//   prevProseOverride → replace the PRECEDING PAGES block wholesale (e.g. the arm-C digest packet)
//   captureContext    → also return the exact assembled prompt, so the harness can size/compare it
async function runDnaExpand({ bookId, nodeId, target, proseWindow = "default", prevProseOverride = null, captureContext = false }) {
  const book = await fetchBook(bookId);
  if (!book) return { error: "Book not found" };
  const r = await fetch(`${SUPABASE_URL}/rest/v1/book_nodes?book_id=eq.${bookId}&select=id,parent_id,kind,position,content,authoring`, { headers: sbHeaders });
  const nodes = await r.json();
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return { error: "Node not found" };

  const mandate = mandateContext(book.brief);
  const map = new Map(nodes.map((n) => [n.id, n]));
  const chain = [];
  for (let p = node.parent_id; p; p = map.get(p)?.parent_id ?? null) { const a = map.get(p); if (a) chain.unshift(a); }
  // Cast/world registry off the pillar — feed in so generation is character/world-aware.
  const pillar = node.kind === "pillar" ? node : chain.find((a) => a.kind === "pillar");
  const entities = pillar ? nodes.filter((n) => n.parent_id === pillar.id && ["character", "world_fact", "relationship"].includes(n.kind)) : [];
  const chars = entities.filter((e) => e.kind === "character");
  const cName = (e) => String(e.content?.name ?? "").trim();
  const entityBlock = entities.length
    ? "CAST & WORLD (reference characters BY NAME):\n" +
      chars.map((c) => `- ${cName(c)} [${c.content?.role ?? "?"}] ${JSON.stringify(c.content)}`).join("\n") +
      entities.filter((e) => e.kind === "world_fact").map((w) => `\n- WORLD: ${w.content?.rule ?? ""}`).join("")
    : "";
  // Promise registry + the arc — beats/scenes anchor real threads by name; threads gen sees the whole arc.
  const threads = pillar ? nodes.filter((n) => n.parent_id === pillar.id && n.kind === "thread") : [];
  const tName = (e) => String(e.content?.name ?? "").trim();
  const threadBlock = threads.length
    ? "THREADS — the promise registry (reference BY NAME):\n" +
      threads.map((t) => `- ${tName(t)}: ${t.content?.promise ?? ""} → ${t.content?.payoff ?? ""}`).join("\n")
    : "";
  const movements = pillar ? nodes.filter((n) => n.parent_id === pillar.id && n.kind === "movement").sort((a, b) => (a.position ?? 0) - (b.position ?? 0)) : [];
  const movementBlock = movements.length
    ? "THE ARC (movements in order — place promises across these):\n" +
      movements.map((m) => `- [${m.content?.title ?? ""}] turn: ${m.content?.turning_point ?? ""}`).join("\n")
    : "";
  const tentpoles = pillar ? nodes.filter((n) => n.parent_id === pillar.id && n.kind === "tentpole" && (n.authoring?.locked || n.authoring?.status === "accepted")) : [];
  const tpName = (e) => String(e.content?.summary ?? "").trim();
  const tentpoleBlock = tentpoles.length
    ? "TENTPOLES — set-pieces you MUST place (assign each to the beat that delivers it, BY its summary):\n" +
      tentpoles.map((t) => `- ${tpName(t)}`).join("\n")
    : "";
  const worldFacts = pillar ? nodes.filter((n) => n.parent_id === pillar.id && n.kind === "world_fact") : [];
  const wfName = (e) => String(e.content?.name ?? e.content?.rule ?? "").trim();
  const worldRulesBlock = worldFacts.length
    ? "WORLD RULES (the mechanisms a turning point can fire — reference BY NAME in grounds_in):\n" +
      worldFacts.map((w) => `- ${wfName(w)}: ${w.content?.mechanism ?? w.content?.rule ?? ""}`).join("\n")
    : "";
  const games = pillar ? nodes.filter((n) => n.parent_id === pillar.id && n.kind === "game") : [];
  const gName = (e) => String(e.content?.name ?? "").trim();
  const gamesBlock = games.length
    ? "GAMES (the contests — reference BY NAME in plays/resolves; WIN vs LOSE):\n" +
      games.map((g) => `- ${gName(g)}: WIN = ${g.content?.win_condition ?? "?"} | LOSE = ${g.content?.lose_condition ?? "?"}`).join("\n")
    : "";
  // [EXP:preconditions]
  const statePreconds = EXP_PRECONDITIONS
    ? games.flatMap((g) => (g.content?.win_requires ?? []).filter((r) => r.type === "state" && r.key).map((r) => ({ key: r.key, what: r.what ?? "", game: gName(g) })))
    : [];
  const precondBlock = statePreconds.length
    ? "STATE PRECONDITIONS (each must be ESTABLISHED by an earlier beat — list its key in that beat's `establishes` — BEFORE the beat that resolves its game):\n" +
      statePreconds.map((p) => `- ${p.key} (${p.game}): ${p.what}`).join("\n")
    : "";
  // Voice profile — governs all prose; inject into every generation call.
  const voiceProfileNode = pillar ? nodes.find((n) => n.parent_id === pillar.id && n.kind === "voice_profile") : null;
  const vp = voiceProfileNode?.content;
  const voiceBlock = vp
    ? "VOICE PROFILE (every word of prose must conform to this):\n" +
      [vp.pov ? `- POV: ${vp.pov}` : "", vp.tense ? `- Tense: ${vp.tense}` : "", vp.style ? `- Style: ${vp.style}` : ""].filter(Boolean).join("\n") +
      (Array.isArray(vp.constraints) && vp.constraints.length ? `\n- Rules:\n${vp.constraints.map((c) => `  • ${c}`).join("\n")}` : "") +
      (vp.sample ? `\n- Reference sample (match this voice exactly):\n${vp.sample}` : "")
    : "";
  // Prose context, mirroring supabase/functions/dna-expand: production prose → digest v2 (all-page
  // continuity + anti-echo). The experiment passes prevProseOverride (its own digest) or a verbatim
  // proseWindow (last1/all for arms A/B); production callers pass neither, so they get the v2 digest.
  // Caption keeps the short last-3-verbatim window.
  const prevProseBlock = prevProseOverride != null
    ? prevProseOverride
    : (target === "prose" || (!target && node.kind === "scene"))
      ? (proseWindow === "last1" || proseWindow === "all"
          ? buildPrevProseBlockBridge(nodes, nodeId, proseWindow)
          : await buildProductionDigest(bookId, nodes, nodeId))
      : target === "caption"
        ? buildPrevProseBlockBridge(nodes, nodeId, "default")
        : "";
  const ctx = [
    `BOOK: ${book.name ?? ""}`,
    `BRIEF (binding):\n${briefContext(book.brief)}`,
    mandate ? `MANDATE — NON-NEGOTIABLE:\n${mandate}` : "",
    voiceBlock,
    "STORY SO FAR (the ladder above this node; LOCKED items are immutable):",
    ...chain.map((a) => `[${a.kind}${a.authoring?.locked ? " · LOCKED" : ""}] ${JSON.stringify(a.content)}`),
    entityBlock,
    threadBlock,
    tentpoleBlock,
    worldRulesBlock,
    gamesBlock,
    precondBlock, // [EXP:preconditions]
    movementBlock,
    prevProseBlock,
    `THIS NODE [${node.kind}]: ${JSON.stringify(node.content)}`,
  ].filter(Boolean).join("\n\n");

  if (target === "prose" || (!target && node.kind === "scene")) {
    const prompt = `You are a novelist writing the PROSE for one scene, from its plan. Write the scene fully — vivid, causal, in the book's voice — honoring the MANDATE (heat/tone/length) without laundering. Output the prose ONLY: no preamble, no headings, no JSON.

VOICE — write ONLY the fiction, from inside the story: NEVER address or mention "the reader"/"you", and NEVER refer to "the book", "the story", "the scene", "the page", the author, or the writing itself. The plan's notes describe INTENT in craft terms (e.g. "the reader is told it reads as fury", "the book plants the wrong label") — those are directions TO YOU, not lines to reproduce. Dramatize that intent through concrete action, sensation, and subtext; never narrate it or break the fourth wall.

${ctx}\n\nWrite this scene's prose.`;
    const out = await runClaude(prompt, true, { fn: "dna-expand", bookId }, { noTools: true, model: MODEL_PLANNING });
    if (out.error) return out;
    return captureContext ? { prose: out.text.trim(), prompt, ctx, prevProseBlock } : { prose: out.text.trim() };
  }
  if (target === "caption") {
    // Picture mode (docs/picture-book-mode.md) — mirrors supabase/functions/dna-expand. The page TEXT under
    // a scene's illustration: a short caption (1–3 sentences), NOT full prose. The image carries the moment.
    const prompt = `You are writing the CAPTION for ONE illustrated page of a picture book, from the scene's plan. The picture carries the moment — your job is the few words beneath it that carry the book's VOICE and move the story one beat. Honor the MANDATE (tone/reading age). Output the caption text ONLY: no preamble, no headings, no quotes, no JSON.

RULES:
- 1 to 3 sentences. Tight, rhythmic, read-aloud-able. Often one is enough.
- Tell what the picture cannot: the turn, the feeling, the line of dialogue — never just label what's already visible ("A boy stands in a hall").
- Write ONLY from inside the story: NEVER address or mention "the reader"/"you", and NEVER refer to "the book", "the story", "the scene", "the page", "the picture/image", the author, or the writing itself. The plan's notes are directions TO YOU, not lines to reproduce.

${ctx}\n\nWrite this page's caption.`;
    const out = await runClaude(prompt, true, { fn: "dna-expand", bookId }, { noTools: true, model: MODEL_PLANNING });
    if (out.error) return out;
    return { caption: out.text.trim() };
  }
  if (target === "beatsheet") {
    // GLOBAL beat-sheet pass (root fix) — mirrors supabase/functions/dna-expand. One call, whole arc in view:
    // schedule setup→payoff in order, plan polarity to oscillate. enforcePromiseSchedule (inline) drops orphan
    // payoffs so setup→payoff is an INVARIANT. Returns a flat movement-indexed list; the caller persists it.
    if (!movements.length) return { error: "generate the movements before the beat sheet" };
    if (!threads.length) return { error: "generate the threads before the beat sheet" };
    const prompt = `You are a story architect writing the ENTIRE BOOK'S BEAT SHEET in ONE pass — every beat of every act at once, so you can see the whole sequence. Honor every LOCKED ancestor and the MANDATE verbatim. Rules:
- 2 to 4 beats per movement; each beat links to the prior with "therefore" or "but" (escalating causality).
- Set each beat's PLANNED polarity (up = ends better, down = ends worse). The movement's value shift is the MACRO trend; you MUST still OSCILLATE within it — never more than ~3 beats of the same polarity in a row. Place deliberate relief/hope-spots inside down-acts and setbacks inside up-acts.
- Schedule the THREADS across the whole book: every promise must be SET UP (role:setup) in an EARLIER beat before it is PAID OFF (role:payoff) in a LATER beat; use "advance" for beats in between. Reference threads BY NAME.
- CAUSE every turn: give each beat "needs" (state keys it DEPENDS ON, each one EARNED by an EARLIER beat — never an ambient world/premise given) and "establishes" (state keys it PRODUCES). Keys are short snake_case handles (e.g. "ledger_settled", "rival_humiliated", "peculium_revealed"). Every "therefore" beat MUST "need" at least one state an earlier beat "establishes" — that upstream dependency is what makes the turn CAUSED, not "and then". A "but" beat must either reverse the polarity or block/consume an established state.${tentpoles.length ? `\n- PLACE every TENTPOLE: assign each set-piece to the ONE beat that delivers it, in "realizes" (by its summary). Every tentpole listed must appear on exactly one beat.` : ""}${worldFacts.length ? `\n- GROUND the turns in the WORLD RULES: when a beat's turning point's outcome OPERATES ON a rule's mechanism, list that rule in "grounds_in" (by name). The CLIMAX / final resolution beat MUST ground its win in an established rule — the victory has to be MECHANICALLY EARNED by a rule the reader already knows, never deus ex machina. Plant the rule's setup in an earlier beat too.` : ""}${games.length ? `\n- PLAY the GAMES: each beat that advances a contest lists it in "plays" (by name). Each game MUST be RESOLVED — exactly one beat lists it in "resolves" with its outcome (won|lost), and the CENTRAL game resolves at the CLIMAX. A game's resolving beat should also ground_in the rule its win/lose fires.` : ""}${statePreconds.length ? `\n- ESTABLISH every STATE PRECONDITION: each game's win SPENDS resources/states (listed above). For each, an EARLIER beat must establish it (list its key in that beat's "establishes") BEFORE the beat that resolves the game — you cannot spend a resource the story never acquired (no "she had enough all along"). Make the establishing a real turn.` : ""}
Output JSON ONLY: { "beats": [ { "movement": <1..${movements.length}>, "summary": "...", "connector": "therefore"|"but", "polarity": "up"|"down", "threads": [ { "ref": "<thread name>", "role": "setup"|"advance"|"payoff" } ]${tentpoles.length ? `, "realizes": [ "<tentpole summary>" ]` : ""}${worldFacts.length ? `, "grounds_in": [ "<world rule name>" ]` : ""}${games.length ? `, "plays": [ "<game name>" ], "resolves": [ { "ref": "<game name>", "outcome": "won|lost" } ]` : ""}, "needs": [ "<state key earned upstream>" ], "establishes": [ "<state key this beat produces>" ] } ] }\n\n${ctx}\n\nWrite the whole beat sheet. JSON only.`;
    const out = await runClaude(prompt, true, { fn: "dna-expand", bookId }, { noTools: true, model: MODEL_PLANNING });
    if (out.error) return out;
    let raw = out.text.trim();
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) raw = fence[1].trim();
    else { const f = raw.indexOf("{"), l = raw.lastIndexOf("}"); if (f !== -1 && l > f) raw = raw.slice(f, l + 1); }
    let rawBeats;
    try { rawBeats = JSON.parse(raw).beats; } catch { return { error: "Could not parse beat sheet JSON" }; }
    if (!Array.isArray(rawBeats)) return { error: "beat sheet had no beats" };
    const tNameToId = new Map(threads.map((t) => [tName(t).toLowerCase(), t.id]));
    const tpNameToId = new Map(tentpoles.map((t) => [tpName(t).toLowerCase(), t.id]));
    const wfNameToId = new Map(worldFacts.map((w) => [wfName(w).toLowerCase(), w.id]));
    const gNameToId = new Map(games.map((g) => [gName(g).toLowerCase(), g.id]));
    const normKey = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, "_");
    const roles = new Set(["setup", "payoff", "advance"]);
    const setUp = new Set();
    const claimedTp = new Set();
    const resolvedG = new Set();
    const beats = rawBeats.map((b) => {
      const mi = Math.min(Math.max(parseInt(String(b.movement ?? 1), 10) || 1, 1), movements.length) - 1;
      const refs = (Array.isArray(b.threads) ? b.threads : [])
        .map((t) => ({ ref: tNameToId.get(String(t.ref ?? "").trim().toLowerCase()), role: t.role }))
        .filter((t) => t.ref && roles.has(String(t.role)));
      for (const t of refs) if (t.role === "setup") setUp.add(t.ref);
      const threadsKept = refs.filter((t) => t.role !== "payoff" || setUp.has(t.ref));
      const realizes = (Array.isArray(b.realizes) ? b.realizes : [])
        .map((s) => tpNameToId.get(String(s ?? "").trim().toLowerCase()))
        .filter((id) => id && !claimedTp.has(id) && (claimedTp.add(id), true));
      const grounds = [...new Set((Array.isArray(b.grounds_in) ? b.grounds_in : [])
        .map((s) => wfNameToId.get(String(s ?? "").trim().toLowerCase()))
        .filter(Boolean))];
      const plays = [...new Set((Array.isArray(b.plays) ? b.plays : [])
        .map((s) => gNameToId.get(String(s ?? "").trim().toLowerCase()))
        .filter(Boolean))];
      const resolves = (Array.isArray(b.resolves) ? b.resolves : [])
        .map((r) => ({ ref: gNameToId.get(String(r.ref ?? "").trim().toLowerCase()), outcome: r.outcome === "lost" ? "lost" : "won" }))
        .filter((r) => r.ref && !resolvedG.has(r.ref) && (resolvedG.add(r.ref), true));
      // CAUSALITY (core): open snake_case state vocab; experiment's win preconditions are a subset (no filter).
      const establishes = [...new Set((Array.isArray(b.establishes) ? b.establishes : []).map(normKey).filter(Boolean))];
      const needs = [...new Set((Array.isArray(b.needs) ? b.needs : []).map(normKey).filter(Boolean))];
      const content = { summary: b.summary, connector: b.connector, polarity: b.polarity === "down" ? "down" : "up", threads: threadsKept };
      if (realizes.length) content.realizes = realizes;
      if (grounds.length) content.grounds_in = grounds;
      if (plays.length) content.plays = plays;
      if (resolves.length) content.resolves = resolves;
      if (establishes.length) content.establishes = establishes;
      if (needs.length) content.needs = needs;
      return { movement: mi, content };
    });
    return { beatsheet: true, childKind: "beat", childLevel: 4, movementIds: movements.map((m) => m.id), beats };
  }

  // Generic DNA target: load config from node_type_configs (mirrors edge fn), rebuild ctx with slot-filtered blocks.
  const config = await fetchNodeTypeConfig(target);
  if (!config) return { error: `Unknown expand target "${target}"` };
  const slots = config.slots ?? {};
  const slottedCtx = [
    `BOOK: ${book.name ?? ""}`,
    `BRIEF (binding):\n${briefContext(book.brief)}`,
    mandate ? `MANDATE — NON-NEGOTIABLE:\n${mandate}` : "",
    slots.voice ? voiceBlock : "",
    "STORY SO FAR (the ladder above this node; LOCKED items are immutable):",
    ...chain.map((a) => `[${a.kind}${a.authoring?.locked ? " · LOCKED" : ""}] ${JSON.stringify(a.content)}`),
    slots.entities ? entityBlock : "",
    slots.threads ? threadBlock : "",
    slots.tentpoles ? tentpoleBlock : "",
    slots.worldRules ? worldRulesBlock : "",
    slots.games ? gamesBlock : "",
    slots.preconditions ? precondBlock : "", // [EXP:preconditions]
    slots.arc ? movementBlock : "",
    `THIS NODE [${node.kind}]: ${JSON.stringify(node.content)}`,
  ].filter(Boolean).join("\n\n");
  const prompt = `You are a story architect expanding a ${node.kind} into ${config.role}. Generate ${config.count} ${config.child_kind}s as ONE authoritative structure — NOT alternatives. Honor every LOCKED ancestor and the MANDATE verbatim. Output JSON ONLY: { "children": [ ${config.schema_json} ] }\n\n${slottedCtx}\n\nGenerate the ${config.child_kind}s. JSON only.`;
  const out = await runClaude(prompt, true, { fn: "dna-expand", bookId }, { noTools: true, model: MODEL_PLANNING });
  if (out.error) return out;
  let raw = out.text.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  else { const f = raw.indexOf("{"), l = raw.lastIndexOf("}"); if (f !== -1 && l > f) raw = raw.slice(f, l + 1); }
  try {
    const parsed = JSON.parse(raw);
    let children = Array.isArray(parsed.children) ? parsed.children : [];
    if (config.child_kind === "relationship") {
      const nameToId = new Map(chars.map((c) => [cName(c).toLowerCase(), c.id]));
      children = children
        .map((ch) => ({ ...ch, a: nameToId.get(String(ch.a ?? "").trim().toLowerCase()), b: nameToId.get(String(ch.b ?? "").trim().toLowerCase()) }))
        .filter((ch) => ch.a && ch.b && ch.a !== ch.b);
    }
    if (config.child_kind === "beat" || config.child_kind === "scene") {
      const tNameToId = new Map(threads.map((t) => [tName(t).toLowerCase(), t.id]));
      const roles = new Set(["setup", "payoff", "advance"]);
      children = children.map((ch) => {
        const raw = Array.isArray(ch.threads) ? ch.threads : [];
        const resolved = raw
          .map((t) => ({ ref: tNameToId.get(String(t.ref ?? "").trim().toLowerCase()), role: t.role }))
          .filter((t) => t.ref && roles.has(String(t.role)));
        const { threads: _drop, ...rest } = ch;
        return resolved.length ? { ...rest, threads: resolved } : rest;
      });
    }
    if (config.child_kind === "game") {
      // Resolve players (char names→ids) + governing_rules (rule names→ids). couples.to = SIBLING game name,
      // left for the caller to resolve post-mint.
      const cNameToId = new Map(chars.map((c) => [cName(c).toLowerCase(), c.id]));
      const wfNameToId = new Map(worldFacts.map((w) => [wfName(w).toLowerCase(), w.id]));
      const effects = new Set(["void", "raise", "lower", "enable"]);
      const whens = new Set(["won", "lost"]);
      children = children.map((ch) => ({
        ...ch,
        players: [...new Set((Array.isArray(ch.players) ? ch.players : []).map((p) => cNameToId.get(String(p ?? "").trim().toLowerCase())).filter(Boolean))],
        governing_rules: [...new Set((Array.isArray(ch.governing_rules) ? ch.governing_rules : []).map((r) => wfNameToId.get(String(r ?? "").trim().toLowerCase())).filter(Boolean))],
        couples: (Array.isArray(ch.couples) ? ch.couples : [])
          .filter((k) => k.to && whens.has(String(k.when)) && effects.has(String(k.effect)))
          .map((k) => ({ to: String(k.to).trim(), when: k.when, effect: k.effect, note: k.note })),
        // [EXP:preconditions]
        ...(EXP_PRECONDITIONS ? { win_requires: (Array.isArray(ch.win_requires) ? ch.win_requires : [])
          .filter((r) => (r.type === "rule" || r.type === "state") && r.what)
          .map((r) => ({ type: r.type, what: r.what, ...(r.type === "state" && r.key ? { key: String(r.key).trim().toLowerCase().replace(/\s+/g, "_") } : {}) })) } : {}),
      }));
    }
    return { childKind: config.child_kind, childLevel: config.child_level, children };
  } catch { return { error: "Could not parse expand JSON" }; }
}

// ── /dna-chat (mirrors supabase/functions/dna-chat) ───────────────────────────
const DNA_STAGE_KINDS = {
  premise: ["seed", "premise"], foundations: ["pillar", "character", "relationship", "tentpole", "world_fact", "voice_profile"],
  structure: ["movement", "beat", "thread"], scenes: ["scene"], draft: ["scene"],
};
// The content schema the reviser must conform to — GENERATED from the web app's NODE_SCHEMA (the single
// source of truth) into this checked artifact, kept in sync by apps/web/.../dnaSchema.artifact.test.ts.
// Never hand-edit the field guide; edit NODE_SCHEMA and regenerate. Mirrors supabase/functions/dna-chat.
const DNA_SCHEMA = JSON.parse(readFileSync(join(repoRoot, "supabase/functions/_shared/dna-schema.json"), "utf8"));
const DNA_STAGE_GUIDE = {
  premise: "the PREMISE — the logline, genre, tone, dramatic question, and the 5-part shape. Sharpen the question and the turns.",
  foundations: "the FOUNDATIONS — the controlling idea, the ending, and the CAST (want/need/wound/lie/truth/idiolect), world rules, tentpoles, relationships. The wound + lie are the human core; deepen, don't generic-ify.",
  structure: "the STRUCTURE — acts (movements) and their causal beats. Hunt sagging middles, weak turning points, 'and-then' beats.",
  scenes: "the SCENES — each scene's pov/goal/conflict/outcome and its VALUE SHIFT. Every scene must turn a value.",
  draft: "the DRAFT — the prose of each scene. Voice, heat (per the mandate), pacing. Edit a scene's prose under content.prose.text.",
};
async function runDnaChat({ bookId, stage, message, analysis }) {
  if (!DNA_STAGE_KINDS[stage]) return { error: "valid stage required" };
  const book = await fetchBook(bookId);
  if (!book) return { error: "Book not found" };
  const nodes = await (await fetch(`${SUPABASE_URL}/rest/v1/book_nodes?book_id=eq.${bookId}&select=id,parent_id,kind,level,content,authoring`, { headers: sbHeaders })).json();
  const ex = await (await fetch(`${SUPABASE_URL}/rest/v1/dna_chats?book_id=eq.${bookId}&stage=eq.${stage}&select=messages,pending_proposal`, { headers: sbHeaders })).json();
  const existing = ex[0];
  const prior = Array.isArray(existing?.messages) ? existing.messages : [];
  const withUser = [...prior, { role: "user", text: String(message ?? "").trim(), ts: new Date().toISOString() }];
  const jh = { ...sbHeaders, "Content-Type": "application/json" };
  await fetch(`${SUPABASE_URL}/rest/v1/dna_chats?on_conflict=book_id,stage`, { method: "POST", headers: { ...jh, Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ book_id: bookId, stage, messages: withUser, status: "thinking", error: null }) });

  const mandate = mandateContext(book.brief);
  // Whole tree, edit anything; prose only on the draft stage (mirrors supabase/functions/dna-chat).
  const withProse = stage === "draft";
  const serialize = (n) => {
    let content = n.content;
    if (!withProse && n.kind === "scene" && content && typeof content === "object" && "prose" in content) {
      const { prose: _drop, ...rest } = content;
      content = rest;
    }
    return `[${n.id}${n.authoring?.locked ? " · LOCKED" : ""}] L${n.level} ${n.kind}: ${JSON.stringify(content)}`;
  };
  const tree = [...nodes].sort((a, b) => (a.level ?? 0) - (b.level ?? 0)).map(serialize).join("\n");
  const system = `You are a sharp, warm developmental STORY EDITOR in conversation with an author. Your current FOCUS is ${DNA_STAGE_GUIDE[stage]}\n\nYou hold the book's ENTIRE DNA tree — premise → foundations → structure → scenes${withProse ? " → prose" : ""} — and you may edit, add, or delete ANY non-locked node at ANY level, not just your focus stage.${withProse ? " Scene PROSE is included (content.prose.text); you may rewrite it." : ""}\n\nReply in plain MARKDOWN prose. If — and ONLY if — this message DELIVERS a concrete change to apply, append at the VERY END a single fenced \`\`\`json block (nothing after it) with node ops over the REAL ids given:\n{ "summary": "<one line>", "ops": [ { "op": "edit", "id": "<id>", "content": { … } }, { "op": "add", "kind": "<kind>", "parentId": "<id>", "content": { … } }, { "op": "delete", "id": "<id>" }, { "op": "replace_children", "parentId": "<parent id>", "childKind": "movement", "children": [ { "content": { … }, "children": [ { "content": { … } } ] } ] } ] }\nOnly reference ids that exist; never edit/delete a LOCKED node; talk first, propose only when asked or agreed. To REBUILD a whole level (replace all acts/beats), use ONE replace_children op — it deletes the existing non-locked children of childKind first, so the rebuild never duplicates; children nest down the ladder (movement→beat→scene). Use "add" only to APPEND a single node.\n\n${DNA_SCHEMA.promptGuide}`;
  const ctx = [
    `BOOK: ${book.name ?? ""}`,
    `BRIEF (binding): ${briefContext(book.brief)}`,
    mandate ? `MANDATE — NON-NEGOTIABLE: ${mandate}` : "",
    analysis?.trim() ? `STORY ANALYSIS (the structural backstop — address any ⚠ flags):\n${analysis.trim()}` : "",
    `THE DNA TREE (edit/add/delete by these ids; LOCKED = immutable):\n${tree || "(none yet)"}`,
  ].filter(Boolean).join("\n\n");
  const convo = withUser.slice(-12).map((m) => `${m.role.toUpperCase()}: ${m.text}`).join("\n\n");
  const out = await runClaude(`${system}\n\n${ctx}\n\nCONVERSATION:\n${convo}\n\nRespond to the latest message.`, true, { fn: "dna-chat", bookId }, { noTools: true, model: MODEL_PLANNING });
  if (out.error) return out;

  const full = out.text.trim();
  let reply = full, proposal = null;
  const fence = full.match(/```json\s*([\s\S]*?)```\s*$/);
  if (fence) {
    try {
      let raw = fence[1].trim();
      const parsed = JSON.parse(raw);
      const ids = new Set(nodes.map((n) => n.id));
      const locked = new Set(nodes.filter((n) => n.authoring?.locked).map((n) => n.id));
      const ops = (Array.isArray(parsed.ops) ? parsed.ops : []).filter((o) =>
        (o.op === "edit" && ids.has(o.id) && !locked.has(o.id)) || (o.op === "delete" && ids.has(o.id) && !locked.has(o.id)) || (o.op === "add" && ids.has(o.parentId)) ||
        (o.op === "replace_children" && ids.has(o.parentId) && !locked.has(o.parentId) && o.childKind && Array.isArray(o.children) && o.children.length > 0));
      if (ops.length) { proposal = { summary: String(parsed.summary ?? "Proposed change").trim(), ops }; reply = full.slice(0, fence.index).trim(); }
    } catch { /* keep prose */ }
  }
  const assistant = { role: "assistant", text: reply, ts: new Date().toISOString(), plan: proposal?.summary };
  await fetch(`${SUPABASE_URL}/rest/v1/dna_chats?book_id=eq.${bookId}&stage=eq.${stage}`, { method: "PATCH", headers: jh, body: JSON.stringify({ messages: [...withUser, assistant], pending_proposal: proposal ?? existing?.pending_proposal ?? null, status: "idle" }) });
  return { reply, proposal };
}

// ── Prose-context experiment (docs/plan: 1-page vs all-pages vs digest) ─────────
// Dev-only A/B/C harness: regenerate ONE scene's prose under three preceding-context regimes,
// holding everything else (voice/cast/threads/plan) constant. Reuses runDnaExpand so the context
// assembly stays single-sourced. Endpoints below skip the per-book authorize() because the caller
// is the local CLI orchestrator, not a browser (no user JWT in scope); they're localhost-only.

// Shared context lookup for the experiment + judge: the target node, the prior prosed pages in
// reading order, the pillar's cast (for name-drift), the voice profile, and a per-scene word target.
async function getExperimentContext(bookId, nodeId) {
  const book = await fetchBook(bookId);
  if (!book) return { error: "Book not found" };
  const r = await fetch(`${SUPABASE_URL}/rest/v1/book_nodes?book_id=eq.${bookId}&select=id,parent_id,kind,position,content,authoring`, { headers: sbHeaders });
  const nodes = await r.json();
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return { error: "Node not found" };
  const ordered = scenesInOrderBridge(nodes);
  const idx = ordered.findIndex((s) => s.id === nodeId);
  const priorProsed = ordered.slice(0, idx).filter((s) => String(s.content?.prose?.text ?? "").trim());
  const map = new Map(nodes.map((n) => [n.id, n]));
  const chain = [];
  for (let p = node.parent_id; p; p = map.get(p)?.parent_id ?? null) { const a = map.get(p); if (a) chain.unshift(a); }
  const pillar = chain.find((a) => a.kind === "pillar");
  const castNames = pillar ? nodes.filter((n) => n.parent_id === pillar.id && n.kind === "character").map((c) => String(c.content?.name ?? "").trim()).filter(Boolean) : [];
  const vpNode = pillar ? nodes.find((n) => n.parent_id === pillar.id && n.kind === "voice_profile") : null;
  const wt = book?.brief?.scope?.word_target;
  const wordTarget = wt ? Math.round(Number(wt) / Math.max(ordered.length, 1)) : null;
  return { book, nodes, node, ordered, idx, priorProsed, castNames, voice: vpNode?.content ?? null, wordTarget };
}

// Arm C's "efficient format": a compressed digest of all earlier pages (one summary-model call) +
// a continuity ledger + a deterministic anti-repetition blocklist + the LAST page verbatim. In
// production this digest would be built incrementally as each page is written and cached; here we
// build it in one pass over the prior prose (a one-time cost, reported separately from the cheap
// generation call it enables).
async function buildDigestParts(bookId, earlier) {
  let storySoFar = "", ledger = "";
  if (earlier.length) {
    const corpus = earlier.map((s, i) => `--- Page ${i + 1} ---\n${s.content.prose.text}`).join("\n\n");
    const dprompt = `You are compressing a novel-in-progress into a CONTINUITY DIGEST for the writer about to draft the next scene. From the pages below, output STRICT JSON only:
{
  "pages": ["<one tight line per page, in order: POV + location/time, the value-shift, the key facts ESTABLISHED, and the closing image>"],
  "ledger": {
    "characters": ["<name — current status, where they are, what they want now>"],
    "objects": ["<object/clue in play — its state>"],
    "locations": ["<place — what's there>"],
    "timeline": "<elapsed time / current point in the story>",
    "open_threads": ["<promise opened but not yet paid — its state>"]
  }
}
Exactly one "pages" entry per page, in order. No prose, no preamble — JSON only.

PAGES:
${corpus}`;
    const out = await runClaude(dprompt, true, { fn: "prose-exp-digest", bookId }, { noTools: true, model: MODEL_SUMMARY });
    if (!out.error) {
      try {
        const p = parseLooseJson(out.text);
        storySoFar = (p.pages || []).map((x, i) => `- Page ${i + 1}: ${x}`).join("\n");
        const L = p.ledger || {};
        ledger = [
          L.characters?.length ? `Characters:\n${L.characters.map((c) => `  • ${c}`).join("\n")}` : "",
          L.objects?.length ? `Objects in play: ${L.objects.join("; ")}` : "",
          L.locations?.length ? `Locations: ${L.locations.join("; ")}` : "",
          L.timeline ? `Timeline: ${L.timeline}` : "",
          L.open_threads?.length ? `Open threads:\n${L.open_threads.map((t) => `  • ${t}`).join("\n")}` : "",
        ].filter(Boolean).join("\n");
      } catch { /* leave digest text-light; blocklist + last page still carry continuity */ }
    }
  }
  return { storySoFar, ledger };
}

// Assemble the digest packet from the shared parts. variant "v1" = original; "v2" applies the
// experiment's key finding — the verbatim previous page was the top source of accidental verbatim
// repetition, so its distinctive phrases go INTO the blocklist and it carries an explicit anti-echo
// instruction (don't reuse/complete/paraphrase its closing image or final line).
function assembleDigest(parts, info, variant = "v1") {
  const { priorProsed } = info;
  const last = priorProsed[priorProsed.length - 1];
  const earlier = priorProsed.slice(0, -1);
  const { storySoFar, ledger } = parts || { storySoFar: "", ledger: "" };
  const blocklistCorpus = (variant === "v2" ? priorProsed : earlier).map((s) => s.content.prose.text).join("\n");
  const blocklist = distinctivePhrases(blocklistCorpus);
  const prevPage = variant === "v2"
    ? `<previous_page note="for voice + cadence ONLY — do NOT reuse, complete, or paraphrase its closing image or final line; open this scene on a different beat and in a different register">\n${last.content.prose.text}\n</previous_page>`
    : `<previous_page>\n${last.content.prose.text}\n</previous_page>`;
  return [
    "PRECEDING CONTEXT — an efficient digest of the pages so far. Treat it as authoritative continuity; maintain the established voice and do NOT reuse any phrase listed under avoid_repeating:",
    storySoFar && `<story_so_far>\n${storySoFar}\n</story_so_far>`,
    ledger && `<continuity_ledger>\n${ledger}\n</continuity_ledger>`,
    blocklist.length && `<avoid_repeating>\n${blocklist.map((p) => `- ${p}`).join("\n")}\n</avoid_repeating>`,
    prevPage,
  ].filter(Boolean).join("\n\n");
}

// Production prose context (mirrors supabase/functions/dna-expand buildProseDigest): the v2 digest
// for the live "write this scene's prose" path. Built inline per call (incremental caching = follow-up).
async function buildProductionDigest(bookId, nodes, currentId) {
  const ordered = scenesInOrderBridge(nodes);
  const idx = ordered.findIndex((s) => s.id === currentId);
  if (idx <= 0) return "";
  const priorProsed = ordered.slice(0, idx).filter((s) => String(s.content?.prose?.text ?? "").trim());
  if (!priorProsed.length) return "";
  const parts = await buildDigestParts(bookId, priorProsed.slice(0, -1));
  return assembleDigest(parts, { priorProsed }, "v2");
}

// arms: any of A (last1), B (all verbatim), C (digest v1), D (digest v2). Default A/B/C.
async function runProseExperiment({ bookId, nodeId, arms = ["A", "B", "C"] }) {
  const info = await getExperimentContext(bookId, nodeId);
  if (info.error) return info;
  if (info.idx <= 0) return { error: "target scene has no preceding prose; pick a later scene" };
  if (!info.priorProsed.length) return { error: "no preceding prosed pages found before the target scene" };
  const priorText = info.priorProsed.map((s) => s.content.prose.text).join("\n\n");
  // One summary call powers BOTH digest variants (they differ only in blocklist + prev-page handling).
  const needDigest = arms.some((a) => a === "C" || a === "D");
  const parts = needDigest ? await buildDigestParts(bookId, info.priorProsed.slice(0, -1)) : null;
  const digestV1 = arms.includes("C") ? assembleDigest(parts, info, "v1") : "";
  const digestV2 = arms.includes("D") ? assembleDigest(parts, info, "v2") : "";
  const REG = {
    A: { label: "last 1 page (verbatim)", opts: { proseWindow: "last1" } },
    B: { label: "all prior pages (verbatim)", opts: { proseWindow: "all" } },
    C: { label: "digest v1", opts: { prevProseOverride: digestV1 } },
    D: { label: "digest v2 (prev-page blocklisted + anti-echo)", opts: { prevProseOverride: digestV2 } },
  };
  const results = [];
  for (const armName of arms) {
    const spec = REG[armName];
    if (!spec) return { error: `unknown arm ${armName}` };
    const out = await runDnaExpand({ bookId, nodeId, target: "prose", captureContext: true, ...spec.opts });
    if (out.error) return { error: `arm ${armName}: ${out.error}` };
    results.push({
      arm: armName, label: spec.label, prose: out.prose,
      ctxChars: out.ctx.length, ctxTokens: approxTokens(out.ctx),
      prevProseChars: (out.prevProseBlock || "").length, prevProseTokens: approxTokens(out.prevProseBlock || ""),
    });
  }
  return {
    results,
    meta: {
      priorText, castNames: info.castNames, wordTarget: info.wordTarget,
      priorPageCount: info.priorProsed.length, targetPlan: info.node.content,
      digestV1Tokens: approxTokens(digestV1), digestV2Tokens: approxTokens(digestV2),
      digestTokens: approxTokens(digestV2 || digestV1),
    },
  };
}

// LLM judge: ranks the candidate drafts on continuity / voice / non-repetition / scene-craft,
// grounded in the two pages immediately before the scene + the voice profile + the scene plan.
async function runProseExperimentJudge({ bookId, nodeId, outputs }) {
  const info = await getExperimentContext(bookId, nodeId);
  if (info.error) return info;
  const lastTwo = info.priorProsed.slice(-2).map((s) => `--- prior page ---\n${s.content.prose.text}`).join("\n\n");
  const voice = info.voice ? JSON.stringify(info.voice) : "(none)";
  const plan = JSON.stringify(info.node?.content ?? {});
  const drafts = (outputs || []).map((o) => `### Candidate ${o.arm}\n${o.prose}`).join("\n\n");
  const prompt = `You are a fiction editor blind-comparing ${(outputs || []).length} drafts of the SAME scene of the SAME novel. They differ ONLY in how much preceding context the writer was given. Judge each on how well it continues the story.

Score each candidate 1–5 (5 best) on:
- continuity: consistency with the prior pages (facts, positions, character state, time)
- voice_fidelity: match to the VOICE PROFILE and the established prose signature
- non_repetition: avoids reusing phrases/images/sentence patterns from the prior pages
- scene_craft: turns a value, concrete, dramatized (not summarized)

Output STRICT JSON only:
{ "ranking": ["A","B","C"], "winner": "B", "rationale": "<2–3 sentences on what separated them>",
  "arms": { "A": { "continuity": 4, "voice_fidelity": 4, "non_repetition": 3, "scene_craft": 4, "notes": "...", "continuity_breaks": ["..."] } } }

VOICE PROFILE: ${voice}

SCENE PLAN (what this scene must do): ${plan}

THE TWO PAGES IMMEDIATELY BEFORE THIS SCENE:
${lastTwo || "(none)"}

CANDIDATE DRAFTS:
${drafts}

JSON only.`;
  const out = await runClaude(prompt, true, { fn: "prose-exp-judge", bookId }, { noTools: true, model: "sonnet" });
  if (out.error) return out;
  try { return { judge: parseLooseJson(out.text) }; } catch { return { judge: null, raw: out.text }; }
}

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

  const gateMatch = url.match(/^\/mandate-gate\/(\d+)\/?$/);
  if (gateMatch) {
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    const bookId = Number(gateMatch[1]);
    if (!(await authorize(req, res, bookId))) return;
    console.log(`Running mandate gate for book ${bookId}…`);
    const out = await runMandateGate(bookId);
    if (out.error) return json(res, 500, { error: out.error });
    return json(res, 200, { report: out.report });
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

  // revise-beats — instruction/lens -> a beat-sheet revision plan (plan-only, carries beats).
  if (url === "/revise-beats" || url === "/revise-beats/") {
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    const body = await readBody(req);
    const bookId = Number(body.bookId);
    if (!bookId) return json(res, 400, { error: "bookId is required" });
    if (!(await authorize(req, res, bookId))) return;
    console.log(`Revising beats for book ${bookId}${body.lens ? ` (lens: ${body.lens})` : ""}…`);
    const out = await runReviseBeats(bookId, body.instruction, body.lens);
    if (out.error) return json(res, 500, { error: out.error });
    return json(res, 200, out);
  }

  // beats-agent — the conversational beat editor (one model call per author message).
  if (url === "/beats-agent" || url === "/beats-agent/") {
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    const body = await readBody(req);
    const bookId = Number(body.bookId);
    if (!bookId) return json(res, 400, { error: "bookId is required" });
    if (!(await authorize(req, res, bookId))) return;
    console.log(`Beat editor · book ${bookId}: "${String(body.message ?? "").slice(0, 60)}"…`);
    const out = await runBeatsAgent(bookId, body.message);
    if (out.error) return json(res, 500, { error: out.error });
    return json(res, 200, out);
  }

  // revise-chat — the unified conversational reviser (foundations | spine | beats).
  if (url === "/revise-chat" || url === "/revise-chat/") {
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    const body = await readBody(req);
    const bookId = Number(body.bookId);
    if (!bookId) return json(res, 400, { error: "bookId is required" });
    if (!(await authorize(req, res, bookId))) return;
    console.log(`Reviser · ${body.layer} · book ${bookId}: "${String(body.message ?? "").slice(0, 60)}"…`);
    const out = await runReviseChat(bookId, body.layer, body.message);
    if (out.error) return json(res, 500, { error: out.error });
    return json(res, 200, out);
  }

  // generate-book — the durable bulk "build the draft" job (beats → optional pause → prose).
  if (url === "/generate-book" || url === "/generate-book/") {
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    const body = await readBody(req);
    // Resume after a beats-review pause: verify access, flip 'ready' → 'running', run the prose stage.
    if (body.resume) {
      const genId = Number(body.generationId);
      if (!genId) return json(res, 400, { error: "generationId required" });
      const g = await fetch(`${SUPABASE_URL}/rest/v1/book_generations?id=eq.${genId}&select=id,book_id,status,progress`, { headers: sbHeaders });
      const row = (await g.json())?.[0];
      if (!row) return json(res, 404, { error: "Run not found" });
      if (!(await authorize(req, res, row.book_id))) return;
      if (row.status !== "ready") return json(res, 409, { error: "This run is not waiting to continue" });
      const progress = { ...(row.progress ?? {}), stage: "prose", phase: `Writing 0/${row.progress?.total ?? 0}` };
      await updateGeneration(genId, { status: "running", progress });
      console.log(`generate-book resume (book ${row.book_id}, gen ${genId})…`);
      driveProse(genId, row.book_id, progress).catch(async (e) => {
        await updateGeneration(genId, { status: "error", error: String(e?.message ?? e).slice(0, 1000) });
      });
      return json(res, 200, { status: "running", generationId: genId });
    }
    const bookId = Number(body.bookId);
    if (!bookId) return json(res, 400, { error: "bookId is required" });
    if (!(await authorize(req, res, bookId))) return;
    console.log(`generate-book (book ${bookId}${body.pauseAfterBeats ? ", pause after beats" : ""}${Array.isArray(body.pageIds) ? `, rerender ${body.pageIds.length}` : ""})…`);
    const out = await runGenerateBook(body);
    if (out.error) return json(res, 500, { error: out.error });
    return json(res, 200, { status: "running", generation: out.generation });
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

  if (url === "/scene-image-prompt" || url === "/scene-image-prompt/") {
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    const body = await readBody(req);
    if (!(await authorize(req, res, Number(body.bookId)))) return;
    console.log(`Composing scene image prompt (book ${body.bookId}, page ${body.pageId})…`);
    const out = await runSceneImagePrompt(body);
    if (out.error) return json(res, 500, { error: out.error });
    return json(res, 200, out);
  }

  if (url === "/scene-image-spec" || url === "/scene-image-spec/") {
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    const body = await readBody(req);
    if (!(await authorize(req, res, Number(body.bookId)))) return;
    console.log(`Composing scene spec (book ${body.bookId}, page ${body.pageId})…`);
    const out = await runSceneImageSpec(body);
    if (out.error) return json(res, 500, { error: out.error });
    return json(res, 200, out);
  }

  if (url === "/scene-image-revise-spec" || url === "/scene-image-revise-spec/") {
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    const body = await readBody(req);
    if (!(await authorize(req, res, Number(body.bookId)))) return;
    console.log(`Revising scene spec (book ${body.bookId}, page ${body.pageId})…`);
    const out = await runSceneImageReviseSpec(body);
    if (out.error) return json(res, 500, { error: out.error });
    return json(res, 200, out);
  }

  if (url === "/character-portrait-prompt" || url === "/character-portrait-prompt/") {
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    const body = await readBody(req);
    if (!(await authorize(req, res, Number(body.bookId)))) return;
    console.log(`Composing portrait prompt (book ${body.bookId}, character ${body.castId})…`);
    const out = await runCharacterPortraitPrompt(body);
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

  if (url === "/dna-expand" || url === "/dna-expand/") {
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    const body = await readBody(req);
    if (!(await authorize(req, res, Number(body.bookId)))) return;
    console.log(`DNA expand ${body.nodeId} (book ${body.bookId})…`);
    const out = await runDnaExpand(body);
    if (out.error) return json(res, 500, { error: out.error });
    return json(res, 200, out);
  }

  // Prose-context experiment (dev-only; localhost CLI orchestrator — no authorize, no user JWT).
  if (url === "/prose-experiment" || url === "/prose-experiment/") {
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    const body = await readBody(req);
    console.log(`Prose-context experiment: node ${body.nodeId} (book ${body.bookId})…`);
    const out = await runProseExperiment(body);
    if (out.error) return json(res, 500, { error: out.error });
    return json(res, 200, out);
  }
  if (url === "/prose-experiment-judge" || url === "/prose-experiment-judge/") {
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    const body = await readBody(req);
    console.log(`Prose-context experiment judge: node ${body.nodeId} (book ${body.bookId})…`);
    const out = await runProseExperimentJudge(body);
    if (out.error) return json(res, 500, { error: out.error });
    return json(res, 200, out);
  }

  if (url === "/dna-chat" || url === "/dna-chat/") {
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    const body = await readBody(req);
    if (!(await authorize(req, res, Number(body.bookId)))) return;
    console.log(`DNA chat ${body.stage} (book ${body.bookId})…`);
    const out = await runDnaChat(body);
    if (out.error) return json(res, 500, { error: out.error });
    return json(res, 200, out);
  }

  if (url === "/revise-scaffold" || url === "/revise-scaffold/") {
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    const body = await readBody(req);
    if (!(await authorize(req, res, Number(body.bookId)))) return;
    console.log(`Revising scaffold (book ${body.bookId})…`);
    const out = await runReviseScaffold(body);
    if (out.error) return json(res, 500, { error: out.error });
    return json(res, 200, out);
  }

  if (url === "/objective-options" || url === "/objective-options/") {
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    const body = await readBody(req);
    if (!(await authorize(req, res, Number(body.bookId)))) return;
    console.log(`Generating objective options (book ${body.bookId}, page ${body.pageId})…`);
    const out = await runObjectiveOptions(body);
    if (out.error) return json(res, 500, { error: out.error });
    return json(res, 200, out);
  }

  if (url === "/ai-run" || url === "/ai-run/") {
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    const body = await readBody(req);
    if (!(await authorize(req, res, Number(body.bookId)))) return;
    const { bookId, kind, targetKey, targetPageId, params } = body;
    console.log(`ai-run ${kind} (book ${bookId}, key ${targetKey ?? targetPageId ?? "-"})…`);
    // Insert the running row first (client watches it over Realtime), run the worker, then write the
    // terminal row — re-checking cancel so a cancel during the run sticks (parity with the edge fn).
    const genRow = await insertGeneration(Number(bookId), {
      kind, scope: targetPageId ? "page" : "book",
      target_page_id: targetPageId ?? null, target_key: targetKey ?? null, input: params ?? {},
    });
    if (!genRow) return json(res, 500, { error: "could not create generation row" });
    (async () => {
      try {
        const result = await aiRunWorker(kind, params ?? {}, Number(bookId));
        const cur = await fetch(`${SUPABASE_URL}/rest/v1/book_generations?id=eq.${genRow.id}&select=status`, { headers: sbHeaders });
        const status = (await cur.json())?.[0]?.status;
        if (status === "cancelled") return; // abandon the result
        await updateGeneration(genRow.id, { status: "ready", result });
      } catch (e) {
        await updateGeneration(genRow.id, { status: "error", error: String(e?.message ?? e).slice(0, 1000) });
      }
    })();
    return json(res, 200, { runId: genRow.id });
  }

  if (url === "/spine-options" || url === "/spine-options/") {
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    const body = await readBody(req);
    if (!(await authorize(req, res, Number(body.bookId)))) return;
    console.log(`Generating spine options (book ${body.bookId})…`);
    const out = await runSpineOptions(body);
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

// Driver hook: a dev script (scripts/dna-flow-test.mjs) imports the run-functions directly to drive the
// DNA flow end-to-end without the HTTP auth gate (it persists via the service role itself). Set
// DNA_BRIDGE_NO_LISTEN=1 to import the module without binding the port (avoids EADDRINUSE).
export { runDnaExpand, runDnaChat, fetchBook, SUPABASE_URL, sbHeaders };
if (process.env.DNA_BRIDGE_NO_LISTEN) {
  // imported by a driver — don't start the HTTP server
} else
server.listen(PORT, () => {
  console.log(`eval-bridge listening on http://localhost:${PORT}  (repo: ${repoRoot})`);
  console.log(`  GET/POST /eval/:bookId   POST /spine-to-objectives/:bookId   POST /bible/:bookId   POST /revise-outline/:bookId   POST /beat-to-prose   POST /revise-prose   POST /objective-to-beat   POST /prose-to-beat   POST /brief-to-spine   POST /beat-to-objective   POST /objectives-to-spine   POST /revise-node   POST /revise-scaffold   POST /objective-options   POST /spine-options   POST /ai-run   POST /generate-book`);
});
