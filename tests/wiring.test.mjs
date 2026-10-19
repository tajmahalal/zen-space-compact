// Drives the browser wiring against small fakes of the Zen globals it uses.
import { test } from "node:test";
import assert from "node:assert/strict";

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

function fakeElement() {
  const attrs = new Map();
  const listeners = {};
  return {
    dataset: {},
    attrs,
    observers: [],
    getAttribute: k => (attrs.has(k) ? attrs.get(k) : null),
    hasAttribute: k => attrs.has(k),
    setAttribute(k, v) {
      const oldValue = this.getAttribute(k);
      attrs.set(k, String(v));
      for (const o of this.observers) o.notify(k, oldValue);
    },
    removeAttribute(k) {
      attrs.delete(k);
    },
    addEventListener: (type, fn) => ((listeners[type] ||= []).push(fn)),
    dispatch: (type, event = {}) => (listeners[type] || []).forEach(fn => fn(event)),
    appendChild(child) {
      this.child = child;
    },
  };
}

async function setup({ saved = "{}", startupCompact = false, privateWindow = false } = {}) {
  const prefs = { "mod.spacecompact.map": saved };
  const root = fakeElement();
  const popup = fakeElement();
  let restored;

  globalThis.Services = {
    prefs: {
      getStringPref: (k, d) => prefs[k] ?? d,
      setStringPref: (k, v) => (prefs[k] = v),
    },
  };
  globalThis.MutationObserver = class {
    constructor(cb) {
      this.cb = cb;
    }
    observe(el, { attributeFilter }) {
      this.filter = attributeFilter;
      el.observers.push(this);
    }
    notify(name, oldValue) {
      if (this.filter.includes(name)) queueMicrotask(() => this.cb([{ oldValue }]));
    }
  };
  globalThis.document = {
    documentElement: root,
    getElementById: id => (id === "zenWorkspaceMoreActions" ? popup : null),
    createXULElement: () => fakeElement(),
  };
  globalThis.SessionStore = {
    promiseAllWindowsRestored: new Promise(r => (restored = r)),
  };

  // Turning on is immediate; turning off animates first, like Zen.
  const cm = {
    get preference() {
      return root.getAttribute("zen-compact-mode") === "true";
    },
    set preference(v) {
      if (root.hasAttribute("zen-compact-animating") || this.preference === v) return;
      if (v) {
        root.setAttribute("zen-compact-mode", true);
      } else {
        root.setAttribute("zen-compact-animating", "true");
        setTimeout(() => {
          root.removeAttribute("zen-compact-animating");
          root.setAttribute("zen-compact-mode", false);
        }, 20);
      }
    },
  };
  const spaces = privateWindow ? [{ uuid: "P" }] : [{ uuid: "A" }, { uuid: "B" }];
  const ws = {
    activeWorkspace: privateWindow ? "P" : "A",
    privateWindowOrDisabled: privateWindow,
    getWorkspaces: () => spaces,
    async changeWorkspace(w) {
      this.activeWorkspace = w.uuid;
      return w;
    },
  };
  globalThis.window = { gZenWorkspaces: ws, gZenCompactModeManager: cm };
  globalThis.gZenWorkspaces = ws;
  globalThis.gZenCompactModeManager = cm;
  // Zen registers its own startup restore before any mod loads.
  SessionStore.promiseAllWindowsRestored.then(() => {
    cm.preference = startupCompact;
  });

  await import(`../space-compact.uc.mjs?t=${Math.random()}`);
  await tick();
  restored();
  await tick(5);

  const map = () => JSON.parse(prefs["mod.spacecompact.map"]);
  const userToggle = async () => {
    cm.preference = !cm.preference;
    await tick(40);
  };
  const go = async uuid => {
    await ws.changeWorkspace({ uuid });
    await tick(40);
  };
  return { root, popup, cm, ws, map, userToggle, go, prefs };
}

test("a user toggle is saved for the current space only", async () => {
  const t = await setup();
  await t.userToggle();
  assert.deepEqual(t.map(), { A: true });
  await t.go("B");
  assert.equal(t.cm.preference, false);
  assert.deepEqual(t.map(), { A: true });
});

test("switching back restores the saved state", async () => {
  const t = await setup({ saved: '{"A":true}' });
  assert.equal(t.cm.preference, true);
  await t.go("B");
  assert.equal(t.cm.preference, false);
  await t.go("A");
  assert.equal(t.cm.preference, true);
  assert.deepEqual(t.map(), { A: true });
});

test("the mod's own switching never rewrites the map", async () => {
  const t = await setup({ saved: '{"A":true}' });
  await t.go("B");
  await t.go("A");
  await t.go("B");
  assert.deepEqual(t.map(), { A: true });
});

test("startup prunes deleted spaces", async () => {
  const t = await setup({ saved: '{"A":true,"gone":true}' });
  assert.deepEqual(t.map(), { A: true });
});

test("ticking a non-active space in the menu saves it without changing the current state", async () => {
  const t = await setup();
  const item = t.popup.child;
  assert.equal(item.getAttribute("label"), "Compact mode in this space");
  const button = { getAttribute: () => "B" };
  t.popup.dispatch("popupshowing", {
    target: t.popup,
    explicitOriginalTarget: { closest: () => button },
  });
  assert.equal(item.hasAttribute("checked"), false);
  item.setAttribute("checked", "true");
  item.dispatch("command");
  await tick(40);
  assert.deepEqual(t.map(), { B: true });
  assert.equal(t.cm.preference, false);
  await t.go("B");
  assert.equal(t.cm.preference, true);
});

test("unticking the active space turns compact off", async () => {
  const t = await setup({ saved: '{"A":true}' });
  const item = t.popup.child;
  t.popup.dispatch("popupshowing", { target: t.popup });
  assert.equal(item.getAttribute("checked"), "true");
  item.removeAttribute("checked");
  item.dispatch("command");
  await tick(40);
  assert.equal(t.cm.preference, false);
  assert.deepEqual(t.map(), { A: false });
});

test("Zen's startup restore doesn't overwrite the saved choice", async () => {
  const t = await setup({ saved: '{"A":true}', startupCompact: false });
  await tick(60);
  assert.equal(t.cm.preference, true);
  assert.deepEqual(t.map(), { A: true });
});

test("a private window leaves the saved map alone", async () => {
  const t = await setup({ saved: '{"A":true}', privateWindow: true });
  await tick(60);
  assert.deepEqual(t.map(), { A: true });
  assert.equal(t.popup.child, undefined);
});
