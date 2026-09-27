// PageEditor — the in-place editor for a page with no staged edit: the same TipTap config the page
// editor uses (getEditorConfig), no toolbar, debounced autosave. Keyed by page id by its host, so a
// page switch remounts it. External updates (another tab, an accepted change) are applied only while
// the editor isn't focused, so they can never overwrite what the author is typing.
import { useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { debounce } from "lodash";
import { useNavigate } from "react-router-dom";
import { getEditorConfig } from "@/components/editor/config/editorConfig";
import { useSupabaseUpload } from "@/hooks/use-supabase-upload";
import { useToast } from "@/hooks/use-toast";
import type { EditorJSON } from "@/types/editor";
import { docTitle } from "../../lib/manuscriptText";
import { savePageDoc, type ManuscriptPage } from "../../lib/manuscriptAgent";

// Key-sorted JSON, so a doc and its jsonb round-trip compare equal.
function canon(v: unknown): string {
  return JSON.stringify(v, (_k, val) => (val && typeof val === "object" && !Array.isArray(val) ? Object.fromEntries(Object.keys(val).sort().map((k) => [k, (val as Record<string, unknown>)[k]])) : val));
}

export function PageEditor({ page, bookId, editable, onSaving }: { page: ManuscriptPage; bookId: number; editable: boolean; onSaving?: (saving: boolean) => void }) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const uploadImage = useSupabaseUpload();
  const saveRef = useRef<ReturnType<typeof debounce> | null>(null);

  useEffect(() => {
    saveRef.current = debounce(async (json: EditorJSON | null) => {
      if (!json) return;
      onSaving?.(true);
      try { await savePageDoc(page.id, json, docTitle(json)); }
      catch (e) { toast({ title: "Couldn't save the page", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
      finally { onSaving?.(false); }
    }, 400);
    return () => { saveRef.current?.flush(); };
  }, [page.id, onSaving, toast]);

  // `known` = the doc this editor and the server agree on (as JSON text). The editor's own edits
  // advance it; a server-side change is taken only when the editor hasn't diverged from it — i.e.
  // there are no unsaved local edits to protect. Focus is NOT the test: the editor autofocuses on
  // mount, and a focused-but-untouched editor holding a pre-accept snapshot would otherwise keep
  // stale text and, on the next keystroke, save it back over the accepted change.
  // (jsonb canonicalises key order, so equality is over a key-sorted serialisation.)
  const known = useRef<string>(canon(page.content));
  const dirty = useRef(false); // local edits since the last time editor and server agreed
  const editor = useEditor(
    getEditorConfig(page.content, (json) => { dirty.current = true; known.current = canon(json); saveRef.current?.(json); }, editable, editable, uploadImage, String(bookId), (pid, bid) => navigate(`/books/${bid}/pages/${pid}`)),
    [page.id, editable],
  );
  useEffect(() => {
    if (!editor) return;
    const incoming = canon(page.content);
    if (incoming === known.current) { dirty.current = false; return; } // our own save echoed back (or nothing moved)
    if (dirty.current) return; // unsaved local edits — never clobber the author mid-keystroke
    known.current = incoming;
    editor.commands.setContent(page.content ?? { type: "doc", content: [] });
  }, [editor, page.content]);

  return (
    <EditorContent editor={editor}
      className="pv-serif text-[17px] leading-[1.7] text-foreground [&_.ProseMirror]:min-h-[40vh] [&_.ProseMirror]:outline-none [&_.ProseMirror_h1]:mb-6 [&_.ProseMirror_h1]:text-[34px] [&_.ProseMirror_h1]:leading-[1.15] [&_.ProseMirror_h1]:tracking-[-0.015em] [&_.ProseMirror_h2]:mt-8 [&_.ProseMirror_h2]:text-[24px] [&_.ProseMirror_p]:my-4" />
  );
}
