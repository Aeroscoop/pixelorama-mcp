import assert from "node:assert/strict";
import { withPixelorama } from "./pixelorama.mjs";

await withPixelorama(async ({ call }) => {
  await call("new_project", { width: 8, height: 8, name: "Branch and scarf" });
  await call("add_frame");
  await call("add_frame");
  const read = (frame) => call("read_pixels", { frame, width: 4, height: 4 });
  const initial = await Promise.all([0, 1, 2].map(read));
  const draw = { rows: ["A.", ".A"], frames: [
    { frame: 0, palette: { A: "#fc0" } },
    { frame: 1, palette: { A: "#def" } },
  ] };
  await assert.rejects(call("draw_pixels_in_frames", {
    ...draw, frames: [draw.frames[0], { ...draw.frames[1], frame: 99 }],
  }), /Invalid frame/);
  assert.deepEqual(await read(0), initial[0]);
  await call("draw_pixels_in_frames", draw);
  const day = await read(0);
  const night = await read(1);
  assert.deepEqual(day.rows, night.rows);
  assert.notDeepEqual(day.palette, night.palette);
  assert.deepEqual(await read(2), initial[2]);

  await call("shift_layer_in_frames", { frames: [0, 1], dx: 0, dy: 1 });
  assert.equal((await read(0)).rows[1], day.rows[0]);
  assert.equal((await read(1)).rows[1], night.rows[0]);
  assert.deepEqual(await read(2), initial[2]);
  await call("undo");
  assert.deepEqual(await read(0), day);
  assert.deepEqual(await read(1), night);
  await call("undo");
  assert.deepEqual(await Promise.all([0, 1, 2].map(read)), initial);
});
console.log("Pixelorama 1.2.4: atomic frame validation, per-frame colors, batched shift and undo passed.");
