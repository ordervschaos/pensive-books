// CharacterLedgerGraph — how the character ledger (the state axis) moves across the book.
//
// Each written page stamps a full snapshot of every character's state onto pages.metadata
// (character_states; want/wound are stable, believes/knows/feels/has change). This reads those
// snapshots for the whole book and lays them out as a timeline grid: rows = characters, columns =
// the written pages in order. A pip marks each page where a character ENTERS or their state CHANGES
// vs the previous page; a faint pip means present-but-steady. So you can see, at a glance, which
// pages move whom. Self-fetching (one query) so it doesn't bloat the shared studio model. Read-only.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { CharacterState, PageMeta } from "@/lib/planProvenance";

interface PageSnap { pageId: number; pageNo: number; title: string | null; states: Map<string, CharacterState> }
type Cell = "enter" | "change" | "steady" | "absent";

// The fields that move page-to-page (want/wound are the stable arc poles, excluded from "changed").
function changingKey(s: CharacterState): string {
  return JSON.stringify({ b: s.believes ?? "", k: s.knows ?? [], f: s.feels ?? "", h: s.has ?? [] });
}

function summarize(s: CharacterState): string {
  return [
    s.feels && `feels ${s.feels}`,
    s.knows?.length && `knows ${s.knows.join("; ")}`,
    s.has?.length && `has ${s.has.join("; ")}`,
    s.believes && `believes ${s.believes}`,
  ].filter(Boolean).join(" · ") || "—";
}

export function CharacterLedgerGraph({ bookId, currentPageId, onSelectPage }: {
  bookId: number;
  currentPageId: number;
  onSelectPage: (pageId: number) => void;
}) {
  const [cols, setCols] = useState<PageSnap[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data } = await supabase
        .from("pages")
        .select("id, page_index, page_type, title, metadata")
        .eq("book_id", bookId)
        .eq("archived", false)
        .order("page_index", { ascending: true });
      if (!alive) return;
      const rows = (data as Array<{ id: number; page_type: string | null; title: string | null; metadata: PageMeta | null }> | null) ?? [];
      const textPages = rows.filter((r) => r.page_type !== "section");
      const snaps: PageSnap[] = [];
      textPages.forEach((r, i) => {
        const states = r.metadata?.character_states ?? [];
        if (!states.length) return; // only written pages carry a ledger snapshot
        snaps.push({ pageId: r.id, pageNo: i + 1, title: r.title, states: new Map(states.map((s) => [s.name, s])) });
      });
      setCols(snaps);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [bookId]);

  if (loading) return <p className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))]">Reading the ledger…</p>;
  if (cols.length === 0) {
    return <p className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))]">No character ledger yet — it fills in as pages are written.</p>;
  }

  // Characters in order of first appearance across the written pages.
  const names: string[] = [];
  for (const c of cols) for (const n of c.states.keys()) if (!names.includes(n)) names.push(n);

  // Per character, classify each column relative to their previous present snapshot.
  const cellOf = (name: string): { cells: Cell[]; states: (CharacterState | null)[] } => {
    const cells: Cell[] = [];
    const states: (CharacterState | null)[] = [];
    let prevKey: string | null = null;
    let seen = false;
    for (const col of cols) {
      const s = col.states.get(name) ?? null;
      states.push(s);
      if (!s) { cells.push("absent"); continue; }
      const key = changingKey(s);
      if (!seen) cells.push("enter");
      else if (key !== prevKey) cells.push("change");
      else cells.push("steady");
      prevKey = key; seen = true;
    }
    return { cells, states };
  };

  const gridCols = `120px repeat(${cols.length}, 16px)`;

  return (
    <div className="overflow-x-auto pb-1">
      <div className="inline-block min-w-full">
        {/* header: page numbers, current page marked */}
        <div className="grid items-end gap-y-1" style={{ gridTemplateColumns: gridCols }}>
          <span className="pv-mono text-[9px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">page →</span>
          {cols.map((c) => (
            <button
              key={c.pageId}
              type="button"
              onClick={() => onSelectPage(c.pageId)}
              title={c.title ?? `page ${c.pageNo}`}
              className={`pv-mono text-center text-[9px] tabular-nums hover:text-[hsl(var(--pv-accent))] ${c.pageId === currentPageId ? "text-[hsl(var(--pv-accent))] font-semibold" : "text-[hsl(var(--pv-text-faint))]"}`}
            >
              {c.pageNo}
            </button>
          ))}

          {/* one row per character */}
          {names.map((name) => {
            const { cells, states } = cellOf(name);
            return (
              <ROW key={name} name={name} cells={cells} states={states} cols={cols} currentPageId={currentPageId} onSelectPage={onSelectPage} />
            );
          })}
        </div>
      </div>

      <p className="pv-serif mt-2 text-[11.5px] italic text-[hsl(var(--pv-text-faint))]">
        ● enters or changes · ○ present, steady — click a page to open it. Hover a pip for that page's state.
      </p>
    </div>
  );
}

// A character row: the name, then a pip per written page. Fragment so cells join the parent grid.
function ROW({ name, cells, states, cols, currentPageId, onSelectPage }: {
  name: string; cells: Cell[]; states: (CharacterState | null)[]; cols: PageSnap[]; currentPageId: number; onSelectPage: (pageId: number) => void;
}) {
  return (
    <>
      <span className="truncate pv-serif text-[12.5px] text-[hsl(var(--pv-text-muted))] pr-2" title={name}>{name}</span>
      {cells.map((cell, i) => {
        const col = cols[i];
        const s = states[i];
        const here = col.pageId === currentPageId;
        const dot =
          cell === "enter" || cell === "change"
            ? "bg-[hsl(var(--pv-accent))]"
            : cell === "steady"
            ? "bg-[hsl(var(--pv-accent))]/25"
            : "bg-transparent";
        const ring = cell === "enter" ? "ring-1 ring-[hsl(var(--pv-accent))] ring-offset-1 ring-offset-background" : "";
        return (
          <button
            key={col.pageId}
            type="button"
            onClick={() => onSelectPage(col.pageId)}
            title={s ? `${name} @ page ${col.pageNo}${cell === "enter" ? " (enters)" : cell === "change" ? " (changes)" : ""}: ${summarize(s)}` : ""}
            className={`flex h-4 items-center justify-center ${here ? "bg-[hsl(var(--pv-accent))]/[0.06]" : ""}`}
          >
            <span className={`h-[7px] w-[7px] rounded-full ${dot} ${ring}`} />
          </button>
        );
      })}
    </>
  );
}
