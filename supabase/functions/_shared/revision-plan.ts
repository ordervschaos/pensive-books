// revision-plan.ts — the RevisionPlan contract + the safety guardrails for model-proposed plans.
//
// A revision plan is the ONLY way AI changes a book's structure (book doctor, editor's agent), and
// it is always reviewed by the author before build-revision applies it. Whatever produced the plan
// (parsed JSON text in revise-outline, structured tool input in revise-agent), it must pass the
// same sanitization — mirrors revise-outline's parsePlan, which remains the text-parsing wrapper:
//  - only real page ids; coerce shapes; default unknown ops to "keep".
//  - every existing page must be carried (in pages[]) or deleted — any the model omitted are
//    appended as "keep" so a page is NEVER silently dropped.
//  - de-duplicate refs (first wins).

export interface PlanPage {
  ref: number | null;
  op: "keep" | "revise" | "retarget" | "add";
  pageType: "section" | "text";
  title: string;
  objective: string;
  // The beat-sheet reviser carries a beat per page (the desired final beat). Apply (build-revision)
  // writes it when it differs from the page's current beat; omitted by the objective-only revisers.
  beat?: string;
  rebuild?: "rewrite" | "revise";
  why?: string;
}

export interface RevisionPlan {
  summary: string;
  pages: PlanPage[];
  deletes: { ref: number; why?: string }[];
  planOnly?: boolean;
}

export interface ExistingPage {
  id: number;
  page_index?: number;
  page_type: string | null;
  title: string | null;
  metadata: { objective?: string; beat?: string } | null;
}

export function sanitizePlan(
  parsed: Partial<RevisionPlan>,
  existing: ExistingPage[],
  planOnly = false,
): RevisionPlan {
  if (!Array.isArray(parsed.pages) || parsed.pages.length === 0) {
    throw new Error("Revision plan has no pages.");
  }

  const byId = new Map(existing.map((p) => [p.id, p]));
  const validIds = new Set(existing.map((p) => p.id));
  const ops = new Set(["keep", "revise", "retarget", "add"]);

  const seen = new Set<number>();
  const pages: PlanPage[] = [];
  const deletes: { ref: number; why?: string }[] = [];
  const deletedIds = new Set<number>();
  const addDelete = (ref: number, why?: unknown) => {
    if (deletedIds.has(ref)) return;
    deletedIds.add(ref);
    deletes.push({ ref, why: typeof why === "string" ? why.trim() : "" });
  };

  for (const entry of parsed.pages) {
    const p = entry as Partial<Omit<PlanPage, "op">> & { op?: string };
    // Models sometimes mark a deletion inline (op: "delete") instead of (or as well as) listing it
    // in deletes[]. Honor it — coercing it to "keep" would silently swallow the deletion.
    if (p.op === "delete") {
      const ref = typeof p.ref === "number" ? p.ref : null;
      if (ref != null && validIds.has(ref) && !seen.has(ref)) addDelete(ref, p.why);
      continue;
    }
    let op = ops.has(p.op as string) ? (p.op as PlanPage["op"]) : "keep";
    // Plan-only edits the outline, never prose: a "revise" collapses to a no-op "keep".
    if (planOnly && op === "revise") op = "keep";
    if (op === "add") {
      if (typeof p.title !== "string" || !p.title.trim()) continue;
      pages.push({
        ref: null,
        op: "add",
        pageType: p.pageType === "section" ? "section" : "text",
        title: p.title.trim(),
        objective: (p.objective ?? "").trim(),
        beat: (p.beat ?? "").trim() || undefined,
        why: typeof p.why === "string" ? p.why.trim() : "",
      });
      continue;
    }
    // existing-page op: must reference a real, not-yet-seen id
    const ref = typeof p.ref === "number" ? p.ref : null;
    if (ref == null || !validIds.has(ref) || seen.has(ref)) continue;
    seen.add(ref);
    const cur = byId.get(ref)!;
    pages.push({
      ref,
      op,
      pageType: cur.page_type === "section" ? "section" : "text",
      title: typeof p.title === "string" && p.title.trim() ? p.title.trim() : (cur.title ?? ""),
      objective: (p.objective ?? cur.metadata?.objective ?? "").trim(),
      beat: (((p.beat?.trim() === "[unchanged]" ? "" : p.beat) ?? cur.metadata?.beat ?? "").trim()) || undefined,
      rebuild: planOnly ? undefined : p.rebuild === "rewrite" ? "rewrite" : p.rebuild === "revise" ? "revise" : undefined,
      why: typeof p.why === "string" ? p.why.trim() : "",
    });
  }

  // Deletes: only real ids. An explicit deletes[] entry beats a plain "keep" carry (the model
  // carried the page out of "never drop silently" caution but clearly wants it gone); an active
  // op (revise/retarget) wins over the delete — the model did real work on that page.
  for (const d of Array.isArray(parsed.deletes) ? parsed.deletes : []) {
    const ref = typeof (d as { ref?: number }).ref === "number" ? (d as { ref: number }).ref : null;
    if (ref == null || !validIds.has(ref) || deletedIds.has(ref)) continue;
    if (seen.has(ref)) {
      const i = pages.findIndex((pg) => pg.ref === ref);
      if (i === -1 || pages[i].op !== "keep") continue;
      pages.splice(i, 1);
      seen.delete(ref);
    }
    addDelete(ref, (d as { why?: string }).why);
  }

  // Guardrail: any existing page neither carried nor deleted is preserved. Keep it near the first
  // explicitly-carried page that originally followed it; appending all omissions to the end can move
  // chapter section headers after their pages, making newly inserted pages look orphaned.
  const original = [...existing].sort((a, b) => (a.page_index ?? 0) - (b.page_index ?? 0));
  const originalRank = new Map(original.map((p, i) => [p.id, i]));
  const makeKeep = (p: ExistingPage): PlanPage => ({
    ref: p.id,
    op: "keep",
    pageType: p.page_type === "section" ? "section" : "text",
    title: p.title ?? "",
    objective: (p.metadata?.objective ?? "").trim(),
    beat: ((p.metadata?.beat ?? "").trim()) || undefined,
    why: "",
  });
  for (const p of original) {
    if (seen.has(p.id) || deletedIds.has(p.id)) continue;
    const rank = originalRank.get(p.id) ?? Number.MAX_SAFE_INTEGER;
    let lastRank = Number.NEGATIVE_INFINITY;
    const before = pages.findIndex((page, i) => {
      if (page.ref == null) {
        const nextRef = pages.slice(i + 1).find((candidate) => candidate.ref != null)?.ref;
        const nextRank = nextRef == null ? Number.POSITIVE_INFINITY : originalRank.get(nextRef) ?? Number.POSITIVE_INFINITY;
        return lastRank < rank && rank < nextRank;
      }
      const pageRank = originalRank.get(page.ref) ?? Number.MAX_SAFE_INTEGER;
      if (pageRank > rank) return true;
      lastRank = pageRank;
      return false;
    });
    if (before === -1) pages.push(makeKeep(p));
    else pages.splice(before, 0, makeKeep(p));
    seen.add(p.id);
  }

  return { summary: String(parsed.summary ?? "").trim(), pages, deletes, planOnly: planOnly || undefined };
}
