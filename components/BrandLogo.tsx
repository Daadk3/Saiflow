import Image from "next/image";
import Link from "next/link";

/**
 * SaiFlow's formal logo: the flow S symbol beside the SaiFlow wordmark,
 * linking home. The header and footer both render this one component so
 * they can never drift apart.
 *
 * The lockup is artwork, so it keeps its left-to-right order in Arabic:
 * RTL moves it to the start of the bar but never mirrors it. For the same
 * reason the wordmark uses the site's Latin typeface in both locales rather
 * than inheriting Cairo. The symbol is decorative; the wordmark names the
 * link.
 *
 * The ghost mascot is SaiFlow's personality, not its logo, and stays out of
 * this lockup.
 */
export default function BrandLogo() {
  return (
    <Link href="/" dir="ltr" className="logo flex w-fit shrink-0 items-center gap-2.5">
      <Image
        src="/brand/saiflow-symbol.png"
        alt=""
        aria-hidden="true"
        width={29}
        height={32}
        className="h-8 w-auto"
      />
      <span className="font-sans text-2xl font-bold tracking-tight text-white">SaiFlow</span>
    </Link>
  );
}
