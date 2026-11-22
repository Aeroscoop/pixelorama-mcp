# Pixelorama MCP uitbreidingsgids

Stand 22 november 2026. De negen wijzigingen staan in open pull requests vanaf `main`. Zolang [PR #11](https://github.com/Aeroscoop/pixelorama-mcp/pull/11) openstaat, geldt voor `main` de installatie uit de [README](../README.md). De opdrachten op deze pagina horen bij de bijbehorende PR.

## Installeren en testen

Met de versie uit PR #11 kun je de uitbreiding inschakelen voordat Pixelorama start. Gebruik Node.js 22 of nieuwer en sluit Pixelorama bij de eerste installatie.

```sh
npm ci
npm run extension -- install
npm run extension -- enable
npm run extension -- status
```

Start Pixelorama en vraag via de lokale MCP-server `get_project` op. Bij een update vergelijkt `status` de ZIP op schijf (`on_disk`) met de build die de editor meldt (`in_editor`). Bij `restart_required: true` kun je het open project afwerken en daarna Pixelorama herstarten. `npm run extension -- disable` schakelt de actuele build live uit. Voor een oudere build wijzig je die voorkeur met gesloten editor. De gewijzigde installatie is getest in de Linux-versie. De PR beschrijft ook de profielpaden voor Windows en Flatpak.

Pak voor de installatieproef de [officiële Linux-release van Pixelorama 1.2.4](https://github.com/Orama-Interactive/Pixelorama/releases/tag/v1.2.4) uit. Voer vanuit de checkout van PR #11 of een checkout met alle veranderingen uit:

```sh
npm ci
export PIXELORAMA_BIN=/volledig/pad/naar/Pixelorama.x86_64
npm run test:pixelorama
```

De proef gebruikt poort 7651 en een tijdelijk gebruikersprofiel. Sluit andere Pixelorama-processen die via MCP op die poort luisteren voordat je test. De test maakt een proefproject van 8 × 8 pixels en controleert installeren, `get_project`, tekeninstellingen, bijwerken en uitschakelen.

## Opdrachten en testbestanden

| Issue | Opdracht of wijziging | PR en test |
|---|---|---|
| #10 | Lokale installatie en status, plus `get_drawing_settings` en `set_drawing_settings` | [PR #11](https://github.com/Aeroscoop/pixelorama-mcp/pull/11), `npm run test:pixelorama` |
| #1 | `undo` en `redo` geven `MCP draw_pixels: hulp` terug bij tekenen op de laag hulp | [PR #12](https://github.com/Aeroscoop/pixelorama-mcp/pull/12), `test/undo-names.mjs` |
| #2 | `pixelorama-mcp.json` kan openen, bewaren en exporteren beperken tot één map. `get_project.path_check` toont de stand | [PR #13](https://github.com/Aeroscoop/pixelorama-mcp/pull/13), `test/file-paths.mjs` |
| #4 | `copy_selection`, `move_selection` en `shift_layer` werken op één cel | [PR #14](https://github.com/Aeroscoop/pixelorama-mcp/pull/14), `test/shift-pixels.mjs` |
| #5 | `draw_pixels_in_frames` met een palet per frame en `shift_layer_in_frames`, elk met één undo-stap | [PR #15](https://github.com/Aeroscoop/pixelorama-mcp/pull/15), `test/batch-frames.mjs` |
| #6 | `preview_nestar_phone` vergelijkt dag en nacht met dezelfde schaal en uitsnede | [PR #16](https://github.com/Aeroscoop/pixelorama-mcp/pull/16), `test/phone-preview.mjs` |
| #7 | `duplicate_frame`, `set_frame_duration`, `set_animation_tag`, `set_onion_skin`, `play_animation` en `get_animation` | [PR #17](https://github.com/Aeroscoop/pixelorama-mcp/pull/17), `test/animation.mjs` |
| #8 | `load_nestar_references` laadt vier demo-assets in een RGBA-schets van 112 × 216 | [PR #18](https://github.com/Aeroscoop/pixelorama-mcp/pull/18), `test/nestar-references.mjs` |
| #9 | `export_nestar_asset` geeft `pal` en `rows` terug voor één rechthoek in één laag en frame | [PR #19](https://github.com/Aeroscoop/pixelorama-mcp/pull/19), `test/nestar-export.mjs` |

Draai vervolgbestanden afzonderlijk met `node test/<naam>.mjs` en hetzelfde `PIXELORAMA_BIN`. Voor de drie Nestar-tests zet je ook `NESTAR_DEMO_DIR` op de map `demo` van een lokale [Starlite-checkout](https://github.com/Aeroscoop/starlite/tree/31add2241bf18b00b64f65ed2f5b2b8f6a1df5ca). De telefoontest gebruikt Python 3 met Pillow.

## Gecontroleerd in de cloud

De negen suites slaagden met de wijzigingen samen in een tijdelijke checkout. De achtergrondpixels kwamen voor dag en nacht overeen met de demo-uitsnede op 390 × 844 en 320 × 844. De nieuwe referentielagen bleven na bewaren en openen als groep beschikbaar. De Nestar-tekenroutine gaf voor het geëxporteerde pakje dezelfde posities, kleuren en lege pixels terug.

De PR’s zijn lokaal gecombineerd en getest in volgorde #11 t/m #19. De cloudtest draaide headless op Linux. De nieuwe Windows-installatie en het zichtbare Geschiedenis-menu staan nog open voor een live controle. De bureaubladhandleiding op aeropc is nog niet bijgewerkt.
