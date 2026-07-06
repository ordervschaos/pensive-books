// dnaFlow.eval — the EVALUATION half of the brief→book flow check. It loads the structural tree the
// driver (scripts/dna-flow-test.mjs) generated through the dev bridge and runs the REAL engine's three
// analytic axes over it (validate / pacing / topography / promises). Not a CI unit test — a dev harness
// that grades a real generated book. Run after the driver dumps the tree:
//
//   node scripts/dna-flow-test.mjs                    # generate (slow — bridge calls)
//   npx vitest run src/lib/dnaFlow.eval.test.ts       # evaluate
//
// If the fixture is absent it skips (so a normal `vitest` run doesn't fail).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  byId, scenesInOrder, chapters, validate, pacing, topography,
  type DnaNode, type SceneContent, type ActContent, type ThreadContent,
} from "@/features/dna/lib/novelDna";

const FIXTURE = join(process.cwd(), "../../scripts/.dna-flow-tree.json");
const present = existsSync(FIXTURE);
const load = (): { bookId: number; nodes: DnaNode[] } => JSON.parse(readFileSync(FIXTURE, "utf8"));

(present ? describe : describe.skip)("DNA flow — generated tree evaluation", () => {
  const { bookId, nodes } = present ? load() : { bookId: 0, nodes: [] as DnaNode[] };
  const index = byId(nodes);
  const kinds = nodes.reduce<Record<string, number>>((a, n) => ((a[n.kind] = (a[n.kind] ?? 0) + 1), a), {});

  it("prints a full structural report", () => {
    const scenes = scenesInOrder(nodes);
    const threads = nodes.filter((n) => n.kind === "thread");
    const acts = nodes.filter((n) => n.kind === "act").sort((a, b) => a.position - b.position);
    const issues = validate(nodes);
    const report: string[] = [];
    report.push(`\n══════════ DNA FLOW REPORT — book ${bookId} ══════════`);
    report.push(`nodes: ${JSON.stringify(kinds)}`);
    report.push(`scenes (reading order): ${scenes.length} · chapters: ${chapters(nodes).length}`);

    report.push(`\n── PACING (when) — turning point vs target_pct ──`);
    for (const p of pacing(nodes)) {
      const flag = typeof p.targetPct === "number" && Math.abs(p.driftPct) > 0.1 ? "  ⚠ DRIFT" : "";
      report.push(`  ${(p.title ?? p.actId).padEnd(28)} target ${p.targetPct != null ? Math.round(p.targetPct * 100) + "%" : "—"}  actual ${Math.round(p.actualPct * 100)}%${flag}`);
    }

    report.push(`\n── PROMISES (what) — the thread registry ──`);
    for (const t of threads) {
      const c = t.content as ThreadContent;
      const setups = scenes.filter((s) => (s.content as SceneContent).threads?.some((x) => x.ref === t.id && x.role === "setup")).length;
      const payoffs = scenes.filter((s) => (s.content as SceneContent).threads?.some((x) => x.ref === t.id && x.role === "payoff")).length;
      report.push(`  "${c.name ?? t.id}" [${c.kind ?? "?"}]  setups:${setups} payoffs:${payoffs} — ${c.promise ?? ""}`);
    }

    report.push(`\n── TOPOGRAPHY (charge) — value_shift polarity in reading order ──`);
    const topo = topography(nodes).map((t) => (t.polarity === "up" ? "▲" : t.polarity === "down" ? "▼" : "·"));
    report.push(`  ${topo.join(" ")}`);

    report.push(`\n── LINTS (${issues.length}) ──`);
    if (!issues.length) report.push("  (none)");
    for (const i of issues) report.push(`  [${i.severity}] ${i.rule}: ${i.message}${i.nodeId ? ` (${i.nodeId})` : ""}`);
    report.push(`\n═══════════════════════════════════════════════════════\n`);
     
    console.log(report.join("\n"));

    // Sanity: the flow actually produced a structural book.
    expect(scenes.length).toBeGreaterThan(0);
    expect(acts.length).toBeGreaterThan(0);
  });

  it("the new generate-half fields are populated (threads, target_pct, polarity)", () => {
    const acts = nodes.filter((n) => n.kind === "act");
    const scenes = scenesInOrder(nodes);
    const withTarget = acts.filter((m) => typeof (m.content as ActContent).target_pct === "number");
    const withPolarity = scenes.filter((s) => (s.content as SceneContent).value_shift?.polarity);
    const sceneThreadRefs = scenes.flatMap((s) => (s.content as SceneContent).threads ?? []);

     
    console.log(`generate-half coverage: target_pct ${withTarget.length}/${acts.length} acts · polarity ${withPolarity.length}/${scenes.length} scenes · scene→thread anchors ${sceneThreadRefs.length} · threads ${kinds.thread ?? 0}`);

    expect(kinds.thread ?? 0).toBeGreaterThan(0);              // threads were generated
    expect(withTarget.length).toBeGreaterThan(0);              // acts carry pacing intent
    // every scene→thread anchor resolves to a real thread node
    for (const ref of sceneThreadRefs) expect(index.get(ref.ref)?.kind).toBe("thread");
  });
});
