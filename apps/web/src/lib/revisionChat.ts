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
  type CastMember, type Foundations, type Narration, type Relationship, type Tentpole, type WorldNode,
} from "@/lib/foundations";
import { saveSpine } from "@/lib/ladder";

export type RevisionLayer = "foundations" | "spine" | "beats" | "outline";

export interface ChatMessage { role: "user" | "assistant"; text: string; ts: string; plan?: string }

export interface FoundationsPatch {
  argument?: string;
  ending?: string;
  voice?: string;
  cast?: CastMember[];
  tentpoles?: Tentpole[];
  // F2: relationships carried alongside cast proposals (edge normalizer attaches them).
  relationships?: Relationship[];
  // F3a: world node applied from revision-chat proposals.
  world?: WorldNode;
  // F4a: narration mode applied from revision-chat proposals.
  narration?: Narration;
}
export interface SpinePatch { text: string }

export type RevisionPatch =
  | { layer: "foundations"; data: FoundationsPatch }
  | { layer: "spine"; data: SpinePatch }
  | { layer: "beats"; data: RevisionPlan }
  | { layer: "outline"; data: RevisionPlan };

export interface RevisionProposal { summary: string; patch: RevisionPatch }

// The canonical "generate this layer from scratch" message — the SINGLE source shared by the chat's
// empty-state chip and the center's empty-state button (which both just send it to the rail thread).
export const GENERATE_PROMPTS: Record<RevisionLayer, string> = {
  foundations: "Draft the foundations from the brief — the argument (the claim the book argues), the ending it implies, a small cast (each with want/wound/lie), a few tentpole moments, and a voice exemplar.",
  spine: "Draft the spine from the foundations — the whole book as one ~250-500-word causal arc, from the beginning, through the pinned tentpoles, to the settled ending.",
  outline: "Draft the outline from the spine — the chapter/page structure and a clear objective for each page (no beats or prose yet). Propose it as a plan I can review.",
  beats: "Plan a beat for every page that has an objective but no beat yet — the strongest beat for each, serving the spine and consistent with the pages around it. Propose them as a plan I can review.",
};

// ── Center → rail generate bus ───────────────────────────────────────────────
// The center's empty-state "Draft …" button is a thin REMOTE CONTROL for the rail: instead of
// calling the edge itself (which left the rail with no optimistic echo and swallowed errors), it
// rings this in-memory bell and the mounted ReviseChat for that layer runs its OWN send() — so the
// message + "sending…" appear in the chat instantly and errors surface there. Pure UI coordination
// (the server state still flows through the rail's send/refetch + Realtime projection).
type GenerateListener = (layer: RevisionLayer) => void;
const generateListeners = new Map<number, Set<GenerateListener>>();

/** Ask the rail for `layer` (book-scoped) to generate. No-op if no rail is mounted for it. */
export function emitGenerate(bookId: number, layer: RevisionLayer): void {
  generateListeners.get(bookId)?.forEach((fn) => fn(layer));
}

/** Subscribe a mounted rail to center-triggered generates for its book. Returns an unsubscribe fn. */
export function onGenerate(bookId: number, fn: GenerateListener): () => void {
  let set = generateListeners.get(bookId);
  if (!set) { set = new Set(); generateListeners.set(bookId, set); }
  set.add(fn);
  return () => { set!.delete(fn); if (set!.size === 0) generateListeners.delete(bookId); };
}

/** An archived conversation (the "+ New chat" snapshot), kept on the row for the Past-chats viewer. */
export interface RevisionSession { messages: ChatMessage[]; pending_proposal: RevisionProposal | null; ended_at: string }

export interface RevisionChatRow {
  id: number;
  book_id: number;
  layer: RevisionLayer;
  status: "idle" | "thinking" | "error";
  messages: ChatMessage[];
  pending_proposal: RevisionProposal | null;
  sessions?: RevisionSession[];
  error: string | null;
  created_at: string;
  updated_at?: string | null;
  [key: string]: unknown;
}

/**
 * Start a fresh conversation: archive the current thread into `sessions` (recoverable in the rail's
 * Past-chats viewer) and reset the active messages/pending_proposal to empty. The edge fn keeps
 * writing the active `messages`, so the next send begins a clean thread. No-op if already empty.
 */
export async function startNewRevisionSession(bookId: number, layer: RevisionLayer): Promise<void> {
  const { data } = await supabase
    .from("revision_chats").select("messages, pending_proposal, sessions").eq("book_id", bookId).eq("layer", layer).maybeSingle();
  const messages = Array.isArray(data?.messages) ? (data!.messages as ChatMessage[]) : [];
  if (messages.length === 0) return; // nothing to archive
  const sessions = Array.isArray(data?.sessions) ? (data!.sessions as RevisionSession[]) : [];
  const archived: RevisionSession = { messages, pending_proposal: (data?.pending_proposal as RevisionProposal | null) ?? null, ended_at: new Date().toISOString() };
  const { error } = await supabase
    .from("revision_chats")
    .update({ messages: [], pending_proposal: null, sessions: [archived, ...sessions], status: "idle" })
    .eq("book_id", bookId).eq("layer", layer);
  if (error) throw error;
}

/**
 * Resume an archived past session as the live conversation: swaps the chosen session's messages
 * back into the active slot, archiving the current active thread first so nothing is lost. Symmetric
 * with startNewRevisionSession — the inverse direction. The edge fn replays the swapped-in messages
 * as conversation history on the next turn, so the author picks up exactly where that chat left off.
 * No-op if `index` does not exist in sessions.
 */
export async function resumeRevisionSession(bookId: number, layer: RevisionLayer, index: number): Promise<void> {
  const { data } = await supabase
    .from("revision_chats").select("messages, pending_proposal, sessions").eq("book_id", bookId).eq("layer", layer).maybeSingle();
  const sessions = Array.isArray(data?.sessions) ? (data!.sessions as RevisionSession[]) : [];
  const target = sessions[index];
  if (!target) return; // no-op — index out of bounds
  const messages = Array.isArray(data?.messages) ? (data!.messages as ChatMessage[]) : [];
  const remaining = sessions.filter((_, i) => i !== index);
  // Archive the current active thread only if it has content — nothing to preserve if already empty.
  const nextSessions: RevisionSession[] =
    messages.length > 0
      ? [{ messages, pending_proposal: (data?.pending_proposal as RevisionProposal | null) ?? null, ended_at: new Date().toISOString() }, ...remaining]
      : remaining;
  const { error } = await supabase
    .from("revision_chats")
    .update({ messages: target.messages, pending_proposal: target.pending_proposal ?? null, sessions: nextSessions, status: "idle" })
    .eq("book_id", bookId).eq("layer", layer);
  if (error) throw error;
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
 * Record an applied revision IN the thread (an assistant note) and clear the pending proposal in the
 * SAME write — so the conversation reflects the change (and never blanks) right after Apply. Keeps
 * the existing messages; the edge fn keeps appending to this same array on the next turn.
 */
export async function recordApplied(bookId: number, layer: RevisionLayer, note: string): Promise<void> {
  const { data } = await supabase.from("revision_chats").select("messages").eq("book_id", bookId).eq("layer", layer).maybeSingle();
  const messages = Array.isArray(data?.messages) ? (data!.messages as ChatMessage[]) : [];
  const applied: ChatMessage = { role: "assistant", text: note, ts: new Date().toISOString() };
  const { error } = await supabase
    .from("revision_chats").update({ messages: [...messages, applied], pending_proposal: null })
    .eq("book_id", bookId).eq("layer", layer);
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
  // beats & outline both ride the plan-only build-revision path (structure + objectives [+ beats];
  // never prose). An outline plan simply carries no beat field.
  if (patch.layer === "beats" || patch.layer === "outline") {
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
  // F2: apply relationships alongside a cast proposal (edge normalizer resolves name→id references).
  if (Array.isArray(d.relationships)) next.relationships = d.relationships;
  // F3a: apply world node if the chat proposes one.
  if (d.world && typeof d.world === "object" && !Array.isArray(d.world)) next.world = d.world as WorldNode;
  // F4a: apply narration mode if the chat proposes one.
  if (d.narration && typeof d.narration === "object" && !Array.isArray(d.narration)) next.narration = d.narration as Narration;
  await writeFoundations(bookId, next);
}
