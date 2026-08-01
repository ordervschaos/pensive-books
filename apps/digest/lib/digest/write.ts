import type { Item, RenderedSection, RunCtx, Section } from "./types";
import { callClaude } from "./llm";

// The WRITE stage. One LLM call per section, and it sees ONLY the text the gather stage handed it.
//
// Sections are written in parallel, which is why this fits inside a normal request budget: 6 sections cost
// roughly one section's latency, not six.

// Tier 1 — the constitution. Product policy, not a user knob. This is what stops a daily digest degenerating
// into padded, hedged, sourceless filler by week three.
const CONSTITUTION = `You write one section of a daily reading digest for a single named reader. You are an editor, not a summarizer.

HARD RULES:
- Every factual claim must be traceable to the source material provided below. You have no other knowledge of today's events. If the material doesn't say it, you don't write it.
- Cite sources inline as markdown, using the SHORTEST recognisable name — usually the publication or the bare domain ("Tate", "wallpaper.com", "Nature"), never a headline or a full URL as link text. Citations are rendered small and grey, so keep them out of the way of the sentence: put one at the end of the clause it supports. Use the exact URLs given.
- Reply with exactly NOTHING_TODAY, and nothing else, ONLY when the material contains no usable reporting at all — it is empty, or entirely off-topic. That is the only case. Material that is real but unexciting still gets two honest sentences: NOTHING_TODAY is an emptiness test, not a quality bar, and you are not the reader's taste filter. Never pad to fill a section either — two good sentences beat six padded ones.
- The material may contain the researcher's own hedging about what they did or didn't find. That is process noise, not content: ignore it and write from the findings themselves.
- No preamble, no "here's what's happening", no sign-off, no restating the section title.
- No hype register. No "game-changing", "revolutionary", "in today's fast-moving world". Write like a well-read friend who respects the reader's time.
- Prefer specifics over summary: the number, the name, the actual claim. Drop anything you can't make concrete.

IMAGES: some items carry a picture, marked [has image] in the material below. If — and only if — the picture IS the story (a work of art, a photograph, a chart that carries the finding), put it on its own line as ![](item:N), where N is that item's number. NEVER write an image URL — item:N is the only form that works, and anything else is dropped on the floor. At most one image per section, and most sections need none: a picture that merely decorates is worse than no picture.

FORMAT: plain markdown prose. Short paragraphs. Bullets only when the content is genuinely a list. No headings — the section already has a title.`;

// A `prompt` section has no retrieval by design — a reflection, a question of the day. The sourcing rules
// above would deadlock it (nothing to cite, so nothing may be said), so it gets its own contract. The
// binding rule flips from "cite everything" to "attribute nothing you aren't certain of": the failure mode
// here is not an unsourced claim, it's a plausible-looking quotation that Marcus Aurelius never wrote.
const REFLECTION_CONSTITUTION = `You write one short reflective section of a daily reading digest for a single named reader. You are writing an original piece of thinking, not reporting.

HARD RULES:
- Do NOT quote anyone. No quotation marks around attributed words, no "as Seneca wrote", no paraphrase presented as someone's position. You have no sources in front of you, and a fabricated attribution is the one unforgivable failure here. Write in your own voice about the idea itself.
- Naming a thinker or a work in passing is fine. Putting words in their mouth is not.
- One idea, developed. Not a list of ideas, not a survey. 150-250 words.
- No preamble, no restating the section title, no sign-off, no instruction to the reader to "take a moment".
- No self-help register, no aphorism-stacking, no second-person exhortation. Think on the page; let the reader overhear it.

FORMAT: plain markdown prose. Two or three short paragraphs. No headings, no bullets.`;

const NOTHING = "NOTHING_TODAY";

// Quotes are laid out, not written. No model call at all.
//
// This is the one section kind where passing the material through a model could only subtract: the value of
// a highlight is that it is EXACTLY what the author wrote and exactly what the reader chose to keep. A
// paraphrase is a downgrade, a "connective sentence" is padding, and a model that mis-copies one word has
// silently put words in a real person's mouth — the same failure the reflection constitution exists to
// prevent, except here it is avoidable outright. So the transformation is a template, and the strongest
// guarantee in the pipeline (verbatim) comes free.
//
// Cost of the choice, stated plainly: `voice` and `instructions` don't reach this section. Steering WHICH
// quotes appear is a selection problem, not a writing one — see the README's known gaps.
function renderQuotes(items: Item[]): string {
  return items
    .map((i) => {
      // Blank lines inside a highlight would break the blockquote in two; the paragraph break inside a
      // pasted quote is not worth a second block.
      const quote = i.text.trim().split(/\n+/).map((l) => `> ${l.trim()}`).join("\n");
      const attribution = [i.source, i.title && `*${i.title}*`].filter(Boolean).join(", ");
      const cite = `${attribution ? `— ${attribution} ` : ""}[readwise](${i.url})`;
      // The reader's own annotation, kept visibly separate from the quote — it is the one line here that
      // isn't the author's.
      return [quote, cite, i.note && `**Note:** ${i.note}`].filter(Boolean).join("\n\n");
    })
    .join("\n\n");
}

export async function writeSection(
  section: Section,
  items: Item[],
  ctx: RunCtx,
  issueId: number | null,
): Promise<RenderedSection | null> {
  // A section with no grounding is nothing to write about — except `prompt`, which has no retrieval by design.
  const grounded = items.filter((i) => i.text.trim());
  if (!grounded.length && section.kind !== "prompt") return null;

  if (section.kind === "readwise") {
    return {
      id: section.id,
      title: section.title,
      markdown: renderQuotes(grounded),
      items: grounded.map(({ title, url, source, image_url }) => ({ title, url, source, image_url })),
    };
  }

  const base = section.kind === "prompt" ? REFLECTION_CONSTITUTION : CONSTITUTION;
  const voice = ctx.digest.voice?.trim();
  const system = voice ? `${base}\n\nABOUT THIS READER (honor this):\n${voice}` : base;

  const material = grounded.length
    ? grounded
        .map((i, n) => {
          const head = [
            `[${n + 1}] ${i.title}`,
            i.source && `— ${i.source}`,
            i.url,
            i.image_url && "[has image]",
          ]
            .filter(Boolean)
            .join(" ");
          return `${head}\n${i.text.slice(0, 8000)}`;
        })
        .join("\n\n---\n\n")
    : "(No source material — write from the section instructions alone.)";

  const { text } = await callClaude(
    {
      system,
      prompt:
        `Today is ${ctx.issueDate}.\n` +
        `Section: ${section.title}\n` +
        (section.instructions ? `What this section is for: ${section.instructions}\n` : "") +
        `\nSOURCE MATERIAL:\n\n${material}`,
      maxTokens: 2000,
      effort: "low",
      signal: ctx.signal,
    },
    { fn: "digest-write", operation: "write_section", issueId, userId: ctx.digest.owner_id },
  );

  // ④ VERIFY — mechanical, not another model call. The floor: an empty or self-declared-empty section is
  // dropped rather than shipped, so "nothing today" costs the reader nothing.
  const body = text.trim();
  if (!body || body === NOTHING || body.startsWith(NOTHING)) return null;

  return {
    id: section.id,
    title: section.title,
    markdown: body,
    // Only items that actually made it into the prompt are credited — the reader UI uses these to map a
    // 👍/👎 back to a concrete source later.
    items: grounded.map(({ title, url, source, image_url }) => ({ title, url, source, image_url })),
  };
}

// The reduce step: one cheap pass over the finished sections for a "what's in today" opener. Small by
// construction, so it fits any budget no matter how many sections ran.
export async function writeIntro(
  sections: RenderedSection[],
  ctx: RunCtx,
  issueId: number | null,
): Promise<string> {
  if (sections.length < 2) return "";
  const { text } = await callClaude(
    {
      system:
        "You write the two-sentence opener for a daily digest. State what is actually in today's issue and " +
        "why it might matter to this reader. No greeting, no date, no sign-off, no hype. If today is thin, say so plainly.",
      prompt: sections.map((s) => `## ${s.title}\n${s.markdown.slice(0, 1200)}`).join("\n\n"),
      maxTokens: 400,
      effort: "low",
      signal: ctx.signal,
    },
    { fn: "digest-write", operation: "write_intro", issueId, userId: ctx.digest.owner_id },
  );
  return text.trim();
}
