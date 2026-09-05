import { useEffect, useState } from "react";

const themeModes = ["light", "dark", "auto"] as const;
type ThemeMode = (typeof themeModes)[number];

function isThemeMode(value: string | null): value is ThemeMode {
  return themeModes.includes(value as ThemeMode);
}

function getInitialMode(): ThemeMode {
  if (typeof window === "undefined") {
    return "auto";
  }

  const stored = globalThis.localStorage.getItem("theme");
  if (isThemeMode(stored)) {
    return stored;
  }

  return "auto";
}

function applyThemeMode(mode: ThemeMode) {
  const isPrefersDark = globalThis.matchMedia(
    "(prefers-color-scheme: dark)",
  ).matches;
  const systemTheme = isPrefersDark ? "dark" : "light";
  const resolved = mode === "auto" ? systemTheme : mode;

  document.documentElement.classList.remove("light", "dark");
  document.documentElement.classList.add(resolved);

  if (mode === "auto") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = mode;
  }

  document.documentElement.style.colorScheme = resolved;
}

const modeLabels: Record<ThemeMode, string> = {
  auto: "Auto",
  dark: "Dark",
  light: "Light",
};

export default function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>("auto");

  useEffect(() => {
    const initialMode = getInitialMode();
    setMode(initialMode);
    applyThemeMode(initialMode);
  }, []);

  useEffect(() => {
    if (mode !== "auto") {
      return;
    }

    const media = globalThis.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      applyThemeMode("auto");
    };

    media.addEventListener("change", onChange);
    return () => {
      media.removeEventListener("change", onChange);
    };
  }, [mode]);

  function toggleMode() {
    const nextByMode: Record<ThemeMode, ThemeMode> = {
      light: "dark",
      dark: "auto",
      auto: "light",
    };
    const nextMode = nextByMode[mode];
    setMode(nextMode);
    applyThemeMode(nextMode);
    globalThis.localStorage.setItem("theme", nextMode);
  }

  const label =
    mode === "auto"
      ? "Theme mode: auto (system). Click to switch to light mode."
      : `Theme mode: ${mode}. Click to switch mode.`;

  return (
    <button
      type="button"
      onClick={toggleMode}
      aria-label={label}
      title={label}
      className="rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1.5 text-sm font-semibold text-[var(--sea-ink)] shadow-[0_8px_22px_rgba(30,90,72,0.08)] transition hover:-translate-y-0.5"
    >
      {modeLabels[mode]}
    </button>
  );
}
