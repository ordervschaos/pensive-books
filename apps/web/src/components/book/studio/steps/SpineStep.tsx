// SpineStep — the Spine step's Stage body. Two modes:
//
// OLD FLOW (no foundations): the book's one-paragraph throughline drafted from the brief — a loud
// hero when there's no spine yet; the editable paragraph (autosaved on blur) once there is one.
//
// NEW FLOW (pin-driven, docs/pinned_method.md §3.3): the AI charts 2–3 ROUTES from the foundations
// (argument → ending through the tentpoles); each card is a ~250-word summary plus a tentpole-order
// chip strip. Picking one makes it spine.text (editable in the same approved card UI); "re-route"
// regenerates the unselected candidates only. Pinned tentpoles are validated server-side into every
// route. Every AI op is a DURABLE run (useAIRun → ai-run) and survives navigation/refresh.
//
// Pinning: an explicit author gesture (editing the paragraph, picking a route/option) stamps
// spine.pinned; the plain AI auto-apply leaves it fluid.
import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Map as MapIcon, RefreshCw, Sparkles } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAIRun } from "@/hooks/useAIRun";
import { DurableOptions } from "../../DurableOptions";
import { DurableReviser } from "../../DurableReviser";
import { readNode, saveSpine } from "@/lib/ladder";
import {
  readSpineNode, writeSpinePatch,
  type Foundations, type SpineNode, type SpineRoute,
} from "@/lib/foundations";
import { Hero } from "../studioUi";

interface Props {
  bookId: number;
  newFlow?: boolean;
  foundations?: Foundations | null;
  /** Persist the step's author steer before any generation kicks (provided by StudioStage). */
  beforeGen: () => Promise<void>;
  onStatusChange: (v: boolean) => void;
  onChanged: () => void;
}

export function SpineStep({ bookId, newFlow, foundations, beforeGen, onStatusChange, onChanged }: Props) {
  const { toast } = useToast();
  const [spine, setSpine] = useState("");
  const [node, setNode] = useState<SpineNode>({});
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const appliedRef = useRef<number | null>(null);
  const routesAppliedRef = useRef<number | null>(null);

  // Persist the steer, then kick — so the background worker reads the fresh guidance from books.steers.
  const startGen = async () => { await beforeGen(); void gen.start({}); };
  const startRoutes = async (avoid: string[] = []) => { await beforeGen(); void routesRun.start(avoid.length ? { avoid } : {}); };

  // Durable spine generation (old flow: single candidate → auto-applies on ready).
  const gen = useAIRun<{ text: string }>({ bookId, kind: "spine", targetKey: "book", enabled: !newFlow });
  const generating = gen.run?.status === "running" || gen.run?.status === "pending" || gen.starting
    || (gen.run?.status === "ready" && !!gen.run.result?.text);

  // Durable route charting (new flow: 3 candidates → persisted into books.spine.routes on ready).
  const routesRun = useAIRun<{ routes: SpineRoute[] }>({ bookId, kind: "spine_routes", targetKey: "book", enabled: !!newFlow });
  const routing = routesRun.run?.status === "running" || routesRun.run?.status === "pending" || routesRun.starting;

  const reload = async () => {
    const n = await readSpineNode(bookId);
    setNode(n);
    setSpine((n.text ?? "").trim());
    onStatusChange(!!n.text?.trim());
  };

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (newFlow) { await reload(); } else {
        const text = await readNode(bookId, "spine");
        if (!alive) return;
        setSpine(text); onStatusChange(!!text.trim());
      }
      if (alive) setLoaded(true);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, newFlow]);

  // Old flow: auto-apply a completed generation.
  useEffect(() => {
    const r = gen.run;
    if (r?.status === "ready" && r.result?.text && appliedRef.current !== r.id) {
      appliedRef.current = r.id;
      void gen.accept(async (res) => {
        await saveSpine(bookId, res.text);
        setSpine(res.text); setDirty(false); onStatusChange(!!res.text.trim()); onChanged();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gen.run?.id, gen.run?.status]);

  // New flow: routes land → persist them (keep the selected route + text if any survive re-route).
  useEffect(() => {
    const r = routesRun.run;
    if (r?.status === "ready" && r.result?.routes?.length && routesAppliedRef.current !== r.id) {
      routesAppliedRef.current = r.id;
      void routesRun.accept(async (res) => {
        const kept = node.routes?.find((x) => x.id === node.selected_route_id);
        await writeSpinePatch(bookId, { routes: kept ? [kept, ...res.routes] : res.routes });
        await reload(); onChanged();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routesRun.run?.id, routesRun.run?.status]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await saveSpine(bookId, spine.trim(), { pinned: true }); // author edit → pinned (§4 rule 1)
      setDirty(false); onStatusChange(!!spine.trim()); onChanged();
    }
    catch (e) { toast({ title: "Couldn't save the spine", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const pickRoute = async (route: SpineRoute) => {
    try {
      await saveSpine(bookId, route.summary, { pinned: true }); // an explicit pick is an author gesture
      await writeSpinePatch(bookId, { selected_route_id: route.id });
      await reload(); onChanged();
    } catch (e) {
      toast({ title: "Couldn't select the route", description: String((e as Error)?.message ?? e), variant: "destructive" });
    }
  };

  // Re-route: regenerate the UNSELECTED candidates only — the selected one is held client-side and
  // passed as "vary away from" context.
  const reroute = () => {
    const selected = node.routes?.find((x) => x.id === node.selected_route_id);
    void startRoutes(selected ? [selected.summary] : []);
  };

  if (!loaded) return null;

  // ── New flow: routes ────────────────────────────────────────────────────────
  if (newFlow) {
    const routes = node.routes ?? [];
    const tentpoleName = (id: string) => {
      const t = foundations?.tentpoles?.find((x) => x.id === id);
      if (!t) return id;
      const words = t.text.split(/\s+/).slice(0, 4).join(" ");
      return words + (t.text.split(/\s+/).length > 4 ? "…" : "");
    };
    const pinnedTentpoles = (foundations?.tentpoles ?? []).filter((t) => t.status === "pinned").length;

    if (routing) {
      return (
        <div className="flex items-center gap-4">
          <p className="pv-serif inline-flex items-center gap-2 text-[14px] italic text-[hsl(var(--pv-text-muted))]">
            <Loader2 className="h-4 w-4 animate-spin" /> Charting routes through your tentpoles…
          </p>
          <button type="button" onClick={() => void routesRun.cancel()} className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))] hover:text-foreground">cancel</button>
        </div>
      );
    }

    if (!spine && routes.length === 0) {
      return (
        <div>
          <Hero icon={<MapIcon className="h-5 w-5" />} title="Chart the routes"
            sub={`Three different roads from your beginning to your settled ending${pinnedTentpoles ? ` — every one passing through your ${pinnedTentpoles} pinned moment${pinnedTentpoles === 1 ? "" : "s"}` : ""}. Pick the one you'd ride.`}
            onClick={() => void startRoutes()} />
          {routesRun.run?.status === "error" && <p className="pv-serif mt-3 text-[13px] italic text-red-600 dark:text-red-400">{routesRun.run.error}</p>}
        </div>
      );
    }

    const unselected = routes.filter((r) => r.id !== node.selected_route_id);
    return (
      <div className="space-y-3.5">
        {/* The approved, editable spine card once a route is picked. */}
        {spine && (
          <div className="rounded-2xl border border-[hsl(var(--pv-accent))]/45 bg-[hsl(var(--pv-surface-2))]/60 px-6 py-5">
            <div className="mb-1 flex items-center justify-between">
              <span className="pv-mono text-[10px] uppercase tracking-[0.14em] text-[hsl(var(--pv-accent))]">
                <Check className="mr-1 inline h-3 w-3" strokeWidth={3} />Approved route{node.pinned ? " · pinned" : ""}
              </span>
            </div>
            <Textarea
              value={spine}
              onChange={(e) => { setSpine(e.target.value); setDirty(true); }}
              onBlur={() => dirty && void save()}
              rows={8}
              className="pv-serif border-none bg-transparent px-0 text-[16px] leading-[1.65] focus-visible:ring-0"
            />
            <div className="mt-3.5 flex items-center gap-5 border-t border-[hsl(var(--pv-border-soft))] pt-3.5 text-[13.5px]">
              <button type="button" onClick={reroute} className="inline-flex items-center gap-1.5 italic text-[hsl(var(--pv-accent))] hover:opacity-75">
                <RefreshCw className="h-3.5 w-3.5" /> re-route (this one is held)
              </button>
              <div className="ml-auto flex items-center gap-4">
                {dirty && (
                  <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-1.5 italic text-[hsl(var(--pv-text-muted))] hover:text-foreground">
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} save edits
                  </button>
                )}
                <DurableReviser
                  bookId={bookId}
                  layer="spine"
                  targetKey="revise:spine"
                  current={spine.trim()}
                  onApply={async (proposed) => { await saveSpine(bookId, proposed, { pinned: true }); await reload(); setDirty(false); onChanged(); }}
                />
              </div>
            </div>
          </div>
        )}
        {/* The other routes — pick to switch. */}
        {unselected.map((r, i) => (
          <div key={r.id} className="rounded-2xl border border-border bg-[hsl(var(--pv-surface-2))]/40 px-6 py-5">
            <div className="mb-2.5 flex items-center justify-between gap-3">
              <span className="pv-mono text-[10px] uppercase tracking-[0.14em] text-[hsl(var(--pv-text-faint))]">Route {i + 1}</span>
              <button type="button" onClick={() => void pickRoute(r)}
                className="pv-serif inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-[13.5px] text-foreground transition-colors hover:border-foreground/40">
                Take this route
              </button>
            </div>
            <p className="pv-serif whitespace-pre-wrap text-[14.5px] leading-[1.65] text-foreground">{r.summary}</p>
            {r.tentpole_order.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {r.tentpole_order.map((id, j) => (
                  <span key={`${id}-${j}`} className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--pv-accent))]/[0.08] px-2.5 py-0.5 pv-mono text-[9.5px] uppercase tracking-[0.08em] text-[hsl(var(--pv-accent))]">
                    ◆ {tentpoleName(id)}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {!spine && routes.length > 0 && (
          <button type="button" onClick={reroute} className="pv-serif inline-flex items-center gap-1.5 text-[13.5px] italic text-[hsl(var(--pv-accent))] hover:opacity-75">
            <RefreshCw className="h-3.5 w-3.5" /> chart three fresh routes
          </button>
        )}
        {routesRun.run?.status === "error" && <p className="pv-serif text-[13px] italic text-red-600 dark:text-red-400">{routesRun.run.error}</p>}
      </div>
    );
  }

  // ── Old flow: the single drafted paragraph ──────────────────────────────────
  if (generating) {
    return (
      <div className="flex items-center gap-4">
        <p className="pv-serif inline-flex items-center gap-2 text-[14px] italic text-[hsl(var(--pv-text-muted))]"><Loader2 className="h-4 w-4 animate-spin" /> Drafting the spine…</p>
        <button type="button" onClick={() => void gen.cancel()} className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))] hover:text-foreground">cancel</button>
      </div>
    );
  }

  if (!spine.trim()) {
    return (
      <Hero icon={<Sparkles className="h-5 w-5" />} title="Draft the spine from the brief"
        sub="One paragraph that names the throughline — what the book is really about. The outline is built to realize it."
        onClick={() => void startGen()} />
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-[hsl(var(--pv-surface-2))]/50 px-6 py-5">
      <Textarea
        value={spine}
        onChange={(e) => { setSpine(e.target.value); setDirty(true); }}
        onBlur={() => dirty && void save()}
        rows={8}
        className="pv-serif border-none bg-transparent px-0 text-[16px] leading-[1.65] focus-visible:ring-0"
      />
      <div className="mt-3.5 flex items-center gap-5 border-t border-[hsl(var(--pv-border-soft))] pt-3.5 text-[13.5px]">
        <button type="button" onClick={() => void startGen()} className="inline-flex items-center gap-1.5 italic text-[hsl(var(--pv-accent))] hover:opacity-75">
          <RefreshCw className="h-3.5 w-3.5" /> re-draft from the brief
        </button>
        <div className="ml-auto flex items-center gap-4">
          {dirty && (
            <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-1.5 italic text-[hsl(var(--pv-text-muted))] hover:text-foreground">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} save edits
            </button>
          )}
          <DurableReviser
            bookId={bookId}
            layer="spine"
            targetKey="revise:spine"
            current={spine.trim()}
            onApply={async (proposed) => { await saveSpine(bookId, proposed, { pinned: true }); setSpine(proposed); setDirty(false); onStatusChange(!!proposed.trim()); onChanged(); }}
          />
          <DurableOptions
            bookId={bookId}
            kind="spine_options"
            targetKey="book"
            getParams={() => ({})}
            onApply={async (proposed) => { await saveSpine(bookId, proposed, { pinned: true }); setSpine(proposed); setDirty(false); onStatusChange(!!proposed.trim()); onChanged(); }}
          />
        </div>
      </div>
    </div>
  );
}
