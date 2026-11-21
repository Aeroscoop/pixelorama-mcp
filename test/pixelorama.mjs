import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export async function withPixelorama(run, prepare = async () => {}) {
  assert(process.env.PIXELORAMA_BIN, "Set PIXELORAMA_BIN to the Pixelorama 1.2.4 executable");
  const executable = resolve(process.env.PIXELORAMA_BIN);
  const work = await mkdtemp(join(tmpdir(), "pixelorama-mcp-"));
  const profile = join(work, "data", "pixelorama");
  const env = {
    ...process.env,
    XDG_DATA_HOME: dirname(profile),
    XDG_CACHE_HOME: join(work, "cache"),
    XDG_CONFIG_HOME: join(work, "config"),
    PIXELORAMA_DATA_DIR: profile,
    PIXELORAMA_MCP_PORT: "7651",
  };
  await mkdir(env.XDG_CACHE_HOME);
  const cli = (action, script = "scripts/install-extension.mjs") => JSON.parse(
    execFileSync(process.execPath, [script, action], { env, encoding: "utf8" }),
  );
  const client = new Client({ name: "pixelorama-smoke-test", version: "1.0.0" });
  let editor;
  let log = "";
  try {
    const port = createServer();
    port.listen(7651, "127.0.0.1");
    await once(port, "listening");
    await new Promise((ok, fail) => port.close((err) => err ? fail(err) : ok()));
    await prepare({ cli, work, profile });
    cli("install");
    cli("enable");
    editor = spawn(executable, ["--headless"], {
      cwd: dirname(executable), env, stdio: ["ignore", "pipe", "pipe"],
    });
    editor.on("error", (err) => { log += err.message; });
    for (const stream of [editor.stdout, editor.stderr]) {
      stream.setEncoding("utf8").on("data", (chunk) => { log += chunk; });
    }
    let installed;
    const deadline = Date.now() + 30_000;
    do {
      assert.equal(editor.exitCode, null, "Pixelorama exited during startup");
      assert(Date.now() < deadline, "The installed extension did not respond within 30 seconds");
      await delay(150);
      installed = cli("status");
    } while (installed.restart_required);
    assert.equal(installed.editor_version, "v1.2.4-stable");
    await client.connect(new StdioClientTransport({
      command: process.execPath, args: ["dist/index.js"], env: { PIXELORAMA_MCP_PORT: "7651" },
    }));
    const rawCall = async (name, args = {}) => {
      const result = await client.callTool({ name, arguments: args });
      if (result.isError) throw new Error(result.content[0].text);
      return result.content;
    };
    const call = async (name, args) => JSON.parse((await rawCall(name, args))[0].text);
    await run({ cli, call, rawCall, work, profile, installed, editor });
  } catch (error) {
    console.error(log);
    throw error;
  } finally {
    await client.close();
    if (editor?.pid && editor.exitCode === null && editor.signalCode === null) {
      const exited = once(editor, "exit");
      editor.kill();
      await exited;
    }
    await rm(work, { recursive: true, force: true });
  }
}
