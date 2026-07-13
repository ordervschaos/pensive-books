import { useState } from "react";
import { ChevronDown, CornerDownLeft } from "lucide-react";
import type { AgentSession } from "@/features/dna/lib/agentThread";
import type { DnaNode } from "@/features/dna/lib/novelDna";
import { StepBubble } from "./StepBubble";

// A readable handle for an archived chat. Prefer the model-generated title (named from the chat's first
// message by the book-agent edge fn). Fall back to the opening author message, trimmed — covers old rows
// archived before titles existed and the rare chat whose naming call failed.
function sessionTitle(s: AgentSession): string {
  if (s.title && s.title.trim()) return s.title.trim();
  const first = s.steps.find((st) => (st.t === "user" || st.t === "answer") && st.label.trim())
    ?? s.steps.find((st) => st.label.trim());
  const raw = (first?.label ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return "Untitled chat";
  return raw.length > 64 ? raw.slice(0, 63).trimEnd() + "…" : raw;
}

// Past archived conversations (book_agent_sessions, one row per chat), newest first. The row itself is the
// primary action — one click continues the chat (no scroll-to-bottom hunt); the chevron only peeks at the
// step feed without leaving. "Continue this chat" inside the preview is the same resume for a peeked chat.
export function SessionHistory({ sessions, onResume, busy, nodes }: { sessions: AgentSession[]; onResume: (sessionId: number) => void; busy: boolean; nodes: DnaNode[] }) {
  const [previewId, setPreviewId] = useState<number | null>(null);
  const when = (iso: string) => { try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return iso; } };
  return (
    <div className="space-y-0.5">
      {sessions.map((s) => {
        const msgs = s.steps.filter((st) => st.t === "user").length;
        const open = previewId === s.id;
        return (
          <div key={s.id}>
            <div className="flex items-stretch gap-1">
              <button type="button" onClick={() => onResume(s.id)} disabled={busy} title="Continue this chat"
                className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[hsl(var(--pv-surface-2))]/60 disabled:opacity-40">
                <span className="w-full truncate pv-serif text-[13px] leading-tight text-foreground">{sessionTitle(s)}</span>
                <span className="pv-mono text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--pv-text-faint))]">{when(s.ended_at)} · {msgs} msg{msgs === 1 ? "" : "s"}</span>
              </button>
              <button type="button" onClick={() => setPreviewId(open ? null : s.id)} title={open ? "Hide preview" : "Preview"}
                className="flex shrink-0 items-center px-1.5 text-[hsl(var(--pv-text-faint))] transition-colors hover:text-foreground">
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
              </button>
            </div>
            {open && (
              <div className="mt-1 space-y-2 border-l border-[hsl(var(--pv-border-soft))]/60 pl-3 pb-2">
                {s.steps.map((st, j) => <StepBubble key={j} step={st} nodes={nodes} />)}
                <div className="flex justify-end pt-1">
                  <button type="button" onClick={() => onResume(s.id)} disabled={busy}
                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 pv-serif text-[11.5px] text-[hsl(var(--pv-text-faint))] transition-colors hover:text-[hsl(var(--pv-accent))] disabled:opacity-40">
                    <CornerDownLeft className="h-3 w-3" /> Continue this chat
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
