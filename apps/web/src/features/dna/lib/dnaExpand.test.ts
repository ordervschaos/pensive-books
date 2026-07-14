import { beforeEach, describe, expect, it, vi } from "vitest";
import { contractDelta, isWorkerResourceLimit, persistContract, realizeScenesFromBeat } from "@/features/dna/lib/dnaExpand";
import type { BeatContent, DnaNode, MeterContent, NodeContent, SceneContent, VoiceContent } from "@/features/dna/lib/novelDna";

// In-memory book_nodes so persistContract's load→save round-trips run without supabase. The mock carries
// every export the module graph imports (dnaChat/dnaProposals/treeVersions pull the others).
vi.mock("@/features/dna/lib/bookNodes", () => {
  const store: { id: string }[] = [];
  const upsert = (n: { id: string }) => { const i = store.findIndex((x) => x.id === n.id); if (i >= 0) store[i] = n; else store.push(n); };
  return {
    __store: store,
    loadTree: async () => [...store],
    saveNode: async (n: { id: string }) => upsert(n),
    saveNodes: async (ns: { id: string }[]) => ns.forEach(upsert),
    patchNodeContent: async () => {},
    deleteNode: async (id: string) => { const i = store.findIndex((x) => x.id === id); if (i >= 0) store.splice(i, 1); },
  };
});
import * as bookNodes from "@/features/dna/lib/bookNodes";
const store = (bookNodes as unknown as { __store: DnaNode[] }).__store;

const beatNode = (content: BeatContent, position = 0): DnaNode => ({
  id: "b1", book_id: 1, parent_id: "a1", level: 3, kind: "beat", position, content: content as NodeContent,
  authoring: { source: "user", locked: false, status: "accepted" },
});
const scene = (): SceneContent => ({ value_shift: { value: "v", from: "a", to: "b" } });

describe("realizeScenesFromBeat — causal plan distribution (§3d)", () => {
  it("puts needs on the FIRST scene and establishes on the LAST (multi-scene beat)", () => {
    const scenes = [scene(), scene(), scene()];
    realizeScenesFromBeat(
      beatNode({ needs: ["door_open"], establishes: ["ledger_settled"], grounds_in: ["wf1"], resolves: [{ ref: "g1", outcome: "won" }] }, 1),
      scenes,
    );
    // needs (consumed at entry) → first scene; establishes (produced when the turn lands) → last scene.
    expect(scenes[0].needs).toEqual(["door_open"]);
    expect(scenes[0].establishes).toBeUndefined();
    expect(scenes[2].establishes).toEqual(["ledger_settled"]);
    expect(scenes[2].needs).toBeUndefined();
    // establishes co-locates with grounds_in / resolves on the resolving (last) scene.
    expect(scenes[2].grounds_in).toEqual(["wf1"]);
    expect(scenes[2].resolves).toEqual([{ ref: "g1", outcome: "won" }]);
    // the middle scene carries no causal token (its job is "develop", not to earn/produce a state key).
    expect(scenes[1].needs).toBeUndefined();
    expect(scenes[1].establishes).toBeUndefined();
  });

  it("keeps both on the sole scene of a single-scene beat (first === last — no regression)", () => {
    const scenes = [scene()];
    realizeScenesFromBeat(beatNode({ needs: ["n"], establishes: ["e"] }, 1), scenes);
    expect(scenes[0].needs).toEqual(["n"]);
    expect(scenes[0].establishes).toEqual(["e"]);
  });

  it("still inherits polarity, thread anchors (first scene), plays (first), and distributes tentpoles in order", () => {
    const scenes = [scene(), scene()];
    realizeScenesFromBeat(
      beatNode({ polarity: "down", threads: [{ ref: "t1", role: "setup" }], realizes: ["tp1", "tp2"], plays: ["g1"] }, 1),
      scenes,
    );
    expect(scenes[0].value_shift?.polarity).toBe("down");
    expect(scenes[0].threads).toEqual([{ ref: "t1", role: "setup" }]);
    expect(scenes[0].plays).toEqual(["g1"]);
    expect(scenes[0].realizes_tentpole).toBe("tp1");
    expect(scenes[1].realizes_tentpole).toBe("tp2");
  });

  it("opens a chapter on the first scene of the ACT's first beat (position 0)", () => {
    const scenes = [scene()];
    realizeScenesFromBeat(beatNode({ summary: "The arrival — everything shifts." }, 0), scenes);
    expect(scenes[0].chapter_start?.title).toBeTruthy();
  });

  it("does NOT open a chapter for a beat that isn't its act's first (position > 0)", () => {
    const scenes = [scene()];
    realizeScenesFromBeat(beatNode({ summary: "The arrival — everything shifts." }, 1), scenes);
    expect(scenes[0].chapter_start).toBeUndefined();
  });

  it("titles the chapter from the ACT, not the beat, when the act has a title", () => {
    const scenes = [scene()];
    const act: DnaNode = { id: "a1", book_id: 1, parent_id: null, level: 2, kind: "act", position: 0, content: { title: "Act One: The Setup" }, authoring: { source: "user", locked: false, status: "accepted" } };
    realizeScenesFromBeat(beatNode({ summary: "The arrival — everything shifts." }, 0), scenes, act);
    expect(scenes[0].chapter_start?.title).toBe("Act One: The Setup");
  });
});

// §v4 (docs/agent-improvement-remaining.md): detecting worker-pool contention distinctly from a real error,
// so invokeWithRetry can give it a longer backoff + a bonus attempt instead of discarding the turn.
describe("isWorkerResourceLimit — §v4 546 detection", () => {
  it("matches supabase-js's FunctionsHttpError shape (status on .context)", () => {
    expect(isWorkerResourceLimit({ context: { status: 546 } })).toBe(true);
  });
  it("matches a message carrying the WORKER_RESOURCE_LIMIT text", () => {
    expect(isWorkerResourceLimit(new Error("Edge Function returned WORKER_RESOURCE_LIMIT"))).toBe(true);
  });
  it("matches a bare '546' in the message as a fallback", () => {
    expect(isWorkerResourceLimit(new Error("edge call failed: 546"))).toBe(true);
  });
  it("does not match an unrelated error", () => {
    expect(isWorkerResourceLimit(new Error("network request failed"))).toBe(false);
    expect(isWorkerResourceLimit({ context: { status: 500 } })).toBe(false);
  });
});

// W1: the compiled brief contract — tentpoles/meters under the pillar + register bounds on the voice profile.
describe("persistContract — idempotent contract landing", () => {
  const pillar: DnaNode = {
    id: "pil", book_id: 1, parent_id: null, level: 2, kind: "pillar", position: 0,
    content: { controlling_idea: "x" }, authoring: { source: "user", locked: false, status: "accepted" },
  };
  const res = {
    contract: true,
    tentpoles: [{ summary: "The dark moment — all seems lost" }, { summary: "The grand gesture" }],
    meters: [{ name: "tension", kind: "tension", poles: { low: "calm", high: "dread" }, scale: { min: 0, max: 100 }, target: [{ at: 0, value: 10 }, { at: 0.9, value: 90 }] }] as MeterContent[],
    voice_constraints: ["No graphic gore", "Keep slang timeless"],
  };

  beforeEach(() => { store.length = 0; store.push({ ...pillar }); });

  it("creates tentpoles + meters (accepted) and a DRAFT voice_profile carrying only the constraints", async () => {
    const { added } = await persistContract(1, res);
    expect(added).toBe(4); // 2 tentpoles + 1 meter + the voice carrier
    expect(store.filter((n) => n.kind === "tentpole")).toHaveLength(2);
    const meter = store.find((n) => n.kind === "meter")!;
    expect(meter.authoring.status).toBe("accepted");
    expect((meter.content as MeterContent).target).toHaveLength(2);
    const vp = store.find((n) => n.kind === "voice_profile")!;
    expect(vp.authoring.status).toBe("draft"); // style deliberately unset — no missing_field lint in validate()
    expect((vp.content as VoiceContent).constraints).toEqual(res.voice_constraints);
  });

  it("re-running creates NO duplicates (case-insensitive match) and merges constraints without repeats", async () => {
    await persistContract(1, res);
    const sizeAfterFirst = store.length;
    const { added } = await persistContract(1, {
      ...res,
      tentpoles: [{ summary: "the DARK moment — all seems lost" }], // same promise, different case
      voice_constraints: ["no graphic gore", "Sentences under 25 words"], // one dupe, one new
    });
    expect(store.length).toBe(sizeAfterFirst); // no new nodes — only the voice merge
    expect(added).toBe(1); // the constraint merge is the sole change
    const vp = store.find((n) => n.kind === "voice_profile")!;
    expect((vp.content as VoiceContent).constraints).toEqual([...res.voice_constraints, "Sentences under 25 words"]);
    // a fully-identical third run is a clean no-op
    expect((await persistContract(1, res)).added).toBe(0);
  });

  it("contractDelta merges into an EXISTING voice profile, preserving its entries in order", () => {
    const vp: DnaNode = { ...pillar, id: "vp", parent_id: "pil", kind: "voice_profile", content: { style: "lyrical", constraints: ["Present tense only"] } };
    const delta = contractDelta([pillar, vp], { voice_constraints: ["present tense ONLY", "No adverb stacking"] });
    expect(delta.voice?.node?.id).toBe("vp");
    expect(delta.voice?.merged).toEqual(["Present tense only", "No adverb stacking"]);
  });
});
