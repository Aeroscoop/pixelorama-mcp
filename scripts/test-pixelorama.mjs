import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFile, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withPixelorama } from "../test/pixelorama.mjs";

const preferences = "[preferences]\n\ndefault_width=32\n\n[extensions]\n\nUnrelatedExtension=true\n";
await withPixelorama(async ({ cli, call, work, profile, installed, editor }) => {
  assert.equal(installed.enabled, true);
  assert.deepEqual(installed.in_editor, installed.on_disk);
  assert.equal((await call("get_project")).width, 32);
  await call("new_project", { name: "MCP smoke test", width: 8, height: 8 });
  await call("draw_pixels", { rows: ["XY", ".Y"], palette: { X: "#0000ff", Y: "#ff0000" } });
  const original = await call("read_pixels", { width: 2, height: 2 });

  const settings = await call("get_drawing_settings");
  await call("set_drawing_settings", { show_grid: !settings.show_grid });
  assert.deepEqual(await call("get_drawing_settings"), { ...settings, show_grid: !settings.show_grid });
  await call("set_drawing_settings", settings);

  const next = join(work, "next");
  await mkdir(next);
  await cp("scripts", join(next, "scripts"), { recursive: true });
  await cp("extension", join(next, "extension"), { recursive: true });
  await appendFile(join(next, "extension/src/Extensions/PixeloramaMCP/commands.gd"), "\n# Second build\n");
  execFileSync(process.execPath, [join(next, "scripts/pack-extension.mjs")]);
  const installer = join(next, "scripts/install-extension.mjs");
  const updated = cli("install", installer);
  assert.notEqual(updated.on_disk.build, installed.on_disk.build);
  assert.deepEqual(updated.in_editor, installed.in_editor);
  assert.equal(updated.restart_required, true);
  assert.deepEqual(cli("install", installer), updated);
  assert.deepEqual(await call("read_pixels", { width: 2, height: 2 }), original);
  assert.equal((await call("get_project")).name, "MCP smoke test");

  const disabled = cli("disable");
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.editor_responding, false);
  assert.deepEqual(cli("disable"), disabled);
  assert.equal(editor.exitCode, null);
  await assert.rejects(call("get_project"), /Cannot reach Pixelorama|Connection to Pixelorama closed/);
  const config = await readFile(join(profile, "config.ini"), "utf8");
  assert.match(config, /^UnrelatedExtension=true$/m);
  assert.match(config, /^default_width=32$/m);
  assert.equal(await readFile(join(profile, "extensions", "unrelated.txt"), "utf8"), "unchanged");
}, async ({ cli, profile }) => {
  assert.equal(cli("status").on_disk, null);
  await mkdir(join(profile, "extensions"), { recursive: true });
  await writeFile(join(profile, "extensions", "unrelated.txt"), "unchanged");
  await writeFile(join(profile, "config.ini"), preferences);
  assert.equal(cli("install").enabled, false);
  assert.equal(cli("enable").restart_required, true);
  assert.equal(await readFile(join(profile, "config.ini"), "utf8"),
    preferences.replace("[extensions]\n", "[extensions]\nPixeloramaMCP=true\n"));
});
console.log("Pixelorama 1.2.4: install, enable, drawing settings, live update and disable passed.");
