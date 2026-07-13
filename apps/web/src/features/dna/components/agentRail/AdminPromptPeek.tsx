import { useState } from "react";
import { ChevronDown, Shield } from "lucide-react";
import type { AiCallDebug } from "@/features/dna/hooks/useLatestAiCall";

const CAP = 20000; // debug view, not a reader — cap each block so one huge turn can't jank the feed

function cappedText(text: string): { text: string; truncated: boolean } {
  return text.length > CAP ? { text: text.slice(0, CAP), truncated: true } : { text, truncated: false };
}

function inputText(input: unknown): string {
  if (input == null) return "(no messages recorded yet)";
  if (typeof input === "string") return input;
  try { return JSON.stringify(input, null, 2); } catch { return String(input); }
}

// Admin-only peek at the exact request sent to the LLM this turn (docs/agent-turn-grounding.md) — the
// live 'running' ai_calls row (system + messages), collapsed by default so it doesn't dominate the feed.
// Positioned right before the "thinking…" line in AgentRail; gated on useAdmin() by the caller.
export function AdminPromptPeek({ call }: { call: AiCallDebug }) {
  const [open, setOpen] = useState(false);
  const system = cappedText(call.system ?? "");
  const input = cappedText(inputText(call.input));
  return (
    <div className="rounded-lg border border-dashed border-amber-600/30 bg-amber-600/[0.04]">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left">
        <Shield className="h-3 w-3 shrink-0 text-amber-600" />
        <span className="pv-mono text-[9.5px] uppercase tracking-[0.1em] text-amber-600">admin</span>
        <span className="min-w-0 flex-1 truncate pv-serif text-[11.5px] italic text-[hsl(var(--pv-text-faint))]">
          request to {call.model ?? "model"}{call.provider ? ` (${call.provider})` : ""}
          {call.input_tokens ? ` · ${call.input_tokens.toLocaleString()} in` : ""}
        </span>
        <ChevronDown className={`h-3 w-3 shrink-0 text-[hsl(var(--pv-text-faint))] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-amber-600/20 px-2.5 py-2">
          <div>
            <p className="pv-mono text-[9px] uppercase tracking-[0.08em] text-[hsl(var(--pv-text-faint))]">system</p>
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 text-[10px] leading-[1.5] text-[hsl(var(--pv-text-muted))]">
              {system.text}{system.truncated ? "\n… (truncated)" : ""}
            </pre>
          </div>
          <div>
            <p className="pv-mono text-[9px] uppercase tracking-[0.08em] text-[hsl(var(--pv-text-faint))]">messages</p>
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 text-[10px] leading-[1.5] text-[hsl(var(--pv-text-muted))]">
              {input.text}{input.truncated ? "\n… (truncated)" : ""}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
