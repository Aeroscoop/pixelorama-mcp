import assert from "node:assert/strict";
import { mkdir, symlink, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withPixelorama } from "./pixelorama.mjs";
import { Connection } from "../dist/connection.js";

await withPixelorama(async ({ call, work }) => {
  assert.equal((await call("get_project")).path_check, "off");
  assert.equal((await call("save_project", { path: join(work, "unrestricted.pxo") })).path,
    join(work, "unrestricted.pxo"));
});

await withPixelorama(async ({ call, work }) => {
  const root = join(work, "allowed");
  assert.equal((await call("get_project")).path_check, root);
  await call("new_project", { width: 8, height: 8 });
  const project = join(root, "test.pxo");
  const png = join(root, "test.png");
  await call("save_project", { path: project });
  await call("export_png", { path: png });
  assert.equal((await call("open_file", { path: project })).save_path, project);

  await symlink(work, join(root, "link"));
  await writeFile(join(work, "untouched"), "outside");
  await symlink(join(work, "untouched"), project + "1");
  const outside = /Path outside the allowed folder/;
  await assert.rejects(call("save_project", { path: project }), outside);
  assert.equal(await readFile(join(work, "untouched"), "utf8"), "outside");
  const tcp = new Connection("127.0.0.1", 7651);
  try {
    for (const [method, ext] of [["save_project", "pxo"], ["export_png", "png"], ["open_file", "pxo"]]) {
      for (const prefix of [work, root + "/..", root + "/link", root + "-sibling"]) {
        await assert.rejects(tcp.request(method, { path: prefix + "/outside." + ext }), outside);
      }
    }
  } finally {
    tcp.close();
  }
}, async ({ profile, work }) => {
  const root = join(work, "allowed");
  await mkdir(root);
  await mkdir(profile, { recursive: true });
  await writeFile(join(profile, "pixelorama-mcp.json"), JSON.stringify({ root }));
});

console.log("Pixelorama 1.2.4: optional path restriction, traversal, links and save sibling passed.");
