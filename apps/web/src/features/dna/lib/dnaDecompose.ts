// dnaDecompose — client shim for the imported-draft SEMANTIC ASCENT. The run itself is SERVER-OWNED
// (dna-decompose self-chains through book_decompositions; see supabase/functions/dna-decompose):
// this module only kicks it off, and DecomposeButton projects the row over Realtime
// (useLatestTaskRow). Stop rides the universal stopRun chokepoint. All pure logic (chapter assembly,
// op builders) lives in supabase/functions/_shared/dna-decompose-core.ts — imported by the edge fn
// and by the tests, never duplicated here.
import { supabase } from "@/integrations/supabase/client";
import type { TaskRow } from "@/hooks/useLatestTaskRow";

export interface DecomposeRow extends TaskRow {
  phase: "chapters" | "top" | "acts" | "entities" | "systems" | "seal";
  done: number;
  total: number;
  skipped?: string[];
}

/** Kick off (or re-attach to) the server-owned ascent for a book. Returns the run row id. */
export async function startDecompose(bookId: number): Promise<number> {
  const { data, error } = await supabase.functions.invoke("dna-decompose", { body: { bookId } });
  if (error) throw error;
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return (data as { id: number }).id;
}

/** Human status line for a live run row. */
export function decomposeLabel(row: DecomposeRow): string {
  return row.phase === "chapters" ? `read ${row.done}/${row.total} chapters…`
    : row.phase === "top" ? "distilling premise…"
      : row.phase === "acts" ? "finding the acts…"
        : row.phase === "entities" ? "extracting cast & places…"
          : row.phase === "systems" ? "mapping threads & games…"
            : "sealing…";
}
