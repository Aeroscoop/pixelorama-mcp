import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { withPixelorama } from "./pixelorama.mjs";

assert(process.env.NESTAR_DEMO_DIR, "Set NESTAR_DEMO_DIR to the starlite/demo checkout");
const demo = resolve(process.env.NESTAR_DEMO_DIR);
const world = createRequire(import.meta.url)(join(demo, "wereld.js"));
const css = await readFile(join(demo, "style.css"), "utf8");
assert.match(css, /--nav-h: calc\(60px \+ max\(8px, var\(--safe-b\)\)\)/);
assert.match(css, /\.wereld \{[^}]+100dvh - var\(--nav-h\) - 64px[^}]+min-height: 480px/);
assert.match(css, /\.wereld-vlak \{[^}]+left: 50%; bottom: 0; width: 448px; height: 864px; transform: translateX\(-50%\)/);

await withPixelorama(async ({ call, rawCall, work }) => {
  await call("new_project", { width: world.W, height: world.H, name: "Nestar demo backgrounds" });
  await call("add_frame");
  const backgrounds = [];
  for (const frame of [0, 1]) {
    let data;
    world.teken({ getContext: () => ({
      createImageData: (w, h) => ({ data: new Uint8Array(w * h * 4) }),
      putImageData: (image) => { data = Buffer.from(image.data); },
    }) }, frame === 1);
    const colors = new Map();
    const rows = [];
    for (let y = 0; y < world.H; y++) {
      let row = "";
      for (let x = 0; x < world.W; x++) {
        const i = (y * world.W + x) * 4;
        const color = "#" + data.subarray(i, i + 3).toString("hex");
        if (!colors.has(color)) colors.set(color, "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[colors.size]);
        row += colors.get(color);
      }
      rows.push(row);
    }
    const palette = Object.fromEntries([...colors].map(([color, symbol]) => [symbol, color]));
    await call("draw_pixels", { frame, rows, palette });
    const path = join(work, `demo-${frame}.rgba`);
    await writeFile(path, data);
    backgrounds.push(path);
  }
  for (const width of [390, 320]) {
    const args = { day_frame: 0, night_frame: 1, width, height: 844 };
    const [metadata, image] = await rawCall("preview_nestar_phone", args);
    const geometry = JSON.parse(metadata.text);
    const offset = (448 - width) / 2;
    assert.deepEqual(geometry.crop, { x: offset, y: 152, width, height: 712 });
    assert.equal(geometry.pixel_scale, 4);
    const png = join(work, `preview-${width}.png`);
    await writeFile(png, Buffer.from(image.data, "base64"));
    execFileSync("python3", ["-c", `
from pathlib import Path
from PIL import Image
import sys
width, offset = map(int, sys.argv[1:3])
preview = Image.open(sys.argv[3]).convert("RGBA")
assert preview.size == (width * 2, 712)
for i, path in enumerate(sys.argv[4:]):
    demo = Image.frombytes("RGBA", (112, 216), Path(path).read_bytes())
    crop = demo.resize((448, 864), Image.Resampling.NEAREST).crop((offset, 152, offset + width, 864))
    assert preview.crop((width * i, 0, width * (i + 1), 712)).tobytes() == crop.tobytes()
`, width, offset, png, ...backgrounds]);
  }
});
console.log("Pixelorama 1.2.4: both phone crops match all pixels in the Starlite demo backgrounds.");
