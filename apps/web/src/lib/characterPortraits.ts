// characterPortraits — the client for a DNA character node's "design the look" (picture-book mode,
// docs/picture-book-mode.md). The node-keyed sibling of sceneImages' portrait helpers: variants render on
// the edge fn generate-dna-character-portrait (the bridge can't generate images), and the author pins the
// chosen one(s) onto character.content.portraits — which scene renders feed back in for likeness.
import { supabase } from "@/integrations/supabase/client";
import { saveNode } from "@/lib/bookNodes";
import { editContent, type CharacterContent, type DnaNode } from "@/lib/novelDna";

/** Render `count` portrait VARIANTS for a character node. Composes a prompt server-side from the node when
 *  none is given (one-click). Returns the stored URLs — NOT pinned; the caller lets the author pick. */
export async function renderDnaPortraitVariants(
  bookId: number, nodeId: string, opts: { prompt?: string; instruction?: string; count?: number; refUrls?: string[] } = {},
): Promise<string[]> {
  const { data, error } = await supabase.functions.invoke("generate-dna-character-portrait", {
    body: { bookId, nodeId, mode: "image", count: opts.count ?? 3, prompt: opts.prompt, instruction: opts.instruction, refUrls: opts.refUrls ?? [] },
  });
  if (error) throw error;
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return (data as { urls?: string[] }).urls ?? [];
}

const portraitsOf = (node: DnaNode): string[] => ((node.content as CharacterContent).portraits ?? []).filter(Boolean);

/** Pin a portrait onto the character node (append to content.portraits, de-duped) — the reference scene
 *  renders use for this character's likeness. */
export async function pinCharacterPortrait(node: DnaNode, url: string): Promise<void> {
  if (portraitsOf(node).includes(url)) return;
  await saveNode(editContent(node, { portraits: [...portraitsOf(node), url] }));
}

/** Unpin a portrait (remove from content.portraits). */
export async function unpinCharacterPortrait(node: DnaNode, url: string): Promise<void> {
  await saveNode(editContent(node, { portraits: portraitsOf(node).filter((u) => u !== url) }));
}

/** Legacy carry-over: portraits this character already has in the book's foundations.cast (matched by name),
 *  minus any already pinned on the node. Lets a book migrated BEFORE picture mode reuse its existing "design
 *  the look" art without re-migrating. Empty for DNA-native books (no foundations.cast). */
export async function legacyPortraitsFor(bookId: number, node: DnaNode): Promise<string[]> {
  const name = (node.content as CharacterContent).name?.trim().toLowerCase();
  if (!name) return [];
  const { data } = await supabase.from("books").select("foundations").eq("id", bookId).maybeSingle();
  const cast = ((data?.foundations as { cast?: { name?: string; portraits?: string[]; ref_image_url?: string }[] } | null)?.cast ?? []);
  const member = cast.find((m) => m.name?.trim().toLowerCase() === name);
  if (!member) return [];
  const legacy = [...(member.portraits ?? []), ...(member.ref_image_url ? [member.ref_image_url] : [])].filter(Boolean);
  const already = new Set(portraitsOf(node));
  return [...new Set(legacy)].filter((u) => !already.has(u));
}
