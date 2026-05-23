import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

export type ThemeMode = "light" | "dark";
export type ThemeId = "aurora" | "ocean" | "sunset" | "forest" | "neon" | "wanted";

export type ThemeOption = {
  id: ThemeId;
  label: string;
  fontLabel: string;
};

const THEME_OPTIONS: ThemeOption[] = [
  { id: "aurora", label: "Aurora", fontLabel: "Lato" },
  { id: "ocean", label: "Ocean", fontLabel: "Roboto" },
  { id: "sunset", label: "Sunset", fontLabel: "Poppins" },
  { id: "forest", label: "Forest", fontLabel: "Open Sans" },
  { id: "neon", label: "Neon", fontLabel: "Inter" },
  { id: "wanted", label: "Wanted", fontLabel: "Wanted Sans" },
];

const STORAGE_THEME_KEY = "music-player.theme";
const STORAGE_MODE_KEY = "music-player.theme-mode";

type ThemeContextValue = {
  theme: ThemeId;
  mode: ThemeMode;
  setTheme: (theme: ThemeId) => void;
  setMode: (mode: ThemeMode) => void;
  themeOptions: ThemeOption[];
};

const ThemeCtx = createContext<ThemeContextValue | null>(null);

function isThemeId(v: string): v is ThemeId {
  return THEME_OPTIONS.some((t) => t.id === v);
}

function isThemeMode(v: string): v is ThemeMode {
  return v === "light" || v === "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }): ReactElement {
  const [theme, setTheme] = useState<ThemeId>(() => {
    const saved = localStorage.getItem(STORAGE_THEME_KEY);
    return saved && isThemeId(saved) ? saved : "aurora";
  });
  const [mode, setMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(STORAGE_MODE_KEY);
    return saved && isThemeMode(saved) ? saved : "dark";
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_THEME_KEY, theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(STORAGE_MODE_KEY, mode);
    document.documentElement.dataset.mode = mode;
    document.documentElement.style.colorScheme = mode;
  }, [mode]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      mode,
      setTheme,
      setMode,
      themeOptions: THEME_OPTIONS,
    }),
    [theme, mode]
  );

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
