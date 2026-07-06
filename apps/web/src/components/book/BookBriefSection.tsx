import { useRef, useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  BRIEF_FIELDS,
  Brief,
  computeCompletion,
  GENRE_SUGGESTIONS,
  mergeBrief,
  TONE_SUGGESTIONS,
} from "@/lib/brief";
import { ScopeBandPicker } from "@/components/book/ScopeBandPicker";
import { bootstrapLoglineFromBrief } from "@/features/dna/lib/dnaExpand";

interface BookBriefSectionProps {
  bookId: number;
  brief: Brief | null;
  onBriefChange: (brief: Brief) => void;
  /** Render bare (no Card chrome / heading) for use inside a dialog that supplies its own title. */
  embedded?: boolean;
  /** Called when the user explicitly finishes (e.g. closes an embedded dialog). */
  onSaved?: () => void;
}

export function BookBriefSection({ bookId, brief, onBriefChange, embedded = false, onSaved }: BookBriefSectionProps) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Brief>(brief ?? {});
  const [saving, setSaving] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completion = computeCompletion(draft);
  const total = BRIEF_FIELDS.length;

  const doSave = async (d: Brief) => {
    setSaving(true);
    try {
      const next = mergeBrief(brief, d);
      const { error } = await supabase.from("books").update({ brief: next }).eq("id", bookId);
      if (error) throw error;
      onBriefChange(next);
      setDraft(next);
      setShowSaved(true);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setShowSaved(false), 2000);
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Couldn't save brief",
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setSaving(false);
    }
  };

  // For pill clicks: compute new draft inline and save immediately (setState is async).
  const updateAndSave = (patch: Partial<Brief>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    void doSave(next);
  };

  const toggleTone = (t: string) => {
    const current = draft.tone ?? [];
    const next = current.includes(t) ? current.filter((x) => x !== t) : [...current, t];
    updateAndSave({ tone: next });
  };

  const content = (
    <>
      {!embedded && (
        <>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold">Creative brief</h2>
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <Lock className="h-3 w-3" /> author-only
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Optional scaffolding for yourself and any co-authors. Never shown to readers.
          </p>
        </>
      )}

      <FieldRow
            label="Scope"
            hint="Roughly how long are you thinking?"
          >
            <ScopeBandPicker
              scope={draft.scope}
              onChange={(scope) => updateAndSave({ scope })}
            />
          </FieldRow>

          <FieldRow label="Genre" hint="Where would this sit on a shelf?">
            <div className="flex flex-wrap gap-2 mb-3">
              {GENRE_SUGGESTIONS.map((g) => {
                const active = draft.genre === g;
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => updateAndSave({ genre: active ? "" : g })}
                    className={`rounded-full border px-3 py-1 text-sm transition ${
                      active
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-background hover:border-foreground/40"
                    }`}
                  >
                    {g}
                  </button>
                );
              })}
            </div>
            <Input
              value={GENRE_SUGGESTIONS.includes(draft.genre ?? "") ? "" : (draft.genre ?? "")}
              onChange={(e) => setDraft((prev) => ({ ...prev, genre: e.target.value }))}
              onBlur={() => void doSave(draft)}
              placeholder="Or type your own…"
            />
          </FieldRow>

          <FieldRow label="Audience" hint="Who is this book for?">
            <Input
              value={draft.audience ?? ""}
              onChange={(e) => setDraft((prev) => ({ ...prev, audience: e.target.value }))}
              onBlur={() => void doSave(draft)}
              placeholder="e.g. anyone who's moved cities in their 30s"
            />
          </FieldRow>

          <FieldRow label="Idea" hint="What is the book about? A rough idea is fine.">
            <Textarea
              value={draft.idea ?? ""}
              onChange={(e) => setDraft((prev) => ({ ...prev, idea: e.target.value }))}
              onBlur={() => { void doSave(draft); void bootstrapLoglineFromBrief(bookId, draft.idea); }}
              placeholder="A translator returns home for a funeral and gets stuck…"
              rows={3}
            />
          </FieldRow>

          <FieldRow label="Tone" hint="Pick a few — or write your own.">
            <div className="flex flex-wrap gap-2">
              {TONE_SUGGESTIONS.map((t) => {
                const active = (draft.tone ?? []).includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleTone(t)}
                    className={`rounded-full border px-3 py-1 text-sm transition ${
                      active
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-background hover:border-foreground/40"
                    }`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
            <Input
              className="mt-3"
              placeholder="Add a custom tone and press Enter"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const value = e.currentTarget.value.trim();
                  if (!value) return;
                  const current = draft.tone ?? [];
                  if (!current.includes(value)) updateAndSave({ tone: [...current, value] });
                  e.currentTarget.value = "";
                }
              }}
            />
          </FieldRow>

          <FieldRow
            label="Success criteria"
            hint="How will you know this book is done?"
          >
            <Textarea
              value={draft.success_criteria ?? ""}
              onChange={(e) => setDraft((prev) => ({ ...prev, success_criteria: e.target.value }))}
              onBlur={() => void doSave(draft)}
              placeholder="I publish it on Substack. I'm proud of every chapter."
              rows={2}
            />
          </FieldRow>

          <div className="flex items-center justify-between pt-2 border-t">
            <span className="text-xs text-muted-foreground">
              {completion} of {total} filled
            </span>
            <div className="flex items-center gap-3">
              {saving && <span className="text-xs text-muted-foreground">saving…</span>}
              {!saving && showSaved && <span className="text-xs text-muted-foreground">saved</span>}
              {embedded && onSaved && (
                <Button variant="outline" size="sm" onClick={onSaved}>Done</Button>
              )}
            </div>
          </div>
    </>
  );

  return embedded ? (
    <div className="space-y-6">{content}</div>
  ) : (
    <Card className="p-6 space-y-6">{content}</Card>
  );
}

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{label}</Label>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <div>{children}</div>
    </div>
  );
}
