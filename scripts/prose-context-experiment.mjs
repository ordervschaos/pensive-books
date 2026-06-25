#!/usr/bin/env node
// Prose-context experiment orchestrator.
//
//   node scripts/prose-context-experiment.mjs --book 1192 [--node n_xxx] [--no-fork]
//
// Forks a book (so the original is untouched), picks a target scene whose preceding pages are
// already prosed, then asks the dev bridge (must be running on :8787) to regenerate that ONE
// scene's prose under three preceding-context regimes — holding voice/cast/threads/plan constant:
//
//   A — last 1 page verbatim
//   B — all prior pages verbatim
//   C — efficient digest (rolling per-page summary + continuity ledger + anti-repeat blocklist) + last page
//
// Then runs deterministic prose lints (scripts/lib/prose-lints.mjs) on each output, runs an LLM
// judge, and writes a side-by-side report. The bridge owns all the context assembly + Claude calls
// (single source); this script is fork + glue + lints + report.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Agent, setGlobalDispatcher } from "undici";
import { runProseLints, approxTokens, wordCount } from "./lib/prose-lints.mjs";

// The /prose-experiment call runs several sequential `claude -p` gens and stays open for >10 min.
// Node's global fetch (undici) defaults to a 300s headers timeout, which would drop the connection
// mid-generation. Disable per-request timeouts for this long-poll client.
setGlobalDispatcher(new Agent({ headersTimeout: 0, bodyTimeout: 0, connectTimeout: 60_000 }));

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(repoRoot, ".env.local"), "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const SUPABASE_URL = `https://${env.VITE_SUPABASE_PROJECT_ID}.supabase.co`;
const KEY = env.SERVICE_ROLE_SECRET;
const sb = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const BRIDGE = process.env.EVAL_BRIDGE_URL || "http://localhost:8787";

const ENTITY_KINDS = new Set(["character", "relationship", "tentpole", "world_fact", "thread", "game", "voice_profile"]);

// ── args ───────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const argVal = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
const SRC_BOOK = Number(argVal("--book") || 1192);
const FORCE_NODE = argVal("--node");
// 1-based reading-order index — stable across the fork's id remap (prefer this over --node, whose
// ids belong to the ORIGINAL book and don't exist in the fork).
const FORCE_INDEX = argVal("--index") ? Number(argVal("--index")) : null;
// Multi-scene hardening: comma-list of reading-order indices to run the SAME arms over, one shared
// fork, then an aggregate table (does the v2 repetition drop replicate across scenes?).
const FORCE_INDICES = argVal("--indices") ? argVal("--indices").split(",").map((s) => Number(s.trim())) : null;
// Which arms to run: comma-list of A (last1) / B (all verbatim) / C (digest v1) / D (digest v2).
const ARMS = argVal("--arms") ? argVal("--arms").split(",").map((s) => s.trim().toUpperCase()) : null;
const DO_FORK = !args.includes("--no-fork");

// ── supabase REST ────────────────────────────────────────────────────────────────
async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sb });
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}: ${await r.text()}`);
  return r.json();
}
async function sbInsert(table, rows, { single = false } = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...sb, "content-type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(rows),
  });
  if (!r.ok) throw new Error(`INSERT ${table} → ${r.status}: ${await r.text()}`);
  const out = await r.json();
  return single ? out[0] : out;
}

// ── id minting + content-ref remap ───────────────────────────────────────────────
let _idc = 0;
const newId = () => `n_${Math.random().toString(36).slice(2, 8)}${(_idc++).toString(36)}${Date.now().toString(36).slice(-2)}`;
// Every node id is a unique `n_…` token; rewrite any such token that appears anywhere inside a
// node's content/authoring to its forked counterpart (covers grounds_in, realizes_tentpole, plays,
// resolves, thread refs, etc. without enumerating them).
function remapRefs(obj, idMap) {
  const s = JSON.stringify(obj);
  const out = s.replace(/n_[a-z0-9]+/gi, (tok) => idMap.get(tok) ?? tok);
  return JSON.parse(out);
}

// ── fork ──────────────────────────────────────────────────────────────────────
async function forkBook(srcId) {
  const [src] = await sbGet(`books?id=eq.${srcId}&select=*`);
  if (!src) throw new Error(`book ${srcId} not found`);
  const stamp = Date.now().toString(36);
  const payload = {
    owner_id: src.owner_id,
    name: `${src.name} — ctx-exp ${stamp}`,
    author: src.author, subtitle: src.subtitle,
    brief: src.brief, bible: src.bible, spine: src.spine, journey: src.journey,
    foundations: src.foundations, canon: src.canon, steers: src.steers,
    craft_notes: src.craft_notes, outline: src.outline, mode: src.mode,
    content_tags: src.content_tags, is_public: false, parent_book_id: srcId,
    slug: `${(src.slug || "book")}-ctxexp-${stamp}`,
  };
  const fork = await sbInsert("books", payload, { single: true });
  console.log(`✓ forked book ${srcId} → ${fork.id} ("${payload.name}")`);

  const nodes = await sbGet(`book_nodes?book_id=eq.${srcId}&select=id,parent_id,level,kind,position,content,authoring,proposals,chosen`);
  const idMap = new Map(nodes.map((n) => [n.id, newId()]));
  const cloned = nodes.map((n) => ({
    id: idMap.get(n.id),
    book_id: fork.id,
    parent_id: n.parent_id ? (idMap.get(n.parent_id) ?? null) : null,
    level: n.level, kind: n.kind, position: n.position,
    content: remapRefs(n.content ?? {}, idMap),
    authoring: remapRefs(n.authoring ?? {}, idMap),
    proposals: n.proposals ? remapRefs(n.proposals, idMap) : n.proposals,
    chosen: n.chosen,
  }));
  // Insert in chunks so a big tree doesn't blow the request size.
  for (let i = 0; i < cloned.length; i += 200) await sbInsert("book_nodes", cloned.slice(i, i + 200));
  console.log(`✓ cloned ${cloned.length} book_nodes into fork ${fork.id}`);
  return { forkId: fork.id, nodes: cloned };
}

// ── reading order (mirror scenesInOrder) ─────────────────────────────────────────
function scenesInOrder(nodes) {
  const out = [];
  const kids = (pid) => nodes.filter((n) => n.parent_id === pid).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const walk = (n) => { if (n.kind === "scene") out.push(n); for (const c of kids(n.id)) if (!ENTITY_KINDS.has(c.kind)) walk(c); };
  for (const root of nodes.filter((n) => n.parent_id === null)) walk(root);
  return out;
}
const hasProse = (s) => String(s.content?.prose?.text ?? "").trim().length > 0;

// Target = first un-prosed scene whose preceding pages are mostly prosed (≥ MIN_PRIOR). If none,
// fall back to the prosed scene with the most prior prosed pages (we'll regenerate over it).
const MIN_PRIOR = 4;
function pickTarget(nodes) {
  const ordered = scenesInOrder(nodes);
  const priorProsed = (i) => ordered.slice(0, i).filter(hasProse).length;
  if (FORCE_INDEX != null) {
    const i = FORCE_INDEX - 1;
    return { node: ordered[i], idx: i, priorProsed: priorProsed(i), ordered };
  }
  if (FORCE_NODE) {
    const i = ordered.findIndex((s) => s.id === FORCE_NODE);
    return { node: ordered[i], idx: i, priorProsed: priorProsed(i), ordered };
  }
  for (let i = 0; i < ordered.length; i++) {
    if (!hasProse(ordered[i]) && priorProsed(i) >= MIN_PRIOR) return { node: ordered[i], idx: i, priorProsed: priorProsed(i), ordered };
  }
  // fallback: deepest prosed scene
  let best = null;
  for (let i = 1; i < ordered.length; i++) if (hasProse(ordered[i]) && (!best || priorProsed(i) > best.priorProsed)) best = { node: ordered[i], idx: i, priorProsed: priorProsed(i), ordered };
  return best;
}

// ── bridge calls ─────────────────────────────────────────────────────────────────
async function bridge(path, body) {
  const r = await fetch(`${BRIDGE}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(`${path} → ${r.status}: ${d.error || JSON.stringify(d)}`);
  return d;
}

// ── report ────────────────────────────────────────────────────────────────────────
function lintSummary(lints) {
  const flags = [];
  for (const l of lints) {
    if (l.rule === "repetition_prior" && l.count) flags.push(`repeat-prior:${l.count}`);
    if (l.rule === "repetition_internal" && l.count) flags.push(`repeat-internal:${l.count}`);
    if (l.rule === "fourth_wall" && l.count) flags.push(`4th-wall:${l.count}`);
    if (l.rule === "length_vs_target" && l.flag) flags.push(`len:${l.ratio}×`);
    if (l.rule === "name_drift" && l.count) flags.push(`name-drift:${l.count}`);
  }
  return flags.length ? flags.join(" · ") : "clean";
}

function buildReport({ srcBook, forkId, target, exp, lintsByArm, judge }) {
  const j = judge?.judge;
  const planSummary = target.node.content?.goal || target.node.content?.outcome || JSON.stringify(target.node.content).slice(0, 200);
  const rows = exp.results.map((r) => {
    const j2 = j?.arms?.[r.arm];
    const score = j2 ? `${j2.continuity}/${j2.voice_fidelity}/${j2.non_repetition}/${j2.scene_craft}` : "—";
    const rank = j?.ranking ? j.ranking.indexOf(r.arm) + 1 : "—";
    return `| ${r.arm} | ${r.label} | ${r.prevProseTokens} | ${r.ctxTokens} | ${wordCount(r.prose)} | ${lintSummary(lintsByArm[r.arm])} | ${score} | ${rank} |`;
  }).join("\n");

  let md = `# Prose-context experiment — book ${srcBook} → fork ${forkId}

**Question:** for a single scene's prose generation, does feeding more preceding context help, and
can an efficient digest match dumping all prior pages verbatim at lower token cost?

- **Fork:** ${forkId} (clone of ${srcBook}; original untouched)
- **Target scene:** \`${target.node.id}\` (reading-order #${target.idx + 1}), ${target.priorProsed} prior prosed pages
- **Scene plan:** ${planSummary}
- **Held constant across arms:** voice profile, cast/world, threads, the scene plan. Only the PRECEDING-PAGES block varies.
- **Model:** same for all arms (dev bridge \`MODEL_PLANNING\`). Digest built with \`MODEL_SUMMARY\`.

## Scoreboard

prevProse / ctx tokens are ≈ (chars/4). Judge score = continuity / voice / non-repetition / scene-craft (1–5 each). Rank 1 = best.

| Arm | Context regime | prevProse tok | total ctx tok | output words | deterministic lints | judge (c/v/r/s) | rank |
|-----|----------------|---------------|---------------|--------------|---------------------|-----------------|------|
${rows}

- **Arm C one-time digest cost:** ${exp.meta.digestTokens} tok to build (${exp.meta.priorPageCount} prior pages). In production this is built incrementally per page and cached, so the *generation* call pays only the digest size shown above, not the build.
`;

  if (j) {
    md += `\n## Judge verdict\n\n- **Winner:** ${j.winner}\n- **Ranking:** ${(j.ranking || []).join(" > ")}\n- **Rationale:** ${j.rationale}\n`;
    for (const r of exp.results) {
      const a = j.arms?.[r.arm];
      if (a) md += `\n**Arm ${r.arm}** — ${a.notes || ""}${a.continuity_breaks?.length ? `\n  - continuity breaks: ${a.continuity_breaks.join("; ")}` : ""}\n`;
    }
  } else {
    md += `\n## Judge verdict\n\n_(judge returned unparseable output; raw saved in the JSON dump)_\n`;
  }

  md += `\n## Deterministic lint detail\n`;
  for (const r of exp.results) {
    md += `\n### Arm ${r.arm} — ${r.label}\n`;
    for (const l of lintsByArm[r.arm]) {
      if (l.rule === "repetition_prior") md += `- **repetition_prior** (${l.count}): ${l.samples.map((s) => `"${s}"`).join(", ") || "none"}\n`;
      if (l.rule === "repetition_internal") md += `- **repetition_internal** (${l.count}): phrases ${l.phrases.join(", ") || "—"}; openers ${l.openers.join(", ") || "—"}\n`;
      if (l.rule === "fourth_wall") md += `- **fourth_wall** (${l.count}): ${l.samples.map((s) => `…${s}…`).join(" / ") || "none"}\n`;
      if (l.rule === "length_vs_target") md += `- **length_vs_target**: ${l.words} words${l.target ? ` vs ~${l.target} target (${l.ratio}×)${l.flag ? " ⚠️" : ""}` : " (no target)"}\n`;
      if (l.rule === "name_drift") md += `- **name_drift** (${l.count}): ${l.candidates.join(", ") || "none"}\n`;
    }
  }

  md += `\n## Full outputs\n`;
  for (const r of exp.results) md += `\n### Arm ${r.arm} — ${r.label} (${wordCount(r.prose)} words)\n\n${r.prose}\n`;

  md += `\n## Recommended efficient prompt format (arm C)\n
The digest packet that replaces the verbatim PRECEDING PAGES block, section-tagged for parse-ability:

\`\`\`
PRECEDING CONTEXT — an efficient digest of the pages so far. …maintain voice; do NOT reuse any phrase under avoid_repeating:

<story_so_far>
- Page 1: <POV/loc/time · value-shift · facts established · closing image>
- Page 2: …
</story_so_far>

<continuity_ledger>
Characters:
  • <name — current status, location, want>
Objects in play: …
Locations: …
Timeline: …
Open threads:
  • <promise — state>
</continuity_ledger>

<avoid_repeating>
- <distinctive phrase already used>
</avoid_repeating>

<previous_page>
<the immediately-preceding page, verbatim — for cadence/voice handoff>
</previous_page>
\`\`\`

Rationale: token cost grows ~O(pages) with a tiny per-page line instead of O(words) verbatim;
the last page stays verbatim so voice/cadence hand off cleanly; the ledger preserves hard facts and
the blocklist is the deterministic anti-repetition signal the verbatim dump was implicitly providing.
Built incrementally + cached per page in production.
`;
  return md;
}

// ── per-scene run (generate + lint + judge) ───────────────────────────────────────
const lintCount = (lints, rule) => lints.find((l) => l.rule === rule)?.count ?? 0;

async function runScene(forkId, target) {
  console.log(`\n→ scene #${target.idx + 1} (${target.node.id}), ${target.priorProsed} prior pages — generating arms ${(ARMS || ["A", "B", "C"]).join(",")}…`);
  const exp = await bridge("/prose-experiment", { bookId: forkId, nodeId: target.node.id, ...(ARMS ? { arms: ARMS } : {}) });
  console.log(`  ✓ ${exp.results.length} arms. ctx tokens: ${exp.results.map((r) => `${r.arm}=${r.ctxTokens}`).join("  ")}`);
  const wordTargetFromPlan = target.node.content?.words || exp.meta.wordTarget;
  const lintsByArm = {};
  for (const r of exp.results) lintsByArm[r.arm] = runProseLints(r.prose, { priorText: exp.meta.priorText, castNames: exp.meta.castNames, wordTarget: wordTargetFromPlan });
  console.log(`  → judging…`);
  let judge = null;
  try { judge = await bridge("/prose-experiment-judge", { bookId: forkId, nodeId: target.node.id, outputs: exp.results.map((r) => ({ arm: r.arm, prose: r.prose })) }); }
  catch (e) { console.warn(`  judge failed: ${e.message}`); }
  return { exp, lintsByArm, judge };
}

function writeOutputs(forkId, payload, md) {
  const outDir = join(repoRoot, "scripts", ".prose-ctx-exp");
  mkdirSync(outDir, { recursive: true });
  const base = `${forkId}-${Date.now()}`;
  const mdPath = join(outDir, `${base}-report.md`);
  writeFileSync(mdPath, md);
  writeFileSync(join(outDir, `${base}-dump.json`), JSON.stringify(payload, null, 2));
  console.log(`\n✓ report:  ${mdPath}`);
  console.log(`✓ dump:    ${join(outDir, `${base}-dump.json`)}`);
  return mdPath;
}

// Aggregate hardening report: one row per scene, focused on whether D beats C on repetition_prior.
function buildAggregateReport({ srcBook, forkId, scenes }) {
  const arms = scenes[0]?.exp.results.map((r) => r.arm) ?? [];
  const head = `# Prose-context hardening — book ${srcBook} → fork ${forkId}

**Question:** does the digest-v2 repetition drop replicate across scenes? Arms: ${arms.join(", ")} (same arms every scene; only the target scene varies).
Each scene holds voice/cast/threads/plan constant and varies only the PRECEDING-PAGES block.

## Repetition_prior (verbatim echoes of prior pages — lower is better)

| Scene # | prior pages | ${arms.map((a) => `${a} rep`).join(" | ")} | C→D Δ | judge winner |
|---------|-------------|${arms.map(() => "------").join("|")}|-------|--------------|`;
  const rows = scenes.map((s) => {
    const reps = arms.map((a) => lintCount(s.lintsByArm[a], "repetition_prior"));
    const c = lintCount(s.lintsByArm.C, "repetition_prior");
    const d = lintCount(s.lintsByArm.D, "repetition_prior");
    const delta = s.lintsByArm.C && s.lintsByArm.D ? `${d - c}` : "—";
    return `| #${s.target.idx + 1} | ${s.target.priorProsed} | ${reps.join(" | ")} | ${delta} | ${s.judge?.judge?.winner ?? "—"} |`;
  }).join("\n");

  // Aggregate verdict line.
  const cVals = scenes.map((s) => lintCount(s.lintsByArm.C, "repetition_prior"));
  const dVals = scenes.map((s) => lintCount(s.lintsByArm.D, "repetition_prior"));
  const haveCD = scenes.every((s) => s.lintsByArm.C && s.lintsByArm.D);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const wins = scenes.filter((s) => lintCount(s.lintsByArm.D, "repetition_prior") < lintCount(s.lintsByArm.C, "repetition_prior")).length;
  const judgeWins = scenes.filter((s) => s.judge?.judge?.winner === "D").length;
  let verdict = "";
  if (haveCD) verdict = `\n\n**Verdict:** D (v2) beat C (v1) on repetition_prior in **${wins}/${scenes.length}** scenes (total ${sum(cVals)} → ${sum(dVals)}, −${sum(cVals) - sum(dVals)}). Judge picked D in **${judgeWins}/${scenes.length}**.`;

  let md = `${head}\n${rows}${verdict}\n\n## Per-scene judge rationale\n`;
  for (const s of scenes) {
    md += `\n### Scene #${s.target.idx + 1} — ${s.target.node.content?.goal || s.target.node.content?.outcome || s.target.node.id}\n`;
    md += `- repetition_prior: ${arms.map((a) => `${a}=${lintCount(s.lintsByArm[a], "repetition_prior")}`).join(", ")}\n`;
    const j = s.judge?.judge;
    if (j) {
      md += `- winner: **${j.winner}** (${(j.ranking || []).join(" > ")}) — ${j.rationale}\n`;
      for (const a of arms) { const sc = j.arms?.[a]; if (sc) md += `  - **${a}**: c${sc.continuity}/v${sc.voice_fidelity}/r${sc.non_repetition}/s${sc.scene_craft}${sc.continuity_breaks?.length ? ` · breaks: ${sc.continuity_breaks.join("; ")}` : ""}\n`; }
    } else md += `- judge: (unavailable)\n`;
  }
  md += `\n_(Full prose + every lint per scene is in the JSON dump.)_\n`;
  return md;
}

// ── main ────────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== Prose-context experiment: book ${SRC_BOOK} ===`);
  let forkId, nodes;
  if (DO_FORK) {
    ({ forkId, nodes } = await forkBook(SRC_BOOK));
  } else {
    forkId = SRC_BOOK;
    nodes = await sbGet(`book_nodes?book_id=eq.${SRC_BOOK}&select=id,parent_id,level,kind,position,content,authoring`);
    console.log(`(--no-fork) running in place on book ${SRC_BOOK}`);
  }

  // Multi-scene hardening mode.
  if (FORCE_INDICES) {
    const ordered = scenesInOrder(nodes);
    const priorProsedAt = (i) => ordered.slice(0, i).filter(hasProse).length;
    const targets = FORCE_INDICES.map((n) => ({ node: ordered[n - 1], idx: n - 1, priorProsed: priorProsedAt(n - 1) })).filter((t) => t.node);
    console.log(`✓ hardening across ${targets.length} scenes: ${targets.map((t) => `#${t.idx + 1}(${t.priorProsed}p)`).join(", ")}`);
    const scenes = [];
    for (const t of targets) {
      try { scenes.push({ target: t, ...(await runScene(forkId, t)) }); }
      catch (e) { console.error(`  ✗ scene #${t.idx + 1} failed: ${e.message} — skipping`); }
    }
    if (!scenes.length) throw new Error("all scenes failed");
    const md = buildAggregateReport({ srcBook: SRC_BOOK, forkId, scenes });
    console.log(`\n${md.split("\n").slice(0, 12 + scenes.length).join("\n")}`); // echo the table
    writeOutputs(forkId, { srcBook: SRC_BOOK, forkId, mode: "harden", scenes }, md);
    console.log(`\nfork book id: ${forkId}\n`);
    return;
  }

  const target = pickTarget(nodes);
  if (!target?.node) throw new Error("no suitable target scene found");
  console.log(`✓ target scene ${target.node.id} (#${target.idx + 1} in reading order), ${target.priorProsed} prior prosed pages`);
  if (target.priorProsed < MIN_PRIOR) console.warn(`⚠ only ${target.priorProsed} prior pages — 'all' vs '1' contrast will be weak`);

  const { exp, lintsByArm, judge } = await runScene(forkId, target);
  const md = buildReport({ srcBook: SRC_BOOK, forkId, target, exp, lintsByArm, judge });
  writeOutputs(forkId, { srcBook: SRC_BOOK, forkId, target: { id: target.node.id, idx: target.idx, priorProsed: target.priorProsed }, exp, lintsByArm, judge }, md);
  console.log(`\nfork book id: ${forkId}\n`);
}

main().catch((e) => { console.error(`\n✗ ${e.message}\n`); process.exit(1); });
