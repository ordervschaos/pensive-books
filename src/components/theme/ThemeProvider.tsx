
"use client"

import { createContext, useContext, useEffect, useState } from "react"

type ThemeName = "default" | "coffee" | "mujiyish"
type ThemeMode = "light" | "dark"

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: ThemeName
  defaultMode?: ThemeMode
}

type ThemeProviderState = {
  themeName: ThemeName
  themeMode: ThemeMode
  setThemeName: (name: ThemeName) => void
  setThemeMode: (mode: ThemeMode) => void
  toggleMode: () => void
}

const initialState: ThemeProviderState = {
  themeName: "default",
  themeMode: "light",
  setThemeName: () => null,
  setThemeMode: () => null,
  toggleMode: () => null,
}

const ThemeProviderContext = createContext<ThemeProviderState>(initialState)

export function ThemeProvider({
  children,
  defaultTheme = "default",
  defaultMode,
}: ThemeProviderProps) {
  // Get system preference for mode
  const getSystemMode = (): ThemeMode => {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark'
    }
    return 'light'
  }

  // Get initial theme and mode from localStorage or defaults
  const getInitialTheme = (): ThemeName => {
    if (typeof window !== 'undefined') {
      const savedTheme = localStorage.getItem('themeName') as ThemeName
      if (savedTheme) {
        return savedTheme
      }
    }
    return defaultTheme
  }

  const getInitialMode = (): ThemeMode => {
    if (typeof window !== 'undefined') {
      const savedMode = localStorage.getItem('themeMode') as ThemeMode
      if (savedMode) {
        return savedMode
      }
    }
    // Use defaultMode if provided, otherwise use system preference, otherwise use 'light'
    return defaultMode || getSystemMode()
  }

  const [themeName, setThemeNameState] = useState<ThemeName>(getInitialTheme)
  const [themeMode, setThemeModeState] = useState<ThemeMode>(getInitialMode)

  // Listen for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => {
      // Only update if there's no saved preference
      if (!localStorage.getItem('themeMode')) {
        setThemeModeState(getSystemMode())
      }
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  // Apply theme classes to document
  useEffect(() => {
    const root = window.document.documentElement

    // Remove all theme classes
    root.classList.remove("light", "dark", "theme-default", "theme-coffee", "theme-mujiyish")

    // Add theme name class (only if not default)
    if (themeName !== "default") {
      root.classList.add(`theme-${themeName}`)
    }

    // Add theme mode class
    root.classList.add(themeMode)

    // Save preferences to localStorage
    localStorage.setItem('themeName', themeName)
    localStorage.setItem('themeMode', themeMode)
  }, [themeName, themeMode])

  const setThemeName = (name: ThemeName) => {
    setThemeNameState(name)
  }

  const setThemeMode = (mode: ThemeMode) => {
    setThemeModeState(mode)
  }

  const toggleMode = () => {
    setThemeModeState(themeMode === "light" ? "dark" : "light")
  }

  return (
    <ThemeProviderContext.Provider
      value={{
        themeName,
        themeMode,
        setThemeName,
        setThemeMode,
        toggleMode,
      }}
    >
      {children}
    </ThemeProviderContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext)

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider")

  return context
}
