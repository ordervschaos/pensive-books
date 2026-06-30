// OutlineStep — the Outline step's Stage body.
//
// Chat-first redesign: the center is a near-manual editor.
// Generation and options live in the right-rail ReviseChat (layer="outline").
// When empty, a calm pointer + manual "add page / add chapter" affordances let the
// author start by hand without touching the chat.
//
// Removed: ScaffoldGenerator (generation → chat), DurableReviser + DurableOptions
//           (per-page AI → chat).
// Kept:    lints banner, "open page →", tentpole ◆ marker.
import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { useToast } from "@/hooks/use-toast";
import { saveObjective } from "@/lib/ladder";
import { ActionLink, Eyebrow, GenerateInChat, Panel } from "@/components/book/shared/studioUi";
import type { Act, StudioModel } from "../studioModel";
import type { MapPage } from "@/lib/planGraph";
import type { BookLint } from "@/lib/lints";
import {
  mutateOutline, reconcile, withNodeAdded, withNodePatch, withNodesRemoved,
  type Outline, type OutlineNode,
} from "@/lib/outline";

export function OutlineStep({
  bookId,
  model,
  onChanged,
  onSelectPage,
}: {
  bookId: number;
  model: import("../studioModel").StudioModel;
  onChanged: () => void;
  onSelectPage: (pageId: number) => void;
}) {
  // Structure-as-render (docs/structure-as-render.md): once a book has a books.outline, the outline IS
  // the editing surface — edits rewrite JSON (cheap, no page churn) and pages are rendered on demand.
  if (model.outline) {
    return <OutlineNative bookId={bookId} model={model} onChanged={onChanged} onSelectPage={onSelectPage} />;
  }

  // ── Legacy (page-native) empty state ────────────────────────────────────────
  if (!model.hasScaffold) {
    return (
      <EmptyOutline bookId={bookId} onChanged={onChanged} />
    );
  }

  // ── Lints banner ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      <LintsBanner lints={model.lints} onSelectPage={onSelectPage} />

      {/* Acts (chapters and their pages) */}
      {model.acts.map((m) => (
        <ActBlock
          key={m.key}
          bookId={bookId}
          act={m}
          tentpolePageIds={model.tentpolePageIds}
          onSelectPage={onSelectPage}
          onChanged={onChanged}
        />
      ))}

      {/* Add affordances at the bottom of the list */}
      <AddAffordances bookId={bookId} onChanged={onChanged} />

      <p className="pv-serif px-1 text-[13px] italic text-[hsl(var(--pv-text-faint))]">
        Edit titles and objectives inline — open any page for the full ladder.
      </p>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyOutline({ bookId, onChanged }: { bookId: number; onChanged: () => void }) {
  return (
    <div className="space-y-4">
      <p className="pv-serif text-[15px] italic leading-relaxed text-[hsl(var(--pv-text-faint))]">
        No outline yet.
      </p>
      <GenerateInChat bookId={bookId} layer="outline" label="Draft the outline" />
      <p className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))]">
        Or start by hand — add a page or a chapter below.
      </p>
      <AddAffordances bookId={bookId} onChanged={onChanged} />
    </div>
  );
}

// ── Add-page / add-chapter affordances ───────────────────────────────────────

function AddAffordances({ bookId, onChanged }: { bookId: number; onChanged: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const createPage = async (pageType: "text" | "section") => {
    if (busy) return;
    setBusy(true);
    try {
      const { data: newPage, error } = await supabase
        .rpc("create_next_page", { p_book_id: bookId })
        .select()
        .single();
      if (error) throw error;
      const newId = (newPage as { id: number }).id;
      const { error: upErr } = await supabase
        .from("pages")
        .update({ page_type: pageType, title: pageType === "section" ? "New chapter" : "New page" })
        .eq("id", newId);
      if (upErr) throw upErr;
      onChanged();
    } catch (e) {
      toast({
        title: `Couldn't add ${pageType === "section" ? "chapter" : "page"}`,
        description: String((e as Error)?.message ?? e),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-5 px-1">
      <ActionLink
        icon={<Plus className="h-3.5 w-3.5" />}
        busy={busy}
        onClick={() => void createPage("text")}
      >
        add a page
      </ActionLink>
      <ActionLink
        tone="muted"
        icon={<Plus className="h-3.5 w-3.5" />}
        busy={busy}
        onClick={() => void createPage("section")}
      >
        add a chapter
      </ActionLink>
    </div>
  );
}

// ── Act block (a chapter and its pages) ──────────────────────────────────

function ActBlock({
  bookId,
  act,
  tentpolePageIds,
  onSelectPage,
  onChanged,
}: {
  bookId: number;
  act: Act;
  tentpolePageIds: Set<number>;
  onSelectPage: (id: number) => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();

  // Section pages have key = "mv-{pageId}"; the lead implicit group has key = "mv-lead".
  const sectionPageId: number | null =
    act.key !== "mv-lead" ? parseInt(act.key.replace("mv-", ""), 10) : null;
  const isSection = sectionPageId !== null;

  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const displayTitle = titleDraft ?? act.title;

  const saveTitle = async (value: string) => {
    if (!isSection) return;
    const trimmed = value.trim();
    try {
      await supabase.from("pages").update({ title: trimmed || null }).eq("id", sectionPageId!);
      onChanged();
    } catch (e) {
      toast({
        title: "Couldn't save chapter name",
        description: String((e as Error)?.message ?? e),
        variant: "destructive",
      });
    }
  };

  const deleteChapter = async () => {
    if (!isSection) return;
    if (!window.confirm(`Delete the chapter "${act.title}" and all its pages?`)) return;
    try {
      // Archive the section page itself
      await supabase.from("pages").update({ archived: true }).eq("id", sectionPageId!);
      // Archive all pages in this act
      for (const p of act.pages) {
        await supabase.from("pages").update({ archived: true }).eq("id", p.id);
      }
      onChanged();
    } catch (e) {
      toast({
        title: "Couldn't delete chapter",
        description: String((e as Error)?.message ?? e),
        variant: "destructive",
      });
    }
  };

  return (
    <Panel variant="soft" className="px-5 py-4">
      {/* Chapter header */}
      <div className="mb-3 flex items-center justify-between gap-2">
        {isSection ? (
          <div className="group flex min-w-0 flex-1 items-center gap-2">
            <Eyebrow tone="accent" className="shrink-0">
              {act.num ? `${act.num} ·` : ""}
            </Eyebrow>
            <input
              value={displayTitle}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => {
                const val = titleDraft ?? act.title;
                setTitleDraft(null);
                if (val !== act.title) void saveTitle(val);
              }}
              className="pv-serif min-w-0 flex-1 border-b border-transparent bg-transparent text-[13px] font-medium uppercase tracking-[0.1em] text-[hsl(var(--pv-accent))] outline-none transition-colors hover:border-[hsl(var(--pv-border-soft))] focus:border-[hsl(var(--pv-accent))]/40"
            />
          </div>
        ) : (
          <Eyebrow tone="accent">Pages</Eyebrow>
        )}
        {isSection && (
          <button
            type="button"
            onClick={() => void deleteChapter()}
            className="shrink-0 text-[hsl(var(--pv-text-faint))] transition-colors hover:text-destructive/70"
            aria-label="Delete chapter"
            title="Delete chapter"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Pages inside the act */}
      <div className="space-y-2">
        {act.pages.map((p) => (
          <PageRow
            key={p.id}
            bookId={bookId}
            page={p}
            tentpole={tentpolePageIds.has(p.id)}
            onSelectPage={onSelectPage}
            onChanged={onChanged}
          />
        ))}
        {act.pages.length === 0 && (
          <p className="pv-serif px-1 text-[13px] italic text-[hsl(var(--pv-text-faint))]">
            No pages yet — add one below.
          </p>
        )}
      </div>
    </Panel>
  );
}

// ── Editable page row ─────────────────────────────────────────────────────────

function PageRow({
  bookId,
  page,
  tentpole,
  onSelectPage,
  onChanged,
}: {
  bookId: number;
  page: MapPage;
  tentpole?: boolean;
  onSelectPage: (id: number) => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();

  // Title editing
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const displayTitle = titleDraft ?? (page.title ?? "");

  const saveTitle = async (value: string) => {
    const trimmed = value.trim();
    if (trimmed === (page.title ?? "").trim()) return;
    try {
      await supabase.from("pages").update({ title: trimmed || null }).eq("id", page.id);
      onChanged();
    } catch (e) {
      toast({
        title: "Couldn't save page title",
        description: String((e as Error)?.message ?? e),
        variant: "destructive",
      });
    }
  };

  // Objective editing
  const [objectiveDraft, setObjectiveDraft] = useState<string | null>(null);
  useEffect(() => { setObjectiveDraft(null); }, [page.objectiveText]);
  const displayObjective = objectiveDraft ?? page.objectiveText;

  const saveObj = async (value: string) => {
    const trimmed = value.trim();
    if (trimmed === page.objectiveText.trim()) return;
    try {
      await saveObjective(bookId, page.id, trimmed);
      onChanged();
    } catch (e) {
      toast({
        title: "Couldn't save objective",
        description: String((e as Error)?.message ?? e),
        variant: "destructive",
      });
      throw e;
    }
  };

  // Delete
  const deletePage = async () => {
    if (!window.confirm(`Delete "${page.title || "this page"}"?`)) return;
    try {
      await supabase.from("pages").update({ archived: true }).eq("id", page.id);
      onChanged();
    } catch (e) {
      toast({
        title: "Couldn't delete page",
        description: String((e as Error)?.message ?? e),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="group rounded-lg border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/30 px-3.5 py-3">
      {/* Title row */}
      <div className="flex items-center gap-2">
        {tentpole && (
          <span
            className="shrink-0 text-[hsl(var(--pv-accent))]"
            title="A tentpole moment lands here"
            aria-hidden
          >
            ◆
          </span>
        )}
        <input
          value={displayTitle}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={() => {
            const val = titleDraft ?? (page.title ?? "");
            setTitleDraft(null);
            void saveTitle(val);
          }}
          placeholder="(untitled)"
          className="pv-serif min-w-0 flex-1 border-b border-transparent bg-transparent text-[15.5px] leading-snug text-foreground outline-none transition-colors hover:border-[hsl(var(--pv-border-soft))] focus:border-[hsl(var(--pv-accent))]/40"
        />
        <div className="flex shrink-0 items-center gap-3 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={() => onSelectPage(page.id)}
            className="pv-serif text-[12px] italic text-[hsl(var(--pv-text-faint))] transition-colors hover:text-[hsl(var(--pv-accent))]"
          >
            open →
          </button>
          <button
            type="button"
            onClick={() => void deletePage()}
            className="text-[hsl(var(--pv-text-faint))] transition-colors hover:text-destructive/70"
            aria-label="Delete page"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Objective */}
      <AutoTextarea
        value={displayObjective}
        onChange={(e) => setObjectiveDraft(e.target.value)}
        onBlur={() => {
          const val = objectiveDraft ?? page.objectiveText;
          setObjectiveDraft(null);
          void saveObj(val);
        }}
        placeholder="What this page must do — the objective…"
        className="pv-serif mt-1.5 w-full border-b border-transparent bg-transparent px-0 py-0 text-[13px] italic leading-snug text-[hsl(var(--pv-text-muted))] outline-none transition-colors placeholder:text-[hsl(var(--pv-text-faint))]/60 hover:border-[hsl(var(--pv-border-soft))] focus:border-[hsl(var(--pv-accent))]/30 focus-visible:ring-0"
      />
    </div>
  );
}

// ── Shared: lints banner ──────────────────────────────────────────────────────

function LintsBanner({ lints, onSelectPage }: { lints: BookLint[]; onSelectPage: (id: number) => void }) {
  const [dismissed, setDismissed] = useState(false);
  if (!lints.length || dismissed) return null;
  return (
    <div className="rounded-2xl border border-amber-500/40 bg-[hsl(var(--pv-surface-2))]/40 px-5 py-4">
      <div className="pv-mono mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-[hsl(var(--pv-text-muted))]">
        <span>Flags · {lints.filter((l) => l.severity === "error").length} need attention</span>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="ml-3 text-[hsl(var(--pv-text-faint))] hover:text-[hsl(var(--pv-text-muted))]"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
      <div className="space-y-1.5">
        {lints.map((l, i) => (
          <div key={`${l.rule}-${i}`} className="flex items-baseline gap-2.5">
            <span
              className={`h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full ${
                l.severity === "error" ? "bg-amber-500" : "bg-[hsl(var(--pv-text-faint))]"
              }`}
              aria-hidden
            />
            <span className="pv-serif flex-1 text-[13px] leading-snug text-[hsl(var(--pv-text-muted))]">{l.message}</span>
            {l.pageId != null && (
              <button
                type="button"
                onClick={() => onSelectPage(l.pageId!)}
                className="pv-serif shrink-0 text-[12px] italic text-[hsl(var(--pv-text-faint))] hover:text-[hsl(var(--pv-accent))]"
              >
                open →
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Outline-native rendering (structure-as-render) ────────────────────────────
// The outline (books.outline) is the editing surface: inline edits rewrite the JSON (cheap, no page
// churn); pages are a render produced on demand by reconcile(). See docs/structure-as-render.md.

const ROMAN: [number, string][] = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
function roman(n: number): string { let o = ""; let v = n; for (const [d, s] of ROMAN) while (v >= d) { o += s; v -= d; } return o; }

interface OutlineActVM { sectionId: string | null; num: string; title: string; scenes: OutlineNode[] }
type Apply = (label: string, fn: (o: Outline) => Outline) => Promise<void>;

function OutlineNative({ bookId, model, onChanged, onSelectPage }: {
  bookId: number; model: StudioModel; onChanged: () => void; onSelectPage: (id: number) => void;
}) {
  const { toast } = useToast();
  const outline = model.outline!;
  const nodes = outline.nodes;

  // Group nodes into acts: a section opens a chapter; scenes before any section sit in a lead group.
  const acts: OutlineActVM[] = [];
  let n = 0;
  for (const node of nodes) {
    if (node.type === "section") { n += 1; acts.push({ sectionId: node.id, num: roman(n), title: node.title, scenes: [] }); }
    else {
      if (!acts.length) acts.push({ sectionId: null, num: "", title: "Pages", scenes: [] });
      acts[acts.length - 1].scenes.push(node);
    }
  }

  const apply: Apply = async (label, fn) => {
    try { await mutateOutline(bookId, fn); onChanged(); }
    catch (e) { toast({ title: label, description: String((e as Error)?.message ?? e), variant: "destructive" }); }
  };
  const addNode = (type: "scene" | "section") =>
    apply(`Couldn't add ${type === "section" ? "chapter" : "page"}`, (o) =>
      withNodeAdded(o, { type, title: type === "section" ? "New chapter" : "New page", objective: "" })[0]);

  return (
    <div className="space-y-3">
      <LintsBanner lints={model.lints} onSelectPage={onSelectPage} />
      {model.outlineAhead && <RenderBanner bookId={bookId} onChanged={onChanged} />}

      {nodes.length === 0 ? (
        <div className="space-y-4">
          <p className="pv-serif text-[15px] italic leading-relaxed text-[hsl(var(--pv-text-faint))]">
            Empty outline — add a page or chapter below, or draft it in the chat.
          </p>
          <GenerateInChat bookId={bookId} layer="outline" label="Draft the outline" />
        </div>
      ) : (
        acts.map((m) => (
          <OutlineActBlock key={m.sectionId ?? "lead"} act={m} model={model} onSelectPage={onSelectPage} apply={apply} />
        ))
      )}

      <div className="flex items-center gap-5 px-1">
        <ActionLink icon={<Plus className="h-3.5 w-3.5" />} onClick={() => void addNode("scene")}>add a page</ActionLink>
        <ActionLink tone="muted" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => void addNode("section")}>add a chapter</ActionLink>
      </div>
      <p className="pv-serif px-1 text-[13px] italic text-[hsl(var(--pv-text-faint))]">
        Edit titles and objectives inline — changes stay in the plan until you render pages.
      </p>
    </div>
  );
}

function RenderBanner({ bookId, onChanged }: { bookId: number; onChanged: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = await reconcile(bookId);
      onChanged();
      toast({ title: "Pages rendered", description: `${r.created} added · ${r.updated} updated · ${r.archived} archived.` });
    } catch (e) {
      toast({ title: "Couldn't render pages", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally { setBusy(false); }
  };
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-[hsl(var(--pv-accent))]/30 bg-[hsl(var(--pv-accent))]/[0.06] px-5 py-3">
      <span className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-muted))]">
        The outline has changes that aren’t in the pages yet.
      </span>
      <ActionLink busy={busy} onClick={() => void run()}>render pages →</ActionLink>
    </div>
  );
}

function OutlineActBlock({ act, model, onSelectPage, apply }: {
  act: OutlineActVM; model: StudioModel; onSelectPage: (id: number) => void; apply: Apply;
}) {
  const isSection = act.sectionId !== null;
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const display = titleDraft ?? act.title;

  const saveTitle = (val: string) => {
    const t = val.trim();
    if (!isSection || t === act.title.trim()) return;
    void apply("Couldn't rename chapter", (o) => withNodePatch(o, act.sectionId!, { title: t || "Untitled chapter" }));
  };
  const deleteChapter = () => {
    if (!isSection) return;
    if (!window.confirm(`Delete the chapter “${act.title}” and its ${act.scenes.length} pages?`)) return;
    void apply("Couldn't delete chapter", (o) => withNodesRemoved(o, [act.sectionId!, ...act.scenes.map((s) => s.id)]));
  };

  return (
    <Panel variant="soft" className="px-5 py-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        {isSection ? (
          <div className="group flex min-w-0 flex-1 items-center gap-2">
            <Eyebrow tone="accent" className="shrink-0">{act.num ? `${act.num} ·` : ""}</Eyebrow>
            <input
              value={display}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => { const v = titleDraft ?? act.title; setTitleDraft(null); saveTitle(v); }}
              className="pv-serif min-w-0 flex-1 border-b border-transparent bg-transparent text-[13px] font-medium uppercase tracking-[0.1em] text-[hsl(var(--pv-accent))] outline-none transition-colors hover:border-[hsl(var(--pv-border-soft))] focus:border-[hsl(var(--pv-accent))]/40"
            />
          </div>
        ) : (
          <Eyebrow tone="accent">Pages</Eyebrow>
        )}
        {isSection && (
          <button
            type="button"
            onClick={deleteChapter}
            className="shrink-0 text-[hsl(var(--pv-text-faint))] transition-colors hover:text-destructive/70"
            aria-label="Delete chapter"
            title="Delete chapter"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="space-y-2">
        {act.scenes.map((node) => (
          <OutlineNodeRow key={node.id} node={node} page={model.pageByNodeId(node.id)} onSelectPage={onSelectPage} apply={apply} />
        ))}
        {act.scenes.length === 0 && (
          <p className="pv-serif px-1 text-[13px] italic text-[hsl(var(--pv-text-faint))]">No pages yet — add one below.</p>
        )}
      </div>
    </Panel>
  );
}

function OutlineNodeRow({ node, page, onSelectPage, apply }: {
  node: OutlineNode; page: MapPage | undefined; onSelectPage: (id: number) => void; apply: Apply;
}) {
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [objDraft, setObjDraft] = useState<string | null>(null);
  useEffect(() => { setObjDraft(null); }, [node.objective]);
  const dTitle = titleDraft ?? node.title;
  const dObj = objDraft ?? (node.objective ?? "");

  const saveTitle = (val: string) => {
    const t = val.trim();
    if (t === node.title.trim()) return;
    void apply("Couldn't save title", (o) => withNodePatch(o, node.id, { title: t }));
  };
  const saveObj = (val: string) => {
    const t = val.trim();
    if (t === (node.objective ?? "").trim()) return;
    void apply("Couldn't save objective", (o) => withNodePatch(o, node.id, { objective: t }));
  };
  const del = () => {
    if (!window.confirm(`Delete “${node.title || "this page"}”?`)) return;
    void apply("Couldn't delete page", (o) => withNodesRemoved(o, [node.id]));
  };

  // Render state from the last-rendered page (by node_id); a node added since the last render has none.
  const state = !page ? "unrendered" : page.prose !== "gap" ? "written" : page.beat !== "gap" ? "beat" : "objective";

  return (
    <div className="group rounded-lg border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/30 px-3.5 py-3">
      <div className="flex items-center gap-2">
        {node.tentpoleId && (
          <span className="shrink-0 text-[hsl(var(--pv-accent))]" title="A tentpole moment lands here" aria-hidden>◆</span>
        )}
        <input
          value={dTitle}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={() => { const v = titleDraft ?? node.title; setTitleDraft(null); saveTitle(v); }}
          placeholder="(untitled)"
          className="pv-serif min-w-0 flex-1 border-b border-transparent bg-transparent text-[15.5px] leading-snug text-foreground outline-none transition-colors hover:border-[hsl(var(--pv-border-soft))] focus:border-[hsl(var(--pv-accent))]/40"
        />
        <span className="pv-mono shrink-0 text-[9px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">{state}</span>
        <div className="flex shrink-0 items-center gap-3 opacity-0 transition-opacity group-hover:opacity-100">
          {page && (
            <button
              type="button"
              onClick={() => onSelectPage(page.id)}
              className="pv-serif text-[12px] italic text-[hsl(var(--pv-text-faint))] transition-colors hover:text-[hsl(var(--pv-accent))]"
            >
              open →
            </button>
          )}
          <button
            type="button"
            onClick={del}
            className="text-[hsl(var(--pv-text-faint))] transition-colors hover:text-destructive/70"
            aria-label="Delete page"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {node.type === "scene" && (
        <AutoTextarea
          value={dObj}
          onChange={(e) => setObjDraft(e.target.value)}
          onBlur={() => { const v = objDraft ?? (node.objective ?? ""); setObjDraft(null); saveObj(v); }}
          placeholder="What this page must do — the objective…"
          className="pv-serif mt-1.5 w-full border-b border-transparent bg-transparent px-0 py-0 text-[13px] italic leading-snug text-[hsl(var(--pv-text-muted))] outline-none transition-colors placeholder:text-[hsl(var(--pv-text-faint))]/60 hover:border-[hsl(var(--pv-border-soft))] focus:border-[hsl(var(--pv-accent))]/30 focus-visible:ring-0"
        />
      )}
    </div>
  );
}
