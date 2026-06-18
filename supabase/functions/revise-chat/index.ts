// revise-chat — the UNIFIED REVISION AGENT: one conversational editor, parameterized by LAYER
// (foundations / spine / beats). The author asks a question, asks for a pressure-test/evaluation, and
// sometimes asks for a change — so a turn is sometimes TALK and sometimes an ACTION.
//
// Like beats-agent (which this generalizes), the whole layer fits in one context, so no tool-loop is
// needed: each author message is ONE model call. The per-layer behavior lives in _shared/revision-chat
// LENSES (system + context + sanitize); this fn is the thin single-writer host. The model replies in
// markdown and, ONLY when proposing a change, appends a trailing ```json block; we split it and run
// the layer's sanitize to a RevisionProposal { summary, patch } that rides in
// revision_chats.pending_proposal for the author to review and apply — the agent never mutates the book.
//
//   client → POST { bookId, layer, message } → verify edit access → append → model → append → save
//
// One thread per (book, layer). Needs the ANTHROPIC_API_KEY secret.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import type { Brief } from "../_shared/brief.ts";
import { corsHeaders, json } from "../_shared/cors.ts";
import { callClaude as callClaudeApi, textFromClaude } from "../_shared/claude.ts";
import { getActiveModels } from "../_shared/model-config.ts";
import { type Foundations } from "../_shared/foundations-core.ts";
import {
  LENSES, splitReplyAndBlock, targetAllowed,
  type ChatMessage, type LensContext, type PageRow, type RevisionLayer, type RevisionProposal, type ThreadLite,
} from "../_shared/revision-chat.ts";

const MAX_HISTORY = 24; // model-context turns (the layer's knowledge base already dominates the prompt)
const LAYERS: RevisionLayer[] = ["foundations", "spine", "beats", "outline"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
    );
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const { bookId, layer, message } = (await req.json().catch(() => ({}))) as { bookId?: number; layer?: RevisionLayer; message?: string };
    if (!bookId) return json({ error: "bookId is required" }, 400);
    if (!layer || !LAYERS.includes(layer)) return json({ error: "a valid layer is required" }, 400);
    const msg = (message ?? "").trim();
    if (!msg) return json({ error: "message is required" }, 400);
    const lens = LENSES[layer];

    const { data: book, error: bookError } = await userClient
      .from("books").select("id, name, brief, spine, foundations, owner_id").eq("id", bookId).single();
    if (bookError || !book) return json({ error: "Book not found" }, 404);

    const { data: access } = await userClient
      .from("book_access").select("id").eq("book_id", bookId).eq("user_id", user.id).eq("status", "accepted").maybeSingle();
    if (book.owner_id !== user.id && !access) return json({ error: "Access denied" }, 403);

    // ── Load or open this (book, layer) thread, append the author's message, project it at once ──
    const { data: existing } = await userClient
      .from("revision_chats").select("id, messages, pending_proposal").eq("book_id", bookId).eq("layer", layer).maybeSingle();
    const history: ChatMessage[] = Array.isArray(existing?.messages) ? (existing!.messages as ChatMessage[]) : [];
    const userMsg: ChatMessage = { role: "user", text: msg, ts: new Date().toISOString() };
    const withUser = [...history, userMsg];
    let chatId = existing?.id as number | undefined;
    if (chatId) {
      await userClient.from("revision_chats").update({ messages: withUser, status: "thinking", error: null }).eq("id", chatId);
    } else {
      const { data: ins, error: insErr } = await userClient
        .from("revision_chats").insert({ book_id: bookId, layer, messages: withUser, status: "thinking" }).select("id").single();
      if (insErr) throw insErr;
      chatId = (ins as { id: number }).id;
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) { await fail(userClient, chatId, withUser); return json({ error: "ANTHROPIC_API_KEY not configured" }, 500); }

    // Only the beats lens reads pages/threads; loading them always is cheap and keeps this host generic.
    const { data: pages } = await userClient
      .from("pages").select("id, page_index, page_type, title, metadata")
      .eq("book_id", bookId).eq("archived", false).order("page_index", { ascending: true });
    const { data: threads } = await userClient
      .from("book_threads").select("id, name, status, setup_page_id, payoff_page_id").eq("book_id", bookId).neq("status", "closed");

    const ctx: LensContext = {
      bookName: book.name,
      brief: book.brief as Brief | null,
      spineText: (book.spine as { text?: string } | null)?.text ?? null,
      foundations: (book.foundations as Foundations | null) ?? null,
      pages: (pages as PageRow[] | null) ?? [],
      threads: (threads as ThreadLite[] | null) ?? [],
    };

    try {
      const { reply, proposal } = await runTurn(apiKey, layer, lens, ctx, withUser, bookId, user.id);
      const assistantMsg: ChatMessage = { role: "assistant", text: reply, ts: new Date().toISOString(), plan: proposal?.summary };
      await userClient.from("revision_chats").update({
        messages: [...withUser, assistantMsg],
        pending_proposal: proposal ?? ((existing?.pending_proposal as RevisionProposal | null) ?? null),
        status: "idle",
      }).eq("id", chatId);
      return json({ reply, proposal });
    } catch (e) {
      await fail(userClient, chatId, withUser, String((e as Error)?.message ?? e));
      throw e;
    }
  } catch (e) {
    console.error("revise-chat error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});

// deno-lint-ignore no-explicit-any
async function fail(client: any, chatId: number | undefined, messages: ChatMessage[], error?: string) {
  if (!chatId) return;
  await client.from("revision_chats").update({ status: "error", error: (error ?? "Something went wrong").slice(0, 500), messages }).eq("id", chatId);
}

async function runTurn(
  apiKey: string, layer: RevisionLayer, lens: typeof LENSES[RevisionLayer], ctx: LensContext,
  messages: ChatMessage[], bookId: number, userId: string,
): Promise<{ reply: string; proposal: RevisionProposal | null }> {
  const { high: model } = await getActiveModels();
  const context = lens.context(ctx);

  // The thread as alternating turns; the standing context rides on the first user turn.
  const recent = messages.slice(-MAX_HISTORY);
  const modelMsgs = recent.map((m, i) => ({
    role: m.role,
    content: [{ type: "text" as const, text: i === 0 && m.role === "user" ? `${context}\n\n— — —\n\nAUTHOR: ${m.text}` : m.text }],
  }));
  // Guarantee the array opens on a user turn (Claude requires it).
  if (modelMsgs[0]?.role !== "user") modelMsgs.unshift({ role: "user", content: [{ type: "text", text: context }] });

  const data = await callClaudeApi(apiKey, {
    model,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: [{ type: "text", text: lens.system, cache_control: { type: "ephemeral" } }],
    messages: modelMsgs,
  }, { fn: "revise-chat", bookId, userId });

  const text = textFromClaude(data).trim();
  if (!text) throw new Error("The editor returned nothing.");

  const { reply, parsed } = splitReplyAndBlock(text);
  if (!parsed) return { reply, proposal: null };
  // Upward editing: the model may name an upstream target layer in the json block.
  // Validate it; fall back to the chat's own layer if absent, disallowed, or downstream.
  const rawTarget = typeof parsed.target === "string" ? parsed.target as RevisionLayer : layer;
  const target = LAYERS.includes(rawTarget) && targetAllowed(layer, rawTarget) ? rawTarget : layer;
  const patch = LENSES[target].sanitize(parsed, ctx);
  if (!patch) return { reply, proposal: null };
  const summary = typeof parsed.summary === "string" && parsed.summary.trim()
    ? parsed.summary.trim()
    : (patch.layer === "beats" ? patch.data.summary : "Proposed revision");
  return { reply, proposal: { summary, patch } };
}
