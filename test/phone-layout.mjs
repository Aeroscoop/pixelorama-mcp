import assert from "node:assert/strict";
import { withPixelorama } from "./pixelorama.mjs";

// The preview without the Starlite demo: a small custom layout and the Nestar default check.
await withPixelorama(async ({ call, rawCall }) => {
  await call("new_project", { width: 10, height: 20, name: "Other project" });
  await call("add_frame");
  await call("fill_rect", { frame: 0, color: "#ff0000" });
  await call("fill_rect", { frame: 1, color: "#0000ff" });
  await assert.rejects(call("preview_nestar_phone", { day_frame: 0, night_frame: 1 }), /expects a 112 × 216 canvas/);
  const layout = { canvas_width: 10, canvas_height: 20, scale: 2, chrome_height: 10, min_scene_height: 5 };
  const [metadata, image] = await rawCall("preview_nestar_phone", { day_frame: 0, night_frame: 1, width: 16, height: 30, ...layout });
  const geometry = JSON.parse(metadata.text);
  assert.deepEqual(geometry.crop, { x: 2, y: 20, width: 16, height: 20 });
  assert.deepEqual(geometry.per_panel, { width: 16, height: 20 });
  assert.equal(geometry.pixel_scale, 2);
  assert.deepEqual(geometry.layout, layout);
  const png = Buffer.from(image.data, "base64");
  assert.equal(png.readUInt32BE(16), 32);
  assert.equal(png.readUInt32BE(20), 20);
  await assert.rejects(call("preview_nestar_phone", { day_frame: 0, night_frame: 1, width: 21, ...layout }), /phone width of 1–20/);

  // A frame instead of a fixed bottom: the crop centers on the frame, clamped to the canvas.
  const phone = { day_frame: 0, night_frame: 1, width: 16, height: 30, ...layout };
  const framed = async (frame) => JSON.parse((await rawCall("preview_nestar_phone", { ...phone, ...frame }))[0].text);
  const top = await framed({ frame_x: 0, frame_y: 0, frame_width: 4, frame_height: 5 });
  assert.deepEqual(top.crop, { x: 0, y: 0, width: 16, height: 20 });
  assert.deepEqual(top.frame, { x: 0, y: 0, width: 4, height: 5 });
  const middle = await framed({ frame_x: 6, frame_y: 8, frame_width: 4, frame_height: 6 });
  assert.deepEqual(middle.crop, { x: 4, y: 12, width: 16, height: 20 });
  await assert.rejects(framed({ frame_x: 0, frame_y: 0, frame_width: 10, frame_height: 5 }), /does not fit/);
  await assert.rejects(framed({ frame_x: 0, frame_y: 0, frame_width: 4 }), /together/);
  await assert.rejects(framed({ frame_x: 8, frame_y: 0, frame_width: 4, frame_height: 5 }), /inside the 10 × 20 canvas/);
  assert.equal(geometry.frame, null);
});
console.log("Pixelorama 1.2.4: phone preview with a custom layout, a frame and the Nestar default check passed.");
