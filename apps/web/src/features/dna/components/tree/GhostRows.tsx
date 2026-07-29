// A not-yet-real row: previews the book's default shape (acts/beats from the structure template, the
// minimum cast) before anything is generated. Pure display — no id, no click, no add affordance; unlike
// PhantomRow (a staged proposal about to be applied) a ghost row isn't an action pending your decision, it's
// a forecast that quietly disappears once dnaSkeleton.ts sees real content at that rung (see its header note).
import type { GhostItem } from "@/features/dna/lib/dnaSkeleton";
import { KIND_COLOR, MONO, SERIF, T } from "./treeChrome";

function GhostRow({ item, depth }: { item: GhostItem; depth: number }) {
  const color = KIND_COLOR[item.kind] ?? T.muted;
  return (
    <div>
      <div style={{
        display: "flex", alignItems: "baseline", gap: 8,
        paddingLeft: depth * 20 + (depth > 0 ? 20 : 4), paddingRight: 12, paddingTop: 3, paddingBottom: 3,
      }}>
        <span style={{ width: 12, flexShrink: 0 }} />
        <span style={{
          fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color,
          padding: "1px 5px", borderRadius: 3, border: `1px dashed ${color}66`, whiteSpace: "nowrap", flexShrink: 0,
        }}>
          {item.kind}
        </span>
        <span style={{ fontFamily: SERIF, fontSize: 14, fontStyle: "italic", color: T.faint, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.title}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.06em", color: T.faint, flexShrink: 0 }}>not yet generated</span>
      </div>
      {item.hint && (
        <div style={{ paddingLeft: depth * 20 + (depth > 0 ? 20 : 4) + 20, paddingRight: 12, paddingBottom: 4 }}>
          <span style={{ fontFamily: SERIF, fontSize: 12, fontStyle: "italic", color: T.faint }}>{item.hint}</span>
        </div>
      )}
      {item.children?.map((c, i) => <GhostRow key={i} item={c} depth={depth + 1} />)}
    </div>
  );
}

export function GhostRows({ items, depth }: { items: GhostItem[]; depth: number }) {
  if (!items.length) return null;
  // opacity lives here ONCE — nested per-row opacity would compound multiplicatively with depth
  // (0.6, 0.36, 0.216, ...) and fade deeper ghosts into invisibility.
  return <div style={{ opacity: 0.6 }}>{items.map((it, i) => <GhostRow key={i} item={it} depth={depth} />)}</div>;
}
