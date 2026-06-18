// SpineStep — the Spine step's Stage body.
//
// Chat-first redesign: the center is a plain, editable spine textarea (autosave on blur).
// Generation and options live in the right-rail ReviseChat (layer="spine"). When empty,
// a calm pointer directs the author to the chat rail.
import { useEffect, useRef, useState } from "react";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { useToast } from "@/hooks/use-toast";
import { saveSpine } from "@/lib/ladder";
import { readSpineNode } from "@/lib/foundations";
import { GenerateInChat } from "../studioUi";

interface Props {
  bookId: number;
  /** Bumped on every studio refresh — re-reads the spine after the editor rail applies a revision. */
  reloadKey?: number;
  onStatusChange: (v: boolean) => void;
  onChanged: () => void;
}

export function SpineStep({ bookId, reloadKey, onStatusChange, onChanged }: Props) {
  const { toast } = useToast();
  const [spine, setSpine] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // Ref so in-flight reload()s can check dirty without capturing a stale closure value.
  const dirtyRef = useRef(false);

  const reload = async () => {
    const n = await readSpineNode(bookId);
    // Discard if the user started editing while we were fetching.
    if (dirtyRef.current) return;
    setSpine((n.text ?? "").trim());
    // Do NOT call onStatusChange here — BuildStudio reads spine.text from its own fetch,
    // and calling onStatusChange from reload() creates a feedback loop:
    // reload → onStatusChange → infoKey++ → reloadKey changes → reload → ...
  };

  useEffect(() => {
    let alive = true;
    void (async () => {
      await reload();
      if (alive) setLoaded(true);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  // The editor rail lives outside this column; when it applies a spine revision the studio refresh
  // bumps reloadKey, so re-read the chosen spine here. Skip while the author is mid-edit.
  useEffect(() => {
    if (!loaded || dirty) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await saveSpine(bookId, spine.trim(), { pinned: true });
      setDirty(false);
      dirtyRef.current = false;
      onStatusChange(!!spine.trim());
      onChanged();
    } catch (e) {
      toast({ title: "Couldn't save the spine", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return null;

  if (!spine.trim()) {
    return (
      <div className="space-y-4">
        <p className="pv-serif text-[15px] italic leading-relaxed text-[hsl(var(--pv-text-faint))]">
          No spine yet.
        </p>
        <GenerateInChat bookId={bookId} layer="spine" label="Draft the spine" />
        <p className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))]">
          Or type it directly below — one paragraph describing the journey from your argument to your ending.
        </p>
        <AutoTextarea
          value={spine}
          onChange={(e) => { setSpine(e.target.value); setDirty(true); dirtyRef.current = true; }}
          onBlur={() => { if (dirty && spine.trim()) void save(); }}
          placeholder="The spine in one paragraph — how the story moves from argument to ending through the tentpoles…"
          className="pv-serif w-full border-none bg-transparent px-0 text-[16px] leading-[1.65] focus-visible:ring-0"
        />
      </div>
    );
  }

  return (
    <AutoTextarea
      value={spine}
      onChange={(e) => { setSpine(e.target.value); setDirty(true); dirtyRef.current = true; }}
      onBlur={() => { if (dirty) void save(); }}
      className="pv-serif w-full border-none bg-transparent px-0 text-[18px] leading-[1.7] focus-visible:ring-0"
    />
  );
}
