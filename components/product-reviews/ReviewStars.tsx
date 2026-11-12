/**
 * A 1–5 star mark. The number next to it is the precise value; these glyphs
 * are the rounded picture, and they are never rendered for zero reviews.
 */
export function ReviewStars({ value, label }: { value: number; label: string }) {
  const full = Math.max(0, Math.min(5, Math.round(value)));
  return (
    <span className="inline-flex items-center gap-0.5 text-amber-400" role="img" aria-label={label}>
      {Array.from({ length: 5 }, (_, index) => (
        <span key={index} aria-hidden="true">
          {index < full ? "★" : "☆"}
        </span>
      ))}
    </span>
  );
}
