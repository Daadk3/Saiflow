"use client";

import { useState, type InputHTMLAttributes } from "react";
import { useTranslations } from "next-intl";

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className"> & {
  id: string;
};

const FIELD =
  "w-full ps-4 pe-12 py-3 bg-[#0a0a0a] border border-gray-800 rounded-xl text-white placeholder-gray-600 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-colors";

/**
 * A password field with a show/hide button.
 *
 * Typing a password blind is where mismatched confirmations and forgotten
 * passwords start. The button sits at the inline end, so it is on the left in
 * Arabic and the right in English, and its label says what it will do next
 * ("Show password" / "Hide password"). It only changes
 * how this field is displayed: the value, validation and submission are the
 * caller's, exactly as with a plain input.
 */
export function PasswordInput(props: PasswordInputProps) {
  const t = useTranslations("auth");
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      {/* Shown as text, a password must still not be capitalised, corrected or learned by the keyboard. */}
      <input
        {...props}
        type={visible ? "text" : "password"}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={FIELD}
      />
      <button
        type="button"
        onClick={() => setVisible((shown) => !shown)}
        aria-label={visible ? t("hidePassword") : t("showPassword")}
        aria-controls={props.id}
        className="absolute inset-y-0 end-0 flex w-12 items-center justify-center rounded-e-xl text-gray-500 transition-colors hover:text-gray-300 focus:outline-none focus-visible:text-teal-400 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500"
      >
        {visible ? (
          <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A9.7 9.7 0 0112 4.9c4.5 0 8.3 2.9 9.7 7.1a10.3 10.3 0 01-3.1 4.6M6.6 6.6A10.3 10.3 0 002.3 12c1.4 4.2 5.2 7.1 9.7 7.1 1.7 0 3.3-.4 4.7-1.1" />
          </svg>
        ) : (
          <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.3 12C3.7 7.8 7.5 4.9 12 4.9s8.3 2.9 9.7 7.1c-1.4 4.2-5.2 7.1-9.7 7.1S3.7 16.2 2.3 12z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}
