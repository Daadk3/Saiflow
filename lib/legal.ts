/**
 * The registered legal identity of the establishment operating SaiFlow.
 *
 * Single source of truth so the About page and the global footer cannot drift
 * apart. A commercial registration number that differs between two pages of
 * the same store is itself a compliance defect — this makes that impossible
 * rather than merely unlikely.
 *
 * These values are transcribed from the Saudi Business Center commercial
 * registration record. They are NOT editorial copy: do not reword, localise,
 * abbreviate or "tidy" them. They must match the government record exactly,
 * so any change here requires a corresponding change to the registration.
 *
 * The phone numbers are the registered BUSINESS contact numbers recorded on
 * the commercial registration, supplied by the founder from the Saudi Business
 * Center record. They are published because e-commerce authentication requires
 * a reachable business contact. Nothing else about any individual belongs in
 * this file.
 */
export const LEGAL = {
  /** Commercial Registration (السجل التجاري) number. */
  crNumber: "7050224786",

  /** Registered establishment name, Arabic — the authoritative legal name. */
  establishmentAr: "مؤسسة نوفا سفير ماركتينغ للاتصالات و تقنية المعلومات",

  /** English rendering of the establishment name. */
  establishmentEn:
    "NovaSphere Marketing Establishment for Communications and Information Technology",

  /** Registered store name, Arabic. */
  storeNameAr: "ساي فلو",

  /** Store name as written in English. */
  storeNameEn: "SaiFlow",

  /** The store's registered support channel. */
  supportEmail: "support@saiflow.io",

  /**
   * Registered business contact numbers.
   *
   * `*Display` values are the exact national forms recorded on the commercial
   * registration, shown verbatim so a reviewer can match them character for
   * character against the government record — do not regroup or reformat them.
   *
   * `*Tel` values are the same numbers in E.164 for `tel:` hrefs (national
   * leading 0 replaced by the +966 country code). A dialer needs the
   * international form; a reviewer needs the registered form. Hence both.
   */
  mobileDisplay: "0555221868",
  mobileTel: "+966555221868",
  landlineDisplay: "0114826662",
  landlineTel: "+966114826662",
} as const;

/** The establishment name for a locale. */
export function establishmentName(isArabic: boolean): string {
  return isArabic ? LEGAL.establishmentAr : LEGAL.establishmentEn;
}
