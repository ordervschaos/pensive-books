// revisionChat — the client for the UNIFIED revision layer (revise-chat edge fn).
//
// One conversational reviser per (book, LAYER). The edge fn is the single writer of the
// revision_chats thread; the client sends a message and watches the row over Realtime (refresh =
// no-op). A proposed change rides in `pending_proposal` — a layer-tagged RevisionProposal envelope
// — applied via applyProposal (each layer's existing write path) or discarded by clearing it.
//
// Types mirror the edge copy in supabase/functions/_shared/revision-chat.ts — keep the two in sync.
import { supabase } from "@/integrations/supabase/client";
import { BRIDGE, bridgeFetch } from "@/lib/bridge";
import { applyBeatPlan, type RevisionPlan } from "@/lib/beatSheet";
import {
  pinNode, readFoundations, writeFoundations,
  type CastMember, type Foundations, type Tentpole,
} from "@/lib/foundations";
import { saveSpine } from "@/lib/ladder";

export type RevisionLayer = "foundations" | "spine" | "beats";

export interface ChatMessage { role: "user" | "assistant"; text: string; ts: string; plan?: string }

export interface FoundationsPatch {
  argument?: string;
  ending?: string;
  voice?: string;
  cast?: CastMember[];
  tentpoles?: Tentpole[];
}
export interface SpinePatch { text: string }

export type RevisionPatch =
  | { layer: "foundations"; data: FoundationsPatch }
  | { layer: "spine"; data: SpinePatch }
  | { layer: "beats"; data: RevisionPlan };

export interface RevisionProposal { summary: string; patch: RevisionPatch }

export interface RevisionChatRow {
  id: number;
  book_id: number;
  layer: RevisionLayer;
  status: "idle" | "thinking" | "error";
  messages: ChatMessage[];
  pending_proposal: RevisionProposal | null;
  error: string | null;
  created_at: string;
  updated_at?: string | null;
  [key: string]: unknown;
}

/** Send one author message to a layer's reviser. The reply + any proposal land in revision_chats
 *  (watch it over Realtime). */
export async function sendRevisionMessage(bookId: number, layer: RevisionLayer, message: string): Promise<void> {
  const body = { bookId, layer, message };
  if (BRIDGE) {
    const r = await bridgeFetch("/revise-chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    return;
  }
  const { error } = await supabase.functions.invoke("revise-chat", { body });
  if (error) throw error;
}

/** Discard the pending proposed change (the conversation stays). */
export async function clearPendingProposal(bookId: number, layer: RevisionLayer): Promise<void> {
  const { error } = await supabase.from("revision_chats").update({ pending_proposal: null }).eq("book_id", bookId).eq("layer", layer);
  if (error) throw error;
}

/**
 * Apply an approved proposal through that layer's EXISTING write path, so provenance stamping (and
 * therefore downstream staleness) is unchanged:
 *   foundations → merge the patch into books.foundations (pins the touched lines — Apply is an
 *                 explicit author gesture); cast/tentpoles are already pin-reconciled by the edge.
 *   spine       → saveSpine (pinned), the brief→spine edge re-stamped.
 *   beats       → applyBeatPlan → a book_revisions row + build-revision (plan-only).
 */
export async function applyProposal(bookId: number, proposal: RevisionProposal): Promise<void> {
  const { patch } = proposal;
  if (patch.layer === "beats") {
    await applyBeatPlan(bookId, patch.data);
    return;
  }
  if (patch.layer === "spine") {
    await saveSpine(bookId, patch.data.text.trim(), { pinned: true });
    return;
  }
  // foundations: merge only the keys the patch carries.
  const cur: Foundations = (await readFoundations(bookId)) ?? {};
  const next: Foundations = { ...cur };
  const d = patch.data;
  if (typeof d.argument === "string" && d.argument.trim()) next.argument = pinNode(cur.argument, d.argument.trim());
  if (typeof d.ending === "string" && d.ending.trim()) next.ending = pinNode(cur.ending, d.ending.trim());
  if (typeof d.voice === "string" && d.voice.trim()) next.voice_exemplar = pinNode(cur.voice_exemplar, d.voice.trim());
  if (Array.isArray(d.cast)) next.cast = d.cast;
  if (Array.isArray(d.tentpoles)) next.tentpoles = d.tentpoles;
  await writeFoundations(bookId, next);
}
