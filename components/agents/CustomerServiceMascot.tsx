"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import {
  CS_ARM_PIVOT,
  CS_ARM_R_PIVOT,
  CS_EYES,
  CS_PATHS,
} from "./customer-service-paths";

const INK = "#001824";
const TEAL = "#15b4bb";
const PINK = "#f7c6c1";
const GRAY = "#4c575b";

/** How far (in 900-unit art space) the pupils and the whole face may lean toward the cursor. */
const PUPIL_REACH = 16;
const FACE_REACH = 9;
/** After the cursor stops for this long, the mascot goes back to glancing on its own. */
const TRACK_IDLE_MS = 2200;

/**
 * The Customer Service mascot drawn as layered SVG, so its parts can move.
 * It breathes, blinks and glances all the time, and its eyes follow the
 * cursor. Every 12 seconds it plays a short show: a big wave, a jump with a
 * full spin, then a cheer with both arms, little hops, a wiggle, happy "^ ^"
 * eyes, rosy cheeks and a big smile. Hover or keyboard focus on its card makes
 * it extra excited. All motion is CSS on transform and opacity (see "customer
 * service rig" in agents.css). JavaScript only sets CSS variables for the cursor.
 *
 * It takes the same box as the PNG it replaces (square, `width` wide), so
 * swapping it in moves nothing on the page.
 */
export default function CustomerServiceMascot({
  width,
  label,
  className,
}: {
  width: number;
  label: string;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!finePointer.matches || reduceMotion.matches) return;

    let frame = 0;
    let idleTimer = 0;
    let pointer: { x: number; y: number } | null = null;
    let inView = false;

    const apply = () => {
      frame = 0;
      if (!pointer || !inView) return;
      const box = root.getBoundingClientRect();
      // Between the eyes, a little above the middle of the art.
      const cx = box.left + box.width * 0.47;
      const cy = box.top + box.height * 0.38;
      const dx = pointer.x - cx;
      const dy = pointer.y - cy;
      const dist = Math.hypot(dx, dy) || 1;
      // Full lean once the cursor is a mascot-width away; gentler up close.
      const pull = Math.min(1, dist / Math.max(box.width, 1));
      const ux = (dx / dist) * pull;
      const uy = (dy / dist) * pull;
      root.style.setProperty("--cs-lx", (ux * PUPIL_REACH).toFixed(2));
      root.style.setProperty("--cs-ly", (uy * PUPIL_REACH * 0.75).toFixed(2));
      root.style.setProperty("--cs-fx", (ux * FACE_REACH).toFixed(2));
      root.style.setProperty("--cs-fy", (uy * FACE_REACH * 0.6).toFixed(2));
      root.dataset.tracking = "true";
    };

    const relax = () => {
      root.style.setProperty("--cs-lx", "0");
      root.style.setProperty("--cs-ly", "0");
      root.style.setProperty("--cs-fx", "0");
      root.style.setProperty("--cs-fy", "0");
      delete root.dataset.tracking;
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      pointer = { x: event.clientX, y: event.clientY };
      if (!frame) frame = requestAnimationFrame(apply);
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(relax, TRACK_IDLE_MS);
    };

    const onLeave = () => {
      pointer = null;
      relax();
    };

    // Only follow the cursor while the mascot is on screen.
    const observer = new IntersectionObserver((entries) => {
      inView = entries.some((entry) => entry.isIntersecting);
      if (!inView) relax();
    });
    observer.observe(root);

    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      observer.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.clearTimeout(idleTimer);
      cancelAnimationFrame(frame);
    };
  }, []);

  const [[lx, ly, lrx, lry], [rx, ry, rrx, rry]] = CS_EYES;
  const [px, py] = CS_ARM_PIVOT;
  const [qx, qy] = CS_ARM_R_PIVOT;

  return (
    <div
      ref={rootRef}
      className={
        className ? `agents-mascot cs-rig ${className}` : "agents-mascot cs-rig"
      }
      style={{ "--w": `${width}px` } as CSSProperties}
      data-mascot="customer-service"
    >
      <span className="agents-mascot-shadow cs-shadow" aria-hidden="true" />
      {/* Jumps and landing squash, then the spin (a turn around the upright axis). */}
      <div className="cs-hop">
        <div className="cs-spin">
          <svg
            className="cs-svg"
            viewBox="0 0 900 900"
            width={width}
            height={width}
            role="img"
            aria-label={label}
            style={
              {
                "--cs-arm-x": `${px}px`,
                "--cs-arm-y": `${py}px`,
                "--cs-arm-r-x": `${qx}px`,
                "--cs-arm-r-y": `${qy}px`,
              } as CSSProperties
            }
          >
            <g className="cs-sway">
              <g className="cs-breathe">
                {/* Outlines first, fills on top: overlapping parts read as one shape. */}
                <g className="cs-arm">
                  <path d={CS_PATHS.armOuter} fill={INK} />
                </g>
                <path className="cs-body" d={CS_PATHS.bodyOuter} fill={INK} />
                <g className="cs-arm">
                  <path d={CS_PATHS.armInner} fill={TEAL} />
                </g>
                <path className="cs-body" d={CS_PATHS.bodyInner} fill={TEAL} />

                {/* The lower arm has its own outline, so it can lift off the body. */}
                <g className="cs-arm-r">
                  <path d={CS_PATHS.armROuter} fill={INK} />
                  <path d={CS_PATHS.armRInner} fill={TEAL} />
                </g>

                <g className="cs-head">
                  <g className="cs-face">
                    <g className="cs-blush" aria-hidden="true">
                      <ellipse cx={292} cy={398} rx={30} ry={15} fill={PINK} />
                      <ellipse cx={560} cy={410} rx={30} ry={15} fill={PINK} />
                    </g>
                    <g className="cs-eyes-open">
                      <g className="cs-eye cs-eye-l">
                        <g className="cs-look">
                          <g className="cs-glance">
                            <g
                              className="cs-lid"
                              style={{ transformOrigin: `${lx}px ${ly}px` }}
                            >
                              <ellipse
                                className="cs-pupil"
                                cx={lx}
                                cy={ly}
                                rx={lrx}
                                ry={lry}
                                fill={INK}
                              />
                            </g>
                          </g>
                        </g>
                      </g>
                      <g className="cs-eye cs-eye-r">
                        <g className="cs-look">
                          <g className="cs-glance">
                            <g
                              className="cs-lid"
                              style={{ transformOrigin: `${rx}px ${ry}px` }}
                            >
                              <ellipse
                                className="cs-pupil"
                                cx={rx}
                                cy={ry}
                                rx={rrx}
                                ry={rry}
                                fill={INK}
                              />
                            </g>
                          </g>
                        </g>
                      </g>
                    </g>
                    {/* Happy "^ ^" eyes, shown only in happy moments. */}
                    <g
                      className="cs-eyes-happy"
                      fill="none"
                      stroke={INK}
                      strokeWidth={14}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path
                        d={`M${lx - 25} ${ly + 12}L${lx} ${ly - 14}L${lx + 25} ${ly + 12}`}
                      />
                      <path
                        d={`M${rx - 25} ${ry + 12}L${rx} ${ry - 14}L${rx + 25} ${ry + 12}`}
                      />
                    </g>
                    <g className="cs-mouth">
                      <path
                        className="cs-mouth-rest"
                        d={CS_PATHS.mouth}
                        fill={INK}
                      />
                      <g className="cs-mouth-happy">
                        <path
                          d="M374 386C398 392 440 392 464 386C462 414 444 432 419 432C394 432 376 414 374 386Z"
                          fill={INK}
                        />
                        <path
                          d="M398 424C404 414 434 414 440 424C434 430 404 430 398 424Z"
                          fill={PINK}
                        />
                      </g>
                    </g>
                  </g>

                  <g className="cs-headphones">
                    <path d={CS_PATHS.bandOuter} fill={INK} />
                    <path d={CS_PATHS.band} fill={PINK} />
                    <path d={CS_PATHS.cupLOuter} fill={INK} />
                    <path d={CS_PATHS.cupLGray} fill={GRAY} />
                    <path d={CS_PATHS.cupLPink} fill={PINK} />
                    <path d={CS_PATHS.cupROuter} fill={INK} />
                    <path d={CS_PATHS.cupRGray} fill={GRAY} />
                    <path d={CS_PATHS.cupRPink} fill={PINK} />
                  </g>
                </g>
              </g>
            </g>
          </svg>
        </div>
      </div>
    </div>
  );
}
