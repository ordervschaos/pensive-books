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
import { composeSceneSpec, getBookCast, getSceneImage, readSceneSpec, renderSceneImage, reviseSceneSpec, saveSceneSpec, uploadReferenceImage, type BookCastMember } from "@/lib/sceneImages";
import { asSpec, EMPTY_SPEC, isSpecEmpty, specToPrompt, type SceneSpec, type SceneSubject } from "@/lib/sceneSpec";
import { useBookLook } from "@/hooks/useBookLook";
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
  // The book's cast (Foundations) — drives the "add a subject from the cast" picker AND each subject's
  // character-reference portraits (matched by name). Author picks which portraits condition the render.
  const [cast, setCast] = useState<BookCastMember[]>([]);
  const [castPickerOpen, setCastPickerOpen] = useState(false);
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

  // Load the book's cast (Foundations) for the subject picker + per-subject character references.
  useEffect(() => {
    let live = true;
    void getBookCast(bookId).then((c) => { if (live) setCast(c); }).catch(() => { if (live) setCast([]); });
    return () => { live = false; };
  }, [bookId]);

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
  // Add a subject chosen from the book's cast — seeds the build from their Foundations appearance.
  const addSubjectFromCast = (m: BookCastMember) => {
    update({ ...spec, subjects: [...spec.subjects, { name: m.name, build: m.appearance?.trim() || undefined }] });
    setCastPickerOpen(false);
  };
  const removeSubject = (i: number) => update({ ...spec, subjects: spec.subjects.filter((_, j) => j !== i) });
  const makeFocal = (i: number) => {
    if (i === 0) return;
    const next = [...spec.subjects];
    const [m] = next.splice(i, 1);
    next.unshift(m);
    update({ ...spec, subjects: next });
  };
  const setField = (k: keyof Omit<SceneSpec, "subjects">, v: string) => update({ ...spec, [k]: v });

  // A subject's available Foundations portraits — matched to the cast by name.
  const portraitsFor = (name: string): string[] =>
    cast.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase())?.portraits ?? [];
  // Which of a subject's portraits feed the render. `refImages` undefined = untouched → default to the
  // first portrait (the edge's old auto-pick); an explicit array (incl. []) = the author's choice. Always
  // filtered to portraits that still exist on the cast member.
  const effectiveRefs = (s: SceneSubject, portraits: string[]): string[] =>
    s.refImages !== undefined ? s.refImages.filter((u) => portraits.includes(u)) : portraits.slice(0, 1);
  // Toggle one portrait for a subject — pins the selection (turns the default into an explicit set).
  const toggleRef = (i: number, url: string) => {
    const s = spec.subjects[i];
    const current = effectiveRefs(s, portraitsFor(s.name));
    setSubject(i, { refImages: current.includes(url) ? current.filter((u) => u !== url) : [...current, url] });
  };
  // The character portraits (deduped) the render should condition on, gathered across all subjects.
  const gatherCastRefs = (): string[] =>
    [...new Set(spec.subjects.flatMap((s) => effectiveRefs(s, portraitsFor(s.name))))];

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

  // Attach a reference image in the chat. The author then chooses what to do with it + their note: ✦
  // generate straight from it (render-time, no spec change), or ↑ fold it into the scene definition.
  const attachRef = async (file: File) => {
    setUploadingRef(true);
    try {
      const url = await uploadReferenceImage(file);
      setRefs((r) => [...r, url]);
      setMessages((m) => [...m, { role: "assistant", text: "Reference attached. Add a note, then ✦ generate straight from it — or ↑ fold it into the scene definition." }]);
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
      await renderSceneImage(pageId, prompt, refs, spec, gatherCastRefs());
      const refNote = refs.length ? ` with ${refs.length} reference image${refs.length > 1 ? "s" : ""}` : "";
      setMessages((m) => [...m, { role: "assistant", text: `Generating this scene${refNote} — it'll appear in the gallery shortly (it survives a refresh).` }]);
    } catch (e) {
      toast({ variant: "destructive", title: "Couldn't start the render", description: String((e as Error)?.message ?? e) });
    } finally { setRendering(false); }
  };

  // Generate straight from the current scene + this note + references, WITHOUT rewriting the scene
  // definition — the note is appended to the prompt for the renderer (which reads it and sees the refs).
  // For ad-hoc reference tweaks ("use the face from reference 2") that needn't become part of the spec.
  const generateWithNote = async (note: string) => {
    if (rendering || phase !== "ready") return;
    const n = note.trim();
    setRendering(true);
    setChatInput("");
    if (n) setMessages((m) => [...m, { role: "user", text: n }]);
    try {
      const base = specToPrompt(spec, look.art_direction);
      const prompt = n ? `${base}\nNOTE: ${n}` : base;
      await renderSceneImage(pageId, prompt, refs, spec, gatherCastRefs());
      const refNote = refs.length ? ` with ${refs.length} reference image${refs.length > 1 ? "s" : ""}` : "";
      setMessages((m) => [...m, { role: "assistant", text: `Generating from your note${refNote} — the scene definition is unchanged.` }]);
    } catch (e) {
      toast({ variant: "destructive", title: "Couldn't start the render", description: String((e as Error)?.message ?? e) });
    } finally { setRendering(false); }
  };

  const composing = phase === "composing";
  const canGenerate = phase === "ready" && !isSpecEmpty(spec) && !rendering;

  // Cast members not already a subject — offered in the "add a subject from the cast" picker.
  const subjectNames = new Set(spec.subjects.map((s) => s.name.trim().toLowerCase()).filter(Boolean));
  const availableCast = cast.filter((m) => !subjectNames.has(m.name.trim().toLowerCase()));

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
                  {/* Character references — this character's Foundations portraits. Tap to pick which ones
                      condition the render for likeness (the first is on by default; more locks likeness). */}
                  {(() => {
                    const portraits = portraitsFor(s.name);
                    if (!portraits.length) return null;
                    const on = new Set(effectiveRefs(s, portraits));
                    return (
                      <div className="mt-2.5 border-t border-[hsl(var(--pv-border-soft))]/50 pt-2">
                        <span className="pv-mono text-[9.5px] uppercase tracking-[0.1em] text-[hsl(var(--pv-text-faint))]">reference · tap to pick</span>
                        <div className="mt-1.5 flex flex-wrap gap-2">
                          {portraits.map((url) => {
                            const sel = on.has(url);
                            return (
                              <button key={url} type="button" onClick={() => toggleRef(i, url)}
                                title={sel ? "Included as a reference (tap to drop)" : "Dropped (tap to include)"}
                                className={`relative h-14 w-14 overflow-hidden rounded-lg border-2 transition-all ${sel ? "border-[hsl(var(--pv-accent))]" : "border-transparent opacity-45 grayscale hover:opacity-70"}`}>
                                <img src={url} alt={`${s.name || "character"} reference`} className="h-full w-full object-cover" />
                                {!sel && <span className="absolute inset-0 flex items-center justify-center"><X className="h-4 w-4 text-white/90" /></span>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ))}
              <div>
                <button type="button" onClick={() => (cast.length ? setCastPickerOpen((v) => !v) : addSubject())}
                  className="inline-flex items-center gap-1.5 pv-serif text-[12.5px] text-[hsl(var(--pv-text-muted))] hover:text-[hsl(var(--pv-accent))]">
                  <Plus className="h-3.5 w-3.5" /> add subject{cast.length ? " from the cast" : ""}
                </button>
                {castPickerOpen && cast.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/40 px-2.5 py-2">
                    {availableCast.length > 0 ? availableCast.map((m) => (
                      <button key={m.id} type="button" onClick={() => addSubjectFromCast(m)} title={m.appearance || m.name}
                        className="pv-serif rounded-full border border-[hsl(var(--pv-border-soft))] px-2.5 py-1 text-[12.5px] text-foreground transition-colors hover:border-[hsl(var(--pv-accent))]/50 hover:text-[hsl(var(--pv-accent))]">
                        {m.name}
                      </button>
                    )) : (
                      <span className="pv-serif text-[12px] italic text-[hsl(var(--pv-text-faint))]">all cast already in the scene</span>
                    )}
                    <button type="button" onClick={() => { addSubject(); setCastPickerOpen(false); }}
                      className="pv-serif rounded-full px-2.5 py-1 text-[12.5px] italic text-[hsl(var(--pv-text-faint))] hover:text-[hsl(var(--pv-accent))]">
                      + blank
                    </button>
                  </div>
                )}
              </div>
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

        {/* Attached reference images — numbered so the author can address them ("the face from #2"). Fed
            to the render in this order alongside the cast portraits. */}
        {refs.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {refs.map((url, i) => (
              <div key={url} className="group relative h-12 w-12 overflow-hidden rounded-lg border border-[hsl(var(--pv-border-soft))]">
                <img src={url} alt={`Reference ${i + 1}`} className="h-full w-full object-cover" />
                <span className="absolute left-0.5 top-0.5 rounded-full bg-black/65 px-1.5 py-0.5 pv-mono text-[9px] leading-none text-white">{i + 1}</span>
                <button type="button" onClick={() => setRefs((r) => r.filter((_, j) => j !== i))} aria-label="Remove reference"
                  className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            {refs.length > 1 && (
              <span className="pv-serif text-[11.5px] italic text-[hsl(var(--pv-text-faint))]">refer to them by number — “angle from 1, face from 2”</span>
            )}
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
            placeholder="Note or change — then ✦ generate from it, or ↑ fold it into the scene"
            disabled={phase !== "ready" || chatBusy}
            className="pv-serif min-h-[42px] flex-1 rounded-xl border border-[hsl(var(--pv-border-soft))] bg-background px-3 py-2 text-[13.5px] leading-[1.5] focus-visible:ring-0"
          />
          <button type="button" onClick={() => void generateWithNote(chatInput)} disabled={phase !== "ready" || rendering || (!chatInput.trim() && refs.length === 0)}
            title="Generate now with this note + references — leaves the scene definition unchanged"
            className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full border border-[hsl(var(--pv-accent))]/45 bg-[hsl(var(--pv-accent))]/[0.08] text-[hsl(var(--pv-accent))] transition-colors hover:bg-[hsl(var(--pv-accent))]/[0.16] disabled:opacity-40">
            {rendering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
          </button>
          <button type="button" onClick={() => void sendChat(chatInput)} disabled={phase !== "ready" || chatBusy || !chatInput.trim()}
            title="Fold this into the scene definition (revise the spec)" className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40">
            {chatBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </div>
        {(chatInput.trim() || refs.length > 0) && (
          <p className="pv-serif px-1 text-[11.5px] italic text-[hsl(var(--pv-text-faint))]">
            <span className="text-[hsl(var(--pv-accent))]">✦</span> generate now with the note + references · <span className="text-foreground">↑</span> fold it into the scene definition
          </p>
        )}
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
