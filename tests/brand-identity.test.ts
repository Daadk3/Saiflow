/**
 * Brand identity: the flow S is SaiFlow's formal logo, the ghost mascot is
 * its personality.
 *
 * The lockup checks read source, like the homepage suite. The artwork checks
 * decode the shipped image bytes, so "no white box around the S" and "every
 * browser icon is the S" are asserted on the real files, not on intent.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const bytes = (p: string) => readFileSync(resolve(ROOT, p));
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

type Png = { width: number; height: number; channels: number; pixel: (x: number, y: number) => number[] };

/** Decodes an 8-bit, non-interlaced RGB or RGBA PNG. */
function decodePng(buf: Buffer): Png {
  assert.equal(buf.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "PNG signature");
  let off = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString("ascii");
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, "8-bit channels");
      assert.equal(data[12], 0, "not interlaced");
      assert.ok(data[9] === 2 || data[9] === 6, `RGB or RGBA, got colour type ${data[9]}`);
      channels = data[9] === 6 ? 4 : 3;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[y * stride + x - channels] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0;
      let p = 0;
      if (filter === 1) p = a;
      else if (filter === 2) p = b;
      else if (filter === 3) p = (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else assert.equal(filter, 0, `unknown PNG filter ${filter}`);
      out[y * stride + x] = (raw[y * (stride + 1) + 1 + x] + p) & 0xff;
    }
  }
  const pixel = (x: number, y: number) => [...out.subarray(y * stride + x * channels, y * stride + (x + 1) * channels)];
  return { width, height, channels, pixel };
}

/** The PNG frames inside an .ico file. */
function icoFrames(buf: Buffer) {
  assert.equal(buf.readUInt16LE(0), 0, "ICO reserved field");
  assert.equal(buf.readUInt16LE(2), 1, "ICO type is icon");
  return Array.from({ length: buf.readUInt16LE(4) }, (_, i) => {
    const entry = 6 + i * 16;
    const size = buf.readUInt32LE(entry + 8);
    const offset = buf.readUInt32LE(entry + 12);
    return { declared: buf[entry] || 256, png: decodePng(buf.subarray(offset, offset + size)) };
  });
}

function pixels(png: Png) {
  const all: number[][] = [];
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) all.push(png.pixel(x, y));
  return all;
}

const isTeal = ([r, g, b]: number[]) => g - r >= 60 && b - r >= 60;

/**
 * Nothing boxes the S in. The corners are clear, the canvas around the S is
 * clear, no solid pixel anywhere is white or near-white, and wherever the S
 * reaches the edge of a trimmed or full-bleed image it is the S's turquoise.
 */
function assertNoWhiteBox(png: Png, label: string) {
  assert.equal(png.channels, 4, `${label} has an alpha channel`);
  const w = png.width - 1;
  const h = png.height - 1;
  for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h]]) {
    assert.equal(png.pixel(x, y)[3], 0, `${label} corner (${x},${y}) is transparent`);
  }
  const all = pixels(png);
  const clear = all.filter((p) => p[3] === 0).length / all.length;
  assert.ok(clear > 0.15, `${label} is transparent around the S (${clear.toFixed(2)} clear)`);
  const pale = all.filter(([r, g, b, a]) => a >= 128 && Math.min(r, g, b) >= 230);
  assert.equal(pale.length, 0, `${label} has no solid white or near-white pixels`);
  for (let x = 0; x <= w; x++) {
    for (const y of [0, h]) {
      const p = png.pixel(x, y);
      assert.ok(p[3] < 64 || isTeal(p), `${label} edge pixel (${x},${y}) is clear or the S`);
    }
  }
  for (let y = 0; y <= h; y++) {
    for (const x of [0, w]) {
      const p = png.pixel(x, y);
      assert.ok(p[3] < 64 || isTeal(p), `${label} edge pixel (${x},${y}) is clear or the S`);
    }
  }
}

/** Visible pixels are the S's turquoise: green and blue well above red. */
function assertTurquoise(png: Png, label: string) {
  const solid = pixels(png).filter((p) => png.channels === 3 || p[3] >= 200);
  assert.ok(solid.filter(isTeal).length > 0, `${label} shows the symbol`);
}

describe("the formal logo is the S symbol and the SaiFlow wordmark", () => {
  const logo = strip(read("components/BrandLogo.tsx"));

  test("one lockup links home with the S artwork and the exact wordmark", () => {
    assert.ok(/<Link href="\/"/.test(logo), "links to the homepage");
    assert.ok(logo.includes('src="/brand/saiflow-symbol.png"'), "uses the supplied S artwork");
    assert.ok(/alt=""/.test(logo) && /aria-hidden="true"/.test(logo), "the symbol is decorative");
    assert.ok(/>SaiFlow<\/span>/.test(logo), "the wordmark reads SaiFlow, capital F");
    assert.ok(!/mascot/i.test(logo), "the mascot is not part of the logo");
  });

  test("the lockup is never mirrored in Arabic", () => {
    assert.ok(/<Link href="\/" dir="ltr"/.test(logo));
  });

  test("header and footer both render it, without the mascot or the old spelling", () => {
    for (const file of ["components/Navbar.tsx", "components/Footer.tsx"]) {
      const code = strip(read(file));
      assert.equal(code.split("<BrandLogo />").length - 1, 1, `${file} renders the lockup once`);
      assert.ok(!/mascot/i.test(code), `${file} keeps the mascot out of the logo`);
      assert.ok(!/>\s*Saiflow\s*</.test(code), `${file} no longer shows the old wordmark`);
    }
  });
});

describe("the S artwork has no white box", () => {
  const symbol = decodePng(bytes("public/brand/saiflow-symbol.png"));

  test("transparent all round, with nothing white behind the S", () => {
    assertNoWhiteBox(symbol, "saiflow-symbol.png");
    assertTurquoise(symbol, "saiflow-symbol.png");
  });

  test("trimmed to the symbol alone", () => {
    let top = symbol.height;
    let bottom = 0;
    let left = symbol.width;
    let right = 0;
    for (let y = 0; y < symbol.height; y++) {
      for (let x = 0; x < symbol.width; x++) {
        if (symbol.pixel(x, y)[3] === 0) continue;
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }
    for (const [edge, gap] of [
      ["top", top],
      ["bottom", symbol.height - 1 - bottom],
      ["left", left],
      ["right", symbol.width - 1 - right],
    ] as const) {
      assert.ok(gap <= 2, `${edge} whitespace is trimmed, found ${gap}px`);
    }
    const ratio = symbol.width / symbol.height;
    assert.ok(ratio > 0.85 && ratio < 1, `the S alone, no wordmark beside it (ratio ${ratio.toFixed(2)})`);
  });
});

describe("browser and app icons are the S alone", () => {
  test("favicon.ico holds 16, 32 and 48 px frames of the S on transparency", () => {
    const frames = icoFrames(bytes("app/favicon.ico"));
    assert.deepEqual(frames.map((f) => f.png.width), [16, 32, 48]);
    for (const { declared, png } of frames) {
      assert.equal(png.width, declared);
      assert.equal(png.height, declared);
      assertNoWhiteBox(png, `favicon ${declared}px`);
      assertTurquoise(png, `favicon ${declared}px`);
    }
  });

  test("icon.png is the S on transparency, the same file in app/ and public/", () => {
    assert.ok(bytes("app/icon.png").equals(bytes("public/icon.png")));
    const icon = decodePng(bytes("app/icon.png"));
    assert.equal(icon.width, icon.height);
    assertNoWhiteBox(icon, "icon.png");
    assertTurquoise(icon, "icon.png");
  });

  test("apple-icon.png is the S on the site's own dark background", () => {
    const apple = decodePng(bytes("app/apple-icon.png"));
    assert.equal(apple.width, 180);
    assert.equal(apple.height, 180);
    assert.equal(apple.channels, 3, "opaque, so iOS adds no black of its own");
    for (const [x, y] of [[0, 0], [179, 0], [0, 179], [179, 179]]) {
      assert.deepEqual(apple.pixel(x, y), [10, 10, 10], "the corner matches #0a0a0a");
    }
    assertTurquoise(apple, "apple-icon.png");
  });

  test("the old lightning-bolt SVG icon is gone and nothing points at it", () => {
    assert.ok(!existsSync(resolve(ROOT, "app/icon.svg")));
    assert.ok(!existsSync(resolve(ROOT, "public/icon.svg")));
    const layout = read("app/layout.tsx");
    assert.ok(!layout.includes("icon.svg"));
    for (const href of ["/favicon.ico", "/icon.png", "/apple-icon.png"]) {
      assert.ok(layout.includes(`"${href}"`), `layout still declares ${href}`);
    }
  });
});

describe("the ghost mascot stays SaiFlow's personality", () => {
  test("the mascot artwork still ships", () => {
    for (const file of ["mascot", "mascot-camera", "mascot-headphones", "mascot-reading", "mascot-shopping", "mascot-tablet"]) {
      assert.ok(existsSync(resolve(ROOT, `public/${file}.png`)), file);
    }
  });

  test("its placements outside the logo remain", () => {
    for (const [file, asset] of [
      ["components/home/CreatorValue.tsx", "/mascot-tablet.png"],
      ["components/home/Hero.tsx", "/mascot-headphones.png"],
      ["components/admin/MissionMascot.tsx", "/mascot.png"],
      ["app/dashboard/create-shop/page.tsx", "/mascot.png"],
      ["app/dashboard/shop/[slug]/add-product/page.tsx", "/mascot.png"],
      ["app/dashboard/shop/[slug]/edit/page.tsx", "/mascot.png"],
      ["app/dashboard/shop/[slug]/product/[productSlug]/edit/page.tsx", "/mascot.png"],
      ["app/blog/page.tsx", "/mascot.png"],
    ]) {
      assert.ok(read(file).includes(`"${asset}"`), `${file} keeps ${asset}`);
    }
  });
});
