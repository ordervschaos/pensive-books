// SceneTab — the studio rail's "Scene" editor (sibling to the Prose editor). The page's scene is
// authored as a STRUCTURED SPEC, not one prompt blob: a list of subjects (each character with an
// editable build / clothing / expression / action) plus the scene-wide fields (setting, action,
// composition, lighting, mood, exclude). The AI SEEDS the spec from the beat + cast on first open; the
// author edits any field. "Generate" flattens the spec (+ the book house-look STYLE) into the labelled
// prompt the image pipeline already renders durably — the new image lands in the center gallery over
// Realtime. The spec autosaves to pages.scene_spec, so it restores exactly on reopen.
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowUp, ImagePlus, Loader2, Paperclip, Plus, RefreshCw, Trash2, Wand2, X } from "lucide-react";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { composeSceneSpec, getSceneImage, readSceneSpec, renderSceneImage, reviseSceneSpec, saveSceneSpec, uploadReferenceImage } from "@/lib/sceneImages";
import { asSpec, EMPTY_SPEC, isSpecEmpty, specToPrompt, type SceneSpec, type SceneSubject } from "@/lib/sceneSpec";
import { writeFoundationsPatch, type Foundations } from "@/lib/foundations";
import { BookLookControls } from "./BookLookControls";
import { Eyebrow, Panel, RunError } from "./studioUi";

interface ChatMsg { role: "user" | "assistant"; text: string }

type Phase = "loading" | "composing" | "ready" | "error";

export function SceneTab({ bookId, pageId }: { bookId: number; pageId: number }) {
  const { toast } = useToast();
  const { look, patchLook } = useBookLook(bookId);
  const [spec, setSpec] = useState<SceneSpec>(EMPTY_SPEC);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  // Author reference images attached in the chat — fed to the render alongside the cast portraits so the
  // image model can match a pose / face / look. They ride along with every Generate until removed.
  const [refs, setRefs] = useState<string[]>([]);
  const [uploadingRef, setUploadingRef] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [params, setParams] = useSearchParams();
  const reviseId = params.get("reviseScene");
  const consumedRevise = useRef<string | null>(null);

  // Load the page's working spec; if it has none yet, auto-compose a seed from the beat + cast. Skipped
  // when a specific image is being revised (`?reviseScene`) — that effect loads its snapshot instead.
  useEffect(() => {
    if (reviseId) return;
    let live = true;
    setPhase("loading"); setError(null); setMessages([]); setChatInput(""); setRefs([]);
    void (async () => {
      try {
        const saved = await readSceneSpec(pageId);
        if (!live) return;
        if (saved && !isSpecEmpty(saved)) {
          setSpec(saved); setPhase("ready");
          setMessages([{ role: "assistant", text: "Loaded your saved scene — tell me a change, or generate it." }]);
          return;
        }
        setPhase("composing");
        const seeded = await composeSceneSpec(bookId, pageId);
        if (!live) return;
        setSpec(seeded); setPhase("ready");
        setMessages([{ role: "assistant", text: "Seeded the scene from your beat — tell me a change, or generate it." }]);
        void saveSceneSpec(pageId, seeded).catch(() => {});
      } catch (e) {
        if (!live) return;
        setError(String((e as Error)?.message ?? e)); setPhase("error");
      }
    })();
    return () => { live = false; };
  }, [bookId, pageId]); // eslint-disable-line react-hooks/exhaustive-deps -- reviseId read at run-time on purpose

  // "Revise this image": load the chosen image's spec snapshot back into the editor and attach the image
  // as a reference, so a tweak + Generate produces a variation. Consumed once, then the param is cleared.
  useEffect(() => {
    if (!reviseId || consumedRevise.current === reviseId) return;
    consumedRevise.current = reviseId;
    let live = true;
    setPhase("loading"); setError(null); setMessages([]); setChatInput(""); setRefs([]);
    void (async () => {
      try {
        const img = await getSceneImage(reviseId);
        if (!live) return;
        // Drop the param so navigation/refresh doesn't reload it (the spec now lives on the working draft).
        setParams((p) => { const n = new URLSearchParams(p); n.delete("reviseScene"); return n; }, { replace: true });
        const snap = img?.scene_spec ? asSpec(img.scene_spec) : null;
        if (!snap || isSpecEmpty(snap)) {
          const saved = await readSceneSpec(pageId);
          if (!live) return;
          setSpec(saved && !isSpecEmpty(saved) ? saved : EMPTY_SPEC); setPhase("ready");
          setMessages([{ role: "assistant", text: "That image had no saved inputs — loaded the page's current scene instead." }]);
          return;
        }
        setSpec(snap); setPhase("ready");
        if (img?.image_url) setRefs([img.image_url]);
        void saveSceneSpec(pageId, snap).catch(() => {});
        setMessages([{ role: "assistant", text: "Loaded that image's inputs and attached it as a reference — tell me what to change, or generate a variation." }]);
      } catch (e) {
        if (!live) return;
        setError(String((e as Error)?.message ?? e)); setPhase("error");
      }
    })();
    return () => { live = false; };
  }, [reviseId, pageId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Autosave the spec (debounced) whenever the author edits a field.
  const update = (next: SceneSpec) => {
    setSpec(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void saveSceneSpec(pageId, next).catch(() => {}); }, 600);
  };
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const setSubject = (i: number, patch: Partial<SceneSubject>) =>
    update({ ...spec, subjects: spec.subjects.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const addSubject = () => update({ ...spec, subjects: [...spec.subjects, { name: "" }] });
  const removeSubject = (i: number) => update({ ...spec, subjects: spec.subjects.filter((_, j) => j !== i) });
  const makeFocal = (i: number) => {
    if (i === 0) return;
    const next = [...spec.subjects];
    const [m] = next.splice(i, 1);
    next.unshift(m);
    update({ ...spec, subjects: next });
  };
  const setField = (k: keyof Omit<SceneSpec, "subjects">, v: string) => update({ ...spec, [k]: v });

  // Recompose: re-seed every field fresh from the beat + cast (discards the current spec).
  const recompose = async () => {
    setPhase("composing"); setError(null);
    try {
      const seeded = await composeSceneSpec(bookId, pageId);
      setSpec(seeded); setPhase("ready");
      setMessages((m) => [...m, { role: "assistant", text: "Re-seeded every field from the beat — tell me a change, or generate it." }]);
      void saveSceneSpec(pageId, seeded).catch(() => {});
    } catch (e) {
      setError(String((e as Error)?.message ?? e)); setPhase("error");
    }
  };

  // Chat: send a free-text change; the reviser edits the spec (keeping the rest) and replies with a note.
  // `refCount` tells the reviser how many reference images are attached, so a comment like "match this
  // dress" is woven into the prompt as direction about the reference (defaults to the current count).
  const sendChat = async (text: string, refCount = refs.length) => {
    const t = text.trim();
    if (!t || chatBusy || phase !== "ready") return;
    setChatBusy(true);
    setChatInput("");
    setMessages((m) => [...m, { role: "user", text: t }]);
    try {
      const { spec: next, note } = await reviseSceneSpec(bookId, pageId, spec, t, refCount);
      setSpec(next);
      void saveSceneSpec(pageId, next).catch(() => {});
      setMessages((m) => [...m, { role: "assistant", text: note || "Updated the scene." }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", text: `Couldn't apply that — ${String((e as Error)?.message ?? e)}` }]);
    } finally { setChatBusy(false); }
  };

  // Attach a reference image in the chat. If the author has typed a comment, that comment is direction
  // about the reference — send it straight away (the reviser folds it into the prompt, ref-aware). Else
  // prompt them to say what to take from it; the image alone conditions the render at Generate.
  const attachRef = async (file: File) => {
    setUploadingRef(true);
    try {
      const url = await uploadReferenceImage(file);
      const count = refs.length + 1;
      setRefs((r) => [...r, url]);
      const comment = chatInput.trim();
      if (comment) void sendChat(comment, count);
      else setMessages((m) => [...m, { role: "assistant", text: "Reference attached — tell me what to take from it (a pose, the light, a face, the outfit) and I'll work it into the prompt." }]);
    } catch (e) {
      toast({ variant: "destructive", title: "Couldn't attach the reference", description: String((e as Error)?.message ?? e) });
    } finally { setUploadingRef(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  // Generate: flatten spec (+ house-look STYLE) → the labelled prompt → the durable render, with any
  // attached reference images. The new image appears in the center gallery over Realtime.
  const generate = async () => {
    if (rendering) return;
    setRendering(true);
    try {
      const prompt = specToPrompt(spec, look.art_direction);
      await renderSceneImage(pageId, prompt, refs, spec);
      const refNote = refs.length ? ` with ${refs.length} reference image${refs.length > 1 ? "s" : ""}` : "";
      setMessages((m) => [...m, { role: "assistant", text: `Generating this scene${refNote} — it'll appear in the gallery shortly (it survives a refresh).` }]);
    } catch (e) {
      toast({ variant: "destructive", title: "Couldn't start the render", description: String((e as Error)?.message ?? e) });
    } finally { setRendering(false); }
  };

  const composing = phase === "composing";
  const canGenerate = phase === "ready" && !isSpecEmpty(spec) && !rendering;

  return (
    <Panel variant="soft" className="flex h-full flex-col px-4 py-3.5">
      <div className="shrink-0">
        <div className="flex items-center gap-2">
          <ImagePlus className="h-4 w-4 text-[hsl(var(--pv-accent))]" />
          <Eyebrow tone="accent">Scene · this page</Eyebrow>
          <button type="button" onClick={() => void recompose()} disabled={composing || phase === "loading"} title="Re-seed every field from the beat"
            className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-1 text-[hsl(var(--pv-text-faint))] transition-colors hover:text-[hsl(var(--pv-accent))] disabled:opacity-40">
            <RefreshCw className={`h-3.5 w-3.5 ${composing ? "animate-spin" : ""}`} />
          </button>
        </div>
        <p className="pv-serif mt-1 text-[12.5px] italic text-[hsl(var(--pv-text-faint))]">
          The AI seeds each part from the beat and your cast. Edit any field, then Generate — the image lands in the gallery.
        </p>
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
        {phase === "loading" || (composing && isSpecEmpty(spec)) ? (
          <p className="pv-serif inline-flex items-center gap-2 text-[13.5px] italic text-[hsl(var(--pv-text-muted))]">
            <Loader2 className="h-4 w-4 animate-spin" /> {composing ? "Composing the scene from your beat…" : "Loading…"}
          </p>
        ) : phase === "error" ? (
          <RunError msg={error} />
        ) : (
          <div className={composing ? "pointer-events-none opacity-50" : ""}>
            {/* ── Subjects ── */}
            <Eyebrow tone="muted">Subjects</Eyebrow>
            <div className="mt-2 space-y-3">
              {spec.subjects.map((s, i) => (
                <div key={i} className="rounded-xl border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/40 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    {i === 0 ? (
                      <span className="pv-mono shrink-0 rounded-full bg-[hsl(var(--pv-accent))]/[0.12] px-2 py-0.5 text-[9px] uppercase tracking-[0.1em] text-[hsl(var(--pv-accent))]">focal</span>
                    ) : (
                      <button type="button" onClick={() => makeFocal(i)} title="Make this the focal subject"
                        className="pv-mono shrink-0 rounded-full border border-[hsl(var(--pv-border-soft))] px-2 py-0.5 text-[9px] uppercase tracking-[0.1em] text-[hsl(var(--pv-text-faint))] hover:text-[hsl(var(--pv-accent))]">
                        make focal
                      </button>
                    )}
                    <input
                      value={s.name}
                      onChange={(e) => setSubject(i, { name: e.target.value })}
                      placeholder="Character name"
                      className="flex-1 border-none bg-transparent pv-serif text-[15px] font-medium text-foreground outline-none placeholder:text-[hsl(var(--pv-text-faint))]"
                    />
                    <button type="button" onClick={() => removeSubject(i)} aria-label="Remove subject" className="shrink-0 text-[hsl(var(--pv-text-faint))] hover:text-destructive">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="mt-1.5 space-y-1.5">
                    <SubField label="build" value={s.build} onChange={(v) => setSubject(i, { build: v })} placeholder="physique, age, height" />
                    <SubField label="clothing" value={s.clothing} onChange={(v) => setSubject(i, { clothing: v })} placeholder="what they're wearing" />
                    <SubField label="expression" value={s.expression} onChange={(v) => setSubject(i, { expression: v })} placeholder="their face in this moment" />
                    <SubField label="action" value={s.action} onChange={(v) => setSubject(i, { action: v })} placeholder="what they're doing" />
                  </div>
                </div>
              ))}
              <button type="button" onClick={addSubject}
                className="inline-flex items-center gap-1.5 pv-serif text-[12.5px] text-[hsl(var(--pv-text-muted))] hover:text-[hsl(var(--pv-accent))]">
                <Plus className="h-3.5 w-3.5" /> add subject
              </button>
            </div>

            {/* ── Scene fields ── */}
            <div className="mt-5 space-y-3 border-t border-[hsl(var(--pv-border-soft))]/60 pt-4">
              <SceneField label="Setting" value={spec.setting} onChange={(v) => setField("setting", v)} placeholder="where, time of day, environment" />
              <SceneField label="Action" value={spec.action} onChange={(v) => setField("action", v)} placeholder="the single moment depicted" />
              <SceneField label="Composition" value={spec.composition} onChange={(v) => setField("composition", v)} placeholder="shot type, angle, focal point, depth" />
              <SceneField label="Lighting" value={spec.lighting} onChange={(v) => setField("lighting", v)} placeholder="quality, direction, colour of light" />
              <SceneField label="Mood" value={spec.mood} onChange={(v) => setField("mood", v)} placeholder="the emotional atmosphere" />
              <SceneField label="Exclude" value={spec.exclude} onChange={(v) => setField("exclude", v)} placeholder="what to keep out (defaults applied)" />
            </div>

            {/* ── Look: style theme + render model (book-level, inherited by every scene) ── */}
            <div className="mt-5 border-t border-[hsl(var(--pv-border-soft))]/60 pt-4">
              <Eyebrow tone="muted" className="mb-2">Look — applied as STYLE, shared across the book</Eyebrow>
              <BookLookControls
                artTheme={look.art_theme}
                artDirection={look.art_direction}
                imageModel={look.image_model}
                onPatch={(p) => void patchLook(p)}
              />
            </div>

          </div>
        )}
      </div>

      {/* ── Chat — the primary interaction. Generate is a response action under the latest reply. ── */}
      <div className="mt-3 shrink-0 space-y-2.5">
        {messages.length > 0 && (
          <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-xl border border-[hsl(var(--pv-border-soft))]/60 bg-[hsl(var(--pv-surface-2))]/30 px-3 py-2">
            {messages.map((m, i) => {
              const isLast = i === messages.length - 1;
              const showGenerate = isLast && m.role === "assistant" && canGenerate;
              return (
                <div key={i}>
                  <p className={`pv-serif text-[13px] leading-relaxed ${m.role === "user" ? "text-foreground" : "italic text-[hsl(var(--pv-text-muted))]"}`}>
                    <span className="pv-mono mr-1.5 text-[11px] text-[hsl(var(--pv-text-faint))]">{m.role === "user" ? "you" : "↳"}</span>{m.text}
                  </p>
                  {showGenerate && (
                    <button type="button" onClick={() => void generate()} disabled={rendering}
                      className="mt-1.5 ml-5 inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--pv-accent))]/40 bg-[hsl(var(--pv-accent))]/[0.07] px-3 py-1 pv-serif text-[12.5px] text-[hsl(var(--pv-accent))] transition-colors hover:bg-[hsl(var(--pv-accent))]/[0.14] disabled:opacity-40">
                      {rendering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />} Generate image
                    </button>
                  )}
                </div>
              );
            })}
            {chatBusy && (
              <p className="pv-serif inline-flex items-center gap-1.5 text-[12.5px] italic text-[hsl(var(--pv-text-faint))]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> reworking the scene…
              </p>
            )}
          </div>
        )}

        {/* Attached reference images — thumbnails fed to the render alongside the cast portraits. */}
        {refs.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {refs.map((url, i) => (
              <div key={url} className="group relative h-12 w-12 overflow-hidden rounded-lg border border-[hsl(var(--pv-border-soft))]">
                <img src={url} alt={`Reference ${i + 1}`} className="h-full w-full object-cover" />
                <button type="button" onClick={() => setRefs((r) => r.filter((_, j) => j !== i))} aria-label="Remove reference"
                  className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <input ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void attachRef(f); }} />

        <div className="flex items-end gap-2">
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploadingRef}
            title="Attach a reference image (pose, face, look) for the render"
            className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full border border-[hsl(var(--pv-border-soft))] text-[hsl(var(--pv-text-muted))] transition-colors hover:border-[hsl(var(--pv-accent))]/50 hover:text-[hsl(var(--pv-accent))] disabled:opacity-40">
            {uploadingRef ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
          </button>
          <AutoTextarea
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendChat(chatInput); } }}
            placeholder="Tell the editor a change, or attach a reference — e.g. “match this pose”"
            disabled={phase !== "ready" || chatBusy}
            className="pv-serif min-h-[42px] flex-1 rounded-xl border border-[hsl(var(--pv-border-soft))] bg-background px-3 py-2 text-[13.5px] leading-[1.5] focus-visible:ring-0"
          />
          <button type="button" onClick={() => void sendChat(chatInput)} disabled={phase !== "ready" || chatBusy || !chatInput.trim()}
            title="Send" className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40">
            {chatBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </Panel>
  );
}

// A subject sub-field: a label + a one-line auto-growing input, compact for the card.
function SubField({ label, value, onChange, placeholder }: { label: string; value?: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="pv-mono w-[68px] shrink-0 text-[9.5px] uppercase tracking-[0.1em] text-[hsl(var(--pv-text-faint))]">{label}</span>
      <AutoTextarea
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 border-none bg-transparent px-0 py-0 pv-serif text-[13.5px] leading-snug text-foreground focus-visible:ring-0 placeholder:text-[hsl(var(--pv-text-faint))]"
      />
    </div>
  );
}

// A scene-wide field: a label above a multi-line box.
function SceneField({ label, value, onChange, placeholder }: { label: string; value?: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <Eyebrow tone="muted">{label}</Eyebrow>
      <AutoTextarea
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 pv-serif border-b border-transparent bg-transparent px-0 py-0 text-[14px] leading-relaxed text-foreground focus-visible:ring-0 placeholder:text-[hsl(var(--pv-text-faint))] hover:border-[hsl(var(--pv-border-soft))] transition-colors"
      />
    </div>
  );
}

// The book's image look, live-projected from books.foundations — read once then subscribed, so a change
// from Foundations (or another tab) lands here with no refresh. `patchLook` merges a slice without
// clobbering cast/argument/etc.
function useBookLook(bookId: number) {
  const { toast } = useToast();
  const [look, setLook] = useState<Pick<Foundations, "art_theme" | "art_direction" | "image_model">>({});

  useEffect(() => {
    let live = true;
    const pick = (f: Foundations | null) => ({ art_theme: f?.art_theme, art_direction: f?.art_direction, image_model: f?.image_model });
    void supabase.from("books").select("foundations").eq("id", bookId).maybeSingle()
      .then(({ data }) => { if (live) setLook(pick(data?.foundations as Foundations | null)); });
    const channel = supabase
      .channel(`book_look_${bookId}_${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "books", filter: `id=eq.${bookId}` },
        (p) => setLook(pick((p as unknown as { new: { foundations: Foundations | null } }).new.foundations)))
      .subscribe();
    return () => { live = false; void supabase.removeChannel(channel); };
  }, [bookId]);

  const patchLook = async (p: Partial<Foundations>) => {
    setLook((prev) => ({ ...prev, ...p }));
    try { await writeFoundationsPatch(bookId, p); }
    catch (e) { toast({ variant: "destructive", title: "Couldn't save the look", description: String((e as Error)?.message ?? e) }); }
  };

  return { look, patchLook };
}
