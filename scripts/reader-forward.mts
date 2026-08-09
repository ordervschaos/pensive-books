#!/usr/bin/env -S npx tsx
// Reader Machine — P1 harness: run the CAUSAL FORWARD PASS over one chapter and save the trace.
//
//   npx tsx scripts/reader-forward.mts --epub sample-books/Fourth-Wing.epub --chapter 1 [--limit 40]
//   npx tsx scripts/reader-forward.mts … --out apps/web/src/features/reader/fixtures/fourth-wing-ch1-trace.json
//
// Same sweep the /reader page runs — `runForwardPass` is imported, not reimplemented; only the
// transport differs (fetch here, supabase.functions.invoke in the browser). So a trace produced
// here is exactly what the page would produce, which is what makes it usable as the demo fixture.
//
// ── Auth ─────────────────────────────────────────────────────────────────────────────────────────
// read-trace requires a real user JWT (it spends model budget, so an anon caller is not allowed).
// This mints a short-lived session for an EXISTING user of this project via the admin generate-link
// + verify pair — no user is created, no data is written, and the token is never persisted. It is
// the standard way to script-test an authed edge function against your own project.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
// `resolve`, not `join`: an --out/--retouch path may be absolute, and join() would graft it onto
// repoRoot ("/repo" + "/tmp/x" → "/repo/tmp/x"), silently writing the checkpoint somewhere nobody
// looks. That is exactly how the first checkpoint test appeared to write nothing.
import { dirname, join, resolve } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const { Window } = await import(join(repoRoot, "apps/web/node_modules/happy-dom/lib/index.js"));
globalThis.DOMParser = new Window().DOMParser;

const { readEpub, analyzeChapter } = await import(join(repoRoot, "apps/web/src/features/reader/lib/readerMachine.ts"));
const { runForwardPass, planWindows, rebuildTouches } = await import(join(repoRoot, "apps/web/src/features/reader/lib/forwardPass.ts"));
const { tracks, foldTo, ranked, openQuestions } = await import(join(repoRoot, "apps/web/src/features/reader/lib/brain.ts"));

const env = Object.fromEntries(
  readFileSync(join(repoRoot, ".env.local"), "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const URL_BASE = `https://${env.VITE_SUPABASE_PROJECT_ID}.supabase.co`;
const SR = env.SERVICE_ROLE_SECRET;
const ANON = env.VITE_SUPABASE_ANON_KEY;

const args = process.argv.slice(2);
const argVal = (f: string, d?: string) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : d; };
const EPUB = argVal("--epub", "sample-books/Fourth-Wing.epub")!;
const CHAPTER = Number(argVal("--chapter", "1"));
const LIMIT = argVal("--limit") ? Number(argVal("--limit")) : null;
const OUT = argVal("--out");

// ── mint a session ───────────────────────────────────────────────────────────────────────────────
async function userToken(): Promise<string> {
  const list = await fetch(`${URL_BASE}/auth/v1/admin/users?per_page=1`, {
    headers: { apikey: SR, Authorization: `Bearer ${SR}` },
  });
  const users = (await list.json()) as { users?: { email?: string }[] };
  const email = users.users?.[0]?.email;
  if (!email) throw new Error("no users in this project to mint a session for");

  const link = await fetch(`${URL_BASE}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: { apikey: SR, Authorization: `Bearer ${SR}`, "content-type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email }),
  });
  const linkBody = (await link.json()) as { hashed_token?: string };
  if (!linkBody.hashed_token) throw new Error(`generate_link failed: ${JSON.stringify(linkBody).slice(0, 200)}`);

  const verify = await fetch(`${URL_BASE}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json" },
    // `token_hash`, not `token`: the admin link returns a HASHED token, and the `token` form of
    // /verify additionally demands the email it belongs to.
    body: JSON.stringify({ type: "magiclink", token_hash: linkBody.hashed_token }),
  });
  const session = (await verify.json()) as { access_token?: string };
  if (!session.access_token) throw new Error(`verify failed: ${JSON.stringify(session).slice(0, 200)}`);
  console.log(`  auth: session minted for ${email}`);
  return session.access_token;
}

// ── run ──────────────────────────────────────────────────────────────────────────────────────────
const book = await readEpub(readFileSync(join(repoRoot, EPUB)));
const a = analyzeChapter(book, CHAPTER - 1);
const units = LIMIT ? a.units.slice(0, LIMIT) : a.units;
const windows = planWindows(units);

console.log(`\n${book.title} — ${a.chapter.label}`);
console.log(`  ${units.length} units · ${units.reduce((n, u) => n + u.words, 0)} words · ${windows.length} model calls\n`);

// --retouch: recompute the free `touch` ops on an existing trace and exit. Touches are computed,
// never judged, so a trace captured under an older matcher can be brought in line with the current
// code without re-paying for the sweep.
const RETOUCH = argVal("--retouch");
if (RETOUCH) {
  const path = resolve(repoRoot, RETOUCH);
  const prev = JSON.parse(readFileSync(path, "utf8")) as { deltas: unknown[] };
  const before = prev.deltas.flatMap((d) => (d as { ops: { op: string }[] }).ops).filter((o) => o.op === "touch").length;
  const rebuilt = rebuildTouches(units, prev.deltas as never[]);
  const after = rebuilt.flatMap((d) => d.ops).filter((o) => o.op === "touch").length;
  writeFileSync(path, `${JSON.stringify({ ...prev, deltas: rebuilt }, null, 2)}\n`);
  console.log(`  retouched ${RETOUCH}: ${before} → ${after} touch ops\n`);
  process.exit(0);
}

// CHECKPOINT + RESUME. A full-chapter sweep is ~30 sequential model calls over half an hour, and
// losing all of it to one interruption already happened once. So the trace is rewritten after EVERY
// window, and a re-run picks up whatever is on disk — the brain is event-sourced, so replaying the
// saved deltas puts the reader back exactly where they were. Nothing already paid for is re-run.
const outPath = OUT ? resolve(repoRoot, OUT) : null;
let resumeFrom: unknown[] = [];
if (outPath) {
  try {
    const prev = JSON.parse(readFileSync(outPath, "utf8")) as { deltas?: unknown[] };
    if (Array.isArray(prev.deltas) && prev.deltas.length) {
      resumeFrom = prev.deltas;
      console.log(`  resume: ${resumeFrom.length} units already read on disk`);
    }
  } catch { /* no checkpoint yet — start clean */ }
}
const save = (deltas: unknown[]) => {
  if (!outPath) return;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify({ chapter: a.chapter.label, units: units.length, deltas }, null, 2)}\n`);
};

// A full sweep outlives its own credentials: a Supabase access token lasts an hour and the first
// complete run took three, so the last ten windows came back 401 and folded as unread. Re-mint on
// 401 rather than pre-emptively — one extra round trip on expiry beats guessing the lifetime.
let token = await userToken();
const started = Date.now();

const res = await runForwardPass(units, async (body) => {
  const send = () => fetch(`${URL_BASE}/functions/v1/read-trace`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    // Without this a stalled connection hangs the whole sweep — several windows sat in "fetch
    // failed" for minutes each, which is most of why the first run took 3.4h instead of ~40m.
    signal: AbortSignal.timeout(160_000),
  });

  let r = await send();
  if (r.status === 401) {
    console.log("  auth: token expired, re-minting");
    token = await userToken();
    r = await send();
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string })?.error ?? `read-trace ${r.status}`);
  return data as { deltas?: unknown[] };
}, {
  resumeFrom: resumeFrom as never[],
  onDeltas: save,
  onProgress: (p) => console.log(`  window ${p.window}/${p.windows} · ${p.unitsDone}/${p.unitsTotal} units`),
});

console.log(`\n  done in ${Math.round((Date.now() - started) / 1000)}s`);
if (res.failed.length) console.log(`  ⚠ ${res.failed.length} window(s) failed: ${res.failed.map((f) => `${f.from}-${f.to}: ${f.error}`).join(" | ")}`);

// ── report ───────────────────────────────────────────────────────────────────────────────────────
const opCount = res.deltas.reduce((n, d) => n + d.ops.length, 0);
const byOp = res.deltas.flatMap((d) => d.ops).reduce<Record<string, number>>((m, o) => ({ ...m, [o.op]: (m[o.op] ?? 0) + 1 }), {});
const final = foldTo(res.deltas, res.deltas[res.deltas.length - 1].i);
const t = tracks(res.deltas);

console.log(`\n  ${opCount} ops over ${res.deltas.length} units (${(opCount / res.deltas.length).toFixed(1)}/unit)`);
console.log(`  ${Object.entries(byOp).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
console.log(`\n  entities ${Object.keys(final.entities).length} · facts ${Object.keys(final.facts).length} · relations ${final.relations.length}`);
console.log(`  questions ${final.questions.length} total, ${openQuestions(final).length} still open at the end`);

const SPARK = "▁▂▃▄▅▆▇█";
const spark = (xs: number[]) => {
  const lo = Math.min(...xs), span = (Math.max(...xs) - lo) || 1;
  return xs.map((x) => SPARK[Math.min(7, Math.floor(((x - lo) / span) * 7.999))]).join("");
};
const bucket = (xs: number[], n: number) => xs.length <= n ? xs : Array.from({ length: n }, (_, b) => {
  const lo = Math.floor((b * xs.length) / n), hi = Math.max(lo + 1, Math.floor(((b + 1) * xs.length) / n));
  return xs.slice(lo, hi).reduce((s, c) => s + c, 0) / (hi - lo);
});
console.log(`\n  pull       ${spark(bucket(t.map((r) => r.pull), 52))}`);
console.log(`  tension    ${spark(bucket(t.map((r) => r.tension), 52))}`);
console.log(`  immersion  ${spark(bucket(t.map((r) => r.immersion), 52))}`);
console.log(`  in mind    ${spark(bucket(t.map((r) => r.live), 52))}`);

console.log(`\n  WHO MATTERS`);
for (const { entity, score } of ranked(final).slice(0, 10)) {
  console.log(`    ${String(Math.round(score)).padStart(3)}  ${entity.name.padEnd(22)} ${entity.kind.padEnd(10)} first@${entity.firstSeen} ${entity.mentions}× ${entity.recalls.length ? `recalled ${entity.recalls.length}×` : ""}`);
}

console.log(`\n  STILL OPEN AT THE END`);
for (const q of openQuestions(final).slice(0, 10)) {
  console.log(`    [${q.kind}] heat ${q.heat} · opened @${q.openedAt} — ${q.text}`);
}
console.log();

if (OUT) {
  mkdirSync(dirname(join(repoRoot, OUT)), { recursive: true });
  writeFileSync(join(repoRoot, OUT), `${JSON.stringify({ chapter: a.chapter.label, units: units.length, deltas: res.deltas }, null, 2)}\n`);
  console.log(`  trace → ${OUT}\n`);
}
