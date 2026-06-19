import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useBookPermissions } from "@/hooks/use-book-permissions";
import { setPageTitle } from "@/utils/pageTitle";
import { computeCompletion, type Brief } from "@/lib/brief";
import { BuildStudio, type Selection } from "@/components/book/studio/BuildStudio";
import { ALL_STEPS, type Journey, type StepKey } from "@/components/book/studio/studioModel";
import { PublishingDialog } from "@/components/book/PublishingDialog";
import { AdminViewBanner } from "@/components/book/AdminViewBanner";
import type { EditorJSON } from "@/types/editor";

interface StudioBookRecord {
  name: string;
  is_public: boolean;
  brief?: Brief | null;
  journey?: Partial<Record<string, string>> | null;
}

interface StudioBookPage {
  id: number;
  title?: string | null;
  page_index: number;
  updated_at?: string | null;
  content?: EditorJSON | null;
  page_type?: "text" | "section";
  metadata?: { objective?: string } | null;
}

const getNumericId = (param: string | undefined) => {
  if (!param) return 0;
  const match = param.match(/^(\d+)/);
  return match ? parseInt(match[1]) : 0;
};

// Turn a Selection | null into the URL suffix that follows /studio.
const selectionSuffix = (sel: Selection | null): string => {
  if (!sel) return "";
  if (sel.kind === "page") return `/page/${sel.pageId}`;
  return `/${sel.step}`;
};

// The Studio is the AI build surface, given the whole screen — fixed Navigator (left) and editor rail
// (right) around a scrolling Stage. It lives at /books/:slug/studio (author-only); the book page hosts
// the manuscript and links here via the "Studio" button. Data is a live projection of server state
// (refresh = no-op): a background AI run mutating books/pages re-reads via the realtime subscription.
const StudioPage = () => {
  const { bookSlug, step, pageId } = useParams();
  const navigate = useNavigate();

  // Derive the selection from URL params (null = follow derived current step).
  const urlSelection: Selection | null = useMemo(() => {
    const pid = pageId ? Number(pageId) : NaN;
    if (pageId && pid > 0) return { kind: "page", pageId: pid };
    if (step && ALL_STEPS.includes(step as StepKey)) return { kind: "step", step: step as StepKey };
    return null;
  }, [step, pageId]);
  const { toast } = useToast();
  const [book, setBook] = useState<StudioBookRecord | null>(null);
  const [pages, setPages] = useState<StudioBookPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPublishingDialogOpen, setIsPublishingDialogOpen] = useState(false);
  const { canEdit, hasAccess, viaAdmin, ownerLabel, loading: permissionsLoading } = useBookPermissions(bookSlug);

  const numericBookId = getNumericId(bookSlug);

  // Studio is author-only. Anyone who can't edit (collaborators, public readers) goes to the book page.
  useEffect(() => {
    if (permissionsLoading || !bookSlug) return;
    if (!hasAccess || !canEdit) navigate(`/books/${bookSlug}`, { replace: true });
  }, [permissionsLoading, hasAccess, canEdit, bookSlug, navigate]);

  const fetchBook = useCallback(async () => {
    try {
      const numericId = getNumericId(bookSlug);
      const { data: bookData, error: bookError } = await supabase
        .from("books")
        .select("*")
        .eq("id", numericId)
        .eq("is_archived", false)
        .single();
      if (bookError) throw bookError;

      // Canonicalize the slug (mirrors BookDetails) so the crumb + URL show the book name.
      // Preserve the current view suffix so a redirect doesn't drop the open step/page.
      if (bookData && !bookSlug?.includes("-") && bookData.name) {
        const slug = `${numericId}-${bookData.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
        navigate(`/books/${slug}/studio${selectionSuffix(urlSelection)}`, { replace: true });
      }

      setBook(bookData as StudioBookRecord);
      setPageTitle(`${bookData.name} · Studio`);

      const { data: pagesData, error: pagesError } = await supabase
        .from("pages")
        .select("*")
        .eq("book_id", numericId)
        .eq("archived", false)
        .order("page_index", { ascending: true });
      if (pagesError) throw pagesError;
      setPages((pagesData || []) as StudioBookPage[]);
    } catch (error: unknown) {
      console.error("Error fetching book for studio:", error);
      toast({
        variant: "destructive",
        title: "Error fetching book",
        description: error instanceof Error ? error.message : "Failed to fetch book",
      });
    } finally {
      setLoading(false);
    }
  }, [bookSlug, navigate, toast, urlSelection]);

  useEffect(() => {
    void fetchBook();
  }, [fetchBook]);

  // Keep book + pages live. A background AI run advances the journey / writes pages server-side; without
  // this the snapshot goes stale. Debounced so a build's burst of page writes coalesces into one read.
  useEffect(() => {
    if (!numericBookId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refetchSoon = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void fetchBook(); }, 500);
    };
    const channel = supabase
      .channel(`studio_${numericBookId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "pages", filter: `book_id=eq.${numericBookId}` }, refetchSoon)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "books", filter: `id=eq.${numericBookId}` }, refetchSoon)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [numericBookId, fetchBook]);

  if (loading || permissionsLoading || !hasAccess || !canEdit || !book) {
    return null;
  }

  const briefSet = computeCompletion(book.brief ?? null) > 0;
  const journey = (book.journey as Journey | null) ?? {};

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden bg-background">
      <Helmet>
        <title>{book.name} · Studio | Pensive</title>
      </Helmet>

      {viaAdmin && (
        <div className="shrink-0 px-6 pt-4 md:px-8">
          <AdminViewBanner ownerLabel={ownerLabel} />
        </div>
      )}

      <div className="min-h-0 flex-1">
        <BuildStudio
          bookId={numericBookId}
          briefSet={briefSet}
          brief={book.brief ?? null}
          pages={pages}
          journey={journey as never}
          isPublic={book.is_public}
          selection={urlSelection}
          onSelect={(sel) => navigate(`/books/${bookSlug}/studio${selectionSuffix(sel)}`)}
          onBriefChange={(brief) => setBook((b) => (b ? { ...b, brief } : b))}
          onChanged={fetchBook}
          onPublish={() => setIsPublishingDialogOpen(true)}
        />
      </div>

      <PublishingDialog
        bookId={numericBookId}
        bookName={book.name}
        isPublic={book.is_public}
        open={isPublishingDialogOpen}
        onOpenChange={setIsPublishingDialogOpen}
        onSuccess={fetchBook}
      />
    </div>
  );
};

export default StudioPage;
