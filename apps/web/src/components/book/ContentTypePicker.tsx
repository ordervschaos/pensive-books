import { Input } from "@/components/ui/input";
import { ContentType, ContentLevel, CONTENT_TYPES } from "@/lib/brief";

interface ContentTypePickerProps {
  value: ContentType | undefined;
  onChange: (value: ContentType) => void;
}

export function ContentTypePicker({ value, onChange }: ContentTypePickerProps) {
  const selectLevel = (level: ContentLevel) =>
    onChange({ level, note: value?.note });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {CONTENT_TYPES.map((c) => {
          const active = value?.level === c.value;
          return (
            <button
              key={c.value}
              type="button"
              onClick={() => selectLevel(c.value)}
              className={`rounded-full border px-3 py-1.5 text-sm transition ${
                active
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-foreground hover:border-foreground/40"
              }`}
            >
              {c.label}
              <span className="ml-1.5 text-xs opacity-70">{c.description}</span>
            </button>
          );
        })}
      </div>

      <Input
        value={value?.note ?? ""}
        onChange={(e) =>
          onChange({ level: value?.level, note: e.target.value || undefined })
        }
        placeholder="Optional caveat — e.g. no violence, fade on non-consensual scenes"
      />
    </div>
  );
}
