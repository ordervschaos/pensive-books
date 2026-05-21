"use client";

import { Palette, Sun, Moon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { THEME_NAME_KEY, THEME_MODE_KEY, readThemeValue, writeThemeValue } from "@/lib/theme";

type ThemeName = "paper" | "coffee" | "pumpkin";
type ThemeMode = "light" | "dark";

const VALID_THEME_NAMES: ReadonlyArray<ThemeName> = ["paper", "coffee", "pumpkin"];

function normalizeThemeName(value: string | null | undefined): ThemeName {
  if (value && (VALID_THEME_NAMES as ReadonlyArray<string>).includes(value)) {
    return value as ThemeName;
  }
  return "paper";
}

const SWATCHES: { name: ThemeName; label: string; bg: string }[] = [
  { name: "paper",   label: "Paper",   bg: "#f0e8d5" },
  { name: "coffee",  label: "Coffee",  bg: "#5c3d2e" },
  { name: "pumpkin", label: "Charcoal", bg: "#131e28" },
];

function applyTheme(themeName: ThemeName, themeMode: ThemeMode) {
  const root = document.documentElement;
  root.classList.remove("light", "dark", "theme-default", "theme-paper", "theme-coffee", "theme-mujiyish", "theme-pumpkin");
  root.classList.add(`theme-${themeName}`);
  root.classList.add(themeMode);
}

export function PublicAppearanceMenu() {
  const [open, setOpen] = useState(false);
  const [themeName, setThemeName] = useState<ThemeName>("paper");
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    const storedTheme = normalizeThemeName(readThemeValue(THEME_NAME_KEY, "paper"));
    const storedMode = (readThemeValue(THEME_MODE_KEY, "") || (root.classList.contains("dark") ? "dark" : "light")) as ThemeMode;
    setThemeName(storedTheme);
    setThemeMode(storedMode);
    applyTheme(storedTheme, storedMode);
  }, []);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  function updateTheme(nextName: ThemeName, nextMode: ThemeMode) {
    applyTheme(nextName, nextMode);
    writeThemeValue(THEME_NAME_KEY, nextName);
    writeThemeValue(THEME_MODE_KEY, nextMode);
    setThemeName(nextName);
    setThemeMode(nextMode);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Appearance settings"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <Palette className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[220px] rounded-md border bg-popover p-3 text-popover-foreground shadow-md">
          {/* Theme */}
          <p className="mb-3 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Theme
          </p>
          <div className="flex gap-4 px-1">
            {SWATCHES.map(({ name, label, bg }) => {
              const selected = themeName === name;
              return (
                <button
                  key={name}
                  type="button"
                  aria-label={`${label} theme`}
                  aria-pressed={selected}
                  onClick={() => updateTheme(name, themeMode)}
                  className="flex flex-col items-center gap-1.5"
                >
                  <span
                    className={`block h-7 w-7 rounded-full transition-all duration-150 ${
                      selected
                        ? "ring-2 ring-foreground ring-offset-2 ring-offset-popover"
                        : "ring-1 ring-inset ring-border/60 hover:ring-border"
                    }`}
                    style={{ background: bg }}
                  />
                  <span className={`text-[11px] leading-none ${selected ? "font-medium text-foreground" : "text-muted-foreground"}`}>
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
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Mode
            </p>
            <div className="flex items-center rounded-full border border-border bg-background p-0.5">
              <button
                type="button"
                aria-pressed={themeMode === "light"}
                onClick={() => updateTheme(themeName, "light")}
                className={`flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] transition-colors duration-150 ${
                  themeMode === "light"
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Sun className="h-3 w-3" />
                Light
              </button>
              <button
                type="button"
                aria-pressed={themeMode === "dark"}
                onClick={() => updateTheme(themeName, "dark")}
                className={`flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] transition-colors duration-150 ${
                  themeMode === "dark"
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Moon className="h-3 w-3" />
                Dark
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
