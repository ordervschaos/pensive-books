// PageReview — the Stage in "open a page" mode: that page's full resolution ladder
// (objective · beat · prose · scene), each level readable and hand-editable. Chat-first redesign:
// generation/revision lives in the right-rail (ProseEditor/ReviseChat). The center is a near-manual
// editor — objective + beat are editable here, prose is read-only (AI in the rail).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { ArrowDown, ChevronDown, ExternalLink, Loader2, Lock, Trash2 } from "lucide-react";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { readNode, readProse, saveBeat, saveObjective } from "@/lib/ladder";
import { composeScenePrompt, deleteSceneImage, readSceneImages, renderSceneImage, uploadReferenceImage, uploadSceneImage, type SceneImage } from "@/lib/sceneImages";
import type { CellState } from "@/lib/planGraph";
import { ImageGenStudio } from "./ImageGenStudio";
import type { StudioModel } from "./studioModel";
import { ActionLink, Eyebrow, ImageLightbox, Panel, Pip } from "./studioUi";
import { CharacterLedgerGraph } from "./CharacterLedgerGraph";

interface PageReviewProps {
  bookId: number;
  model: StudioModel;
  pageId: number;
  onChanged: () => void;
  onSelectPage: (pageId: number) => void;
}

export function PageReview({ bookId, model, pageId, onChanged, onSelectPage }: PageReviewProps) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const page = model.pageById(pageId);
  const idx = model.textIndexOf(pageId);
  const movement = model.movements.find((m) => m.pages.some((p) => p.id === pageId));

  // Live node text, loaded for this page (the model carries presence; we need the editable strings).
  const [objective, setObjective] = useState("");
  const [beat, setBeat] = useState("");
  const [prose, setProse] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"objective" | null>(null);
  const [showLedger, setShowLedger] = useState(false);
  // Collapsible state for Objective and Beat: collapsed when content exists, expanded when empty.
  // Initialised after load (see useEffect below).
  const [objectiveOpen, setObjectiveOpen] = useState(true);
  const [beatOpen, setBeatOpen] = useState(true);
  const reqRef = useRef(0);

  useEffect(() => {
    const req = ++reqRef.current;
    setLoading(true);
    Promise.all([
      readNode(bookId, "objective", pageId),
      readNode(bookId, "beat", pageId),
      readProse(pageId),
    ]).then(([o, b, p]) => {
      if (req !== reqRef.current) return;
      setObjective(o); setBeat(b); setProse(p);
      // Collapse when content exists (glanceable), expand when empty (author needs to fill).
      setObjectiveOpen(!o.trim());
      setBeatOpen(!b.trim());
    }).finally(() => { if (req === reqRef.current) setLoading(false); });
  }, [bookId, pageId]);

  if (!page) return null;

  const fail = (title: string, e: unknown) => toast({ variant: "destructive", title, description: String((e as Error)?.message ?? e) });

  const saveObjectiveText = async () => {
    setBusy("objective");
    try { await saveObjective(bookId, pageId, objective.trim()); onChanged(); }
    catch (e) { fail("Couldn't save the objective", e); }
    finally { setBusy(null); }
  };

  const saveBeatText = async () => {
    try { await saveBeat(bookId, pageId, beat.trim()); onChanged(); }
    catch (e) { fail("Couldn't save the beat", e); }
  };

  return (
    <div>
      <div className="flex items-center gap-2.5 pv-serif text-[13px] text-[hsl(var(--pv-text-muted))]">
        <span className="pv-mono text-[9.5px] uppercase tracking-[0.14em] text-[hsl(var(--pv-text-faint))]">
          {movement?.num ? `${movement.num} · ` : ""}{movement?.title ?? "Pages"}
        </span>
        <span className="text-[hsl(var(--pv-text-faint))]">▸</span>
        <span className="italic">page {idx + 1}</span>
      </div>
      <h1 className="pv-serif mt-3 text-[36px] leading-[1.14] tracking-[-0.015em] text-foreground">{page.title || "(untitled)"}</h1>
      <p className="pv-serif mt-2 text-[15px] leading-[1.5] text-[hsl(var(--pv-text-muted))]">
        The page's resolution ladder — read, edit, or regenerate any level without leaving your place.
      </p>

      {/* Muted disclosure: the character ledger (the state axis) and how it moves across the book. */}
      <button
        type="button"
        onClick={() => setShowLedger((v) => !v)}
        className="mt-1.5 pv-serif text-[12.5px] italic text-[hsl(var(--pv-text-faint))] underline decoration-dotted underline-offset-2 hover:text-[hsl(var(--pv-text-muted))]"
      >
        {showLedger ? "hide character ledger" : "character ledger — how it changes across pages"}
      </button>
      {showLedger && (
        <div className="mt-3 rounded-2xl border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/40 px-4 py-3">
          <CharacterLedgerGraph bookId={bookId} currentPageId={pageId} onSelectPage={onSelectPage} />
        </div>
      )}
      <div className="mb-6" />

      {loading ? (
        <p className="pv-serif inline-flex items-center gap-2 text-[14px] italic text-[hsl(var(--pv-text-muted))]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the ladder…
        </p>
      ) : (
        <>
          <LevelCard
            label="Objective"
            sub="the plan's contract"
            state={objective.trim() ? "synced" : "gap"}
            collapsible
            open={objectiveOpen}
            onToggle={() => setObjectiveOpen((v) => !v)}
            preview={objective.trim()}
          >
            <AutoTextarea
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              onBlur={() => objective.trim() && void saveObjectiveText()}
              className="pv-serif border-none bg-transparent px-0 text-[16px] leading-[1.7] text-foreground focus-visible:ring-0"
              placeholder="What this page must achieve…"
            />
          </LevelCard>

          <DownArrow />

          <LevelCard
            label="Beat"
            sub="what happens, in order"
            state={beat.trim() ? "synced" : "gap"}
            collapsible
            open={beatOpen}
            onToggle={() => setBeatOpen((v) => !v)}
            preview={beat.trim()}
          >
            {!beat.trim() && (
              <p className="pv-serif mb-3 text-[13.5px] italic text-[hsl(var(--pv-text-faint))]">
                No beat yet — write it here, or plan it in the editor on the right →
              </p>
            )}
            <AutoTextarea
              value={beat}
              onChange={(e) => setBeat(e.target.value)}
              onBlur={() => void saveBeatText()}
              className="pv-serif border-none bg-transparent px-0 text-[17px] leading-[1.8] text-foreground focus-visible:ring-0"
              placeholder="What happens in this beat…"
            />
          </LevelCard>

          <DownArrow />

          <LevelCard label="Prose" sub="the written page" state={prose.trim() ? "synced" : beat.trim() ? "gap" : "locked"}>
            {beat.trim() ? (
              prose.trim() ? (
                <div className="pv-serif prose max-w-none text-[17px] leading-[1.8] text-foreground prose-p:my-[0.95em] prose-p:text-foreground prose-headings:text-foreground prose-em:italic prose-strong:font-semibold first:prose-p:mt-0 last:prose-p:mb-0">
                  <ReactMarkdown>{prose}</ReactMarkdown>
                </div>
              ) : (
                <p className="pv-serif text-[13.5px] italic text-[hsl(var(--pv-text-faint))]">
                  No prose yet — write it in the editor on the right →
                </p>
              )
            ) : (
              <p className="pv-serif flex items-center gap-2 text-[14.5px] italic text-[hsl(var(--pv-text-faint))]">
                <Lock className="h-3.5 w-3.5" /> Plan the beat first — prose is written from it.
              </p>
            )}
            <div className="mt-4 border-t border-[hsl(var(--pv-border-soft))]/50 pt-3">
              <ActionLink
                icon={<ExternalLink className="h-3.5 w-3.5" />}
                onClick={() => navigate(`/books/${bookId}/pages/${pageId}`)}
              >
                Open in Manuscript ↗
              </ActionLink>
            </div>
          </LevelCard>

          <DownArrow />

          <SceneLevel bookId={bookId} pageId={pageId} beatExists={!!beat.trim()} />
        </>
      )}

      <div className="mt-6 flex items-center justify-between border-t border-[hsl(var(--pv-border-soft))] pt-5">
        {idx > 0 ? (
          <button type="button" onClick={() => onSelectPage(model.textPages[idx - 1].id)} className="pv-serif text-[14px] italic text-[hsl(var(--pv-text-muted))] hover:text-foreground">
            ← previous page
          </button>
        ) : <span />}
        {idx < model.textPages.length - 1 ? (
          <button type="button" onClick={() => onSelectPage(model.textPages[idx + 1].id)} className="pv-serif text-[14px] italic text-[hsl(var(--pv-text-muted))] hover:text-foreground">
            next page →
          </button>
        ) : <span />}
      </div>
    </div>
  );
}

interface LevelCardProps {
  label: string;
  sub: string;
  state: CellState | "locked";
  children: ReactNode;
  /** When true the header becomes a toggle button that shows/hides the body. */
  collapsible?: boolean;
  /** Controlled open state (only used when collapsible=true). */
  open?: boolean;
  /** Called when the header is clicked (only used when collapsible=true). */
  onToggle?: () => void;
  /** One-line glanceable text shown in the header while collapsed. */
  preview?: string;
}

function LevelCard({ label, sub, state, children, collapsible, open = true, onToggle, preview }: LevelCardProps) {
  const dim = state === "gap" || state === "locked";
  const isOpen = !collapsible || open;

  const header = (
    <div className={`flex items-center gap-2.5 ${isOpen && !dim ? "mb-5 border-b border-[hsl(var(--pv-border-soft))]/70 pb-3" : ""}`}>
      <Pip state={state === "locked" ? "gap" : state} />
      <Eyebrow>{label}</Eyebrow>
      <span className="pv-serif text-[12.5px] italic text-[hsl(var(--pv-text-faint))]">· {sub}</span>
      {/* Collapsed preview — truncated one-liner */}
      {collapsible && !open && preview && (
        <span className="ml-2 flex-1 truncate pv-serif text-[12.5px] text-[hsl(var(--pv-text-muted))]">{preview}</span>
      )}
      {state === "synced" && isOpen && <span className="ml-auto pv-mono text-[9px] uppercase tracking-[0.12em] text-[hsl(var(--pv-accent))]">in sync</span>}
      {state === "locked" && <Lock className="ml-auto h-3.5 w-3.5 text-[hsl(var(--pv-text-faint))]" />}
      {collapsible && (
        <ChevronDown
          className={`ml-auto h-3.5 w-3.5 shrink-0 text-[hsl(var(--pv-text-faint))] transition-transform ${open ? "rotate-0" : "-rotate-90"}`}
        />
      )}
    </div>
  );

  return (
    <Panel variant={dim ? "dashed" : "soft"} className={`px-7 py-6 ${state === "locked" ? "opacity-65" : ""}`}>
      {collapsible ? (
        <button type="button" onClick={onToggle} className="w-full text-left">
          {header}
        </button>
      ) : (
        header
      )}
      {isOpen && children}
    </Panel>
  );
}

function DownArrow() {
  return <div className="flex justify-center py-0.5 text-[hsl(var(--pv-text-faint))]"><ArrowDown className="h-4 w-4" /></div>;
}

// Scene level — illustrations of the page's scene, with coherent characters (the beat's named cast
// rendered from their pinned reference portraits). A gallery: many images per page. Live-projected
// over Realtime so a generation from anywhere lands here without a refresh.
function SceneLevel({ bookId, pageId, beatExists }: { bookId: number; pageId: number; beatExists: boolean }) {
  const { toast } = useToast();
  const [scenes, setScenes] = useState<SceneImage[]>([]);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const upsert = (row: SceneImage) => setScenes((s) => (s.some((x) => x.id === row.id) ? s : [...s, row]));

  useEffect(() => {
    let live = true;
    void readSceneImages(pageId).then((rows) => { if (live) setScenes(rows); });
    const channel = supabase
      .channel(`scene_images_${pageId}_${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "page_scene_images", filter: `page_id=eq.${pageId}` },
        (p) => upsert((p as unknown as { new: SceneImage }).new))
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "page_scene_images", filter: `page_id=eq.${pageId}` },
        (p) => { const id = (p as unknown as { old: { id: string } }).old.id; setScenes((s) => s.filter((x) => x.id !== id)); })
      .subscribe();
    return () => { live = false; void supabase.removeChannel(channel); };
  }, [pageId]);

  const remove = async (id: string) => {
    setScenes((s) => s.filter((x) => x.id !== id)); // optimistic; realtime confirms
    try { await deleteSceneImage(id); }
    catch (e) { toast({ variant: "destructive", title: "Couldn't remove the image", description: String((e as Error)?.message ?? e) }); void readSceneImages(pageId).then(setScenes); }
  };

  const state: CellState | "locked" = scenes.length ? "synced" : beatExists ? "gap" : "locked";

  return (
    <LevelCard label="Scene" sub="illustrated, with your cast" state={state}>
      {!beatExists ? (
        <p className="pv-serif flex items-center gap-2 text-[14.5px] italic text-[hsl(var(--pv-text-faint))]">
          <Lock className="h-3.5 w-3.5" /> Plan the beat first — scenes are drawn from it.
        </p>
      ) : (
        <>
          {scenes.length > 0 && (
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {scenes.map((s) => (
                <div key={s.id} className="group relative overflow-hidden rounded-xl border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/40">
                  <button type="button" onClick={() => setLightbox(s.image_url)} className="block w-full cursor-zoom-in" aria-label="Open full screen">
                    <img src={s.image_url} alt={s.prompt ?? "Scene"} className="aspect-[4/3] w-full object-cover" loading="lazy" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(s.id)}
                    className="absolute right-1.5 top-1.5 rounded-full bg-black/55 p-1.5 text-white opacity-0 transition-opacity hover:bg-black/75 group-hover:opacity-100"
                    aria-label="Remove image"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <ImageGenStudio
            compose={(instr) => composeScenePrompt(bookId, pageId, instr)}
            render={async (prompt, refUrls) => { const row = await renderSceneImage(pageId, prompt, refUrls); upsert(row); return [row.image_url]; }}
            uploadRef={uploadReferenceImage}
            onAdd={() => {}}
            uploadDirect={async (file) => { upsert(await uploadSceneImage(pageId, bookId, file)); }}
            onFullscreen={setLightbox}
            startLabel={scenes.length ? "Generate another scene" : "Generate scene image"}
          />
          <p className="pv-serif mt-2.5 text-[12.5px] italic text-[hsl(var(--pv-text-faint))]">
            Cast named in the beat are drawn from their portraits — design each character's look in Foundations for coherence.
          </p>
        </>
      )}
      <ImageLightbox src={lightbox} onClose={() => setLightbox(null)} />
    </LevelCard>
  );
}

