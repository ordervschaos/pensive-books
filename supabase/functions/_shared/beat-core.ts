// beat-core — the pure "objective → beat" worker, extracted from objective-to-beat/index.ts so the
// sync workshop endpoint AND generate-book's beat phase share byte-identical beat logic (mirrors
// generate-unit-core.ts). Does NO auth, NO access check, NO task-row writes — callers own those.
//
// A BEAT is one paragraph that plans, in concrete order, what ONE page does to fulfil its objective:
// the middle rung between OBJECTIVE (what the page must achieve) and PROSE (the words). The upgraded
// prompt makes the beat carry the story's *engine*: it must connect to the previous beat by
// "therefore"/"but" (never "and then"), turn one value from + to − or back (a flip), plan one moment
// where what's said ≠ what's meant (subtext), and name one concrete sensory image. Threads anchored
// to the page tell it what to SEED or PAY OFF.
import { type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { callClaude, type CallMeta } from "./claude.ts";

// Beats are one paragraph; sonnet is the planning workhorse (faithful to the pre-extraction default).
const MODEL = "claude-sonnet-4-6";

export interface Brief {
  scope?: { band?: string; word_target?: number };
  genre?: string;
  audience?: string;
  premise?: string;
  tone?: string[];
  success_criteria?: string;
}

export interface BeatParams {
  bookId: number;
  pageId: number;
  objective: string;
  // Best-of-n: sample this many candidate beats in parallel and keep the one a judge picks. Beats are
  // one paragraph, so n=3 is cents per page. Default 1 (a single sample — the attended/sync path).
  candidates?: number;
  // Optional link to the durable task row this call serves, recorded on the ai_calls log.
  log?: { taskTable?: string; taskId?: number };
  userId?: string | null;
}

interface PageLite {
  id: number;
  page_index: number;
  page_type: string | null;
  title: string | null;
  metadata: { objective?: string; beat?: string } | null;
}

interface ThreadOnPage {
  name: string;
  description: string | null;
  role: "seed" | "payoff";
}

const SYSTEM = `You are a book architect writing a BEAT — a single paragraph that plans, in concrete order, what ONE page of the book does to fulfil its objective. A beat sits between the OBJECTIVE (what the page must achieve) and the PROSE (the actual words): it commits to the specific moves, turns, and images — the "how" — without writing the page itself.

A beat is where the story's ENGINE lives. Weave these into the paragraph (as flowing plan-prose, never a bullet list):
- CAUSALITY: connect to the PREVIOUS beat with "therefore" or "but" — this page happens BECAUSE of, or pushes AGAINST, what just happened. Never "and then" (events that merely follow in time). If there is no previous beat, set the engine running: open a want and an obstacle.
- A VALUE FLIP: one thing that matters here (safety, trust, hope, control, intimacy, power…) shifts from + to − or − to + across the page. Make clear what flips and which way.
- SUBTEXT: at least one moment where what a character SAYS is not what they MEAN — a said-vs-meant gap the reader feels.
- A CONCRETE IMAGE: one specific sensory anchor — an object, a gesture, a detail of place — that the page turns on, not an abstraction.
- THREADS: if told to SEED a thread, plant it so it reads as natural now but lands later; if told to PAY OFF a thread, deliver the promise so it feels earned.

Rules:
- Output ONE paragraph (3–6 sentences). No title, no heading, no preamble, no markdown, no bullet list, no meta commentary — just the beat.
- It is a PLAN, not prose: say what happens and in what order; do NOT write the page's actual sentences or dialogue.
- Fulfil the page's objective exactly. Honour the brief (genre, audience, tone, premise) and the spine as the voice/throughline contract.`;

function briefContext(brief: Brief | null): string {
  if (!brief) return "(no brief set — infer a sensible neutral voice)";
  const lines: string[] = [];
  if (brief.scope?.band) lines.push(`- Scope: ${brief.scope.band}${brief.scope.word_target ? ` (≈${brief.scope.word_target} words)` : ""}`);
  if (brief.genre) lines.push(`- Genre: ${brief.genre}`);
  if (brief.audience) lines.push(`- Audience: ${brief.audience}`);
  if (brief.premise) lines.push(`- Premise: ${brief.premise}`);
  if (brief.tone?.length) lines.push(`- Tone: ${brief.tone.join(", ")}`);
  if (brief.success_criteria) lines.push(`- Success looks like: ${brief.success_criteria}`);
  return lines.length ? lines.join("\n") : "(brief is empty — infer a sensible neutral voice)";
}

// A compact id-tagged outline so the beat reads in context; the target page is marked.
function outlineContext(pages: PageLite[], targetId: number): string {
  return pages
    .map((p) => {
      const obj = p.metadata?.objective?.trim();
      const here = p.id === targetId ? "  ◀── THIS PAGE" : "";
      if (p.page_type === "section") return `# ${p.title || "(untitled section)"}${obj ? ` — ${obj}` : ""}`;
      return `- "${p.title || "(untitled)"}"${obj ? ` — ${obj}` : ""}${here}`;
    })
    .join("\n");
}

// The nearest prior TEXT page that already has a beat — the causal antecedent this page reacts to.
function precedingBeat(list: PageLite[], current: PageLite): { title: string | null; beat: string } | null {
  const idx = list.findIndex((p) => p.id === current.id);
  for (let i = idx - 1; i >= 0; i--) {
    const p = list[i];
    if (p.page_type !== "text") continue;
    const b = p.metadata?.beat?.trim();
    if (b) return { title: p.title, beat: b };
  }
  return null;
}

function threadsContext(threads: ThreadOnPage[]): string {
  return threads
    .map((t) => {
      const verb = t.role === "seed" ? "SEED" : "PAY OFF";
      return `- ${verb} "${t.name}"${t.description ? ` — ${t.description}` : ""}`;
    })
    .join("\n");
}

// Everything one beat call needs, assembled once so objectiveToBeat (judged) and beatCandidates
// (un-judged, for the serial human-pick UI) share byte-identical context.
interface PreparedBeat {
  userContent: string;
  meta: CallMeta;
  prevBeat: string | null;
  objective: string;
}

// Load the book/outline/threads context and build the prompt for one page's beat. The PREVIOUS BEAT
// is read fresh here, so in a serial pick (save chosen beat → request next page) each page's
// candidates are grounded on the antecedent the author actually approved.
async function prepareBeat(client: SupabaseClient, p: BeatParams): Promise<PreparedBeat> {
  const obj = (p.objective ?? "").trim();
  if (!obj) throw new Error("An objective is required to write a beat");

  const { data: book, error: bookError } = await client
    .from("books").select("id, name, brief, spine").eq("id", p.bookId).single();
  if (bookError || !book) throw new Error("Book not found");

  const [{ data: pages }, { data: threadRows }] = await Promise.all([
    client.from("pages").select("id, page_index, page_type, title, metadata")
      .eq("book_id", p.bookId).eq("archived", false).order("page_index", { ascending: true }),
    client.from("book_threads").select("name, description, setup_page_id, payoff_page_id")
      .eq("book_id", p.bookId),
  ]);

  const list = (pages as PageLite[] | null) ?? [];
  const current = list.find((pg) => pg.id === p.pageId) ?? null;
  const prev = current ? precedingBeat(list, current) : null;

  const onPage: ThreadOnPage[] = ((threadRows as Array<{ name: string; description: string | null; setup_page_id: number | null; payoff_page_id: number | null }> | null) ?? [])
    .flatMap((t) => {
      const out: ThreadOnPage[] = [];
      if (t.setup_page_id === p.pageId) out.push({ name: t.name, description: t.description, role: "seed" });
      if (t.payoff_page_id === p.pageId) out.push({ name: t.name, description: t.description, role: "payoff" });
      return out;
    });

  const spine = (book.spine as { text?: string } | null)?.text?.trim() || null;

  const meta: CallMeta = { fn: "objective-to-beat", bookId: p.bookId, taskTable: p.log?.taskTable ?? null, taskId: p.log?.taskId ?? null, userId: p.userId ?? null };

  const userContent =
    `BOOK: ${book.name}\n\nBRIEF (the voice contract):\n${briefContext(book.brief as Brief | null)}` +
    (spine ? `\n\nBOOK SPINE (the throughline):\n${spine}` : "") +
    `\n\nOUTLINE (for continuity — the target page is marked):\n${outlineContext(list, p.pageId)}` +
    (prev ? `\n\nPREVIOUS BEAT (the page just before — connect to THIS by "therefore"/"but"; do not repeat it):\n"""\n${prev.beat}\n"""` : "\n\n(This is the first beat — set the story's engine running.)") +
    (onPage.length ? `\n\nTHREADS ON THIS PAGE (promises to manage here):\n${threadsContext(onPage)}` : "") +
    `\n\nTHIS PAGE'S OBJECTIVE:\n${obj}\n\nWrite the beat for THIS PAGE. One paragraph, plan only.`;

  return { userContent, meta, prevBeat: prev?.beat ?? null, objective: obj };
}

// Sample n candidate beats. n>1 runs in parallel at high temperature for spread; n=1 is one plain
// sample (the attended/sync default). Returns only the non-empty ones.
async function sampleBeats(apiKey: string, prep: PreparedBeat, n: number): Promise<string[]> {
  if (n === 1) {
    const b = await generateBeat(apiKey, prep.userContent, prep.meta);
    return b ? [b] : [];
  }
  return (await Promise.all(
    Array.from({ length: n }, () => generateBeat(apiKey, prep.userContent, prep.meta, 1).catch(() => "")),
  )).filter((b) => b.length > 0);
}

// objective → beat. Loads its own book/outline/threads context; returns the beat text only. With
// candidates>1 it samples n and a judge keeps the best (the unattended/bulk path).
export async function objectiveToBeat(client: SupabaseClient, apiKey: string, p: BeatParams): Promise<string> {
  const prep = await prepareBeat(client, p);
  const n = Math.max(1, Math.min(p.candidates ?? 1, 5));
  const candidates = await sampleBeats(apiKey, prep, n);
  if (candidates.length === 0) throw new Error("Claude returned no beat.");
  if (candidates.length === 1) return candidates[0];
  return await pickBestBeat(apiKey, candidates, prep.prevBeat, prep.objective, { ...prep.meta, fn: "beat-judge" });
}

// objective → n candidate beats, UN-judged. Powers the serial human-pick UI: the author sees all the
// takes and chooses, instead of a judge picking for them. Same context as objectiveToBeat.
export async function beatCandidates(client: SupabaseClient, apiKey: string, p: BeatParams, n: number): Promise<string[]> {
  const prep = await prepareBeat(client, p);
  const candidates = await sampleBeats(apiKey, prep, Math.max(1, Math.min(n, 5)));
  if (candidates.length === 0) throw new Error("Claude returned no beat.");
  return candidates;
}

// One beat sample. `temperature` (for best-of-n spread) is passed through to the Messages API.
async function generateBeat(apiKey: string, userContent: string, meta: CallMeta, temperature?: number): Promise<string> {
  const body: Record<string, unknown> = {
    model: MODEL,
    max_tokens: 1024,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userContent }],
  };
  if (temperature != null) body.temperature = temperature;
  const data = await callClaude(apiKey, body, meta);
  return ((data.content ?? []) as Array<{ type: string; text?: string }>)
    .filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
}

const JUDGE_SYSTEM = `You are a story editor choosing the single strongest BEAT among candidates for one page. The winner is the one that best, in order of weight: (a) connects to the PREVIOUS beat by "therefore" or "but" — caused by or colliding with it, never "and then"; (b) turns a clear VALUE FLIP across the page; (c) carries real SUBTEXT (said ≠ meant); (d) anchors on a CONCRETE image; (e) fulfils the page's objective. Reply with ONLY the number of the best candidate — no words, no punctuation.`;

async function pickBestBeat(apiKey: string, candidates: string[], prevBeat: string | null, objective: string, meta: CallMeta): Promise<string> {
  const list = candidates.map((c, i) => `[${i + 1}]\n${c}`).join("\n\n");
  try {
    const data = await callClaude(apiKey, {
      model: MODEL,
      max_tokens: 8,
      temperature: 0,
      system: [{ type: "text", text: JUDGE_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{
        role: "user",
        content:
          `OBJECTIVE: ${objective}` +
          (prevBeat ? `\n\nPREVIOUS BEAT:\n"""\n${prevBeat}\n"""` : "") +
          `\n\nCANDIDATE BEATS:\n${list}\n\nWhich single beat is best? Reply with ONLY its number.`,
      }],
    }, meta);
    const text = ((data.content ?? []) as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    const idx = parseInt(text.match(/\d+/)?.[0] ?? "1", 10) - 1;
    return candidates[idx] ?? candidates[0];
  } catch {
    return candidates[0]; // judge hiccup → keep the first sample rather than fail the beat
  }
}
