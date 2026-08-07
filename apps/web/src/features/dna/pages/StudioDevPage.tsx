// StudioDevPage — /books/:slug/studio/tree/dev (admin only)
// The book's flight recorder: every agent run (book_agent_runs), archived chat (book_agent_sessions),
// and LLM call (ai_calls) for one book, in one inspector. The run view renders the stored transcript
// turn-by-turn — text / thinking / tool_use / tool_result blocks — and pairs each assistant turn with
// the ai_calls row that produced it (model, provider, tokens, latency), so "what happened on turn N"
// is answerable from one screen. Nothing is excluded: raw row JSON is always one <details> away.
// Follows the admin AiCalls egress pattern: lists fetch light columns; heavy blobs (system/input/
// output/artifacts, transcript) load on selection. Realtime events are a signal to refetch, never a
// payload to trust (useLatestTaskRow's rule).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2 } from "lucide-react";

// Tables not in the generated Database types; string-typed names use the permissive overload.
const RUNS: string = "book_agent_runs";
const SESSIONS: string = "book_agent_sessions";
const AI_CALLS: string = "ai_calls";

const RUN_LIST_COLS = "id, kind, status, turns, title, created_at, updated_at, cancel_requested, context_auto, context_effort, error";
const SESSION_LIST_COLS = "id, thread_id, title, created_at, ended_at";
const CALL_LIST_COLS = "id, created_at, book_id, user_id, task_table, task_id, fn, source, status, model, provider, node_id, operation, transcript_index, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, latency_ms, stop_reason, error";
const CALL_HEAVY_COLS = "system, input, output, output_json, artifacts";

interface RunLite { id: number; kind: string; status: string; turns: number; title: string | null; created_at: string; updated_at: string; cancel_requested: boolean; context_auto: boolean; context_effort: string | null; error: string | null }
interface SessionLite { id: number; thread_id: number; title: string | null; created_at: string; ended_at: string }
interface CallLite {
  id: number; created_at: string; book_id: number | null; user_id: string | null; task_table: string | null; task_id: number | null;
  fn: string; source: string; status: string; model: string | null; provider: string | null; node_id: string | null; operation: string | null;
  transcript_index: number | null; // exact call↔turn join (stored-transcript slot); null = legacy row or non-transcript caller
  input_tokens: number | null; output_tokens: number | null;
  cache_read_tokens: number | null; cache_write_tokens: number | null; // prompt-cache split; null = provider reported nothing
  latency_ms: number | null; stop_reason: string | null; error: string | null;
}
interface CallHeavy { system: string | null; input: unknown; output: string | null; output_json: unknown; artifacts: unknown }
// Full run/session rows arrive as loose records; we only type what the renderer touches.
type Row = Record<string, unknown>;

const getNumericId = (p: string | undefined) => { const m = p?.match(/^(\d+)/); return m ? parseInt(m[1]) : 0; };
const ts = (s: string | null | undefined) => (s ? new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—");
const num = (n: number | null | undefined) => (typeof n === "number" ? n.toLocaleString() : "—");

const STATUS_TONE: Record<string, string> = {
  running: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  idle: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  done: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  awaiting_input: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  error: "bg-red-500/15 text-red-600 dark:text-red-400",
  cancelled: "bg-zinc-500/15 text-zinc-500",
};
function StatusChip({ s }: { s: string }) {
  return <span className={`px-1.5 py-0.5 rounded text-[11px] font-mono ${STATUS_TONE[s] ?? "bg-zinc-500/15 text-zinc-500"}`}>{s}</span>;
}

// Collapsible pretty-JSON — the workhorse for "don't exclude anything".
function Json({ label, value, open }: { label: string; value: unknown; open?: boolean }) {
  if (value == null || (Array.isArray(value) && value.length === 0)) return null;
  let text: string;
  try { text = typeof value === "string" ? value : JSON.stringify(value, null, 2); } catch { text = String(value); }
  return (
    <details open={open} className="my-1">
      <summary className="cursor-pointer text-[11px] font-mono text-muted-foreground hover:text-foreground select-none">
        {label} <span className="opacity-50">({text.length.toLocaleString()} chars)</span>
      </summary>
      <pre className="mt-1 p-2 rounded bg-muted/50 text-[11px] leading-relaxed overflow-x-auto whitespace-pre-wrap break-words max-h-[50vh] overflow-y-auto">{text}</pre>
    </details>
  );
}

// Single-line JSON for skim rows: no indentation, truncated.
function compactJson(v: unknown, max = 110): string {
  let s: string;
  try { s = typeof v === "string" ? v : JSON.stringify(v) ?? ""; } catch { s = String(v); }
  s = s.replace(/\s+/g, " ");
  return s.length > max ? s.slice(0, max) + "…" : s;
}

// Flatten a tool_result's content (string, or an array nesting text blocks) to plain text.
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((c) => (c as Record<string, unknown>)?.type === "text" ? String((c as Record<string, unknown>).text ?? "") : JSON.stringify(c)).join("\n");
  }
  return content == null ? "" : JSON.stringify(content);
}

// Harness-injected user text (sentinels) vs. the author's own words — tag them so a skim can tell.
// Mirrors the engine's own exclusion set (latestAuthorAsk): [auto-continue], [force-commit], and the
// render→verify injection whose sentinel is the literal "🔎 AUTO-VERIFY" (verify.ts VERIFY_SENTINEL).
const SENTINEL = /^(\[(auto-continue|force-commit)\]|🔎 AUTO-VERIFY)/i;

// One content block → readable line(s): text verbatim, one-liners for tool blocks. Shared by the
// input flattener and the full-completion (output_json) view.
function blockLines(b: Record<string, unknown>): string {
  const t = String(b.type ?? "");
  if (t === "text") return String(b.text ?? "");
  if (t === "tool_use") return `⚙ tool_use · ${String(b.name)} ${JSON.stringify(b.input) ?? ""}`;
  if (t === "tool_result") return `↩ tool_result (${String(b.tool_use_id)}):\n${resultText(b.content)}`;
  if (t === "thinking" || t === "redacted_thinking") return `🧠 ${String(b.thinking ?? "(redacted)")}`;
  return JSON.stringify(b);
}

// Flatten a logged `input` messages array into the readable "what the model actually read" view —
// role dividers + block lines. Raw JSON stays available beside it.
function flattenInput(input: unknown): string {
  if (!Array.isArray(input)) return "";
  const out: string[] = [];
  for (const m of input as Record<string, unknown>[]) {
    out.push(`━━━━━ ${String(m.role ?? "?").toUpperCase()} ━━━━━`);
    const content = m.content;
    if (typeof content === "string") { out.push(content); continue; }
    if (!Array.isArray(content)) { out.push(JSON.stringify(content)); continue; }
    for (const b of content as Record<string, unknown>[]) out.push(blockLines(b));
  }
  return out.join("\n\n");
}

// Flatten a completion's content block array (output_json) — the FULL completion incl. tool calls,
// where the `output` column is text-only.
function flattenBlocks(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return (content as Record<string, unknown>[]).map(blockLines).join("\n\n");
}

// One tool CALL as a single skimmable row: name + compact input + result preview, one line collapsed;
// expanding shows the full input and the full paired result together (the result lives in the NEXT
// transcript message, but reading call→result as one unit is what makes the trace inspectable).
const TOOL_TONE: Record<string, string> = {
  propose_node_ops: "text-amber-600 dark:text-amber-400", propose_prose_render: "text-amber-600 dark:text-amber-400",
  propose_expansion: "text-amber-600 dark:text-amber-400", propose_options: "text-amber-600 dark:text-amber-400",
  ask_author: "text-rose-600 dark:text-rose-400", finish: "text-emerald-600 dark:text-emerald-400",
  update_vision: "text-amber-600 dark:text-amber-400",
};
function ToolRow({ b, result }: { b: Record<string, unknown>; result: string | undefined }) {
  const name = String(b.name ?? "?");
  const tone = TOOL_TONE[name] ?? "text-violet-600 dark:text-violet-400";
  const preview = result === undefined ? "(no result in transcript)" : compactJson(result, 90);
  return (
    <details className="my-0.5">
      <summary className="cursor-pointer select-none font-mono text-[11px] leading-5 whitespace-nowrap overflow-hidden text-ellipsis hover:bg-accent/40 rounded px-1 -mx-1">
        <span className={`font-semibold ${tone}`}>{name}</span>
        <span className="text-muted-foreground"> {compactJson(b.input, 100)}</span>
        <span className="text-cyan-700 dark:text-cyan-500"> → {preview}</span>
      </summary>
      <div className="ml-3 border-l-2 border-violet-400/40 pl-2 py-0.5">
        <div className="text-[10px] font-mono text-muted-foreground">{String(b.id ?? "")}</div>
        <Json label="input" value={b.input} open={JSON.stringify(b.input ?? "").length < 800} />
        {result !== undefined && <Json label={`result (${result.length.toLocaleString()} chars)`} value={result} open={result.length < 1200} />}
      </div>
    </details>
  );
}

// The banner at the top of every cluster: WHO triggered it (author vs the harness's auto-accept
// loop) and the full trigger message itself — the author's words, the apply-ack, and any harness
// text (e.g. the AUTO-VERIFY verdict) injected alongside it. This card CONSUMES the cluster's first
// user message; renderMessage skips it to avoid double-rendering.
function TriggerCard({ kind, label, msg, index }: { kind: "ask" | "answer" | "auto-resume" | "mid"; label: string; msg: Record<string, unknown> | undefined; index: number }) {
  const isUser = msg?.role === "user" && Array.isArray(msg?.content);
  const blocks = isUser ? (msg!.content as Record<string, unknown>[]) : [];
  const harnessTexts = blocks.filter((b) => b.type === "text" && SENTINEL.test(String(b.text ?? "").trim())).map((b) => String(b.text));
  const results = blocks.filter((b) => b.type === "tool_result");
  const ack = results.find((b) => /^✓ /.test(resultText(b.content)));
  const hiddenResults = Math.max(0, results.length - (ack ? 1 : 0) - (kind === "answer" ? 1 : 0));
  const author = kind === "ask" || kind === "answer";
  const tone = author ? "border-emerald-400/60 bg-emerald-500/[0.05]" : kind === "auto-resume" ? "border-amber-400/60 bg-amber-500/[0.05]" : "border-zinc-400/40 bg-muted/30";
  const whoTone = author ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400";
  const who = kind === "ask" ? "AUTHOR — typed a new message"
    : kind === "answer" ? "AUTHOR — answered the agent's parked question"
    : kind === "auto-resume" ? "HARNESS — auto-accept: the browser applied the staged change and resumed the run"
    : "UNKNOWN — slice starts mid-cluster (its trigger was archived or compacted away)";
  // For auto-resume the honest trigger text is the ack the resumed model call reads first.
  const triggerText = kind === "auto-resume" ? (ack ? resultText(ack.content) : label) : label;
  return (
    <div className={`rounded border-2 mb-2 px-2.5 py-1.5 ${tone}`}>
      <div className="text-[10px] font-mono mb-0.5">
        <span className="text-muted-foreground">{isUser ? `[${index}] ` : ""}triggered by </span>
        <span className={`font-semibold ${whoTone}`}>{who}</span>
      </div>
      {kind !== "mid" && <div className="whitespace-pre-wrap text-[12.5px] leading-relaxed">{triggerText}</div>}
      {harnessTexts.map((t, j) => (
        <details key={j} open={t.length < 900} className="mt-1.5">
          <summary className="cursor-pointer select-none text-[11px] font-mono text-amber-600 dark:text-amber-400">+ harness injected alongside the trigger ({t.length.toLocaleString()} chars)</summary>
          <div className="whitespace-pre-wrap text-[12.5px] leading-relaxed mt-1 border-l-2 border-amber-400/40 pl-2">{t}</div>
        </details>
      ))}
      {hiddenResults > 0 && <div className="mt-1 text-[10px] font-mono text-muted-foreground">+{hiddenResults} tool result{hiddenResults === 1 ? "" : "s"} answering the previous cluster's calls — shown on its call rows</div>}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function StudioDevPage() {
  const { bookSlug } = useParams();
  const bookId = getNumericId(bookSlug);
  const [bookName, setBookName] = useState("");
  const [runs, setRuns] = useState<RunLite[]>([]);
  const [sessions, setSessions] = useState<SessionLite[]>([]);
  const [calls, setCalls] = useState<CallLite[]>([]);
  const [loading, setLoading] = useState(true);

  // Selection: a run, an archived session, or the all-calls ledger.
  const [sel, setSel] = useState<{ type: "run" | "session" | "calls"; id: number } | null>(null);
  const [row, setRow] = useState<Row | null>(null); // the selected run/session, fully hydrated
  const [rowLoading, setRowLoading] = useState(false);
  const [fnFilter, setFnFilter] = useState<string>("all");
  const [detailCall, setDetailCall] = useState<CallLite | null>(null); // modal
  const [detailHeavy, setDetailHeavy] = useState<CallHeavy | null>(null);

  const refetchAll = useCallback(async () => {
    const [b, r, s, c] = await Promise.all([
      supabase.from("books").select("name").eq("id", bookId).maybeSingle(),
      supabase.from(RUNS).select(RUN_LIST_COLS).eq("book_id", bookId).order("updated_at", { ascending: false }),
      supabase.from(SESSIONS).select(SESSION_LIST_COLS).eq("book_id", bookId).order("ended_at", { ascending: false }),
      // Newest first, capped — a long build logs thousands of calls; the cap keeps the ledger honest
      // about being a window (the count in the header shows the true total via count:'exact').
      supabase.from(AI_CALLS).select(CALL_LIST_COLS, { count: "exact" }).eq("book_id", bookId).order("id", { ascending: false }).limit(500),
    ]);
    setBookName((b.data as { name?: string } | null)?.name ?? "");
    setRuns((r.data ?? []) as RunLite[]);
    setSessions((s.data ?? []) as SessionLite[]);
    setCalls((c.data ?? []) as CallLite[]);
    setCallCount(c.count ?? (c.data?.length ?? 0));
    setLoading(false);
  }, [bookId]);
  const [callCount, setCallCount] = useState(0);

  // Realtime = signal only → debounced authoritative refetch (ai_calls + runs are both published).
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    refetchAll();
    const nudge = () => { clearTimeout(debounceRef.current); debounceRef.current = setTimeout(refetchAll, 400); };
    const ch = supabase.channel(`dev-inspector-${bookId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ai_calls", filter: `book_id=eq.${bookId}` }, nudge)
      .on("postgres_changes", { event: "*", schema: "public", table: "book_agent_runs", filter: `book_id=eq.${bookId}` }, nudge)
      .subscribe();
    return () => { clearTimeout(debounceRef.current); supabase.removeChannel(ch); };
  }, [bookId, refetchAll]);

  // Default selection: the live thread (newest run), once loaded.
  useEffect(() => {
    if (!loading && !sel) setSel(runs.length ? { type: "run", id: runs[0].id } : { type: "calls", id: 0 });
  }, [loading, sel, runs]);

  // Hydrate the selected run/session in full (transcript/steps/proposals are the heavy part).
  useEffect(() => {
    if (!sel || sel.type === "calls") { setRow(null); return; }
    let dead = false;
    setRowLoading(true);
    supabase.from(sel.type === "run" ? RUNS : SESSIONS).select("*").eq("id", sel.id).maybeSingle()
      .then(({ data }) => { if (!dead) { setRow((data as Row) ?? null); setRowLoading(false); } });
    return () => { dead = true; };
  }, [sel, runs.find((r) => r.id === sel?.id)?.updated_at]); // re-hydrate when the live run advances

  // Detail modal: fetch the heavy blobs on demand.
  useEffect(() => {
    if (!detailCall) { setDetailHeavy(null); return; }
    let dead = false;
    supabase.from(AI_CALLS).select(CALL_HEAVY_COLS).eq("id", detailCall.id).maybeSingle()
      .then(({ data }) => { if (!dead) setDetailHeavy((data as CallHeavy) ?? null); });
    return () => { dead = true; };
  }, [detailCall]);

  // Calls belonging to the selection. A run's calls carry task_id = run id. An archived SESSION has no
  // calls of its own — its turns ran on the thread before archiving — so use task_id = thread_id capped
  // at the archive time (ISO strings from the same source compare lexicographically).
  const selCalls = useMemo(() => {
    if (!sel || sel.type === "calls" || !row) return [];
    const threadId = sel.type === "run" ? sel.id : Number(row.thread_id ?? 0);
    const cutoff = sel.type === "session" ? String(row.ended_at ?? "") : "";
    return calls
      .filter((c) => c.task_table === "book_agent_runs" && c.task_id === threadId && (!cutoff || c.created_at <= cutoff))
      .sort((a, b) => a.id - b.id);
  }, [calls, sel, row]);
  // Turn pairing: each *successful* main-loop call ('book-agent', done) produced one assistant message.
  // Retries, acks, titles and judges don't add assistant messages; they show in the calls table instead.
  const mainCalls = useMemo(() => selCalls.filter((c) => c.fn === "book-agent" && c.status === "done"), [selCalls]);

  // The slice window: a thread's transcript RESETS on every "New chat" (the slice moves to
  // book_agent_sessions), so transcript_index is unique only within a slice — scope the exact join
  // to calls between this slice's session boundaries.
  const sliceCalls = useMemo(() => {
    if (!sel || sel.type === "calls") return [];
    const threadId = sel.type === "run" ? sel.id : Number((row as Row | null)?.thread_id ?? 0);
    const threadSessions = sessions.filter((s) => s.thread_id === threadId);
    const upper = sel.type === "session" ? String((row as Row | null)?.ended_at ?? "") : "";
    const lower = sel.type === "run"
      ? threadSessions.reduce((a, s) => (s.ended_at > a ? s.ended_at : a), "")
      : threadSessions.filter((s) => s.ended_at < upper).reduce((a, s) => (s.ended_at > a ? s.ended_at : a), "");
    return mainCalls.filter((c) => (!lower || c.created_at > lower) && (!upper || c.created_at <= upper));
  }, [sel, row, sessions, mainCalls]);

  const fns = useMemo(() => ["all", ...new Set(calls.map((c) => c.fn))], [calls]);
  const ledger = useMemo(() => (fnFilter === "all" ? calls : calls.filter((c) => c.fn === fnFilter)), [calls, fnFilter]);

  const transcript = (row?.transcript ?? []) as Record<string, unknown>[];
  const steps = (row?.steps ?? []) as Record<string, unknown>[];

  // Assistant-message ordinal per transcript index, for turn pairing.
  const asstOrdinal = useMemo(() => {
    const m = new Map<number, number>();
    let n = 0;
    transcript.forEach((msg, i) => { if (msg.role === "assistant") m.set(i, n++); });
    return m;
  }, [transcript]);

  // tool_use_id → flattened result text, across the whole transcript — so each call row can show its
  // paired result inline instead of making the reader chase the next message.
  const resultById = useMemo(() => {
    const m = new Map<string, string>();
    for (const msg of transcript) {
      if (msg.role !== "user" || !Array.isArray(msg.content)) continue;
      for (const b of msg.content as Record<string, unknown>[]) {
        if (b?.type === "tool_result" && b.tool_use_id) m.set(String(b.tool_use_id), resultText(b.content));
      }
    }
    return m;
  }, [transcript]);

  // Call↔turn join. EXACT for rows carrying transcript_index (recorded at emit time by advance.ts —
  // the systematic fix; migration 20260723120000): message index → newest matching call in the slice
  // window. LEGACY fallback for pre-index rows: backward index pairing (newest call ↔ newest turn),
  // which is best-effort and can mis-chip when a call produced no message in this slice.
  const msgIndexByOrdinal = useMemo(() => new Map([...asstOrdinal.entries()].map(([msgIdx, ord]) => [ord, msgIdx])), [asstOrdinal]);
  const exactByMsgIndex = useMemo(() => {
    const m = new Map<number, CallLite>();
    for (const c of sliceCalls) {
      if (c.transcript_index == null) continue;
      const prev = m.get(c.transcript_index);
      if (!prev || c.id > prev.id) m.set(c.transcript_index, c); // retries: the newest attempt won
    }
    return m;
  }, [sliceCalls]);
  const callForTurn = (turnIdx: number): CallLite | undefined => {
    const msgIdx = msgIndexByOrdinal.get(turnIdx);
    const exact = msgIdx !== undefined ? exactByMsgIndex.get(msgIdx) : undefined;
    if (exact) return exact;
    // Legacy fallback (pre-index rows), per turn so mixed-era threads keep their old chips. Runs
    // over the SLICE window, not the whole thread — the thread-wide arithmetic was the mis-chip bug.
    return sliceCalls[sliceCalls.length - asstOrdinal.size + turnIdx];
  };

  // ── Turn-clusters ──
  // There is no cluster id anywhere in the schema — a cluster is implicit, exactly as the engine
  // treats it (advance.ts walks steps back to the last user/answer; latestAuthorAsk skips tool_result
  // and sentinel messages). Reconstruct it here the same way: a cluster STARTS at real author input —
  // a user message with non-sentinel typed text (sendAgentMessage), or a HUMAN tool_result answering a
  // parked ask_author (answerAgent; auto mode's instant synthetic answer starts with "AUTONOMOUS mode"
  // and is NOT a boundary). A cluster also CLOSES at the auto-mode live-apply ack ("✓ Applied/STAGED…"),
  // because the run idled there and resumed via a pure status flip that appends nothing — the next
  // message begins an auto-resume cluster. Note `turns` (the column) can span clusters: it only resets
  // on a fresh typed message, not on answer/resume — that's why we don't use it here.
  interface Cluster { start: number; end: number; kind: "ask" | "answer" | "auto-resume" | "mid"; label: string; served?: string }
  const clusters = useMemo<Cluster[]>(() => {
    const askIds = new Set<string>();
    for (const m of transcript) {
      if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
      for (const b of m.content as Record<string, unknown>[]) if (b?.type === "tool_use" && b.name === "ask_author") askIds.add(String(b.id));
    }
    // The proposal the previous cluster staged — its own `summary` is the honest description of what
    // the auto-apply just committed, far better than the generic "✓ Render STAGED" ack wording.
    const proposalSummaryBefore = (i: number): string => {
      for (let k = i - 1; k >= 0; k--) {
        const m = transcript[k];
        if (m?.role !== "assistant" || !Array.isArray(m.content)) continue;
        for (const b of m.content as Record<string, unknown>[]) {
          if (b?.type === "tool_use" && ["propose_node_ops", "propose_prose_render", "propose_expansion"].includes(String(b.name))) {
            const summary = String((b.input as { summary?: unknown } | undefined)?.summary ?? "").trim();
            const what = String(b.name).replace("propose_node_ops", "node ops").replace("propose_prose_render", "prose render").replace("propose_expansion", "expansion");
            return summary ? `${what} “${summary}”` : what;
          }
        }
        return ""; // nearest assistant message staged nothing — give up
      }
      return "";
    };
    const out: Cluster[] = [];
    let cur: Cluster | null = null;
    let lastAsk = ""; // the standing author ask an auto-resume cluster is still serving
    const push = () => { if (cur) out.push(cur); cur = null; };
    transcript.forEach((m, i) => {
      let boundary: { kind: Cluster["kind"]; label: string } | null = null;
      if (m.role === "user" && Array.isArray(m.content)) {
        const blocks = m.content as Record<string, unknown>[];
        const texts = blocks.filter((b) => b?.type === "text").map((b) => String(b.text ?? "").trim()).filter((t) => t && !SENTINEL.test(t));
        if (texts.length) boundary = { kind: "ask", label: texts.join(" ") };
        else {
          const ans = blocks.find((b) => b?.type === "tool_result" && askIds.has(String(b.tool_use_id)) && !resultText(b.content).startsWith("AUTONOMOUS mode"));
          if (ans) boundary = { kind: "answer", label: resultText(ans.content) };
          else {
            // The auto-mode apply ack STARTS the resume cluster (it is the trigger evidence: the client
            // applied the staged change and flipped the run back to running — the status flip itself
            // appends nothing, so this ack — often sharing a message with the injected AUTO-VERIFY
            // verdict — is the first thing the resumed model call actually reads).
            const ack = blocks.find((b) => b?.type === "tool_result" && /^✓ (Applied|Render STAGED|Expansion STAGED)/.test(resultText(b.content)));
            if (ack) {
              const applied = proposalSummaryBefore(i);
              boundary = { kind: "auto-resume", label: applied ? `applied ${applied} → resumed` : `${resultText(ack.content).split(".")[0]} → applied by client → resumed` };
            }
          }
        }
      }
      if (boundary) {
        push();
        if (boundary.kind === "ask") lastAsk = boundary.label;
        cur = { start: i, end: i, ...boundary, served: boundary.kind === "auto-resume" && lastAsk ? lastAsk : undefined };
      } else if (!cur) {
        cur = { start: i, end: i, kind: "mid", label: "(transcript begins mid-cluster — earlier messages archived or compacted away)", served: lastAsk || undefined };
      }
      cur.end = i;
    });
    push();
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcript]);

  // What a cluster PRODUCED: its terminal tool (or reply / parked ask / applied-live), read from the end.
  const TERMINALS = ["finish", "propose_node_ops", "propose_prose_render", "propose_expansion", "propose_options"];
  const clusterOutcome = (cl: Cluster): string => {
    // The apply-ack now BEGINS the next cluster, so "was this staged change applied live?" is read
    // from the message just past this cluster's end.
    const next = transcript[cl.end + 1];
    const appliedLive = next?.role === "user" && Array.isArray(next.content) &&
      (next.content as Record<string, unknown>[]).some((b) => b?.type === "tool_result" && /^✓ /.test(resultText(b.content)));
    for (let i = cl.end; i >= cl.start; i--) {
      const m = transcript[i];
      if (m?.role !== "assistant" || !Array.isArray(m.content)) continue;
      const names = (m.content as Record<string, unknown>[]).filter((b) => b?.type === "tool_use").map((b) => String(b.name));
      const term = names.find((n) => TERMINALS.includes(n));
      if (term) return appliedLive ? `${term} → applied live` : term;
      if (names.includes("ask_author")) return "ask (parked)";
      if (!names.length) return "reply";
      return `…${names[names.length - 1]}`; // ended mid-loop (error / cancel / still running)
    }
    return "—";
  };

  if (loading) return <div className="flex items-center justify-center min-h-screen text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> loading inspector…</div>;

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      {/* ── Header ── */}
      <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur px-4 py-2 flex items-baseline gap-3 flex-wrap">
        <span className="font-mono text-xs text-muted-foreground">dev inspector</span>
        <span className="font-semibold text-sm">{bookName || `book ${bookId}`}</span>
        <span className="font-mono text-[11px] text-muted-foreground">{runs.length} runs · {sessions.length} archived chats · {num(callCount)} llm calls</span>
        <span className="flex-1" />
        <Link to={`/books/${bookSlug}/studio/tree`} className="text-xs underline text-muted-foreground hover:text-foreground">← back to tree</Link>
      </div>

      <div className="flex" style={{ height: "calc(100vh - 41px)" }}>
        {/* ── Left: the catalogue ── */}
        <ScrollArea className="w-72 shrink-0 border-r">
          <div className="p-2 space-y-1">
            <button onClick={() => setSel({ type: "calls", id: 0 })}
              className={`w-full text-left px-2 py-1.5 rounded text-xs font-mono ${sel?.type === "calls" ? "bg-accent" : "hover:bg-accent/50"}`}>
              ALL LLM CALLS <span className="text-muted-foreground">({num(callCount)})</span>
            </button>
            <div className="pt-2 text-[10px] font-mono uppercase tracking-wide text-muted-foreground px-2">agent runs (book_agent_runs)</div>
            {runs.map((r) => (
              <button key={r.id} onClick={() => setSel({ type: "run", id: r.id })}
                className={`w-full text-left px-2 py-1.5 rounded ${sel?.type === "run" && sel.id === r.id ? "bg-accent" : "hover:bg-accent/50"}`}>
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="font-mono text-muted-foreground">#{r.id}</span>
                  <StatusChip s={r.status} />
                  {r.context_auto && <span className="text-[10px] font-mono text-amber-600 dark:text-amber-400">∞auto</span>}
                  <span className="font-mono text-[10px] text-muted-foreground ml-auto">{r.turns}t</span>
                </div>
                <div className="text-[11px] truncate">{r.title ?? `(${r.kind})`}</div>
                <div className="text-[10px] font-mono text-muted-foreground">{ts(r.updated_at)}</div>
              </button>
            ))}
            {sessions.length > 0 && <div className="pt-2 text-[10px] font-mono uppercase tracking-wide text-muted-foreground px-2">archived chats (book_agent_sessions)</div>}
            {sessions.map((s) => (
              <button key={s.id} onClick={() => setSel({ type: "session", id: s.id })}
                className={`w-full text-left px-2 py-1.5 rounded ${sel?.type === "session" && sel.id === s.id ? "bg-accent" : "hover:bg-accent/50"}`}>
                <div className="text-xs"><span className="font-mono text-muted-foreground">#{s.id}</span> {s.title ?? "(untitled chat)"}</div>
                <div className="text-[10px] font-mono text-muted-foreground">{ts(s.ended_at)}</div>
              </button>
            ))}
          </div>
        </ScrollArea>

        {/* ── Right: the inspector ── */}
        <ScrollArea className="flex-1">
          <div className="p-4 max-w-5xl">
            {sel?.type === "calls" && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="text-sm font-semibold">All LLM calls</h2>
                  <select value={fnFilter} onChange={(e) => setFnFilter(e.target.value)} className="text-xs font-mono bg-muted rounded px-1.5 py-1 border">
                    {fns.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                  <span className="text-[11px] text-muted-foreground font-mono">{ledger.length} shown · newest first{callCount > calls.length ? ` · window of ${num(callCount)}` : ""}</span>
                </div>
                <CallTable calls={ledger} onOpen={setDetailCall} showTask />
              </div>
            )}

            {sel && sel.type !== "calls" && (rowLoading || !row ? (
              <div className="text-muted-foreground text-sm flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> hydrating row…</div>
            ) : (
              <div className="space-y-5">
                {/* Overview: every scalar column, nothing hidden */}
                <div>
                  <h2 className="text-sm font-semibold mb-1.5">{sel.type === "run" ? "book_agent_runs" : "book_agent_sessions"} #{String(row.id)}</h2>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono text-muted-foreground">
                    {Object.entries(row).filter(([, v]) => v === null || typeof v !== "object").map(([k, v]) => {
                      // Long strings (context_objective etc.) live in ROW PAYLOADS below — keep chips skimmable.
                      const s = String(v ?? "∅");
                      return (
                        <span key={k} title={s.length > 80 ? s : undefined}><span className="opacity-60">{k}=</span>{k === "status" ? <StatusChip s={String(v)} /> : <span className="text-foreground">{s.length > 80 ? s.slice(0, 80) + "…" : s}</span>}</span>
                      );
                    })}
                  </div>
                  {typeof row.error === "string" && row.error && <div className="mt-1 text-xs text-red-500 whitespace-pre-wrap">{row.error}</div>}
                </div>

                {/* Turn-by-turn transcript — the heart of the view */}
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">transcript · {clusters.length} turn-cluster{clusters.length === 1 ? "" : "s"} · {asstOrdinal.size} model turns · {transcript.length} messages</h3>
                  {sel.type === "run" && sessions.some((s) => s.thread_id === sel.id) && (
                    <div className="mb-2 px-2 py-1 rounded border border-dashed border-amber-400/50 bg-amber-500/[0.04] text-[11px] font-mono text-amber-700 dark:text-amber-400">
                      ⚠ this transcript is only the CURRENT slice — every "New chat" archived the earlier turns to book_agent_sessions:
                      {" "}{sessions.filter((s) => s.thread_id === sel.id).length} archived chat{sessions.filter((s) => s.thread_id === sel.id).length === 1 ? "" : "s"} of this thread in the left rail hold the rest of its history.
                    </div>
                  )}
                  {(() => { const renderMessage = (msg: Record<string, unknown>, i: number, isClusterStart = false) => {
                    const role = String(msg.role ?? "?");
                    const blocks = Array.isArray(msg.content) ? (msg.content as Record<string, unknown>[]) : [{ type: "text", text: String(msg.content ?? "") }];
                    const turnIdx = asstOrdinal.get(i);
                    const call = turnIdx !== undefined ? callForTurn(turnIdx) : undefined;

                    // USER messages: tool_results are folded into their call rows above, so render only
                    // the plain-text blocks (the author's ask, or a mid-cluster harness nudge). The
                    // cluster's FIRST user message is consumed whole by TriggerCard — skip it here.
                    if (role === "user") {
                      if (isClusterStart) return null;
                      const texts = blocks.filter((b) => b.type === "text" && String(b.text ?? "").trim());
                      if (!texts.length) return null;
                      return texts.map((b, j) => {
                        const text = String(b.text ?? "");
                        const nudge = SENTINEL.test(text);
                        return (
                          <div key={`${i}-${j}`} className={`rounded border mb-2 px-2.5 py-1.5 ${nudge ? "border-dashed border-amber-400/50 bg-amber-500/[0.04]" : "border-emerald-400/40 bg-emerald-500/[0.04]"}`}>
                            <div className="text-[10px] font-mono text-muted-foreground mb-0.5">
                              [{i}] {nudge ? <span className="text-amber-600 dark:text-amber-400">harness nudge</span> : <span className="text-emerald-600 dark:text-emerald-400 font-semibold">user</span>}
                            </div>
                            <div className="whitespace-pre-wrap text-[12.5px] leading-relaxed">{text}</div>
                          </div>
                        );
                      });
                    }

                    // ASSISTANT messages = model turns: narration prose stays visible; thinking collapses;
                    // each tool_use is a one-line call→result row.
                    const thinking = blocks.filter((b) => b.type === "thinking" || b.type === "redacted_thinking");
                    const texts = blocks.filter((b) => b.type === "text" && String(b.text ?? "").trim());
                    const tools = blocks.filter((b) => b.type === "tool_use");
                    const other = blocks.filter((b) => !["text", "thinking", "redacted_thinking", "tool_use"].includes(String(b.type)));
                    return (
                      <div key={i} className="rounded border mb-2 border-violet-300/40 bg-violet-500/[0.03]">
                        <div className="px-2 py-1 flex items-center gap-2 border-b border-violet-300/30 text-[11px] font-mono">
                          <span className="text-muted-foreground">[{i}]</span>
                          <span className="text-violet-600 dark:text-violet-400 font-semibold">turn {(turnIdx ?? 0) + 1}</span>
                          {tools.length > 0 && (
                            <span className="text-muted-foreground truncate">{tools.map((t) => String(t.name)).join(" · ")}</span>
                          )}
                          {call ? (
                            <button onClick={() => setDetailCall(call)} title="Inspect this turn's full LLM context: system prompt, exact input messages, output, artifacts"
                              className="ml-auto shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-muted hover:bg-accent">
                              #{call.id} · {call.model ?? "?"}{call.provider ? ` @${call.provider}` : ""} · {num(call.input_tokens)}→{num(call.output_tokens)} · {num(call.latency_ms)}ms · full context ▸
                            </button>
                          ) : (
                            <span className="ml-auto shrink-0 text-[10px] px-1.5 py-0.5 rounded text-muted-foreground border border-dashed"
                              title="No ai_calls row paired to this turn — it may be outside the newest-500 fetch window, or logged before call↔turn linkage. See the calls table below.">
                              call ∅
                            </span>
                          )}
                        </div>
                        <div className="px-2.5 py-1.5">
                          {thinking.map((b, j) => <Json key={`th${j}`} label="🧠 thinking" value={b.thinking ?? "(redacted)"} />)}
                          {texts.map((b, j) => <div key={`tx${j}`} className="whitespace-pre-wrap text-[12.5px] leading-relaxed mb-1">{String(b.text)}</div>)}
                          {tools.map((b, j) => <ToolRow key={`tu${j}`} b={b} result={resultById.get(String(b.id ?? ""))} />)}
                          {other.map((b, j) => <Json key={`ot${j}`} label={String(b.type)} value={b} />)}
                        </div>
                      </div>
                    );
                  };
                  // One collapsible section per turn-cluster: author input → the burst of turns it
                  // caused → what it produced. Only the newest cluster starts open; older headers
                  // summarize (trigger · turns · outcome · aggregate tokens/latency) for the skim.
                  return clusters.map((cl, ci) => {
                    const turnIdxs: number[] = [];
                    for (let k = cl.start; k <= cl.end; k++) { const t = asstOrdinal.get(k); if (t !== undefined) turnIdxs.push(t); }
                    const clCalls = turnIdxs.map(callForTurn).filter((c): c is CallLite => !!c);
                    const tokIn = clCalls.reduce((a, c) => a + (c.input_tokens ?? 0), 0);
                    const tokOut = clCalls.reduce((a, c) => a + (c.output_tokens ?? 0), 0);
                    const msSum = clCalls.reduce((a, c) => a + (c.latency_ms ?? 0), 0);
                    const outcome = clusterOutcome(cl);
                    const kindTone = cl.kind === "ask" ? "text-emerald-600 dark:text-emerald-400" : cl.kind === "answer" ? "text-teal-600 dark:text-teal-400" : "text-amber-600 dark:text-amber-400";
                    return (
                      <details key={ci} open={ci === clusters.length - 1} className="mb-2 rounded border">
                        <summary className="cursor-pointer select-none px-2 py-1.5 font-mono text-[11px] leading-5 hover:bg-accent/40 flex items-baseline gap-x-2 flex-wrap">
                          <span className="font-semibold">cluster {ci + 1}/{clusters.length}</span>
                          <span className={kindTone} title={
                            cl.kind === "ask" ? "Triggered by the author's typed message (sendAgentMessage — the only trigger that resets the turns counter)."
                            : cl.kind === "answer" ? "Triggered by the author answering a parked ask_author question (answerAgent — turns do NOT reset)."
                            : cl.kind === "auto-resume" ? "Triggered by the auto-accept loop: the previous cluster STAGED a proposal and went idle; the author's browser applied it (node ops / streamed render) and resumed the run with a pure status flip. 'STAGED' in the ack means staged-then-auto-applied, not pending."
                            : "The stored transcript begins mid-cluster — its trigger message was archived or compacted away."
                          }>{cl.kind}</span>
                          <span className="text-muted-foreground truncate max-w-[38%]" title={cl.label}>“{cl.label.slice(0, 90)}{cl.label.length > 90 ? "…" : ""}”</span>
                          {cl.served && <span className="text-muted-foreground/70 truncate max-w-[22%]" title={cl.served}>serving “{cl.served.slice(0, 50)}{cl.served.length > 50 ? "…" : ""}”</span>}
                          <span>{turnIdxs.length || "0"} turn{turnIdxs.length === 1 ? "" : "s"}</span>
                          <span className="text-violet-600 dark:text-violet-400">→ {outcome}</span>
                          <span className="ml-auto text-muted-foreground">{tokIn || tokOut ? `${num(tokIn)}→${num(tokOut)} tok · ` : ""}{msSum ? `${num(msSum)}ms` : ""}</span>
                        </summary>
                        <div className="px-2 pt-2 border-t">
                          <TriggerCard kind={cl.kind} label={cl.label} msg={transcript[cl.start] as Record<string, unknown> | undefined} index={cl.start} />
                          {transcript.slice(cl.start, cl.end + 1).map((msg, off) => renderMessage(msg as Record<string, unknown>, cl.start + off, off === 0))}
                        </div>
                      </details>
                    );
                  }); })()}
                </div>

                {/* Every call attached to this run/thread, incl. retries / acks / titles / judges */}
                {selCalls.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                      {sel.type === "run" ? `llm calls for this run · ${selCalls.length}` : `llm calls on this thread up to the archive time · ${selCalls.length}`}
                    </h3>
                    <CallTable calls={selCalls} onOpen={setDetailCall} />
                  </div>
                )}

                {/* The rest of the row, nothing excluded */}
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">row payloads</h3>
                  <Json label={`steps (${steps.length})`} value={row.steps} />
                  <Json label="proposals" value={row.proposals} />
                  <Json label="pending (parked question)" value={row.pending} />
                  <Json label="evaluation" value={row.evaluation} />
                  <Json label="context_attached_ids" value={row.context_attached_ids} />
                  <Json label="context_objective" value={row.context_objective} />
                  <Json label="context_analysis" value={row.context_analysis} />
                  <Json label="raw row (everything)" value={row} />
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* ── Call detail: the full prompt/completion ── */}
      <Dialog open={!!detailCall} onOpenChange={(o) => !o && setDetailCall(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">
              ai_calls #{detailCall?.id} · {detailCall?.fn} <StatusChip s={detailCall?.status ?? ""} />
            </DialogTitle>
          </DialogHeader>
          {detailCall && (
            <div className="space-y-1 text-[11px] font-mono">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                <span>at={ts(detailCall.created_at)}</span>
                <span>model={detailCall.model ?? "∅"}</span>
                <span>provider={detailCall.provider ?? "∅"}</span>
                <span>source={detailCall.source}</span>
                <span>operation={detailCall.operation ?? "∅"}</span>
                <span>node={detailCall.node_id ?? "∅"}</span>
                <span>task={detailCall.task_table ?? "∅"}#{detailCall.task_id ?? "∅"}</span>
                <span>tokens {num(detailCall.input_tokens)}→{num(detailCall.output_tokens)}</span>
                <span>cache_read={num(detailCall.cache_read_tokens)}{detailCall.cache_write_tokens != null ? ` cache_write=${num(detailCall.cache_write_tokens)}` : ""}</span>
                <span>{num(detailCall.latency_ms)}ms</span>
                <span>stop={detailCall.stop_reason ?? "∅"}</span>
              </div>
              {detailCall.error && <div className="text-red-500 whitespace-pre-wrap">{detailCall.error}</div>}
              {!detailHeavy ? (
                <div className="text-muted-foreground flex items-center gap-2 py-3"><Loader2 className="h-3 w-3 animate-spin" /> fetching prompt + completion…</div>
              ) : (
                <div className="pt-1">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground pt-1">the whole context, as sent</div>
                  <Json label="1 · system prompt" value={detailHeavy.system} />
                  <Json label="2 · messages — readable (what the model actually read, in order)" value={flattenInput(detailHeavy.input)} />
                  <Json label="2 · messages — raw JSON (exact wire shape, incl. cache_control)" value={detailHeavy.input} />
                  {detailHeavy.output_json != null
                    ? <>
                        <Json label="3 · output — full completion (text + tool calls, in order)" value={flattenBlocks(detailHeavy.output_json)} open />
                        <Json label="3 · output — raw blocks JSON" value={detailHeavy.output_json} />
                      </>
                    : <Json label="3 · output (text only — full blocks logged from 2026-07-23; older rows lose pure-tool_use turns)" value={detailHeavy.output} open />}
                  <Json label="artifacts (prompt provenance — labeled inputs that composed this call)" value={detailHeavy.artifacts} />
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Dense call table shared by the run view and the all-calls ledger.
function CallTable({ calls, onOpen, showTask }: { calls: CallLite[]; onOpen: (c: CallLite) => void; showTask?: boolean }) {
  return (
    <div className="border rounded overflow-x-auto">
      <table className="w-full text-[11px] font-mono">
        <thead className="text-muted-foreground text-left">
          <tr className="border-b bg-muted/40">
            <th className="px-2 py-1">id</th><th className="px-2 py-1">time</th><th className="px-2 py-1">fn</th>
            {showTask && <th className="px-2 py-1">task</th>}
            <th className="px-2 py-1">status</th><th className="px-2 py-1">model @ provider</th>
            <th className="px-2 py-1 text-right">in→out tok</th><th className="px-2 py-1 text-right" title="prompt-cache hit tokens (of input)">cached</th><th className="px-2 py-1 text-right">ms</th><th className="px-2 py-1">stop</th>
          </tr>
        </thead>
        <tbody>
          {calls.map((c) => (
            <tr key={c.id} onClick={() => onOpen(c)} className="border-b last:border-0 cursor-pointer hover:bg-accent/50">
              <td className="px-2 py-1 text-muted-foreground">#{c.id}</td>
              <td className="px-2 py-1 whitespace-nowrap">{ts(c.created_at)}</td>
              <td className="px-2 py-1">{c.fn}{c.operation ? <span className="text-muted-foreground">·{c.operation}</span> : null}</td>
              {showTask && <td className="px-2 py-1 text-muted-foreground">{c.task_table ? `${c.task_table.replace("book_", "")}#${c.task_id}` : "—"}</td>}
              <td className="px-2 py-1"><StatusChip s={c.status} />{c.error && <span className="text-red-500 ml-1" title={c.error}>!</span>}</td>
              <td className="px-2 py-1">{c.model ?? "—"}{c.provider ? <span className="text-muted-foreground"> @{c.provider}</span> : null}</td>
              <td className="px-2 py-1 text-right">{num(c.input_tokens)}→{num(c.output_tokens)}</td>
              <td className="px-2 py-1 text-right">{c.cache_read_tokens != null && c.input_tokens ? `${num(c.cache_read_tokens)} (${Math.round((c.cache_read_tokens / c.input_tokens) * 100)}%)` : num(c.cache_read_tokens)}</td>
              <td className="px-2 py-1 text-right">{num(c.latency_ms)}</td>
              <td className="px-2 py-1">{c.stop_reason ?? "—"}</td>
            </tr>
          ))}
          {calls.length === 0 && <tr><td className="px-2 py-3 text-muted-foreground" colSpan={showTask ? 9 : 8}>no calls</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
