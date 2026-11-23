# pixelorama-mcp (versie Aeroscoop)

Aangepaste versie van [CyberIce2077/pixelorama-mcp](https://github.com/CyberIce2077/pixelorama-mcp) (MIT, zie LICENSE). Gemaakt voor Nestar, maar werkt met elk project in Pixelorama.
**Agents: lees eerst [AGENTS.md](AGENTS.md).**
De [uitbreidingsgids](docs/uitbreiding-en-tests.md) beschrijft de voorgestelde workflow, de pull requests en de tests met Pixelorama 1.2.4.

## Wat er anders is dan het origineel
- **Werkt met Pixelorama 1.2 (uitbreidings-API 10).** Sinds 1.2 groeit een laag mee met de inhoud (een nieuwe laag is 1 × 1 pixel, met een verschuiving). Het origineel schreef daarbuiten en tekende niets. Nu werkt elke opdracht op een kopie ter grootte van het werkvlak en laat de laag groeien en krimpen zoals Pixelorama zelf.
- **Nieuwe tools:** `rename_layer`, `get_palette`, `select_palette`, `create_palette`, `set_color_mode`, `resize_canvas`, `undo`, `redo`.
- **Geschiedenis:** elke teken- en vulstap toont de opdracht en de laagnaam, bijvoorbeeld `MCP draw_pixels: hulp`.
- **Kleuren als paletvakje:** `@n` = vakje n (vanaf 0) van het gekozen palet; `read_pixels` meldt `palette_slots`; `get_project` meldt kleurmodus en palet.
- Getest met Pixelorama v1.2.4 op Windows (aeropc), 15-11-2026.

## Installeren zonder muis

Gebruik Node.js 22 of hoger en Pixelorama 1.2.4. Sluit Pixelorama voordat je de uitbreiding voor het eerst inschakelt. Voer vanuit deze repository op Linux of in PowerShell uit:

```sh
npm ci
npm run extension -- install
npm run extension -- enable
npm run extension -- status
```

Start Pixelorama en vraag via MCP `get_project` op. Configureer de agent als lokale stdio-server met `node <volledig-pad>/dist/index.js`. Voor Claude Code en Codex kan dat met `claude mcp add pixelorama -- node <volledig-pad>/dist/index.js` of `codex mcp add pixelorama -- node <volledig-pad>/dist/index.js`.

| Platform | Standaard profiel |
|---|---|
| Linux | `$XDG_DATA_HOME/pixelorama` of `~/.local/share/pixelorama` |
| Linux Flatpak | Zet `PIXELORAMA_DATA_DIR="$HOME/.var/app/com.orama_interactive.Pixelorama/data/pixelorama"` bij het aanroepen van het commando |
| Windows | `%APPDATA%\pixelorama`. In PowerShell kun je een afwijkend profiel instellen met `$env:PIXELORAMA_DATA_DIR = 'C:\pad\naar\pixelorama'` |

`npm run install-extension` blijft beschikbaar als verkorte vorm van `npm run extension -- install`. Voer na een update `npm ci` en `npm run extension -- install` uit. `on_disk` geeft de versie en build van de ZIP aan. `in_editor` geeft de build die antwoordt voor dit profiel. Bij `restart_required: true` start je Pixelorama opnieuw zodra je klaar bent met het open project. De commando's sluiten Pixelorama of projecttabbladen nooit. Als Windows de ZIP nog in gebruik heeft en vervanging weigert, bewaar je je project en herhaal je de installatie na afsluiten.

`npm run extension -- disable` schakelt de huidige uitbreiding direct uit via de editor en verbreekt de MCP-verbinding. Het project blijft open. Voor een oudere build of een editor waarin de uitbreiding niet draait, wijzig je de voorkeur met gesloten editor. De offline wijziging raakt alleen `PixeloramaMCP` onder `[extensions]` in `config.ini`.

### Tekeninstellingen

`get_drawing_settings` leest twee weergave-instellingen. Met `set_drawing_settings` zet je één of beide opties aan of uit.

| Instelling | Effect |
|---|---|
| `show_grid` | Toont het ingestelde raster op het canvas |
| `show_pixel_grid` | Toont de grenzen tussen afzonderlijke pixels bij voldoende zoom |

Beide instellingen gelden voor de open editor. Ze wijzigen geen projectpixels en komen niet in exports of in de ongedaan-maakgeschiedenis.

### Herhaalbare test

Pak de officiële [Linux-release van Pixelorama 1.2.4](https://github.com/Orama-Interactive/Pixelorama/releases/tag/v1.2.4) uit. Bouw de uitbreiding en geef het volledige pad op. Houd poort 7651 vrij voor de test.

```sh
npm run build
PIXELORAMA_BIN=/pad/naar/Pixelorama.x86_64 npm run test:pixelorama
```

De test maakt een eigen tijdelijk profiel met een proefproject van 8 × 8 pixels. Hij controleert via MCP de verbinding en een tekeninstelling, installeert een tweede build terwijl de tekening open is, en controleert versieverschil, herhaling, behoud van de tekening en uitschakelen.

### Bestandspaden beperken

Maak desgewenst `pixelorama-mcp.json` in het Pixelorama-profiel en herstart de editor. Vul een bestaande map in, bijvoorbeeld `{"root": "/home/melroy/Pixelorama"}` op Linux of `{"root": "C:/Users/melro/Pixelorama"}` op Windows. De uitbreiding controleert `open_file`, `save_project` en `export_png`. Symbolische links en Windows-junctions worden geweigerd. Gebruik op Windows een lokaal stationspad.

`get_project.path_check` meldt de toegestane map, `off` als het bestand ontbreekt, of `invalid` bij een ongeldige instelling. Bij `invalid` zijn de bestandsopdrachten geblokkeerd totdat je de instelling corrigeert en Pixelorama herstart.

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
npm run extension -- install
npm run extension -- enable
```

`npm install` builds the server and packs the extension into `dist/PixeloramaMCP.zip`. `install-extension` copies it into Pixelorama's extensions folder. You can also install the zip from Pixelorama's Preferences > Extensions.

Start Pixelorama, then add the server to Claude Code:

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
