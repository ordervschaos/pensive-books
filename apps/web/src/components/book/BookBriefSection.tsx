import { useState } from "react";
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

interface BookBriefSectionProps {
  bookId: number;
  brief: Brief | null;
  onBriefChange: (brief: Brief) => void;
}

export function BookBriefSection({ bookId, brief, onBriefChange }: BookBriefSectionProps) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Brief>(brief ?? {});
  const [saving, setSaving] = useState(false);
  const completion = computeCompletion(draft);
  const total = BRIEF_FIELDS.length;

  const updateDraft = (patch: Partial<Brief>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const next = mergeBrief(brief, draft);
      const { error } = await supabase
        .from("books")
        .update({ brief: next })
        .eq("id", bookId);
      if (error) throw error;
      onBriefChange(next);
      setDraft(next);
      toast({ title: "Brief saved", description: "Your intentions are tucked away." });
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

  const toggleTone = (t: string) => {
    const current = draft.tone ?? [];
    const next = current.includes(t) ? current.filter((x) => x !== t) : [...current, t];
    updateDraft({ tone: next });
  };

  return (
    <Card className="p-6 space-y-6">
      <div className="flex items-center gap-2">
        <h2 className="text-xl font-semibold">Creative brief</h2>
        <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
          <Lock className="h-3 w-3" /> author-only
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        Optional scaffolding for yourself and any co-authors. Never shown to readers.
      </p>

      <FieldRow
            label="Scope"
            hint="Roughly how long are you thinking?"
          >
            <ScopeBandPicker
              scope={draft.scope}
              onChange={(scope) => updateDraft({ scope })}
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
                    onClick={() => updateDraft({ genre: active ? "" : g })}
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
              value={draft.genre ?? ""}
              onChange={(e) => updateDraft({ genre: e.target.value })}
              placeholder="Or type your own…"
            />
          </FieldRow>

          <FieldRow label="Audience" hint="Who is this book for?">
            <Input
              value={draft.audience ?? ""}
              onChange={(e) => updateDraft({ audience: e.target.value })}
              placeholder="e.g. anyone who's moved cities in their 30s"
            />
          </FieldRow>

          <FieldRow label="Premise" hint="What is the book about, in 1–2 sentences?">
            <Textarea
              value={draft.premise ?? ""}
              onChange={(e) => updateDraft({ premise: e.target.value })}
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
                  if (!current.includes(value)) updateDraft({ tone: [...current, value] });
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
              onChange={(e) => updateDraft({ success_criteria: e.target.value })}
              placeholder="I publish it on Substack. I'm proud of every chapter."
              rows={2}
            />
          </FieldRow>

          <div className="flex items-center justify-between pt-2 border-t">
            <span className="text-xs text-muted-foreground">
              {completion} of {total} filled
            </span>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save brief"}
            </Button>
          </div>
    </Card>
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
