import { useTheme } from "./ThemeProvider"
import { IconButton } from "@pensive/shared/ui/icon-button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Moon, Sun, Coffee, Flame, BookOpen, Check } from "lucide-react"

export function ThemeSwitcher() {
  const { themeName, themeMode, setThemeName, setThemeMode } = useTheme()

  const themes = [
    { name: "paper" as const, label: "Paper", icon: BookOpen },
    { name: "coffee" as const, label: "Coffee", icon: Coffee },
    { name: "pumpkin" as const, label: "Charcoal", icon: Flame },
  ]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton aria-label="Toggle theme">
          {themeMode === "light" ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[10rem]">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        {themes.map((theme) => {
          const Icon = theme.icon
          const selected = themeName === theme.name
          return (
            <DropdownMenuItem
              key={theme.name}
              onClick={() => setThemeName(theme.name)}
              aria-checked={selected}
              role="menuitemradio"
            >
              <Icon className="mr-2 h-4 w-4" />
              <span className={selected ? "font-medium" : undefined}>{theme.label}</span>
              {selected && <Check className="ml-auto h-4 w-4" />}
            </DropdownMenuItem>
          )
        })}

        <DropdownMenuSeparator />

        <DropdownMenuLabel>Mode</DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() => setThemeMode("light")}
          aria-checked={themeMode === "light"}
          role="menuitemradio"
        >
          <Sun className="mr-2 h-4 w-4" />
          <span className={themeMode === "light" ? "font-medium" : undefined}>Light</span>
          {themeMode === "light" && <Check className="ml-auto h-4 w-4" />}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setThemeMode("dark")}
          aria-checked={themeMode === "dark"}
          role="menuitemradio"
        >
          <Moon className="mr-2 h-4 w-4" />
          <span className={themeMode === "dark" ? "font-medium" : undefined}>Dark</span>
          {themeMode === "dark" && <Check className="ml-auto h-4 w-4" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Simple toggle button (just for mode)
export function ThemeModeToggle() {
  const { themeMode, toggleMode } = useTheme()

  return (
    <IconButton aria-label="Toggle theme mode" onClick={toggleMode}>
      {themeMode === "light" ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
    </IconButton>
  )
}
