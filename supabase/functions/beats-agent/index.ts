// beats-agent — the BEAT EDITOR: a conversation about the book's beat sheet. The author asks
// questions, asks for a summary, asks for an evaluation against the fiction criteria — and sometimes
// asks for a change. So a turn is sometimes just TALK and sometimes an ACTION.
//
// Unlike the autonomous editor's agent (revise-agent), the whole beat sheet fits in one context, so
// no tool-loop is needed: each author message is ONE model call. The model replies with a small JSON
// envelope { reply, plan }: `reply` is the prose it says to the author; `plan` is a beat RevisionPlan
// ONLY when the author wants a change (otherwise null). A proposed plan rides in beat_chats.pending_plan
// for the author to review (the existing PlanReview) and apply (build-revision) — the agent never
// mutates the book itself.
//
// This fn is the SINGLE WRITER of the thread: it appends the author's message (so it projects at
// once), calls the model, appends the reply, stores any plan. The client subscribes over Realtime.
//
//   client → POST { bookId, message } → verify edit access → append → model → append → save
//
// Needs the ANTHROPIC_API_KEY secret.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { type Brief, briefContext } from "../_shared/brief.ts";
import { corsHeaders, json } from "../_shared/cors.ts";
import { callClaude as callClaudeApi, textFromClaude } from "../_shared/claude.ts";
import { getActiveModels } from "../_shared/model-config.ts";
import { extractJsonBlock } from "../_shared/json.ts";
import { sanitizePlan, type RevisionPlan } from "../_shared/revision-plan.ts";
import { settledContext, type Foundations } from "../_shared/foundations-core.ts";
import { BEAT_CRITERIA } from "../_shared/beat-criteria.ts";

interface PageRow { id: number; page_index: number; page_type: string | null; title: string | null; metadata: { objective?: string; beat?: string } | null }
interface ThreadLite { id: number; name: string; status: string; setup_page_id: number | null; payoff_page_id: number | null }
interface ChatMessage { role: "user" | "assistant"; text: string; ts: string; plan?: string }
interface ChatRow { id: number; book_id: number; status: string; messages: ChatMessage[]; pending_plan: RevisionPlan | null }

const MAX_HISTORY = 24; // model-context turns (the whole sheet already dominates the prompt)

const SYSTEM = `You are the BEAT EDITOR — a sharp, warm developmental editor in conversation with an author about their book's BEAT SHEET (the ordered spine of beats; objectives + beats per page). Beats are the load-bearing layer: they decide whether the outline and even the premise hold. Prose is downstream and replaceable — never your concern.

You can do three things, and you choose per message:
1. TALK — answer the author's question, summarize the beats, talk through an idea, weigh a trade-off. Be specific and concrete; cite real pages by their title. Never generic.
2. EVALUATE — when asked (or when it's the honest answer), judge the beat sheet against the FICTION CRITERIA below. Name the criterion, point at the exact pages, say what's strong and what sags, and end with the highest-leverage fix. Be candid, not cheerleading.
3. PROPOSE A CHANGE — when the author wants the sheet changed (or you've agreed on a fix), produce a beat REVISION PLAN. You may rewrite beats, retarget objectives, add pages (including a missing midpoint, an escalation, a character-introduction beat), delete redundant/inert pages, and reorder. The author reviews and applies it — you do not mutate anything.

OUTPUT — reply to the author in plain MARKDOWN prose (use **bold**, lists, and line breaks freely). If — and ONLY if — this message proposes a change to the beat sheet, append at the very END a single fenced \`\`\`json code block holding the plan, with nothing after it:
\`\`\`json
{ "summary": "...", "pages": [ { "ref": <id|null>, "op": "keep|retarget|add", "pageType": "section|text", "title": "...", "objective": "...", "beat": "...", "why": "..." } ], "deletes": [ { "ref": <id>, "why": "..." } ] }
\`\`\`
When you are talking, evaluating, or answering — append NO code block at all. When you do propose, the prose above the block briefly says what you changed and why (the author sees the full diff separately).
- PLAN RULES: use ONLY the real [id]s given; every existing page MUST appear in "pages" (with its ref) or in "deletes" — never drop one silently. "section" = chapter/part divider; "text" pages carry a beat. Give every text page an objective AND a beat. Reorder by placing entries in final order. Be surgical — "keep" what works. Honor pinned foundations and tracked-thread setups/payoffs. Never write prose; never use a "revise" op.`;

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

    const { bookId, message } = (await req.json().catch(() => ({}))) as { bookId?: number; message?: string };
    if (!bookId) return json({ error: "bookId is required" }, 400);
    const msg = (message ?? "").trim();
    if (!msg) return json({ error: "message is required" }, 400);

    const { data: book, error: bookError } = await userClient
      .from("books").select("id, name, brief, spine, foundations, owner_id").eq("id", bookId).single();
    if (bookError || !book) return json({ error: "Book not found" }, 404);

    const { data: access } = await userClient
      .from("book_access").select("id").eq("book_id", bookId).eq("user_id", user.id).eq("status", "accepted").maybeSingle();
    if (book.owner_id !== user.id && !access) return json({ error: "Access denied" }, 403);

    // ── Load or open the thread, append the author's message, project it at once ──
    const { data: existing } = await userClient.from("beat_chats").select("id, messages, pending_plan").eq("book_id", bookId).maybeSingle();
    const history: ChatMessage[] = Array.isArray(existing?.messages) ? (existing!.messages as ChatMessage[]) : [];
    const userMsg: ChatMessage = { role: "user", text: msg, ts: new Date().toISOString() };
    const withUser = [...history, userMsg];
    let chatId = existing?.id as number | undefined;
    if (chatId) {
      await userClient.from("beat_chats").update({ messages: withUser, status: "thinking", error: null }).eq("id", chatId);
    } else {
      const { data: ins, error: insErr } = await userClient
        .from("beat_chats").insert({ book_id: bookId, messages: withUser, status: "thinking" }).select("id").single();
      if (insErr) throw insErr;
      chatId = (ins as { id: number }).id;
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) { await fail(userClient, chatId, withUser); return json({ error: "ANTHROPIC_API_KEY not configured" }, 500); }

    const { data: pages } = await userClient
      .from("pages").select("id, page_index, page_type, title, metadata")
      .eq("book_id", bookId).eq("archived", false).order("page_index", { ascending: true });
    const pageRows = (pages as PageRow[] | null) ?? [];

    const { data: threads } = await userClient
      .from("book_threads").select("id, name, status, setup_page_id, payoff_page_id").eq("book_id", bookId).neq("status", "closed");

    try {
      const { reply, plan } = await runTurn(
        apiKey, book.name, book.brief as Brief | null,
        (book.spine as { text?: string } | null)?.text ?? null,
        (book.foundations as Foundations | null) ?? null,
        pageRows, (threads as ThreadLite[] | null) ?? [], withUser, bookId, user.id,
      );
      const sanitized = plan ? sanitizePlan(plan, pageRows, true) : null;
      const assistantMsg: ChatMessage = { role: "assistant", text: reply, ts: new Date().toISOString(), plan: sanitized?.summary };
      await userClient.from("beat_chats").update({
        messages: [...withUser, assistantMsg],
        pending_plan: sanitized ?? (existing?.pending_plan ?? null),
        status: "idle",
      }).eq("id", chatId);
      return json({ reply, plan: sanitized });
    } catch (e) {
      await fail(userClient, chatId, withUser, String((e as Error)?.message ?? e));
      throw e;
    }
  } catch (e) {
    console.error("beats-agent error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});

// deno-lint-ignore no-explicit-any
async function fail(client: any, chatId: number | undefined, messages: ChatMessage[], error?: string) {
  if (!chatId) return;
  await client.from("beat_chats").update({ status: "error", error: (error ?? "Something went wrong").slice(0, 500), messages }).eq("id", chatId);
}

function beatSheetContext(pages: PageRow[]): string {
  return pages.map((p) => {
    if (p.page_type === "section") return `[id=${p.id}] # ${p.title || "(untitled section)"}`;
    const obj = p.metadata?.objective?.trim();
    const beat = p.metadata?.beat?.trim();
    return `[id=${p.id}] - "${p.title || "(untitled)"}"` + (obj ? `\n  objective: ${obj}` : "") + (beat ? `\n  beat: ${beat}` : `\n  beat: (none yet)`);
  }).join("\n");
}

function threadsContext(threads: ThreadLite[]): string {
  return threads.map((t) => {
    const setup = t.setup_page_id != null ? ` setup@page ${t.setup_page_id}` : "";
    const payoff = t.payoff_page_id != null ? ` payoff@page ${t.payoff_page_id}` : "";
    return `- "${t.name}" (${t.status})${setup}${payoff}`;
  }).join("\n");
}

async function runTurn(
  apiKey: string, bookName: string, brief: Brief | null, spineText: string | null,
  foundations: Foundations | null, pages: PageRow[], threads: ThreadLite[],
  messages: ChatMessage[], bookId: number, userId: string,
): Promise<{ reply: string; plan: Partial<RevisionPlan> | null }> {
  const { high: model } = await getActiveModels();
  const settled = foundations ? settledContext(foundations).trim() : "";
  const context =
    `BOOK: ${bookName}\n\nBRIEF (the voice contract):\n${briefContext(brief, { scope: "full", success: true, none: "(no brief set)", empty: "(brief is empty)" })}` +
    (spineText?.trim() ? `\n\nSPINE (the book in one arc):\n${spineText.trim()}` : "") +
    (settled ? `\n\nFOUNDATIONS (settled — pinned lines are immutable):\n${settled}` : "") +
    `\n\nCURRENT BEAT SHEET (these are the real page ids):\n${beatSheetContext(pages)}` +
    (threads.length ? `\n\nTRACKED THREADS (keep their setups & payoffs intact):\n${threadsContext(threads)}` : "") +
    `\n\nFICTION CRITERIA (use when evaluating):\n${BEAT_CRITERIA}`;

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
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: modelMsgs,
  }, { fn: "beats-agent", bookId, userId });

  const text = textFromClaude(data).trim();
  if (!text) throw new Error("The editor returned nothing.");
  return splitReplyAndPlan(text);
}

// The reply is plain markdown prose; a proposed change rides in a TRAILING ```json fenced block.
// Keeping prose OUT of the JSON means newlines/markdown/truncation can never corrupt the reply —
// at worst a malformed trailing block costs the plan (which we'd reject anyway), never the message.
function splitReplyAndPlan(text: string): { reply: string; plan: Partial<RevisionPlan> | null } {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```\s*$/);
  if (!m || m.index == null) return { reply: text, plan: null };
  const reply = text.slice(0, m.index).trim();
  try {
    const parsed = JSON.parse(extractJsonBlock(m[1]));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { reply: reply || "Here's a proposed revision — review it below.", plan: parsed as Partial<RevisionPlan> };
    }
  } catch { /* malformed trailing block → keep the whole text as prose */ }
  return { reply: text, plan: null };
}
