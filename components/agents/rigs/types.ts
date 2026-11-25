/**
 * Data for the mascots drawn as SVG parts (RiggedMascot.tsx).
 *
 * RigArt is the drawing, traced from each mascot's PNG by
 * scripts/agents/trace_mascot.py. RigMotion says how that mascot moves:
 * when each move of its 12s show starts, and how far its arms and prop
 * turn. All values are in the art's own 900×900 space.
 */

export type RigPart = "body" | "armL" | "armR" | "prop" | "head";
export type RigLimb = "armL" | "armR" | "prop";
export type Point = [number, number];

export type RigArt = {
  /** [part, colour, path] in drawing order. Paths use fill-rule evenodd. */
  layers: [RigPart, string, string][];
  /** The resting eyes. An eye with `d` (a wink) is drawn as that path. */
  eyes: { cx: number; cy: number; rx: number; ry: number; d?: string }[];
  /** The resting mouth, its box [x0, y0, x1, y1], and any colours inside it. */
  mouth: {
    d: string;
    box: [number, number, number, number];
    inner?: [string, string][];
  };
  ink: string;
  bodyColour: string;
  /** The joint each moving part turns around (shoulder, wrist, grip). */
  pivots: Partial<Record<RigLimb, Point>>;
  /** Where the face is drawn among the layers. Default: after the body. */
  faceAt?: number;
  /** The point the head (face) tilts and bobs around. Default: below the eyes. */
  head?: Point;
  /** Hand-drawn smile [mouth, tongue] instead of the generated one. */
  smile?: [string, string];
  /** Cheek centres instead of the generated ones. */
  blush?: [Point, Point];
};

/** Arm angles in degrees. Minus turns it anticlockwise on screen. */
export type ArmMotion = {
  /** The wave: two swings, then a last flick. */
  wave: [number, number, number];
  /** The jump: a crouch, then up in the air. */
  jump: [number, number];
  /** The cheer: pumps between these two. */
  cheer: [number, number];
  /** Hover and focus: swings between these two. */
  excited: [number, number];
};

export type RigMotion = {
  /** When each move of the 12s show starts, in seconds. */
  at: {
    tilt: number;
    wave: number;
    jump: number;
    cheer: number;
    prop?: number;
  };
  /** 1 leans to the viewer's left on landing, -1 to the right. */
  lean: 1 | -1;
  /** The curious head tilt, in degrees. */
  tilt: number;
  arms: Partial<Record<"armL" | "armR", ArmMotion>>;
  prop?: {
    /** The arm that carries it, if any. */
    heldBy?: "armL" | "armR";
    /** Held in both hands: the hands ride along with it. */
    carries?: boolean;
    /** Its own little move: a turn (degrees) and a lift (art units). */
    turn: number;
    lift: number;
    /** How far it bounces up with each cheer pump (art units). */
    cheer: number;
  };
  /** Cheek colour; pick one that shows on the body colour. */
  blush: string;
};

export type Rig = { art: RigArt; motion: RigMotion };
