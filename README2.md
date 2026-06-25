# ISEKOI Local Butterchurn Preset Loader

Load Butterchurn / Milkdrop preset JSON files into the ISEKOI Radio visualizer from a local folder on your computer.

This setup uses:

- a Tampermonkey userscript installed in your browser
- a local folder containing preset `.json` files
- a `manifest.json` file listing those presets
- a tiny local HTTP server so the browser can read the files

Browsers do not allow a webpage or userscript to freely scan a folder on your computer. This is annoying, but also the reason every random website cannot rummage through your desktop like a raccoon in a filing cabinet.

---

## Folder structure

Create a folder for your presets:

```text
butterchurn-presets/
  manifest.json
  ambient-defined-waves.json
  wavy-rogue.json
  color-field.json
```

Each preset file should contain only the Butterchurn preset JSON object, not a full Tampermonkey userscript.

---

## Start the local preset server

Open a terminal in the preset folder:

```bash
cd /path/to/butterchurn-presets
python3 -m http.server 8765
```

On Windows, depending on your Python install, this may be:

```bash
python -m http.server 8765
```

The folder will then be available at:

```text
http://127.0.0.1:8765/
```

The manifest should be available at:

```text
http://127.0.0.1:8765/manifest.json
```

Leave this terminal window open while using the visualizer.

---

## Manifest format

### Simple manifest

Use a plain array of JSON filenames:

```json
[
  "ambient-defined-waves.json",
  "wavy-rogue.json",
  "color-field.json"
]
```

### Named manifest

Use this format if you want readable names in the visualizer status text:

```json
{
  "presets": [
    {
      "name": "Ambient Defined Waves",
      "file": "ambient-defined-waves.json"
    },
    {
      "name": "Wavy Rogue",
      "file": "wavy-rogue.json"
    },
    {
      "name": "Color Field",
      "file": "color-field.json"
    }
  ]
}
```

The userscript supports either format.

---

## Install the userscript

1. Install Tampermonkey in your browser.
2. Create a new userscript.
3. Paste in the full `ISEKOI Local Butterchurn Preset Loader` script.
4. Save it.
5. Make sure the script is enabled.
6. Go to:

```text
https://isekoi-radio.com/
```

or:

```text
https://www.isekoi-radio.com/
```

The script should automatically load the current preset listed in `manifest.json`.

---

## Controls

| Shortcut | Action |
|---|---|
| `Ctrl + Alt + P` | Load next preset |
| `Ctrl + Alt + Shift + P` | Load random preset |
| `Ctrl + Alt + O` | Reload manifest and current preset |
| `Ctrl + Alt + [` | Load previous preset |

After editing a preset JSON file, press:

```text
Ctrl + Alt + O
```

This reloads the manifest and current preset without needing to reinstall the userscript.

---

## Console commands

Open the browser console and use:

```js
isekoiLocalPresetList();
```

Lists all presets from the manifest.

```js
isekoiLocalPresetLoad(0);
```

Loads the first preset.

```js
isekoiLocalPresetLoad(3);
```

Loads the fourth preset.

```js
isekoiLocalPresetNext();
```

Loads the next preset.

```js
isekoiLocalPresetPrevious();
```

Loads the previous preset.

```js
isekoiLocalPresetRandom();
```

Loads a random preset.

```js
isekoiLocalPresetReload();
```

Reloads the manifest and current preset.

---

## Preset file format

Each preset file should be a valid Butterchurn preset JSON object.

Example:

```json
{
  "version": 2,
  "baseVals": {
    "rating": 5,
    "gammaadj": 1.32,
    "decay": 0.971,
    "wave_mode": 6,
    "wave_a": 1.65,
    "wave_scale": 1.18,
    "fshader": 1
  },
  "shapes": [],
  "waves": [],
  "init_eqs_str": "",
  "frame_eqs_str": "",
  "pixel_eqs_str": "",
  "warp": "",
  "comp": ""
}
```

Real presets will usually include much more data.

Do not wrap the preset in:

```js
const CUSTOM_PRESET = ...
```

The file should be pure JSON.

---

## Editing workflow

1. Edit a preset JSON file in your preset folder.
2. Save the file.
3. Keep the Python server running.
4. Go back to ISEKOI Radio.
5. Press:

```text
Ctrl + Alt + O
```

The updated preset should reload.

If it does not, hard-refresh the page or check the browser console.

---

## Troubleshooting

### The preset does not load

Check that the local server is running:

```text
http://127.0.0.1:8765/manifest.json
```

Open that URL in your browser. You should see your manifest JSON.

If the page cannot load, restart the server:

```bash
cd /path/to/butterchurn-presets
python3 -m http.server 8765
```

---

### The manifest loads but a preset fails

Open the preset URL directly:

```text
http://127.0.0.1:8765/ambient-defined-waves.json
```

If you see an error, the filename in `manifest.json` may not match the actual file.

Check for:

- spelling differences
- capitalization differences
- missing `.json`
- spaces or special characters
- invalid JSON

Computers are deeply literal. This is one of their worst social traits.

---

### JSON parse error

Your preset file is not valid JSON.

Common causes:

- trailing commas
- JavaScript comments
- `const CUSTOM_PRESET =` before the object
- unescaped line breaks inside strings
- missing quotes around property names

Valid JSON:

```json
{
  "name": "Example",
  "enabled": true
}
```

Invalid JSON:

```js
{
  name: "Example",
  enabled: true,
}
```

---

### The visualizer loads a different preset over yours

Press:

```text
Ctrl + Alt + O
```

or:

```text
Ctrl + Alt + P
```

The script captures the Butterchurn visualizer and reloads your preset after the visualizer initializes, but page timing can be fussy because browser apps apparently enjoy interpretive dance.

---

### Audio is not moving the visualizer

Click Play on ISEKOI Radio first.

Browsers often block audio analysis until the user interacts with the page. This is normal autoplay policy behavior.

---

### Tampermonkey says the local URL is blocked

Make sure the userscript header includes:

```js
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      localhost
```

Without those lines, Tampermonkey may not allow requests to the local preset server.

---

## Notes

The loader remembers the current preset index in `localStorage`, so refreshing the page should keep the same selected preset.

The currently loaded preset and manifest are exposed on `window`:

```js
window.__isekoiCustomButterchurnPreset
window.__isekoiLocalPresetManifest
window.__isekoiLocalPresetEntry
```

These can be useful for debugging.

---

## Recommended workflow

Keep three things open:

1. ISEKOI Radio in the browser.
2. Your preset folder in a code editor.
3. A terminal running:

```bash
python3 -m http.server 8765
```

Then edit JSON files, save, and reload with:

```text
Ctrl + Alt + O
```

That gives you a fast local preset workflow without pasting giant JSON blobs into Tampermonkey every time, which is a small act of mercy in a world determined to make visualizers involve clipboard archaeology.
