"use client";

import { useState, useTransition } from "react";
import { updateSectionMaxItems } from "../actions";

// Saves on blur (not on every keystroke) so an in-progress edit like "1" -> "10" doesn't fire a write for
// the intermediate "1". No submit button: this is the one field on a section you're expected to tweak
// after the fact, so removing the extra click is the point.
export function MaxItemsField({
  digestId,
  sectionId,
  initial,
}: {
  digestId: number;
  sectionId: string;
  initial: number;
}) {
  const [value, setValue] = useState(String(initial));
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  function save() {
    const n = Math.max(1, Number(value) || initial);
    setValue(String(n));
    if (n === initial) return;
    startTransition(async () => {
      await updateSectionMaxItems(digestId, sectionId, n);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });
  }

  return (
    <label className="flex items-center gap-1.5 font-mono text-xs text-muted">
      max items
      <input
        type="number"
        min={1}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        className="w-14 rounded border border-rule bg-white px-1.5 py-0.5 text-sm text-ink"
      />
      {pending ? <span>saving…</span> : saved ? <span>saved</span> : null}
    </label>
  );
}
