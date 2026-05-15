"use client";

import { Coffee, Flame, Moon, Package, Palette, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type ThemeName = "default" | "coffee" | "mujiyish" | "pumpkin";
type ThemeMode = "light" | "dark";

const THEME_KEY = "themeName";
const MODE_KEY = "themeMode";

const themes = [
  { name: "default" as const, label: "Default", Icon: Palette },
  { name: "coffee" as const, label: "Coffee", Icon: Coffee },
  { name: "mujiyish" as const, label: "Mujiyish", Icon: Package },
  { name: "pumpkin" as const, label: "Charcoal", Icon: Flame },
];

function applyTheme(themeName: ThemeName, themeMode: ThemeMode) {
  const root = document.documentElement;

  root.classList.remove(
    "light",
    "dark",
    "theme-default",
    "theme-coffee",
    "theme-mujiyish",
    "theme-pumpkin",
  );

  if (themeName !== "default") {
    root.classList.add(`theme-${themeName}`);
  }

  root.classList.add(themeMode);
}

export function PublicThemeMenu() {
  const [open, setOpen] = useState(false);
  const [themeName, setThemeName] = useState<ThemeName>("coffee");
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    const storedTheme = (window.localStorage.getItem(THEME_KEY) as ThemeName | null) ?? "coffee";
    const storedMode =
      (window.localStorage.getItem(MODE_KEY) as ThemeMode | null) ??
      (root.classList.contains("dark") ? "dark" : "light");

    setThemeName(storedTheme);
    setThemeMode(storedMode);
    applyTheme(storedTheme, storedMode);
  }, []);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  function updateTheme(nextThemeName: ThemeName, nextThemeMode: ThemeMode) {
    applyTheme(nextThemeName, nextThemeMode);
    window.localStorage.setItem(THEME_KEY, nextThemeName);
    window.localStorage.setItem(MODE_KEY, nextThemeMode);
    setThemeName(nextThemeName);
    setThemeMode(nextThemeMode);
  }

  const TriggerIcon = themeMode === "light" ? Sun : Moon;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Toggle theme"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-input bg-background text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <TriggerIcon className="h-5 w-5" />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-48 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          <div className="px-2 py-1.5 text-sm font-semibold">Theme</div>
          {themes.map(({ name, label, Icon }) => (
            <button
              key={name}
              type="button"
              onClick={() => updateTheme(name, themeMode)}
              className={`flex w-full items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground ${
                themeName === name ? "bg-accent" : ""
              }`}
            >
              <Icon className="mr-2 h-4 w-4" />
              {label}
            </button>
          ))}

          <div className="my-1 h-px bg-border" />

          <div className="px-2 py-1.5 text-sm font-semibold">Mode</div>
          <button
            type="button"
            onClick={() => updateTheme(themeName, "light")}
            className={`flex w-full items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground ${
              themeMode === "light" ? "bg-accent" : ""
            }`}
          >
            <Sun className="mr-2 h-4 w-4" />
            Light
          </button>
          <button
            type="button"
            onClick={() => updateTheme(themeName, "dark")}
            className={`flex w-full items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground ${
              themeMode === "dark" ? "bg-accent" : ""
            }`}
          >
            <Moon className="mr-2 h-4 w-4" />
            Dark
          </button>
        </div>
      )}
    </div>
  );
}
