import { Input } from "@/components/ui/input";
import { BriefHeat, HeatLevel, HEAT_LEVELS } from "@/lib/brief";

interface HeatLevelPickerProps {
  heat: BriefHeat | undefined;
  onChange: (heat: BriefHeat) => void;
}

export function HeatLevelPicker({ heat, onChange }: HeatLevelPickerProps) {
  const selectLevel = (level: HeatLevel) =>
    onChange({ level, note: heat?.note });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {HEAT_LEVELS.map((h) => {
          const active = heat?.level === h.value;
          return (
            <button
              key={h.value}
              type="button"
              onClick={() => selectLevel(h.value)}
              className={`rounded-full border px-3 py-1.5 text-sm transition ${
                active
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-foreground hover:border-foreground/40"
              }`}
            >
              {h.label}
              <span className="ml-1.5 text-xs opacity-70">{h.description}</span>
            </button>
          );
        })}
      </div>

      <Input
        value={heat?.note ?? ""}
        onChange={(e) =>
          onChange({ level: heat?.level, note: e.target.value || undefined })
        }
        placeholder="Optional caveat — e.g. no violence, fade on non-consensual scenes"
      />
    </div>
  );
}
