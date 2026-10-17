/**
 * The shape of a dashboard page while its data loads.
 *
 * The dashboard pages fetch after they mount, and used to show a blank
 * screen with one spinner meanwhile, which read as "broken" on a slow
 * connection. A skeleton in the page's own layout shows that the page is
 * there and its numbers are on the way. Announced once to screen readers
 * through `label`; the blocks themselves are hidden from them.
 *
 * Server- and client-safe: no hooks, no state.
 */

type Variant = "overview" | "list" | "form";

function Block({ className }: { className: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-lg bg-gray-800/60 ${className}`} />;
}

export function DashboardSkeleton({ label, variant = "overview" }: { label: string; variant?: Variant }) {
  return (
    <div className="min-h-screen bg-[#0a0a0a]" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <Block className="h-4 w-32" />
        <Block className="mt-4 h-8 w-64" />
        <Block className="mt-2 h-4 w-80 max-w-full" />

        {variant === "overview" && (
          <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-xl border border-gray-800 bg-[#111111] p-6">
                <Block className="h-4 w-24" />
                <Block className="mt-3 h-8 w-20" />
              </div>
            ))}
          </div>
        )}

        {variant === "form" ? (
          <div className="mt-8 max-w-2xl space-y-5 rounded-2xl border border-gray-800 bg-[#111111] p-8">
            {[0, 1, 2, 3].map((i) => (
              <div key={i}>
                <Block className="h-4 w-28" />
                <Block className="mt-2 h-11 w-full" />
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-8 space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-4 rounded-xl border border-gray-800 bg-[#111111] p-4">
                <Block className="h-12 w-12 shrink-0" />
                <div className="flex-1">
                  <Block className="h-4 w-1/2" />
                  <Block className="mt-2 h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
