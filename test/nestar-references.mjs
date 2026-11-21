import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withPixelorama } from "./pixelorama.mjs";

assert(process.env.NESTAR_DEMO_DIR, "Set NESTAR_DEMO_DIR to the starlite/demo checkout");
const args = { day_frame: 0, night_frame: 1 };
let fixture;
await withPixelorama(async ({ call, work }) => {
  await call("new_project", { width: 112, height: 216, name: "Briefscène" });
  await call("rename_layer", { layer: 0, name: "Brievenbus (schets)" });
  await call("draw_pixels", {
    x: 18, y: 157, frame: 0, rows: ["..MMMM..", ".MMMMMM.", ".MMMMMM.", "MMMMMMMM", "...MM...", "...MM...", "...MM..."],
    palette: { M: "#774322" },
  });
  await call("add_frame");
  const read = ({ x, y, width, height }, layer, frame) => call("read_pixels", { layer, frame, x, y, width, height });

  const loaded = await call("load_nestar_references", args);
  assert.equal(loaded.changed, true);
  assert.deepEqual(loaded.assets.map(({ id, x, y, width, height }) => [id, x, y, width, height]), [
    ["diertje", 24, 129, 64, 50], ["sterrenpot", 69, 122, 30, 40],
    ["pakje", 25, 163, 14, 12], ["brief", 24, 151, 16, 12],
  ]);
  assert.deepEqual((await call("undo")).steps, ["MCP load_nestar_references"]);
  assert.equal((await call("list_layers")).layers.length, 1);
  await call("redo");
  const { layers } = await call("list_layers");
  const group = layers.find(({ name }) => name === loaded.group);
  assert.equal(group.type, "group");
  const refs = layers.filter(({ parent_index }) => parent_index === group.index);
  assert.equal(refs.length, 4);
  assert(refs.every(({ locked }) => locked));
  for (const details of loaded.assets) {
    const { index } = refs.find(({ name }) => name === details.name);
    for (const frame of [0, 1]) {
      const readback = await read(details, index, frame);
      assert(readback.rows.some((row) => /[^.]/.test(row)));
    }
  }
  const pot = loaded.assets[1];
  const { index: potLayer } = refs.find(({ name }) => name === pot.name);
  const day = await read(pot, potLayer, 0);
  assert.notDeepEqual((await read(pot, potLayer, 1)).palette, day.palette);
  await call("set_layer_visibility", { name: "Brief", visible: false });
  await call("set_layer_visibility", { name: group.name, visible: false });
  const invisible = (await call("list_layers")).layers.filter(({ parent_index }) => parent_index === group.index);
  assert(invisible.every(({ visible_in_hierarchy }) => !visible_in_hierarchy));

  assert.equal((await call("load_nestar_references", args)).changed, false);
  const data = JSON.parse(await readFile(fixture, "utf8"));
  data.day.sterrenpot.rgba = data.night.sterrenpot.rgba;
  await writeFile(fixture, JSON.stringify(data));
  assert.equal((await call("load_nestar_references", args)).changed, true);
  assert.equal((await call("list_layers")).layers.length, layers.length);
  assert.notDeepEqual((await read(pot, potLayer, 0)).palette, day.palette);
  await call("undo");
  assert.deepEqual(await read(pot, potLayer, 0), day);
  await call("set_layer_visibility", { name: group.name, visible: true });
  const letter = (await call("list_layers")).layers.find(({ name }) => name === "Brief");
  assert.equal(letter.visible, false);
  assert.match((await read({ x: 18, y: 157, width: 8, height: 7 }, 0, 0)).rows[0], /AAAA/);
  const sketch = join(work, "mailbox.pxo");
  await call("save_project", { path: sketch });
  await call("open_file", { path: sketch });
  assert.equal((await call("load_nestar_references", args)).changed, true);
  assert.equal((await call("list_layers")).layers.length, layers.length);
  const dark = await read(pot, potLayer, 1);
  assert.deepEqual(await read(pot, potLayer, 0), { ...dark, frame: 0 });
}, async ({ work }) => {
  fixture = join(work, "nestar-references.json");
  const source = execFileSync(process.execPath, ["scripts/export-nestar-references.mjs", process.env.NESTAR_DEMO_DIR]);
  await writeFile(fixture, source);
  return { NESTAR_REFERENCE_DATA: fixture };
});
console.log("Pixelorama 1.2.4: actual demo references, mailbox sketch, visibility and refresh passed.");
