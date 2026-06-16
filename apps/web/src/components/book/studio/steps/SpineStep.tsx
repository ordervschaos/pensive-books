// SpineStep — the Spine step's Stage body.
//
// The AI charts 2–3 ROUTES from the foundations (argument → ending through the tentpoles). Each
// card is a ~250-word summary plus a tentpole-order chip strip. "Propose more routes" appends fresh
// options without touching the existing cards (same append-not-replace pattern as FoundationsStep).
// Picking one makes it spine.text (editable in the chosen-card UI). Pinned tentpoles are validated
// server-side into every route. Every AI op is a durable run (useAIRun → ai-run).
import { useEffect, useRef, useState } from "react";
import { Check, Map as MapIcon } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAIRun } from "@/hooks/useAIRun";
import { DurableReviser } from "../../DurableReviser";
import { saveSpine } from "@/lib/ladder";
import {
  readSpineNode, writeSpinePatch,
  type Foundations, type SpineNode, type SpineRoute,
} from "@/lib/foundations";
import type { UseSteer } from "@/lib/steer";
import { ActionLink, Eyebrow, GenRow, Hero, OptionCard, Panel, RunError } from "../studioUi";

interface Props {
  bookId: number;
  foundations?: Foundations | null;
  steer: UseSteer;
  beforeGen: () => Promise<void>;
  onStatusChange: (v: boolean) => void;
  onChanged: () => void;
}

function SkeletonRoute() {
  return (
    <div className="animate-pulse rounded-2xl border border-[hsl(var(--pv-border-soft))]/60 bg-[hsl(var(--pv-surface-2))]/30 px-6 py-5">
      <div className="mb-3 h-2 w-16 rounded-full bg-[hsl(var(--pv-border-soft))]" />
      <div className="space-y-2.5">
        <div className="h-3.5 w-full rounded-full bg-[hsl(var(--pv-border-soft))]" />
        <div className="h-3.5 rounded-full bg-[hsl(var(--pv-border-soft))]" style={{ width: "91%" }} />
        <div className="h-3.5 rounded-full bg-[hsl(var(--pv-border-soft))]" style={{ width: "78%" }} />
        <div className="h-3.5 rounded-full bg-[hsl(var(--pv-border-soft))]" style={{ width: "85%" }} />
        <div className="h-3.5 rounded-full bg-[hsl(var(--pv-border-soft))]" style={{ width: "60%" }} />
      </div>
      <div className="mt-4 flex gap-1.5">
        <div className="h-4 w-16 rounded-full bg-[hsl(var(--pv-border-soft))]/60" />
        <div className="h-4 w-20 rounded-full bg-[hsl(var(--pv-border-soft))]/60" />
        <div className="h-4 w-14 rounded-full bg-[hsl(var(--pv-border-soft))]/60" />
      </div>
    </div>
  );
}

export function SpineStep({ bookId, foundations, steer, beforeGen, onStatusChange, onChanged }: Props) {
  const { toast } = useToast();
  const [spine, setSpine] = useState("");
  const [node, setNode] = useState<SpineNode>({});
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const routesAppliedRef = useRef<number | null>(null);

  const routesRun = useAIRun<{ routes: SpineRoute[] }>({ bookId, kind: "spine_routes", targetKey: "book", enabled: true });
  const generating = routesRun.run?.status === "running" || routesRun.run?.status === "pending" || routesRun.starting;

  const reload = async () => {
    const n = await readSpineNode(bookId);
    setNode(n);
    setSpine((n.text ?? "").trim());
    onStatusChange(!!n.text?.trim());
  };

  useEffect(() => {
    let alive = true;
    void (async () => {
      await reload();
      if (alive) setLoaded(true);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  // New routes land → append to existing pool (never replace).
  useEffect(() => {
    const r = routesRun.run;
    if (r?.status === "ready" && r.result?.routes?.length && routesAppliedRef.current !== r.id) {
      routesAppliedRef.current = r.id;
      void routesRun.accept(async (res) => {
        const current = node.routes ?? [];
        await writeSpinePatch(bookId, { routes: [...current, ...res.routes] });
        await reload(); onChanged();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routesRun.run?.id, routesRun.run?.status]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await saveSpine(bookId, spine.trim(), { pinned: true });
      setDirty(false); onStatusChange(!!spine.trim()); onChanged();
    } catch (e) {
      toast({ title: "Couldn't save the spine", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const pickRoute = async (route: SpineRoute) => {
    try {
      await saveSpine(bookId, route.summary, { pinned: true });
      await writeSpinePatch(bookId, { selected_route_id: route.id });
      await reload(); onChanged();
    } catch (e) {
      toast({ title: "Couldn't select the route", description: String((e as Error)?.message ?? e), variant: "destructive" });
    }
  };

  const deleteRoute = async (id: string) => {
    const next = (node.routes ?? []).filter((r) => r.id !== id);
    await writeSpinePatch(bookId, { routes: next });
    await reload(); onChanged();
  };

  const proposeMore = async () => {
    await beforeGen();
    const existing = (node.routes ?? []).map((r) => r.summary);
    void routesRun.start(existing.length ? { avoid: existing } : {});
  };

  if (!loaded) return null;

  const routes = node.routes ?? [];
  const unselected = routes.filter((r) => r.id !== node.selected_route_id);

  const tentpoleName = (id: string) => {
    const t = foundations?.tentpoles?.find((x) => x.id === id);
    if (!t) return id;
    const words = t.text.split(/\s+/).slice(0, 4).join(" ");
    return words + (t.text.split(/\s+/).length > 4 ? "…" : "");
  };
  const pinnedTentpoles = (foundations?.tentpoles ?? []).filter((t) => t.status === "pinned").length;

  if (!spine && routes.length === 0 && !generating) {
    return (
      <div>
        <Hero icon={<MapIcon className="h-5 w-5" />} title="Chart the routes"
          sub={`Three different roads from your beginning to your settled ending${pinnedTentpoles ? ` — every one passing through your ${pinnedTentpoles} pinned moment${pinnedTentpoles === 1 ? "" : "s"}` : ""}. Pick the one you'd ride.`}
          onClick={proposeMore} />
        <div className="mt-4">
          <textarea
            value={steer.value}
            onChange={(e) => steer.setValue(e.target.value)}
            onBlur={() => void steer.save()}
            placeholder="steer (optional)"
            rows={1}
            className="pv-serif w-full resize-none rounded-xl border border-[hsl(var(--pv-border-soft))]/70 bg-transparent px-3.5 py-2 text-[13.5px] leading-relaxed placeholder:italic placeholder:text-[hsl(var(--pv-text-faint))] focus:border-[hsl(var(--pv-accent))]/50 focus:outline-none focus:ring-0"
          />
        </div>
        {routesRun.run?.status === "error" && <RunError msg={routesRun.run.error} />}
      </div>
    );
  }

  return (
    <div className="space-y-3.5">
      {/* Chosen, editable spine card. */}
      {spine && (
        <Panel variant="chosen">
          <div className="mb-1 flex items-center justify-between">
            <Eyebrow tone="accent">
              <Check className="mr-1 inline h-3 w-3" strokeWidth={3} />Chosen route{node.pinned ? " · pinned" : ""}
            </Eyebrow>
          </div>
          <Textarea
            value={spine}
            onChange={(e) => { setSpine(e.target.value); setDirty(true); }}
            onBlur={() => dirty && void save()}
            rows={8}
            className="pv-serif border-none bg-transparent px-0 text-[16px] leading-[1.65] focus-visible:ring-0"
          />
          <div className="mt-3.5 flex items-center justify-end gap-4 border-t border-[hsl(var(--pv-border-soft))] pt-3.5 text-[13.5px]">
            {dirty && (
              <ActionLink tone="muted" busy={saving} onClick={() => void save()}>save edits</ActionLink>
            )}
            <DurableReviser
              bookId={bookId}
              layer="spine"
              targetKey="revise:spine"
              current={spine.trim()}
              onApply={async (proposed) => { await saveSpine(bookId, proposed, { pinned: true }); await reload(); setDirty(false); onChanged(); }}
            />
          </div>
        </Panel>
      )}

      {/* Unselected route proposals — pick or discard. */}
      {unselected.map((r, i) => (
        <OptionCard key={r.id} label={`Route ${i + 1}`}
          onPick={() => void pickRoute(r)} pickLabel={spine ? "Switch to this" : "Choose this route"}
          onDelete={() => void deleteRoute(r.id)}>
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
        </OptionCard>
      ))}

      {/* Skeleton cards while generating. */}
      {generating && (
        <>
          <p className="px-1 text-[12px] text-muted-foreground/60">Charting new routes…</p>
          <SkeletonRoute />
          <SkeletonRoute />
          <SkeletonRoute />
        </>
      )}

      {/* Steer + propose — always below the cards when not generating. */}
      {!generating && (routes.length > 0 || spine) && (
        <GenRow steer={steer} label="propose more routes" onFire={proposeMore} />
      )}

      {routesRun.run?.status === "error" && <RunError msg={routesRun.run.error} />}
    </div>
  );
}
