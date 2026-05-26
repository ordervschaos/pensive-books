import { Input } from "@/components/ui/input";
import {
  BriefScope,
  BriefScopeBand,
  SCOPE_BANDS,
  SCOPE_GROUPS,
} from "@/lib/brief";

interface ScopeBandPickerProps {
  scope: BriefScope | undefined;
  onChange: (scope: BriefScope) => void;
}

type Band = (typeof SCOPE_BANDS)[number];

const CUSTOM_BAND = SCOPE_BANDS.find((b) => b.value === "custom")!;

export function ScopeBandPicker({ scope, onChange }: ScopeBandPickerProps) {
  const selectBand = (value: BriefScopeBand, words?: number) =>
    onChange({
      band: value,
      word_target: value === "custom" ? scope?.word_target : words,
    });

  const renderBand = (b: Band) => {
    const active = scope?.band === b.value;
    return (
      <button
        key={b.value}
        type="button"
        onClick={() => selectBand(b.value, b.words)}
        className={`rounded-full border px-3 py-1.5 text-sm transition ${
          active
            ? "border-foreground bg-foreground text-background"
            : "border-border bg-background text-foreground hover:border-foreground/40"
        }`}
      >
        {b.label}
        <span className="ml-1.5 text-xs opacity-70">{b.hint}</span>
      </button>
    );
  };

  return (
    <div className="space-y-3">
      {SCOPE_GROUPS.map((group) => (
        <div key={group.kind} className="space-y-1.5">
          <span className="pv-eyebrow">{group.label}</span>
          <div className="flex flex-wrap gap-2">
            {SCOPE_BANDS.filter((b) => b.kind === group.kind).map(renderBand)}
          </div>
        </div>
      ))}

      <div className="flex flex-wrap gap-2">{renderBand(CUSTOM_BAND)}</div>

      {scope?.band === "custom" && (
        <Input
          type="number"
          min={0}
          placeholder="Target word count"
          value={scope?.word_target ?? ""}
          onChange={(e) =>
            onChange({
              band: "custom",
              word_target: e.target.value ? Number(e.target.value) : undefined,
            })
          }
          className="max-w-xs"
        />
      )}
    </div>
  );
}
