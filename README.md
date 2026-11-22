# pixelorama-mcp (versie Aeroscoop)

Aangepaste versie van [CyberIce2077/pixelorama-mcp](https://github.com/CyberIce2077/pixelorama-mcp) (MIT, zie LICENSE). Gemaakt voor Nestar, maar werkt met elk project in Pixelorama.
**Agents: lees eerst [AGENTS.md](AGENTS.md).**
De [uitbreidingsgids](docs/uitbreiding-en-tests.md) beschrijft de voorgestelde workflow, de pull requests en de tests met Pixelorama 1.2.4.

## Wat er anders is dan het origineel
- **Werkt met Pixelorama 1.2 (uitbreidings-API 10).** Sinds 1.2 groeit een laag mee met de inhoud (een nieuwe laag is 1 × 1 pixel, met een verschuiving). Het origineel schreef daarbuiten en tekende niets. Nu werkt elke opdracht op een kopie ter grootte van het werkvlak en laat de laag groeien en krimpen zoals Pixelorama zelf.
- **Nieuwe tools:** `rename_layer`, `get_palette`, `select_palette`, `create_palette`, `set_color_mode`, `resize_canvas`, `undo`, `redo`.
- **Kleuren als paletvakje:** `@n` = vakje n (vanaf 0) van het gekozen palet; `read_pixels` meldt `palette_slots`; `get_project` meldt kleurmodus en palet.
- Getest met Pixelorama v1.2.4 op Windows (aeropc), 15-11-2026.

## Installeren
Zoals hieronder bij Setup, met deze repo in plaats van het origineel. Daarna in de Claude-app (instellingenbestand, `mcpServers`), Claude Code (`claude mcp add pixelorama -- node <pad>/dist/index.js`) of Codex (`codex mcp add`) als lokale stdio-server. Nooit openzetten naar internet.

## Installeren op Linux
Getest op Windows; deze stappen volgen het installatiescript (`scripts/install-extension.mjs`), dat op Linux `~/.local/share/pixelorama` gebruikt.

1. **Pixelorama 1.2 of nieuwer.** Neem de losse Linux-versie van [GitHub-releases](https://github.com/Orama-Interactive/Pixelorama/releases) (zip of tar.gz, geen installatie nodig). Uitpakken en `Pixelorama.x86_64` starten. Gebruikt die de map `~/.local/share/pixelorama`; dan werkt stap 3 vanzelf.
   - Flatpak (`com.orama_interactive.Pixelorama`) kan ook, maar die gebruikt `~/.var/app/com.orama_interactive.Pixelorama/data/pixelorama`. Kopieer bij stap 3 de zip dan zelf naar de map `extensions` daarin.
   - Snap liever niet: die zit afgeschermd en het is niet getest.
2. **Node.js 22 of nieuwer** (`node -v`). Te oud of niet aanwezig: installeer via [nvm](https://github.com/nvm-sh/nvm) (`nvm install 22`) of het pakket van NodeSource.
3. **Koppeling bouwen en de uitbreiding plaatsen:**
   ```sh
   git clone https://github.com/Aeroscoop/pixelorama-mcp.git ~/projects/pixelorama-mcp
   cd ~/projects/pixelorama-mcp
   npm install
   npm run install-extension
   ```
4. **Aanzetten:** Pixelorama opnieuw starten, dan Preferences > Extensions > **Pixelorama MCP** aanvinken.
5. **Aan de agent koppelen** (lokale stdio-server, nooit naar internet):
   - Claude Code: `claude mcp add pixelorama -- node ~/projects/pixelorama-mcp/dist/index.js`
   - Codex: `codex mcp add pixelorama -- node ~/projects/pixelorama-mcp/dist/index.js`
   - Claude-app: in `~/.config/Claude/claude_desktop_config.json` onder `mcpServers` een blok `"pixelorama": {"command": "node", "args": ["/home/<naam>/projects/pixelorama-mcp/dist/index.js"]}`. Gebruik het volledige pad, geen `~`. Daarna de Claude-app opnieuw starten.
6. **Controleren:** Pixelorama open met een project, dan de agent `get_project` laten doen. Antwoordt die met maat en lagen, dan werkt het. Geen verbinding: kijk of de uitbreiding aanstaat en of poort 7651 vrij is (`ss -ltn | grep 7651`).

**Paletten meenemen.** Projectpaletten zitten in het `.pxo`-bestand en gaan vanzelf mee. Algemene paletten (zoals `Winter 25`, `Winterhol dag`, `Winterhol nacht`) zijn losse `.json`-bestanden: kopieer ze van `%APPDATA%\Pixelorama\Palettes` (Windows) naar `~/.local/share/pixelorama/Palettes` (Linux) en start Pixelorama opnieuw.

**Bijwerken** na nieuwe wijzigingen in deze repo: `git pull && npm install && npm run install-extension`, daarna Pixelorama opnieuw starten.

## Nog te doen
- Betere namen voor stappen in de geschiedenis (#1).
- Openen, bewaren en exporteren beperken tot één map (#2).

---

## Originele README

# pixelorama-mcp

Lets AI agents like Claude Code draw pixel art in [Pixelorama](https://github.com/Orama-Interactive/Pixelorama) through [MCP](https://modelcontextprotocol.io).

It has two parts: a Pixelorama extension that runs inside the editor, and an MCP server that the agent talks to. The agent works on whatever is open in Pixelorama, you watch it happen on the canvas, and every change can be undone with Ctrl+Z like any other edit.

## Drawing format

Agents draw with a character grid and a palette, which is far easier for a language model than coordinates:

```json
{
  "palette": { "o": "#7a4a12", "y": "#f2c230", "h": "#fff2a8" },
  "rows": [
    "..oooo..",
    ".ohyyyo.",
    "oyyyyyyo",
    ".oyyyyo.",
    "..oooo.."
  ],
  "x": 4,
  "y": 4
}
```

Characters missing from the palette (like `.`) leave pixels alone. `read_pixels` returns existing art in the same format, so an agent can read a sprite, change it and write it back.

## Tools

| Tool | What it does |
|---|---|
| `get_project` | Size, frames, layers and the current cel |
| `new_project` | New canvas in a new tab |
| `open_file` | Open a `.pxo` or an image |
| `draw_pixels` | Draw a character grid |
| `fill_rect` | Fill a rectangle, or the whole cel |
| `clear_cel` | Erase a cel |
| `read_pixels` | Read pixels back as a character grid |
| `get_image` | Image of a frame, scaled up so the agent can see it |
| `add_layer`, `add_frame` | Add a layer or frame and select it |
| `select_cel` | Change the current frame/layer |
| `save_project` | Save as `.pxo` |
| `export_png` | Export a frame, or all frames as a sprite sheet |

Frames are counted from 0, left to right. Layers are counted from 0 at the bottom.

## Setup

Requires Pixelorama 1.2 (extension API 9) and Node.js 22 or newer.

```sh
git clone https://github.com/CyberIce2077/pixelorama-mcp.git ~/projects/pixelorama-mcp
cd ~/projects/pixelorama-mcp
npm install
npm run install-extension
```

`npm install` builds the server and packs the extension into `dist/PixeloramaMCP.zip`. `install-extension` copies it into Pixelorama's extensions folder. You can also install the zip from Pixelorama's Preferences > Extensions.

Restart Pixelorama, enable **Pixelorama MCP** in Preferences > Extensions, then add the server to Claude Code:

```sh
claude mcp add pixelorama -- node ~/projects/pixelorama-mcp/dist/index.js
```

## How it works

```
agent  <--stdio-->  pixelorama-mcp server  <--TCP 127.0.0.1:7651-->  Pixelorama extension
```

The extension listens on localhost only and speaks one JSON object per line. Any connection that sends something else, such as a web page trying to reach the port over HTTP, is dropped before a command runs.

The port is 7651. To change it, set `PIXELORAMA_MCP_PORT` for the server and `PORT` in `extension/src/Extensions/PixeloramaMCP/Main.gd`.

## Limitations

- Only pixel layers can be drawn on. Group, tilemap, 3D and audio layers are reported but not editable.
- Commands act on the project in the active tab.
- No brushes, selections or tools yet; drawing is pixels and rectangles.

## License

MIT
