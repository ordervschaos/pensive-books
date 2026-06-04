import { useEffect, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown, type MarkdownStorage } from "tiptap-markdown";
import {
  Sparkles,
  ScanText,
  Loader2,
  Bold,
  Italic,
  Heading1,
  Heading2,
  List,
  ListOrdered,
  Quote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useLatestTaskRow, type TaskRow } from "@/hooks/useLatestTaskRow";
import { BRIDGE, bridgeFetch } from "@/lib/bridge";

interface BibleRow extends TaskRow {
  input: { source?: "brief" | "manuscript" } | null;
  result: { text?: string } | null;
  error: string | null;
}

interface BookBibleSectionProps {
  bookId: number;
  /** Current bible text (books.bible.text), markdown. */
  bible: string | null;
  onBibleChange: (text: string) => void;
}

/** Minimal formatting toolbar for the bible editor — just what the bible vocabulary uses. */
function BibleToolbar({ editor }: { editor: Editor }) {
  // Re-render on selection / content change so active-state highlighting stays in sync.
  const [, force] = useState(0);
  useEffect(() => {
    const handler = () => force((n) => n + 1);
    editor.on("selectionUpdate", handler);
    editor.on("update", handler);
    return () => {
      editor.off("selectionUpdate", handler);
      editor.off("update", handler);
    };
  }, [editor]);

  const btn = (active: boolean) =>
    cn(
      "h-7 w-7 p-0 text-muted-foreground hover:text-foreground",
      active && "bg-muted text-foreground"
    );

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border/50 px-2 py-1">
      <Button variant="ghost" size="sm" className={btn(editor.isActive("heading", { level: 1 }))}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Heading 1">
        <Heading1 className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="sm" className={btn(editor.isActive("heading", { level: 2 }))}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2">
        <Heading2 className="h-4 w-4" />
      </Button>
      <span className="mx-1 h-4 w-px bg-border" aria-hidden />
      <Button variant="ghost" size="sm" className={btn(editor.isActive("bold"))}
        onClick={() => editor.chain().focus().toggleBold().run()} title="Bold">
        <Bold className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="sm" className={btn(editor.isActive("italic"))}
        onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic">
        <Italic className="h-4 w-4" />
      </Button>
      <span className="mx-1 h-4 w-px bg-border" aria-hidden />
      <Button variant="ghost" size="sm" className={btn(editor.isActive("bulletList"))}
        onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bulleted list">
        <List className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="sm" className={btn(editor.isActive("orderedList"))}
        onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list">
        <ListOrdered className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="sm" className={btn(editor.isActive("blockquote"))}
        onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Quote">
        <Quote className="h-4 w-4" />
      </Button>
    </div>
  );
}

/**
 * The book "bible" — established facts (characters, world, style) every page must stay
 * consistent with. Layer A of generation context, beyond the brief. Author-owned.
 *
 * Stored as markdown in `books.bible.text` (the format every AI consumer interpolates into its
 * prompt). The editor is a lightweight WYSIWYG surface over that markdown: tiptap-markdown parses
 * the stored text into the doc and serializes back via `getMarkdown()` on save. "Draft from brief"
 * / "Scan the book" seed a first version with AI; the author then edits.
 */
export function BookBibleSection({ bookId, bible, onBibleChange }: BookBibleSectionProps) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  // The AI draft is a durable book_generations row (kind 'bible'), watched over Realtime — so a
  // refresh resumes the loader and a finished draft is still offered for review. `input.source`
  // distinguishes "draft from brief" (Opus) from "scan the book" (Haiku).
  const { row, refetch } = useLatestTaskRow<BibleRow>({
    table: "book_generations",
    bookId,
    match: { kind: "bible" },
    activeStatuses: ["pending", "running"],
  });
  const drafting = (row?.status === "pending" || row?.status === "running") && row?.input?.source !== "manuscript";
  const scanning = (row?.status === "pending" || row?.status === "running") && row?.input?.source === "manuscript";
  const busy = drafting || scanning;

  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown.configure({ html: false, bulletListMarker: "-", tightLists: true, linkify: false, breaks: false }),
    ],
    content: bible ?? "",
    onUpdate: () => setDirty(true),
    editorProps: {
      attributes: {
        // `prose` is inert here (the typography plugin isn't registered app-wide), so style the
        // bible's block types explicitly to give headings and lists real visual hierarchy.
        class: cn(
          "max-w-none min-h-[240px] px-4 py-3 focus:outline-none leading-relaxed",
          "[&>*:first-child]:mt-0",
          "[&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mt-6 [&_h1]:mb-2 [&_h1]:leading-tight",
          "[&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-6 [&_h2]:mb-1.5 [&_h2]:leading-snug [&_h2]:tracking-tight",
          "[&_p]:my-1.5",
          "[&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-1.5",
          "[&_li]:my-0.5 [&_li>p]:my-0",
          "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted-foreground",
          "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em]"
        ),
      },
    },
  });

  const save = async () => {
    if (!editor) return;
    try {
      setSaving(true);
      const text = (editor.storage as unknown as { markdown: MarkdownStorage }).markdown.getMarkdown().trim();
      const { error } = await supabase
        .from("books")
        .update({ bible: text ? { text } : null })
        .eq("id", bookId);
      if (error) throw error;
      onBibleChange(text);
      setDirty(false);
      toast({ title: "Bible saved", description: "Facts the AI will keep consistent." });
    } catch (e) {
      toast({ variant: "destructive", title: "Couldn't save bible", description: String((e as Error)?.message ?? e) });
    } finally {
      setSaving(false);
    }
  };

  // Kick off an AI bible draft. The result lands asynchronously as a 'ready' book_generations row
  // (watched above) — so we don't await prose here; we just start the task and let the row drive UI.
  const startBible = async (source: "brief" | "manuscript") => {
    try {
      if (BRIDGE && source === "brief") {
        // Dev bridge writes the same book_generations row; just kick it and watch the row.
        await bridgeFetch(`/bible/${bookId}`, { method: "POST" }).catch(() => {});
      } else {
        const { error } = await supabase.functions.invoke("generate-bible", {
          body: { bookId, source },
        });
        if (error) throw error;
      }
      refetch();
    } catch (e) {
      toast({ variant: "destructive", title: "Couldn't start the bible draft", description: String((e as Error)?.message ?? e) });
    }
  };

  // A finished draft is waiting (survives refresh). Drop it into the editor for review (not saved
  // until Save), confirming first if the editor already has content. Then mark the row applied.
  const acceptDraft = async () => {
    const text = row?.result?.text?.trim();
    if (!text || !row) return;
    if (editor?.getText().trim() && !window.confirm("Replace the current bible with the AI draft?")) return;
    editor?.commands.setContent(text);
    setDirty(true);
    await supabase.from("book_generations").update({ status: "applied" }).eq("id", row.id);
    refetch();
    toast({ title: "Draft applied", description: "Review and edit, then Save." });
  };

  const discardDraft = async () => {
    if (row) await supabase.from("book_generations").update({ status: "dismissed" }).eq("id", row.id);
    refetch();
  };

  const readyDraft = row?.status === "ready" ? row.result?.text?.trim() : null;

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">Book bible</h2>
          <p className="text-sm text-muted-foreground">
            Established facts — characters, world, style — the AI keeps consistent across every page.
            Only you see this.
          </p>
        </div>
        <div className="flex flex-none flex-wrap items-center gap-2">
          <Button onClick={() => void startBible("manuscript")} disabled={busy} variant="outline" size="sm">
            {scanning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ScanText className="h-4 w-4 mr-2" />}
            {scanning ? "Scanning…" : "Scan the book"}
          </Button>
          <Button onClick={() => void startBible("brief")} disabled={busy} variant="outline" size="sm">
            {drafting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            {drafting ? "Drafting…" : "Draft from brief"}
          </Button>
        </div>
      </div>

      {row?.status === "error" && (
        <p className="text-sm text-red-600 dark:text-red-400">{row.error}</p>
      )}

      {readyDraft && (
        // A finished AI draft is waiting (survives refresh until applied or discarded).
        <div className="flex items-start justify-between gap-4 rounded-md border border-[hsl(var(--pv-accent))]/30 bg-[hsl(var(--pv-accent))]/[0.06] px-4 py-3">
          <p className="text-sm text-foreground">
            An AI bible draft{row?.input?.source === "manuscript" ? " (from the manuscript)" : " (from the brief)"} is ready
            — applying it replaces the editor's contents below. Review and Save when happy.
          </p>
          <div className="flex flex-none items-center gap-2">
            <Button onClick={() => void discardDraft()} variant="ghost" size="sm">Discard</Button>
            <Button onClick={() => void acceptDraft()} size="sm">Apply draft</Button>
          </div>
        </div>
      )}

      <div className="rounded-md border border-input bg-background focus-within:ring-1 focus-within:ring-ring">
        {editor && <BibleToolbar editor={editor} />}
        <EditorContent editor={editor} />
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving || !dirty}>
          {saving ? "Saving…" : "Save bible"}
        </Button>
      </div>
    </Card>
  );
}
