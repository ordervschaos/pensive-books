import { describe, expect, it } from "vitest";
import { nextAutopilotAction } from "@/features/dna/lib/autopilot";
import { type DnaNode, type NodeKind } from "@/features/dna/lib/novelDna";

let seq = 0;
const mk = (kind: NodeKind, over: Partial<DnaNode> & { content?: Record<string, unknown> } = {}): DnaNode => ({
  id: over.id ?? `n_${kind}_${seq++}`,
  book_id: 1,
  parent_id: over.parent_id ?? null,
  level: over.level ?? 0,
  kind,
  position: over.position ?? 0,
  content: over.content ?? {},
  authoring: { source: "ai", locked: false, status: "accepted", ...(over.authoring ?? {}) },
});

const next = (nodes: DnaNode[], attempted: string[] = [], failed: string[] = [], mode: "prose" | "picture" = "prose") =>
  nextAutopilotAction(nodes, new Set(attempted), new Set(failed), mode);

describe("nextAutopilotAction — the recipe walker", () => {
  it("a seeded book's first move is premise", () => {
    const a = next([mk("seed", { id: "s", content: { logline: "x" } })]);
    expect(a?.target).toBe("premise");
    expect(a?.singleton).toBe(true);
  });

  it("walks the foundations branch in order once a pillar exists", () => {
    const nodes = [mk("seed", { id: "s" }), mk("premise", { id: "pr" }), mk("pillar", { id: "p" })];
    // cast first (no characters yet)
    expect(next(nodes)?.target).toBe("cast");
    // with cast present → voice_profile, then world, then set-pieces, then relationships
    nodes.push(mk("character", { parent_id: "p" }));
    expect(next(nodes)?.target).toBe("voice_profile");
    nodes.push(mk("voice_profile", { parent_id: "p" }));
    expect(next(nodes)?.target).toBe("world");
    nodes.push(mk("world_fact", { parent_id: "p" }));
    expect(next(nodes)?.target).toBe("set-pieces");
    nodes.push(mk("tentpole", { parent_id: "p" }));
    expect(next(nodes)?.target).toBe("relationships");
  });

  it("does not pick a single-yield step that was already attempted (zero-yield optional)", () => {
    const nodes = [mk("seed"), mk("premise"), mk("pillar", { id: "p" }), mk("character", { parent_id: "p" })];
    // world would be next, but if attempted with no result we skip to set-pieces
    expect(next(nodes, ["voice_profile", "world"])?.target).toBe("set-pieces");
  });

  it("structure runs acts → threads → games → beat sheet (sheet waits for the acts)", () => {
    const base = [mk("seed"), mk("premise"), mk("pillar", { id: "p" }), mk("character", { parent_id: "p" })];
    const attempted = ["voice_profile", "world", "set-pieces", "relationships"]; // optional foundations skipped
    expect(next(base, attempted)?.target).toBe("acts");
    base.push(mk("act", { id: "m", parent_id: "p" }));
    expect(next(base, attempted)?.target).toBe("threads");
    base.push(mk("thread", { parent_id: "p" }));
    expect(next(base, attempted)?.target).toBe("games");
    base.push(mk("game", { parent_id: "p" }));
    expect(next(base, attempted)?.target).toBe("beatsheet");
  });

  it("scenes are generated per-beat, then prose per-scene", () => {
    const nodes = [
      mk("pillar", { id: "p" }), mk("character", { parent_id: "p" }),
      mk("act", { id: "m", parent_id: "p" }),
      mk("beat", { id: "b1", parent_id: "m" }), mk("beat", { id: "b2", parent_id: "m" }),
    ];
    const attempted = ["voice_profile", "world", "set-pieces", "relationships", "threads", "games"];
    // both beats lack scenes → scenes step, per-beat (not singleton)
    const a = next(nodes, attempted);
    expect(a?.target).toBe("scenes");
    expect(a?.singleton).toBe(false);
    expect(a?.node.id).toBe("b1");

    // give b1 a scene → the next scenes target is b2
    nodes.push(mk("scene", { id: "sc1", parent_id: "b1" }));
    expect(next(nodes, attempted)?.node.id).toBe("b2");

    // all beats have a scene → prose for the empty scene
    nodes.push(mk("scene", { id: "sc2", parent_id: "b2" }));
    const p = next(nodes, attempted);
    expect(p?.target).toBe("prose");
    expect(p?.node.id).toBe("sc1");
  });

  it("a failed beat is skipped so the loop doesn't stall on it", () => {
    const nodes = [
      mk("pillar", { id: "p" }), mk("character", { parent_id: "p" }),
      mk("act", { id: "m", parent_id: "p" }),
      mk("beat", { id: "b1", parent_id: "m" }), mk("beat", { id: "b2", parent_id: "m" }),
    ];
    const attempted = ["voice_profile", "world", "set-pieces", "relationships", "threads", "games"];
    expect(next(nodes, attempted, ["b1"])?.node.id).toBe("b2");
  });

  it("returns null when every scene is drafted", () => {
    const nodes = [
      mk("pillar", { id: "p" }), mk("character", { parent_id: "p" }),
      mk("act", { id: "m", parent_id: "p" }), mk("beat", { id: "b", parent_id: "m" }),
      mk("scene", { id: "sc", parent_id: "b", content: { prose: { text: "Once upon a time." } } }),
    ];
    const attempted = ["voice_profile", "world", "set-pieces", "relationships", "threads", "games"];
    expect(next(nodes, attempted)).toBeNull();
  });

  it("picture mode illustrates each scene (target 'illustrate', done = caption)", () => {
    const nodes = [
      mk("pillar", { id: "p" }), mk("character", { parent_id: "p" }),
      mk("act", { id: "m", parent_id: "p" }), mk("beat", { id: "b", parent_id: "m" }),
      mk("scene", { id: "sc", parent_id: "b" }),
    ];
    const attempted = ["voice_profile", "world", "set-pieces", "relationships", "threads", "games"];
    const a = next(nodes, attempted, [], "picture");
    expect(a?.target).toBe("illustrate");
    expect(a?.node.id).toBe("sc");
    expect(a?.singleton).toBe(false);
  });

  it("picture mode treats a captioned scene as drafted (image renders in background, not re-kicked)", () => {
    const nodes = [
      mk("pillar", { id: "p" }), mk("character", { parent_id: "p" }),
      mk("act", { id: "m", parent_id: "p" }), mk("beat", { id: "b", parent_id: "m" }),
      // caption present, but image_url NOT yet pinned — must still count as done so the loop moves on.
      mk("scene", { id: "sc", parent_id: "b", content: { caption: { text: "A wolf at the door." } } }),
    ];
    const attempted = ["voice_profile", "world", "set-pieces", "relationships", "threads", "games"];
    expect(next(nodes, attempted, [], "picture")).toBeNull();
  });

  it("prose-mode prose does NOT satisfy picture mode (a prose book toggled to picture still needs captions)", () => {
    const nodes = [
      mk("pillar", { id: "p" }), mk("character", { parent_id: "p" }),
      mk("act", { id: "m", parent_id: "p" }), mk("beat", { id: "b", parent_id: "m" }),
      mk("scene", { id: "sc", parent_id: "b", content: { prose: { text: "Once upon a time." } } }),
    ];
    const attempted = ["voice_profile", "world", "set-pieces", "relationships", "threads", "games"];
    expect(next(nodes, attempted, [], "picture")?.target).toBe("illustrate");
  });

  it("does not advance past an unaccepted pillar", () => {
    const nodes = [
      mk("seed"), mk("premise"),
      mk("pillar", { id: "p", authoring: { source: "ai", locked: false, status: "draft" } }),
    ];
    // pillar exists but isn't accepted → no foundations expand fires
    expect(next(nodes)).toBeNull();
  });
});
