import { CheckCircle2, AlertTriangle, XCircle, Loader2 } from "lucide-react";
import type { ConformanceReport, Verdict } from "@/lib/mandateGate";

// Renders the conformance backstop's per-axis report: how well the finished draft delivers the
// brief's MANDATE (length, heat, genre, success). It informs — it does not block.

const AXIS_LABEL: Record<string, string> = {
  length: "Length",
  heat: "Heat",
  genre: "Genre",
  success: "Success criteria",
};

const VERDICT_STYLE: Record<Verdict, { icon: typeof CheckCircle2; cls: string; word: string }> = {
  pass: { icon: CheckCircle2, cls: "text-[hsl(var(--pv-accent))]", word: "On brief" },
  partial: { icon: AlertTriangle, cls: "text-amber-600 dark:text-amber-500", word: "Partial" },
  fail: { icon: XCircle, cls: "text-destructive", word: "Off brief" },
};

function VerdictGlyph({ verdict, className }: { verdict: Verdict; className?: string }) {
  const { icon: Icon, cls } = VERDICT_STYLE[verdict];
  return <Icon className={`${cls} ${className ?? ""}`} />;
}

export function MandateReportCard({
  report,
  loading,
  error,
}: {
  report: ConformanceReport | null;
  loading?: boolean;
  error?: string | null;
}) {
  if (loading) {
    return (
      <div className="mt-3 flex items-center gap-3 rounded-xl border border-border px-5 py-4">
        <Loader2 className="h-4 w-4 animate-spin text-[hsl(var(--pv-text-faint))]" />
        <span className="pv-serif text-[14px] italic text-[hsl(var(--pv-text-faint))]">
          Checking the draft against your brief…
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-3 rounded-xl border border-border px-5 py-4">
        <span className="pv-serif text-[14px] italic text-[hsl(var(--pv-text-faint))]">
          Couldn't check the draft against your brief: {error}
        </span>
      </div>
    );
  }

  if (!report) return null;

  const headline = VERDICT_STYLE[report.overall];

  return (
    <div className="mt-3 rounded-xl border border-border px-5 py-4">
      <div className="flex items-center gap-2.5">
        <VerdictGlyph verdict={report.overall} className="h-[18px] w-[18px]" />
        <span className="pv-serif text-[16px] leading-snug text-foreground">
          {report.overall === "pass"
            ? "The draft delivers on your brief."
            : report.overall === "partial"
              ? "The draft mostly delivers — a few gaps against your brief."
              : "The draft falls short of your brief."}
        </span>
        <span className={`pv-serif ml-auto text-[13px] ${headline.cls}`}>{headline.word}</span>
      </div>

      <ul className="mt-3 space-y-2.5">
        {report.axes.map((a) => (
          <li key={a.axis} className="flex gap-2.5">
            <VerdictGlyph verdict={a.verdict} className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="pv-serif block text-[14px] leading-snug text-foreground">
                <span className="font-medium">{AXIS_LABEL[a.axis] ?? a.axis}.</span> {a.detail}
              </span>
              {a.evidence && (
                <span className="pv-serif block text-[12.5px] italic leading-snug text-[hsl(var(--pv-text-faint))]">
                  {a.evidence}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>

      <p className="pv-serif mt-3 text-[12.5px] italic text-[hsl(var(--pv-text-faint))]">
        A check against your brief — informational, not a gate. Revise or regenerate where it flags gaps.
      </p>
    </div>
  );
}
