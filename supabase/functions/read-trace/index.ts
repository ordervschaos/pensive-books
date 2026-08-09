// read-trace — the CAUSAL FORWARD PASS of the Reader Machine (P1).
//
// Given the reader's carried mental state and ONE window of consecutive units, emit what each unit
// does to the reader: a small op stream per unit (see features/reader/lib/brain.ts for the opcode
// set). The client folds the ops into the brain and carries the compacted state into the next call.
//
// ── Why stateless is the whole point ─────────────────────────────────────────────────────────────
// The forward pass must model a FIRST-TIME reader, who at unit t knows only units 0..t. That
// property cannot be delivered by asking a model to pretend — it has to be structural. Because this
// function holds no state and is only ever SENT the past, it physically cannot look ahead. The
// client's window loop is the only thing that advances time.
//
// (The residual leak is the model's prior knowledge of a famous book, which no architecture can
// remove. It is mitigated by instruction below and must be measured, not assumed — the calibration
// test is a known twist that the pass should NOT predict early.)
//
// Stateless in the same sense as read-facts / read-meters / dna-chat: the client owns the artifact,
// the server owns one judgement. Book-agnostic on purpose — /reader analyses an uploaded epub that
// has no book row, so there is no bookId to scope to; a valid user JWT is the whole gate.
//
//   client → POST { units:[{i,text}], state:{…}, position:{from,total} }
//          → one LLM call → { deltas:[{ i, gist, ops:[…] }] }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, json } from "../_shared/cors.ts";
import { userClient as createUserClient } from "../_shared/task.ts";
import { callLLM, textFromLLM, type CallMeta } from "../_shared/llm.ts";
import { getRoleModels } from "../_shared/model-config.ts";
import { extractJsonBlock } from "../_shared/json.ts";

const MAX_UNITS = 40;          // per call; the client windows by word budget and this is the backstop
const MAX_UNIT_CHARS = 2000;   // one paragraph; longer is a repair failure, not prose
const MAX_CARRY = 120;         // entities/facts/questions carried in — compaction is the client's job

interface InUnit { i: number; text: string }
interface CarryEntity { id: string; kind: string; name: string }
interface CarryState {
  entities?: CarryEntity[];
  facts?: { key: string; value: string }[];
  questions?: { qid: string; text: string; kind: string }[];
  place?: string | null;
  present?: string[];
}

// The opcode set, mirrored from features/reader/lib/brain.ts. Kept as a server-side allowlist so an
// unrecognised op is DROPPED rather than folded — same fail-closed instinct as read-facts' entity
// registry check: a hallucinated op must never reach the reader model as if it were a reading.
const OPS = new Set(["entity", "fact", "believe", "relate", "move", "present", "sense", "open", "answer", "touch", "recall", "affect"]);
const KINDS = new Set(["character", "place", "object", "faction", "concept"]);
// Kind ALIASES. The model reaches for the obvious English word ("person", "event") rather than the
// schema's token, and rejecting those threw away otherwise perfect readings. Mapping is strictly
// better than insisting: the vocabulary is an implementation detail, the reading is the product.
const KIND_ALIAS: Record<string, string> = {
  person: "character", people: "character", char: "character", protagonist: "character",
  location: "place", setting: "place", building: "place", room: "place",
  thing: "object", item: "object", prop: "object",
  group: "faction", organization: "faction", org: "faction", institution: "faction", family: "faction",
  event: "concept", idea: "concept", rule: "concept", system: "concept", custom: "concept",
};
const CHANNELS = new Set(["sight", "sound", "smell", "touch", "taste", "body"]);
const QKINDS = new Set(["mystery", "threat", "desire", "irony"]);
const GROUNDS = new Set(["shown", "told", "suspected"]);

// Coerces numbers/booleans too: a model writing `"value": true` for a fact is stating something
// perfectly real, and dropping it over its JSON type would be pedantry at the cost of a reading.
const str = (v: unknown, max = 200): string | null => {
  const s = typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";
  return s.trim() ? s.trim().slice(0, max) : null;
};
const num = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const userClient = createUserClient(req.headers.get("Authorization") ?? "");
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const body = (await req.json().catch(() => ({}))) as {
      units?: InUnit[]; state?: CarryState; position?: { from?: number; total?: number };
    };
    const units = (Array.isArray(body.units) ? body.units : [])
      .filter((u): u is InUnit => !!u && typeof u.i === "number" && typeof u.text === "string" && !!u.text.trim())
      .slice(0, MAX_UNITS)
      .map((u) => ({ i: u.i, text: u.text.slice(0, MAX_UNIT_CHARS) }));
    if (!units.length) return json({ error: "units[] required" }, 400);

    const st = body.state ?? {};
    const entities = (st.entities ?? []).slice(0, MAX_CARRY);
    const facts = (st.facts ?? []).slice(0, MAX_CARRY);
    const questions = (st.questions ?? []).slice(0, MAX_CARRY);
    // Ids the model may reference. Anything it invents mid-window must be declared with an `entity`
    // op first; ops naming an unknown id are dropped below, so the fold can never orphan a reference.
    const known = new Set(entities.map((e) => e.id));

    const carried =
      `WHAT YOU ALREADY KNOW (everything you have read up to unit ${units[0].i}):\n\n` +
      `PEOPLE / PLACES / THINGS:\n${entities.length ? entities.map((e) => `  ${e.id} · ${e.kind} · ${e.name}`).join("\n") : "  (nothing yet — this is the very beginning)"}\n\n` +
      `WHAT YOU BELIEVE IS TRUE:\n${facts.length ? facts.map((f) => `  ${f.key}: ${f.value}`).join("\n") : "  (nothing yet)"}\n\n` +
      `WHAT YOU STILL WANT TO KNOW:\n${questions.length ? questions.map((q) => `  ${q.qid} [${q.kind}] ${q.text}`).join("\n") : "  (nothing yet)"}\n\n` +
      `WHERE YOU ARE: ${st.place ?? "(not established)"}\n` +
      `WHO IS IN FRONT OF YOU: ${(st.present ?? []).join(", ") || "(nobody yet)"}\n`;

    const passage = units.map((u) => `[${u.i}] ${u.text}`).join("\n\n");

    const { structure: model } = await getRoleModels();
    const meta: CallMeta = { fn: "read-trace", userId: user.id, operation: `units ${units[0].i}-${units[units.length - 1].i}` };

    const data = await callLLM({
      model,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      // Structural JSON on a metered reasoning host: keep effort low so the token budget goes to the
      // ops rather than to deliberation (model-config documents budget-eaten-by-reasoning as the
      // failure mode for tight structural calls).
      output_config: { effort: "low" },
      system: [{
        type: "text",
        text:
          "You are simulating a FIRST-TIME READER's mind moving through a story, one paragraph at a time. " +
          "You are not an analyst with the whole book in front of you — you are a person partway through it.\n\n" +
          "ABSOLUTE RULE: you know ONLY what is in this prompt. If you happen to recognise this book, you must " +
          "not use anything you know from outside these pages — no character fates, no later reveals, no genre " +
          "expectations dressed up as inference. Reading ahead is the one error that invalidates the whole run. " +
          "Where you are guessing, that is an `open` question, never a `fact`.\n\n" +
          "For EACH numbered unit, emit the ops describing what it did to you. EVERY op is a flat object whose " +
          "first key is \"op\". Write {\"op\":\"entity\",\"id\":\"violet\",…} — NOT {\"entity\":{…}}.\n\n" +
          "  {\"op\":\"entity\",\"id\":\"<snake_case>\",\"kind\":\"character|place|object|faction|concept\",\"name\":\"<short>\",\"note\":\"<optional>\"}\n" +
          "      something enters your model for the FIRST time. The id is stable forever. Reuse existing ids; " +
          "never mint a second id for someone already known by another name, title, or pronoun.\n" +
          "  {\"op\":\"fact\",\"key\":\"<snake_case>\",\"value\":\"<short string>\",\"about\":\"<id, optional>\"}\n" +
          "      a durable truth you would now bet on. Reuse a key to CHANGE it. Never a mood.\n" +
          "  {\"op\":\"believe\",\"about\":\"<id>\",\"claim\":\"<short>\",\"ground\":\"shown|told|suspected\"}\n" +
          "  {\"op\":\"relate\",\"from\":\"<id>\",\"to\":\"<id>\",\"kind\":\"<mother|rival|guards|…>\",\"valence\":<-2..2>}\n" +
          "  {\"op\":\"move\",\"to\":\"<place id>\"}                     the POV moved.\n" +
          "  {\"op\":\"present\",\"ids\":[\"<id>\",…]}                   who is on stage now (replaces the set).\n" +
          "  {\"op\":\"sense\",\"about\":\"<id>\",\"channel\":\"sight|sound|smell|touch|taste|body\",\"detail\":\"<short>\"}\n" +
          "      only when the prose actually hands you one. This is what makes a thing feel real, not just known.\n" +
          "  {\"op\":\"open\",\"qid\":\"<snake_case>\",\"text\":\"<what you want to know>\",\"kind\":\"mystery|threat|desire|irony\",\"heat\":1-3}\n" +
          "  {\"op\":\"answer\",\"qid\":\"<an open qid>\",\"subverted\":<true if answered against its own implication>}\n" +
          "  {\"op\":\"recall\",\"id\":\"<id>\"}                        the prose deliberately hauls back something gone quiet.\n" +
          "  {\"op\":\"affect\",\"tension\":0-10,\"warmth\":-5..5}       only when it MOVES; it carries forward otherwise.\n\n" +
          "Also give each unit a short `gist`: one clause, in your voice, on what changed for you (\"her own " +
          "mother signed the order\"). Omit it for units that only carry rhythm.\n\n" +
          "BE TERSE. At most 4 ops for a unit, and most units need one or two — an empty ops list is a correct " +
          "answer for prose that only carries rhythm. Do not restate in an op what the gist already says, and do " +
          "not log a mere re-mention of something you already know: only NEW information, a NEW want, or a real " +
          "change earns an op. An op you cannot point at a sentence for is noise. Output minified JSON.",
      }],
      messages: [{
        role: "user",
        content:
          `${carried}\n` +
          `— you are ${Math.round((units[0].i / Math.max(1, body.position?.total ?? units[units.length - 1].i + 1)) * 100)}% of the way through this chapter —\n\n` +
          `WHAT YOU READ NEXT:\n\n${passage}\n\n` +
          `Output ONLY this JSON, one entry per unit above, in order, no fences:\n` +
          `{"deltas":[{"i":<unit number>,"gist":"<short clause, omit if nothing changed>","ops":[<ops>]}]}`,
      }],
    }, meta, { signal: AbortSignal.timeout(120_000) });

    const parsed = parseDeltas(textFromLLM(data).trim());
    const seen = new Set(units.map((u) => u.i));
    const deltas: { i: number; gist?: string; ops: Record<string, unknown>[] }[] = [];

    for (const raw of Array.isArray(parsed.deltas) ? parsed.deltas : []) {
      const d = raw as { i?: unknown; gist?: unknown; ops?: unknown };
      if (typeof d.i !== "number" || !seen.has(d.i)) continue;   // never accept a unit we didn't send
      const ops: Record<string, unknown>[] = [];
      for (const o of Array.isArray(d.ops) ? d.ops : []) {
        const { name, op } = unwrap(o as Record<string, unknown>);
        if (!OPS.has(name)) continue;
        const clean = validate(name, op, known);
        if (clean) ops.push(clean);
      }
      deltas.push({ i: d.i, ...(str(d.gist, 160) ? { gist: str(d.gist, 160)! } : {}), ops });
    }
    // Units the model skipped genuinely did nothing — represent them rather than leaving holes, so
    // the client's fold advances time (and therefore decays attention) for every unit that was read.
    for (const u of units) if (!deltas.some((d) => d.i === u.i)) deltas.push({ i: u.i, ops: [] });
    deltas.sort((a, b) => a.i - b.i);

    return json({ deltas });
  } catch (e) {
    console.error("read-trace error:", e);
    return json({ error: String((e as Error)?.message ?? e).slice(0, 500) }, 500);
  }
});

/**
 * Parse the reply, salvaging what survives if the whole document will not.
 *
 * A window is ~60s of wall clock, and a single stray character in an 8k-token reply was throwing
 * ALL of it away — the strict parse fails, the retry costs another 60s, and a second failure loses
 * the window entirely. But the deltas are independent objects: a document that breaks at delta 9
 * still contains eight perfectly good readings. So on a strict-parse failure, walk the text and
 * recover each balanced top-level object individually, keeping the ones that parse.
 *
 * Partial beats nothing: the units that do come back fold normally, and any unit that does not is
 * filled with an empty delta downstream, so time still advances across the gap.
 */
function parseDeltas(raw: string): { deltas?: unknown } {
  try {
    return JSON.parse(extractJsonBlock(raw)) as { deltas?: unknown };
  } catch {
    const out: unknown[] = [];
    const start = raw.indexOf('"deltas"');
    const text = start >= 0 ? raw.slice(start) : raw;
    let depth = 0, from = -1, inStr = false, esc = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === "{") { if (depth === 0) from = i; depth++; continue; }
      if (c === "}") {
        depth--;
        if (depth === 0 && from >= 0) {
          try { out.push(JSON.parse(text.slice(from, i + 1))); } catch { /* drop this one, keep going */ }
          from = -1;
        }
      }
    }
    console.warn(`read-trace: strict parse failed, salvaged ${out.length} delta object(s)`);
    return { deltas: out };
  }
}

/**
 * Accept BOTH op envelopes. The schema is flat — `{op:"entity", id, name}` — but a model asked for
 * "an entity op" very naturally writes `{"entity": {id, name}}`, and on the first run that shape
 * cost an entire window of otherwise-correct readings. Both are unambiguous, so both are read; the
 * prompt still asks for the flat one, this is the safety net (each retry is ~90s, so failing soft
 * on a cosmetic disagreement is worth far more than enforcing it).
 */
function unwrap(raw: Record<string, unknown>): { name: string; op: Record<string, unknown> } {
  if (typeof raw.op === "string") return { name: raw.op, op: raw };
  const keys = Object.keys(raw);
  if (keys.length === 1 && OPS.has(keys[0]) && raw[keys[0]] && typeof raw[keys[0]] === "object") {
    return { name: keys[0], op: raw[keys[0]] as Record<string, unknown> };
  }
  return { name: "", op: raw };
}

/**
 * Shape-check one op and normalise it, or null to drop it. Entity references must resolve to an id
 * already known or declared earlier in THIS window — an op pointing at nothing would fold into a
 * dangling reference, so it is dropped and the rest of the unit kept (degrade, never corrupt).
 */
function validate(name: string, op: Record<string, unknown>, known: Set<string>): Record<string, unknown> | null {
  const id = (v: unknown): string | null => {
    const s = str(v, 60)?.toLowerCase().replace(/[^a-z0-9_]/g, "_");
    return s && known.has(s) ? s : null;
  };
  switch (name) {
    case "entity": {
      const eid = str(op.id, 60)?.toLowerCase().replace(/[^a-z0-9_]/g, "_");
      const raw = str(op.kind, 20)?.toLowerCase() ?? "";
      const kind = KINDS.has(raw) ? raw : KIND_ALIAS[raw];
      const nm = str(op.name, 80);
      if (!eid || !nm || !kind) return null;
      known.add(eid);   // declared here ⇒ referenceable by later ops in this same window
      return { op: name, id: eid, kind, name: nm, ...(str(op.note, 160) ? { note: str(op.note, 160) } : {}) };
    }
    case "fact": {
      const key = str(op.key, 60)?.toLowerCase().replace(/[^a-z0-9_]/g, "_");
      const value = str(op.value, 200);
      if (!key || !value) return null;
      const about = id(op.about);
      return { op: name, key, value, ...(about ? { about } : {}) };
    }
    case "believe": {
      const about = id(op.about), claim = str(op.claim, 200), ground = str(op.ground, 20);
      if (!about || !claim || !ground || !GROUNDS.has(ground)) return null;
      return { op: name, about, claim, ground };
    }
    case "relate": {
      const from = id(op.from), to = id(op.to), kind = str(op.kind, 40);
      const valence = num(op.valence, -2, 2);
      if (!from || !to || from === to || !kind || valence === null) return null;
      return { op: name, from, to, kind, valence, ...(str(op.note, 160) ? { note: str(op.note, 160) } : {}) };
    }
    case "move": {
      const to = id(op.to);
      return to ? { op: name, to } : null;
    }
    case "present": {
      const ids = (Array.isArray(op.ids) ? op.ids : []).map(id).filter(Boolean) as string[];
      return { op: name, ids };
    }
    case "sense": {
      const about = id(op.about), channel = str(op.channel, 12), detail = str(op.detail, 160);
      if (!about || !detail || !channel || !CHANNELS.has(channel)) return null;
      return { op: name, about, channel, detail };
    }
    case "open": {
      const qid = str(op.qid, 60)?.toLowerCase().replace(/[^a-z0-9_]/g, "_");
      const text = str(op.text, 200), kind = str(op.kind, 20), heat = num(op.heat, 1, 3);
      if (!qid || !text || !kind || !QKINDS.has(kind) || heat === null) return null;
      return { op: name, qid, text, kind, heat: Math.round(heat) };
    }
    case "answer": {
      const qid = str(op.qid, 60)?.toLowerCase().replace(/[^a-z0-9_]/g, "_");
      if (!qid) return null;
      return { op: name, qid, ...(str(op.note, 160) ? { note: str(op.note, 160) } : {}), ...(op.subverted === true ? { subverted: true } : {}) };
    }
    case "touch": {
      const ids = (Array.isArray(op.ids) ? op.ids : []).map(id).filter(Boolean) as string[];
      return ids.length ? { op: name, ids } : null;
    }
    case "recall": {
      const rid = id(op.id);
      return rid ? { op: name, id: rid, ...(str(op.note, 160) ? { note: str(op.note, 160) } : {}) } : null;
    }
    case "affect": {
      const tension = num(op.tension, 0, 10), warmth = num(op.warmth, -5, 5);
      if (tension === null || warmth === null) return null;
      return { op: name, tension, warmth };
    }
    default:
      return null;
  }
}
