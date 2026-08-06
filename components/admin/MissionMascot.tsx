import Image from "next/image";

/**
 * Placeholder only — no animation, by design.
 *
 * Future states: broken → worried · review → focused · complete → happy ·
 * launch-ready → rocket. For now every mood renders the single existing
 * mascot asset, and it appears ONLY in the calm/all-clear state so it reads
 * as reassurance rather than as a nag.
 */
export type MissionMood = "worried" | "focused" | "happy" | "rocket";

export default function MissionMascot({
  mood,
  size = 64,
}: {
  mood: MissionMood;
  size?: number;
}) {
  return (
    <Image
      src="/mascot.png"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      data-mood={mood}
      className="opacity-90 select-none"
      priority={false}
    />
  );
}
