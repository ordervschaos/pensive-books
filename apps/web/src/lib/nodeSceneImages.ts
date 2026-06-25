// nodeSceneImages — the client for a DNA scene node's illustration gallery (picture-book mode,
// docs/picture-book-mode.md). The node-keyed sibling of lib/sceneImages.ts: candidates hang off the scene
// node's STABLE id (node_scene_images), not a page row. Render always runs on the edge fn
// generate-dna-scene-image (the bridge can't generate images) — durable + Realtime, like the page flow.
import { supabase } from "@/integrations/supabase/client";

export interface NodeSceneImage {
  id: string;
  node_id: string;
  book_id: number;
  image_url: string | null; // null while composing/generating
  prompt: string | null;
  status: "composing" | "generating" | "ready" | "error";
  error?: string | null;
  scene_spec?: unknown;
  created_at: string;
}

const NODE_COLS = "id, node_id, book_id, image_url, prompt, status, error, scene_spec, created_at";

/** The illustration gallery for one scene node, oldest first (a live projection — subscribe over Realtime). */
export async function readNodeSceneImages(nodeId: string): Promise<NodeSceneImage[]> {
  const { data, error } = await supabase
    .from("node_scene_images")
    .select(NODE_COLS)
    .eq("node_id", nodeId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as NodeSceneImage[]) ?? [];
}

/** Kick off the DURABLE one-shot: compose the scene prompt from the node + present-cast portraits, render,
 *  and insert a gallery row. Returns the 'composing' placeholder immediately; the work survives navigation
 *  and flips to 'ready'/'error' over Realtime. When `pin`, the ready image is also written onto the scene
 *  node's content.image_url (the chosen illustration the render reads). `style` overrides the house look. */
export async function startNodeSceneGeneration(
  bookId: number, nodeId: string, opts: { pin?: boolean; instruction?: string; style?: string } = {},
): Promise<NodeSceneImage> {
  const { data, error } = await supabase.functions.invoke("generate-dna-scene-image", {
    body: { bookId, nodeId, mode: "oneshot", pin: opts.pin ?? false, instruction: opts.instruction, style: opts.style },
  });
  if (error) throw error;
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as NodeSceneImage;
}

export interface ComposedSceneImage { prompt: string; refImages: string[]; model: string | null }

/** Compose the scene image prompt (+ refs + model) WITHOUT rendering — for the preview/edit step. */
export async function composeSceneImage(
  bookId: number, nodeId: string, opts: { instruction?: string; style?: string } = {},
): Promise<ComposedSceneImage> {
  const { data, error } = await supabase.functions.invoke("generate-dna-scene-image", {
    body: { bookId, nodeId, mode: "compose", instruction: opts.instruction, style: opts.style },
  });
  if (error) throw error;
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as ComposedSceneImage;
}

/** Render the (possibly author-edited) prompt as a durable scene image; pins onto content.image_url when pin:true. */
export async function renderNodeSceneImage(
  bookId: number, nodeId: string,
  opts: { prompt: string; refImages?: string[]; model?: string | null; pin?: boolean },
): Promise<NodeSceneImage> {
  const { data, error } = await supabase.functions.invoke("generate-dna-scene-image", {
    body: { bookId, nodeId, mode: "render", prompt: opts.prompt, refImages: opts.refImages, model: opts.model ?? undefined, pin: opts.pin ?? false },
  });
  if (error) throw error;
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as NodeSceneImage;
}

export async function deleteNodeSceneImage(id: string): Promise<void> {
  const { error } = await supabase.from("node_scene_images").delete().eq("id", id);
  if (error) throw error;
}
