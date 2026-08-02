import type { Closer, QuizSection, RenderedSection, RunCtx, Section } from "./types";
import { aiEnabled, callModel } from "./llm";
import { createServiceClient } from "@/lib/supabase/server";

// CLOSERS — the second contract.
//
// Everything in ./sources answers "what should the reader see?" by retrieving. A closer answers it by
// reading what the other sections already produced. Modelling one as an Adapter would be a type lie: it
// retrieves nothing, has no Items, and must run AFTER the sections it consumes. A separate signature makes
// that ordering a property of the type rather than a comment someone has to obey.
//
// This is where the digest stops being a feed reader. A closer can use the one asset no feed reader has:
// the digest knows what it told you yesterday.

// ---------------------------------------------------------------------------------------------------
// quiz — retrieval practice on the last issue
// ---------------------------------------------------------------------------------------------------
// The testing effect: being asked to recall something strengthens memory far more than re-reading it. A
// daily digest without this is a conveyor belt — you read six hundred words every morning and retain
// approximately none of it, which is the honest failure mode of every newsletter anyone has ever
// subscribed to.
//
// Over the PREVIOUS issue by default, because quizzing today's issue asks about text the reader hasn't got
// to yet. `over: "today"` exists for the case where the quiz sits at the end as a self-check.
const QUIZ_SYSTEM = `You write a short recall quiz at the end of a daily reading digest.

HARD RULES:
- Every question must be answerable from the material below, and every answer must appear in it verbatim or by direct paraphrase. You have no other knowledge. If the material is too thin for three questions, write fewer.
- Ask about the SPECIFIC: the number, the name, the claim, the thing that would be worth remembering in a month. Never ask "what was the article about" or anything answerable by having glanced at a headline.
- No trick questions, no trivia for its own sake, and never quiz something the material only implies.
- No preamble, no sign-off, no restating the section title, no explaining what a quiz is.

FORMAT: a numbered list of at most 3 questions. Then a line containing exactly ---. Then "**Answers:**" and the same numbers with one-line answers. Nothing else.`;

const quizCloser: Closer = async (section, sections, ctx, issueId) => {
  const s = section as QuizSection;

  // No non-AI equivalent — a recall quiz over yesterday's issue IS a model call. Drop it, same as any
  // other closer that has nothing honest to say this morning.
  if (!aiEnabled(ctx.digest)) return null;

  const material =
    s.over === "today" ? fromSections(sections) : await previousIssueMaterial(ctx);
  // Nothing to quiz is not a failure — it's the first morning, or yesterday was skipped. A section that
  // can't be honest is dropped, same rule as every other section in the pipeline.
  if (!material || material.length < 400) return null;

  const { text } = await callModel(
    {
      system: QUIZ_SYSTEM,
      prompt:
        (s.over === "today"
          ? "Today's issue:\n\n"
          : "The issue this reader received last time:\n\n") +
        material +
        (s.instructions ? `\n\nWhat this section is for: ${s.instructions}` : ""),
      maxTokens: 700,
      effort: "low",
      signal: ctx.signal,
    },
    { fn: "digest-write", operation: "write_quiz", issueId, userId: ctx.digest.owner_id },
  );

  const body = text.trim();
  if (!body) return null;
  // A closer carries no items: nothing was retrieved, so there is nothing to credit or to mark delivered.
  return { id: s.id, title: s.title, markdown: body, items: [] };
};

function fromSections(sections: RenderedSection[]): string {
  return sections.map((sec) => `## ${sec.title}\n${sec.markdown}`).join("\n\n");
}

// The last issue this digest actually DELIVERED. Not the last row — a skipped or failed issue was never
// read, and quizzing someone on an issue they never received is worse than skipping the section.
async function previousIssueMaterial(ctx: RunCtx): Promise<string | null> {
  const { data } = await createServiceClient()
    .from("digest_issues")
    .select("content, issue_date")
    .eq("digest_id", ctx.digest.id)
    .eq("status", "sent")
    .lt("issue_date", ctx.issueDate)
    .order("issue_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const content = (data as { content?: { sections?: RenderedSection[] } } | null)?.content;
  if (!content?.sections?.length) return null;
  return fromSections(content.sections);
}

export const CLOSERS: Partial<Record<Section["kind"], Closer>> = {
  quiz: quizCloser,
};

export async function close(
  section: Section,
  sections: RenderedSection[],
  ctx: RunCtx,
  issueId: number | null,
): Promise<RenderedSection | null> {
  const closer = CLOSERS[section.kind];
  if (!closer) return null;
  try {
    return await closer(section, sections, ctx, issueId);
  } catch (e) {
    // Same rule as gather: one failing section must not cost the reader their morning.
    console.error(`closer ${section.kind}/${section.id} failed:`, e);
    return null;
  }
}
