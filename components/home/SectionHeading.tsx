import Link from "next/link";
import { IconArrow } from "./icons";

interface SectionHeadingProps {
  title: string;
  subtitle?: string;
  align?: "start" | "center";
  /** An optional forward link rendered beside the heading on wide screens. */
  action?: { href: string; label: string };
}

export function SectionHeading({ title, subtitle, align = "start", action }: SectionHeadingProps) {
  const centered = align === "center";
  return (
    <div
      className={`mb-10 flex flex-col gap-5 sm:mb-12 ${
        centered ? "items-center text-center" : "sm:flex-row sm:items-end sm:justify-between"
      }`}
    >
      <div className={centered ? "max-w-2xl" : "max-w-2xl"}>
        <h2 className="text-3xl font-bold leading-tight text-white sm:text-4xl">{title}</h2>
        {subtitle && <p className="mt-3 text-lg text-gray-400 sm:text-xl">{subtitle}</p>}
      </div>
      {action && (
        <Link
          href={action.href}
          className="inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-teal-400 transition-colors hover:text-teal-300"
        >
          {action.label}
          <IconArrow className="h-4 w-4 rtl:-scale-x-100" />
        </Link>
      )}
    </div>
  );
}
