/**
 * The Customer Service mascot is drawn as SVG parts (CustomerServiceMascot)
 * so it can blink, glance, follow the cursor, wave and step. These checks
 * keep the drawing intact, the motion cheap and polite, and the other seven
 * mascots on their PNGs.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CS_ARM_PIVOT, CS_EYES, CS_PATHS } from "@/components/agents/customer-service-paths";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const component = read("components/agents/CustomerServiceMascot.tsx");
const view = read("components/agents/AgentsView.tsx");
const detail = read("components/agents/AgentDetail.tsx");
const css = read("components/agents/agents.css");

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

describe("the traced drawing", () => {
  const parts = [
    "armOuter",
    "armInner",
    "bodyOuter",
    "bodyInner",
    "bandOuter",
    "band",
    "cupLOuter",
    "cupLPink",
    "cupLGray",
    "cupROuter",
    "cupRPink",
    "cupRGray",
    "mouth",
  ] as const;

  test("has every part as a closed path inside the 900×900 art box", () => {
    assert.deepEqual(Object.keys(CS_PATHS).sort(), [...parts].sort());
    for (const key of parts) {
      const d = CS_PATHS[key];
      assert.match(d, /^M-?\d/, key);
      assert.match(d, /Z$/, key);
      const numbers = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
      assert.ok(numbers.length > 20, key);
      for (const n of numbers) assert.ok(n >= -5 && n <= 905, `${key}: ${n}`);
    }
  });

  test("has two eyes left of and right of the middle, and an arm pivot at the shoulder", () => {
    assert.equal(CS_EYES.length, 2);
    const [left, right] = CS_EYES;
    assert.ok(left[0] < 450 && right[0] > 450);
    for (const [, cy, rx, ry] of CS_EYES) {
      assert.ok(cy > 300 && cy < 400);
      assert.ok(rx > 15 && rx < 35 && ry > 15 && ry < 35);
    }
    assert.ok(CS_ARM_PIVOT[0] > 150 && CS_ARM_PIVOT[0] < 260);
    assert.ok(CS_ARM_PIVOT[1] > 450 && CS_ARM_PIVOT[1] < 560);
  });

  test("uses the PNG's palette", () => {
    for (const colour of ["#001824", "#15b4bb", "#f7c6c1", "#4c575b"]) {
      assert.ok(component.includes(colour), colour);
    }
  });
});

describe("the component", () => {
  test("splits the mascot into parts that can move on their own", () => {
    for (const part of [
      "cs-walk",
      "cs-breathe",
      "cs-arm",
      "cs-arm-wave",
      "cs-body",
      "cs-head",
      "cs-face",
      "cs-eye cs-eye-l",
      "cs-eye cs-eye-r",
      "cs-look",
      "cs-glance",
      "cs-lid",
      "cs-pupil",
      "cs-mouth-rest",
      "cs-mouth-happy",
      "cs-headphones",
    ]) {
      assert.ok(component.includes(`"${part}"`), part);
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
});

describe("only Customer Service uses the rig", () => {
  test("the catalog and the agent page swap it in for that one agent", () => {
    for (const file of [view, detail]) {
      assert.match(file, /agent\.id === "customer-service" \?/);
      assert.match(file, /<CustomerServiceMascot/);
      assert.match(file, /<Mascot/);
    }
    assert.equal((view.match(/<CustomerServiceMascot/g) ?? []).length, 1);
  });
});

describe("the motion", () => {
  const names = [
    "cs-breathe",
    "cs-blink",
    "cs-blink-double",
    "cs-glance",
    "cs-tilt",
    "cs-arm-hi",
    "cs-wave",
    "cs-step",
    "cs-shadow-step",
  ];

  test("animates transform and opacity only", () => {
    for (const name of names) {
      const props = [...keyframes(name).matchAll(/^\s*([a-z-]+):/gm)].map((m) => m[1]);
      assert.ok(props.length > 0, name);
      for (const prop of props) assert.ok(prop === "transform" || prop === "opacity", `${name}: ${prop}`);
    }
  });

  test("the step stays small, so the mascot never leaves its card or covers text", () => {
    const moves = [...keyframes("cs-step").matchAll(/translate\((-?\d+)px,\s*(-?\d+)px\)/g)];
    assert.ok(moves.length > 0);
    for (const [, x, y] of moves) {
      assert.ok(Math.abs(Number(x)) <= 30, `x ${x}`);
      assert.ok(Math.abs(Number(y)) <= 15, `y ${y}`);
    }
  });

  test("waves and smiles on hover and on keyboard focus", () => {
    assert.match(css, /\.agents-card:hover \.cs-arm-wave/);
    assert.match(css, /\.agents-card:has\(:focus-visible\) \.cs-arm-wave/);
    assert.match(css, /\.agents-card:has\(:focus-visible\) \.cs-mouth-happy/);
  });

  test("reduced motion holds it completely still", () => {
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    assert.match(reduced, /\.cs-rig \*[\s\S]*animation: none !important/);
    assert.match(reduced, /transition: none !important/);
    assert.match(reduced, /\.cs-rig \.cs-look[\s\S]*transform: none !important/);
    assert.match(reduced, /\.cs-rig \.cs-mouth-happy \{\s*opacity: 0 !important/);
  });
});
