import { useState } from "react";
import { ChevronDown, ChevronRight, Maximize2, Shield } from "lucide-react";
import type { AiCallDebug } from "@/features/dna/hooks/useLatestAiCall";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const CAP = 20000; // debug view, not a reader — cap each block so one huge turn can't jank the feed

// context.ts wraps each kind of context in its own XML tag on purpose ("XML tags reduce
// misinterpretation" — see context.ts:252) so the model can tell sections apart. We lean on that
// same contract here: split a blob into its top-level <tag note="...">…</tag> pieces and render
// each as a collapsible, colored section instead of one wall of text.
interface TaggedNode {
  type: "tag";
  tag: string;
  attrs: Record<string, string>;
  inner: string;
}
interface TextNode { type: "text"; text: string }
type ParsedNode = TaggedNode | TextNode;

const TAG_RE = /<([a-z][a-z0-9_]*)((?:\s+[\w-]+="[^"]*")*)\s*>([\s\S]*?)<\/\1>/g;
const ATTR_RE = /([\w-]+)="([^"]*)"/g;

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of raw.matchAll(ATTR_RE)) attrs[m[1]] = m[2];
  return attrs;
}

function parseTagged(text: string): ParsedNode[] {
  const nodes: ParsedNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TAG_RE)) {
    const index = m.index ?? 0;
    if (index > last) {
      const between = text.slice(last, index);
      if (between.trim()) nodes.push({ type: "text", text: between });
    }
    nodes.push({ type: "tag", tag: m[1], attrs: parseAttrs(m[2]), inner: m[3] });
    last = index + m[0].length;
  }
  if (last < text.length) {
    const rest = text.slice(last);
    if (rest.trim()) nodes.push({ type: "text", text: rest });
  }
  // No tags found at all → the whole thing is one text node (plain prose, e.g. a "next" turn or the
  // markdown system prompt), same as the old behavior.
  return nodes.length ? nodes : [{ type: "text", text }];
}

// Literal class strings (Tailwind's JIT scans source text, not runtime-built strings — a
// `border-${color}-500` template would never match anything, so every variant is spelled out).
const TAG_STYLE: Record<string, string> = {
  book_state: "border-slate-400/60 text-slate-500",
  task: "border-rose-500/60 text-rose-600",
  brief: "border-violet-500/60 text-violet-600",
  current_objective: "border-amber-500/60 text-amber-600",
  story_analysis: "border-orange-500/60 text-orange-600",
  between_scenes: "border-cyan-500/60 text-cyan-600",
  focus: "border-fuchsia-500/60 text-fuchsia-600",
  mentioned: "border-fuchsia-500/60 text-fuchsia-600",
  skill_briefs: "border-emerald-500/60 text-emerald-600",
  dna_tree: "border-sky-500/60 text-sky-600",
  book_name: "border-slate-400/60 text-slate-500",
  autonomous_mode: "border-rose-500/60 text-rose-600",
  fast_mode: "border-lime-500/60 text-lime-600",
  scope_note: "border-indigo-500/60 text-indigo-600",
};
const FALLBACK_STYLES = [
  "border-teal-500/60 text-teal-600",
  "border-pink-500/60 text-pink-600",
  "border-yellow-500/60 text-yellow-600",
  "border-blue-500/60 text-blue-600",
];
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function styleForTag(tag: string): string {
  return TAG_STYLE[tag] ?? FALLBACK_STYLES[hash(tag) % FALLBACK_STYLES.length];
}

// Renders one text blob: capped, real newlines (never JSON.stringify'd — that would re-escape
// quotes/newlines the raw prompt already has). `compact` caps height for the inline rail view;
// the fullscreen modal turns that off so the modal's own scroll is the only scrollbar.
function Block({ text, compact }: { text: string; compact: boolean }) {
  const truncated = text.length > CAP;
  const shown = truncated ? text.slice(0, CAP) : text;
  return (
    <pre
      className={`overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 text-[10px] leading-[1.5] text-[hsl(var(--pv-text-muted))] ${compact ? "max-h-64" : ""}`}
    >
      {shown}{truncated ? "\n… (truncated)" : ""}
    </pre>
  );
}

function TagSection({ node, depth, compact }: { node: TaggedNode; depth: number; compact: boolean }) {
  // Root-level tags (book_state, task) default open — they're the payload the whole panel exists
  // to show. Deeper tags default open only when short; the big reference blocks (dna_tree,
  // skill_briefs, story_analysis) start collapsed so they don't bury the smaller ones.
  const [open, setOpen] = useState(depth === 0 || node.inner.trim().length <= 1200);
  const { note, ...otherAttrs } = node.attrs;
  const otherEntries = Object.entries(otherAttrs);
  const style = styleForTag(node.tag);
  const borderClass = style.split(" ")[0];
  const textClass = style.split(" ")[1];
  return (
    <div className={`border-l-2 pl-2 ${borderClass}`}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-1 py-0.5 text-left">
        {open ? <ChevronDown className="mt-0.5 h-2.5 w-2.5 shrink-0 text-[hsl(var(--pv-text-faint))]" /> : <ChevronRight className="mt-0.5 h-2.5 w-2.5 shrink-0 text-[hsl(var(--pv-text-faint))]" />}
        <span className="min-w-0">
          <span className={`pv-mono text-[10px] font-medium ${textClass}`}>{node.tag}</span>
          {otherEntries.map(([k, v]) => (
            <span key={k} className="ml-1.5 pv-mono text-[8.5px] text-[hsl(var(--pv-text-faint))]">{k}={v}</span>
          ))}
          {note && <span className="ml-1.5 pv-serif text-[10.5px] italic text-[hsl(var(--pv-text-faint))]">— {note}</span>}
        </span>
      </button>
      {open && <div className="pb-1 pl-1"><ContentTree text={node.inner} depth={depth + 1} compact={compact} /></div>}
    </div>
  );
}

// Top-level entry: parse `text` into tag/text nodes and render each — tags become collapsible
// colored sections, plain prose falls back to a plain block (unchanged from before this rewrite).
function ContentTree({ text, depth, compact }: { text: string; depth: number; compact: boolean }) {
  const nodes = parseTagged(text);
  return (
    <div className="space-y-1.5">
      {nodes.map((n, i) =>
        n.type === "tag"
          ? <TagSection key={i} node={n} depth={depth} compact={compact} />
          : <Block key={i} text={n.text} compact={compact} />
      )}
    </div>
  );
}

function jsonBlock(value: unknown): string {
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

// tool_result content is a plain string that tool implementations build by concatenating a
// description with the node's content as a JSON.stringify'd blob (e.g. `[n_x] scene\n{"loc":...}`).
// Re-stringifying the WHOLE tool_result with jsonBlock() (the old fallback) doubles the escaping —
// that's the "\\n\\\"" soup this was reported for. Instead: find the embedded JSON object(s) with a
// brace-depth scan (respects quoted strings so a `}` inside a string doesn't end the match early),
// JSON.parse just that slice, and render it structurally; everything around it stays plain text.
function matchBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

type Segment = { type: "text"; value: string } | { type: "json"; parsed: unknown };

function extractJsonBlocks(text: string): Segment[] {
  const segments: Segment[] = [];
  let i = 0;
  let textStart = 0;
  while (i < text.length) {
    if (text[i] === "{") {
      const end = matchBrace(text, i);
      if (end !== -1) {
        try {
          const parsed = JSON.parse(text.slice(i, end + 1));
          if (parsed && typeof parsed === "object") {
            if (i > textStart) segments.push({ type: "text", value: text.slice(textStart, i) });
            segments.push({ type: "json", parsed });
            i = end + 1;
            textStart = i;
            continue;
          }
        } catch { /* not a valid JSON object here — treat `{` as plain text and keep scanning */ }
      }
    }
    i++;
  }
  if (textStart < text.length) segments.push({ type: "text", value: text.slice(textStart) });
  return segments.length ? segments : [{ type: "text", value: text }];
}

function MixedText({ text, compact }: { text: string; compact: boolean }) {
  const segments = extractJsonBlocks(text);
  return (
    <div className="space-y-1.5">
      {segments.map((s, i) =>
        s.type === "json"
          ? <JsonValue key={i} value={s.parsed} depth={0} />
          : <ContentTree key={i} text={s.value} depth={0} compact={compact} />
      )}
    </div>
  );
}

// Recursive renderer for an already-parsed JSON value (a tool_use `input`, or a JSON block found
// inside tool_result text) — key: value tree instead of one escaped JSON.stringify line, and long
// string fields (prose, summaries) get a real wrapped block instead of a quoted one-liner.
function JsonValue({ value, keyName, depth }: { value: unknown; keyName?: string; depth: number }) {
  const label = keyName != null && (
    <span className="pv-mono text-[9.5px] font-medium text-[hsl(var(--pv-text-muted))]">{keyName}: </span>
  );
  if (value == null) {
    return <div><span className="italic text-[hsl(var(--pv-text-faint))]">{label}null</span></div>;
  }
  if (typeof value === "string") {
    if (value.length > 80 || value.includes("\n")) {
      return (
        <div>
          {label}
          <Block text={value} compact={false} />
        </div>
      );
    }
    return <div>{label}<span className="text-[hsl(var(--pv-text-muted))]">{value || '""'}</span></div>;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return <div>{label}<span className="text-[hsl(var(--pv-text-muted))]">{String(value)}</span></div>;
  }
  if (Array.isArray(value)) {
    if (!value.length) return <div>{label}<span className="italic text-[hsl(var(--pv-text-faint))]">[]</span></div>;
    return (
      <div className={depth > 0 ? "space-y-1 border-l border-dashed border-[hsl(var(--pv-text-faint))]/30 pl-2" : "space-y-1"}>
        {label}
        {value.map((v, i) => <JsonValue key={i} value={v} keyName={`[${i}]`} depth={depth + 1} />)}
      </div>
    );
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length) return <div>{label}<span className="italic text-[hsl(var(--pv-text-faint))]">{"{}"}</span></div>;
  return (
    <div className={depth > 0 ? "space-y-1 border-l border-dashed border-[hsl(var(--pv-text-faint))]/30 pl-2" : "space-y-1"}>
      {label}
      {entries.map(([k, v]) => <JsonValue key={k} value={v} keyName={k} depth={depth + 1} />)}
    </div>
  );
}

// A single Anthropic content part: text parts get the tag-aware tree render; tool_use/tool_result
// get structural rendering of their real payload; anything else (image, …) falls back to
// pretty-printed JSON for just that part.
function ContentPart({ part, compact }: { part: unknown; compact: boolean }) {
  if (typeof part === "string") return <ContentTree text={part} depth={0} compact={compact} />;
  const p = part as {
    type?: string; text?: string; cache_control?: { type?: string };
    name?: string; input?: unknown; content?: unknown;
  };
  if (p?.type === "text" && typeof p.text === "string") {
    return (
      <div>
        {p.cache_control?.type && (
          <span className="pv-mono text-[8.5px] uppercase tracking-[0.06em] text-[hsl(var(--pv-text-faint))]">
            cache: {p.cache_control.type}
          </span>
        )}
        <ContentTree text={p.text} depth={0} compact={compact} />
      </div>
    );
  }
  if (p?.type === "tool_use") {
    return (
      <div className="space-y-1 rounded border border-dashed border-indigo-500/40 p-1.5">
        <p className="pv-mono text-[9px] uppercase tracking-[0.06em] text-indigo-500">→ tool_use · {p.name ?? "?"}</p>
        <JsonValue value={p.input} depth={0} />
      </div>
    );
  }
  if (p?.type === "tool_result") {
    const content = p.content;
    return (
      <div className="space-y-1 rounded border border-dashed border-teal-500/40 p-1.5">
        <p className="pv-mono text-[9px] uppercase tracking-[0.06em] text-teal-500">← tool_result</p>
        {typeof content === "string" ? (
          <MixedText text={content} compact={compact} />
        ) : Array.isArray(content) ? (
          <div className="space-y-1.5">{content.map((c, i) => <ContentPart key={i} part={c} compact={compact} />)}</div>
        ) : (
          <JsonValue value={content} depth={0} />
        )}
      </div>
    );
  }
  return <Block text={jsonBlock(part)} compact={compact} />;
}

function Message({ message, index, compact }: { message: unknown; index: number; compact: boolean }) {
  const m = message as { role?: string; content?: unknown };
  const content = m?.content;
  return (
    <div className="space-y-1">
      <p className="pv-mono text-[9px] uppercase tracking-[0.08em] text-[hsl(var(--pv-text-faint))]">
        #{index + 1} · {m?.role ?? "?"}
      </p>
      {typeof content === "string" ? (
        <ContentTree text={content} depth={0} compact={compact} />
      ) : Array.isArray(content) ? (
        <div className="space-y-1.5">
          {content.map((part, i) => <ContentPart key={i} part={part} compact={compact} />)}
        </div>
      ) : (
        <Block text={jsonBlock(content)} compact={compact} />
      )}
    </div>
  );
}

function PeekBody({ call, compact }: { call: AiCallDebug; compact: boolean }) {
  const messages = Array.isArray(call.input) ? call.input : null;
  return (
    <div className="space-y-2">
      <div>
        <p className="pv-mono text-[9px] uppercase tracking-[0.08em] text-[hsl(var(--pv-text-faint))]">system</p>
        <div className="mt-1"><Block text={call.system ?? ""} compact={compact} /></div>
      </div>
      <div>
        <p className="pv-mono text-[9px] uppercase tracking-[0.08em] text-[hsl(var(--pv-text-faint))]">messages</p>
        <div className="mt-1 space-y-2">
          {call.input == null ? (
            <Block text="(no messages recorded yet)" compact={compact} />
          ) : messages ? (
            messages.map((m, i) => <Message key={i} message={m} index={i} compact={compact} />)
          ) : (
            <Block text={jsonBlock(call.input)} compact={compact} />
          )}
        </div>
      </div>
    </div>
  );
}

// Admin-only peek at the exact request sent to the LLM this turn (docs/agent-turn-grounding.md) — the
// live 'running' ai_calls row (system + messages), collapsed by default so it doesn't dominate the feed.
// Positioned right before the "thinking…" line in AgentRail; gated on useAdmin() by the caller.
export function AdminPromptPeek({ call }: { call: AiCallDebug }) {
  const [open, setOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  return (
    <div className="rounded-lg border border-dashed border-amber-600/30 bg-amber-600/[0.04]">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <Shield className="h-3 w-3 shrink-0 text-amber-600" />
          <span className="pv-mono text-[9.5px] uppercase tracking-[0.1em] text-amber-600">admin</span>
          <span className="min-w-0 flex-1 truncate pv-serif text-[11.5px] italic text-[hsl(var(--pv-text-faint))]">
            request to {call.model ?? "model"}{call.provider ? ` (${call.provider})` : ""}
            {call.input_tokens ? ` · ${call.input_tokens.toLocaleString()} in` : ""}
          </span>
          <ChevronDown className={`h-3 w-3 shrink-0 text-[hsl(var(--pv-text-faint))] transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {open && (
          <button type="button" onClick={() => setFullscreen(true)} title="Open fullscreen"
            className="shrink-0 rounded p-0.5 text-[hsl(var(--pv-text-faint))] hover:text-amber-600">
            <Maximize2 className="h-3 w-3" />
          </button>
        )}
      </div>
      {open && <div className="border-t border-amber-600/20 px-2.5 py-2"><PeekBody call={call} compact /></div>}
      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent className="max-h-[85vh] w-[95vw] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="pv-mono text-sm">
              request to {call.model ?? "model"}{call.provider ? ` (${call.provider})` : ""}
            </DialogTitle>
          </DialogHeader>
          <PeekBody call={call} compact={false} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
