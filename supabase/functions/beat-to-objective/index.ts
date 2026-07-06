// beat-to-objective — the beat→objective transform (an UPWARD/reverse edge of the resolution ladder).
//
// Reverse-outlining one rung up: read a page's BEAT (its concrete plan) and abstract it into the
// page's OBJECTIVE — the one-sentence statement of what the page must achieve. Used to pull a
// hand-edited beat back up into the objective, or backfill a missing objective from a beat.
//
//   client → POST { bookId, pageId, beat } → verify edit access → Claude → { objective }
//
// Synchronous, like objective-to-beat. The client sets the page objective (host-owned) and
// reconciles the objective_beat edge. Needs ANTHROPIC_API_KEY.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { type Brief, briefContext } from "../_shared/brief.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { hasEditAccess } from "../_shared/access.ts";
import { callLLM, textFromLLM } from "../_shared/llm.ts";
import { getActiveModels } from "../_shared/model-config.ts";


const SYSTEM = `You are a book architect ABSTRACTING UP: given a page's BEAT (a paragraph planning, in order, what the page does), write the page's OBJECTIVE — a single short statement (1–2 sentences) of what that page must ACHIEVE in the book: its job, not its moves. You are stepping up one level of abstraction, from the concrete plan to the page's purpose.

Rules:
- Output the objective only: 1–2 sentences, no title, no heading, no preamble, no markdown, no meta commentary.
- State the page's JOB (what it accomplishes / what changes), not a retelling of the beat's steps and not prose.
- Be faithful to what the beat actually does (this is reverse-outlining); the spine only frames the level of abstraction.
- Stay in the register the brief and book spine imply.`;


Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const { bookId, pageId, beat } = (await req.json().catch(() => ({}))) as {
      bookId?: number; pageId?: number; beat?: string;
    };
    if (!bookId || !pageId) return json({ error: "bookId and pageId are required" }, 400);
    const beatText = (beat ?? "").trim();
    if (!beatText) return json({ error: "The page has no beat to distill an objective from" }, 400);

    const { data: book, error: bookError } = await userClient
      .from("books").select("id, name, owner_id, brief, spine").eq("id", bookId).single();
    if (bookError || !book) return json({ error: "Book not found" }, 404);

    if (!(await hasEditAccess(userClient, bookId, user.id, book.owner_id)))
      return json({ error: "Access denied" }, 403);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const { data: page } = await userClient.from("pages").select("title").eq("id", pageId).maybeSingle();
    const spine = (book.spine as { text?: string } | null)?.text?.trim() || null;
    const title = (page as { title?: string } | null)?.title ?? null;

    const { high: model } = await getActiveModels();
    const data = await callLLM(apiKey, {
      model,
      max_tokens: 512,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{
        role: "user",
        content:
          `BOOK: ${book.name}\n\nBRIEF:\n${briefContext(book.brief as Brief | null, { scope: "none", success: false, none: "(no brief set)", empty: "(brief is empty)" })}` +
          (spine ? `\n\nBOOK SPINE (for framing the abstraction level):\n${spine}` : "") +
          `\n\nTHE PAGE'S BEAT${title ? ` ("${title}")` : ""} — abstract this up into the page's objective:\n${beatText}` +
          `\n\nWrite the objective this beat serves. 1–2 sentences, the page's job only.`,
      }],
    }, { fn: "beat-to-objective", bookId, userId: user.id });

    const objective = textFromLLM(data).trim();
    if (!objective) return json({ error: "Claude returned no objective." }, 502);

    return json({ objective });
  } catch (e) {
    console.error("beat-to-objective error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});
