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

const BRIDGE = import.meta.env.VITE_EVAL_BRIDGE_URL as string | undefined;

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
  const [drafting, setDrafting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [dirty, setDirty] = useState(false);
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

  // Drop an AI-generated markdown bible into the editor for review (not saved until Save).
  const applyDraft = (text: string) => {
    editor?.commands.setContent(text.trim());
    setDirty(true);
  };

  const draftFromBrief = async () => {
    if (editor?.getText().trim() && !window.confirm("Replace the current bible with an AI draft from the brief?")) return;
    try {
      setDrafting(true);
      let text: string;
      if (BRIDGE) {
        const r = await fetch(`${BRIDGE}/bible/${bookId}`, { method: "POST" });
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        text = String(d.text ?? "").trim();
      } else {
        const { data, error } = await supabase.functions.invoke("generate-bible", { body: { bookId } });
        if (error) throw error;
        if (!data?.text) throw new Error(data?.error || "No text returned");
        text = String(data.text).trim();
      }
      applyDraft(text);
      toast({ title: "Draft ready", description: "Review and edit, then Save." });
    } catch (e) {
      toast({ variant: "destructive", title: "Couldn't draft bible", description: String((e as Error)?.message ?? e) });
    } finally {
      setDrafting(false);
    }
  };

  // Read the actual manuscript and extract the bible from what the prose establishes (Haiku).
  const scanFromBook = async () => {
    if (editor?.getText().trim() && !window.confirm("Replace the current bible with one extracted from the manuscript?")) return;
    try {
      setScanning(true);
      const { data, error } = await supabase.functions.invoke("generate-bible", {
        body: { bookId, source: "manuscript" },
      });
      if (error) throw error;
      if (!data?.text) throw new Error(data?.error || "No text returned");
      applyDraft(String(data.text));
      toast({ title: "Bible extracted", description: "Pulled from the prose. Review and Save." });
    } catch (e) {
      toast({ variant: "destructive", title: "Couldn't scan the book", description: String((e as Error)?.message ?? e) });
    } finally {
      setScanning(false);
    }
  };

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
          <Button onClick={scanFromBook} disabled={busy} variant="outline" size="sm">
            {scanning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ScanText className="h-4 w-4 mr-2" />}
            {scanning ? "Scanning…" : "Scan the book"}
          </Button>
          <Button onClick={draftFromBrief} disabled={busy} variant="outline" size="sm">
            {drafting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            {drafting ? "Drafting…" : "Draft from brief"}
          </Button>
        </div>
      </div>

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
