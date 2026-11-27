import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withPixelorama } from "./pixelorama.mjs";

// load_nestar_references with another canvas, other ids and own names, without the Starlite demo.
const rgba = (width, height, color) => Buffer.alloc(width * height * 4, Buffer.from(color)).toString("base64");
const asset = (x, y, color) => ({ x, y, width: 2, height: 3, rgba: rgba(2, 3, color) });
const data = {
  version: 1, canvas: { width: 16, height: 12 }, group: "Schetsen", names: { boom: "Boom (ref)" },
  day: { boom: asset(1, 2, [0, 160, 0, 255]), lamp: asset(10, 4, [255, 220, 0, 255]) },
  night: { boom: asset(1, 2, [0, 60, 30, 255]), lamp: asset(10, 4, [255, 120, 0, 255]) },
};

await withPixelorama(async ({ call, work }) => {
  const file = join(work, "refs.json");
  await writeFile(file, JSON.stringify(data));
  await call("new_project", { width: 112, height: 216, name: "Wrong size" });
  await call("add_frame");
  await assert.rejects(call("load_nestar_references", { day_frame: 0, night_frame: 1, data_path: file }), /need a 16 × 12 canvas/);

  await call("new_project", { width: 16, height: 12, name: "Other project" });
  await call("add_frame");
  const args = { day_frame: 0, night_frame: 1, data_path: file };
  const loaded = await call("load_nestar_references", args);
  assert.equal(loaded.group, "Schetsen");
  assert.deepEqual(loaded.assets.map(({ id, name }) => [id, name]), [["boom", "Boom (ref)"], ["lamp", "Lamp"]]);
  const { layers } = await call("list_layers");
  const group = layers.find(({ name }) => name === "Schetsen");
  const refs = layers.filter(({ parent_index }) => parent_index === group.index);
  assert.deepEqual(refs.map(({ name }) => name).sort(), ["Boom (ref)", "Lamp"]);
  const lamp = refs.find(({ name }) => name === "Lamp").index;
  const day = await call("read_pixels", { layer: lamp, frame: 0, x: 10, y: 4, width: 2, height: 3 });
  const night = await call("read_pixels", { layer: lamp, frame: 1, x: 10, y: 4, width: 2, height: 3 });
  assert.deepEqual(Object.values(day.palette), ["#ffdc00"]);
  assert.deepEqual(Object.values(night.palette), ["#ff7800"]);
  assert.equal((await call("load_nestar_references", args)).changed, false);

  const other = { ...data, day: { boom: data.day.boom }, night: { boom: data.night.boom } };
  await writeFile(file, JSON.stringify(other));
  await assert.rejects(call("load_nestar_references", args), /holds other references/);
  await writeFile(file, JSON.stringify({ ...data, night: { boom: data.night.boom } }));
  await assert.rejects(call("load_nestar_references", args), /same reference ids/);
});
console.log("Pixelorama 1.2.4: custom canvas, references, names, refresh and mismatch checks passed.");
