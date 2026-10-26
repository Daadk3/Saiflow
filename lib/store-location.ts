/**
 * Where a store is based.
 *
 * Saved on the shop itself (Shop.country, Shop.city), not on the unused
 * street line Shop.address and not on Profile.location. The country is an
 * ISO code so the admin directory can filter and count by it. The city is
 * free text and optional. Shops opened before this was asked have neither,
 * and every reader shows that as unknown rather than guessing.
 *
 * Names live in lib/store-countries.json, Saudi Arabia first and the rest
 * in Arabic order. They are frozen there so the server render and the
 * browser render the same option text.
 */

import COUNTRY_LIST from "./store-countries.json" with { type: "json" };

/** Sentinel for the admin filter that means "no country saved". Not an ISO code. */
export const UNKNOWN_COUNTRY_FILTER = "unknown";

/** City is optional. Bounded so a paste cannot land a paragraph in the directory. */
export const CITY_MAX_LENGTH = 80;

export interface CountryNames {
  ar: string;
  en: string;
}

const NAMES = new Map<string, CountryNames>(
  COUNTRY_LIST.map((country) => [country.code, { ar: country.ar, en: country.en }])
);

/** Saudi Arabia first, then the rest by Arabic name. */
export const STORE_COUNTRIES: readonly string[] = COUNTRY_LIST.map((country) => country.code);

export function isStoreCountry(code: string): boolean {
  return NAMES.has(code);
}

export function countryNames(code: string): CountryNames {
  return NAMES.get(code) ?? { ar: code, en: code };
}

/** Arabic and English together, for a dropdown option and the admin directory. */
export function countryOptionLabel(code: string): string {
  const names = countryNames(code);
  return `${names.ar} · ${names.en}`;
}

/** "sa" and " SA " are the code. Anything else, including a country name, is not. */
export function canonicalCountry(value: string): string | null {
  const code = value.trim().toUpperCase();
  return NAMES.has(code) ? code : null;
}

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

export function normalizeCity(
  value: unknown
): { ok: true; city: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") return { ok: true, city: null };
  if (typeof value !== "string") return { ok: false, error: "City must be text" };
  const city = value.replace(CONTROL_CHARS, "").trim().replace(/\s+/g, " ");
  if (!city) return { ok: true, city: null };
  if (city.length > CITY_MAX_LENGTH) {
    return { ok: false, error: "City must be 80 characters or fewer" };
  }
  return { ok: true, city };
}

/** Required country and optional city, for a store that is being opened. */
export function parseNewStoreLocation(input: {
  country: unknown;
  city: unknown;
}): { ok: true; country: string; city: string | null } | { ok: false; error: string } {
  const country = typeof input.country === "string" ? canonicalCountry(input.country) : null;
  if (!country) return { ok: false, error: "Choose the store's country" };
  const city = normalizeCity(input.city);
  if (!city.ok) return city;
  return { ok: true, country, city: city.city };
}

/**
 * An edit. A missing key leaves the column alone, so a rename that does not
 * mention location cannot wipe it. A present empty country clears it back
 * to unknown; a present empty city clears the city.
 */
export function parseStoreLocationPatch(body: object):
  | { ok: true; country?: string | null; city?: string | null }
  | { ok: false; error: string } {
  const record = body as Record<string, unknown>;
  const patch: { country?: string | null; city?: string | null } = {};
  if ("country" in record) {
    const value = record.country;
    if (value === null || value === "") {
      patch.country = null;
    } else if (typeof value === "string") {
      const country = canonicalCountry(value);
      if (!country) return { ok: false, error: "Choose the store's country" };
      patch.country = country;
    } else {
      return { ok: false, error: "Choose the store's country" };
    }
  }
  if ("city" in record) {
    const city = normalizeCity(record.city);
    if (!city.ok) return city;
    patch.city = city.city;
  }
  return { ok: true, ...patch };
}

/**
 * The `country` query on the admin directory. An unknown or empty value
 * means "no filter", never an error: a bad link shows every store.
 */
export function parseCountryFilter(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const value = raw.trim().slice(0, 32);
  if (!value) return undefined;
  if (value.toLowerCase() === UNKNOWN_COUNTRY_FILTER) return UNKNOWN_COUNTRY_FILTER;
  return canonicalCountry(value) ?? undefined;
}
