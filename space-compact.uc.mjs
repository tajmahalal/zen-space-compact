// Space Compact: remembers Zen compact mode on/off per space.
// Loaded by Sine into browser.xhtml. The helpers below are pure so they can be
// tested in Node; the browser wiring only runs when Firefox's `Services` exists.

export function parseMap(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {};
  }
  const map = {};
  for (const [uuid, on] of Object.entries(data)) {
    if (typeof on === "boolean") {
      map[uuid] = on;
    }
  }
  return map;
}

// An empty list means Zen hasn't loaded its spaces yet, not that they were all deleted.
export function pruneMap(map, uuids) {
  if (!uuids.length) {
    return map;
  }
  const keep = new Set(uuids);
  return Object.fromEntries(Object.entries(map).filter(([uuid]) => keep.has(uuid)));
}

export function wantCompact(map, uuid) {
  return map[uuid] === true;
}

export function setChoice(map, uuid, on) {
  return { ...map, [uuid]: on };
}

// `expected` is the value the mod last asked Zen for (or null). Seeing it once
// means the change was the mod's own, so it must not be saved as a user choice.
export function matchExpected(expected, value) {
  if (expected !== null && value === expected) {
    return { own: true, expected: null };
  }
  return { own: false, expected };
}

export function shouldRecord({ applying, switching, uuid }) {
  return !applying && !switching && !!uuid;
}

if (typeof Services !== "undefined") {
  const PREF = "mod.spacecompact.map";
  const LOG = "[space-compact]";
  const MENU_LABEL = "Compact mode in this space";
  const root = document.documentElement;

  let expected = null; // value the mod asked Zen for and hasn't seen applied yet
  let switching = 0; // nested changeWorkspace calls in flight
  let ready = false; // false until Zen has restored its own startup state
  let retryTimer = null;

  const loadMap = () => parseMap(Services.prefs.getStringPref(PREF, "{}"));
  const saveMap = map => Services.prefs.setStringPref(PREF, JSON.stringify(map));

  const waitForZen = async () => {
    for (let i = 0; i < 50; i++) {
      if (window.gZenWorkspaces?.changeWorkspace && window.gZenCompactModeManager) {
        return true;
      }
      await new Promise(r => setTimeout(r, 200));
    }
    console.error(`${LOG} Zen APIs not found`);
    return false;
  };

  const apply = (tries = 0) => {
    clearTimeout(retryTimer);
    const uuid = gZenWorkspaces.activeWorkspace;
    // Before Zen's own startup restore, any change here would be undone by it.
    if (!ready || !uuid) {
      return;
    }
    // Mid-animation `preference` is stale and Zen ignores the setter, so wait.
    if (root.hasAttribute("zen-compact-animating")) {
      if (tries < 20) {
        retryTimer = setTimeout(() => apply(tries + 1), 150);
      }
      return;
    }
    const want = wantCompact(loadMap(), uuid);
    const cm = gZenCompactModeManager;
    if (cm.preference === want) {
      return;
    }
    expected = want;
    cm.preference = want;
    // Turning on writes the attribute right away; turning off writes it after an
    // animation. Neither happening means Zen refused (e.g. library open).
    if (cm.preference !== want && !root.hasAttribute("zen-compact-animating")) {
      expected = null;
    }
  };

  const wrapSwitching = () => {
    const orig = gZenWorkspaces.changeWorkspace.bind(gZenWorkspaces);
    // An own property shadows the prototype method, so Zen's internal
    // `this.changeWorkspace(...)` calls go through it too.
    gZenWorkspaces.changeWorkspace = async (...args) => {
      switching++;
      try {
        return await orig(...args);
      } finally {
        switching--;
        apply();
      }
    };
    gZenWorkspaces.changeWorkspace.spaceCompact = true;
  };

  const watchToggles = () => {
    new MutationObserver(records => {
      const value = root.getAttribute("zen-compact-mode") === "true";
      if ((records[0].oldValue === "true") === value) {
        return;
      }
      const match = matchExpected(expected, value);
      expected = match.expected;
      const uuid = gZenWorkspaces.activeWorkspace;
      if (shouldRecord({ applying: match.own, switching: switching > 0 || !ready, uuid })) {
        saveMap(setChoice(loadMap(), uuid, value));
      }
    }).observe(root, { attributeFilter: ["zen-compact-mode"], attributeOldValue: true });
  };

  const installMenu = () => {
    const popup = document.getElementById("zenWorkspaceMoreActions");
    if (!popup) {
      console.error(`${LOG} space menu not found`);
      return;
    }
    const item = document.createXULElement("menuitem");
    item.id = "space-compact-toggle";
    item.setAttribute("type", "checkbox");
    item.setAttribute("label", MENU_LABEL);
    popup.appendChild(item);

    popup.addEventListener("popupshowing", event => {
      if (event.target !== popup) {
        return;
      }
      // Same lookup Zen uses: the space button that was right-clicked, else the active space.
      const uuid =
        event.explicitOriginalTarget?.closest?.("toolbarbutton")?.getAttribute("zen-workspace-id") ||
        gZenWorkspaces.activeWorkspace;
      item.dataset.uuid = uuid;
      if (wantCompact(loadMap(), uuid)) {
        item.setAttribute("checked", "true");
      } else {
        item.removeAttribute("checked");
      }
    });

    item.addEventListener("command", () => {
      const uuid = item.dataset.uuid;
      if (!uuid) {
        return;
      }
      saveMap(setChoice(loadMap(), uuid, item.getAttribute("checked") === "true"));
      if (uuid === gZenWorkspaces.activeWorkspace) {
        apply();
      }
    });
  };

  const init = async () => {
    // Private windows get a throwaway space list; pruning against it would wipe the map.
    if (
      !(await waitForZen()) ||
      gZenWorkspaces.privateWindowOrDisabled ||
      gZenWorkspaces.changeWorkspace.spaceCompact
    ) {
      return;
    }
    wrapSwitching();
    watchToggles();
    installMenu();
    // Zen restores its own global compact state at this point; re-apply after it.
    SessionStore.promiseAllWindowsRestored.then(() =>
      setTimeout(() => {
        saveMap(pruneMap(loadMap(), gZenWorkspaces.getWorkspaces().map(w => w.uuid)));
        ready = true;
        apply();
      }, 0)
    );
  };

  init().catch(e => console.error(LOG, e));
}
