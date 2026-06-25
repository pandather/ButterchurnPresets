// ==UserScript==
// @name         ISEKOI Local Butterchurn Preset Loader
// @namespace    local.isekoi.butterchurn
// @version      1.0
// @description  Load Butterchurn preset JSON files from a local manifest folder
// @match        https://isekoi-radio.com/*
// @match        https://www.isekoi-radio.com/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      localhost
// ==/UserScript==

(function () {
  "use strict";

  const TAG = "[ISEKOI LOCAL PRESETS]";

  /*
    Start a local server in your preset folder:

      cd /path/to/butterchurn-presets
      python3 -m http.server 8765

    Then this script reads:

      http://127.0.0.1:8765/manifest.json
  */

  const PRESET_BASE_URL = "http://127.0.0.1:8765";
  const MANIFEST_FILE = "manifest.json";

  const STORAGE_INDEX_KEY = "isekoiLocalButterchurnPresetIndex";
  const STORAGE_LAST_FILE_KEY = "isekoiLocalButterchurnPresetFile";

  let capturedVisualizer = null;
  let presetManifest = [];
  let manifestPromise = null;
  let loadedOnce = false;

  console.log(TAG, "userscript started at", document.readyState);

  function normalizeIndex(index, length) {
    if (!length) return 0;
    return ((index % length) + length) % length;
  }

  function getCurrentIndex() {
    const raw = localStorage.getItem(STORAGE_INDEX_KEY);
    const parsed = Number.parseInt(raw || "0", 10);

    if (!Number.isFinite(parsed)) return 0;
    return parsed;
  }

  function setCurrentIndex(index) {
    const normalized = normalizeIndex(index, presetManifest.length || 1);
    localStorage.setItem(STORAGE_INDEX_KEY, String(normalized));
    return normalized;
  }

  function updateStatus(message) {
    const status =
      document.querySelector(".vizualizer-status") ||
      document.querySelector(".visualizer-status");

    if (status) status.textContent = message;
  }

  function isAbsoluteUrl(value) {
    return /^https?:\/\//i.test(value);
  }

  function encodePathPreservingSlashes(path) {
    return path
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");
  }

  function buildPresetUrl(fileOrUrl) {
    if (isAbsoluteUrl(fileOrUrl)) return fileOrUrl;

    const cleanBase = PRESET_BASE_URL.replace(/\/+$/, "");
    const cleanFile = String(fileOrUrl).replace(/^\/+/, "");

    return `${cleanBase}/${encodePathPreservingSlashes(cleanFile)}`;
  }

  function guessNameFromFile(file) {
    return String(file)
      .split("/")
      .pop()
      .replace(/\.json$/i, "")
      .replace(/[-_]+/g, " ");
  }

  function gmFetchText(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        timeout: 12000,
        onload(response) {
          if (response.status >= 200 && response.status < 300) {
            resolve(response.responseText);
            return;
          }

          reject(
            new Error(
              `HTTP ${response.status} while loading ${url}: ${response.statusText}`
            )
          );
        },
        ontimeout() {
          reject(new Error(`Timed out while loading ${url}`));
        },
        onerror(error) {
          reject(new Error(`Failed loading ${url}: ${JSON.stringify(error)}`));
        }
      });
    });
  }

  async function gmFetchJson(url) {
    const text = await gmFetchText(url);

    try {
      return JSON.parse(text);
    } catch (error) {
      console.error(TAG, "Invalid JSON from:", url, text);
      throw error;
    }
  }

  function normalizeManifest(rawManifest) {
    const entries = Array.isArray(rawManifest)
      ? rawManifest
      : Array.isArray(rawManifest.presets)
        ? rawManifest.presets
        : [];

    return entries
      .map((entry, index) => {
        if (typeof entry === "string") {
          return {
            file: entry,
            url: buildPresetUrl(entry),
            name: guessNameFromFile(entry),
            index
          };
        }

        if (entry && typeof entry === "object") {
          const file = entry.file || entry.path || entry.url;

          if (!file) return null;

          return {
            file,
            url: buildPresetUrl(file),
            name: entry.name || guessNameFromFile(file),
            description: entry.description || "",
            index
          };
        }

        return null;
      })
      .filter(Boolean);
  }

  async function loadManifest(forceReload = false) {
    if (manifestPromise && !forceReload) {
      return manifestPromise;
    }

    manifestPromise = (async () => {
      const manifestUrl = buildPresetUrl(MANIFEST_FILE);
      console.log(TAG, "Loading manifest:", manifestUrl);

      const rawManifest = await gmFetchJson(manifestUrl);
      const normalized = normalizeManifest(rawManifest);

      if (!normalized.length) {
        throw new Error("Manifest loaded, but it has no usable preset entries.");
      }

      presetManifest = normalized;

      const currentIndex = normalizeIndex(getCurrentIndex(), presetManifest.length);
      setCurrentIndex(currentIndex);

      console.log(TAG, "Manifest loaded:", presetManifest);

      updateStatus(`LOCAL PRESETS READY ${presetManifest.length}`);

      return presetManifest;
    })();

    return manifestPromise;
  }

  async function getPresetEntry(index = getCurrentIndex()) {
    await loadManifest();

    if (!presetManifest.length) {
      throw new Error("No presets available in manifest.");
    }

    const normalized = normalizeIndex(index, presetManifest.length);
    return presetManifest[normalized];
  }

  async function loadLocalPreset(index = getCurrentIndex(), reason = "manual") {
    const manifest = await loadManifest();
    const normalized = setCurrentIndex(index);
    const entry = manifest[normalized];

    if (!entry) {
      console.warn(TAG, "No preset at index:", normalized);
      return false;
    }

    if (!capturedVisualizer || typeof capturedVisualizer.loadPreset !== "function") {
      console.warn(TAG, "Visualizer not ready yet. Preset queued:", entry);
      updateStatus(`LOCAL PRESET QUEUED: ${entry.name}`);
      return false;
    }

    console.log(TAG, `Loading preset ${normalized + 1}/${manifest.length}:`, entry);

    const preset = await gmFetchJson(entry.url);

    try {
      capturedVisualizer.loadPreset(preset, 0.0);
      loadedOnce = true;

      localStorage.setItem(STORAGE_LAST_FILE_KEY, entry.file);

      window.__isekoiCustomButterchurnVisualizer = capturedVisualizer;
      window.__isekoiCustomButterchurnPreset = preset;
      window.__isekoiLocalPresetManifest = presetManifest;
      window.__isekoiLocalPresetEntry = entry;

      updateStatus(`LOCAL PRESET ${normalized + 1}/${manifest.length}: ${entry.name}`);

      console.log(
        TAG,
        `Loaded preset ${normalized + 1}/${manifest.length} via ${reason}: ${entry.name}`
      );

      return true;
    } catch (error) {
      console.error(TAG, "capturedVisualizer.loadPreset failed:", error);
      updateStatus(`LOCAL PRESET FAILED: ${entry.name}`);
      return false;
    }
  }

  async function nextPreset() {
    await loadManifest();
    return loadLocalPreset(getCurrentIndex() + 1, "next preset");
  }

  async function previousPreset() {
    await loadManifest();
    return loadLocalPreset(getCurrentIndex() - 1, "previous preset");
  }

  async function randomPreset() {
    await loadManifest();

    const randomIndex = Math.floor(Math.random() * presetManifest.length);
    return loadLocalPreset(randomIndex, "random preset");
  }

  async function reloadCurrentPreset() {
    await loadManifest(true);
    return loadLocalPreset(getCurrentIndex(), "reload current preset");
  }

  async function listPresets() {
    await loadManifest();

    console.table(
      presetManifest.map((entry, index) => ({
        index,
        name: entry.name,
        file: entry.file,
        url: entry.url
      }))
    );

    return presetManifest;
  }

  window.isekoiLocalPresetList = listPresets;
  window.isekoiLocalPresetLoad = loadLocalPreset;
  window.isekoiLocalPresetNext = nextPreset;
  window.isekoiLocalPresetPrevious = previousPreset;
  window.isekoiLocalPresetRandom = randomPreset;
  window.isekoiLocalPresetReload = reloadCurrentPreset;
  window.isekoiLocalPresetManifest = () => presetManifest;

  function getButterchurnApi(candidate) {
    if (!candidate) return null;

    if (typeof candidate.createVisualizer === "function") {
      return candidate;
    }

    try {
      if (
        candidate.default &&
        typeof candidate.default.createVisualizer === "function"
      ) {
        return candidate.default;
      }
    } catch (error) {
      console.warn(TAG, "Could not inspect butterchurn.default:", error);
    }

    return null;
  }

  function hookButterchurn(candidate) {
    if (!candidate) return candidate;

    const api = getButterchurnApi(candidate);

    if (!api) {
      console.warn(
        TAG,
        "Butterchurn wrapper found, but createVisualizer is not available yet.",
        candidate
      );
      return candidate;
    }

    if (api.__isekoiLocalPresetHooked) return candidate;

    const originalCreateVisualizer = api.createVisualizer;

    api.createVisualizer = function (...args) {
      console.log(TAG, "createVisualizer called.");

      const visualizer = originalCreateVisualizer.apply(this, args);

      capturedVisualizer = visualizer;
      window.__isekoiCustomButterchurnVisualizer = visualizer;

      console.log(TAG, "Captured visualizer:", visualizer);

      let attempts = 0;

      const timer = setInterval(() => {
        attempts += 1;

        if (!loadedOnce) {
          loadLocalPreset(getCurrentIndex(), `capture retry ${attempts}`).catch(
            (error) => {
              console.warn(TAG, "Preset load retry failed:", error);
            }
          );
        }

        if (loadedOnce || attempts >= 12) {
          clearInterval(timer);
        }
      }, 700);

      return visualizer;
    };

    api.__isekoiLocalPresetHooked = true;
    console.log(TAG, "Hooked Butterchurn API:", api);

    return candidate;
  }

  let internalButterchurn = window.butterchurn;

  try {
    Object.defineProperty(window, "butterchurn", {
      configurable: true,
      enumerable: true,
      get() {
        return internalButterchurn;
      },
      set(value) {
        console.log(TAG, "window.butterchurn assigned.");
        internalButterchurn = hookButterchurn(value);
      }
    });

    if (internalButterchurn) {
      window.butterchurn = internalButterchurn;
    }
  } catch (error) {
    console.warn(TAG, "Could not hook window.butterchurn property:", error);
  }

  const poll = setInterval(() => {
    if (window.butterchurn) {
      hookButterchurn(window.butterchurn);
    }

    if (capturedVisualizer && !loadedOnce) {
      loadLocalPreset(getCurrentIndex(), "poll fallback").catch((error) => {
        console.warn(TAG, "Poll fallback load failed:", error);
      });
    }
  }, 500);

  setTimeout(() => {
    clearInterval(poll);
    console.log(TAG, "polling stopped. capturedVisualizer =", capturedVisualizer);
  }, 30000);

  /*
    Keyboard controls:

      Ctrl + Alt + P          next preset
      Ctrl + Alt + Shift + P  random preset
      Ctrl + Alt + O          reload current preset and manifest
      Ctrl + Alt + [          previous preset

    Yes, this is a whole little preset workstation now. Browsers made us earn it.
  */
  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();

    if (event.ctrlKey && event.altKey && event.shiftKey && key === "p") {
      event.preventDefault();
      randomPreset();
      return;
    }

    if (event.ctrlKey && event.altKey && key === "p") {
      event.preventDefault();
      nextPreset();
      return;
    }

    if (event.ctrlKey && event.altKey && key === "o") {
      event.preventDefault();
      reloadCurrentPreset();
      return;
    }

    if (event.ctrlKey && event.altKey && event.key === "[") {
      event.preventDefault();
      previousPreset();
    }
  });

  // Preload the manifest early so failures show up in the console immediately.
  setTimeout(() => {
    loadManifest().catch((error) => {
      console.error(TAG, "Manifest preload failed:", error);
      updateStatus("LOCAL PRESET MANIFEST FAILED");
    });
  }, 250);
})();
