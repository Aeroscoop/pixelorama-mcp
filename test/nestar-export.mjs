import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { withPixelorama } from "./pixelorama.mjs";

assert(process.env.NESTAR_DEMO_DIR, "Set NESTAR_DEMO_DIR to the starlite/demo checkout");
const demo = resolve(process.env.NESTAR_DEMO_DIR);
const propsPath = join(demo, "props.js");
const source = createRequire(import.meta.url)(propsPath);
const browserProps = await readFile(propsPath, "utf8");
const item = source.ITEMS.pakje;

await withPixelorama(async ({ call, work }) => {
  await call("new_project", { width: 20, height: 20, name: "Pakje" });
  const region = { layer: 0, frame: 0, x: 2, y: 3, width: item.rows[0].length, height: item.rows.length };
  await call("draw_pixels", { layer: 0, x: region.x, y: region.y, rows: item.rows, palette: item.pal });
  await call("add_layer", { name: "Other layer" });
  await call("fill_rect", { layer: 1, color: "#00ff00" });
  const allowed_colors = Object.values(item.pal);
  const path = join(work, "allowed", "pakje.json");
  const exportResult = await call("export_nestar_asset", { ...region, allowed_colors, path });
  const { path: returnedPath, ...asset } = exportResult;
  assert.equal(returnedPath, path);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), asset);
  assert.equal(asset.rows.length, item.rows.length);
  assert(asset.rows.every((row) => row.length === item.rows[0].length));
  assert.deepEqual(asset.rows.map((row) => row.replace(/[^.]/g, "X")),
    item.rows.map((row) => row.replace(/[^.]/g, "X")));

  const context = { NestarTekeningen: { pakje: asset } };
  runInNewContext(browserProps, context);
  const pixels = (draw) => {
    const drawn = [];
    draw((x, y, color) => drawn.push([x, y, color.toUpperCase()]), "pakje", 0, 0);
    return drawn;
  };
  assert.deepEqual(pixels(context.NestarProps.drawItem), pixels(source.drawItem));
  await assert.rejects(call("export_nestar_asset", { ...region, path: join(work, "outside.json") }), /Path outside the allowed folder/);
  await assert.rejects(call("export_nestar_asset", { ...region, x: 19 }), /outside the 20 × 20 canvas/);
  await assert.rejects(call("export_nestar_asset", { ...region, allowed_colors: ["#abcdef"] }), /Pixel \(6, 3\).*outside allowed_colors/);
  await call("fill_rect", { layer: 0, x: 2, y: 3, width: 1, height: 1, color: "#abcdef80" });
  await assert.rejects(call("export_nestar_asset", { ...region, path }), /Pixel \(2, 3\) has alpha 128/);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), asset);
}, async ({ profile, work }) => {
  const root = join(work, "allowed");
  await mkdir(root);
  await mkdir(profile, { recursive: true });
  await writeFile(join(profile, "pixelorama-mcp.json"), JSON.stringify({ root }));
});

console.log("Pixelorama 1.2.4: package round-trip, dimensions, palette, transparency, isolated layer and path policy passed.");
