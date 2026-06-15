// beatChat — the client for the conversational beat editor (beats-agent).
//
// The edge fn is the single writer of the beat_chats thread; the client sends a message and watches
// the row over Realtime (refresh = no-op). A proposed beat revision rides in `pending_plan` — applied
// via applyBeatPlan (build-revision) or discarded by clearing it.
import { supabase } from "@/integrations/supabase/client";
import { BRIDGE, bridgeFetch } from "@/lib/bridge";
import type { RevisionPlan } from "@/lib/beatSheet";

export interface ChatMessage { role: "user" | "assistant"; text: string; ts: string; plan?: string }
export interface BeatChatRow {
  id: number;
  status: "idle" | "thinking" | "error";
  messages: ChatMessage[];
  pending_plan: RevisionPlan | null;
  error: string | null;
  created_at: string;
  updated_at?: string | null;
  [key: string]: unknown;
}

/** Send one author message. The reply + any plan land in beat_chats (watch it over Realtime). */
export async function sendBeatMessage(bookId: number, message: string): Promise<void> {
  const body = { bookId, message };
  if (BRIDGE) {
    const r = await bridgeFetch("/beats-agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    return;
  }
  const { error } = await supabase.functions.invoke("beats-agent", { body });
  if (error) throw error;
}

/** Discard the pending proposed plan (the conversation stays). */
export async function clearPendingPlan(bookId: number): Promise<void> {
  const { error } = await supabase.from("beat_chats").update({ pending_plan: null }).eq("book_id", bookId);
  if (error) throw error;
}
