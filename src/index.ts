#!/usr/bin/env node
import { isAbsolute, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Connection } from "./connection.js";

const port = Number(process.env.PIXELORAMA_MCP_PORT ?? 7651);
const pixelorama = new Connection("127.0.0.1", port);
const server = new McpServer({ name: "pixelorama-mcp", version: "0.1.0" });

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const absolute = (path: string) => (isAbsolute(path) ? path : resolve(path));

const frame = z.number().int().min(0).optional().describe("Frame index, from 0. Defaults to the current frame");
const layer = z.number().int().min(0).optional().describe("Layer index, 0 is the bottom layer. Defaults to the current layer");
const color = z.string().describe('Color as #rgb, #rrggbb, #rrggbbaa, a name like "red", "transparent", or "@n" for slot n (from 0) of the selected palette');

server.registerTool(
  "get_project",
  {
    description: "Describe the project open in Pixelorama: size, frames, layers and the current cel.",
  },
  async () => json(await pixelorama.request("get_project")),
);

server.registerTool(
  "get_drawing_settings",
  { description: "Read the editor's canvas grid and pixel grid visibility." },
  async () => json(await pixelorama.request("get_drawing_settings")),
);

server.registerTool(
  "set_drawing_settings",
  {
    description: "Change the editor overlays for drawing. These settings affect the view only.",
    inputSchema: {
      show_grid: z.boolean().optional().describe("Show the configured canvas grid"),
      show_pixel_grid: z.boolean().optional().describe("Show individual pixel boundaries at high zoom"),
    },
  },
  async (args) => json(await pixelorama.request("set_drawing_settings", args)),
);

server.registerTool(
  "list_layers",
  {
    description:
      "List all layers in the active project from bottom to top, including group membership, eye state, " +
      "and whether the layer is visible through its parent groups.",
  },
  async () => json(await pixelorama.request("list_layers")),
);

server.registerTool(
  "set_layer_visibility",
  {
    description:
      "Set the eye state of a layer in the active project by its exact name. " +
      "Use list_layers and pass index to disambiguate duplicate names. " +
      "A change affects all frames and can be undone.",
    inputSchema: {
      name: z.string().min(1).describe("Exact layer name"),
      visible: z.boolean().describe("True shows the layer; false hides it"),
      index: z.number().int().min(0).optional().describe("Layer index if more than one layer has this name"),
    },
  },
  async (args) => json(await pixelorama.request("set_layer_visibility", args)),
);

server.registerTool(
  "new_project",
  {
    description: "Create a new, empty project in a new tab and switch to it.",
    inputSchema: {
      width: z.number().int().min(1).max(4096),
      height: z.number().int().min(1).max(4096),
      name: z.string().optional(),
    },
  },
  async (args) => json(await pixelorama.request("new_project", args)),
);

server.registerTool(
  "open_file",
  {
    description: "Open a .pxo project or an image (png, jpg, webp, bmp, tga) in a new tab.",
    inputSchema: { path: z.string().describe("Path to the file") },
  },
  async ({ path }) => json(await pixelorama.request("open_file", { path: absolute(path) })),
);

server.registerTool(
  "draw_pixels",
  {
    description:
      "Draw pixels from a character grid. Each string in rows is one row of pixels; each character is looked up " +
      "in palette. Characters that are not in the palette (such as '.') leave the pixel unchanged, so map a " +
      'character to "transparent" to erase. Example: palette {"o": "#e8a33d", "d": "#7a4a12"}, rows [".oo.", "oddo", ".oo."]. ' +
      "The whole call is one undo step in Pixelorama.",
    inputSchema: {
      rows: z.array(z.string()).min(1),
      palette: z.record(z.string().length(1), z.string()).describe("Single character -> color"),
      x: z.number().int().default(0).describe("Left edge of the grid on the canvas"),
      y: z.number().int().default(0).describe("Top edge of the grid on the canvas"),
      frame,
      layer,
    },
  },
  async (args) => json(await pixelorama.request("draw_pixels", args)),
);

server.registerTool(
  "fill_rect",
  {
    description: "Fill a rectangle with one color. Leave out the position and size to fill the whole canvas.",
    inputSchema: {
      color,
      x: z.number().int().optional(),
      y: z.number().int().optional(),
      width: z.number().int().min(1).optional(),
      height: z.number().int().min(1).optional(),
      frame,
      layer,
    },
  },
  async (args) => json(await pixelorama.request("fill_rect", args)),
);

server.registerTool(
  "clear_cel",
  {
    description: "Erase every pixel of one cel (a layer in a frame).",
    inputSchema: { frame, layer },
  },
  async (args) => json(await pixelorama.request("fill_rect", { ...args, color: "transparent" })),
);

const shiftCoordinate = z.number().int().min(-8192).max(8192);
const selectionInput = {
  x: shiftCoordinate.min(0), y: shiftCoordinate.min(0),
  width: shiftCoordinate.min(1), height: shiftCoordinate.min(1),
  to_x: shiftCoordinate, to_y: shiftCoordinate, frame, layer,
};
for (const command of ["move_selection", "copy_selection"] as const) {
  server.registerTool(command, {
    description: `${command === "move_selection" ? "Move" : "Copy"} a rectangle within a pixel cel. The destination includes transparent pixels and clips to the canvas.`,
    inputSchema: selectionInput,
  }, async (args) => json(await pixelorama.request(command, args)));
}

server.registerTool(
  "shift_layer",
  {
    description: "Shift the entire pixel layer in the selected frame by dx and dy, clipping pixels outside the canvas.",
    inputSchema: { dx: shiftCoordinate, dy: shiftCoordinate, frame, layer },
  },
  async (args) => json(await pixelorama.request("shift_layer", args)),
);

server.registerTool(
  "draw_pixels_in_frames",
  {
    description: "Draw one pixel pattern across selected frames in one undo step. Supply each frame's own palette.",
    inputSchema: {
      rows: z.array(z.string()).min(1),
      x: z.number().int().default(0), y: z.number().int().default(0), layer,
      frames: z.array(z.object({
        frame: z.number().int().min(0),
        palette: z.record(z.string().length(1), z.string()),
      })).min(1),
    },
  },
  async (args) => json(await pixelorama.request("draw_pixels_in_frames", args)),
);

server.registerTool(
  "shift_layer_in_frames",
  {
    description: "Shift the layer by the same amount in selected frames. All changes share one undo step.",
    inputSchema: { frames: z.array(z.number().int().min(0)).min(1), dx: shiftCoordinate, dy: shiftCoordinate, layer },
  },
  async (args) => json(await pixelorama.request("shift_layer_in_frames", args)),
);

server.registerTool(
  "read_pixels",
  {
    description:
      "Read pixels of one cel as a character grid with a palette, in the same format draw_pixels takes. " +
      "'.' is transparent. At most 16384 pixels per call.",
    inputSchema: {
      x: z.number().int().min(0).optional(),
      y: z.number().int().min(0).optional(),
      width: z.number().int().min(1).optional(),
      height: z.number().int().min(1).optional(),
      frame,
      layer,
    },
  },
  async (args) => json(await pixelorama.request("read_pixels", args)),
);

server.registerTool(
  "get_image",
  {
    description: "Show a frame with all visible layers blended, scaled up with nearest-neighbour so pixels stay sharp.",
    inputSchema: {
      frame,
      scale: z.number().int().min(1).max(64).optional().describe("Zoom factor. Defaults to about 512 px on the long side"),
    },
  },
  async (args) => {
    const image = await pixelorama.request<{ png: string }>("get_image", args);
    return { content: [{ type: "image" as const, data: image.png, mimeType: "image/png" }] };
  },
);

server.registerTool(
  "preview_nestar_phone",
  {
    description: "Compare day (left) and night (right) frames as a phone shows them: scaled up, centered and bottom-aligned. Defaults are the Nestar demo (112 × 216 canvas, 4×, 390 × 844 phone); override the layout for another size or project, and pass a frame (frame_x, frame_y, frame_width, frame_height) for a world whose bottom is not fixed.",
    inputSchema: {
      day_frame: z.number().int().min(0),
      night_frame: z.number().int().min(0),
      width: z.number().int().min(1).optional().describe("Phone width in CSS px, default 390 (at most the scaled canvas)"),
      height: z.number().int().min(1).max(4000).optional().describe("Phone height in CSS px, default 844"),
      canvas_width: z.number().int().min(1).max(4096).optional().describe("Expected canvas width, default 112"),
      canvas_height: z.number().int().min(1).max(4096).optional().describe("Expected canvas height, default 216"),
      scale: z.number().int().min(1).max(16).optional().describe("CSS px per canvas pixel, default 4"),
      chrome_height: z.number().int().min(0).max(1000).optional().describe("Phone height taken by navigation and margins, default 132"),
      min_scene_height: z.number().int().min(1).max(4000).optional().describe("Smallest visible scene height, default 480"),
      frame_x: z.number().int().min(0).optional().describe("Frame left edge in canvas pixels. With a frame the crop centers on it instead of keeping the bottom fixed"),
      frame_y: z.number().int().min(0).optional().describe("Frame top edge in canvas pixels"),
      frame_width: z.number().int().min(1).optional().describe("Frame width in canvas pixels"),
      frame_height: z.number().int().min(1).optional().describe("Frame height in canvas pixels"),
    },
  },
  async (args) => {
    const { png, ...geometry } = await pixelorama.request<{ png: string }>("preview_nestar_phone", args);
    return { content: [...json(geometry).content, { type: "image" as const, data: png, mimeType: "image/png" }] };
  },
);

server.registerTool(
  "add_layer",
  {
    description: "Add a pixel layer. By default it goes on top of all layers.",
    inputSchema: {
      name: z.string().optional(),
      above: z.number().int().min(0).optional().describe("Index of the layer to put the new one above"),
    },
  },
  async (args) => json(await pixelorama.request("add_layer", args)),
);

server.registerTool(
  "rename_layer",
  {
    description: "Rename a layer. Layer 0 is the bottom layer.",
    inputSchema: {
      layer: z.number().int().min(0).describe("Layer index, 0 is the bottom layer"),
      name: z.string().min(1),
    },
  },
  async (args) => json(await pixelorama.request("rename_layer", args)),
);

server.registerTool(
  "get_palette",
  {
    description:
      "Show the palette selected in Pixelorama (slot number and color of every swatch, slot 0 first), the names of all palettes, and the color mode. In draw_pixels and fill_rect a color '@n' means slot n of this palette.",
  },
  async () => json(await pixelorama.request("get_palette")),
);

server.registerTool(
  "select_palette",
  {
    description: "Select a palette by name (global or project palette). In indexed mode the whole image recolors to it, slot by slot.",
    inputSchema: { name: z.string().min(1) },
  },
  async (args) => json(await pixelorama.request("select_palette", args)),
);

server.registerTool(
  "create_palette",
  {
    description:
      "Create a project palette from a list of colors (slot 0 first) and select it. Use the same slot order for a day and a night palette.",
    inputSchema: {
      name: z.string().min(1),
      colors: z.array(z.string()).min(1).max(255).describe("Colors as #rrggbb, slot 0 first"),
      width: z.number().int().min(1).optional().describe("Swatches per row in the palette panel, default 8"),
    },
  },
  async (args) => json(await pixelorama.request("create_palette", args)),
);

server.registerTool(
  "set_color_mode",
  {
    description: "Switch the project between 'indexed' (every pixel is a palette slot) and 'rgba'. One undo step.",
    inputSchema: { mode: z.enum(["indexed", "rgba"]) },
  },
  async (args) => json(await pixelorama.request("set_color_mode", args)),
);

server.registerTool(
  "resize_canvas",
  {
    description:
      "Change the canvas size without scaling. anchor is where the old image stays: bottom (default, centered horizontally), top, center, left, right, or combinations like bottom-left.",
    inputSchema: {
      width: z.number().int().min(1).max(4096),
      height: z.number().int().min(1).max(4096),
      anchor: z.string().optional(),
    },
  },
  async (args) => json(await pixelorama.request("resize_canvas", args)),
);

server.registerTool(
  "add_frame",
  {
    description: "Add an empty frame. By default it goes after the last frame.",
    inputSchema: {
      after: z.number().int().min(0).optional().describe("Index of the frame to insert after"),
    },
  },
  async (args) => json(await pixelorama.request("add_frame", args)),
);

server.registerTool(
  "select_cel",
  {
    description: "Make a frame/layer the current one in Pixelorama.",
    inputSchema: { frame, layer },
  },
  async (args) => json(await pixelorama.request("select_cel", args)),
);

const animationIndex = z.number().int().min(0);
server.registerTool(
  "get_animation",
  { description: "Read frame durations in seconds, animation tags, onion skin and playback status." },
  async () => json(await pixelorama.request("get_animation")),
);
server.registerTool(
  "duplicate_frame",
  {
    description: "Duplicate an existing frame into independent cels. Defaults to insertion after the source frame.",
    inputSchema: { frame, after: animationIndex.optional() },
  },
  async (args) => json(await pixelorama.request("duplicate_frame", args)),
);
server.registerTool(
  "set_frame_duration",
  {
    description: "Set an individual frame's playback duration in seconds. One undo step.",
    inputSchema: { frame, seconds: z.number().min(0.01).max(60) },
  },
  async (args) => json(await pixelorama.request("set_frame_duration", args)),
);
server.registerTool(
  "set_animation_tag",
  {
    description: "Create or update a named tag with an inclusive, zero-based range. One undo step.",
    inputSchema: { name: z.string().min(1), first: animationIndex, last: animationIndex },
  },
  async (args) => json(await pixelorama.request("set_animation_tag", args)),
);
server.registerTool(
  "set_onion_skin",
  {
    description: "Show or hide a translucent copy of the previous frame in the editing view. Turning it off restores the user's own onion-skin frame counts.",
    inputSchema: { enabled: z.boolean() },
  },
  async (args) => json(await pixelorama.request("set_onion_skin", args)),
);
server.registerTool(
  "play_animation",
  {
    description: "Play the whole timeline or a named tag forwards using Pixelorama's playback controls. Pass false to stop.",
    inputSchema: { play: z.boolean(), tag: z.string().min(1).optional() },
  },
  async (args) => json(await pixelorama.request("play_animation", args)),
);

server.registerTool(
  "save_project",
  {
    description: "Save the current project as a .pxo file. Without a path it saves to where it was last saved.",
    inputSchema: { path: z.string().optional().describe("Where to save, ending in .pxo") },
  },
  async ({ path }) => json(await pixelorama.request("save_project", path ? { path: absolute(path) } : {})),
);

server.registerTool(
  "export_png",
  {
    description:
      "Export the current frame, or all frames as a horizontal sprite sheet, to a PNG file. " +
      "Layers are blended the same way Pixelorama shows them.",
    inputSchema: {
      path: z.string().describe("Where to write the file, ending in .png"),
      frame,
      all_frames: z.boolean().default(false),
      scale: z.number().int().min(1).max(64).default(1),
    },
  },
  async ({ path, ...rest }) => json(await pixelorama.request("export_png", { ...rest, path: absolute(path) })),
);

server.registerTool(
  "undo",
  {
    description: "Undo the last n steps in the active project, like Ctrl+Z. Returns the names of the steps undone.",
    inputSchema: { steps: z.number().int().min(1).max(50).optional().describe("Number of steps, default 1") },
  },
  async (args) => json(await pixelorama.request("undo", args)),
);

server.registerTool(
  "redo",
  {
    description: "Redo the last n undone steps in the active project, like Ctrl+Y. Returns the names of the steps redone.",
    inputSchema: { steps: z.number().int().min(1).max(50).optional().describe("Number of steps, default 1") },
  },
  async (args) => json(await pixelorama.request("redo", args)),
);

server.registerTool(
  "export_nestar_asset",
  {
    description: "Export an exact rectangle of one pixel layer as Nestar {pal, rows}. Optionally save JSON to an allowed path.",
    inputSchema: {
      frame, layer,
      x: z.number().int().min(0).default(0),
      y: z.number().int().min(0).default(0),
      width: z.number().int().min(1),
      height: z.number().int().min(1),
      allowed_colors: z.array(z.string().regex(/^#[0-9a-f]{6}$/i)).min(1).max(62).optional(),
      path: z.string().optional().describe("Optional .json output path"),
    },
  },
  async ({ path, ...args }) => json(await pixelorama.request(
    "export_nestar_asset", path === undefined ? args : { ...args, path: absolute(path) },
  )),
);

const shutdown = () => {
  pixelorama.close();
  process.exit(0);
};
process.stdin.on("end", shutdown);
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await server.connect(new StdioServerTransport());
