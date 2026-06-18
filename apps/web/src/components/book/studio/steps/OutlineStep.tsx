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
import { ActionLink, Eyebrow, GenerateInChat, Panel } from "../studioUi";
import type { Movement } from "../studioModel";
import type { MapPage } from "@/lib/planGraph";

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
  // ── Empty state ─────────────────────────────────────────────────────────────
  if (!model.hasScaffold) {
    return (
      <EmptyOutline bookId={bookId} onChanged={onChanged} />
    );
  }

  // ── Lints banner ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {model.lints.length > 0 && (
        <div className="rounded-2xl border border-amber-500/40 bg-[hsl(var(--pv-surface-2))]/40 px-5 py-4">
          <div className="pv-mono mb-2 text-[10px] uppercase tracking-[0.14em] text-[hsl(var(--pv-text-muted))]">
            Flags · {model.lints.filter((l) => l.severity === "error").length} need attention
          </div>
          <div className="space-y-1.5">
            {model.lints.map((l, i) => (
              <div key={`${l.rule}-${i}`} className="flex items-baseline gap-2.5">
                <span
                  className={`h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full ${
                    l.severity === "error" ? "bg-amber-500" : "bg-[hsl(var(--pv-text-faint))]"
                  }`}
                  aria-hidden
                />
                <span className="pv-serif flex-1 text-[13px] leading-snug text-[hsl(var(--pv-text-muted))]">
                  {l.message}
                </span>
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
      )}

      {/* Movements (chapters and their pages) */}
      {model.movements.map((m) => (
        <MovementBlock
          key={m.key}
          bookId={bookId}
          movement={m}
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

// ── Movement block (a chapter and its pages) ──────────────────────────────────

function MovementBlock({
  bookId,
  movement,
  tentpolePageIds,
  onSelectPage,
  onChanged,
}: {
  bookId: number;
  movement: Movement;
  tentpolePageIds: Set<number>;
  onSelectPage: (id: number) => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();

  // Section pages have key = "mv-{pageId}"; the lead implicit group has key = "mv-lead".
  const sectionPageId: number | null =
    movement.key !== "mv-lead" ? parseInt(movement.key.replace("mv-", ""), 10) : null;
  const isSection = sectionPageId !== null;

  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const displayTitle = titleDraft ?? movement.title;

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
    if (!window.confirm(`Delete the chapter "${movement.title}" and all its pages?`)) return;
    try {
      // Archive the section page itself
      await supabase.from("pages").update({ archived: true }).eq("id", sectionPageId!);
      // Archive all pages in this movement
      for (const p of movement.pages) {
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
              {movement.num ? `${movement.num} ·` : ""}
            </Eyebrow>
            <input
              value={displayTitle}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => {
                const val = titleDraft ?? movement.title;
                setTitleDraft(null);
                if (val !== movement.title) void saveTitle(val);
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

      {/* Pages inside the movement */}
      <div className="space-y-2">
        {movement.pages.map((p) => (
          <PageRow
            key={p.id}
            bookId={bookId}
            page={p}
            tentpole={tentpolePageIds.has(p.id)}
            onSelectPage={onSelectPage}
            onChanged={onChanged}
          />
        ))}
        {movement.pages.length === 0 && (
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
