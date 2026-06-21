// DnaStudio — the four-verb authoring surface for the Novel DNA tree (Phase 4). The book IS the tree
// (docs/novel-dna-schema.md); this is the "hungry structure" the author fills. One uniform NodeCard for
// every kind (the self-similar promise: learn expand/choose/edit/lock once). Live projection of
// book_nodes (refresh = no-op); pages are produced on demand via reconcileDna (the Render action).
import { useEffect, useState } from "react";
import { Lock, Unlock, Plus, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { saveNode, deleteNode } from "@/lib/bookNodes";
import { migrateBookToDna } from "@/lib/migrateToDna";
import { reconcileDna } from "@/lib/novelDnaRender";
import {
  byId, childrenOf, editContent, emptyNode, isProseStale, isStale, lock as lockNode, renderBlockers,
  type DnaNode, type NodeKind,
} from "@/lib/novelDna";

// The meaningful fields the UI exposes per kind (the ★/U slots; dotted keys reach into nested content).
const FIELDS: Partial<Record<NodeKind, { key: string; label: string }[]>> = {
  seed: [{ key: "logline", label: "logline" }],
  premise: [{ key: "dramatic_question", label: "dramatic question" }, { key: "shape.setup", label: "shape / throughline" }],
  pillar: [{ key: "controlling_idea", label: "controlling idea" }, { key: "ending", label: "ending" }],
  character: [{ key: "name", label: "name" }, { key: "want", label: "want" }, { key: "need", label: "need ★" }, { key: "wound", label: "wound ★" }, { key: "lie", label: "lie ★" }, { key: "idiolect", label: "idiolect" }],
  relationship: [{ key: "bond", label: "bond" }, { key: "charge", label: "charge" }],
  tentpole: [{ key: "summary", label: "set-piece" }],
  world_fact: [{ key: "rule", label: "rule" }],
  movement: [{ key: "title", label: "title" }, { key: "goal", label: "goal" }, { key: "turning_point", label: "turning point ★" }],
  beat: [{ key: "summary", label: "beat" }, { key: "connector", label: "connector (therefore/but)" }],
  scene: [{ key: "chapter_start.title", label: "chapter title (blank = mid-chapter)" }, { key: "goal", label: "goal" }, { key: "outcome", label: "outcome" }, { key: "prose.text", label: "prose" }],
};

const getPath = (obj: Record<string, unknown>, path: string): string => {
  const v = path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
  return typeof v === "string" ? v : "";
};
const setPath = (path: string, value: string): Record<string, unknown> => {
  const keys = path.split(".");
  const root: Record<string, unknown> = {};
  let cur = root;
  keys.forEach((k, i) => { if (i === keys.length - 1) cur[k] = value; else { cur[k] = {}; cur = cur[k] as Record<string, unknown>; } });
  return root;
};
const deepMerge = (a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> => {
  const out = { ...a };
  for (const k of Object.keys(b)) {
    const bv = b[k], av = out[k];
    out[k] = bv && typeof bv === "object" && !Array.isArray(bv) && av && typeof av === "object" ? deepMerge(av as Record<string, unknown>, bv as Record<string, unknown>) : bv;
  }
  return out;
};

export interface DnaSettings { title?: string; author?: string; word_target?: number }

export function DnaStudio({ bookId, bookSlug, settings, nodes, onChanged }: {
  bookId: number; bookSlug: string; settings: DnaSettings; nodes: DnaNode[]; onChanged: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const index = byId(nodes);
  const of = (kind: NodeKind) => nodes.filter((n) => n.kind === kind);
  const blockers = renderBlockers(nodes, settings);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try { await fn(); onChanged(); }
    catch (e) { toast({ title: `Couldn't ${label}`, description: String((e as Error)?.message ?? e), variant: "destructive" }); }
    finally { setBusy(null); }
  };
  const migrate = () => run("migrate", async () => { const { count } = await migrateBookToDna(bookId); toast({ title: "Migrated to DNA", description: `${count} nodes built from the legacy book.` }); });
  const render = () => run("render", async () => { const r = await reconcileDna(bookId); toast({ title: "Rendered", description: `${r.pages} pages · ${r.created} added · ${r.updated} updated · ${r.archived} archived.` }); });
  const addChild = (parent: DnaNode, kind: NodeKind, level: number) =>
    run("add", () => saveNode(emptyNode(bookId, kind, level, parent.id, childrenOf(nodes, parent.id).length)));

  const seed = of("seed")[0];
  const premise = of("premise")[0];
  const pillar = of("pillar")[0];

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <h1 className="pv-serif text-xl text-foreground">{settings.title || "Untitled"} · DNA</h1>
          <p className="pv-mono mt-1 text-[11px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-muted))]">
            {blockers.length === 0 ? "renderable ✓" : `${blockers.length} blocker(s): ${blockers.join(" · ")}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {nodes.length === 0 && <Button size="sm" variant="outline" disabled={!!busy} onClick={migrate}>{busy === "migrate" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Migrate from legacy"}</Button>}
          <Button size="sm" variant="outline" disabled={!!busy || !nodes.length} onClick={render}>{busy === "render" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Render pages"}</Button>
          <a href={`/books/${bookSlug}`} className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))] hover:text-[hsl(var(--pv-accent))]">read →</a>
        </div>
      </div>

      {nodes.length === 0 ? (
        <p className="pv-serif text-[15px] italic text-[hsl(var(--pv-text-faint))]">
          Empty tree. <button className="text-[hsl(var(--pv-accent))] underline" onClick={migrate}>Migrate the legacy book</button>{" "}
          or <button className="text-[hsl(var(--pv-accent))] underline" onClick={() => run("seed", () => saveNode(emptyNode(bookId, "seed", 0, null)))}>start a blank seed</button>.
        </p>
      ) : (
        <>
          <Section title="Premise">
            {[seed, premise, pillar].filter(Boolean).map((n) => <NodeCard key={n!.id} node={n!} index={index} onChanged={onChanged} />)}
          </Section>

          <Section title="Cast & world" action={pillar && <AddMenu onAdd={(k, l) => addChild(pillar, k, l)} kinds={[["character", 2], ["tentpole", 2], ["relationship", 2], ["world_fact", 2]]} />}>
            {(["character", "tentpole", "relationship", "world_fact"] as NodeKind[]).flatMap((k) => of(k)).map((n) => <NodeCard key={n.id} node={n} index={index} onChanged={onChanged} />)}
          </Section>

          <Section title="Structure">
            {of("movement").map((m) => (
              <div key={m.id} className="space-y-2">
                <NodeCard node={m} index={index} onChanged={onChanged} accent />
                <div className="ml-4 space-y-2 border-l border-[hsl(var(--pv-border-soft))] pl-4">
                  {childrenOf(nodes, m.id).filter((b) => b.kind === "beat").map((b) => (
                    <div key={b.id} className="space-y-2">
                      <NodeCard node={b} index={index} onChanged={onChanged} />
                      <div className="ml-4 space-y-2 border-l border-[hsl(var(--pv-border-soft))] pl-4">
                        {childrenOf(nodes, b.id).filter((s) => s.kind === "scene").map((s) => <NodeCard key={s.id} node={s} index={index} onChanged={onChanged} />)}
                        <AddLink busy={busy === "add"} onClick={() => addChild(b, "scene", 5)} label="add scene" />
                      </div>
                    </div>
                  ))}
                  <AddLink busy={busy === "add"} onClick={() => addChild(m, "beat", 4)} label="add beat" />
                </div>
              </div>
            ))}
            {pillar && <AddLink busy={busy === "add"} onClick={() => addChild(pillar, "movement", 3)} label="add movement" />}
          </Section>
        </>
      )}
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="pv-mono text-[11px] uppercase tracking-[0.14em] text-[hsl(var(--pv-text-muted))]">{title}</h2>
        {action}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

// The uniform node card — the same four verbs (edit / lock / [choose] / [expand]) at every depth.
function NodeCard({ node, index, onChanged, accent }: { node: DnaNode; index: Map<string, DnaNode>; onChanged: () => void; accent?: boolean }) {
  const { toast } = useToast();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  useEffect(() => { setDrafts({}); }, [node.id]);
  const fields = FIELDS[node.kind] ?? [];
  const stale = isStale(node, index) || (node.kind === "scene" && isProseStale(node));

  const save = async (patch: Record<string, unknown>) => {
    try { await saveNode(editContent(node, patch)); onChanged(); }
    catch (e) { toast({ title: "Couldn't save", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
  };
  const toggleLock = async () => {
    try { await saveNode(lockNode(node, !node.authoring.locked)); onChanged(); }
    catch (e) { toast({ title: "Couldn't lock", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
  };
  const remove = async () => {
    if (!window.confirm(`Delete this ${node.kind} and everything under it?`)) return;
    try { await deleteNode(node.id); onChanged(); } catch (e) { toast({ title: "Couldn't delete", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
  };

  return (
    <div className={`rounded-lg border px-4 py-3 ${accent ? "border-[hsl(var(--pv-accent))]/30 bg-[hsl(var(--pv-accent))]/[0.05]" : "border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/30"}`}>
      <div className="mb-2 flex items-center gap-2">
        <span className="pv-mono text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--pv-accent))]">{node.kind}</span>
        <span className="pv-mono text-[9px] uppercase tracking-[0.1em] text-[hsl(var(--pv-text-faint))]">{node.authoring.status}</span>
        {stale && <span className="pv-mono text-[9px] uppercase tracking-[0.1em] text-amber-500">stale</span>}
        <div className="ml-auto flex items-center gap-2 text-[hsl(var(--pv-text-faint))]">
          <button onClick={toggleLock} title={node.authoring.locked ? "unlock" : "lock"} className={node.authoring.locked ? "text-[hsl(var(--pv-accent))]" : "hover:text-foreground"}>
            {node.authoring.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
          </button>
          <button onClick={remove} title="delete" className="text-[11px] hover:text-destructive/70">✕</button>
        </div>
      </div>
      <div className="space-y-1.5">
        {fields.map((fld) => {
          const val = drafts[fld.key] ?? getPath(node.content, fld.key);
          return (
            <label key={fld.key} className="block">
              <span className="pv-mono text-[9px] uppercase tracking-[0.1em] text-[hsl(var(--pv-text-faint))]">{fld.label}</span>
              <AutoTextarea
                value={val}
                disabled={node.authoring.locked}
                onChange={(e) => setDrafts((d) => ({ ...d, [fld.key]: e.target.value }))}
                onBlur={() => { const v = drafts[fld.key]; if (v != null && v !== getPath(node.content, fld.key)) void save(deepMerge(node.content as Record<string, unknown>, setPath(fld.key, v))); }}
                placeholder="—"
                className="pv-serif w-full resize-none border-0 border-b border-transparent bg-transparent px-0 py-0.5 text-[14px] leading-snug text-foreground outline-none focus:border-[hsl(var(--pv-accent))]/40 focus-visible:ring-0 disabled:opacity-60"
              />
            </label>
          );
        })}
      </div>
    </div>
  );
}

function AddLink({ onClick, label, busy }: { onClick: () => void; label: string; busy?: boolean }) {
  return (
    <button onClick={onClick} disabled={busy} className="pv-serif flex items-center gap-1.5 text-[12px] italic text-[hsl(var(--pv-text-faint))] hover:text-[hsl(var(--pv-accent))]">
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} {label}
    </button>
  );
}

function AddMenu({ kinds, onAdd }: { kinds: [NodeKind, number][]; onAdd: (k: NodeKind, level: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      {kinds.map(([k, l]) => (
        <button key={k} onClick={() => onAdd(k, l)} className="pv-serif text-[12px] italic text-[hsl(var(--pv-text-faint))] hover:text-[hsl(var(--pv-accent))]">+ {k}</button>
      ))}
    </div>
  );
}
