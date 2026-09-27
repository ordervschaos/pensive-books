// BookHeader — the "book" stop on the canvas: the book's own fields (title / subtitle / author), each
// editable in place, each paintable red/green when the agent has a staged book_edit for it.
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Eyebrow } from "@/components/book/shared/studioUi";
import { acceptChange, rejectChange, type ManuscriptBook, type ManuscriptChange, type ManuscriptPage } from "../../lib/manuscriptAgent";
import { wordCount, bodyText } from "../../lib/manuscriptText";
import { DEL, INS, Verdicts } from "./DiffView";

type BookEdit = Extract<ManuscriptChange, { kind: "book_edit" }>;
type Field = BookEdit["field"];
const FIELDS: { key: Field; label: string; cls: string; placeholder: string }[] = [
  { key: "name", label: "Title", cls: "text-[40px] leading-[1.05] tracking-[-0.02em]", placeholder: "Untitled" },
  { key: "subtitle", label: "Subtitle", cls: "text-[20px] italic leading-[1.35] text-[hsl(var(--pv-text-muted))]", placeholder: "No subtitle" },
  { key: "author", label: "Author", cls: "text-[16px] leading-[1.4] text-[hsl(var(--pv-text-muted))]", placeholder: "No author" },
];

function FieldRow({ bookId, field, value, edit, canEdit, busyId, onAccept, onReject }: {
  bookId: number; field: typeof FIELDS[number]; value: string; edit?: BookEdit; canEdit: boolean; busyId: string | null;
  onAccept: (c: BookEdit) => void; onReject: (c: BookEdit) => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  const save = async () => {
    const v = draft.trim();
    if (v === value.trim()) return;
    // The books row is the source of truth; Realtime brings the saved value back to the header.
    const { error } = await supabase.from("books").update({ [field.key]: v }).eq("id", bookId);
    if (error) toast({ title: `Couldn't save the ${field.label.toLowerCase()}`, description: error.message, variant: "destructive" });
  };
  if (edit) {
    const busy = busyId === edit.id;
    return (
      <div className="group relative" data-first-change>
        <Verdicts disabled={busy} className="absolute -left-14 top-1 opacity-0 transition-opacity group-hover:opacity-100" onAccept={() => onAccept(edit)} onReject={() => onReject(edit)} />
        <Eyebrow>{field.label}</Eyebrow>
        <p className={`pv-serif ${field.cls}`}>
          <span className={DEL}>{value || field.placeholder}</span> <span className={INS}>{edit.after}</span>
        </p>
        {edit.note && <p className="mt-1 pv-serif text-[12.5px] italic text-[hsl(var(--pv-text-faint))]">{edit.note}</p>}
      </div>
    );
  }
  return (
    <div>
      <Eyebrow>{field.label}</Eyebrow>
      <input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => void save()} disabled={!canEdit} placeholder={field.placeholder}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className={`block w-full bg-transparent pv-serif outline-none placeholder:text-[hsl(var(--pv-text-faint))] ${field.cls}`} />
    </div>
  );
}

export function BookHeader({ book, pages, bookEdits, runId, busyId, setBusyId, canEdit }: {
  book: ManuscriptBook; pages: ManuscriptPage[]; bookEdits: BookEdit[]; runId: number | null; busyId: string | null; setBusyId: (id: string | null) => void; canEdit: boolean;
}) {
  const { toast } = useToast();
  const words = pages.reduce((n, p) => n + (p.page_type === "text" ? wordCount(bodyText(p.content)) : 0), 0);
  const run = async (c: BookEdit, work: () => Promise<void>) => {
    if (busyId || !runId) return;
    setBusyId(c.id);
    try { await work(); }
    catch (e) { toast({ title: "Couldn't apply", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
    finally { setBusyId(null); }
  };
  return (
    <div className="space-y-7 pl-14">
      {FIELDS.map((f) => (
        <FieldRow key={f.key} bookId={book.id} field={f} value={(book[f.key] ?? "") as string} edit={bookEdits.find((e) => e.field === f.key)} canEdit={canEdit} busyId={busyId}
          onAccept={(c) => void run(c, () => acceptChange(book.id, runId!, c, pages))} onReject={(c) => void run(c, () => rejectChange(runId!, c, pages))} />
      ))}
      <p className="pv-mono text-[10px] uppercase tracking-[0.14em] text-[hsl(var(--pv-text-faint))]">{pages.length} pages · {words.toLocaleString()} words · {book.is_public ? "published" : "draft"}</p>
    </div>
  );
}
