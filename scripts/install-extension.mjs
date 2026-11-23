// Manage only the ZIP and configuration key for our Pixelorama extension.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { dirname, join, normalize, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const commands = ["install", "status", "enable", "disable"];
const action = process.argv[2] ?? "install";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const profile = resolve(process.env.PIXELORAMA_DATA_DIR || join(dataDir(), "pixelorama"));
const configPath = join(profile, "config.ini");
const zipPath = join(profile, "extensions", "PixeloramaMCP.zip");
const port = Number(process.env.PIXELORAMA_MCP_PORT ?? 7651);

function dataDir() {
  switch (process.platform) {
    case "darwin":
      return join(homedir(), "Library", "Application Support");
    case "win32":
      return process.env.APPDATA || join(homedir(), "AppData", "Roaming");
    default:
      return process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  }
}

function read(path, encoding) {
  try {
    return readFileSync(path, encoding);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return null;
  }
}

function replaceFile(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = path + "." + randomUUID() + ".tmp";
  try {
    writeFileSync(temp, data, { flag: "wx", mode: statSync(path, { throwIfNoEntry: false })?.mode ?? 0o600 });
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}

// Read the manifest from the central directory (also works with ZIPs repacked in the editor).
function buildInfo(zip) {
  if (!zip) return null;
  const unknown = { version: null, build: null };
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0 || end + 22 > zip.length) return unknown;
  let offset = zip.readUInt32LE(end + 16);
  while (offset + 46 <= end && zip.readUInt32LE(offset) === 0x02014b50) {
    const length = zip.readUInt16LE(offset + 28);
    const name = zip.toString("utf8", offset + 46, offset + 46 + length);
    if (name === "src/Extensions/PixeloramaMCP/extension.json") {
      const local = zip.readUInt32LE(offset + 42);
      if (local + 30 > zip.length || zip.readUInt32LE(local) !== 0x04034b50) break;
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + zip.readUInt32LE(offset + 20));
      try {
        const method = zip.readUInt16LE(offset + 10);
        if (method !== 0 && method !== 8) break;
        const manifest = JSON.parse(method === 0 ? data : inflateRawSync(data, { maxOutputLength: 65536 }));
        if (manifest.name === "PixeloramaMCP") {
          return { version: manifest.version ?? null, build: manifest.build ?? null };
        }
      } catch {
        return unknown;
      }
      break;
    }
    offset += 46 + length + zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32);
  }
  return unknown;
}

function extensionPreference(config, enabled) {
  const lines = config.split(/(?<=\n)/);
  let extensionSection = false;
  let insert = -1;
  let found = false;
  let current = false;
  const lineBreak = config.includes("\r\n") ? "\r\n" : "\n";
  for (const [index, line] of lines.entries()) {
    const section = /^\s*\[([^\]\r\n]+)\]\s*(?:;[^\r\n]*)?$/.exec(line);
    if (section) {
      extensionSection = section[1] === "extensions";
      if (extensionSection) insert = index + 1;
    } else if (extensionSection) {
      const match = /^(\s*PixeloramaMCP\s*=\s*)(true|false)([^\r\n]*)(\r?\n)?$/.exec(line);
      if (match) {
        found = true;
        current = match[2] === "true";
        if (enabled !== undefined) lines[index] = match[1] + enabled + match[3] + (match[4] ?? "");
      } else if (/^\s*PixeloramaMCP\s*=/.test(line)) {
        throw new Error("Invalid PixeloramaMCP entry in config.ini.");
      }
    }
  }
  if (enabled === undefined) return current;
  if (!found && enabled) {
    const entry = "PixeloramaMCP=true" + lineBreak;
    if (insert === -1) return config + (config ? lineBreak : "") + "[extensions]" + lineBreak + entry;
    const prefix = lines[insert - 1].endsWith("\n") ? "" : lineBreak;
    lines.splice(insert, 0, prefix + entry);
  }
  return lines.join("");
}

function request(method) {
  return new Promise((resolveReply) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let response = "";
    const finish = (reply) => {
      socket.destroy();
      resolveReply(reply);
    };
    socket.setTimeout(700, () => finish(null));
    socket.on("error", () => finish(null));
    socket.on("end", () => finish(null));
    socket.on("connect", () => socket.write(JSON.stringify({ id: 1, method }) + "\n"));
    socket.setEncoding("utf8").on("data", (chunk) => {
      response += chunk;
      const newline = response.indexOf("\n");
      if (response.length > 65536) return finish(null);
      if (newline < 0) return;
      try {
        const reply = JSON.parse(response.slice(0, newline));
        finish(reply.id === 1 ? reply : null);
      } catch {
        finish(null);
      }
    });
  });
}

function sameProfile(path) {
  if (typeof path !== "string") return false;
  const canonical = process.platform === "win32" ? (p) => normalize(p).toLowerCase() : normalize;
  return canonical(path) === canonical(profile);
}

// true, false, or null when the process list cannot be read.
function pixeloramaRunning() {
  if (process.env.PIXELORAMA_MCP_ASSUME_CLOSED === "1") return false;
  try {
    if (process.platform === "win32") {
      const tasks = execFileSync("tasklist", ["/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true });
      return /^"pixelorama[^"]*\.exe"/im.test(tasks);
    }
    // comm is the executable name (Linux truncates it to 15 characters, macOS gives the full path).
    const names = execFileSync("ps", ["-A", "-o", "comm="], { encoding: "utf8" });
    return names.split("\n").some((name) => /(^|\/)pixelorama/i.test(name.trim()));
  } catch {
    return null;
  }
}

async function status() {
  const on_disk = buildInfo(read(zipPath));
  const enabled = extensionPreference(read(configPath, "utf8") ?? "");
  const reply = await request("extension_status");
  const current = reply?.result;
  const loaded = sameProfile(current?.profile);
  const legacy = reply?.error === "Unknown method: extension_status";
  const editor_responding = loaded || legacy;
  const in_editor = loaded ? { version: current.version, build: current.build } : null;
  return {
    profile, on_disk, enabled, editor_responding, in_editor,
    editor_version: loaded ? current.editor_version : null,
    restart_required: enabled ? !loaded || !on_disk?.build || on_disk.build !== in_editor.build : editor_responding,
    ...(legacy && { note: "An older extension is responding. It cannot report its profile or build." }),
    ...(current && !loaded && { note: "The responding extension belongs to a different Pixelorama profile." }),
  };
}

try {
  if (!commands.includes(action) || process.argv.length > 3) {
    throw new Error("Usage: node scripts/install-extension.mjs [install|status|enable|disable]");
  }
  if (action === "install") {
    const zip = read(join(root, "dist", "PixeloramaMCP.zip"));
    if (!buildInfo(zip)?.build) throw new Error("Run npm run build to create dist/PixeloramaMCP.zip first.");
    if (!read(zipPath)?.equals(zip)) replaceFile(zipPath, zip);
  } else if (action === "enable" || action === "disable") {
    const enable = action === "enable";
    if (enable && !read(zipPath)) throw new Error("Install the extension first.");
    const config = read(configPath, "utf8") ?? "";
    if (extensionPreference(config) !== enable) {
      const live = await request("extension_status");
      if (!enable && sameProfile(live?.result?.profile)) {
        const reply = await request("extension_disable");
        if (!reply?.result?.disabled) throw new Error(reply?.error ?? "Pixelorama did not confirm disable.");
        // The extension drops its listener on the next frame after acknowledging the command.
        for (let attempt = 0; attempt < 10 && (await request("extension_status")); attempt++) await delay(80);
      } else {
        // Pixelorama keeps its preferences in memory and writes them back on exit,
        // so a change made while it runs would be lost.
        const running = live?.error === "Unknown method: extension_status" || pixeloramaRunning();
        if (running !== false) {
          throw new Error(running === null
            ? "Cannot check whether Pixelorama is running. Close Pixelorama and rerun with PIXELORAMA_MCP_ASSUME_CLOSED=1."
            : "Save your work and close Pixelorama before changing this preference. Then rerun the command.");
        }
        replaceFile(configPath, extensionPreference(config, enable));
      }
    }
  }
  console.log(JSON.stringify(await status(), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
