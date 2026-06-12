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
  page_type: string | null;
  title: string | null;
  metadata: { objective?: string } | null;
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
  for (const entry of parsed.pages) {
    const p = entry as Partial<PlanPage>;
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
      rebuild: planOnly ? undefined : p.rebuild === "rewrite" ? "rewrite" : p.rebuild === "revise" ? "revise" : undefined,
      why: typeof p.why === "string" ? p.why.trim() : "",
    });
  }

  // Deletes: only real ids, not already carried.
  const deletes: { ref: number; why?: string }[] = [];
  const deletedIds = new Set<number>();
  for (const d of Array.isArray(parsed.deletes) ? parsed.deletes : []) {
    const ref = typeof (d as { ref?: number }).ref === "number" ? (d as { ref: number }).ref : null;
    if (ref == null || !validIds.has(ref) || seen.has(ref) || deletedIds.has(ref)) continue;
    deletedIds.add(ref);
    deletes.push({ ref, why: typeof (d as { why?: string }).why === "string" ? (d as { why: string }).why.trim() : "" });
  }

  // Guardrail: any existing page neither carried nor deleted is appended as keep.
  for (const p of existing) {
    if (!seen.has(p.id) && !deletedIds.has(p.id)) {
      pages.push({
        ref: p.id,
        op: "keep",
        pageType: p.page_type === "section" ? "section" : "text",
        title: p.title ?? "",
        objective: (p.metadata?.objective ?? "").trim(),
        why: "",
      });
    }
  }

  return { summary: String(parsed.summary ?? "").trim(), pages, deletes, planOnly: planOnly || undefined };
}
