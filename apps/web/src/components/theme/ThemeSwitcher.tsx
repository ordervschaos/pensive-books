import { useTheme } from "./ThemeProvider"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Moon, Sun, Coffee, Palette, Package, Flame } from "lucide-react"

export function ThemeSwitcher() {
  const { themeName, themeMode, setThemeName, setThemeMode } = useTheme()

  const themes = [
    { name: "default" as const, label: "Default", icon: Palette },
    { name: "coffee" as const, label: "Coffee", icon: Coffee },
    { name: "mujiyish" as const, label: "Mujiyish", icon: Package },
    { name: "pumpkin" as const, label: "Charcoal", icon: Flame },
  ]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon">
          {themeMode === "light" ? (
            <Sun className="h-[1.2rem] w-[1.2rem]" />
          ) : (
            <Moon className="h-[1.2rem] w-[1.2rem]" />
          )}
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        {themes.map((theme) => {
          const Icon = theme.icon
          return (
            <DropdownMenuItem
              key={theme.name}
              onClick={() => setThemeName(theme.name)}
              className={themeName === theme.name ? "bg-accent" : ""}
            >
              <Icon className="mr-2 h-4 w-4" />
              {theme.label}
            </DropdownMenuItem>
          )
        })}

        <DropdownMenuSeparator />

        <DropdownMenuLabel>Mode</DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() => setThemeMode("light")}
          className={themeMode === "light" ? "bg-accent" : ""}
        >
          <Sun className="mr-2 h-4 w-4" />
          Light
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setThemeMode("dark")}
          className={themeMode === "dark" ? "bg-accent" : ""}
        >
          <Moon className="mr-2 h-4 w-4" />
          Dark
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Simple toggle button (just for mode)
export function ThemeModeToggle() {
  const { themeMode, toggleMode } = useTheme()

  return (
    <Button variant="outline" size="icon" onClick={toggleMode}>
      {themeMode === "light" ? (
        <Sun className="h-[1.2rem] w-[1.2rem]" />
      ) : (
        <Moon className="h-[1.2rem] w-[1.2rem]" />
      )}
      <span className="sr-only">Toggle theme mode</span>
    </Button>
  )
}
