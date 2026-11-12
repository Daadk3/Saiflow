"use client";

import { useTranslations } from "next-intl";
import {
  THEME_STORAGE_KEY,
  nextTheme,
  themeCookie,
  themeFromPreference,
  type ThemeChoice,
} from "@/lib/theme";

/**
 * One-click light / dark switch. The sun and the moon, and the accessible
 * name, follow html.light / html.dark from CSS so the first paint matches
 * the blocking script and there is no hydration mismatch.
 *
 * The bar control is an icon. The menu control repeats the full label,
 * the same way the WhatsApp button does.
 */
function currentTheme(): ThemeChoice {
  const root = document.documentElement;
  if (root.classList.contains("light")) return "light";
  if (root.classList.contains("dark")) return "dark";
  return themeFromPreference(null, window.matchMedia("(prefers-color-scheme: light)").matches);
}

function SunIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="theme-icon-sun h-5 w-5 shrink-0"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="theme-icon-moon h-5 w-5 shrink-0"
    >
      <path d="M21 14.5A8.5 8.5 0 1 1 9.5 3 7 7 0 0 0 21 14.5z" />
    </svg>
  );
}

export default function ThemeToggle({ variant = "bar" }: { variant?: "bar" | "menu" }) {
  const t = useTranslations("nav");
  const inMenu = variant === "menu";

  const onClick = () => {
    const mode = nextTheme(currentTheme());
    try {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // Private mode can throw. The class still changes for this view.
    }
    document.cookie = themeCookie(mode);
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(mode);
    root.style.colorScheme = mode;
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={
        inMenu
          ? "inline-flex items-center gap-2 font-medium text-gray-300 transition-colors hover:text-white"
          : "theme-toggle inline-flex shrink-0 items-center justify-center rounded-full border border-gray-600 p-2 text-gray-300 transition-colors hover:border-gray-400 hover:text-white"
      }
    >
      <SunIcon />
      <MoonIcon />
      <span className={inMenu ? "theme-label-to-light" : "theme-label-to-light sr-only"}>
        {t("switchToLight")}
      </span>
      <span className={inMenu ? "theme-label-to-dark" : "theme-label-to-dark sr-only"}>
        {t("switchToDark")}
      </span>
    </button>
  );
}
