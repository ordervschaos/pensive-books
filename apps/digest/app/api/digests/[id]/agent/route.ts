import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { NEW_CHAT, runAgentTurn, type ChatContext, type DigestForAgent } from "@/lib/digest/agent/loop";

// One agent turn. POST { message, chatId? } → the reply, what it did, and where the conversation lives.
//
// Request-scoped (RLS-enforcing) client throughout: this acts for a signed-in reader on their own digest,
// unlike the 6am pipeline, which has no JWT to present and therefore holds the service role. The agent
// having only the reader's own authority is the outer boundary; `ToolCtx` pinning the digest id is the
// inner one.
//
// Not streamed, yet. A turn measured 7–16s, which a spinner covers, and the honest reason to stream is that
// watching the steps arrive is most of what makes a rail feel alive rather than that the total is faster.
// It is the obvious next change — the Node runtime streams with no config, and `runAgentTurn` already
// produces steps in order.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const digestId = Number(params.id);
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { message, chatId } = (await request.json()) as { message?: string; chatId?: number };
  if (!message?.trim()) return NextResponse.json({ error: "Say something first." }, { status: 400 });

  const { data: digest } = await supabase
    .from("digests")
    .select("id, owner_id, name, ai_enabled")
    .eq("id", digestId)
    .maybeSingle();
  if (!digest) return NextResponse.json({ error: "No such digest" }, { status: 404 });

  // Load the conversation so far, WITH its fold and fence bookkeeping — the transcript alone would make the
  // agent re-send everything it has already summarised. Scoped by digest as well as by id, so a chat id from
  // another digest cannot be used to graft one conversation onto another.
  let chat: ChatContext = NEW_CHAT;
  if (chatId) {
    const { data } = await supabase
      .from("digest_agent_chats")
      .select("messages, fold, folded_through, last_version")
      .eq("id", chatId)
      .eq("digest_id", digestId)
      .maybeSingle();
    const row = data as {
      messages: ChatContext["messages"];
      fold: string | null;
      folded_through: number;
      last_version: number | null;
    } | null;
    if (row) {
      chat = {
        messages: row.messages ?? [],
        fold: row.fold,
        foldedThrough: row.folded_through ?? 0,
        lastVersion: row.last_version,
      };
    }
  }

  let turn;
  try {
    turn = await runAgentTurn({
      supabase,
      digest: digest as DigestForAgent,
      chat,
      message,
      signal: request.signal,
    });
  } catch (e) {
    // The gate ("AI is off for this digest") arrives here too, and it is a thing the reader can act on —
    // so it goes back as a readable sentence rather than a 500 with a stack trace behind it.
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const state = {
    messages: turn.chat.messages,
    fold: turn.chat.fold,
    folded_through: turn.chat.foldedThrough,
    last_version: turn.chat.lastVersion,
    updated_at: new Date().toISOString(),
  };
  const saved = chatId
    ? await supabase
        .from("digest_agent_chats")
        .update(state)
        .eq("id", chatId)
        .eq("digest_id", digestId)
        .select("id")
        .maybeSingle()
    : await supabase
        .from("digest_agent_chats")
        .insert({ ...state, digest_id: digestId, owner_id: user.id, title: message.trim().slice(0, 80) })
        .select("id")
        .maybeSingle();

  return NextResponse.json({
    text: turn.text,
    steps: turn.steps,
    stoppedAt: turn.stoppedAt,
    chatId: (saved.data as { id: number } | null)?.id ?? chatId ?? null,
    // Whether anything was WRITTEN, so the client knows if the rest of the app needs re-rendering. Derived
    // from the steps rather than trusted from the model's prose, which is a different kind of claim.
    changed: turn.steps.some((s) => !s.isError && !s.tool.startsWith("read") && s.tool !== "check_readiness"),
  });
}
