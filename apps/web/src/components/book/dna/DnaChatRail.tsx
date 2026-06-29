// DnaChatRail — the per-stage conversational reviser, docked on the right (the studio's chat rail, for the
// DNA journey). Talks to the dna-chat edge fn scoped to the active stage; a proposed change rides in the
// thread's pending_proposal as node ops the author reviews and applies. Live projection of dna_chats.
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { ChevronDown, Clock, CornerDownLeft, Loader2, Sparkles, SquarePen, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { Eyebrow } from "@/components/book/shared/studioUi";
import { applyDnaProposal, clearDnaProposal, describeOps, resumeDnaSession, sendDnaMessage, startNewDnaSession, type DnaChatMessage, type DnaProposal, type DnaSession } from "@/lib/dnaChat";
import { DNA_STAGES, type StageKey } from "@/lib/dnaJourney";
import { analysisText, type BookSettings, type DnaNode } from "@/lib/novelDna";

// Stages where the three-axis story analysis is meaningful (there's structure to analyze).
const ANALYSIS_STAGES = new Set<StageKey>(["structure", "scenes", "draft"]);

export function DnaChatRail({ bookId, stage, nodes, settings, onApplied }: { bookId: number; stage: StageKey; nodes: DnaNode[]; settings: BookSettings; onApplied: () => void }) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<DnaChatMessage[]>([]);
  const [sessions, setSessions] = useState<DnaSession[]>([]);
  const [pending, setPending] = useState<DnaProposal | null>(null);
  const [thinking, setThinking] = useState(false);
  const [draft, setDraft] = useState("");
  const [applying, setApplying] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const label = DNA_STAGES.find((s) => s.key === stage)?.label ?? "Stage";

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data } = await supabase.from("dna_chats").select("messages, pending_proposal, sessions, status").eq("book_id", bookId).eq("stage", stage).maybeSingle();
      if (!alive) return;
      setMessages((data?.messages as DnaChatMessage[] | null) ?? []);
      setSessions(Array.isArray(data?.sessions) ? (data!.sessions as DnaSession[]) : []);
      setPending((data?.pending_proposal as DnaProposal | null) ?? null);
      setThinking((data?.status as string | null) === "thinking");
    };
    void load();
    // Unique topic per mount: removeChannel() is async, so under StrictMode's double-mount a stable topic
    // would be reused after subscribe() → "cannot add postgres_changes callbacks after subscribe()".
    const ch = supabase.channel(`dnachat_${bookId}_${stage}_${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "dna_chats", filter: `book_id=eq.${bookId}` }, () => void load())
      .subscribe();
    return () => { alive = false; void supabase.removeChannel(ch); };
  }, [bookId, stage]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, pending, thinking]);

  const newChat = async () => {
    if (thinking) return;
    try { await startNewDnaSession(bookId, stage); setHistoryOpen(false); }
    catch (e) { toast({ title: "Couldn't start a new chat", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
  };

  const resume = async (index: number) => {
    if (thinking) return;
    try { await resumeDnaSession(bookId, stage, index); setHistoryOpen(false); }
    catch (e) { toast({ title: "Couldn't continue that chat", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || thinking) return;
    setDraft(""); setThinking(true);
    setMessages((m) => [...m, { role: "user", text, ts: new Date().toISOString() }]); // optimistic
    // Hand the reviser the live story analysis at the stages where it matters (so it can act on drift/sag).
    const analysis = ANALYSIS_STAGES.has(stage) ? analysisText(nodes, settings) : undefined;
    try { await sendDnaMessage(bookId, stage, text, analysis); }
    catch (e) { setThinking(false); toast({ title: "Couldn't send", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
  };
  const apply = async () => {
    if (!pending) return;
    setApplying(true);
    try { await applyDnaProposal(bookId, stage, pending); setPending(null); onApplied(); toast({ title: "Applied", description: pending.summary }); }
    catch (e) { toast({ title: "Couldn't apply", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
    finally { setApplying(false); }
  };
  const discard = async () => { setPending(null); try { await clearDnaProposal(bookId, stage); } catch { /* best effort */ } };
  const cancel = async () => {
    setThinking(false);
    await supabase.from("dna_chats").update({ status: "idle" }).eq("book_id", bookId).eq("stage", stage);
  };

  return (
    <div className="flex h-full flex-col border-l border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/30">
      <div className="flex items-center gap-2 border-b border-[hsl(var(--pv-border-soft))] px-4 py-3">
        <Sparkles className="h-3.5 w-3.5 text-[hsl(var(--pv-accent))]" />
        <Eyebrow tone="accent">{label} editor</Eyebrow>
        <div className="ml-auto flex items-center gap-1">
          {sessions.length > 0 && (
            <button type="button" onClick={() => setHistoryOpen((v) => !v)} title="Past chats"
              className={`inline-flex items-center gap-1 rounded-full px-2 py-1 pv-mono text-[10px] uppercase tracking-[0.1em] transition-colors ${historyOpen ? "text-[hsl(var(--pv-accent))]" : "text-[hsl(var(--pv-text-faint))] hover:text-foreground"}`}>
              <Clock className="h-3 w-3" /> {sessions.length}
              <ChevronDown className={`h-3 w-3 transition-transform ${historyOpen ? "rotate-180" : ""}`} />
            </button>
          )}
          <button type="button" onClick={() => void newChat()} disabled={thinking || messages.length === 0} title="New chat — archives the current one"
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[hsl(var(--pv-text-faint))] transition-colors hover:text-[hsl(var(--pv-accent))] disabled:opacity-40">
            <SquarePen className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {historyOpen && sessions.length > 0 && (
        <div className="shrink-0 max-h-[40%] overflow-y-auto border-b border-[hsl(var(--pv-border-soft))]/60 bg-[hsl(var(--pv-surface-2))]/20 px-4 py-2">
          <DnaSessionHistory sessions={sessions} onResume={resume} busy={thinking} />
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <p className="pv-serif text-[13px] italic leading-relaxed text-[hsl(var(--pv-text-faint))]">
            Talk through this stage — pressure-test it, or ask for a change. I propose a revision you review before it's saved; pinned nodes stay locked.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : ""}>
            <div className={`inline-block max-w-[92%] rounded-2xl px-3.5 py-2 text-left text-[13.5px] leading-snug ${m.role === "user" ? "bg-[hsl(var(--pv-accent))]/[0.1] text-foreground" : "text-[hsl(var(--pv-text-muted))]"}`}>
              {m.role === "user"
                ? <p className="pv-serif whitespace-pre-wrap">{m.text}</p>
                : <div className="pv-serif prose prose-sm max-w-none dark:prose-invert prose-p:my-1.5 prose-li:my-0.5 prose-headings:mb-1 prose-headings:mt-2 prose-strong:text-foreground"><ReactMarkdown>{m.text}</ReactMarkdown></div>}
            </div>
          </div>
        ))}
        {thinking && (
          <div className="flex items-center gap-2 text-[hsl(var(--pv-text-faint))]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span className="pv-serif text-[13px] italic">thinking…</span>
            <button onClick={() => void cancel()} className="ml-1 flex items-center gap-0.5 text-[12px] italic hover:text-foreground transition-colors">
              <X className="h-3 w-3" />cancel
            </button>
          </div>
        )}

        {pending && (
          <div className="rounded-2xl border border-[hsl(var(--pv-accent))]/40 bg-[hsl(var(--pv-accent))]/[0.06] px-4 py-3">
            <Eyebrow tone="accent">proposed change — review before it's saved</Eyebrow>
            <p className="pv-serif mt-1 text-[13.5px] leading-snug text-foreground">{pending.summary}</p>
            <div className="mt-2.5 space-y-2.5">
              {describeOps(pending.ops, nodes).map((row, i) => (
                <div key={i} className="rounded-lg border border-[hsl(var(--pv-border-soft))] bg-background/40 px-3 py-2">
                  <p className="pv-mono flex items-center gap-1.5 text-[10px] uppercase tracking-[0.1em] text-[hsl(var(--pv-text-faint))]">
                    <span>{row.verb === "edit" ? "edit" : row.verb === "add" ? "add" : "remove"} · {row.kind}</span>
                    {row.verb === "add" && row.parentLabel ? <span>under <span className="text-[hsl(var(--pv-text-muted))]">{row.parentLabel}</span></span> : null}
                    {row.restales ? <span className="text-amber-500">{row.verb === "delete" ? `−${row.restales} below` : `restales ${row.restales}`}</span> : null}
                  </p>
                  <p className="pv-serif mt-0.5 text-[13px] font-medium leading-snug text-foreground">{row.label}</p>
                  {row.verb === "delete"
                    ? <p className="pv-serif mt-1 text-[12.5px] italic text-[hsl(var(--pv-text-faint))]">this node will be removed</p>
                    : row.fields.map((f) => (
                      <div key={f.key} className="mt-1.5">
                        <p className="pv-mono text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--pv-text-faint))]">{f.key}</p>
                        {f.old !== undefined && f.old !== f.next && (
                          <p className="pv-serif text-[12.5px] leading-snug text-[hsl(var(--pv-text-faint))] line-through decoration-[hsl(var(--pv-text-faint))]/50">{f.old}</p>
                        )}
                        <p className="pv-serif text-[12.5px] leading-snug text-foreground whitespace-pre-wrap">{f.next}</p>
                      </div>
                    ))}
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-4">
              <button disabled={applying} onClick={() => void apply()} className="pv-serif text-[13px] text-[hsl(var(--pv-accent))] hover:underline disabled:opacity-50">{applying ? "accepting…" : "accept"}</button>
              <button onClick={() => void discard()} className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))] hover:text-foreground">dismiss</button>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-[hsl(var(--pv-border-soft))] p-3">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
          placeholder={`Ask the ${label.toLowerCase()} editor…`}
          rows={2}
          className="resize-none border-[hsl(var(--pv-border-soft))] bg-background text-[13.5px]"
        />
      </div>
    </div>
  );
}

function DnaSessionHistory({ sessions, onResume, busy }: { sessions: DnaSession[]; onResume: (index: number) => void; busy: boolean }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const when = (iso: string) => { try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return iso; } };
  return (
    <div className="space-y-1">
      {sessions.map((s, i) => (
        <div key={i}>
          <button type="button" onClick={() => setOpenIdx(openIdx === i ? null : i)}
            className="flex w-full items-center gap-2 py-1 text-left pv-serif text-[12px] text-[hsl(var(--pv-text-muted))] hover:text-foreground">
            <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${openIdx === i ? "rotate-180" : ""}`} />
            <span className="flex-1 truncate italic">{when(s.ended_at)} · {s.messages.length} message{s.messages.length === 1 ? "" : "s"}</span>
          </button>
          {openIdx === i && (
            <div className="space-y-2 border-l border-[hsl(var(--pv-border-soft))]/60 pl-3 pb-2">
              {s.messages.map((m, j) => (
                <div key={j} className={m.role === "user" ? "flex justify-end" : ""}>
                  {m.role === "user" ? (
                    <div className="max-w-[85%] rounded-xl rounded-br-sm bg-[hsl(var(--pv-surface-2))] px-3 py-1.5 pv-serif text-[12.5px] leading-[1.5] text-foreground whitespace-pre-wrap">{m.text}</div>
                  ) : (
                    <div className="max-w-[92%] pv-serif text-[13px] leading-[1.55] text-[hsl(var(--pv-text-muted))] prose prose-sm max-w-none dark:prose-invert"><ReactMarkdown>{m.text}</ReactMarkdown></div>
                  )}
                </div>
              ))}
              <div className="flex justify-end pt-1">
                <button type="button" onClick={() => onResume(i)} disabled={busy}
                  className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 pv-serif text-[11.5px] text-[hsl(var(--pv-text-faint))] transition-colors hover:text-[hsl(var(--pv-accent))] disabled:opacity-40">
                  <CornerDownLeft className="h-3 w-3" /> Continue this chat
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
