// Prose-output lints — deterministic quality checks run on generated scene prose.
//
// These are NEW and distinct from the plan/tree lints in apps/web/src/lib/lints.ts and the
// causality lints in novelDna.ts (those check the OUTLINE; these check the WORDS). Pure, no I/O,
// no LLM — so they're cheap, reproducible, and importable by both the bridge (for the
// anti-repetition blocklist) and the experiment orchestrator (for the lint scoreboard).
//
// The continuity / voice-drift / fact-contradiction checks that need judgement live in the LLM
// judge (see the bridge's /prose-experiment-judge), not here.

const STOP = new Set("the a an and or but of to in on at for with as is was were be been are it its his her their they he she you your we our i me my that this these those there then than so if when while into from over under up down out off not no yes".split(" "));

const words = (t) => (t || "").toLowerCase().replace(/[^a-z0-9'\s]/g, " ").split(/\s+/).filter(Boolean);
const sentences = (t) => (t || "").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
export const wordCount = (t) => ((t || "").trim() ? (t || "").trim().split(/\s+/).length : 0);

// n-grams that carry signal: drop any gram that is entirely stopwords (those repeat harmlessly).
export function ngrams(text, n) {
  const w = words(text);
  const out = [];
  for (let i = 0; i + n <= w.length; i++) {
    const gram = w.slice(i, i + n);
    if (gram.every((g) => STOP.has(g))) continue;
    out.push(gram.join(" "));
  }
  return out;
}

// The distinctive multi-word phrases used across the prior pages — fed to generation as an
// "avoid repeating" blocklist, and used by repetition_prior to score echoes. Ranked by length
// then frequency; deduped; capped.
export function distinctivePhrases(priorText, { n = 5, limit = 40 } = {}) {
  const counts = new Map();
  for (const g of ngrams(priorText, n)) counts.set(g, (counts.get(g) || 0) + 1);
  // A phrase is "distinctive" if it contains at least 3 content (non-stop) words.
  const distinctive = [...counts.keys()].filter((g) => g.split(" ").filter((x) => !STOP.has(x)).length >= 3);
  return distinctive.slice(0, limit);
}

// LINT: repetition_prior — distinctive n-grams the new prose reuses verbatim from earlier pages.
// The generation prompt explicitly forbids this ("do NOT repeat phrases, images, or sentence
// patterns used here"), so any hit is a measurable instruction violation.
export function repetitionPrior(output, priorText, { n = 5 } = {}) {
  const priorSet = new Set(ngrams(priorText, n));
  const hits = [];
  for (const g of ngrams(output, n)) if (priorSet.has(g) && !hits.includes(g)) hits.push(g);
  return { rule: "repetition_prior", n, count: hits.length, samples: hits.slice(0, 12) };
}

// LINT: repetition_internal — phrases / sentence-openers the new prose repeats within itself.
export function repetitionInternal(output, { n = 4 } = {}) {
  const counts = new Map();
  for (const g of ngrams(output, n)) counts.set(g, (counts.get(g) || 0) + 1);
  const repeated = [...counts.entries()].filter(([, c]) => c >= 2).map(([g, c]) => `${g} (×${c})`);
  // Sentence openers (first 3 words) that recur — a common AI tic.
  const openers = new Map();
  for (const s of sentences(output)) {
    const key = words(s).slice(0, 3).join(" ");
    if (key) openers.set(key, (openers.get(key) || 0) + 1);
  }
  const repeatedOpeners = [...openers.entries()].filter(([, c]) => c >= 3).map(([g, c]) => `"${g}…" (×${c})`);
  return { rule: "repetition_internal", count: repeated.length + repeatedOpeners.length, phrases: repeated.slice(0, 8), openers: repeatedOpeners.slice(0, 6) };
}

// LINT: fourth_wall — the prompt forbids addressing the reader or naming the book/story/scene/page.
const FOURTH_WALL = [
  /\bthe reader\b/gi, /\bthe story\b/gi, /\bthe book\b/gi, /\bthis (?:scene|chapter|page|story|book)\b/gi,
  /\bthe (?:scene|chapter|page)\b/gi, /\bthe author\b/gi, /\bdear reader\b/gi, /\bthe writer\b/gi,
];
export function fourthWall(output) {
  const hits = [];
  for (const re of FOURTH_WALL) {
    for (const m of output.matchAll(re)) {
      const i = m.index ?? 0;
      hits.push(output.slice(Math.max(0, i - 25), i + m[0].length + 25).replace(/\s+/g, " ").trim());
    }
  }
  return { rule: "fourth_wall", count: hits.length, samples: hits.slice(0, 8) };
}

// LINT: length_vs_target — output length against the scene/mandate word target (if any).
export function lengthVsTarget(output, target) {
  const w = wordCount(output);
  if (!target) return { rule: "length_vs_target", words: w, target: null, ratio: null, flag: false };
  const ratio = +(w / target).toFixed(2);
  return { rule: "length_vs_target", words: w, target, ratio, flag: ratio < 0.6 || ratio > 1.6 };
}

// LINT: name_drift — capitalized names used in the prose that aren't in the known cast registry.
// Heuristic: collects Titlecase tokens, drops sentence-initial common words, flags the rest as
// candidates for unknown characters (a continuity smell — invented or misremembered names).
export function nameDrift(output, castNames) {
  const known = new Set(castNames.flatMap((n) => n.toLowerCase().split(/\s+/)).filter(Boolean));
  const seen = new Map();
  for (const s of sentences(output)) {
    const toks = s.split(/\s+/);
    toks.forEach((tok, idx) => {
      const clean = tok.replace(/[^A-Za-z'-]/g, "");
      if (!/^[A-Z][a-z]{2,}$/.test(clean)) return;
      if (idx === 0) return; // sentence-initial: usually just a capitalized common word
      if (known.has(clean.toLowerCase())) return;
      if (STOP.has(clean.toLowerCase())) return;
      seen.set(clean, (seen.get(clean) || 0) + 1);
    });
  }
  // Only surface tokens that recur (one-off proper nouns are usually places/objects, not drift).
  const drift = [...seen.entries()].filter(([, c]) => c >= 2).map(([w, c]) => `${w} (×${c})`);
  return { rule: "name_drift", count: drift.length, candidates: drift.slice(0, 10) };
}

// Run every deterministic lint on one arm's output. `priorText` = all prior pages concatenated.
export function runProseLints(output, { priorText = "", castNames = [], wordTarget = null } = {}) {
  return [
    repetitionPrior(output, priorText),
    repetitionInternal(output),
    fourthWall(output),
    lengthVsTarget(output, wordTarget),
    nameDrift(output, castNames),
  ];
}

// Rough token estimate (chars/4) — good enough for comparing context sizes across arms.
export const approxTokens = (s) => Math.round((s || "").length / 4);
