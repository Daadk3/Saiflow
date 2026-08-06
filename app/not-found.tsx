import Link from "next/link";
import { getLocale } from "next-intl/server";

// Branded 404 — the default Next.js page is off-brand and English-only,
// which reads as broken to buyers mid-purchase.
export default async function NotFound() {
  const locale = await getLocale();
  const ar = locale.startsWith("ar");

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 pt-16">
      <div className="text-center max-w-md">
        <p className="text-teal-500 font-mono text-sm mb-4">404</p>
        <h1 className="text-3xl font-bold text-white mb-3">
          {ar ? "الصفحة غير موجودة" : "Page not found"}
        </h1>
        <p className="text-gray-400 mb-8">
          {ar
            ? "الصفحة التي تبحث عنها غير موجودة أو تم نقلها."
            : "The page you are looking for doesn't exist or has been moved."}
        </p>
        <Link
          href="/"
          className="inline-block bg-teal-500 hover:bg-teal-400 text-white font-semibold px-6 py-3 rounded-xl transition-colors"
        >
          {ar ? "العودة للرئيسية" : "Back to home"}
        </Link>
      </div>
    </div>
  );
}
