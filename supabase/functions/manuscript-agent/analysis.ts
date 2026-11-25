// manuscript-agent pure text analysis — no I/O, so the web tests import it directly (like canvas.ts).
//   matcher      — the one place a search/replace query becomes a RegExp (phrase | word | regex)
//   findHits     — snippets around each match, for search_pages
//   replaceIn    — book-wide find/replace on one page's text, for replace_across_book
//   checkProse   — a deterministic craft read of one page (sentence length, echoes, filter words, …)
// Deterministic on purpose: the model reads the numbers and decides; it never has to count.

export type MatchMode = "phrase" | "word" | "regex";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Build the query's RegExp, or an error sentence for the model. Always global. */
export function matcher(query: string, mode: MatchMode = "phrase", caseSensitive = false): RegExp | string {
  const q = query.trim();
  if (!q) return "query is required.";
  if (q.length > 200) return "query is too long (max 200 characters).";
  const flags = caseSensitive ? "gu" : "giu";
  const source = mode === "regex" ? q : mode === "word" ? `(?<![\\p{L}\\p{N}_])${escape(q)}(?![\\p{L}\\p{N}_])` : escape(q);
  try {
    const re = new RegExp(source, flags);
    if (re.test("")) return "that pattern matches empty text; make it more specific.";
    return re;
  } catch (e) {
    return `invalid regex: ${(e as Error).message}`;
  }
}

export function findHits(text: string, re: RegExp, max: number): { count: number; snippets: string[] } {
  const snippets: string[] = [];
  let count = 0;
  for (const m of text.matchAll(re)) {
    count++;
    if (snippets.length < max) {
      const at = m.index ?? 0;
      const s = Math.max(0, at - 70), e = Math.min(text.length, at + m[0].length + 70);
      snippets.push(`…${text.slice(s, e).replace(/\s+/g, " ")}…`);
    }
  }
  return { count, snippets };
}

/** Replace every match; `$1`-style groups work in regex mode only (the caller escapes otherwise). */
export function replaceIn(text: string, re: RegExp, replace: string, mode: MatchMode): { after: string; count: number } {
  let count = 0;
  const after = text.replace(re, (...args) => {
    count++;
    if (mode !== "regex") return replace;
    const groups = args.slice(1, -2) as (string | undefined)[];
    return replace.replace(/\$(\d)/g, (_, d) => groups[Number(d) - 1] ?? "");
  });
  return { after, count };
}

// ── checkProse ──
const STOP = new Set(("the a an and or but if then of to in on at by for with from as is was were be been being it its this that these those he she they we you i me him her them us my his their our your not no so too very just than there here what which who whom when where why how all any some into out up down over under again once only own same such can will would could should had has have do did does said says say into onto about after before through while because each other more most").split(" "));
const FILTER = ["felt", "feel", "feels", "saw", "see", "sees", "heard", "hear", "noticed", "realized", "realised", "seemed", "seems", "wondered", "watched", "knew", "thought", "began to", "started to", "could see", "could hear", "could feel"];
const HEDGES = ["very", "really", "just", "quite", "rather", "somehow", "suddenly", "actually", "literally", "basically", "almost", "slightly"];
const LY_KEEP = new Set(["only", "family", "early", "likely", "reply", "fly", "holy", "ugly", "belly", "jelly", "lily", "rely", "supply", "apply", "italy", "july", "sally", "molly", "billy", "emily", "holly", "kelly", "daily", "silly", "lonely", "lovely", "friendly", "ally", "rally", "bully", "folly", "jolly", "curly", "costly", "elderly", "orderly", "deadly", "chilly", "hilly", "oily", "wily", "unlikely", "assembly", "anomaly", "monopoly", "butterfly"]);

const words = (s: string) => s.toLowerCase().match(/[\p{L}'’]+/gu) ?? [];
const sentencesOf = (text: string) =>
  text.replace(/^#+ .*$/gm, "").replace(/^[-*>] /gm, "").split(/(?<=[.!?…]["”’)]?)\s+|\n{2,}/).map((s) => s.trim()).filter((s) => words(s).length > 0);

function top(counts: Map<string, number>, n: number, min = 2): string {
  return [...counts].filter(([, c]) => c >= min).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([w, c]) => `${w}×${c}`).join(", ");
}

/** A compact, numbers-only craft read of one page's text. */
export function checkProse(text: string): string {
  const all = words(text);
  if (!all.length) return "empty page";
  const sents = sentencesOf(text);
  const lens = sents.map((s) => words(s).length);
  const avg = lens.reduce((a, b) => a + b, 0) / Math.max(1, lens.length);
  const sd = Math.sqrt(lens.reduce((a, b) => a + (b - avg) ** 2, 0) / Math.max(1, lens.length));
  const longest = lens.length ? sents[lens.indexOf(Math.max(...lens))] : "";
  const long = lens.filter((n) => n > 35).length;
  const lower = ` ${all.join(" ")} `;
  const count = (phrase: string) => lower.split(` ${phrase} `).length - 1;

  const filter = new Map(FILTER.map((f) => [f, count(f)]));
  const hedges = new Map(HEDGES.map((h) => [h, count(h)]));
  const adverbs = new Map<string, number>();
  for (const w of all) if (w.length > 4 && w.endsWith("ly") && !LY_KEEP.has(w)) adverbs.set(w, (adverbs.get(w) ?? 0) + 1);

  // Echoes: the same content word again within 60 words — the repetition a reader's ear catches.
  const echoes = new Map<string, number>();
  const last = new Map<string, number>();
  all.forEach((w, i) => {
    if (w.length < 5 || STOP.has(w)) return;
    const prev = last.get(w);
    if (prev != null && i - prev <= 60) echoes.set(w, (echoes.get(w) ?? 0) + 1);
    last.set(w, i);
  });

  // Openers: three or more sentences in a row starting with the same word.
  let runs = 0;
  const openers = new Map<string, number>();
  for (let i = 2; i < sents.length; i++) {
    const f = (s: string) => words(s)[0] ?? "";
    if (f(sents[i]) && f(sents[i]) === f(sents[i - 1]) && f(sents[i]) === f(sents[i - 2])) { runs++; openers.set(f(sents[i]), (openers.get(f(sents[i])) ?? 0) + 1); }
  }
  const dialogue = (text.match(/["“][^"”]*["”]/g) ?? []).join("").length / Math.max(1, text.length);
  const paras = text.split(/\n{2,}/).filter((p) => p.trim());

  const lines = [
    `words ${all.length} · sentences ${sents.length} · paragraphs ${paras.length} · dialogue ${Math.round(dialogue * 100)}%`,
    `sentence length avg ${avg.toFixed(1)} · spread ${sd.toFixed(1)} · over-35-words ${long}${longest ? ` · longest (${Math.max(...lens)}w): "${longest.slice(0, 90)}${longest.length > 90 ? "…" : ""}"` : ""}`,
  ];
  const t = (label: string, s: string) => { if (s) lines.push(`${label}: ${s}`); };
  t("echoes within 60 words", top(echoes, 8, 1));
  t("filter words", top(filter, 8, 1));
  t("hedges/intensifiers", top(hedges, 8, 1));
  t("-ly adverbs", top(adverbs, 8, 1));
  if (runs) lines.push(`repeated openers: ${runs} run(s) of 3+ sentences starting with ${[...openers.keys()].map((w) => `"${w}"`).join(", ")}`);
  return lines.join("\n");
}
