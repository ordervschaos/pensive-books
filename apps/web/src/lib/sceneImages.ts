// sceneImages — the client for a page's AI-illustrated scenes (the studio "Scene" ladder level) and
// for character "design the look" portraits. Both are PROMPT-FIRST: compose an editable prompt, then
// render. Portraits render several variants to pick from; scenes render one (the gallery grows). Both
// accept author-supplied reference images. Scene rows live in page_scene_images (many per page);
// portraits are stored in the scene-images bucket and pinned onto books.foundations.cast[].ref_image_url
// by the caller. Generation runs in the generate-scene-image / generate-character-portrait edge fns.
import { supabase } from "@/integrations/supabase/client";
import { BRIDGE, bridgeFetch } from "@/lib/bridge";
import { asSpec, type SceneSpec } from "@/lib/sceneSpec";

export interface SceneImage {
  id: string;
  page_id: number;
  book_id: number;
  image_url: string | null; // null while composing/generating
  prompt: string | null;
  status: "composing" | "generating" | "ready" | "error";
  error?: string | null;
  scene_spec?: SceneSpec | null; // the spec snapshot that produced this image (null for uploads/legacy)
  created_at: string;
}

const SCENE_COLS = "id, page_id, book_id, image_url, prompt, status, error, scene_spec, created_at";

async function invoke<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) throw error;
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as T;
}

// Prompt COMPOSE (text) runs on local Claude Code via the dev bridge when present (free, and dodges a
// bad ANTHROPIC_API_KEY); else the edge fn's mode:"prompt". Image RENDER always goes to the edge
// (OpenRouter image model) — the bridge can't generate images.
async function composeViaBridgeOrEdge(bridgePath: string, edgeFn: string, body: Record<string, unknown>): Promise<string> {
  if (BRIDGE) {
    const r = await bridgeFetch(bridgePath, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    return String(d.prompt ?? "").trim();
  }
  const { prompt } = await invoke<{ prompt: string }>(edgeFn, { ...body, mode: "prompt" });
  return prompt;
}

export async function readSceneImages(pageId: number): Promise<SceneImage[]> {
  const { data, error } = await supabase
    .from("page_scene_images")
    .select(SCENE_COLS)
    .eq("page_id", pageId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as SceneImage[]) ?? [];
}

// ── Scenes ─────────────────────────────────────────────────────────────────────
/** Compose an editable scene prompt from the beats context + cast + author art direction. `style` (when
 *  given) is the art-direction text the composer must honour for the STYLE line — it overrides the book
 *  house look for this compose, so the author can sweep styles without changing the book default. */
export async function composeScenePrompt(bookId: number, pageId: number, instruction?: string, style?: string): Promise<string> {
  return composeViaBridgeOrEdge("/scene-image-prompt", "generate-scene-image", { bookId, pageId, instruction, style });
}

/** Kick off a scene render from a given prompt. Returns the 'generating' placeholder row immediately; the
 *  render runs in the background and flips to 'ready'/'error' over Realtime. `spec` (when given) is
 *  snapshotted onto the row so the author can later "revise this image" from its exact inputs.
 *  `castRefUrls` (when provided, even empty) is the author-controlled set of CHARACTER portraits to feed
 *  for likeness — it replaces the edge's automatic pick; omit it to let the edge auto-select. */
export async function renderSceneImage(pageId: number, prompt: string, refUrls: string[] = [], spec?: SceneSpec, castRefUrls?: string[]): Promise<SceneImage> {
  return invoke<SceneImage>("generate-scene-image", { pageId, mode: "image", prompt, refUrls, spec, castRefUrls });
}

/** The book's full cast (id, name, visual appearance, and pinned "design the look" portraits) — for the
 *  Scene editor's subject cards: pick subjects from Foundations, and choose which of each character's
 *  portraits condition the render for likeness. */
export interface BookCastMember { id: string; name: string; appearance?: string; portraits: string[] }
export async function getBookCast(bookId: number): Promise<BookCastMember[]> {
  const { data } = await supabase.from("books").select("foundations").eq("id", bookId).maybeSingle();
  const cast = ((data?.foundations as { cast?: (BookCastMember & { portraits?: string[] })[] } | null)?.cast ?? []);
  return cast.filter((m) => m.name?.trim()).map((m) => ({ id: m.id, name: m.name, appearance: m.appearance, portraits: m.portraits ?? [] }));
}

/** Read one scene image row by id (for "revise this image" — load its spec snapshot back into the editor). */
export async function getSceneImage(id: string): Promise<SceneImage | null> {
  const { data, error } = await supabase.from("page_scene_images").select(SCENE_COLS).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as SceneImage | null) ?? null;
}

/** The default DURABLE one-shot: compose AND render in a single background job. Returns the 'composing'
 *  placeholder immediately; the whole thing survives navigation/refresh, and the prompt is saved on the
 *  row (visible/revisable once ready). */
export async function startSceneGeneration(pageId: number, instruction?: string, style?: string): Promise<SceneImage> {
  return invoke<SceneImage>("generate-scene-image", { pageId, mode: "oneshot", instruction, style });
}

// ── Scene SPEC (the structured rail editor) ──────────────────────────────────────
/** Compose a structured SceneSpec (per-subject + scene fields) from the beat + cast + house look. The
 *  composer SEEDS each present character's build/clothing/expression/action; the author then edits it.
 *  Runs on the dev bridge (free Claude) when present, else the edge fn's mode:"spec". */
export async function composeSceneSpec(bookId: number, pageId: number, instruction?: string, style?: string): Promise<SceneSpec> {
  if (BRIDGE) {
    const r = await bridgeFetch("/scene-image-spec", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookId, pageId, instruction, style }) });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    return asSpec(d.spec);
  }
  const { spec } = await invoke<{ spec: unknown }>("generate-scene-image", { bookId, pageId, mode: "spec", instruction, style });
  return asSpec(spec);
}

/** Chat: apply a free-text change to the current spec, keeping the rest. Returns the updated spec plus a
 *  short first-person note of what changed (for the chat transcript). Single call — the spec is small. */
export async function reviseSceneSpec(bookId: number, pageId: number, currentSpec: SceneSpec, instruction: string, refCount = 0): Promise<{ spec: SceneSpec; note: string }> {
  if (BRIDGE) {
    const r = await bridgeFetch("/scene-image-revise-spec", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookId, pageId, currentSpec, instruction, refCount }) });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    return { spec: asSpec(d.spec), note: String(d.note ?? "").trim() };
  }
  const d = await invoke<{ spec: unknown; note?: string }>("generate-scene-image", { bookId, pageId, mode: "revise-spec", currentSpec, instruction, refCount });
  return { spec: asSpec(d.spec), note: String(d.note ?? "").trim() };
}

/** Read the saved scene spec for a page (null when never authored). */
export async function readSceneSpec(pageId: number): Promise<SceneSpec | null> {
  const { data, error } = await supabase.from("pages").select("scene_spec").eq("id", pageId).maybeSingle();
  if (error) throw error;
  const raw = (data as { scene_spec?: unknown } | null)?.scene_spec;
  return raw ? asSpec(raw) : null;
}

/** Persist the page's scene spec (the structured editor's autosave). */
export async function saveSceneSpec(pageId: number, spec: SceneSpec): Promise<void> {
  const { error } = await supabase.from("pages").update({ scene_spec: spec }).eq("id", pageId);
  if (error) throw error;
}

export async function deleteSceneImage(id: string): Promise<void> {
  const { error } = await supabase.from("page_scene_images").delete().eq("id", id);
  if (error) throw error;
}

/** Add a scene image the author uploaded directly (no AI) — upload to storage, insert a gallery row. */
export async function uploadSceneImage(pageId: number, bookId: number, file: File): Promise<SceneImage> {
  const url = await uploadReferenceImage(file);
  const { data, error } = await supabase
    .from("page_scene_images")
    .insert({ page_id: pageId, book_id: bookId, image_url: url, prompt: null, status: "ready" })
    .select(SCENE_COLS)
    .single();
  if (error) throw error;
  return data as SceneImage;
}

// ── Portraits ("design the look") ────────────────────────────────────────────────
export async function composePortraitPrompt(bookId: number, castId: string, instruction?: string): Promise<string> {
  return composeViaBridgeOrEdge("/character-portrait-prompt", "generate-character-portrait", { bookId, castId, instruction });
}

/** Render `count` portrait variants from a (possibly edited) prompt + author references. The returned
 *  URLs are stored but NOT pinned — the caller pins the chosen one onto the cast member. */
export async function renderPortraitVariants(bookId: number, castId: string, prompt: string, refUrls: string[] = [], count = 3): Promise<string[]> {
  const { urls } = await invoke<{ urls: string[] }>("generate-character-portrait", { bookId, castId, mode: "image", prompt, refUrls, count });
  return urls;
}

// ── Author reference uploads ─────────────────────────────────────────────────────
/** Upload an author-supplied reference image to the scene-images bucket; returns its public URL. */
export async function uploadReferenceImage(file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const path = `uploads/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("scene-images").upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw error;
  return supabase.storage.from("scene-images").getPublicUrl(path).data.publicUrl;
}
