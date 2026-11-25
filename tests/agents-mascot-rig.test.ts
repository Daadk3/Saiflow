/**
 * The /agents mascots are drawn as SVG parts (RiggedMascot + rigs/) so they
 * can blink, glance, follow the cursor, wave, jump, cheer and move their
 * props. These checks keep every drawing intact, every mascot on its own
 * timing within the same 12s loop, the motion cheap and polite, and reduced
 * motion completely still.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENTS } from "@/components/agents/agents-data";
import { RIGS } from "@/components/agents/rigs";
import {
  CS_ARM_PIVOT,
  CS_ARM_R_PIVOT,
  CS_EYES,
  CS_PATHS,
} from "@/components/agents/customer-service-paths";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const component = read("components/agents/RiggedMascot.tsx");
const view = read("components/agents/AgentsView.tsx");
const detail = read("components/agents/AgentDetail.tsx");
const css = read("components/agents/agents.css");
const rigFiles = readdirSync(resolve(ROOT, "components/agents/rigs/art")).map(
  (f) => read(`components/agents/rigs/art/${f}`),
);

const IDS = Object.keys(RIGS);
const MOVES = ["tilt", "wave", "jump", "cheer", "prop"] as const;

function keyframes(name: string): string {
  const start = css.indexOf(`@keyframes ${name} {`);
  assert.ok(start >= 0, `missing @keyframes ${name}`);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error(`unclosed @keyframes ${name}`);
}

const rigKeyframes = [...css.matchAll(/@keyframes (rig-[a-z-]+) \{/g)].map(
  (m) => m[1],
);

describe("which mascots are rigged", () => {
  test("all eight catalogue mascots are drawn as parts", () => {
    assert.deepEqual(
      [...IDS].sort(),
      AGENTS.map((a) => a.id).sort(),
      "every agent has a rig (one that could not be traced would keep its PNG)",
    );
  });

  test("the catalogue and the agent page use the rig, and keep the PNG as a fallback", () => {
    for (const file of [view, detail]) {
      assert.match(file, /RIGS\[agent\.id\] \?/);
      assert.match(file, /<RiggedMascot/);
      assert.match(file, /<Mascot/);
    }
    assert.equal((view.match(/<RiggedMascot/g) ?? []).length, 1);
  });

  test("the hero group shot stays as floating PNGs", () => {
    const hero = view.slice(
      view.indexOf("agents-stage-slot"),
      view.indexOf("agents-filters"),
    );
    assert.doesNotMatch(hero, /RiggedMascot/);
    assert.match(hero, /<Mascot/);
  });
});

describe("each traced drawing", () => {
  for (const id of IDS) {
    const { art, motion } = RIGS[id];

    test(`${id}: every layer is a closed path inside the 900×900 box`, () => {
      assert.ok(art.layers.length >= 6, `${id}: ${art.layers.length} layers`);
      for (const [part, colour, d] of art.layers) {
        assert.match(part, /^(body|armL|armR|prop|head)$/);
        assert.match(colour, /^#[0-9a-f]{6}$/);
        assert.match(d, /^M-?\d/);
        assert.match(d, /Z$/);
        for (const n of d.match(/-?\d+(\.\d+)?/g)!.map(Number)) {
          assert.ok(n >= -5 && n <= 905, `${id}: ${n}`);
        }
      }
    });

    test(`${id}: body, both arms and the prop are separate parts`, () => {
      const parts = new Set<string>(art.layers.map(([part]) => part));
      for (const part of ["body", "armL", "armR"]) {
        assert.ok(parts.has(part), `${id}: ${part}`);
      }
      // Customer Service holds nothing; its headphones ride on its head.
      if (id === "customer-service") assert.ok(parts.has("head"));
      else assert.ok(parts.has("prop"), `${id}: prop`);
      const limbs = parts.has("prop")
        ? (["armL", "armR", "prop"] as const)
        : (["armL", "armR"] as const);
      for (const part of limbs) {
        const pivot = art.pivots[part];
        assert.ok(pivot, `${id}: ${part} pivot`);
        for (const v of pivot!) assert.ok(v > 0 && v < 900, `${id}: ${part}`);
      }
      assert.ok(
        art.pivots.armL![0] < art.pivots.armR![0],
        `${id}: each arm on its own side`,
      );
    });

    test(`${id}: two eyes and a mouth on the face`, () => {
      assert.equal(art.eyes.length, 2);
      const [a, b] = [...art.eyes].sort((p, q) => p.cx - q.cx);
      assert.ok(b.cx - a.cx > 80 && b.cx - a.cx < 260, `${id}: eye gap`);
      for (const e of art.eyes) {
        assert.ok(e.cy > 200 && e.cy < 450, `${id}: eye height`);
        assert.ok(e.rx > 8 && e.rx < 60 && e.ry > 5 && e.ry < 60, `${id}`);
      }
      const [x0, y0, x1, y1] = art.mouth.box;
      assert.ok(x0 < x1 && y0 < y1);
      assert.ok(y0 > Math.min(a.cy, b.cy), `${id}: mouth below the eyes`);
      assert.match(art.mouth.d, /^M[\s\S]*Z$/);
    });

    test(`${id}: the cheeks get a colour that shows on the body`, () => {
      assert.match(motion.blush, /^#[0-9a-f]{6}$/);
      assert.notEqual(motion.blush.toLowerCase(), art.bodyColour.toLowerCase());
    });

    if (id !== "customer-service") {
      test(`${id}: traced from its own PNG by the shared tracer`, () => {
        const config = JSON.parse(read(`scripts/agents/rigs/${id}.json`));
        assert.ok(existsSync(resolve(ROOT, "public/agents", config.src)));
        const file = read(`components/agents/rigs/art/${id}.ts`);
        assert.match(file, /by scripts\/agents\/trace_mascot\.py/);
        assert.ok(file.includes(config.src));
      });
    }
  }

  test("Customer Service keeps its hand-tuned paths", () => {
    assert.equal(CS_EYES.length, 2);
    assert.ok(Object.keys(CS_PATHS).length >= 15);
    const cs = RIGS["customer-service"].art;
    assert.deepEqual(cs.pivots.armL, [...CS_ARM_PIVOT]);
    assert.deepEqual(cs.pivots.armR, [...CS_ARM_R_PIVOT]);
    assert.ok(cs.layers.some(([, , d]) => d === CS_PATHS.bandOuter));
  });
});

describe("each mascot's own show", () => {
  test("every move starts inside the 12s loop", () => {
    for (const id of IDS) {
      const { at } = RIGS[id].motion;
      for (const move of MOVES) {
        const s = at[move];
        if (move === "prop" && s === undefined) continue;
        assert.ok(
          typeof s === "number" && s >= 0 && s < 12,
          `${id}: ${move} ${s}`,
        );
      }
    }
  });

  test("no two mascots play their moves in the same order or at the same times", () => {
    const orders = IDS.map((id) => {
      const at = RIGS[id].motion.at;
      return MOVES.filter((m) => at[m] !== undefined)
        .sort((a, b) => at[a]! - at[b]!)
        .join(">");
    });
    assert.equal(new Set(orders).size, IDS.length, orders.join(" | "));
    const waves = IDS.map((id) => RIGS[id].motion.at.wave);
    assert.equal(new Set(waves).size, IDS.length);
  });

  test("a mascot's wave, jump and cheer never play on top of each other", () => {
    // From the keyframes: the wave takes 2.4s; a cheer may start 1.8s into
    // a jump (as it lands); the cheer takes 3.8s.
    const span = { wave: 2.4, jump: 1.8, cheer: 3.8 };
    for (const id of IDS) {
      const at = RIGS[id].motion.at;
      const moves = (["wave", "jump", "cheer"] as const).map((m) => [
        at[m],
        at[m] + span[m],
      ]);
      for (let i = 0; i < moves.length; i++) {
        for (let j = 0; j < moves.length; j++) {
          if (i === j) continue;
          const [a0, a1] = moves[i];
          for (const shift of [-12, 0, 12]) {
            const b0 = moves[j][0] + shift;
            assert.ok(
              b0 >= a1 - 0.01 || b0 + 0.01 <= a0,
              `${id}: moves ${i} and ${j} overlap`,
            );
          }
        }
      }
    }
  });

  test("arm and prop moves stay small, so every part stays joined and inside its card", () => {
    for (const id of IDS) {
      const { arms, prop } = RIGS[id].motion;
      assert.ok(arms.armL && arms.armR, `${id}: both arms move`);
      for (const arm of [arms.armL!, arms.armR!]) {
        for (const a of [
          ...arm.wave,
          ...arm.jump,
          ...arm.cheer,
          ...arm.excited,
        ]) {
          assert.ok(Math.abs(a) <= 80, `${id}: ${a}deg`);
        }
      }
      if (id !== "customer-service") assert.ok(prop, `${id}: prop moves`);
      if (prop) {
        assert.ok(Math.abs(prop.turn) <= 15, id);
        assert.ok(prop.lift <= 20 && prop.cheer <= 20, id);
      }
    }
  });
});

describe("the component", () => {
  test("splits a mascot into parts that move on their own", () => {
    for (const part of [
      "rig-hop",
      "rig-breathe",
      "rig-face",
      "rig-eye",
      "rig-look",
      "rig-glance",
      "rig-lid",
      "rig-joy",
      "rig-blush",
      "rig-smile",
      "rig-shadow",
    ]) {
      assert.match(component, new RegExp(`["\`]${part}[ "\`]`), part);
    }
    for (const chain of ["arm", "prop", "head", "eyes", "mouth", "sway"]) {
      assert.ok(component.includes(`part="${chain}"`), chain);
    }
  });

  test("is a labelled image the same size as the PNG it replaces", () => {
    assert.match(component, /role="img"/);
    assert.match(component, /aria-label=\{label\}/);
    assert.match(component, /viewBox="0 0 900 900"/);
    assert.match(component, /width=\{width\}\s+height=\{width\}/);
  });

  test("follows the cursor only with a mouse, on screen, and not with reduced motion", () => {
    assert.match(component, /\(hover: hover\) and \(pointer: fine\)/);
    assert.match(component, /prefers-reduced-motion: reduce/);
    assert.match(component, /pointerType !== "mouse"/);
    assert.match(component, /IntersectionObserver/);
    assert.match(component, /requestAnimationFrame/);
    assert.match(component, /removeEventListener\("pointermove"/);
  });

  test("pauses while off screen", () => {
    assert.match(component, /dataset\.offscreen = "true"/);
    assert.match(
      css,
      /\.rig\[data-offscreen\] \* \{\s*animation-play-state: paused;/,
    );
  });
});

describe("the motion", () => {
  test("animates transform and opacity only", () => {
    assert.ok(rigKeyframes.length > 40, `${rigKeyframes.length} keyframes`);
    for (const name of rigKeyframes) {
      const props = [...keyframes(name).matchAll(/^\s*([a-z-]+):/gm)].map(
        (m) => m[1],
      );
      assert.ok(props.length > 0, name);
      for (const prop of props) {
        assert.ok(
          prop === "transform" || prop === "opacity",
          `${name}: ${prop}`,
        );
      }
    }
  });

  test("every move runs on the same 12s loop, started at each mascot's own time", () => {
    assert.match(css, /\.rig \{\s*--show: 12s;/);
    assert.match(
      css,
      /\.rig :is\(\.rig-t, \.rig-w, \.rig-j, \.rig-c, \.rig-p\) \{\s*animation-duration: var\(--show\);[\s\S]*?animation-iteration-count: infinite;/,
    );
    for (const m of ["t", "w", "j", "c", "p"]) {
      assert.match(
        css,
        new RegExp(
          `\\.rig \\.rig-${m} \\{\\s*animation-delay: var\\(--at-${m}\\);`,
        ),
      );
      assert.ok(component.includes(`"--at-${m}"`), m);
    }
    // Every show keyframe is used by a move group.
    for (const name of rigKeyframes.filter((n) => /-[twjcp]$/.test(n))) {
      assert.match(css, new RegExp(`animation-name: ${name};`), name);
    }
  });

  test("jumps stay low, so a mascot never leaves its card or reaches the pills", () => {
    // Jumps are a share of the mascot width: 0.045 is about 8px on a card.
    for (const name of ["rig-hop-w", "rig-hop-j", "rig-hop-c", "rig-hop-x"]) {
      const jumps = [
        ...keyframes(name).matchAll(
          /translateY\(calc\(var\(--w\) \* -([\d.]+)\)\)/g,
        ),
      ];
      assert.ok(jumps.length > 0, name);
      for (const [, k] of jumps) assert.ok(Number(k) <= 0.045, `${name}: ${k}`);
    }
    for (const name of ["rig-sway-c", "rig-sway-x"]) {
      for (const [, x] of keyframes(name).matchAll(/translate\((-?\d+)px,/g)) {
        assert.ok(Math.abs(Number(x)) <= 20, `${name}: ${x}`);
      }
    }
  });

  test("no 3D turn or flip anywhere: the flat drawings never rotate in 3D", () => {
    for (const source of [css, component, ...rigFiles]) {
      assert.doesNotMatch(
        source,
        /rotateY|rotateX|rotate3d|perspective|scaleX\(-|rig-turn|rig-spin|cs-turn|cs-spin/,
      );
    }
    assert.match(keyframes("rig-hop-j"), /translateY\(calc\(var\(--w\) \* -/);
  });

  test("leans and squashes on landing", () => {
    assert.match(
      keyframes("rig-sway-j"),
      /13\.5% \{\s*transform: translate\(calc\(var\(--lean\) \* -\d+px\), 0\)\s*rotate\(calc\(var\(--lean\) \* -[1-9][\d.]*deg\)\)/,
    );
    assert.match(
      keyframes("rig-hop-j"),
      /13\.5% \{\s*transform: translateY\(0\) scale\(1\.1\d*, 0\.8\d*\)/,
    );
  });

  test("the happy face shows in the wave, the jump and the cheer", () => {
    for (const m of ["w", "j", "c"]) {
      assert.match(keyframes(`rig-smile-${m}`), /opacity: 1/);
      assert.match(keyframes(`rig-mouth-${m}`), /opacity: 0/);
      assert.match(keyframes(`rig-blush-${m}`), /opacity: 0\.\d+/);
    }
    for (const m of ["j", "c"]) {
      assert.match(keyframes(`rig-joy-${m}`), /opacity: 1/);
      assert.match(keyframes(`rig-eyes-${m}`), /opacity: 0/);
    }
  });

  test("gets extra excited on hover and on keyboard focus", () => {
    for (const cond of [":hover", ":has\\(:focus-visible\\)"]) {
      const card = `:is\\(\\.agents-card, \\.agents-detail-card\\)${cond}\\s+\\.rig\\s+`;
      assert.match(
        css,
        new RegExp(
          `${card}:is\\(\\.rig-t, \\.rig-w, \\.rig-j, \\.rig-c, \\.rig-p\\) \\{\\s*animation-name: none;`,
        ),
      );
      for (const [part, anim] of [
        ["hop", "rig-hop-x"],
        ["sway", "rig-sway-x"],
        ["head", "rig-head-x"],
        ["arm", "rig-arm-x"],
        ["prop", "rig-prop-x"],
        ["shadow", "rig-shadow-x"],
      ]) {
        assert.match(
          css,
          new RegExp(`${card}\\.rig-${part}\\.rig-x \\{\\s*animation: ${anim}`),
          `${cond} ${part}`,
        );
      }
      assert.match(
        css,
        new RegExp(
          `${card}:is\\(\\.rig-joy, \\.rig-smile\\)\\.rig-c \\{\\s*opacity: 1;`,
        ),
      );
    }
    // Hover is only for devices that really hover, so a tap doesn't leave it stuck.
    assert.match(
      css,
      /@media \(hover: hover\) \{\s*:is\(\.agents-card, \.agents-detail-card\):hover\s+\.rig/,
    );
  });

  test("reduced motion holds every mascot completely still", () => {
    const reduced = css.slice(
      css.indexOf("@media (prefers-reduced-motion: reduce)"),
    );
    assert.match(
      reduced,
      /\.agents-page \.rig \*,\s*\.agents-page \.rig \{\s*animation: none !important;\s*transition: none !important;/,
    );
    assert.match(
      reduced,
      /\.rig :is\(\.rig-look, \.rig-face\) \{\s*transform: none !important/,
    );
    assert.match(
      reduced,
      /\.rig :is\(\.rig-joy, \.rig-smile, \.rig-blush\) \{\s*opacity: 0 !important/,
    );
    assert.match(
      reduced,
      /\.rig :is\(\.rig-eyes, \.rig-mouth\) \{\s*opacity: 1 !important/,
    );
  });
});
