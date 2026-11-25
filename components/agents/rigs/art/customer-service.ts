/**
 * Customer Service mascot as RigArt. Its paths come from
 * customer-service-paths.ts (scripts/agents/trace_customer_service_mascot.py),
 * which was traced first and by hand-tuned rules, so this file only arranges
 * them: outlines under fills so the arm and body read as one shape, and the
 * headphones riding on the head.
 */

import {
  CS_ARM_PIVOT,
  CS_ARM_R_PIVOT,
  CS_EYES,
  CS_PATHS,
} from "../../customer-service-paths";
import type { RigArt } from "../types";

const INK = "#001824";
const TEAL = "#15b4bb";
const PINK = "#f7c6c1";
const GRAY = "#4c575b";

const art: RigArt = {
  layers: [
    ["armL", INK, CS_PATHS.armOuter],
    ["body", INK, CS_PATHS.bodyOuter],
    ["armL", TEAL, CS_PATHS.armInner],
    ["body", TEAL, CS_PATHS.bodyInner],
    ["armR", INK, CS_PATHS.armROuter],
    ["armR", TEAL, CS_PATHS.armRInner],
    ["head", INK, CS_PATHS.bandOuter],
    ["head", PINK, CS_PATHS.band],
    ["head", INK, CS_PATHS.cupLOuter],
    ["head", GRAY, CS_PATHS.cupLGray],
    ["head", PINK, CS_PATHS.cupLPink],
    ["head", INK, CS_PATHS.cupROuter],
    ["head", GRAY, CS_PATHS.cupRGray],
    ["head", PINK, CS_PATHS.cupRPink],
  ],
  eyes: CS_EYES.map(([cx, cy, rx, ry]) => ({ cx, cy, rx, ry })),
  mouth: { d: CS_PATHS.mouth, box: [373, 380, 467, 419] },
  ink: INK,
  bodyColour: TEAL,
  pivots: {
    armL: [CS_ARM_PIVOT[0], CS_ARM_PIVOT[1]],
    armR: [CS_ARM_R_PIVOT[0], CS_ARM_R_PIVOT[1]],
  },
  // The face sits above both arms; the headphones above the face.
  faceAt: 6,
  head: [440, 620],
  smile: [
    "M374 386C398 392 440 392 464 386C462 414 444 432 419 432C394 432 376 414 374 386Z",
    "M398 424C404 414 434 414 440 424C434 430 404 430 398 424Z",
  ],
  blush: [
    [292, 398],
    [560, 410],
  ],
};

export default art;
