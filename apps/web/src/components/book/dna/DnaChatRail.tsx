// DnaChatRail — the per-stage conversational reviser, docked on the right (the studio's chat rail, for the
// DNA journey). Talks to the dna-chat edge fn scoped to the active stage; a proposed change rides in the
// thread's pending_proposal as node ops the author reviews and applies. Live projection of dna_chats.
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Loader2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { Eyebrow } from "@/components/book/studio/studioUi";
import { applyDnaProposal, clearDnaProposal, sendDnaMessage, type DnaChatMessage, type DnaProposal } from "@/lib/dnaChat";
import { DNA_STAGES, type StageKey } from "@/lib/dnaJourney";
import { analysisText, type BookSettings, type DnaNode } from "@/lib/novelDna";

// Stages where the three-axis story analysis is meaningful (there's structure to analyze).
const ANALYSIS_STAGES = new Set<StageKey>(["structure", "scenes", "draft"]);

export function DnaChatRail({ bookId, stage, nodes, settings, onApplied }: { bookId: number; stage: StageKey; nodes: DnaNode[]; settings: BookSettings; onApplied: () => void }) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<DnaChatMessage[]>([]);
  const [pending, setPending] = useState<DnaProposal | null>(null);
  const [thinking, setThinking] = useState(false);
  const [draft, setDraft] = useState("");
  const [applying, setApplying] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const label = DNA_STAGES.find((s) => s.key === stage)?.label ?? "Stage";

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data } = await supabase.from("dna_chats").select("messages, pending_proposal, status").eq("book_id", bookId).eq("stage", stage).maybeSingle();
      if (!alive) return;
      setMessages((data?.messages as DnaChatMessage[] | null) ?? []);
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

  return (
    <div className="flex h-full flex-col border-l border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/30">
      <div className="flex items-center gap-2 border-b border-[hsl(var(--pv-border-soft))] px-4 py-3">
        <Sparkles className="h-3.5 w-3.5 text-[hsl(var(--pv-accent))]" />
        <Eyebrow tone="accent">{label} editor</Eyebrow>
      </div>

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
        {thinking && <div className="flex items-center gap-2 text-[hsl(var(--pv-text-faint))]"><Loader2 className="h-3.5 w-3.5 animate-spin" /><span className="pv-serif text-[13px] italic">thinking…</span></div>}

        {pending && (
          <div className="rounded-2xl border border-[hsl(var(--pv-accent))]/40 bg-[hsl(var(--pv-accent))]/[0.06] px-4 py-3">
            <Eyebrow tone="accent">proposed change</Eyebrow>
            <p className="pv-serif mt-1 text-[13.5px] leading-snug text-foreground">{pending.summary}</p>
            <p className="pv-mono mt-1 text-[10px] uppercase tracking-[0.1em] text-[hsl(var(--pv-text-faint))]">{pending.ops.length} edit(s) to the tree</p>
            <div className="mt-2 flex items-center gap-4">
              <button disabled={applying} onClick={() => void apply()} className="pv-serif text-[13px] text-[hsl(var(--pv-accent))] hover:underline disabled:opacity-50">{applying ? "applying…" : "apply"}</button>
              <button onClick={() => void discard()} className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))] hover:text-foreground">discard</button>
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
