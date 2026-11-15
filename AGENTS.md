# Pixelorama via MCP — handleiding voor agents

Voor elke agent (Claude, Claude Code, Codex) die via de MCP-koppeling in Pixelorama werkt. Geldt voor elk project.
Stand: 15-11-2026. Eigenaar: Melroy. Lees dit helemaal voordat je een tool aanroept.
Afspraken per project (maten, lagen, paletten) staan bij dat project, niet hier.

## In het kort
- Je werkt **live in het open venster van Pixelorama**. De gebruiker kijkt mee en tekent zelf ook.
- **De gebruiker beslist over het uiterlijk.** Teken niet in zijn lagen zonder zijn ja. Markeren in een hulplaag mag.
- **Elke opdracht is één stap ongedaan maken.** Zelf terugdraaien kan met `undo` en `redo`.
- **Bewaar of exporteer niets zonder ja.**
- Begin altijd met `get_project`: je werkt in het tabblad dat **nu actief** is. Klopt de naam niet, stop en vraag het.
- **Kies een laag op naam, vlak voor elke opdracht.** De gebruiker tekent mee en kan een laag toevoegen; dan schuiven de laagnummers op. Doe `get_project` opnieuw vóór je tekent als er tijd tussen zit.

## Hoe het werkt
```
agent  <-- stdio -->  MCP-server (Node)  <-- TCP 127.0.0.1:7651 -->  uitbreiding in Pixelorama
```
- Deze repo: Aeroscoop/pixelorama-mcp, een aangepaste versie van CyberIce2077/pixelorama-mcp (MIT). Wat er anders is: zie README.md.
- Getest met Pixelorama v1.2.4 (uitbreidings-API 10). Uitbreiding **Pixelorama MCP** moet aan staan in Voorkeuren › Uitbreidingen.
- Meerdere agents mogen tegelijk verbonden zijn.

## Afspraken over tellen
- Coördinaten in **pixels van het werkvlak**, linksboven is (0, 0). x naar rechts, y naar beneden.
- **Lagen tellen van onder naar boven, vanaf 0.** Frames van links naar rechts, vanaf 0.
- Kleuren: `#rgb`, `#rrggbb`, `#rrggbbaa`, een naam, `transparent`, of **`@n` = vakje n van het gekozen palet (vanaf 0)**.

## Tools
| Tool | Wat | Let op |
|---|---|---|
| `get_project` | grootte, lagen, frames, actieve laag, kleurmodus, palet, open tabbladen | altijd eerst |
| `get_image` | het frame als afbeelding (alle zichtbare lagen) | om te kijken; `scale` 2 à 3 is genoeg |
| `read_pixels` | pixels van één laag als letterraster + kleuren; `palette_slots` zegt welke letter welk paletvakje is | max. 16.384 pixels en ± 80 kleuren per keer: lees in stukken |
| `draw_pixels` | teken een letterraster (`rows` + `palette`) op `x`, `y` | tekens die niet in `palette` staan (zoals `.`) laten de pixel staan; zet een teken op `transparent` om te gummen |
| `fill_rect` | rechthoek vullen; zonder positie/maat de hele laag | `transparent` = laag leegmaken |
| `clear_cel` | een laag in een frame leegmaken | |
| `add_layer` | laag toevoegen, met naam | komt bovenop, of boven `above` |
| `rename_layer` | laag hernoemen | |
| `select_cel` | actieve laag/frame kiezen | |
| `add_frame` | frame toevoegen | |
| `new_project` | nieuw project in een nieuw tabblad | begint met het laatst gekozen palet |
| `open_file` | `.pxo` of afbeelding openen | volledig pad; opent een nieuw tabblad |
| `save_project` | bewaren als `.pxo` | alleen na ja |
| `export_png` | frame(s) als PNG | alleen na ja |
| `undo` | laatste n stappen ongedaan maken (Ctrl+Z), standaard 1, hoogstens 50 | geeft de namen van de stappen terug; kijk daarna met `get_project`/`get_palette` |
| `redo` | n stappen opnieuw doen (Ctrl+Y) | idem |
| `get_palette` | gekozen palet (vakje + kleur), alle paletnamen, kleurmodus | |
| `select_palette` | palet kiezen op naam | in Indexed kleurt de hele tekening om |
| `create_palette` | nieuw projectpalet uit een lijst kleuren (vakje 0 eerst) en kiezen | |
| `set_color_mode` | `indexed` of `rgba` | zie "Indexed en paletten"; vraag eerst |
| `resize_canvas` | werkvlak vergroten/verkleinen zonder schalen, met `anchor` | standaard `bottom` (onderaan, midden) |

Wat er niet is: selecties, penselen, lijnen, een laag verschuiven, van tabblad wisselen, paletten verwijderen. Teken met `draw_pixels` en `fill_rect`; de rest doet de gebruiker met de hand.

## Indexed en paletten
- In **Indexed** is elke pixel een paletvakje. Wissel je van palet (`select_palette`), dan kleurt alles mee, vakje voor vakje. Zo maak je bijvoorbeeld dag en nacht: twee paletten met dezelfde volgorde.
- Teken in Indexed bij voorkeur met `@n`, zodat je altijd precies een paletkleur raakt. Een andere kleur wordt het dichtstbijzijnde vakje.
- **Omzetten naar Indexed** (`set_color_mode`) kiest per pixel het dichtstbijzijnde vakje uit **het hele gekozen palet**, voor **alle lagen**. Valkuil: staan er hulpkleuren in het palet (kaders, een testfiguur), dan kan de tekening die kleuren pakken. Werkwijze:
  1. maak hulplagen leeg (lees ze eerst terug als je ze wilt bewaren);
  2. zet om met een palet met **alleen** de tekenkleuren;
  3. kies daarna een palet met dezelfde eerste vakjes plus de hulpkleuren erachter;
  4. teken de hulplagen opnieuw met `@n`.
- Terug naar RGBA geeft elke pixel de kleur van zijn vakje in het gekozen palet. Daarmee kun je vakjes "omleggen": kies eerst een tijdelijk palet waarin de verkeerde vakjes de goede kleur hebben, zet om naar RGBA en daarna weer naar Indexed.
- Paletkeuze telt in Pixelorama als een stap. Gebruik `undo` en lees de namen van de stappen terug, zodat je weet wat je terugdraait. Let op: alle teken- en vulopdrachten heten nu "MCP draw" (betere namen staan op de lijst).
- `undo` en `redo` werken op het actieve tabblad, zoals alle tools.

## Regels voor jou
- Laat bij twijfel zien wat je bedoelt (`get_image`) en vraag.
- Geen `save_project`, `export_png` of `open_file` met andere paden dan de gebruiker noemt.
- Een opdracht die 0 pixels verandert of een fout geeft: niet blind herhalen. Kijk eerst met `get_project` (juiste tabblad? laag op slot? juiste laagnummer?).
- Na twee mislukte pogingen: stoppen en melden.
- Korte zinnen, gewone woorden, in de taal van de gebruiker.

## Bekende valkuilen
- **"0 pixels veranderd" in een nieuwe laag:** oude versie van de koppeling. Sinds Pixelorama 1.2 groeit een laag mee met de inhoud; onze versie regelt dat.
- **Nieuwe tools zie je niet:** start de Claude-app, Claude Code of Codex opnieuw na een update van de koppeling.
- **`set_color_mode`** gebruikt een interne functie van Pixelorama en kan breken bij een nieuwe Pixelorama-versie.
- **Schermafdrukken (computer use) van Pixelorama werken niet**: gebruik `get_image`.
- **Veiligheid:** de koppeling luistert alleen op 127.0.0.1, maar elk programma op deze pc kan verbinden, en openen/bewaren mag elk pad. Zet de poort nooit open naar internet (geen tunnel).

## Opstarten en problemen
1. Pixelorama open, uitbreiding aan.
2. Claude-app / Claude Code / Codex gestart (die starten de MCP-server zelf).
3. Werkt het niet: draait Pixelorama? Staat de uitbreiding aan? Reageert poort 7651? Herstart Pixelorama en daarna de agent.
