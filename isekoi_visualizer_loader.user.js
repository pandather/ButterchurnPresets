// ==UserScript==
// @name         ISEKOI Local Butterchurn Preset Loader - Fixed Page Hook
// @namespace    local.isekoi.butterchurn
// @version      1.2
// @description  Load local Butterchurn presets and mirror them into the ISEKOI visualizer dropdown
// @match        https://isekoi-radio.com/*
// @match        https://www.isekoi-radio.com/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      127.0.0.1
// @connect      localhost
// ==/UserScript==

(function () {
  "use strict";

  const TAG = "[ISEKOI LOCAL PRESETS]";

  /*
    Run this in your preset folder:

      cd /path/to/butterchurn-presets
      python3 -m http.server 8765

    Required files:

      manifest.json
      your-preset.json
  */

  const PRESET_BASE_URL = "http://127.0.0.1:8765";
  const MANIFEST_FILE = "manifest.json";

  const STORAGE_INDEX_KEY = "isekoiLocalButterchurnPresetIndex";
  const STORAGE_LAST_FILE_KEY = "isekoiLocalButterchurnPresetFile";

  const PRESET_SELECT_SELECTOR = "select.viz-preset-select";
  const LOCAL_OPTION_PREFIX = "__isekoi_local_preset__:";
  const LOCAL_OPTION_GROUP_SELECTOR =
    'optgroup[data-isekoi-local-presets="true"]';

  /*
    Critical fix:
    With GM_xmlhttpRequest enabled, Tampermonkey runs in a sandbox.
    The actual site objects live on unsafeWindow.
  */
  const PAGE =
    typeof unsafeWindow !== "undefined" && unsafeWindow
      ? unsafeWindow
      : window;

  let capturedVisualizer = null;
  let presetManifest = [];
  let manifestPromise = null;
  let loadedOnce = false;
  let pendingLoadIndex = null;
  let desiredDropdownIndex = null;
  let dropdownObserver = null;
  let dropdownSyncQueued = false;
  let dropdownSyncing = false;
  const hookedPresetSelects = new WeakSet();

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

  function getPresetSelect() {
    return document.querySelector(PRESET_SELECT_SELECTOR);
  }

  function localOptionValue(index) {
    return `${LOCAL_OPTION_PREFIX}${index}`;
  }

  function parseLocalOptionValue(value) {
    if (typeof value !== "string" || !value.startsWith(LOCAL_OPTION_PREFIX)) {
      return null;
    }

    const parsed = Number.parseInt(value.slice(LOCAL_OPTION_PREFIX.length), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function findLocalOption(select, index) {
    if (!select) return null;

    const value = localOptionValue(index);

    for (const option of select.options) {
      if (option.value === value) return option;
    }

    return null;
  }

  function attachPresetSelectHandler(select) {
    if (!select || hookedPresetSelects.has(select)) return;

    hookedPresetSelects.add(select);

    select.addEventListener(
      "change",
      (event) => {
        const localIndex = parseLocalOptionValue(select.value);

        if (localIndex === null) {
          // The user picked one of ISEKOI's built-in presets. Let the site handle it.
          desiredDropdownIndex = null;
          return;
        }

        // Do not let the site's own preset loader try to resolve our synthetic value.
        event.preventDefault();
        event.stopImmediatePropagation();

        loadLocalPreset(localIndex, "dropdown selection").catch((error) => {
          console.warn(TAG, "Dropdown preset load failed:", error);
          updateStatus("LOCAL PRESET DROPDOWN LOAD FAILED");
        });
      },
      true
    );
  }

  function setDropdownSelected(index) {
    if (!presetManifest.length) return false;

    const normalized = normalizeIndex(index, presetManifest.length);
    desiredDropdownIndex = normalized;

    const select = getPresetSelect();
    if (!select) return false;

    const option = findLocalOption(select, normalized);
    if (!option) return false;

    option.selected = true;
    select.value = option.value;

    return true;
  }

  function syncPresetDropdown(selectedIndex = desiredDropdownIndex) {
    if (dropdownSyncing) return false;

    const select = getPresetSelect();
    if (!select) return false;

    attachPresetSelectHandler(select);

    dropdownSyncing = true;

    try {
      select
        .querySelectorAll(LOCAL_OPTION_GROUP_SELECTOR)
        .forEach((node) => node.remove());

      if (!presetManifest.length) return true;

      const group = document.createElement("optgroup");
      group.label = `LOCAL PRESETS (${presetManifest.length})`;
      group.dataset.isekoiLocalPresets = "true";

      presetManifest.forEach((entry, index) => {
        const option = document.createElement("option");
        option.value = localOptionValue(index);
        option.textContent = `LOCAL ${index + 1}: ${entry.name}`;
        option.title = entry.file || entry.url || entry.name;
        option.dataset.isekoiLocalPreset = "true";
        option.dataset.index = String(index);
        group.appendChild(option);
      });

      // Put local presets at the top, because burying three custom presets under a
      // mountain of Milkdrop names is how civilization declines.
      select.insertBefore(group, select.firstChild);

      if (selectedIndex !== null && selectedIndex !== undefined) {
        setDropdownSelected(selectedIndex);
      }

      return true;
    } finally {
      dropdownSyncing = false;
    }
  }

  function presetDropdownNeedsSync() {
    const select = getPresetSelect();
    if (!select) return false;

    const group = select.querySelector(LOCAL_OPTION_GROUP_SELECTOR);
    if (!group) return true;

    return group.querySelectorAll("option").length !== presetManifest.length;
  }

  function queueDropdownSync(selectedIndex = desiredDropdownIndex) {
    if (dropdownSyncQueued) return;

    dropdownSyncQueued = true;

    setTimeout(() => {
      dropdownSyncQueued = false;
      syncPresetDropdown(selectedIndex);
    }, 50);
  }

  function installPresetDropdownObserver() {
    if (dropdownObserver) return;

    const root = document.documentElement || document;
    if (!root || typeof MutationObserver === "undefined") return;

    try {
      dropdownObserver = new MutationObserver(() => {
        if (!presetManifest.length || dropdownSyncing) return;

        if (presetDropdownNeedsSync()) {
          queueDropdownSync(desiredDropdownIndex);
        }
      });

      dropdownObserver.observe(root, {
        childList: true,
        subtree: true
      });

      console.log(TAG, "Installed preset dropdown observer.");
    } catch (error) {
      console.warn(TAG, "Could not install preset dropdown observer:", error);
    }
  }

  function isAbsoluteUrl(value) {
    return /^https?:\/\//i.test(value);
  }

  function encodePathPreservingSlashes(path) {
    return String(path)
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

      PAGE.__isekoiLocalPresetManifest = presetManifest;

      installPresetDropdownObserver();
      syncPresetDropdown(currentIndex);
      setDropdownSelected(currentIndex);

      console.log(TAG, "Manifest loaded:", presetManifest);
      updateStatus(`LOCAL PRESETS READY ${presetManifest.length}`);

      return presetManifest;
    })();

    return manifestPromise;
  }

  async function loadLocalPreset(index = getCurrentIndex(), reason = "manual") {
    const manifest = await loadManifest();
    const normalized = setCurrentIndex(index);
    const entry = manifest[normalized];

    if (!entry) {
      console.warn(TAG, "No preset at index:", normalized);
      return false;
    }

    syncPresetDropdown(normalized);
    setDropdownSelected(normalized);

    if (!capturedVisualizer || typeof capturedVisualizer.loadPreset !== "function") {
      pendingLoadIndex = normalized;
      console.warn(TAG, "Visualizer not ready yet. Preset queued:", entry);
      updateStatus(`LOCAL PRESET QUEUED: ${entry.name}`);
      return false;
    }

    console.log(TAG, `Loading preset ${normalized + 1}/${manifest.length}:`, entry);

    const preset = await gmFetchJson(entry.url);

    try {
      capturedVisualizer.loadPreset(preset, 0.0);
      loadedOnce = true;
      pendingLoadIndex = null;

      localStorage.setItem(STORAGE_LAST_FILE_KEY, entry.file);

      PAGE.__isekoiCustomButterchurnVisualizer = capturedVisualizer;
      PAGE.__isekoiCustomButterchurnPreset = preset;
      PAGE.__isekoiLocalPresetManifest = presetManifest;
      PAGE.__isekoiLocalPresetEntry = entry;

      updateStatus(`LOCAL PRESET ${normalized + 1}/${manifest.length}: ${entry.name}`);
      syncPresetDropdown(normalized);
      setDropdownSelected(normalized);

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
    loadedOnce = false;
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

  function exposeConsoleCommands() {
    PAGE.isekoiLocalPresetList = listPresets;
    PAGE.isekoiLocalPresetLoad = loadLocalPreset;
    PAGE.isekoiLocalPresetNext = nextPreset;
    PAGE.isekoiLocalPresetPrevious = previousPreset;
    PAGE.isekoiLocalPresetRandom = randomPreset;
    PAGE.isekoiLocalPresetReload = reloadCurrentPreset;
    PAGE.isekoiLocalPresetSyncDropdown = () => syncPresetDropdown(getCurrentIndex());
    PAGE.isekoiLocalPresetManifest = () => presetManifest;
    PAGE.isekoiLocalPresetVisualizer = () => capturedVisualizer;
  }

  exposeConsoleCommands();

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

  function captureVisualizer(visualizer, reason) {
    if (!visualizer || typeof visualizer.loadPreset !== "function") {
      console.warn(TAG, "Tried to capture invalid visualizer via", reason, visualizer);
      return null;
    }

    capturedVisualizer = visualizer;

    PAGE.__isekoiCustomButterchurnVisualizer = visualizer;

    console.log(TAG, "Captured visualizer via", reason, visualizer);

    const index =
      pendingLoadIndex !== null && Number.isFinite(pendingLoadIndex)
        ? pendingLoadIndex
        : getCurrentIndex();

    loadLocalPreset(index, `visualizer captured: ${reason}`).catch((error) => {
      console.warn(TAG, "Failed loading queued preset after capture:", error);
    });

    return visualizer;
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

      captureVisualizer(visualizer, "createVisualizer hook");

      let attempts = 0;

      const timer = setInterval(() => {
        attempts += 1;

        if (capturedVisualizer && !loadedOnce) {
          loadLocalPreset(getCurrentIndex(), `capture retry ${attempts}`).catch(
            (error) => {
              console.warn(TAG, "Preset load retry failed:", error);
            }
          );
        }

        if (loadedOnce || attempts >= 40) {
          clearInterval(timer);
        }
      }, 700);

      return visualizer;
    };

    api.__isekoiLocalPresetHooked = true;
    console.log(TAG, "Hooked Butterchurn API:", api);

    return candidate;
  }

  function installButterchurnSetterHook() {
    let internalButterchurn = PAGE.butterchurn;

    try {
      Object.defineProperty(PAGE, "butterchurn", {
        configurable: true,
        enumerable: true,
        get() {
          return internalButterchurn;
        },
        set(value) {
          console.log(TAG, "PAGE.butterchurn assigned.");
          internalButterchurn = hookButterchurn(value);
        }
      });

      if (internalButterchurn) {
        PAGE.butterchurn = internalButterchurn;
      }

      console.log(TAG, "Installed PAGE.butterchurn setter hook.");
    } catch (error) {
      console.warn(TAG, "Could not hook PAGE.butterchurn property:", error);

      if (PAGE.butterchurn) {
        hookButterchurn(PAGE.butterchurn);
      }
    }
  }

  function findExistingVisualizer() {
    if (capturedVisualizer) return capturedVisualizer;

    const likelyKeys = [
      "visualizer",
      "butterchurnVisualizer",
      "milkdropVisualizer",
      "__visualizer",
      "__butterchurnVisualizer",
      "__isekoiVisualizer",
      "__isekoiCustomButterchurnVisualizer"
    ];

    for (const key of likelyKeys) {
      try {
        const value = PAGE[key];

        if (value && typeof value.loadPreset === "function") {
          return captureVisualizer(value, `PAGE.${key}`);
        }
      } catch (error) {
        // Some page properties are rude little traps. Ignore.
      }
    }

    return null;
  }

  installButterchurnSetterHook();
  installPresetDropdownObserver();

  /*
    Keep polling. Do not give up after 30 seconds.
    The visualizer may not exist until the user clicks Play or opens it.
  */
  let pollCount = 0;

  const poll = setInterval(() => {
    pollCount += 1;

    if (PAGE.butterchurn) {
      hookButterchurn(PAGE.butterchurn);
    }

    findExistingVisualizer();

    if (capturedVisualizer && !loadedOnce) {
      loadLocalPreset(getCurrentIndex(), "persistent poll fallback").catch((error) => {
        console.warn(TAG, "Poll fallback load failed:", error);
      });
    }

    if (pollCount === 60) {
      console.log(TAG, "still polling. capturedVisualizer =", capturedVisualizer);
    }
  }, 500);

  window.addEventListener(
    "keydown",
    (event) => {
      const key = event.key.toLowerCase();

      if (event.ctrlKey && event.altKey && event.shiftKey && key === "p") {
        event.preventDefault();
        event.stopImmediatePropagation();
        randomPreset();
        return;
      }

      if (event.ctrlKey && event.altKey && key === "p") {
        event.preventDefault();
        event.stopImmediatePropagation();
        nextPreset();
        return;
      }

      if (event.ctrlKey && event.altKey && key === "o") {
        event.preventDefault();
        event.stopImmediatePropagation();
        reloadCurrentPreset();
        return;
      }

      if (event.ctrlKey && event.altKey && event.key === "[") {
        event.preventDefault();
        event.stopImmediatePropagation();
        previousPreset();
      }
    },
    true
  );

  setTimeout(() => {
    loadManifest().catch((error) => {
      console.error(TAG, "Manifest preload failed:", error);
      updateStatus("LOCAL PRESET MANIFEST FAILED");
    });
  }, 250);
})();
