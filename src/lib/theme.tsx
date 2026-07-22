import { createContext, useContext, useEffect, useState } from "react"

type Theme = "dark" | "light"

interface ThemeContextType {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType>({ theme: "dark", toggleTheme: () => {} })

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("dbmanager-theme")
    return (saved as Theme) || "dark"
  })

  useEffect(() => {
    localStorage.setItem("dbmanager-theme", theme)
    document.documentElement.classList.toggle("dark", theme === "dark")
  }, [theme])

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme: () => setTheme(t => t === "dark" ? "light" : "dark") }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
