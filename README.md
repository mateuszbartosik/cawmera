# Cawmera

Puts a screenshot into a frame. Every image gets the same background and shows the UI at the same scale, at 1600 × 1000 or any size you pick.

## Download

Windows builds are on the [Releases](../../releases) page: unzip and run `Cawmera.exe`. The app isn't code-signed, so Windows may warn the first time you open it. For macOS or Linux, build it from source.

## Use

1. **Add a screenshot**: paste, drop, open, or **Capture** a window or screen, with an optional delay.
2. **Size**: pick a preset in Export, like **Article (OG)** for 1200 × 630, or type a width and height. The screenshot keeps its scale, so a smaller image shows less of it.
3. **Crop** (`C`) to choose what shows, and pick the **Edge** it comes in from.
4. **Captured at** should match your screen's scaling. A smaller **UI zoom** shows more of the screenshot.
5. **Background**: drag the light around the pad and change its colour or intensity, or set **Fill** to **Image** to put the house background image behind the screenshot.
6. **Shuffle** (`R`) for a new edge and light direction. The part of the screenshot that shows stays.
7. **Redact** private details with blur boxes. **Spotlight** dims everything but one area.
8. **Export** (`Ctrl+S`), **Export all** or **Copy**, as lossless WebP or PNG.

Shots sit side by side on the canvas. `Shift`- or `Ctrl`-click them, or drag a box on empty canvas, to select several; `Delete` removes them and Undo brings them back.

## House styles

The background, light, frame and scale come from a house style, and so does the background image that **Fill: Image** uses. Open it with `Ctrl+Alt+H`, adjust it, give it a name and **Export style**. Others load the `.json` with **Import style**, or by dropping it onto Cawmera.

## Shortcuts

| Action | Keys |
| --- | --- |
| Open images | `Ctrl+O` |
| Capture | `Ctrl+Shift+2` |
| New shot / next / previous | `Ctrl+N` / `Ctrl+PageDown` / `Ctrl+PageUp` |
| Crop on / off | `C` or double-click the shot (`Enter` or `Esc` to finish) |
| Shuffle the edge and light | `R` |
| Draw a blur box | `Alt` + drag |
| Select several shots or boxes | `Shift`/`Ctrl` + click, drag on empty canvas (shots), `Ctrl+A` |
| Delete / nudge what's selected | `Delete` / arrow keys for boxes (`Shift` for 10 px) |
| Undo / redo (per shot) | `Ctrl+Z` / `Ctrl+Shift+Z` |
| Export / export all / copy | `Ctrl+S` / `Ctrl+Shift+S` / `Ctrl+Shift+C` |
| Zoom in / out / 100% | `Ctrl+=` / `Ctrl+-` / `Ctrl+0` |
| Fit all shots / fit this shot | `Shift+1` / `Shift+2` |
| Pan the canvas | drag inside a shot, `Space` + drag, or scroll |
| Light / dark | `Ctrl+Shift+L` |
| House style | `Ctrl+Alt+H` |

## Develop

```bash
npm install
npm run dev          # run with hot reload
npm test             # unit tests
npm run dist:win     # Windows .exe and zip in release/
npm run build:web    # the same UI as a single HTML file
```

## License

MIT, see [LICENSE](LICENSE).
