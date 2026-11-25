"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import type { Point, Rig, RigArt, RigPart } from "./rigs/types";

/** Every mascot's show is this long, so moves line up loop after loop. */
const SHOW_S = 12;
/** How far (in art units) the pupils and the whole face lean toward the cursor. */
const PUPIL_REACH = 16;
const FACE_REACH = 9;
/** After the cursor stops for this long, the mascot goes back to glancing on its own. */
const TRACK_IDLE_MS = 2200;
const TONGUE = "#f7c6c1";

/** A negative delay that starts a move `s` seconds into the show. */
const startAt = (s: number) =>
  `${((((s % SHOW_S) + SHOW_S) % SHOW_S) - SHOW_S).toFixed(2)}s`;

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * One group per move, nested, so moves that overlap add up. A move's
 * wrapper only animates while that move plays; "x" is the hover loop.
 */
function Chain({
  part,
  moves,
  style,
  children,
}: {
  part: string;
  moves: string[];
  style?: CSSProperties;
  children: ReactNode;
}) {
  return moves.reduceRight<ReactNode>(
    (inner, move, i) => (
      <g
        className={`rig-${part} rig-${move}`}
        style={i === 0 ? style : undefined}
      >
        {inner}
      </g>
    ),
    children,
  );
}

/** A wide open smile (mouth and tongue) sitting where the resting mouth is. */
function smileFor(art: RigArt): [string, string] {
  if (art.smile) return art.smile;
  const [x0, y0, x1] = art.mouth.box;
  const cx = (x0 + x1) / 2;
  const w = Math.min(112, Math.max(76, x1 - x0));
  const h = w * 0.51;
  const top = y0 + 4;
  const l = cx - w / 2;
  const r = cx + w / 2;
  const k = w / 90;
  const p = (pts: number[]) => pts.map(round).join(" ");
  const mouth =
    `M${p([l, top])}C${p([l + w * 0.27, top + 6, r - w * 0.27, top + 6, r, top])}` +
    `C${p([r - 2, top + h * 0.6, cx + w * 0.28, top + h, cx, top + h])}` +
    `C${p([cx - w * 0.28, top + h, l + 2, top + h * 0.6, l, top])}Z`;
  const ty = top + h - 8 * k;
  const tongue =
    `M${p([cx - 21 * k, ty])}C${p([cx - 15 * k, ty - 10 * k, cx + 15 * k, ty - 10 * k, cx + 21 * k, ty])}` +
    `C${p([cx + 15 * k, ty + 6 * k, cx - 15 * k, ty + 6 * k, cx - 21 * k, ty])}Z`;
  return [mouth, tongue];
}

/** The mascot as a stack of runs: neighbouring layers of the same part. */
function runsOf(art: RigArt) {
  const runs: { part: RigPart; at: number; layers: [string, string][] }[] = [];
  art.layers.forEach(([part, colour, d], i) => {
    if (part === "head") return;
    const last = runs[runs.length - 1];
    if (last && last.part === part) last.layers.push([colour, d]);
    else runs.push({ part, at: i, layers: [[colour, d]] });
  });
  return runs;
}

const Paths = ({ layers }: { layers: [string, string][] }) => (
  <>
    {layers.map(([colour, d], i) => (
      <path key={i} d={d} fill={colour} fillRule="evenodd" />
    ))}
  </>
);

/**
 * A mascot drawn as layered SVG parts, so it can move like a cartoon. It
 * breathes, blinks and glances all the time, and its eyes and face follow
 * the cursor. Every 12 seconds it plays a show of its own: a curious head
 * tilt, a big wave, a jump with squash and stretch and a leaning landing, a
 * cheer with both arms, a wiggle and little hops, and a move for its prop.
 * Happy moments get "^ ^" eyes, rosy cheeks and a big smile. Each mascot's
 * motion (rigs/index.ts) sets when each move starts and how far its arms
 * turn, so neighbours never move in step. Hover or keyboard focus on its
 * card makes it extra excited.
 *
 * All motion is CSS on transform and opacity ("rigged mascots" in
 * agents.css); JavaScript only sets CSS variables for the cursor and pauses
 * the mascot while it is off screen. It takes the same square box as the PNG
 * it replaces, so swapping it in moves nothing on the page.
 */
export default function RiggedMascot({
  id,
  rig,
  width,
  label,
  className,
}: {
  id: string;
  rig: Rig;
  width: number;
  label: string;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { art, motion } = rig;

  const eyes = [...art.eyes].sort((a, b) => a.cx - b.cx);
  const eyeX = eyes.reduce((s, e) => s + e.cx, 0) / eyes.length;
  const eyeY = eyes.reduce((s, e) => s + e.cy, 0) / eyes.length;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduceMotion.matches) return;
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const follow = finePointer.matches;

    let frame = 0;
    let idleTimer = 0;
    let pointer: { x: number; y: number } | null = null;
    let inView = false;

    const apply = () => {
      frame = 0;
      if (!pointer || !inView) return;
      const box = root.getBoundingClientRect();
      const cx = box.left + (box.width * eyeX) / 900;
      const cy = box.top + (box.height * eyeY) / 900;
      const dx = pointer.x - cx;
      const dy = pointer.y - cy;
      const dist = Math.hypot(dx, dy) || 1;
      // Full lean once the cursor is a mascot-width away; gentler up close.
      const pull = Math.min(1, dist / Math.max(box.width, 1));
      const ux = (dx / dist) * pull;
      const uy = (dy / dist) * pull;
      root.style.setProperty("--lx", (ux * PUPIL_REACH).toFixed(2));
      root.style.setProperty("--ly", (uy * PUPIL_REACH * 0.75).toFixed(2));
      root.style.setProperty("--fx", (ux * FACE_REACH).toFixed(2));
      root.style.setProperty("--fy", (uy * FACE_REACH * 0.6).toFixed(2));
      root.dataset.tracking = "true";
    };

    const relax = () => {
      for (const name of ["--lx", "--ly", "--fx", "--fy"]) {
        root.style.setProperty(name, "0");
      }
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

    // Off screen, the mascot pauses and stops following the cursor.
    const observer = new IntersectionObserver((entries) => {
      inView = entries.some((entry) => entry.isIntersecting);
      if (inView) delete root.dataset.offscreen;
      else {
        root.dataset.offscreen = "true";
        relax();
      }
    });
    observer.observe(root);

    if (follow) {
      window.addEventListener("pointermove", onMove, { passive: true });
      document.documentElement.addEventListener("pointerleave", onLeave);
    }
    return () => {
      observer.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.clearTimeout(idleTimer);
      cancelAnimationFrame(frame);
    };
  }, [eyeX, eyeY]);

  // Small per-mascot differences in the always-on loops.
  const seed = [...id].reduce((s, c) => s + c.charCodeAt(0), 0);
  const [smile, tongue] = smileFor(art);
  const [x0, y0, x1] = art.mouth.box;
  const head: Point = art.head ?? [round(eyeX), round(eyeY + 280)];
  const scale = Math.min(
    1.25,
    Math.max(0.8, Math.max(...eyes.map((e) => e.ry)) / 26),
  );
  const blush: Point[] =
    art.blush ??
    eyes.map((e, i) => [
      round(e.cx + (i === 0 ? -50 : 50) * scale),
      round(e.cy + 58 * scale),
    ]);

  const rootStyle = {
    "--w": `${width}px`,
    "--at-t": startAt(motion.at.tilt),
    "--at-w": startAt(motion.at.wave),
    "--at-j": startAt(motion.at.jump),
    "--at-c": startAt(motion.at.cheer),
    "--at-p": startAt(motion.at.prop ?? 0),
    "--lean": motion.lean,
    "--tilt": motion.tilt,
    "--breathe": `${(3.3 + (seed % 7) * 0.1).toFixed(2)}s`,
    "--blink": `${(4.7 + (seed % 5) * 0.3).toFixed(2)}s`,
    "--blink2": `${(11.9 + (seed % 9) * 0.4).toFixed(2)}s`,
    "--glance": `${(8.6 + (seed % 6) * 0.35).toFixed(2)}s`,
    "--idle-delay": `${(-(seed % 11) * 0.7).toFixed(2)}s`,
  } as CSSProperties;

  const armChain = (part: "armL" | "armR", children: ReactNode) => {
    const m = motion.arms[part];
    const pivot = art.pivots[part];
    if (!m || !pivot) return children;
    const style = {
      "--px": `${pivot[0]}px`,
      "--py": `${pivot[1]}px`,
      "--a-w1": m.wave[0],
      "--a-w2": m.wave[1],
      "--a-w3": m.wave[2],
      "--a-j1": m.jump[0],
      "--a-j2": m.jump[1],
      "--a-c1": m.cheer[0],
      "--a-c2": m.cheer[1],
      "--a-x1": m.excited[0],
      "--a-x2": m.excited[1],
      "--a-xd": part === "armR" ? "-0.3s" : "0s",
    } as CSSProperties;
    return (
      <Chain part="arm" moves={["w", "j", "c", "x"]} style={style}>
        {children}
      </Chain>
    );
  };

  const propChain = (children: ReactNode) => {
    const pivot = art.pivots.prop;
    if (!motion.prop || !pivot) return children;
    const style = {
      "--qx": `${pivot[0]}px`,
      "--qy": `${pivot[1]}px`,
      "--q-turn": motion.prop.turn,
      "--q-lift": motion.prop.lift,
      "--q-cheer": motion.prop.cheer,
    } as CSSProperties;
    return (
      <Chain part="prop" moves={["c", "p", "x"]} style={style}>
        {children}
      </Chain>
    );
  };

  // Lay out the runs. A held prop rides inside its arm's groups.
  const runs = runsOf(art);
  const heldBy = motion.prop?.heldBy;
  const propRun = heldBy ? runs.findIndex((r) => r.part === "prop") : -1;
  let holderRun = -1;
  if (propRun >= 0) {
    let best = Infinity;
    runs.forEach((r, i) => {
      if (r.part === heldBy && Math.abs(i - propRun) < best) {
        best = Math.abs(i - propRun);
        holderRun = i;
      }
    });
  }
  const faceAt =
    art.faceAt ?? art.layers.findIndex(([part]) => part !== "body");

  const face = (
    <Chain
      key="face"
      part="head"
      moves={["t", "w", "j", "c", "x"]}
      style={
        {
          "--hx": `${head[0]}px`,
          "--hy": `${head[1]}px`,
          "--sx": `${round((x0 + x1) / 2)}px`,
          "--sy": `${y0 + 6}px`,
        } as CSSProperties
      }
    >
      <g className="rig-face">
        {["w", "j", "c"].map((move) => (
          <g key={move} className={`rig-blush rig-${move}`} aria-hidden="true">
            {blush.map(([cx, cy], i) => (
              <ellipse
                key={i}
                cx={cx}
                cy={cy}
                rx={round(30 * scale)}
                ry={round(15 * scale)}
                fill={motion.blush}
              />
            ))}
          </g>
        ))}
        <Chain part="eyes" moves={["j", "c", "x"]}>
          {eyes.map((e, i) => {
            const origin = { transformOrigin: `${e.cx}px ${e.cy}px` };
            return (
              <g key={i} className="rig-eye" style={origin}>
                <g className="rig-look">
                  <g className="rig-glance">
                    <g className="rig-lid" style={origin}>
                      {e.d ? (
                        <path d={e.d} fill={art.ink} fillRule="evenodd" />
                      ) : (
                        <ellipse
                          cx={e.cx}
                          cy={e.cy}
                          rx={e.rx}
                          ry={e.ry}
                          fill={art.ink}
                        />
                      )}
                    </g>
                  </g>
                </g>
              </g>
            );
          })}
        </Chain>
        {/* Happy "^ ^" eyes, shown only in happy moments. */}
        {["j", "c"].map((move) => (
          <g
            key={move}
            className={`rig-joy rig-${move}`}
            fill="none"
            stroke={art.ink}
            strokeWidth={14}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {eyes.map((e, i) => (
              <path
                key={i}
                d={`M${round(e.cx - 25 * scale)} ${round(e.cy + 12 * scale)}L${e.cx} ${round(e.cy - 14 * scale)}L${round(e.cx + 25 * scale)} ${round(e.cy + 12 * scale)}`}
              />
            ))}
          </g>
        ))}
        <Chain part="mouth" moves={["w", "j", "c", "x"]}>
          <path d={art.mouth.d} fill={art.ink} fillRule="evenodd" />
          {(art.mouth.inner ?? []).map(([colour, d], i) => (
            <path key={i} d={d} fill={colour} fillRule="evenodd" />
          ))}
        </Chain>
        {["w", "j", "c"].map((move) => (
          <g key={move} className={`rig-smile rig-${move}`}>
            <path d={smile} fill={art.ink} />
            <path d={tongue} fill={TONGUE} />
          </g>
        ))}
      </g>
      <Paths
        layers={art.layers
          .filter(([part]) => part === "head")
          .map(([, colour, d]) => [colour, d])}
      />
    </Chain>
  );

  // A prop held in both hands carries the hands: they ride inside its groups.
  const limbRuns = runs
    .map((r, i) => (r.part === "body" ? -1 : i))
    .filter((i) => i >= 0);
  const carry =
    motion.prop?.carries && limbRuns.length > 0
      ? [limbRuns[0], limbRuns[limbRuns.length - 1]]
      : null;
  const carried =
    carry !== null &&
    runs.slice(carry[0], carry[1] + 1).every((r) => r.part !== "body");

  const drawRun = (run: (typeof runs)[number], i: number): ReactNode => {
    let inner: ReactNode = <Paths layers={run.layers} />;
    if (i === holderRun) {
      const prop = propChain(<Paths layers={runs[propRun].layers} />);
      inner =
        propRun < i ? (
          <>
            {prop}
            {inner}
          </>
        ) : (
          <>
            {inner}
            {prop}
          </>
        );
    }
    if (run.part === "armL" || run.part === "armR") {
      return <g key={i}>{armChain(run.part, inner)}</g>;
    }
    if (run.part === "prop" && !carried) {
      return <g key={i}>{propChain(inner)}</g>;
    }
    return <g key={i}>{inner}</g>;
  };

  const drawn: ReactNode[] = [];
  let faceDrawn = false;
  runs.forEach((run, i) => {
    if (!faceDrawn && faceAt >= 0 && run.at >= faceAt) {
      drawn.push(face);
      faceDrawn = true;
    }
    if (i === propRun) return;
    if (carried && carry) {
      if (i === carry[0]) {
        drawn.push(
          <g key={i}>
            {propChain(
              runs
                .slice(carry[0], carry[1] + 1)
                .map((r, k) => drawRun(r, carry[0] + k)),
            )}
          </g>,
        );
      }
      if (i >= carry[0] && i <= carry[1]) return;
    }
    drawn.push(drawRun(run, i));
  });
  if (!faceDrawn) drawn.push(face);

  return (
    <div
      ref={rootRef}
      className={
        className ? `agents-mascot rig ${className}` : "agents-mascot rig"
      }
      style={rootStyle}
      data-mascot={id}
    >
      <span className="rig-shadow rig-w" aria-hidden="true">
        <span className="rig-shadow rig-j">
          <span className="rig-shadow rig-c">
            <span className="rig-shadow rig-x" />
          </span>
        </span>
      </span>
      {/* The jumps and hops: straight up and down, with squash and stretch. */}
      <div className="rig-hop rig-w">
        <div className="rig-hop rig-j">
          <div className="rig-hop rig-c">
            <div className="rig-hop rig-x">
              <svg
                className="rig-svg"
                viewBox="0 0 900 900"
                width={width}
                height={width}
                role="img"
                aria-label={label}
              >
                <Chain part="sway" moves={["w", "j", "c", "x"]}>
                  <g className="rig-breathe">{drawn}</g>
                </Chain>
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
