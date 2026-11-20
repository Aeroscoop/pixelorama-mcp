import assert from "node:assert/strict";
import { withPixelorama } from "./pixelorama.mjs";

await withPixelorama(async ({ call }) => {
  await call("new_project", { width: 8, height: 8, name: "Undo names" });
  await call("rename_layer", { layer: 0, name: "hulp" });
  await call("add_layer", { name: "grond" });
  await call("draw_pixels", { layer: 0, rows: ["X"], palette: { X: "#00f" } });
  await call("fill_rect", { layer: 1, color: "#f00" });
  const names = ["MCP fill_rect: grond", "MCP draw_pixels: hulp"];
  assert.deepEqual((await call("undo", { steps: 2 })).steps, names);
  assert.deepEqual((await call("redo", { steps: 2 })).steps, names.toReversed());
});
console.log("Pixelorama 1.2.4: both layer names and commands appear in undo and redo.");
