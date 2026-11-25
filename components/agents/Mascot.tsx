import Image from "next/image";
import type { CSSProperties } from "react";

/**
 * One mascot with its idle loop: a slow bob with a little squash and
 * stretch, and a soft ground shadow that shrinks as the mascot rises.
 * The PNGs are flat, so the whole mascot moves as one piece.
 *
 * `index` offsets the loop so mascots side by side never move in step.
 * The hover hop lives in agents.css and is driven by the parent card.
 */
export default function Mascot({
  src,
  alt,
  width,
  index,
  intrinsic = 900,
  intrinsicHeight,
  priority = false,
  shadow = true,
  className,
}: {
  src: string;
  alt: string;
  /** Rendered width in CSS pixels; also the image `sizes` hint. */
  width: number;
  index: number;
  intrinsic?: number;
  intrinsicHeight?: number;
  priority?: boolean;
  shadow?: boolean;
  className?: string;
}) {
  const style = {
    "--w": `${width}px`,
    "--dur": `${(3.3 + (index % 4) * 0.22).toFixed(2)}s`,
    "--delay": `${(-index * 0.83).toFixed(2)}s`,
  } as CSSProperties;

  return (
    <div className={className ? `agents-mascot ${className}` : "agents-mascot"} style={style}>
      {shadow ? <span className="agents-mascot-shadow" aria-hidden="true" /> : null}
      <div className="agents-mascot-bob">
        <div className="agents-mascot-react">
          <Image
            src={src}
            alt={alt}
            width={intrinsic}
            height={intrinsicHeight ?? intrinsic}
            sizes={`${width}px`}
            quality={90}
            priority={priority}
            draggable={false}
          />
        </div>
      </div>
    </div>
  );
}
