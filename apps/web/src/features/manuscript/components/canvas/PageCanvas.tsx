// PageCanvas — one page on the agent canvas. Three states:
//   staged deletion  → the page, red-tinted, with an accept/reject banner
//   staged edit      → the title diff + DiffView (word/block grains) + the page-level Accept/Reject bar
//   nothing staged   → the in-place editor
// Every accept here writes through lib/manuscriptAgent (resolvePartial / acceptChange / rejectChange).
import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Trash2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { countUnits, decideAll, diffBody, resolve, type Decision } from "../../lib/manuscriptDiff";
import { bodyText, wordCount } from "../../lib/manuscriptText";
import { acceptChange, rejectChange, resolvePartial, type ManuscriptChange, type ManuscriptPage } from "../../lib/manuscriptAgent";
import { DEL, DiffView, INS, Verdicts } from "./DiffView";
import { PageEditor } from "./PageEditor";

type PageEdit = Extract<ManuscriptChange, { kind: "page_edit" }>;
type PageDelete = Extract<ManuscriptChange, { kind: "page_delete" }>;
type PageAdd = Extract<ManuscriptChange, { kind: "page_add" }>;

const Bar = ({ tone, children }: { tone: "red" | "green" | "accent"; children: React.ReactNode }) => (
  <div className={`mb-6 flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-2.5 ${tone === "red" ? "border-red-500/40 bg-red-500/[0.06]" : tone === "green" ? "border-green-600/40 bg-green-500/[0.06]" : "border-[hsl(var(--pv-accent))]/40 bg-[hsl(var(--pv-accent))]/[0.06]"}`}>
    {children}
  </div>
);
const BarButton = ({ onClick, tone, busy, children }: { onClick: () => void; tone: "accept" | "reject"; busy?: boolean; children: React.ReactNode }) => (
  <button type="button" disabled={busy} onClick={onClick}
    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 pv-serif text-[13px] transition-colors disabled:opacity-40 ${tone === "accept" ? "bg-green-600 text-white hover:bg-green-700" : "border border-red-500/50 text-red-600 hover:bg-red-500/10"}`}>
    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : tone === "accept" ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}{children}
  </button>
);

export function PageCanvas({ page, edit, del, bookId, runId, pages, busyId, setBusyId, onSaving, canEdit }: {
  page: ManuscriptPage; edit?: PageEdit; del?: PageDelete; bookId: number; runId: number | null; pages: ManuscriptPage[];
  busyId: string | null; setBusyId: (id: string | null) => void; onSaving?: (saving: boolean) => void; canEdit: boolean;
}) {
  const { toast } = useToast();
  const liveBody = useMemo(() => bodyText(page.content), [page.content]);
  const liveTitle = (page.title ?? "").trim();
  const diff = useMemo(() => (edit ? diffBody(liveBody, edit.after) : []), [edit, liveBody]);
  const units = countUnits(diff) + (edit?.title != null ? 1 : 0);
  // Scroll the first change into view when a staged page opens (the changes panel's "go to first change").
  useEffect(() => {
    if (!edit) return;
    const el = document.querySelector("[data-first-change]");
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [edit?.id, page.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (id: string, work: () => Promise<void>, okMsg?: string) => {
    if (busyId || !runId) return;
    setBusyId(id);
    try { await work(); if (okMsg) toast({ title: okMsg }); }
    catch (e) { toast({ title: "Couldn't apply", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
    finally { setBusyId(null); }
  };
  const decide = (d: Decision[]) => edit && run(edit.id, () => resolvePartial(runId!, edit, page, resolve(diff, d)));
  const decideTitle = (v: "accept" | "reject") => edit && run(edit.id, () => resolvePartial(runId!, edit, page, resolve(diff, []), v));
  const acceptPage = () => edit && run(edit.id, () => resolvePartial(runId!, edit, page, resolve(diff, decideAll(diff, "accept")), edit.title != null ? "accept" : undefined), "Page updated");
  const rejectPage = () => edit && run(edit.id, () => rejectChange(runId!, edit, pages));

  if (del) {
    return (
      <div>
        <Bar tone="red">
          <Trash2 className="h-4 w-4 text-red-600" />
          <span className="pv-serif flex-1 text-[13.5px] text-foreground">The agent proposes <b>deleting this page</b>.{del.note && <span className="italic text-[hsl(var(--pv-text-muted))]"> {del.note}</span>}</span>
          <BarButton tone="accept" busy={busyId === del.id} onClick={() => void run(del.id, () => acceptChange(bookId, runId!, del, pages), "Page deleted")}>Delete</BarButton>
          <BarButton tone="reject" busy={busyId === del.id} onClick={() => void run(del.id, () => rejectChange(runId!, del, pages))}>Keep</BarButton>
        </Bar>
        <div className="pointer-events-none opacity-70">
          <h1 className={`mb-6 pv-serif text-[34px] leading-[1.15] tracking-[-0.015em] ${DEL}`}>{liveTitle || "Untitled"}</h1>
          <div className={`space-y-5 whitespace-pre-wrap pv-serif text-[17px] leading-[1.7] ${DEL}`}>{liveBody}</div>
        </div>
      </div>
    );
  }

  if (edit) {
    const busy = busyId === edit.id;
    return (
      <div>
        <Bar tone="accent">
          <span className="pv-serif flex-1 text-[13.5px] text-foreground">
            <b>{units}</b> change{units === 1 ? "" : "s"} proposed on this page{edit.note && <span className="italic text-[hsl(var(--pv-text-muted))]"> — {edit.note}</span>}
          </span>
          <BarButton tone="accept" busy={busy} onClick={() => void acceptPage()}>Accept page</BarButton>
          <BarButton tone="reject" busy={busy} onClick={() => void rejectPage()}>Reject page</BarButton>
        </Bar>
        <div className="pl-14">
          {edit.title != null ? (
            <div className="group relative mb-6" data-first-change>
              <Verdicts disabled={busy} className="absolute -left-14 top-2 opacity-0 transition-opacity group-hover:opacity-100" onAccept={() => void decideTitle("accept")} onReject={() => void decideTitle("reject")} />
              <h1 className="pv-serif text-[34px] leading-[1.15] tracking-[-0.015em]">
                <span className={DEL}>{liveTitle || "Untitled"}</span> <span className={INS}>{edit.title}</span>
              </h1>
            </div>
          ) : (
            <h1 className="mb-6 pv-serif text-[34px] leading-[1.15] tracking-[-0.015em] text-foreground">{liveTitle || "Untitled"}</h1>
          )}
          <DiffView diff={diff} busy={busy} onDecide={(d) => void decide(d)} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageEditor key={page.id} page={page} bookId={bookId} editable={canEdit} onSaving={onSaving} />
      <p className="mt-8 pv-mono text-[10px] uppercase tracking-[0.14em] text-[hsl(var(--pv-text-faint))]">{page.page_type === "section" ? "section" : `${wordCount(liveBody)} words`}</p>
    </div>
  );
}

/** A staged new page, shown green at its future position. */
export function AddPreview({ change, bookId, runId, pages, busyId, setBusyId }: {
  change: PageAdd; bookId: number; runId: number | null; pages: ManuscriptPage[]; busyId: string | null; setBusyId: (id: string | null) => void;
}) {
  const { toast } = useToast();
  const [working, setWorking] = useState(false);
  const run = async (work: () => Promise<void>, okMsg?: string) => {
    if (busyId || !runId) return;
    setBusyId(change.id); setWorking(true);
    try { await work(); if (okMsg) toast({ title: okMsg }); }
    catch (e) { toast({ title: "Couldn't apply", description: String((e as Error)?.message ?? e), variant: "destructive" }); }
    finally { setBusyId(null); setWorking(false); }
  };
  return (
    <div>
      <Bar tone="green">
        <span className="pv-serif flex-1 text-[13.5px] text-foreground">The agent proposes <b>adding this {change.pageType === "section" ? "section" : "page"}</b>.{change.note && <span className="italic text-[hsl(var(--pv-text-muted))]"> {change.note}</span>}</span>
        <BarButton tone="accept" busy={working} onClick={() => void run(() => acceptChange(bookId, runId!, change, pages), "Page added")}>Add page</BarButton>
        <BarButton tone="reject" busy={working} onClick={() => void run(() => rejectChange(runId!, change, pages))}>Reject</BarButton>
      </Bar>
      <h1 className={`mb-6 inline-block pv-serif text-[34px] leading-[1.15] tracking-[-0.015em] ${INS}`}>{change.title}</h1>
      {change.text && <div className={`space-y-5 whitespace-pre-wrap pv-serif text-[17px] leading-[1.7] ${INS} px-1`}>{change.text}</div>}
    </div>
  );
}
