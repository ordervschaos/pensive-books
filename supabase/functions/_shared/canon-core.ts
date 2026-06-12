// canon-core — the sequel canon packet and its prompt renderer (docs/pinned_method.md §8).
//
// Canon is to a sequel what a pin is to a draft: facts generation must honor and may never
// contradict. books.canon is written ONCE by the client's createSequel() and read-only after;
// this module only renders it into prompts (same conditional-addendum pattern as
// FOUNDATIONS_ADDENDUM — appended wherever books.canon is set).
//
// The browser mirror of the packet type lives in apps/web/src/lib/sequel.ts — keep in sync.
import { type DeltaType, type CharacterState } from "./page-state.ts";
import { type CastMember } from "./foundations-core.ts";

export interface CanonThread { name: string; description?: string | null }

export interface CanonPacket {
  parent_book_id: number;
  parent_title: string;
  summary?: string;                 // parent spine text — the throughline as actually built
  ending?: string;                  // how book 1 landed (parent foundations.ending.text)
  final_state?: Record<DeltaType, Record<string, string>>; // fold of ALL parent pages
  character_states?: CharacterState[]; // last ledger snapshot from the parent's final prose page
  cast?: CastMember[];              // parent cast as book 1 left them
  resolved_threads?: CanonThread[]; // paid promises — do NOT re-open as if unpaid
  carried_threads?: CanonThread[];  // open at parent end — the sequel's hooks
}

// Render the packet as the CANON block. Every field optional (old-flow / delta-less parents);
// emit only what exists so the addendum degrades gracefully.
export function canonContext(canon: CanonPacket): string {
  const lines: string[] = [
    `This book is a SEQUEL to "${canon.parent_title}". Everything below is CANON — settled fact from the previous book. Honor it exactly; never contradict it; never retell it. This book's own argument, ending and structure must be NEW, not a restatement of the previous book's.`,
  ];
  if (canon.summary?.trim()) lines.push(`PREVIOUS BOOK — WHAT HAPPENED (the throughline):\n${canon.summary.trim()}`);
  if (canon.ending?.trim()) lines.push(`HOW IT ENDED:\n${canon.ending.trim()}`);
  if (canon.cast?.length) {
    const cast = canon.cast.map((c) => {
      const line = (k: "want" | "wound" | "lie") => (c[k] ? `  ${k} (as the last book left it): ${c[k]}` : null);
      return [`- ${c.name} (${c.role ?? "major"})`, line("want"), line("wound"), line("lie")].filter(Boolean).join("\n");
    }).join("\n");
    lines.push(`CAST AS THE PREVIOUS BOOK LEFT THEM (identities are canon; their inner state should have MOVED since — a resolved lie does not reappear intact):\n${cast}`);
  }
  if (canon.character_states?.length) {
    const states = canon.character_states.map((s) => {
      const bits = [
        s.believes ? `believes: ${s.believes}` : null,
        s.knows?.length ? `knows: ${s.knows.join("; ")}` : null,
        s.feels ? `feels: ${s.feels}` : null,
        s.has?.length ? `has: ${s.has.join("; ")}` : null,
      ].filter(Boolean).join(" · ");
      return `- ${s.name}${bits ? ` — ${bits}` : ""}`;
    }).join("\n");
    lines.push(`WHERE EACH CHARACTER STOOD ON THE FINAL PAGE:\n${states}`);
  }
  const state = canon.final_state;
  if (state) {
    const sect = (label: string, rec?: Record<string, string>) => {
      const entries = Object.entries(rec ?? {});
      if (entries.length) lines.push(`${label}:\n${entries.map(([k, v]) => `- ${k}: ${v}`).join("\n")}`);
    };
    sect("WORLD STATE AT THE END (canon facts)", state.world);
    sect("VALUES WHERE THE LAST BOOK LEFT THEM", state.value);
  }
  if (canon.resolved_threads?.length) {
    lines.push(`RESOLVED THREADS (already paid off — do NOT re-open these as if unresolved):\n${
      canon.resolved_threads.map((t) => `- ${t.name}${t.description ? ` — ${t.description}` : ""}`).join("\n")}`);
  }
  if (canon.carried_threads?.length) {
    lines.push(`THREADS STILL OPEN FROM THE PREVIOUS BOOK (this book's inherited hooks — honor them or consciously abandon them, never forget them):\n${
      canon.carried_threads.map((t) => `- ${t.name}${t.description ? ` — ${t.description}` : ""}`).join("\n")}`);
  }
  return lines.join("\n\n");
}
