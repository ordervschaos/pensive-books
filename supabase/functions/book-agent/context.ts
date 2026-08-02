// book-agent context assembly: threadSystem builds the per-turn prompt in two parts — the byte-stable
// instructions (system-cached) and the volatile book-state digest (injected request-time). The tree
// digest helpers (digestNode et al.) live here since only threadSystem uses them.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { nodeHandle, schemaFor, type DnaNodeRow } from "./shared.ts";
import { SYSTEM_THREAD } from "./prompts.ts";
import { variantSuffix } from "./variants.ts";
import { type Brief, briefContext } from "../_shared/brief.ts";
import { currentObjective, nextDraftTarget, stageSubsteps } from "../_shared/dna-journey.ts";
import { analysisText, ledgerText, lintConfigForBrief, type AuthoringStatus, type DnaNode, type NodeContent, type NodeKind } from "../_shared/novel-dna.ts";
import { AGENT_SKILLS, matchSkills } from "../_shared/agent-skills.ts";
import { craftOverrideBlock } from "../_shared/craft-kb.ts";

// ── Tree digest (docs/agent-context-model.md) ────────────────────────────────
// The system prompt ships the WHOLE tree every turn; dumping each node's full content (a beat's paragraph
// summary, every foundation field) is the bulk of the tokens. Instead each node shows a DIGEST: its
// handle/gist plus, for structure, its causal + meter SPINE (connector, needs, establishes, readings) —
// the relational glue an editor reasons over (e.g. a beat with no `connector`/`needs` reads as floating).
// Full content (the whole summary, a character's wound/lie, a scene's prose) is one read_node away.
const DIGEST_FIELDS: Record<string, string[]> = {
  seed: ["logline"],
  premise: ["dramatic_question"],
  pillar: ["controlling_idea"],
  character: ["name", "role", "tag"],
  relationship: ["a", "b", "bond"],
  world_fact: ["name", "rule", "mechanism"],
  location: ["name", "mood"],
  thread: ["name", "kind", "promise"],
  game: ["name", "win_condition", "lose_condition"],
  tentpole: ["name", "summary"],
  meter: ["name", "kind"],
  voice_profile: ["pov", "tense", "style"],
  act: ["title", "goal", "target_pct", "turning_point"],
  beat: ["connector", "polarity", "slot", "needs", "establishes", "threads", "grounds_in", "realizes", "plays", "resolves", "readings"],
  scene: ["goal", "value_shift", "pov", "loc", "needs", "establishes", "grounds_in", "readings", "sketch"],
};

// Pick only the digest fields that carry a value (drop null/empty so an ABSENT spine field — a beat with
// no `connector`/`needs` — reads clearly as missing rather than hiding inside a full dump).
function pickFields(content: Record<string, unknown> | null | undefined, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = content?.[f];
    if (v == null) continue;
    if (typeof v === "string" && !v.trim()) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[f] = v;
  }
  return out;
}

// First sentence (≤180 chars) of a beat's summary — its paragraph is too long to ship in full every turn.
function gistLine(content: Record<string, unknown> | null | undefined): string {
  const s = content?.summary;
  if (typeof s !== "string" || !s.trim()) return "";
  const t = s.trim();
  const m = t.match(/^[\s\S]*?[.!?](\s|$)/);
  let first = (m ? m[0] : t).trim();
  if (first.length > 180) first = first.slice(0, 179) + "…";
  return first;
}

// Scene drafted marker — the one question a "draft the book" run asks every turn (is this scene next?),
// unanswerable from goal/value_shift/pov alone. content.prose is nested so DIGEST_FIELDS/pickFields skip it.
function draftedMarker(content: Record<string, unknown> | null | undefined): string {
  const words = (content?.prose as { words?: unknown } | undefined)?.words;
  return typeof words === "number" && words > 0 ? `prose: "${words.toLocaleString()}w"` : "undrafted";
}

// Inline a named scene's prose (intent hydration), bounded so up to 4 named scenes can't blow the turn's
// token budget. ~1200 words is enough to carry most whole scenes; longer ones keep the head + tail — the
// two edges a continuity/wording ask reasons over — with the middle dropped (read_node pulls the rest).
const PROSE_INLINE_CAP = 7200;
function boundInlineProse(text: string): string {
  if (text.length <= PROSE_INLINE_CAP) return text;
  const half = Math.floor(PROSE_INLINE_CAP / 2);
  const dropped = text.length - half * 2;
  return `${text.slice(0, half)}\n\n…[${dropped.toLocaleString()} chars of the middle omitted — read_node for the whole scene]…\n\n${text.slice(-half)}`;
}

// One-line digest of a node: handle/gist + compact spine (prose + verbose fields dropped; read_node for full).
function digestNode(kind: string, content: Record<string, unknown> | null | undefined): string {
  const fields = DIGEST_FIELDS[kind];
  const spine = fields ? pickFields(content, fields) : (content ?? {});
  const gist = kind === "beat" ? gistLine(content) : "";
  const json = Object.keys(spine).length ? JSON.stringify(spine) : "";
  const drafted = kind === "scene" ? draftedMarker(content) : "";
  return [gist, json, drafted].filter(Boolean).join(" · ") || nodeHandle(content);
}

// The thread's prompt in TWO parts (prompt-cache prefix discipline): `instructions` is the byte-stable
// system prompt (role + mode lines — identical across a run's turns, so the cache prefix survives), and
// `bookState` is the volatile grounding — the CURRENT DNA tree digest, objective, analysis, ledger —
// rebuilt every call so ids stay fresh as the author edits. bookState is injected request-time at the END
// of the latest user message (withBookState), never persisted and never in the system prompt: in auto mode
// the tree changes after every apply, and carrying it at position 0 invalidated the whole cached prefix
// (system + entire transcript) on every turn. Each node is a DIGEST — handle/gist + causal spine, full
// content via read_node (see digestNode).
async function threadSystem(service: SupabaseClient, bookId: number, analysis: string | null, effort: "low" | "high" = "high", auto = false, objective: string | null = null, attachedIds: string[] | null = null, authorAsk = "", followObjective = false, variant: string | null = null): Promise<{ instructions: string; bookState: string; groundingLabels: string[] }> {
  const { data: book } = await service.from("books").select("name, brief, craft_notes, craft_overrides").eq("id", bookId).maybeSingle();
  const b = book as { name?: string; brief?: Brief; craft_notes?: Record<string, string> | null; craft_overrides?: Record<string, string> | null } | null;
  const { data: rows } = await service
    .from("book_nodes").select("id, parent_id, kind, level, position, content, authoring, proposals").eq("book_id", bookId);
  const nodes = (rows ?? []) as DnaNodeRow[];
  const totalScenes = nodes.filter((n) => n.kind === "scene").length;
  const totalBeats = nodes.filter((n) => n.kind === "beat").length;

  const serialize = (n: DnaNodeRow, seqIdx?: number): string => {
    // Beats and scenes carry their 1-based reading-order number (matching the UI's tree badge + timeline
    // strip), so the agent names a node by the SAME number the author sees — not one it invents from the
    // objective's single "Scene N of 80" target pointer (the bug where it called scene 14 "scene 17").
    const total = n.kind === "scene" ? totalScenes : totalBeats;
    const num = seqIdx && (n.kind === "scene" || n.kind === "beat") ? ` ${seqIdx}/${total}` : "";
    let line = `[${n.id}${n.authoring?.locked ? " · LOCKED" : ""}] L${n.level} ${n.kind}${num}: ${digestNode(n.kind, n.content)}`;
    // Pending options (the picker channel) — surfaced so you can RECOMMEND which the author should pick.
    if (Array.isArray(n.proposals) && n.proposals.length) {
      line += `\n  PENDING OPTIONS (${n.proposals.length} — the author picks one; you may recommend which by its number): ` +
        JSON.stringify(n.proposals.map((p, i) => ({ option: i + 1, ...p.content })));
    }
    return line;
  };

  // Depth-first, by position — mirrors the client's reading order (novelDna.ts childrenOf/scenesInOrder), so
  // a beat's scenes list right after it and in draft order. A flat sort by `level` alone (the old behavior)
  // interleaves every act's beats and every beat's scenes into one global by-level list with no parent
  // linkage shown, so the agent had no way to tell which beat a scene belonged to — it once rendered a
  // later beat's scene believing it was next.
  const byParent = new Map<string | null, DnaNodeRow[]>();
  for (const n of nodes) {
    const list = byParent.get(n.parent_id) ?? [];
    list.push(n);
    byParent.set(n.parent_id, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.position - b.position);
  const visited = new Set<string>();
  const sorted: DnaNodeRow[] = [];
  const walk = (n: DnaNodeRow) => {
    if (visited.has(n.id)) return;
    visited.add(n.id);
    sorted.push(n);
    for (const c of byParent.get(n.id) ?? []) walk(c);
  };
  for (const root of byParent.get(null) ?? []) walk(root);
  // A node whose parent_id doesn't resolve within this book (orphaned/inconsistent data) would otherwise
  // vanish from the walk above — append any leftovers so the agent never silently loses a node's id.
  for (const n of nodes) walk(n);
  // Reading-order numbers for beats and scenes, assigned over the SAME DFS-by-position walk the client's
  // beatsInOrder/scenesInOrder / the render / the timeline strip use — so "beat 3"/"scene 14" denote the same
  // node in the digest, the UI, and the book.
  const beatNo = new Map<string, number>();
  const sceneNo = new Map<string, number>();
  for (const n of sorted) {
    if (n.kind === "beat") beatNo.set(n.id, beatNo.size + 1);
    else if (n.kind === "scene") sceneNo.set(n.id, sceneNo.size + 1);
  }
  const seqOf = (n: DnaNodeRow) => n.kind === "beat" ? beatNo.get(n.id) : n.kind === "scene" ? sceneNo.get(n.id) : undefined;
  const tree = sorted.map((n) => serialize(n, seqOf(n))).join("\n");

  // The context tray, HYDRATED: the author attached these nodes to work on, so we inline their FULL content
  // right here (not a bare pointer) — the agent doesn't need a read_node round-trip for the nodes it was
  // explicitly told matter. Ids that no longer resolve (a since-deleted node) drop out silently. Prose is
  // only carried for scene nodes — no other kind holds prose, and it's the bulk of the tokens, so we strip a
  // stray `prose` key from anything else. This block is rebuilt every turn from the live tree, so it can
  // never go stale the way the old glued-to-the-message "Focus —" prefix did.
  const byIdRow = new Map(nodes.map((n) => [n.id, n]));
  const focusNodes = (attachedIds ?? []).map((id) => byIdRow.get(id)).filter((n): n is DnaNodeRow => !!n);
  const focus = focusNodes.map((n) => {
    const content: Record<string, unknown> = { ...(n.content ?? {}) };
    if (n.kind !== "scene") delete content.prose; // prose only rides for scenes (docs/agent-context-model.md)
    return `[${n.id}${n.authoring?.locked ? " · LOCKED" : ""}] ${n.kind} “${nodeHandle(n.content)}”:\n${JSON.stringify(content)}`;
  }).join("\n\n");

  // ── Intent hydration (just-in-time context) ──
  // Nodes the author's LATEST message explicitly references — by reading-order number ("scene 14",
  // "beat 3"), by verbatim node id, or by an entity's name — get their FULL plan content inlined below,
  // exactly like the focus tray but derived from the message instead of a manual attach. This is what
  // keeps the turn ON the ask: the named target arrives fully grounded (no read_node round-trip), so the
  // model doesn't reach for the objective/lints as its anchor. Deterministic (regex + the same DFS
  // numbering the UI shows), capped at 4 nodes, prose omitted (bulky — read_node when the text matters).
  const mentioned: DnaNodeRow[] = [];
  const hydrated = new Set<string>(attachedIds ?? []); // the focus tray already inlines these in full
  const addMention = (n: DnaNodeRow | undefined) => {
    if (n && !hydrated.has(n.id) && mentioned.length < 4) { hydrated.add(n.id); mentioned.push(n); }
  };
  if (authorAsk.trim()) {
    const ask = authorAsk.slice(0, 2000);
    const idByNo = (m: Map<string, number>) => new Map([...m].map(([id, no]) => [no, id]));
    const sceneByNo = idByNo(sceneNo), beatByNo = idByNo(beatNo);
    for (const m of ask.matchAll(/\b(scene|beat)\s*#?\s*(\d+)\b/gi)) {
      const id = (m[1].toLowerCase() === "scene" ? sceneByNo : beatByNo).get(Number(m[2]));
      addMention(id ? byIdRow.get(id) : undefined);
    }
    for (const m of ask.matchAll(/\bn_[A-Za-z0-9]+/g)) addMention(byIdRow.get(m[0]));
    for (const n of sorted) {
      if (!["character", "location", "world_fact", "thread", "game"].includes(n.kind)) continue;
      const name = typeof n.content?.name === "string" ? n.content.name.trim() : "";
      if (name.length < 3) continue;
      if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(ask)) addMention(n);
    }
  }
  // A mentioned node arrives EDIT-READY: content + its POSITION (ancestor path it must honor as
  // fixed, children an edit stales) + the kind's SCHEMA (appended once below) — the three things
  // every node edit needs (craft rides separately as a skill brief).
  const pathOf = (n: DnaNodeRow): string => {
    const parts: string[] = [];
    let cur: DnaNodeRow | undefined = n;
    const walked = new Set<string>();
    while (cur && !walked.has(cur.id)) {
      walked.add(cur.id);
      parts.unshift(cur.id === n.id ? cur.kind : `${cur.kind} “${nodeHandle(cur.content)}”`);
      cur = cur.parent_id ? byIdRow.get(cur.parent_id) : undefined;
    }
    return parts.join(" › ");
  };
  const mentionedText = mentioned.map((n) => {
    const content: Record<string, unknown> = { ...(n.content ?? {}) };
    const prose = content.prose as { words?: unknown; text?: unknown } | undefined;
    const words = prose?.words;
    delete content.prose;
    const num = seqOf(n) ? ` ${seqOf(n)}/${n.kind === "scene" ? totalScenes : totalBeats}` : "";
    // A named scene is usually named BECAUSE its text is the subject (a continuity seam, an echoed
    // line, wording to fix), so inline the prose (bounded) right here instead of a "read_node for the
    // text" pointer. That collapses the extra read_node round-trip the agent would otherwise spend —
    // a whole self-chain link (row write + cold reinvoke + full prefill) — before it can even answer.
    // Only scenes hold prose; long prose keeps head+tail (the seam a continuity ask cares about).
    let proseBlock = "";
    let proseNote = "";
    if (n.kind === "scene" && typeof prose?.text === "string" && prose.text.trim()) {
      const wlabel = typeof words === "number" && words > 0 ? `${words.toLocaleString()}w` : "drafted";
      proseBlock = `\nprose (${wlabel}):\n${boundInlineProse(prose.text.trim())}`;
    } else if (typeof words === "number" && words > 0) {
      proseNote = ` (has prose, ${words.toLocaleString()}w — read_node for the text)`;
    }
    const kidCounts = new Map<string, number>();
    for (const k of nodes) if (k.parent_id === n.id) kidCounts.set(k.kind, (kidCounts.get(k.kind) ?? 0) + 1);
    const kidsNote = kidCounts.size ? ` · children: ${[...kidCounts].map(([k, c]) => `${c} ${k}${c > 1 ? "s" : ""}`).join(", ")} (an edit here STALES them)` : "";
    return `[${n.id}${n.authoring?.locked ? " · LOCKED" : ""}] ${n.kind}${num} “${nodeHandle(n.content)}”${proseNote}\npath: ${pathOf(n)}${kidsNote}\n${JSON.stringify(content)}${proseBlock}`;
  }).join("\n\n") + (mentioned.length ? `\n\n${schemaFor([...new Set(mentioned.map((n) => n.kind))])}` : "");


  // LIVE re-derivation (docs/agent-improvement-plan.md P1.2): recompute the guided-flow objective and the
  // structural backstop from the CURRENT tree, so an auto run's resume — a pure status flip that never
  // refreshes the message-time snapshot — no longer keeps pointing at "TARGET NODE: scene 14" after scene 14
  // renders. Same functions the web client runs (currentObjective / analysisText), so the anchor advances on
  // its own each chain link. The client-computed `analysis`/`objective` params are kept only as a fallback for
  // the (transient) case where the live tree hasn't loaded. Map DB rows → the engine's DnaNode shape;
  // authoring.source isn't read by these derivations, so a constant is safe (see novelDna editContent).
  const liveNodes: DnaNode[] = nodes.map((n) => ({
    id: n.id, book_id: bookId, parent_id: n.parent_id, level: n.level, kind: n.kind as NodeKind, position: n.position,
    content: (n.content ?? {}) as NodeContent,
    authoring: { source: "user", locked: n.authoring?.locked ?? false, status: (n.authoring?.status as AuthoringStatus) ?? "empty" },
    proposals: n.proposals ?? undefined, chosen: null,
  }));
  const liveObjective = currentObjective(liveNodes, { bookSlug: String(bookId), brief: b?.brief ?? null }) || objective;
  // THREE-STATE OBJECTIVE INJECTION (docs/agent-guidance-system.md D4). The objective used to ride EVERY
  // turn, so a concrete typed ask arrived next to a standing "do the next rung instead" instruction — the
  // pollution the Task-discipline paragraph then has to fight. Now: a concrete ask OMITS it entirely; an
  // empty ask or the explicit "Next" nudge (followObjective) injects it. AUTO always injects — there the
  // objective IS the work queue, and omitting it would break a full-book build.
  // …plus the INTERVIEW rung, always. The guard above exists to stop the objective competing with a
  // CONCRETE typed ask ("render scene 14") — but the interview has no typed asks: the author is just
  // talking, and the interview playbook IS how to handle that talking. Omitting it there meant the agent
  // improvised the whole interview from SYSTEM_THREAD with no rung guidance at all, which is exactly why it
  // would interview forever — nothing ever told it the interview HAS a finish. Measured 2026-08-02:
  // `<current_objective>` was absent from every request of an author-present premise run.
  const inInterview = stageSubsteps("premise", liveNodes, b?.brief ?? null)
    .find((s) => s.key === "interview")?.status === "now";
  const injectObjective = auto || followObjective || !authorAsk.trim() || inInterview;
  // Skill briefs (the injection channel of agent-skills.ts): playbooks whose triggers match the ask.
  // Ask matches always win outright: a concrete ask must not drag in skills for a rung it's steering
  // away from. Only fall back to matching the objective's text — an objective-driven premise turn gets
  // premise-craft without the author ever typing the word — when this arc was EXPLICITLY started by the
  // "Next" nudge (followObjective), not merely because the ask happened to miss the trigger vocabulary.
  // A free-typed message that hits no trigger gets no skill brief at all; read_skill still covers it.
  const askSkills = matchSkills(authorAsk);
  const matchedSkills = askSkills.length ? askSkills : followObjective ? matchSkills(liveObjective ?? "") : [];
  // D9 (docs/vision-to-structure.md): DISCOVERY is a STATE, not an ask. A mid-interview answer ("my
  // protagonist is a lighthouse keeper") is a concrete message — so the objective (carrying the interview
  // recipe) is omitted above, and its story nouns trip the WRONG ask-triggered skills (character-craft's
  // node-editing playbook, mid-interview). While discovering, pin the vision-interview skill every turn
  // and suppress ask-triggered skills. The predicate mirrors the journey twins' interview gate
  // (dna-journey stageSubsteps 'premise'): vision neither compiled nor skipped, and building not started
  // (no accepted seed-with-logline, no non-seed node).
  const vis = b?.brief?.vision;
  const seedNode = liveNodes.find((n) => n.kind === "seed");
  const seedAccepted = !!seedNode && seedNode.authoring.status === "accepted" &&
    !!String((seedNode.content as { logline?: string }).logline ?? "").trim();
  const startedBuilding = seedAccepted || liveNodes.some((n) => n.kind !== "seed");
  const discovering = !vis?.compiled_at && !vis?.skipped && !startedBuilding;
  const interviewSkill = AGENT_SKILLS.find((s) => s.name === "vision-interview");
  const effectiveSkills = discovering && interviewSkill ? [interviewSkill] : matchedSkills;
  const skillBriefs = effectiveSkills.map((s) => `### ${s.name}\n${s.body}`).join("\n\n");
  // Only meaningful once structure exists — mirrors the client's gate (AgentRail), which sends undefined
  // otherwise. analysisText ignores its settings arg, so we pass {}. Lint thresholds are genre-tuned
  // from the brief (lintConfigForBrief) so the agent acts on the same strictness the genre calls for.
  const hasStructure = liveNodes.some((n) => n.kind === "beat" || n.kind === "scene");
  const liveAnalysis = hasStructure ? analysisText(liveNodes, {}, lintConfigForBrief(b?.brief ?? null)) : (analysis ?? "");
  // The unified between-scenes view (docs/scene-ledger.md §3.2 consumer 2): the state ENTERING the next scene to
  // draft — open promises + character positions — rendered by the SAME ledgerText the prose generator reads, so
  // the agent curates its render brief against the same snapshot the writer will see. Empty until there's a
  // draftable scene with something to carry; an anchor, not a fence.
  const draftTarget = hasStructure ? nextDraftTarget(liveNodes) : undefined;
  const betweenScenes = draftTarget ? ledgerText(liveNodes, draftTarget.scene.id) : "";
  // Distilled web research the author gathered for this book (books.craft_notes, a { topic: note } map).
  // Rendered topic-by-topic; empty by default. Written by dna-research / research_web.
  const craftNotesText = Object.entries(b?.craft_notes ?? {})
    .filter(([, v]) => typeof v === "string" && v.trim())
    .map(([topic, v]) => `[${topic}]\n${(v as string).trim()}`).join("\n\n");

  // Per-book craft-note OVERRIDES (books.craft_overrides, set on the studio's Craft Notes tab). The agent's
  // skills embed the tier-1 DEFAULT craft; where the author has rewritten a stage's craft for this book,
  // this block carries their wording verbatim and instructs the agent to defer to it. Empty by default.
  const craftOverrideText = craftOverrideBlock(b?.craft_overrides ?? null);

  // Each distinct kind of context gets its own XML tag so the model can unambiguously tell where one
  // section ends and the next begins (Anthropic's prompt-engineering guidance: XML tags reduce
  // misinterpretation when a prompt mixes instructions, context, and a large structured document).
  const blocks = [
    `<book_name>${b?.name ?? ""}</book_name>`,
    // The brief, WITH the interview's vision document (the one v1 call site that opts in — every other
    // briefContext caller keeps byte-identical prompts).
    `<brief note="binding voice contract">\n${briefContext(b?.brief ?? null, { scope: "full", success: true, none: "(no brief)", empty: "(empty)", vision: true })}\n</brief>`,
    // Craft notes (books.craft_notes): distilled web research the author (or research_web / dna-research)
    // gathered for THIS book — genre conventions, comps, reference facts. An ANCHOR, not a fence: fold what's
    // relevant into your plans and render briefs; ignore what the current task doesn't touch. Empty by default.
    craftNotesText ? `<craft_notes note="researched craft/genre reference for this book — honor what's relevant when you plan or render; not a fence">\n${craftNotesText}\n</craft_notes>` : "",
    // Craft-note overrides (books.craft_overrides): the author has rewritten the DEFAULT craft for one or
    // more generation stages on the Craft Notes tab. These SUPERSEDE the default craft baked into your
    // skills for THIS book — obey them when you plan or write at that stage. Empty by default.
    craftOverrideText ? `<craft_overrides note="the author's per-book craft rules — these SUPERSEDE your default craft skills for this book">\n${craftOverrideText}\n</craft_overrides>` : "",
    // The guided-flow anchor (docs/agent-capabilities.md): the ONE journey rung to drive the author
    // through next, derived live from the tree (dna-journey.currentObjective). Present ONLY when this turn
    // has no concrete ask of its own (or auto/Next drives it) — see injectObjective above.
    injectObjective && liveObjective?.trim() ? `<current_objective note="the guided-flow anchor — the step to drive the author through next">\n${liveObjective.trim()}\n</current_objective>` : "",
    // The structural backstop (pacing / dangling-promise / sagging-run lints). In AUTO mode it's a
    // standing directive (nobody else will act on it); in interactive mode it's REFERENCE — a per-turn
    // imperative here made the agent fix lints when the author asked for something else entirely.
    liveAnalysis?.trim() ? `<story_analysis note="${auto ? "the structural backstop — address any ⚠ flags" : "structural lints, for REFERENCE — act on a ⚠ only when the author asks about problems or what's next"}">\n${liveAnalysis.trim()}\n</story_analysis>` : "",
    // The same between-scenes snapshot the prose generator sees entering the next scene to draft (scene-ledger
    // §3.2) — so a render brief you curate honors the open promises + where characters stand. Anchor, not fence.
    betweenScenes.trim() ? `<between_scenes note="state ENTERING the next scene to draft${draftTarget ? ` (scene ${draftTarget.orderIndex}/${draftTarget.total})` : ""} — the SAME snapshot the prose generator reads; honor open promises and where characters are when you plan or render">\n${betweenScenes.trim()}\n</between_scenes>` : "",
    // The context tray (docs/agent-context-model.md): the nodes the author attached to work on, hydrated in
    // full so you have their real content without a read_node. Lead with these unless the author steers
    // elsewhere — an anchor, not a fence: the whole tree is still below.
    focus ? `<focus note="the author attached these nodes to work on — their FULL content is inlined here; lead with them">\n${focus}\n</focus>` : "",
    // Intent hydration (above): the message's named targets, pre-read. Sits beside <focus> — same shape,
    // derived from the ask instead of a manual attach.
    mentionedText ? `<mentioned note="nodes the author's latest message references — full plan content inlined, and for named SCENES their prose too (long prose keeps head+tail; read_node for the omitted middle) so you can act on the ask directly WITHOUT a read_node round-trip">\n${mentionedText}\n</mentioned>` : "",
    // Skill briefs (agent-skills.ts): the playbooks whose triggers match the ask, pre-injected so the
    // matched job arrives with its full technique — no read_skill round-trip. Deterministic (regex on
    // the ask), so a retried link re-derives the identical prompt; read_skill covers missed triggers.
    skillBriefs ? `<skill_briefs note="playbooks matched to the author's ask — follow these when doing that job">\n${skillBriefs}\n</skill_briefs>` : "",
    `<dna_tree>\nEdit/add/delete nodes by their real ids below. LOCKED nodes are immutable. Beat and scene lines show their reading-order number (e.g. \`beat 3/41\`, \`scene 14/80\`); when you refer to a beat or scene by number, use THAT number — never guess it or reuse the objective's target number for a different node.\n\n${tree || "(no nodes yet)"}\n</dna_tree>`,
  ].filter(Boolean);

  const effortLine = effort === "low"
    ? "\n\n<fast_mode>\nThe author wants a quick response. If the change is clear from the tree, call propose_node_ops immediately — one sentence of narration, then the proposal. Skip read_node unless prose content is essential. Only pause to ask if the request is genuinely ambiguous.\n</fast_mode>"
    : "";
  // Autonomous mode: the author is AWAY. The agent must carry every request to a committed change with no
  // human gate — it makes the option choices itself and never waits. (The client auto-applies what it stages.)
  const autoLine = auto
    ? "\n\n<autonomous_mode>\nThe author has stepped away and CANNOT review, pick, or answer. Carry every request all the way to a finished result yourself, then conclude:\n- BATCH INDEPENDENT CHANGES: when the request decomposes into edits that don't depend on each other (fixing several lint hits across different scenes, touching several unrelated nodes), make them ALL in ONE propose_node_ops call — its ops is an array, capped at roughly 6-8 ops. Split into separate turns ONLY when a later change needs to see an earlier one applied first, OR when there are more than ~6-8 independent fixes — for a lint pass with many scattered hits (echoed phrases across a dozen+ scenes), don't read every implicated scene first to build a complete inventory before proposing anything: fix a handful, propose+apply that batch, then continue with the next handful next turn. Gathering everything up front outgrows the context window and causes a read/re-read loop that never converges. Render ONE scene per turn with propose_prose_render. Changes are APPLIED LIVE immediately — there is no review step, and your NEXT turn shows the updated tree/scene. Don't say \"I propose\" or wait for approval; just make the change (or request the render), then continue.\n- READ THEN ACT — don't over-read, and don't read in series. The tree in <book_state> is a DIGEST (handle/gist + causal spine). When changes need nodes' full detail (a beat's whole summary, a character's profile, a scene's prose), issue ALL the read_node/search_nodes calls for them in ONE turn — but only for the node(s) you're about to change. Don't sweep the tree; the digest is enough to decide what to touch.\n- At a GENUINE creative fork — a decision that shapes the story (an ending's direction, killing a character, a structural pivot) — call ask_author anyway, stating the question, your options, and which one you're choosing. In autonomous mode it never parks: the system answers instantly telling you to proceed with your stated choice, and the fork is journaled for the author to review later. Small mechanical choices don't warrant it.\n- Prefer to commit directly: when you'd weigh options, just pick the strongest and write it with propose_node_ops. (Avoid propose_options in autonomous mode — there's no one to pick.)\n- ALWAYS CONCLUDE: once the request is fully handled, call finish with a one-line summary of what you changed. Don't stop mid-thought after a change — keep going until you finish.\n</autonomous_mode>"
    : "";

  // Eager grounding steps (docs/agent-turn-grounding.md): the skill briefs and focus/mentioned nodes
  // injected above happen SILENTLY — the model never chose them via a tool call, so nothing was logged and
  // the author saw nothing but a spinner. Mirror the exact phrasing already used for the explicit
  // read_skill/read_node tool steps (execTool, below) so pre-injected context reads the same as chosen
  // context: "Loaded the X playbook.", "Loaded {kind} "{label}" in full." Caller dedups against what's
  // already logged this turn-cluster (see call site) — an auto run re-injects the SAME skill/nodes turn
  // after turn while nothing has changed, and re-announcing that is noise, not information.
  const groundingLabels: string[] = [];
  for (const s of effectiveSkills) groundingLabels.push(`Loaded the ${s.name} playbook.`);
  for (const n of [...focusNodes, ...mentioned]) groundingLabels.push(`Loaded ${n.kind} “${nodeHandle(n.content)}” in full.`);

  // The A/B seam goes LAST so it can override anything above it. variantSuffix("") for an unset variant,
  // so production prompt bytes are unchanged — see variants.ts.
  return { instructions: `${SYSTEM_THREAD}${effortLine}${autoLine}${variantSuffix(variant)}`, bookState: blocks.join("\n\n"), groundingLabels };
}


export { threadSystem };
