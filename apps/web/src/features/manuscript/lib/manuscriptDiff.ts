// manuscriptDiff — the pure engine behind the agent canvas's red/green view and its partial accepts.
//
// Two levels, both LCS: BLOCKS (paragraphs — the "line" level) and, inside a changed block, WORDS. A
// changed block's word ops are grouped into HUNKS (contiguous runs of changed words; whitespace between
// two changes joins them), and a hunk is the smallest unit the author can accept or reject. Block- and
// page-level accepts are just "every hunk in the block / page".
//
// resolve() is the one write path: given the diff and a set of decisions it returns the NEW before
// (what the page should now say — the live text with accepted hunks folded in) and the NEW after (the
// proposal with rejected hunks dropped). before === after ⇒ nothing left to review.
//
// The diff is always computed from the LIVE page text, not the snapshot the agent saw — so an author's
// in-place edit made after the proposal simply shows up as more red/green, honestly, rather than being
// silently overwritten by "accept all".

export type Segment = { type: "eq"; text: string } | { type: "hunk"; id: number; del: string; ins: string };
export type BlockDiff =
  | { type: "equal"; text: string }
  | { type: "deleted"; text: string }
  | { type: "inserted"; text: string }
  | { type: "modified"; before: string; after: string; segments: Segment[] };

export interface Decision { block: number; hunk?: number; verdict: "accept" | "reject" }

// ── LCS over arbitrary keyed sequences ──
type Op<T> = { op: "eq" | "del" | "ins"; a?: T; b?: T };
function lcsDiff<T>(a: T[], b: T[], key: (t: T) => string): Op<T>[] {
  const n = a.length, m = b.length;
  const ka = a.map(key), kb = b.map(key);
  // dp[i][j] = LCS length of a[i..] and b[j..], stored flat.
  const w = m + 1;
  const dp = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = ka[i] === kb[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  const ops: Op<T>[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (ka[i] === kb[j]) { ops.push({ op: "eq", a: a[i], b: b[j] }); i++; j++; }
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) { ops.push({ op: "del", a: a[i++] }); }
    else { ops.push({ op: "ins", b: b[j++] }); }
  }
  while (i < n) ops.push({ op: "del", a: a[i++] });
  while (j < m) ops.push({ op: "ins", b: b[j++] });
  return ops;
}

// ── Words ──
const tokenize = (text: string): string[] => text.split(/(\s+)/).filter(Boolean);
const isSpace = (t: string) => /^\s+$/.test(t);

/** Word-level segments for one changed block, hunks numbered from 0. */
export function wordSegments(before: string, after: string): Segment[] {
  const ops = lcsDiff(tokenize(before), tokenize(after), (t) => t);
  const segs: Segment[] = [];
  let eq = "";
  let hunk: { del: string; ins: string } | null = null;
  const closeHunk = () => { if (hunk) { segs.push({ type: "hunk", id: -1, del: hunk.del, ins: hunk.ins }); hunk = null; } };
  const flushEq = () => { if (eq) { segs.push({ type: "eq", text: eq }); eq = ""; } };
  for (let k = 0; k < ops.length; k++) {
    const o = ops[k];
    if (o.op === "eq") {
      const t = o.a as string;
      // Whitespace wedged between two changes belongs to the hunk, so contiguous edits read as one.
      if (hunk && isSpace(t) && ops[k + 1] && ops[k + 1].op !== "eq") { hunk.del += t; hunk.ins += t; continue; }
      closeHunk();
      eq += t;
    } else {
      flushEq();
      if (!hunk) hunk = { del: "", ins: "" };
      if (o.op === "del") hunk.del += o.a as string; else hunk.ins += o.b as string;
    }
  }
  closeHunk();
  flushEq();
  let id = 0;
  for (const s of segs) if (s.type === "hunk") s.id = id++;
  return segs;
}

// How alike two blocks are (0..1) — decides whether a deleted+inserted pair reads as ONE modified block
// with word hunks, or as two whole-block changes. Below the threshold a word diff is noise.
function similarity(a: string, b: string): number {
  const segs = wordSegments(a, b);
  const eq = segs.reduce((n, s) => n + (s.type === "eq" ? s.text.length : 0), 0);
  return eq / Math.max(1, Math.max(a.length, b.length));
}
const PAIR_THRESHOLD = 0.3;

// ── Blocks ──
const splitBlocks = (text: string): string[] => text.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);

/** The block diff of two body texts, with word hunks inside blocks that changed in place. */
export function diffBody(before: string, after: string): BlockDiff[] {
  const ops = lcsDiff(splitBlocks(before), splitBlocks(after), (t) => t);
  const out: BlockDiff[] = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].op === "eq") { out.push({ type: "equal", text: ops[k].a as string }); k++; continue; }
    // A run of dels then ins: pair them up positionally where they're alike enough.
    const dels: string[] = [], inss: string[] = [];
    while (k < ops.length && ops[k].op !== "eq") { if (ops[k].op === "del") dels.push(ops[k].a as string); else inss.push(ops[k].b as string); k++; }
    let di = 0, ii = 0;
    while (di < dels.length || ii < inss.length) {
      if (di < dels.length && ii < inss.length && similarity(dels[di], inss[ii]) >= PAIR_THRESHOLD) {
        out.push({ type: "modified", before: dels[di], after: inss[ii], segments: wordSegments(dels[di], inss[ii]) });
        di++; ii++;
      } else if (di < dels.length && (ii >= inss.length || dels.length - di >= inss.length - ii)) {
        out.push({ type: "deleted", text: dels[di++] });
      } else {
        out.push({ type: "inserted", text: inss[ii++] });
      }
    }
  }
  return out;
}

/** Reviewable units in a diff: each whole-block change counts 1, a modified block counts its hunks. */
export function countUnits(diff: BlockDiff[]): number {
  return diff.reduce((n, b) => n + (b.type === "equal" ? 0 : b.type === "modified" ? b.segments.filter((s) => s.type === "hunk").length : 1), 0);
}

/** Apply decisions: the page's new text (accepted hunks folded in) and the proposal's new text (rejected hunks dropped). */
export function resolve(diff: BlockDiff[], decisions: Decision[]): { before: string; after: string } {
  const verdict = (block: number, hunk?: number): "accept" | "reject" | null => {
    // A hunk-level decision wins over a block-level one for that hunk; block-level covers every hunk.
    const h = hunk != null ? decisions.find((d) => d.block === block && d.hunk === hunk) : undefined;
    if (h) return h.verdict;
    const b = decisions.find((d) => d.block === block && d.hunk == null);
    return b ? b.verdict : null;
  };
  const before: string[] = [], after: string[] = [];
  diff.forEach((b, i) => {
    if (b.type === "equal") { before.push(b.text); after.push(b.text); return; }
    if (b.type === "deleted") {
      const v = verdict(i);
      if (v !== "accept") before.push(b.text);
      if (v === "reject") after.push(b.text);
      return;
    }
    if (b.type === "inserted") {
      const v = verdict(i);
      if (v === "accept") before.push(b.text);
      if (v !== "reject") after.push(b.text);
      return;
    }
    let bText = "", aText = "";
    for (const s of b.segments) {
      if (s.type === "eq") { bText += s.text; aText += s.text; continue; }
      const v = verdict(i, s.id);
      bText += v === "accept" ? s.ins : s.del;
      aText += v === "reject" ? s.del : s.ins;
    }
    if (bText.trim()) before.push(bText.trim());
    if (aText.trim()) after.push(aText.trim());
  });
  return { before: before.join("\n\n"), after: after.join("\n\n") };
}

/** Every unit in the diff decided one way — the page-level accept/reject. */
export function decideAll(diff: BlockDiff[], v: "accept" | "reject"): Decision[] {
  return diff.map((b, i) => (b.type === "equal" ? null : { block: i, verdict: v })).filter((d): d is Decision => !!d);
}
