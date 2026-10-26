"use client";

import { useTranslations } from "next-intl";
import { STORE_COUNTRIES, countryOptionLabel } from "@/lib/store-location";

/**
 * Country (required when opening a store) and city (always optional).
 * Each country is labeled in Arabic and English, with Saudi Arabia first.
 * The whole control follows the page direction.
 */
export function StoreLocationFields({
  country,
  city,
  onCountryChange,
  onCityChange,
  countryRequired,
}: {
  country: string;
  city: string;
  onCountryChange: (value: string) => void;
  onCityChange: (value: string) => void;
  /** Creation requires a country. Settings may leave an older store unknown. */
  countryRequired: boolean;
}) {
  const t = useTranslations("dashboard");
  const label = countryRequired
    ? "mb-2 block text-sm font-medium text-white"
    : "mb-2 block text-sm font-medium text-gray-300";
  const field = countryRequired
    ? "w-full rounded-lg border border-gray-700 bg-gray-800 p-3 text-white transition-colors focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
    : "w-full rounded-xl border border-gray-800 bg-[#0a0a0a] px-4 py-3 text-white placeholder-gray-600 transition-colors focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500";

  return (
    <>
      <div>
        <label htmlFor="store-country" className={label}>
          {t("createShop.countryLabel")}{" "}
          {countryRequired ? <span className="text-teal-400">*</span> : null}
        </label>
        <select
          id="store-country"
          value={country}
          required={countryRequired}
          onChange={(e) => onCountryChange(e.target.value)}
          className={field}
        >
          <option value="" disabled={countryRequired}>
            {countryRequired ? t("createShop.countryPlaceholder") : t("createShop.countryUnknown")}
          </option>
          {STORE_COUNTRIES.map((code) => (
            <option key={code} value={code}>
              {countryOptionLabel(code)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="store-city" className={label}>
          {t("createShop.cityLabel")}{" "}
          <span className="font-normal text-gray-500">({t("createShop.cityOptional")})</span>
        </label>
        <input
          id="store-city"
          type="text"
          value={city}
          maxLength={80}
          onChange={(e) => onCityChange(e.target.value)}
          placeholder={t("createShop.cityPlaceholder")}
          className={field}
        />
        <p className="mt-1 text-xs text-gray-500">{t("createShop.locationHelp")}</p>
      </div>
    </>
  );
}
