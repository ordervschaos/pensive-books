import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { BRIDGE, bridgeFetch } from "@/lib/bridge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Activity, Sparkles, Loader2 } from "lucide-react";

// These tables aren't in the generated Database types yet; supabase.from() accepts a string-typed
// name via its permissive overload (same as useLatestTaskRow), so we pass string vars and cast rows.
const AI_CALLS: string = "ai_calls";
const AI_CALL_EVALS: string = "ai_call_evals";

// The list query polls every few seconds; `system`/`input`/`output` hold the full prompt + whole-book
// context + completion (tens of KB–MBs each). Fetching them for 200 rows on every poll was burning GBs
// of DB egress, so the list pulls metadata only and the detail panel fetches the heavy fields on demand.
const AI_CALL_LIST_COLUMNS =
  "id, created_at, book_id, user_id, task_table, task_id, fn, source, status, model, input_tokens, output_tokens, latency_ms, stop_reason, error";
const AI_CALL_HEAVY_COLUMNS = "system, input, output, artifacts";

interface AiCall {
  id: number;
  created_at: string;
  book_id: number | null;
  user_id: string | null;
  task_table: string | null;
  task_id: number | null;
  fn: string;
  source: string;
  status: string;
  model: string | null;
  system: string | null;
  input: unknown;
  output: string | null;
  artifacts: unknown;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  stop_reason: string | null;
  error: string | null;
}

interface UserProfile {
  user_id: string;
  name: string | null;
  username: string | null;
  profile_pic: string | null;
}

interface Finding { criterion?: string; severity?: string; note?: string; evidence?: string }
interface Amendment { target?: string; suggestion?: string; rationale?: string }
interface AiCallEval {
  id: number;
  ai_call_id: number;
  status: string;
  judge_model: string | null;
  scores: Record<string, number> | null;
  verdict: string | null;
  findings: Finding[] | null;
  amendments: Amendment[] | null;
  error: string | null;
  created_at: string;
}

// The logged `input` is a messages array; flatten it back to readable context for display.
function contextText(input: unknown): string {
  if (input == null) return "(no context recorded)";
  if (typeof input === "string") return input;
  if (!Array.isArray(input)) return JSON.stringify(input, null, 2);
  return (input as Array<{ content?: unknown }>)
    .map((m) => {
      const c = m?.content;
      if (typeof c === "string") return c;
      if (Array.isArray(c)) return c.map((b) => (typeof b === "string" ? b : (b as { text?: string })?.text ?? "")).join("\n");
      return "";
    })
    .join("\n\n");
}

function avgScore(s: Record<string, number> | null): number | null {
  if (!s) return null;
  const vals = Object.values(s).filter((n) => typeof n === "number" && n > 0);
  return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
}

const sevVariant = (sev?: string): "destructive" | "secondary" | "outline" =>
  sev === "high" ? "destructive" : sev === "medium" ? "secondary" : "outline";

export default function AiCalls() {
  const { toast } = useToast();
  const [calls, setCalls] = useState<AiCall[]>([]);
  const [evalsByCall, setEvalsByCall] = useState<Map<number, AiCallEval[]>>(new Map());
  const [profileMap, setProfileMap] = useState<Map<string, UserProfile>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fnFilter, setFnFilter] = useState<string>("all");
  const [selected, setSelected] = useState<AiCall | null>(null);
  const [judging, setJudging] = useState<Set<number>>(new Set());

  const load = async () => {
    const [{ data: callRows, error: e1 }, { data: evalRows, error: e2 }] = await Promise.all([
      supabase.from(AI_CALLS).select(AI_CALL_LIST_COLUMNS).order("id", { ascending: false }).limit(200),
      supabase.from(AI_CALL_EVALS).select("*").order("id", { ascending: false }).limit(400),
    ]);
    if (e1 || e2) { setError((e1 ?? e2)!.message); setLoading(false); return; }
    const rows = (callRows ?? []) as unknown as AiCall[];
    setCalls(rows);

    // Load profiles for all distinct user_ids recorded on the calls themselves.
    const userIds = [...new Set(rows.map((c) => c.user_id).filter(Boolean))] as string[];
    if (userIds.length) {
      const { data: profiles } = await supabase
        .from("public_user_profiles" as string)
        .select("user_id, name, username, profile_pic")
        .in("user_id", userIds);
      if (profiles) {
        const map = new Map<string, UserProfile>();
        for (const p of profiles as unknown as UserProfile[]) map.set(p.user_id, p);
        setProfileMap(map);
      }
    }

    const map = new Map<number, AiCallEval[]>();
    for (const ev of (evalRows ?? []) as unknown as AiCallEval[]) {
      const arr = map.get(ev.ai_call_id) ?? [];
      arr.push(ev);
      map.set(ev.ai_call_id, arr);
    }
    setEvalsByCall(map);
    setLoading(false);
  };

  // Open the detail panel immediately with the metadata we already have, then pull the heavy
  // payload columns (excluded from the polled list query) for just this one row.
  const selectCall = async (c: AiCall) => {
    setSelected(c);
    const { data } = await supabase
      .from(AI_CALLS)
      .select(AI_CALL_HEAVY_COLUMNS)
      .eq("id", c.id)
      .maybeSingle();
    if (data) {
      setSelected((prev) => (prev && prev.id === c.id ? { ...prev, ...(data as Partial<AiCall>) } : prev));
    }
  };

  // Load on mount, then poll so calls from an in-flight task (eval, scan, revise build…) appear
  // without a manual reload. load() never flips `loading`, so the poll updates silently. The poll
  // pauses while the tab is hidden so a forgotten background tab can't keep hitting the DB forever.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      load();
      timer = setInterval(load, 4000);
    };
    const stop = () => {
      if (timer) { clearInterval(timer); timer = null; }
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    onVisibility(); // start now if the tab is visible
    document.addEventListener("visibilitychange", onVisibility);
    return () => { stop(); document.removeEventListener("visibilitychange", onVisibility); };
  }, []);

  // Deep-link: /admin/ai-calls?call=<id> opens that call's detail directly (e.g. from a page's
  // "view generating call" link). Fetched in full since it may not be in the recent-200 list.
  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("call"));
    if (!id) return;
    void (async () => {
      const { data } = await supabase
        .from(AI_CALLS)
        .select(`${AI_CALL_LIST_COLUMNS}, ${AI_CALL_HEAVY_COLUMNS}`)
        .eq("id", id)
        .maybeSingle();
      if (data) setSelected(data as unknown as AiCall);
    })();
  }, []);

  const fns = useMemo(() => Array.from(new Set(calls.map((c) => c.fn))).sort(), [calls]);
  const visible = fnFilter === "all" ? calls : calls.filter((c) => c.fn === fnFilter);

  // Judge one call: bridge in dev (free, Claude Code), edge otherwise. Then poll its evals until a
  // terminal row lands (ai_call_evals isn't in the realtime publication — polling keeps it simple).
  const judge = async (call: AiCall) => {
    if (judging.has(call.id)) return;
    setJudging((s) => new Set(s).add(call.id));
    try {
      if (BRIDGE) {
        const r = await bridgeFetch(`/eval-call/${call.id}`, { method: "POST" });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `bridge ${r.status}`);
      } else {
        const { error: invErr } = await supabase.functions.invoke("evaluate-ai-call", { body: { aiCallId: call.id } });
        if (invErr) throw invErr;
      }
      // Poll for the result (bridge is already done; edge fills async).
      for (let i = 0; i < 45; i++) {
        const { data } = await supabase.from(AI_CALL_EVALS).select("*").eq("ai_call_id", call.id).order("id", { ascending: false }).limit(1);
        const row = (data?.[0] as unknown as AiCallEval | undefined);
        if (row && (row.status === "done" || row.status === "error")) break;
        await new Promise((res) => setTimeout(res, 2000));
      }
      await load();
      toast({ title: "Eval complete", description: `Judged call #${call.id}.` });
    } catch (e) {
      toast({ title: "Couldn't judge", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setJudging((s) => { const n = new Set(s); n.delete(call.id); return n; });
    }
  };

  if (loading) return <div className="flex items-center justify-center min-h-[50vh] text-muted-foreground">Loading…</div>;
  if (error) return <div className="flex items-center justify-center min-h-[50vh] text-destructive">{error}</div>;

  const latestEval = (id: number) => evalsByCall.get(id)?.[0];

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center gap-2">
        <Activity className="h-5 w-5 text-amber-600" />
        <h1 className="text-xl font-semibold">AI Calls</h1>
        <span className="text-sm text-muted-foreground">— every Claude call: context, output, cost, and on-demand evals</span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setFnFilter("all")}
          className={`text-xs rounded-full px-3 py-1 border ${fnFilter === "all" ? "bg-foreground text-background" : "text-muted-foreground"}`}
        >all ({calls.length})</button>
        {fns.map((fn) => (
          <button
            key={fn}
            onClick={() => setFnFilter(fn)}
            className={`text-xs rounded-full px-3 py-1 border ${fnFilter === fn ? "bg-foreground text-background" : "text-muted-foreground"}`}
          >{fn}</button>
        ))}
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>fn</TableHead>
              <TableHead>source</TableHead>
              <TableHead>model</TableHead>
              <TableHead className="text-right">tokens</TableHead>
              <TableHead className="text-right">latency</TableHead>
              <TableHead>who</TableHead>
              <TableHead>when</TableHead>
              <TableHead>eval</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((c) => {
              const ev = latestEval(c.id);
              const score = avgScore(ev?.scores ?? null);
              return (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => selectCall(c)}>
                  <TableCell className="tabular-nums text-muted-foreground">{c.id}</TableCell>
                  <TableCell className="font-medium">
                    {c.fn}
                    {c.status === "running" && (
                      <Badge variant="outline" className="ml-2 text-xs gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" />running
                      </Badge>
                    )}
                    {c.error && <Badge variant="destructive" className="ml-2 text-xs">error</Badge>}
                  </TableCell>
                  <TableCell><Badge variant={c.source === "bridge" ? "outline" : "secondary"} className="text-xs">{c.source}</Badge></TableCell>
                  <TableCell className="text-muted-foreground text-xs">{c.model}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                    {c.input_tokens != null ? `${c.input_tokens}/${c.output_tokens}` : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                    {c.status === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin inline" /> : c.latency_ms != null ? `${(c.latency_ms / 1000).toFixed(1)}s` : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {c.user_id ? (() => {
                      const p = profileMap.get(c.user_id);
                      return (
                        <span className="flex items-center gap-1.5">
                          {p?.profile_pic
                            ? <img src={p.profile_pic} className="h-5 w-5 rounded-full object-cover flex-shrink-0" />
                            : <span className="h-5 w-5 rounded-full bg-muted flex-shrink-0 inline-block" />}
                          <span className="truncate max-w-[80px]">{p?.name ?? p?.username ?? c.user_id.slice(0, 8)}</span>
                        </span>
                      );
                    })() : <span className="italic">system</span>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(c.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </TableCell>
                  <TableCell>
                    {ev ? (
                      <span className="text-xs">
                        {ev.status === "done" ? <Badge variant={score && score >= 4 ? "secondary" : "destructive"}>{score}/5</Badge>
                          : ev.status === "error" ? <Badge variant="destructive">err</Badge>
                          : <Badge variant="outline">{ev.status}</Badge>}
                      </span>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="ghost" onClick={() => judge(c)} disabled={judging.has(c.id)}>
                      {judging.has(c.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                      <span className="ml-1 text-xs">{ev ? "re-judge" : "judge"}</span>
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {visible.length === 0 && (
              <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">No AI calls yet — run something AI in the app.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <CallDialog
        call={selected}
        evals={selected ? (evalsByCall.get(selected.id) ?? []) : []}
        onClose={() => setSelected(null)}
        onJudge={selected ? () => judge(selected) : undefined}
        judging={selected ? judging.has(selected.id) : false}
        profile={selected?.user_id ? profileMap.get(selected.user_id) : null}
      />
    </div>
  );
}

function CallDialog({ call, evals, onClose, onJudge, judging, profile }: {
  call: AiCall | null;
  evals: AiCallEval[];
  onClose: () => void;
  onJudge?: () => void;
  judging: boolean;
  profile?: UserProfile | null;
}) {
  if (!call) return null;
  return (
    <Dialog open={!!call} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>#{call.id} · {call.fn}</span>
            <Badge variant={call.source === "bridge" ? "outline" : "secondary"} className="text-xs">{call.source}</Badge>
            <span className="text-xs font-normal text-muted-foreground">{call.model}</span>
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh] pr-4">
          <div className="space-y-4 text-sm">
            <div className="text-xs text-muted-foreground flex gap-4 flex-wrap items-center">
              {profile ? (
                <span className="flex items-center gap-1.5">
                  {profile.profile_pic && <img src={profile.profile_pic} className="h-4 w-4 rounded-full object-cover" />}
                  {profile.name ?? profile.username}
                </span>
              ) : null}
              <span>book {call.book_id ?? "—"}</span>
              {call.task_table && <span>→ {call.task_table}#{call.task_id}</span>}
              {call.input_tokens != null && <span>tokens {call.input_tokens}/{call.output_tokens}</span>}
              {call.latency_ms != null && <span>{(call.latency_ms / 1000).toFixed(1)}s</span>}
              {call.stop_reason && <span>stop: {call.stop_reason}</span>}
              <span>{new Date(call.created_at).toLocaleString()}</span>
            </div>

            {call.error && <Section title="Error"><pre className="whitespace-pre-wrap text-destructive text-xs">{call.error}</pre></Section>}
            {call.system && <Section title="System"><pre className="whitespace-pre-wrap text-xs">{call.system}</pre></Section>}
            {call.artifacts != null && <Section title="Artifacts (labeled inputs)"><ArtifactsView artifacts={call.artifacts} /></Section>}
            <Section title="Context (assembled prompt)"><pre className="whitespace-pre-wrap text-xs">{contextText(call.input)}</pre></Section>
            <Section title="Output"><pre className="whitespace-pre-wrap text-xs">{call.output ?? "(none)"}</pre></Section>

            <div className="flex items-center justify-between border-t pt-3">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Evaluations</h3>
              {onJudge && (
                <Button size="sm" variant="outline" onClick={onJudge} disabled={judging}>
                  {judging ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  <span className="ml-1 text-xs">{evals.length ? "re-judge" : "judge"}</span>
                </Button>
              )}
            </div>
            {evals.length === 0 && <p className="text-xs text-muted-foreground">Not judged yet.</p>}
            {evals.map((ev) => <EvalCard key={ev.id} ev={ev} />)}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

// The labeled artifact manifest logged on each generation call: each key is one named input that
// composed the prompt (brief, objective, beat, character_states, open_loops, preceding-prose refs).
// Strings render inline; objects/arrays render as compact JSON. Empty values are skipped.
function ArtifactsView({ artifacts }: { artifacts: unknown }) {
  if (!artifacts || typeof artifacts !== "object") return <p className="text-xs text-muted-foreground">(none recorded)</p>;
  const entries = Object.entries(artifacts as Record<string, unknown>).filter(
    ([, v]) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0),
  );
  if (entries.length === 0) return <p className="text-xs text-muted-foreground">(none recorded)</p>;
  return (
    <div className="space-y-1.5">
      {entries.map(([k, v]) => (
        <div key={k} className="text-xs">
          <span className="font-medium text-foreground">{k.replace(/_/g, " ")}: </span>
          <pre className="whitespace-pre-wrap inline text-muted-foreground">
            {typeof v === "string" ? v : JSON.stringify(v, null, 2)}
          </pre>
        </div>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">{title}</h3>
      <div className="rounded border bg-muted/30 p-2 max-h-64 overflow-auto">{children}</div>
    </div>
  );
}

function EvalCard({ ev }: { ev: AiCallEval }) {
  if (ev.status !== "done") {
    return <div className="rounded border p-2 text-xs text-muted-foreground">{ev.status}{ev.error ? `: ${ev.error}` : "…"}</div>;
  }
  const s = ev.scores ?? {};
  return (
    <div className="rounded border p-3 space-y-2">
      <div className="flex gap-3 flex-wrap text-xs">
        {Object.entries(s).map(([k, v]) => (
          <span key={k} className="text-muted-foreground">{k.replace(/_/g, " ")}: <strong className="text-foreground">{v}/5</strong></span>
        ))}
        <span className="text-muted-foreground ml-auto">{ev.judge_model}</span>
      </div>
      {ev.verdict && <p className="text-sm italic">"{ev.verdict}"</p>}
      {!!ev.findings?.length && (
        <div className="space-y-1">
          {ev.findings.map((f, i) => (
            <div key={i} className="text-xs">
              <Badge variant={sevVariant(f.severity)} className="text-[10px] mr-1">{f.severity}</Badge>
              <span className="text-muted-foreground">({f.criterion})</span> {f.note}
              {f.evidence && <span className="block pl-4 text-muted-foreground italic">“{f.evidence}”</span>}
            </div>
          ))}
        </div>
      )}
      {!!ev.amendments?.length && (
        <div className="space-y-1 border-t pt-2">
          {ev.amendments.map((a, i) => (
            <div key={i} className="text-xs">
              <Badge variant={a.target === "code" ? "default" : "outline"} className="text-[10px] mr-1">{a.target}</Badge>
              {a.suggestion}
              {a.rationale && <span className="block pl-4 text-muted-foreground">↳ {a.rationale}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
