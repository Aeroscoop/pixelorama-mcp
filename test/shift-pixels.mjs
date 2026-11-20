import assert from "node:assert/strict";
import { withPixelorama } from "./pixelorama.mjs";

await withPixelorama(async ({ call }) => {
  await call("new_project", { width: 8, height: 4, name: "Shift example" });
  const initial = ["R.BG....", "........"];
  const palette = { R: "#f00", B: "#00f", G: "#0f0" };
  await call("draw_pixels", { rows: initial, palette });
  const read = async () => {
    const image = await call("read_pixels", { width: 8, height: 2 });
    const lookup = { ".": ".", "#ff0000": "R", "#0000ff": "B", "#00ff00": "G" };
    return image.rows.map((row) => [...row].map((ch) => lookup[image.palette[ch] ?? ch]).join(""));
  };
  const rect = { x: 0, y: 0, width: 3, height: 1, to_x: 1, to_y: 0 };
  await call("move_selection", rect);
  assert.deepEqual(await read(), [".R.B....", "........"]);
  await call("undo");
  assert.deepEqual(await read(), initial);
  await call("copy_selection", { ...rect, to_x: 4 });
  assert.deepEqual(await read(), ["R.BGR.B.", "........"]);
  await call("shift_layer", { dx: -1, dy: 1 });
  assert.deepEqual(await read(), ["........", ".BGR.B.."]);
  assert.match((await call("undo")).steps[0], /MCP shift_layer:/);
  assert.deepEqual(await read(), ["R.BGR.B.", "........"]);
  await assert.rejects(call("move_selection", { ...rect, width: 10 }), /source rectangle/);
});
console.log("Pixelorama 1.2.4: copy, overlapping move, transparency, clipping and undo passed.");
