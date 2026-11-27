// Run explicitly against a trusted local Aeroscoop/starlite demo checkout.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createContext, runInContext } from "node:vm";

if (!process.argv[2]) {
  console.error("Usage: node scripts/export-nestar-references.mjs <starlite/demo>");
  process.exit(1);
}
const demo = resolve(process.argv[2]);
const scale = 4;
const time = 1300;
const css = readFileSync(join(demo, "style.css"), "utf8");
const potStyle = /\.wereld \.pet-bol\s*\{[^}]*\bleft:\s*(\d+)px;[^}]*\bbottom:\s*(\d+)px;/.exec(css);
if (!potStyle) throw new Error("Cannot find the pot anchor in the demo's style.css");

function colorChannels(style) {
  const hex = /^#([0-9a-f]{6})$/i.exec(style);
  if (hex) return [...Buffer.from(hex[1], "hex"), 255];
  const rgba = /^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)$/.exec(style);
  if (!rgba) throw new Error(`Unsupported demo canvas color: ${style}`);
  return [...rgba.slice(1, 4).map(Number), 255 * Number(rgba[4])];
}

function canvas() {
  let pixels;
  const node = {
    width: 0, height: 0, style: {}, isConnected: true, offsetParent: {},
    closest: () => ({ clientWidth: 64 * scale }),
    getBoundingClientRect: () => ({ width: node.width }),
    getContext: () => ctx,
  };
  const ctx = {
    globalAlpha: 1,
    clearRect() { pixels = Buffer.alloc(node.width / scale * node.height / scale * 4); },
    fillRect(x, y, width, height) {
      if (width !== scale || height !== scale) throw new Error("Expected a single demo drawing pixel");
      const px = x / scale;
      const py = y / scale;
      if (px < 0 || py < 0 || px >= node.width / scale || py >= node.height / scale) return;
      const offset = (py * node.width / scale + px) * 4;
      const color = colorChannels(this.fillStyle);
      const src = color[3] / 255 * this.globalAlpha;
      const dst = pixels[offset + 3] / 255 * (1 - src);
      const alpha = src + dst;
      if (alpha === 0) return;
      for (let i = 0; i < 3; i++) pixels[offset + i] = Math.round((color[i] * src + pixels[offset + i] * dst) / alpha);
      pixels[offset + 3] = Math.round(alpha * 255);
    },
  };
  return {
    node,
    raster: () => ({ width: node.width / scale, height: node.height / scale, rgba: pixels.toString("base64") }),
  };
}

function capture(dark) {
  const actor = canvas();
  const pot = canvas();
  pot.node.parentNode = { querySelector: () => actor.node };
  let nextFrame;
  const ctx = createContext({
    performance: { now: () => time },
    matchMedia: () => ({ matches: true }),
    requestAnimationFrame: (callback) => { nextFrame = callback; },
    document: {
      documentElement: { getAttribute: () => dark ? "dark" : "light" },
      querySelectorAll: (selector) => selector === '.bol-canvas' ? [pot.node] : [actor.node],
    },
  });
  for (const file of ["wereld.js", "tekenmachine.js", "tekeningen.js", "props.js", "dier.js", "bol.js"]) {
    runInContext(readFileSync(join(demo, file), "utf8"), ctx, { filename: file, timeout: 5000 });
  }
  const { DIER: anchor } = ctx.NestarWereld;
  const model = { stage: "creature", name: "Pip", noise: 3 };
  const traits = () => ctx.NE.traitsFor(model.name, model.noise);
  ctx.NestarDier.set(model, traits);
  ctx.NestarDier.refresh();
  const creature = { ...anchor, ...actor.raster() };
  ctx.NestarBol.set(70, false);
  nextFrame(time);
  const potRaster = pot.raster();
  const jar = {
    x: anchor.x + Number(potStyle[1]) / scale - potRaster.width / 2,
    y: anchor.y + creature.height - Number(potStyle[2]) / scale - potRaster.height,
    ...potRaster,
  };

  const post = {};
  const sourceDrawItem = ctx.NestarProps.drawItem;
  ctx.NestarProps.drawItem = (_put, id, x, y) => {
    const item = ctx.NestarProps.ITEMS[id];
    const raster = canvas();
    raster.node.width = Math.max(...item.rows.map((row) => row.length)) * scale;
    raster.node.height = item.rows.length * scale;
    const drawing = raster.node.getContext();
    drawing.clearRect();
    sourceDrawItem((px, py, value) => {
      drawing.fillStyle = value;
      drawing.fillRect(px * scale, py * scale, scale, scale);
    }, id, 0, 0);
    post[id] = { x: anchor.x + x, y: anchor.y + y, ...raster.raster() };
  };
  ctx.NestarDier.set({ ...model, hint: "pakje", envelop: true }, traits);
  ctx.NestarDier.refresh();
  if (!post.pakje || !post.envelop) throw new Error("Cannot find package and letter positions in the demo");
  return { diertje: creature, sterrenpot: jar, pakje: post.pakje, brief: post.envelop };
}

console.log(JSON.stringify({ version: 1, day: capture(false), night: capture(true) }, null, 2));
