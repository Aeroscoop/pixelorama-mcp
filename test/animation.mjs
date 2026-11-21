import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { Connection } from "../dist/connection.js";
import { withPixelorama } from "./pixelorama.mjs";

await withPixelorama(async ({ call }) => {
  await call("new_project", { width: 8, height: 8, name: "Blink" });
  await call("draw_pixels", { rows: ["EE", ".F"], palette: { E: "#00f", F: "#fc0" } });
  const rest = await call("read_pixels", { frame: 0, width: 2, height: 2 });
  await call("duplicate_frame", { frame: 0 });
  const duplicate = await call("read_pixels", { frame: 1, width: 2, height: 2 });
  assert.deepEqual(duplicate, { ...rest, frame: 1 });
  await call("draw_pixels", { frame: 1, rows: [".X"], palette: { X: "transparent" } });
  assert.deepEqual(await call("read_pixels", { frame: 0, width: 2, height: 2 }), rest);
  await call("add_frame", { after: 1 });
  await call("set_frame_duration", { frame: 0, seconds: 0.75 });
  await call("set_frame_duration", { frame: 1, seconds: 0.2 });
  const tagged = await call("set_animation_tag", { name: "Blink", first: 0, last: 1 });
  assert.deepEqual(tagged.tags, [{ name: "Blink", first: 0, last: 1 }]);
  assert.equal(tagged.durations_seconds[0], 0.75);
  assert.ok(Math.abs(tagged.durations_seconds[1] - 0.2) < 1e-6);
  const conn = new Connection("127.0.0.1", 7651);
  try {
    const without = await conn.request("get_image", { frame: 1, scale: 1 });
    await call("select_cel", { frame: 1, layer: 0 });
    const onion = await call("set_onion_skin", { enabled: true });
    assert.equal(onion.onion_skin, true);
    assert.equal(onion.onion_previous, 1);
    assert.equal(onion.onion_next, 0);
    assert.deepEqual(await conn.request("get_image", { frame: 1, scale: 1 }), without);
    await call("set_onion_skin", { enabled: false });
  } finally {
    conn.close();
  }

  const playback = await call("play_animation", { play: true, tag: "Blink" });
  assert.deepEqual(playback.playback, { playing: true, first: 0, last: 1 });
  assert.equal(playback.current_frame, 0);
  const seen = new Set();
  for (let i = 0; i < 30 && !seen.has(1); i++) {
    await delay(55);
    seen.add((await call("get_animation")).current_frame);
  }
  assert.deepEqual([...seen], [0, 1]);
  assert.equal((await call("play_animation", { play: false })).playback.playing, false);
});
console.log("Pixelorama 1.2.4: blink-frame duplication, tag, timing, onion skin and native playback passed.");
