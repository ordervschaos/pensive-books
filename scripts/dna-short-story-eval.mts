// dna-short-story-eval — grade the generated short story with the REAL engine, headless. Loads the live
// tree, runs novelDna's own lints (validate + analysisText + obligation ledger), reads the OBSERVED meter
// trace off the prose (bridge read-meters) and diffs it against each meter's target curve, and assembles the
// manuscript to a file for an editor's read. Run AFTER dna-short-story.mjs.
//
//   cd apps/web && node --import tsx ../../scripts/dna-short-story-eval.mts <bookId>
//   (the @ alias needs apps/web's tsconfig — hence the cd; novelDna imports @/lib/... internally)
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validate, analysisText, openObligations, debtSettled, lintConfigForBrief, type DnaNode } from "@/features/dna/lib/novelDna";

process.env.DNA_BRIDGE_NO_LISTEN = "1";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const { SUPABASE_URL, sbHeaders, runReadMeters } = await import(join(repoRoot, "scripts/eval-bridge.mjs"));

const bookId = Number(process.argv[2] || process.env.DNA_BOOK_ID);
if (!bookId) { console.error("usage: … dna-short-story-eval.mts <bookId>"); process.exit(1); }

const rest = (p: string) => fetch(`${SUPABASE_URL}/rest/v1/${p}`, { headers: sbHeaders });
const book = (await (await rest(`books?id=eq.${bookId}&select=id,name,brief`)).json())[0];
const nodes: DnaNode[] = await (await rest(`book_nodes?book_id=eq.${bookId}&select=id,parent_id,kind,level,position,content,authoring`)).json();
const brief = book?.brief ?? {};
const cfg = lintConfigForBrief(brief);
const by = (k: string) => nodes.filter((n) => n.kind === k).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

const out: string[] = [];
const P = (s = "") => out.push(s);

P(`# Editor's grade — "${book?.name}"  (book ${bookId})`);
P(`\n_${brief.genre} · ${brief.scope?.band} (${brief.scope?.word_target}w target) · tone: ${(brief.tone ?? []).join(", ")}_`);
const counts: Record<string, number> = {};
for (const n of nodes) counts[n.kind] = (counts[n.kind] || 0) + 1;
P(`\n**Tree census:** ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(" · ")}`);

// ── 1 · Structural lints (the real engine) ───────────────────────────────────
const issues = validate(nodes, cfg);
P(`\n## 1 · Structural lints  (${issues.length})`);
if (!issues.length) P(`✓ clean — no structural, promise, causal, or vertical lints fired.`);
for (const i of issues) P(`- **[${i.severity}]** \`${i.rule}\` — ${i.message}`);

// ── 2 · Obligation ledger (debt-based completion) ────────────────────────────
const open = openObligations(nodes, cfg);
P(`\n## 2 · Obligation ledger`);
P(`Settled: **${debtSettled(nodes, cfg) ? "yes ✓" : `no — ${open.length} open`}**`);
for (const o of open) P(`- open \`${o.kind}\` — **${o.name}**: ${o.promise}${o.quiet != null ? `  _(quiet ${o.quiet})_` : ""}`);

// ── 3 · Analysis (pacing · promises · topography · causality · meters) ───────
P(`\n## 3 · Analysis\n\n\`\`\`\n${analysisText(nodes, { word_target: brief.scope?.word_target }, cfg)}\n\`\`\``);

// ── 4 · Observed meter trace vs target (read the PROSE, diff the plan) ────────
const acts = by("act"); const actPos = new Map(acts.map((a, i) => [a.id, i]));
const beats = by("beat").sort((a, b) => (actPos.get(a.parent_id!)! - actPos.get(b.parent_id!)!) || (a.position - b.position));
const scenesByBeat = (bid: string) => nodes.filter((n) => n.kind === "scene" && n.parent_id === bid).sort((a, b) => a.position - b.position);
const beatProse = (bid: string) => scenesByBeat(bid).map((s) => (s.content as any)?.prose?.text ?? "").filter(Boolean).join("\n\n");
const meters = by("meter");
const proseBeats = beats.map((b) => ({ beatId: b.id, summary: (b.content as any).summary, prose: beatProse(b.id) })).filter((b) => b.prose);

P(`\n## 4 · Meters — planned vs observed`);
if (!meters.length) { P(`(no meters)`); }
else if (!proseBeats.length) { P(`⏸ no prose yet — run generation without DNA_NO_PROSE, then re-eval for the observed trace.`); }
else {
  const meterIn = meters.map((m) => { const c = m.content as any; return { id: m.id, name: c.name, kind: c.kind, min: c.scale?.min, max: c.scale?.max, low: c.poles?.low, high: c.poles?.high, target: c.target }; });
  const res = await runReadMeters(bookId, proseBeats, meterIn);
  const readings: { beatId: string; meterId: string; value: number }[] = res.readings ?? [];
  const fracOf = (bid: string) => { const i = beats.findIndex((b) => b.id === bid); return beats.length > 1 ? i / (beats.length - 1) : 0.5; };
  const interp = (target: { at: number; value: number }[], at: number) => {
    if (!target?.length) return null;
    const s = [...target].sort((a, b) => a.at - b.at);
    if (at <= s[0].at) return s[0].value; if (at >= s[s.length - 1].at) return s[s.length - 1].value;
    for (let i = 1; i < s.length; i++) if (at <= s[i].at) { const a = s[i - 1], b = s[i]; return a.value + (b.value - a.value) * ((at - a.at) / (b.at - a.at)); }
    return s[s.length - 1].value;
  };
  for (const m of meterIn) {
    P(`\n**${m.name}** _(${m.kind})_ — ${m.low ?? "?"} → ${m.high ?? "?"}`);
    const rs = readings.filter((r) => r.meterId === m.id);
    if (!rs.length) { P(`  (no readings)`); continue; }
    for (const b of proseBeats) {
      const r = rs.find((x) => x.beatId === b.beatId); if (!r) continue;
      const want = m.target ? interp(m.target, fracOf(b.beatId)) : null;
      const drift = want != null ? r.value - want : null;
      P(`  - "${(b.summary ?? "").slice(0, 44)}" — observed **${r.value}**${want != null ? ` / target ${Math.round(want)} ${Math.abs(drift!) > 20 ? "⚠" : "✓"}` : ""}`);
    }
  }
}

// ── 5 · Manuscript assembly (for the editor's read) ──────────────────────────
const manuscript: string[] = [`# ${book?.name}\n`];
let chap = 0;
for (const a of acts) {
  const actBeats = beats.filter((b) => b.parent_id === a.id);
  for (const b of actBeats) { const pr = beatProse(b.id); if (pr) { chap++; manuscript.push(`\n\n## ${(b.content as any).summary ?? `Chapter ${chap}`}\n\n${pr}`); } }
}
const words = manuscript.join(" ").trim().split(/\s+/).length;
const msPath = join(repoRoot, "scripts/.dna-short-manuscript.md");
writeFileSync(msPath, manuscript.join("\n"));
P(`\n## 5 · Manuscript\n${words} words → \`${msPath}\``);

const reportPath = join(repoRoot, "scripts/.dna-short-eval.md");
writeFileSync(reportPath, out.join("\n") + "\n");
console.log(out.join("\n"));
console.log(`\n[report → ${reportPath}]`);
