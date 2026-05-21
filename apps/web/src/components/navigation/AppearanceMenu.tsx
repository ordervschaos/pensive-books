import { Palette, Sun, Moon } from "lucide-react";
import { IconButton } from "@pensive/shared/ui/icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/components/theme/ThemeProvider";
import { cn } from "@/lib/utils";

// Static colors that visually represent each theme at a glance.
// These are fixed preview swatches, independent of the active theme.
const SWATCHES = [
  { name: "paper"   as const, label: "Paper",   bg: "#f0e8d5", ring: "#1f1d18" },
  { name: "coffee"  as const, label: "Coffee",  bg: "#5c3d2e", ring: "#efe2cf" },
  { name: "pumpkin" as const, label: "Charcoal", bg: "#131e28", ring: "#f5efe5" },
] as const;

export function AppearanceMenu() {
  const { themeName, themeMode, setThemeName, setThemeMode } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton aria-label="Appearance settings" className="border-none">
          <Palette className="h-4 w-4" />
        </IconButton>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[220px] p-3" onCloseAutoFocus={(e) => e.preventDefault()}>
        {/* Theme */}
        <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground font-mono mb-3">
          Theme
        </p>
        <div className="flex gap-4 justify-start px-1 mb-1">
          {SWATCHES.map(({ name, label, bg }) => {
            const selected = themeName === name;
            return (
              <button
                key={name}
                onClick={() => setThemeName(name)}
                className="flex flex-col items-center gap-1.5 cursor-pointer group"
                aria-label={`${label} theme`}
                aria-pressed={selected}
              >
                <span
                  className={cn(
                    "block w-7 h-7 rounded-full transition-all duration-150",
                    selected
                      ? "ring-2 ring-offset-2 ring-offset-popover ring-foreground"
                      : "ring-1 ring-inset ring-border/60 group-hover:ring-border"
                  )}
                  style={{ background: bg }}
                />
                <span
                  className={cn(
                    "text-[11px] leading-none",
                    selected ? "text-foreground font-medium" : "text-muted-foreground"
                  )}
                >
                  {label}
                </span>
              </button>
            );
          })}
        </div>

        {/* Divider */}
        <div className="my-3 h-px bg-border" />

        {/* Mode */}
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground font-mono">
            Mode
          </p>
          <div className="flex items-center rounded-full border border-border p-0.5 bg-background">
            <button
              onClick={() => setThemeMode("light")}
              aria-pressed={themeMode === "light"}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] transition-colors duration-150 cursor-pointer",
                themeMode === "light"
                  ? "bg-muted text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Sun className="h-3 w-3" />
              Light
            </button>
            <button
              onClick={() => setThemeMode("dark")}
              aria-pressed={themeMode === "dark"}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] transition-colors duration-150 cursor-pointer",
                themeMode === "dark"
                  ? "bg-muted text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Moon className="h-3 w-3" />
              Dark
            </button>
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
