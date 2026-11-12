/**
 * Light / dark theme for the public site.
 *
 * The inline script in the root layout is the source that runs before paint.
 * An explicit choice is stored in localStorage (and mirrored to a cookie so
 * the server can render the same class). With no explicit choice, the script
 * follows prefers-color-scheme and does not write localStorage, so a later
 * change of the system setting is still picked up.
 *
 * Dark is the site's existing look: the light palette only applies under
 * html.light (app/theme-light.css). html.dark keeps the current colors.
 */

export const THEME_STORAGE_KEY = "saiflow-theme";
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type ThemeChoice = "light" | "dark";

export function isThemeChoice(value: string | null | undefined): value is ThemeChoice {
  return value === "light" || value === "dark";
}

/** Explicit choice wins. Otherwise follow the system. */
export function themeFromPreference(stored: string | null | undefined, systemLight: boolean): ThemeChoice {
  if (isThemeChoice(stored)) return stored;
  return systemLight ? "light" : "dark";
}

export function nextTheme(current: ThemeChoice): ThemeChoice {
  return current === "light" ? "dark" : "light";
}

export function themeCookie(mode: ThemeChoice): string {
  return `${THEME_STORAGE_KEY}=${mode}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`;
}

/**
 * Blocking script. Reads localStorage, otherwise prefers-color-scheme.
 * It never writes localStorage — only a click does, so "system" stays system.
 * Re-applies if hydration strips the class, and follows the OS when the
 * visitor has not chosen.
 */
export const themeInitScript = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var r=document.documentElement;function choice(){try{var s=localStorage.getItem(k);if(s==="light"||s==="dark")return s;}catch(e){}return window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";}function apply(){var mode=choice();var other=mode==="light"?"dark":"light";if(!r.classList.contains(mode)||r.classList.contains(other)){r.classList.remove("light","dark");r.classList.add(mode);}r.style.colorScheme=mode;}apply();try{window.matchMedia("(prefers-color-scheme: light)").addEventListener("change",function(){try{var s=localStorage.getItem(k);if(s==="light"||s==="dark")return;}catch(e){}apply();});}catch(e){}try{new MutationObserver(function(){apply();}).observe(r,{attributes:true,attributeFilter:["class"]});}catch(e){}}catch(e){}})();`;
