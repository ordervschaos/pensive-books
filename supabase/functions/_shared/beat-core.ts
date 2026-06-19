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
import { type Brief, briefContext } from "./brief.ts";
import { callClaude, textFromClaude, type CallMeta } from "./claude.ts";
import { canonContext, type CanonPacket } from "./canon-core.ts";
import { getActiveModels } from "./model-config.ts";
import { readSteer, steerBlock } from "./steer.ts";
import { type Foundations } from "./foundations-core.ts";


export interface BeatParams {
  bookId: number;
  pageId: number;
  objective: string;
  // Best-of-n: sample this many candidate beats in parallel and keep the one a judge picks. Beats are
  // one paragraph, so n=3 is cents per page. Default 1 (a single sample — the attended/sync path).
  candidates?: number;
  // Optional per-call author direction (ephemeral chip selection + free note).
  prompt?: string;
  // Optional link to the durable task row this call serves, recorded on the ai_calls log.
  log?: { taskTable?: string; taskId?: number };
  userId?: string | null;
}

// F2-c: include relationship_states so the beat prompt can surface current dyad charges.
interface RelationshipStateLite { pair: string; charge: string; note?: string }
interface PageLite {
  id: number;
  page_index: number;
  page_type: string | null;
  title: string | null;
  metadata: { objective?: string; beat?: string; relationship_states?: RelationshipStateLite[] } | null;
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

// F2-c: render a compact relationship-charges block for the beat prompt.
// Source: the most recent prior page's relationship_states; falls back to foundations.relationships
// baseline (stable bond descriptions with no runtime charge yet) if no page state exists.
// The beat model uses this to target value-flips at specific bonds.
function relationshipContext(
  list: PageLite[],
  current: PageLite,
  foundations: Foundations | null,
): string | null {
  // Walk back to find the most recent prior page with relationship_states
  const idx = list.findIndex((p) => p.id === current.id);
  for (let i = idx - 1; i >= 0; i--) {
    const rel = list[i].metadata?.relationship_states;
    if (rel?.length) {
      const lines = rel.map((r) => `- ${r.pair}: ${r.charge}${r.note ? ` (${r.note})` : ""}`);
      return `RELATIONSHIP CHARGES (as of the previous page — a value-flip here can target one of these bonds):\n${lines.join("\n")}`;
    }
  }
  // Fallback: foundations.relationships as baseline descriptors (no charge yet)
  const base = foundations?.relationships ?? [];
  if (!base.length) return null;
  const lines = base.map((r) => {
    const aName = r.a; const bName = r.b;
    return `- ${aName} / ${bName}: ${r.bond}`;
  });
  return `RELATIONSHIP BASELINE (no runtime charges yet — these are the stable dyads; a value-flip here can target one):\n${lines.join("\n")}`;
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
    .from("books").select("id, name, brief, spine, canon, steers, foundations").eq("id", p.bookId).single();
  if (bookError || !book) throw new Error("Book not found");

  // Threads anchor to pages via book_thread_anchors (promise/resolution rows) since the anchors
  // migration dropped the flat setup/payoff columns.
  const [{ data: pages }, { data: threadRows }] = await Promise.all([
    client.from("pages").select("id, page_index, page_type, title, metadata")
      .eq("book_id", p.bookId).eq("archived", false).order("page_index", { ascending: true }),
    client.from("book_threads").select("name, description, book_thread_anchors(page_id, role)")
      .eq("book_id", p.bookId),
  ]);

  const list = (pages as PageLite[] | null) ?? [];
  const current = list.find((pg) => pg.id === p.pageId) ?? null;
  const prev = current ? precedingBeat(list, current) : null;

  const onPage: ThreadOnPage[] = ((threadRows as Array<{ name: string; description: string | null; book_thread_anchors: Array<{ page_id: number | null; role: string }> | null }> | null) ?? [])
    .flatMap((t) => {
      const anchors = t.book_thread_anchors ?? [];
      const out: ThreadOnPage[] = [];
      if (anchors.some((a) => a.page_id === p.pageId && a.role === "promise")) out.push({ name: t.name, description: t.description, role: "seed" });
      if (anchors.some((a) => a.page_id === p.pageId && a.role === "resolution")) out.push({ name: t.name, description: t.description, role: "payoff" });
      return out;
    });

  const spine = (book.spine as { text?: string } | null)?.text?.trim() || null;
  const canon = (book.canon as CanonPacket | null) ?? null;
  // F2-c: foundations for relationship baseline fallback
  const foundations = (book.foundations as Foundations | null) ?? null;

  const meta: CallMeta = { fn: "objective-to-beat", bookId: p.bookId, taskTable: p.log?.taskTable ?? null, taskId: p.log?.taskId ?? null, userId: p.userId ?? null };

  // F2-c: surface current relationship charges so value-flips can target a specific bond.
  const relCtx = current ? relationshipContext(list, current, foundations) : null;

  const userContent =
    `BOOK: ${book.name}\n\nBRIEF (the voice contract):\n${briefContext(book.brief as Brief | null, { scope: "full", success: true, none: "(no brief set — infer a sensible neutral voice)", empty: "(brief is empty — infer a sensible neutral voice)" })}` +
    (canon ? `\n\nCANON (settled facts from the previous book — honor, never contradict, never retell):\n${canonContext(canon)}` : "") +
    (spine ? `\n\nBOOK SPINE (the throughline):\n${spine}` : "") +
    `\n\nOUTLINE (for continuity — the target page is marked):\n${outlineContext(list, p.pageId)}` +
    (prev ? `\n\nPREVIOUS BEAT (the page just before — connect to THIS by "therefore"/"but"; do not repeat it):\n"""\n${prev.beat}\n"""` : "\n\n(This is the first beat — set the story's engine running.)") +
    (relCtx ? `\n\n${relCtx}` : "") +
    (onPage.length ? `\n\nTHREADS ON THIS PAGE (promises to manage here):\n${threadsContext(onPage)}` : "") +
    steerBlock(readSteer(book.steers, "beats")) +
    (p.prompt?.trim() ? `\n\nAUTHOR'S DIRECTION:\n${p.prompt.trim()}` : "") +
    `\n\nTHIS PAGE'S OBJECTIVE:\n${obj}\n\nWrite the beat for THIS PAGE. One paragraph, plan only.`;

  return { userContent, meta, prevBeat: prev?.beat ?? null, objective: obj };
}

// Sample n candidate beats. n>1 runs in parallel at high temperature for spread; n=1 is one plain
// sample (the attended/sync default). Returns only the non-empty ones.
async function sampleBeats(apiKey: string, model: string, prep: PreparedBeat, n: number): Promise<string[]> {
  if (n === 1) {
    const b = await generateBeat(apiKey, model, prep.userContent, prep.meta);
    return b ? [b] : [];
  }
  return (await Promise.all(
    Array.from({ length: n }, () => generateBeat(apiKey, model, prep.userContent, prep.meta, 1).catch(() => "")),
  )).filter((b) => b.length > 0);
}

// objective → beat. Loads its own book/outline/threads context; returns the beat text only. With
// candidates>1 it samples n and a judge keeps the best (the unattended/bulk path).
export async function objectiveToBeat(client: SupabaseClient, apiKey: string, p: BeatParams): Promise<string> {
  const [prep, { high: model }] = await Promise.all([prepareBeat(client, p), getActiveModels()]);
  const n = Math.max(1, Math.min(p.candidates ?? 1, 5));
  const candidates = await sampleBeats(apiKey, model, prep, n);
  if (candidates.length === 0) throw new Error("Claude returned no beat.");
  if (candidates.length === 1) return candidates[0];
  return await pickBestBeat(apiKey, model, candidates, prep.prevBeat, prep.objective, { ...prep.meta, fn: "beat-judge" });
}

// objective → n candidate beats, UN-judged. Powers the serial human-pick UI: the author sees all the
// takes and chooses, instead of a judge picking for them. Same context as objectiveToBeat.
export async function beatCandidates(client: SupabaseClient, apiKey: string, p: BeatParams, n: number): Promise<string[]> {
  const [prep, { high: model }] = await Promise.all([prepareBeat(client, p), getActiveModels()]);
  const candidates = await sampleBeats(apiKey, model, prep, Math.max(1, Math.min(n, 5)));
  if (candidates.length === 0) throw new Error("Claude returned no beat.");
  return candidates;
}

// One beat sample. `temperature` (for best-of-n spread) is passed through to the Messages API.
async function generateBeat(apiKey: string, model: string, userContent: string, meta: CallMeta, temperature?: number): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    max_tokens: 1024,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userContent }],
  };
  if (temperature != null) body.temperature = temperature;
  const data = await callClaude(apiKey, body, meta);
  return textFromClaude(data).trim();
}

const JUDGE_SYSTEM = `You are a story editor choosing the single strongest BEAT among candidates for one page. The winner is the one that best, in order of weight: (a) connects to the PREVIOUS beat by "therefore" or "but" — caused by or colliding with it, never "and then"; (b) turns a clear VALUE FLIP across the page; (c) carries real SUBTEXT (said ≠ meant); (d) anchors on a CONCRETE image; (e) fulfils the page's objective. Reply with ONLY the number of the best candidate — no words, no punctuation.`;

async function pickBestBeat(apiKey: string, model: string, candidates: string[], prevBeat: string | null, objective: string, meta: CallMeta): Promise<string> {
  const list = candidates.map((c, i) => `[${i + 1}]\n${c}`).join("\n\n");
  try {
    const data = await callClaude(apiKey, {
      model,
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
    const text = textFromClaude(data);
    const idx = parseInt(text.match(/\d+/)?.[0] ?? "1", 10) - 1;
    return candidates[idx] ?? candidates[0];
  } catch {
    return candidates[0]; // judge hiccup → keep the first sample rather than fail the beat
  }
}
