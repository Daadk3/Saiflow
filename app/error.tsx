"use client";

// Branded route-level error page. Client component by Next.js requirement;
// copy is inline (both languages) because the intl provider may itself
// be part of the failed render.
export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 pt-16">
      <div className="text-center max-w-md">
        <p className="text-red-400 font-mono text-sm mb-4">500</p>
        <h1 className="text-3xl font-bold text-white mb-3">
          حدث خطأ ما <span className="text-gray-500">·</span> Something went wrong
        </h1>
        <p className="text-gray-400 mb-8">
          نعتذر عن الخلل — يمكنك المحاولة مرة أخرى.
          <br />
          Sorry about that — you can try again.
        </p>
        <button
          onClick={() => reset()}
          className="inline-block bg-teal-500 hover:bg-teal-400 text-white font-semibold px-6 py-3 rounded-xl transition-colors"
        >
          إعادة المحاولة · Try again
        </button>
      </div>
    </div>
  );
}
