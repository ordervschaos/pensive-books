#!/usr/bin/env node
// Structure Miner (docs/structure-miner.md) — the DNA's 4th verify leg: DISCOVERY.
//
//   node scripts/structure-miner.mjs --book 1176 [--limit N] [--concurrency 6]
//
// The three existing verify legs (lints, meter read, fact ledger) can only check axes we already
// have a name for. This harness reads FINISHED prose and asks the inverse question — "what
// structure is in here that no DNA node kind, meter, or scene field currently encodes?" — by:
//
//   P0 EXTRACT/segment  fetch the tree, list scenes in reading order, pair each with its DNA row.
//   P1 COMPUTED lenses  pure-JS measurements over the prose (zero model cost, maximally compressed).
//                       MDL says the cheapest program that explains the data goes first.
//   P2 RESIDUAL read    one cheap model call per scene gets (a) the scene's trace row (DNA + computed
//                       lenses) and (b) the prose, and answers: "predict the scene from the trace,
//                       then read it — list what it demonstrably DOES that the trace didn't predict."
//                       The answers are the raw ore for induction.
//
// This script is the mechanical/parallelizable half. Claude Code is the inductor (P3): it reads the
// residuals + trace matrix this writes, clusters them, proposes/scores candidate lenses, and writes
// reports/structure-miner-<book>.md. State is local-only (matches the scripts/.dna-*.json gitignore).
//
// Model calls reuse the direct-OpenRouter pattern from model-prose-compare.mjs (cheap qwen tier).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Agent, setGlobalDispatcher } from "undici";

setGlobalDispatcher(new Agent({ headersTimeout: 0, bodyTimeout: 0, connectTimeout: 60_000 }));

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(repoRoot, ".env.local"), "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const SUPABASE_URL = `https://${env.VITE_SUPABASE_PROJECT_ID}.supabase.co`;
const SR = env.SERVICE_ROLE_SECRET;
const OR_KEY = env.OPENROUTER_API_KEY;
const OR_URL = "https://openrouter.ai/api/v1/chat/completions";
const sb = { apikey: SR, Authorization: `Bearer ${SR}` };

const args = process.argv.slice(2);
const argVal = (f, d) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : d; };
const BOOK = Number(argVal("--book", 1176));
const LIMIT = argVal("--limit") ? Number(argVal("--limit")) : null;
const CONCURRENCY = Number(argVal("--concurrency", 6));
const RESIDUAL_MODEL = argVal("--model", "qwen/qwen3.7-plus");
const stateFile = (suffix) => join(repoRoot, "scripts", `.dna-miner-${BOOK}-${suffix}.json`);

// Entity kinds hang off the tree but are NOT structural spine — skip when walking reading order.
const ENTITY_KINDS = new Set(["character", "relationship", "tentpole", "world_fact", "location", "thread", "game", "voice_profile", "meter"]);

function scenesInOrder(nodes) {
  const out = [];
  const kids = (pid) => nodes.filter((n) => n.parent_id === pid).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const walk = (n) => { if (n.kind === "scene") out.push(n); for (const c of kids(n.id)) if (!ENTITY_KINDS.has(c.kind)) walk(c); };
  for (const root of nodes.filter((n) => n.parent_id === null)) walk(root);
  return out;
}

// ── prose helpers (shared shape with lib/prose-lints, kept local to avoid a dependency) ─────────
const WORDS = (t) => (t || "").toLowerCase().replace(/[^a-z0-9'\s]/g, " ").split(/\s+/).filter(Boolean);
const SENTENCES = (t) => (t || "").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
const PARAS = (t) => (t || "").split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
const round = (x, d = 2) => Number.isFinite(x) ? Number(x.toFixed(d)) : 0;
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const cv = (a) => { // coefficient of variation = std/mean — scale-free "how uneven is the rhythm"
  const m = mean(a); if (!m) return 0;
  const v = mean(a.map((x) => (x - m) ** 2));
  return Math.sqrt(v) / m;
};

// Marker lexicons — small, deliberately crude. The point is a compressed scalar, not NLP.
const INTERIORITY = /\b(thought|felt|knew|realized|realised|wondered|remembered|understood|imagined|hoped|feared|wanted|noticed|decided|believed|suspected|sensed)\b/gi;
const SENSORY = /\b(smell|smelled|scent|reek|taste|tasted|touch|touched|skin|warmth|cold|heat|damp|wet|rough|soft|light|dark|shadow|glow|sound|silence|echo|breath|breathe|sweat)\b/gi;
const BODY = /\b(hand|hands|eyes|eye|mouth|lips|throat|chest|fingers|jaw|shoulder|neck|pulse|heart|spine|wrist|palm)\b/gi;

// A "line" of dialogue = a paragraph that opens with a quote mark. Cheap, robust to attribution tails.
const QUOTE_OPEN = /^\s*["“]/;
const countQuotedChars = (t) => {
  const m = (t || "").match(/["“][^"”]*["”]/g) || [];
  return m.reduce((s, q) => s + q.length, 0);
};

// ── P1 computed lenses — each returns ONE compressed scalar per scene (the MDL-cheap programs) ──
const COMPUTED_LENSES = {
  words: (t) => WORDS(t).length,
  // dialogue_ratio — share of the scene's characters inside quotation marks. Mode-of-narration proxy.
  dialogue_ratio: (t) => round(countQuotedChars(t) / Math.max(1, (t || "").length)),
  // wps_mean / wps_cv — sentence-length rhythm. High cv = the prose varies cadence (a craft signature).
  wps_mean: (t) => round(mean(SENTENCES(t).map((s) => WORDS(s).length)), 1),
  wps_cv: (t) => round(cv(SENTENCES(t).map((s) => WORDS(s).length))),
  // para_len_cv — paragraph-length rhythm; white-space as a pacing instrument.
  para_len_cv: (t) => round(cv(PARAS(t).map((p) => WORDS(p).length))),
  // interiority — thought/feeling-verb density per 100 words. Psychic-distance proxy (close vs cinematic).
  interiority: (t) => round(100 * ((t || "").match(INTERIORITY)?.length || 0) / Math.max(1, WORDS(t).length)),
  // sensory / body — embodiment density per 100 words. Two lexicons: environment vs the body itself.
  sensory: (t) => round(100 * ((t || "").match(SENSORY)?.length || 0) / Math.max(1, WORDS(t).length)),
  body: (t) => round(100 * ((t || "").match(BODY)?.length || 0) / Math.max(1, WORDS(t).length)),
  // question_density — questions per 100 words. Interrogative pressure / unresolved-tension proxy.
  question_density: (t) => round(100 * ((t || "").match(/\?/g)?.length || 0) / Math.max(1, WORDS(t).length)),
  // em_dash — dashes per 100 words. Interruption / breath-break rhythm.
  em_dash: (t) => round(100 * ((t || "").match(/—|--/g)?.length || 0) / Math.max(1, WORDS(t).length)),
  // italic_density — emphasis markers per 100 words (markdown *…*). Free-indent stress / interiority tell.
  italic_density: (t) => round(100 * ((t || "").match(/\*[^*\n]+\*/g)?.length || 0) / Math.max(1, WORDS(t).length)),
};

function computeRow(prose) {
  const row = {};
  for (const [name, fn] of Object.entries(COMPUTED_LENSES)) row[name] = fn(prose);
  return row;
}

// The DNA row we feed the residual read: the authored plan fields only, prose stripped out.
function dnaRow(content) {
  const c = { ...(content || {}) };
  delete c.prose; delete c.image_url; delete c.caption;
  return c;
}

// ── OpenRouter (direct, cheap tier) ─────────────────────────────────────────────────────────────
async function orCall(model, prompt, { maxTokens = 900, temperature = 0.3, attempt = 1 } = {}) {
  const body = JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: maxTokens, temperature });
  try {
    const res = await fetch(OR_URL, { method: "POST", headers: { Authorization: `Bearer ${OR_KEY}`, "content-type": "application/json" }, body });
    const raw = await res.text();
    if (!res.ok) {
      if (res.status >= 500 && attempt < 3) return orCall(model, prompt, { maxTokens, temperature, attempt: attempt + 1 });
      return { error: `HTTP ${res.status}: ${raw.slice(0, 200)}` };
    }
    let j; try { j = JSON.parse(raw); } catch { return { error: `bad json: ${raw.slice(0, 200)}` }; }
    return { text: (j.choices?.[0]?.message?.content ?? "").trim(), usage: j.usage };
  } catch (e) {
    if (attempt < 3) return orCall(model, prompt, { maxTokens, temperature, attempt: attempt + 1 });
    return { error: `fetch failed: ${String(e?.message ?? e)}` };
  }
}

// Pull a fenced/loose JSON array of short strings out of a model reply.
function parseResidualList(text) {
  if (!text) return [];
  const m = text.match(/\[[\s\S]*\]/);
  if (m) { try { const a = JSON.parse(m[0]); if (Array.isArray(a)) return a.map(String).map((s) => s.trim()).filter(Boolean); } catch { /* fall through */ } }
  // Fallback: bullet lines.
  return text.split("\n").map((l) => l.replace(/^[-*\d.)\s]+/, "").trim()).filter((l) => l.length > 8 && l.length < 240);
}

const RESIDUAL_PROMPT = (scene) => `You are a structural analyst reverse-engineering a novel's scene-encoding schema.

Below is a TRACE ROW — the complete structured metadata our system currently records for one scene — followed by the scene's actual PROSE.

TRACE ROW (everything the schema knows about this scene):
${JSON.stringify(scene.trace, null, 1)}

PROSE:
"""
${scene.prose}
"""

Task: First, imagine predicting the prose from the TRACE ROW alone. Now read the actual prose. List the concrete, STRUCTURAL things the prose demonstrably DOES that the trace row did NOT predict or capture — patterns another scene could also have, that could be encoded as a small field/number/enum.

Rules:
- STRUCTURE, not paraphrase. "opens on a weather image that mirrors the power dynamic" = structure. "Mara strips naked" = plot, skip it.
- Each item must name a PATTERN that generalizes across scenes, not a one-off content detail.
- Ignore anything already in the trace row (goal, conflict, outcome, value_shift, loc, register, etc.).
- Prefer things expressible as a number, an enum, or a ≤3-word tag.
- 3 to 7 items. If the trace fully explains the prose, return fewer.

Return ONLY a JSON array of short strings (each ≤ 18 words). No prose around it.`;

// bounded-concurrency map
async function pMap(items, fn, concurrency) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

async function main() {
  console.error(`[miner] book ${BOOK} — fetching tree…`);
  const nodes = await (await fetch(`${SUPABASE_URL}/rest/v1/book_nodes?book_id=eq.${BOOK}&select=id,parent_id,kind,position,content&order=position.asc`, { headers: sb })).json();
  if (!Array.isArray(nodes)) throw new Error(`fetch failed: ${JSON.stringify(nodes).slice(0, 200)}`);

  let scenes = scenesInOrder(nodes)
    .map((n, i) => ({ id: n.id, index: i + 1, dna: dnaRow(n.content), prose: n.content?.prose?.text || "" }))
    .filter((s) => s.prose && WORDS(s.prose).length > 50);
  if (LIMIT) scenes = scenes.slice(0, LIMIT);
  console.error(`[miner] ${scenes.length} prosed scenes (${scenes.reduce((s, x) => s + WORDS(x.prose).length, 0)} words)`);

  // P1 — computed lenses
  for (const s of scenes) s.computed = computeRow(s.prose);
  // The trace row handed to the residual read = authored plan + computed lenses (everything we "know").
  for (const s of scenes) s.trace = { ...s.dna, _computed: s.computed };

  writeFileSync(stateFile("corpus"), JSON.stringify(scenes.map((s) => ({ id: s.id, index: s.index, dna: s.dna, computed: s.computed, words: s.computed.words })), null, 2));
  console.error(`[miner] wrote corpus + computed trace → ${stateFile("corpus")}`);

  // P2 — residual read (one cheap call per scene, concurrent)
  console.error(`[miner] residual read via ${RESIDUAL_MODEL} (${scenes.length} calls, concurrency ${CONCURRENCY})…`);
  let done = 0;
  const residuals = await pMap(scenes, async (s) => {
    const r = await orCall(RESIDUAL_MODEL, RESIDUAL_PROMPT(s), { maxTokens: 900, temperature: 0.3 });
    done++;
    if (r.error) { console.error(`  scene ${s.index} ${s.id}: ERROR ${r.error}`); return { id: s.id, index: s.index, error: r.error, items: [] }; }
    const items = parseResidualList(r.text);
    console.error(`  [${done}/${scenes.length}] scene ${s.index}: ${items.length} residuals`);
    return { id: s.id, index: s.index, items, raw: r.text, usage: r.usage };
  }, CONCURRENCY);

  writeFileSync(stateFile("residuals"), JSON.stringify(residuals, null, 2));
  console.error(`[miner] wrote residuals → ${stateFile("residuals")}`);

  // Emit a human-readable trace matrix (P1 deliverable) + a flat residual dump for induction.
  const lensNames = Object.keys(COMPUTED_LENSES);
  const header = ["#", ...lensNames].join(" | ");
  const sep = ["---", ...lensNames.map(() => "---")].join(" | ");
  const bodyRows = scenes.map((s) => [s.index, ...lensNames.map((l) => s.computed[l])].join(" | "));
  const allResiduals = residuals.flatMap((r) => r.items.map((it) => `- s${r.index}: ${it}`));
  const md = [
    `# Structure Miner — trace matrix + residuals — book ${BOOK}`,
    ``,
    `${scenes.length} scenes · ${scenes.reduce((s, x) => s + x.computed.words, 0)} words · residual model \`${RESIDUAL_MODEL}\``,
    ``,
    `## Computed trace matrix (P1)`,
    ``,
    header, sep, ...bodyRows,
    ``,
    `## Residual ore (P2) — ${allResiduals.length} raw items`,
    ``,
    ...allResiduals,
    ``,
  ].join("\n");
  writeFileSync(stateFile("matrix").replace(".json", ".md"), md);
  console.error(`[miner] wrote matrix+residuals md → ${stateFile("matrix").replace(".json", ".md")}`);
  console.error(`[miner] done. ${allResiduals.length} residual items for induction.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
