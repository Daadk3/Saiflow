import type { ChecklistRow } from "@/lib/review-checklist";

/**
 * The founder's 8-point review checklist, in Arabic.
 *
 * ✅ and ⚠️ are the automatic checks (points 3, 6 and 7), stored when the
 * seller submitted and when the file scan settled; ○ is a point only a
 * person can judge, with a ✅ / ⚠️ hint under points 2 and 8 for the basic
 * facts (description length, cover image). These are flags: none of them approves or rejects, and
 * every product still waits for the founder's decision.
 *
 * No hooks, so the server preview page and the client review queue can both
 * render it.
 */
export function ReviewChecklist({ rows, compact = false }: { rows: ChecklistRow[]; compact?: boolean }) {
  return (
    <div dir="rtl" lang="ar" className={`rounded-xl border border-white/10 bg-[#111] text-start ${compact ? "p-3" : "p-4"}`}>
      <h2 className="mb-2 text-sm font-semibold text-gray-200">قائمة المراجعة</h2>
      <ol className="space-y-1.5 text-sm">
        {rows.map((row) => (
          <li key={row.id} className="flex gap-2">
            <Mark state={row.state} />
            <span className="min-w-0">
              <span className="text-gray-300">
                {row.id}) {row.label}
              </span>
              <span
                className={`block text-xs ${
                  row.state === "warn" ? "text-amber-300/90" : row.state === "ok" ? "text-teal-300/80" : "text-gray-500"
                }`}
              >
                {row.reason}
              </span>
              {row.hint && (
                <span className={`block text-xs ${row.hint.state === "warn" ? "text-amber-300/90" : "text-teal-300/80"}`}>
                  <span aria-hidden="true">{row.hint.state === "warn" ? "⚠️" : "✅"}</span> {row.hint.text}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-gray-500">الفحص الآلي ينبّه فقط، ولا يعتمد أو يرفض أي منتج. القرار لك.</p>
    </div>
  );
}

function Mark({ state }: { state: ChecklistRow["state"] }) {
  const [mark, said] =
    state === "ok" ? ["✅", "فحص آلي: سليم"] : state === "warn" ? ["⚠️", "فحص آلي: انتبه"] : ["○", "مراجعة يدوية"];
  return (
    <span className={`shrink-0 ${state === "manual" ? "text-gray-500" : ""}`}>
      <span aria-hidden="true">{mark}</span>
      <span className="sr-only">{said}: </span>
    </span>
  );
}
