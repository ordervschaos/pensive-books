import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Brief,
  GENRE_SUGGESTIONS,
  mergeBrief,
  SCOPE_BANDS,
  TONE_SUGGESTIONS,
} from "@/lib/brief";

const STEPS = [
  "scope",
  "genre",
  "audience",
  "premise",
  "tone",
  "success",
] as const;

type StepKey = (typeof STEPS)[number];

interface BriefIntakeSheetProps {
  bookId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFinish: (brief: Brief) => void;
}

export function BriefIntakeSheet({ bookId, open, onOpenChange, onFinish }: BriefIntakeSheetProps) {
  const { toast } = useToast();
  const [stepIndex, setStepIndex] = useState(0);
  const [brief, setBrief] = useState<Brief>({});
  const [persisting, setPersisting] = useState(false);

  const step: StepKey = STEPS[stepIndex];

  const persist = async (next: Brief): Promise<boolean> => {
    try {
      setPersisting(true);
      const merged = mergeBrief(brief, next);
      const { error } = await supabase
        .from("books")
        .update({ brief: merged })
        .eq("id", bookId);
      if (error) throw error;
      setBrief(merged);
      return true;
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Couldn't save",
        description: error instanceof Error ? error.message : "Unknown error",
      });
      return false;
    } finally {
      setPersisting(false);
    }
  };

  const advance = async (patch: Partial<Brief>) => {
    const ok = await persist(patch);
    if (!ok) return;
    if (stepIndex + 1 >= STEPS.length) {
      const finalBrief = mergeBrief(brief, patch);
      onFinish(finalBrief);
      onOpenChange(false);
    } else {
      setStepIndex(stepIndex + 1);
    }
  };

  const skip = () => {
    if (stepIndex + 1 >= STEPS.length) {
      onFinish(brief);
      onOpenChange(false);
    } else {
      setStepIndex(stepIndex + 1);
    }
  };

  const toggleTone = (t: string) => {
    const current = brief.tone ?? [];
    const next = current.includes(t) ? current.filter((x) => x !== t) : [...current, t];
    setBrief((prev) => ({ ...prev, tone: next }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Set your intention</DialogTitle>
          <DialogDescription>
            A quick scaffolding for yourself — never shown to readers. Skip anything that
            doesn't feel ready yet; you can edit it all later.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-1.5 pt-1">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full ${
                i < stepIndex
                  ? "bg-foreground"
                  : i === stepIndex
                    ? "bg-foreground/60"
                    : "bg-border"
              }`}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Step {stepIndex + 1} of {STEPS.length}
        </p>

        <div className="min-h-[200px] py-2">
          {step === "scope" && (
            <Step title="Roughly how long?" hint="Pick a band — refine later if you like.">
              <div className="flex flex-wrap gap-2">
                {SCOPE_BANDS.map((b) => {
                  const active = brief.scope?.band === b.value;
                  return (
                    <button
                      key={b.value}
                      type="button"
                      onClick={() =>
                        setBrief((prev) => ({
                          ...prev,
                          scope: {
                            band: b.value,
                            word_target: b.value === "custom" ? prev.scope?.word_target : b.words,
                          },
                        }))
                      }
                      className={`rounded-full border px-3 py-1.5 text-sm transition ${
                        active
                          ? "border-foreground bg-foreground text-background"
                          : "border-border hover:border-foreground/40"
                      }`}
                    >
                      {b.label}
                      <span className="ml-1.5 text-xs opacity-70">{b.hint}</span>
                    </button>
                  );
                })}
              </div>
              {brief.scope?.band === "custom" && (
                <Input
                  type="number"
                  min={0}
                  className="mt-3 max-w-xs"
                  placeholder="Target word count"
                  value={brief.scope?.word_target ?? ""}
                  onChange={(e) =>
                    setBrief((prev) => ({
                      ...prev,
                      scope: {
                        ...(prev.scope ?? {}),
                        band: "custom",
                        word_target: e.target.value ? Number(e.target.value) : undefined,
                      },
                    }))
                  }
                />
              )}
            </Step>
          )}

          {step === "genre" && (
            <Step title="Where does it sit on a shelf?" hint="Pick a starting point, or type your own.">
              <div className="flex flex-wrap gap-2 mb-3">
                {GENRE_SUGGESTIONS.map((g) => {
                  const active = brief.genre === g;
                  return (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setBrief((prev) => ({ ...prev, genre: active ? "" : g }))}
                      className={`rounded-full border px-3 py-1 text-sm transition ${
                        active
                          ? "border-foreground bg-foreground text-background"
                          : "border-border hover:border-foreground/40"
                      }`}
                    >
                      {g}
                    </button>
                  );
                })}
              </div>
              <Input
                value={brief.genre ?? ""}
                onChange={(e) => setBrief((prev) => ({ ...prev, genre: e.target.value }))}
                placeholder="Or type your own…"
              />
            </Step>
          )}

          {step === "audience" && (
            <Step title="Who is this book for?" hint="One line is plenty.">
              <Input
                autoFocus
                value={brief.audience ?? ""}
                onChange={(e) => setBrief((prev) => ({ ...prev, audience: e.target.value }))}
                placeholder="e.g. anyone who's moved cities in their 30s"
              />
            </Step>
          )}

          {step === "premise" && (
            <Step title="What is the book about?" hint="One or two sentences.">
              <Textarea
                autoFocus
                rows={3}
                value={brief.premise ?? ""}
                onChange={(e) => setBrief((prev) => ({ ...prev, premise: e.target.value }))}
                placeholder="A translator returns home for a funeral and gets stuck…"
              />
            </Step>
          )}

          {step === "tone" && (
            <Step title="What's the voice?" hint="Pick a few, add your own.">
              <div className="flex flex-wrap gap-2">
                {TONE_SUGGESTIONS.map((t) => {
                  const active = (brief.tone ?? []).includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleTone(t)}
                      className={`rounded-full border px-3 py-1 text-sm transition ${
                        active
                          ? "border-foreground bg-foreground text-background"
                          : "border-border hover:border-foreground/40"
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
                    const current = brief.tone ?? [];
                    if (!current.includes(value)) {
                      setBrief((prev) => ({ ...prev, tone: [...current, value] }));
                    }
                    e.currentTarget.value = "";
                  }
                }}
              />
            </Step>
          )}

          {step === "success" && (
            <Step
              title="What does done look like?"
              hint="Your own definition. It can be anything."
            >
              <Textarea
                autoFocus
                rows={3}
                value={brief.success_criteria ?? ""}
                onChange={(e) =>
                  setBrief((prev) => ({ ...prev, success_criteria: e.target.value }))
                }
                placeholder="I publish it on Substack. I'm proud of every chapter."
              />
            </Step>
          )}
        </div>

        <div className="flex items-center justify-between pt-2 border-t">
          <Button variant="ghost" onClick={skip} disabled={persisting}>
            Skip this
          </Button>
          <Button onClick={() => advance(brief)} disabled={persisting}>
            {stepIndex + 1 === STEPS.length ? "Finish" : "Next →"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Step({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-lg font-medium">{title}</h3>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      <div>{children}</div>
    </div>
  );
}
