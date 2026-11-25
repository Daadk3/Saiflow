/**
 * Every mascot drawn as SVG parts, with how it moves. RiggedMascot.tsx draws
 * them and agents.css ("rigged mascots") animates them.
 *
 * Each mascot plays the same kinds of moves in the same 12s loop, but in its
 * own order and at its own times, so cards side by side never move in step.
 * Arm angles stay inside the range each tracing was checked at, so a part
 * never shows a gap or leaves its card. A mascot that is not here keeps its
 * floating PNG.
 */

import appointments from "./art/appointments";
import bookkeeping from "./art/bookkeeping";
import contentWriter from "./art/content-writer";
import customerService from "./art/customer-service";
import personalAssistant from "./art/personal-assistant";
import research from "./art/research";
import sales from "./art/sales";
import socialMedia from "./art/social-media";
import type { Rig } from "./types";

export const RIGS: Record<string, Rig> = {
  // idle tilt → wave → jump → cheer
  "customer-service": {
    art: customerService,
    motion: {
      at: { tilt: 11.22, wave: 0.66, jump: 3.06, cheer: 4.86 },
      lean: 1,
      tilt: -3,
      arms: {
        armL: {
          wave: [-26, 12, -20],
          jump: [-8, -22],
          cheer: [13, 3],
          excited: [-24, 13],
        },
        armR: {
          wave: [-8, 0, 0],
          jump: [-10, -40],
          cheer: [-74, -54],
          excited: [-48, -76],
        },
      },
      blush: "#f7c6c1",
    },
  },
  // tilt → jump → cheer → wave → bag swing
  sales: {
    art: sales,
    motion: {
      at: { tilt: 0.5, jump: 1.8, cheer: 3.6, wave: 8.0, prop: 10.4 },
      lean: -1,
      tilt: 3,
      arms: {
        armL: {
          wave: [-4, 4, -3],
          jump: [-6, -12],
          cheer: [-14, -4],
          excited: [-12, 6],
        },
        armR: {
          wave: [-48, -18, -40],
          jump: [-8, -26],
          cheer: [-46, -26],
          excited: [-24, -48],
        },
      },
      prop: { heldBy: "armL", turn: 7, lift: 0, cheer: 0 },
      blush: "#ff4d6d",
    },
  },
  // tilt → calendar bounce → wave → jump → cheer
  appointments: {
    art: appointments,
    motion: {
      at: { tilt: 0.3, prop: 1.8, wave: 3.8, jump: 6.6, cheer: 8.4 },
      lean: 1,
      tilt: -3,
      arms: {
        armL: {
          wave: [17, -6, 12],
          jump: [6, 14],
          cheer: [14, 4],
          excited: [-6, 16],
        },
        armR: {
          wave: [-6, 4, -4],
          jump: [-4, -10],
          cheer: [-10, -2],
          excited: [6, -10],
        },
      },
      prop: { carries: true, turn: 4, lift: 12, cheer: 14 },
      blush: "#ff8fa3",
    },
  },
  // wave → calculator bounce → jump → cheer → tilt
  bookkeeping: {
    art: bookkeeping,
    motion: {
      at: { wave: 0.6, prop: 3.2, jump: 5.2, cheer: 7.0, tilt: 11.0 },
      lean: -1,
      tilt: 3,
      arms: {
        armL: {
          wave: [16, -20, 12],
          jump: [8, 14],
          cheer: [15, 5],
          excited: [-12, 15],
        },
        armR: {
          wave: [-6, 4, -4],
          jump: [-4, -8],
          cheer: [-10, -3],
          excited: [6, -8],
        },
      },
      prop: { carries: true, turn: 2, lift: 7, cheer: 6 },
      blush: "#ff7a8a",
    },
  },
  // clipboard wiggle → jump → cheer → wave → tilt
  "personal-assistant": {
    art: personalAssistant,
    motion: {
      at: { prop: 0.5, jump: 2.4, cheer: 4.2, wave: 8.2, tilt: 10.9 },
      lean: 1,
      tilt: -3,
      arms: {
        armL: {
          wave: [20, -14, 16],
          jump: [8, 16],
          cheer: [15, 4],
          excited: [-10, 20],
        },
        armR: {
          wave: [-4, 3, -2],
          jump: [-3, -6],
          cheer: [-8, -2],
          excited: [4, -8],
        },
      },
      prop: { heldBy: "armR", turn: 5, lift: 4, cheer: 0 },
      blush: "#ff5c8a",
    },
  },
  // jump → cheer → tilt → camera click → wave
  "social-media": {
    art: socialMedia,
    motion: {
      at: { jump: 0.4, cheer: 2.2, tilt: 6.2, prop: 7.6, wave: 9.4 },
      lean: -1,
      tilt: 3,
      arms: {
        armL: {
          wave: [8, 0, 5],
          jump: [4, 10],
          cheer: [10, -2],
          excited: [-2, 14],
        },
        armR: {
          wave: [11, 0, 9],
          jump: [3, 8],
          cheer: [12, 4],
          excited: [2, 11],
        },
      },
      prop: { turn: 2, lift: 5, cheer: 4 },
      blush: "#ff5a5f",
    },
  },
  // wave → tilt → jump → book bounce → cheer
  research: {
    art: research,
    motion: {
      at: { wave: 0.2, tilt: 2.9, jump: 4.4, prop: 6.8, cheer: 8.0 },
      lean: 1,
      tilt: -3,
      arms: {
        armL: {
          wave: [8, -6, 5],
          jump: [6, 12],
          cheer: [18, 6],
          excited: [-8, 16],
        },
        armR: {
          wave: [18, 4, 14],
          jump: [6, 12],
          cheer: [14, 4],
          excited: [4, 18],
        },
      },
      prop: { turn: 3, lift: 7, cheer: 6 },
      blush: "#ff7a59",
    },
  },
  // pencil wiggle → wave → cheer → tilt → jump
  "content-writer": {
    art: contentWriter,
    motion: {
      at: { prop: 0.4, wave: 2.0, cheer: 4.8, tilt: 8.8, jump: 9.6 },
      lean: -1,
      tilt: 3,
      arms: {
        armL: {
          wave: [8, -4, 6],
          jump: [4, 10],
          cheer: [12, 3],
          excited: [-4, 14],
        },
        armR: {
          wave: [-18, 6, -14],
          jump: [-6, -14],
          cheer: [-15, -5],
          excited: [-18, 4],
        },
      },
      prop: { heldBy: "armL", turn: 8, lift: 0, cheer: 0 },
      blush: "#ff8fb1",
    },
  },
};
