
"use client"

import { createContext, useContext, useEffect, useState } from "react"

type ThemeName = "default" | "paper" | "coffee" | "mujiyish" | "pumpkin"
type ThemeMode = "light" | "dark"

function isSharedProductionDomain(): boolean {
  return (
    typeof window !== "undefined" &&
    (window.location.hostname === "pensive.me" ||
      window.location.hostname.endsWith(".pensive.me"))
  )
}

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

function setCookie(name: string, value: string) {
  const domain = isSharedProductionDomain() ? "; domain=.pensive.me" : ""
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; SameSite=Lax; max-age=31536000${domain}`
}

function readTheme(key: string): string | null {
  return getCookie(key) ?? localStorage.getItem(key)
}

function writeTheme(key: string, value: string) {
  setCookie(key, value)
  localStorage.setItem(key, value)
}

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

  // Get initial theme and mode from cookie/localStorage or defaults
  const getInitialTheme = (): ThemeName => {
    if (typeof window !== 'undefined') {
      const savedTheme = readTheme('themeName') as ThemeName
      if (savedTheme) return savedTheme
    }
    return defaultTheme
  }

  const getInitialMode = (): ThemeMode => {
    if (typeof window !== 'undefined') {
      const savedMode = readTheme('themeMode') as ThemeMode
      if (savedMode) return savedMode
    }
    return defaultMode || getSystemMode()
  }

  const [themeName, setThemeNameState] = useState<ThemeName>(getInitialTheme)
  const [themeMode, setThemeModeState] = useState<ThemeMode>(getInitialMode)

  // Listen for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => {
      if (!readTheme('themeMode')) {
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
    root.classList.remove("light", "dark", "theme-default", "theme-paper", "theme-coffee", "theme-mujiyish", "theme-pumpkin")

    // Add theme name class (only if not default)
    if (themeName !== "default") {
      root.classList.add(`theme-${themeName}`)
    }

    // Add theme mode class
    root.classList.add(themeMode)

    // Save preferences to cookie (shared across subdomains) and localStorage
    writeTheme('themeName', themeName)
    writeTheme('themeMode', themeMode)
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
