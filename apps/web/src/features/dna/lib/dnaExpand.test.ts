import { describe, expect, it } from "vitest";
import { realizeScenesFromBeat } from "@/features/dna/lib/dnaExpand";
import type { BeatContent, DnaNode, NodeContent, SceneContent } from "@/features/dna/lib/novelDna";

const beatNode = (content: BeatContent): DnaNode => ({
  id: "b1", book_id: 1, parent_id: "a1", level: 3, kind: "beat", position: 0, content: content as NodeContent,
  authoring: { source: "user", locked: false, status: "accepted" },
});
const scene = (): SceneContent => ({ value_shift: { value: "v", from: "a", to: "b" } });

describe("realizeScenesFromBeat — causal plan distribution (§3d)", () => {
  it("puts needs on the FIRST scene and establishes on the LAST (multi-scene beat)", () => {
    const scenes = [scene(), scene(), scene()];
    realizeScenesFromBeat(
      beatNode({ needs: ["door_open"], establishes: ["ledger_settled"], grounds_in: ["wf1"], resolves: [{ ref: "g1", outcome: "won" }] }),
      scenes, 1,
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
    realizeScenesFromBeat(beatNode({ needs: ["n"], establishes: ["e"] }), scenes, 1);
    expect(scenes[0].needs).toEqual(["n"]);
    expect(scenes[0].establishes).toEqual(["e"]);
  });

  it("still inherits polarity, thread anchors (first scene), plays (first), and distributes tentpoles in order", () => {
    const scenes = [scene(), scene()];
    realizeScenesFromBeat(
      beatNode({ polarity: "down", threads: [{ ref: "t1", role: "setup" }], realizes: ["tp1", "tp2"], plays: ["g1"] }),
      scenes, 1,
    );
    expect(scenes[0].value_shift?.polarity).toBe("down");
    expect(scenes[0].threads).toEqual([{ ref: "t1", role: "setup" }]);
    expect(scenes[0].plays).toEqual(["g1"]);
    expect(scenes[0].realizes_tentpole).toBe("tp1");
    expect(scenes[1].realizes_tentpole).toBe("tp2");
  });

  it("opens a chapter on the first scene when the beat starts at reading position 0", () => {
    const scenes = [scene()];
    realizeScenesFromBeat(beatNode({ summary: "The arrival — everything shifts." }), scenes, 0);
    expect(scenes[0].chapter_start?.title).toBeTruthy();
  });
});
