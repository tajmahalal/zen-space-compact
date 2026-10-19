# Space Compact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Sine JS mod for Zen Browser that remembers compact mode on/off per space and applies it on every space switch, with a right-click checkbox per space.

**Architecture:** One ES module, `space-compact.uc.mjs`. Pure state helpers are exported and unit-tested in Node. The browser wiring runs only when Firefox's `Services` global exists. It wraps `gZenWorkspaces.changeWorkspace`, watches the `zen-compact-mode` attribute, and adds a menuitem to `#zenWorkspaceMoreActions`.

**Tech Stack:** Plain JavaScript (ES module), Firefox chrome APIs (`Services.prefs`, XUL `menuitem`), Node 24 `node:test` for unit tests. No dependencies.

**Spec:** `docs/superpowers/specs/2026-10-19-space-compact-design.md`

## Global Constraints

- Repo root: `C:\Users\tj204\Claude apps\zen-space-compact\`
- Pref name: `mod.spacecompact.map`, a JSON string of `{ "<uuid>": boolean }`
- Menu label, exactly: `Compact mode in this space`
- Console prefix, exactly: `[space-compact]`
- Spaces with no saved choice: compact **off**
- Zen API retry window: 10 s
- Sine loads `.uc.mjs` via `import()` into `browser.xhtml`; scripts are declared in `theme.json` as `"scripts": { "<file>": { "include": ["chrome://browser/content/browser.xhtml"] } }`
- Non-store JS mods only run with `sine.allow-unsafe-js = true` (in `about:config`)
- Git: no identity is configured on this machine. Commit steps need the user to run `git config user.name` / `git config user.email` in this repo first (repo-local, not `--global`).

## Review Focus

1. **Zen's own startup restore:** Zen sets compact from `zen.view.compact.enable-at-startup` after `SessionStore.promiseAllWindowsRestored`. The mod must re-apply after that, or the first space shows the wrong state. (Task 2, manual step.)
2. **Mod's own toggles saved as user choices:** the attribute observer fires for the mod's own `preference = x`, so without the guard every switch would overwrite the map. (Task 2, unit test on `shouldRecord`.)
3. **Corrupt or hand-edited pref:** invalid JSON or non-boolean values must give `{}` / be dropped, not throw. (Task 1 tests.)
4. **Deleted spaces:** stale UUIDs pruned on startup. (Task 1 test.)
5. **Right-click on a non-active space:** saves for that space and must not change the current compact state. (Task 3, manual step.)

---

### Task 1: State helpers + manifest

**Files:**
- Create: `space-compact.uc.mjs`
- Create: `theme.json`
- Create: `tests/state.test.mjs`

**Interfaces:**
- Produces (exported from `space-compact.uc.mjs`):
  - `parseMap(raw: string | null | undefined) -> Record<string, boolean>`: invalid JSON, non-object, or arrays → `{}`; drops non-boolean values
  - `pruneMap(map, uuids: string[]) -> Record<string, boolean>`: new object with only keys in `uuids`
  - `wantCompact(map, uuid: string) -> boolean`: `map[uuid] === true`
  - `setChoice(map, uuid: string, on: boolean) -> Record<string, boolean>`: new object, input not mutated
  - `shouldRecord({ applying: boolean, switching: boolean, uuid: string }) -> boolean`: false if applying or switching or uuid is empty

- [ ] **Step 1: Write the failing tests** in `tests/state.test.mjs` with `node:test` + `node:assert/strict`:
  - `parseMap('{"a":true,"b":false}')` deep-equals `{a:true,b:false}`
  - `parseMap("not json")`, `parseMap(null)`, `parseMap("[1]")`, `parseMap('"x"')` each deep-equal `{}`
  - `parseMap('{"a":true,"b":"yes"}')` deep-equals `{a:true}`
  - `pruneMap({a:true,b:false}, ["a"])` deep-equals `{a:true}`
  - `wantCompact({a:true}, "a") === true`; `wantCompact({a:false}, "a") === false`; `wantCompact({}, "z") === false`
  - `setChoice(m, "a", true)` returns `{a:true}` and `m` is still `{}`
  - `shouldRecord({applying:true, switching:false, uuid:"a"}) === false`; same with `switching:true` → false; `uuid:""` → false; all clear → true

- [ ] **Step 2: Run** `node --test tests/` from the repo root. Expected: FAIL (module not found / exports missing).

- [ ] **Step 3: Implement** the five exports at the top of `space-compact.uc.mjs`. Add, at the bottom, a placeholder `if (typeof Services !== "undefined") { /* Task 2 */ }` so Node never touches browser globals.

- [ ] **Step 4: Run** `node --test tests/`. Expected: all pass.

- [ ] **Step 5: Create `theme.json`:**
```json
{
  "id": "space-compact",
  "name": "Space Compact",
  "description": "Remembers compact mode on/off per space.",
  "version": "1.0.0",
  "author": "tj204",
  "scripts": {
    "space-compact.uc.mjs": { "include": ["chrome://browser/content/browser.xhtml"] }
  }
}
```
Verify: `node -e "JSON.parse(require('fs').readFileSync('theme.json','utf8'))"` exits 0.

- [ ] **Step 6: Commit** `git add space-compact.uc.mjs theme.json tests && git commit -m "feat: per-space compact state helpers"`

---

### Task 2: Browser wiring (switch + remember)

**Files:**
- Modify: `space-compact.uc.mjs` (replace the placeholder block)

**Interfaces:**
- Consumes: all Task 1 exports.
- Produces (module-internal): `init()`, `loadMap()`, `saveMap(map)`, `apply()`, state flags `applying`, `switching`.

- [ ] **Step 1: Implement `waitForZen(): Promise<boolean>`.** Poll every 200 ms for `window.gZenWorkspaces?.changeWorkspace` and `window.gZenCompactModeManager`. Resolve false after 10 s and log `[space-compact] Zen APIs not found`.
- [ ] **Step 2: Implement `loadMap()` / `saveMap(map)`** with `Services.prefs.getStringPref(PREF, "{}")` → `parseMap`, and `setStringPref(PREF, JSON.stringify(map))`.
- [ ] **Step 3: Implement `apply()`.** `uuid = gZenWorkspaces.activeWorkspace`; return if empty. `want = wantCompact(loadMap(), uuid)`. If `gZenCompactModeManager.preference !== want`, set `applying = true`, assign `preference = want`, then reset `applying = false` in a `finally` after a `queueMicrotask`, so the MutationObserver callback (a microtask) still sees `applying`.
- [ ] **Step 4: Wrap switching.** `const orig = gZenWorkspaces.changeWorkspace.bind(gZenWorkspaces)`. Assign an own property, `gZenWorkspaces.changeWorkspace = async (...a) => { switching = true; try { return await orig(...a); } finally { switching = false; apply(); } }`. The own property shadows the prototype, so Zen's internal `this.changeWorkspace(...)` calls go through it.
- [ ] **Step 5: Record user toggles.** Use a `MutationObserver` on `document.documentElement`, `attributeFilter: ["zen-compact-mode"]`. In the callback: `if (shouldRecord({applying, switching, uuid: gZenWorkspaces.activeWorkspace})) saveMap(setChoice(loadMap(), uuid, gZenCompactModeManager.preference))`.
- [ ] **Step 6: Startup.** In `init()`: `waitForZen()`, then prune (`saveMap(pruneMap(loadMap(), gZenWorkspaces.getWorkspaces().map(w => w.uuid)))`), install the wrap and observer, call `apply()`, and call `SessionStore.promiseAllWindowsRestored.then(() => setTimeout(apply, 0))`. Call `init()` from the `typeof Services` block.
- [ ] **Step 7: Re-run** `node --test tests/`. Expected: still passes (Node never enters the browser block).
- [ ] **Step 8: Manual check** (after Task 4's install, or by re-installing): spec test steps 1, 2, 3, 5, 6. Expected: as in the spec.
- [ ] **Step 9: Commit** `git commit -am "feat: apply and remember compact mode per space"`

---

### Task 3: Right-click checkbox

**Files:**
- Modify: `space-compact.uc.mjs`

**Interfaces:**
- Consumes: `loadMap`, `saveMap`, `setChoice`, `wantCompact`, `apply` (Task 2).
- Produces: `installMenu()`, called from `init()`.

- [ ] **Step 1: Implement `installMenu()`.** Get `#zenWorkspaceMoreActions`; if it's missing, log `[space-compact] space menu not found` and return. Create one `menuitem` (`document.createXULElement`), `id="space-compact-toggle"`, `type="checkbox"`, `label="Compact mode in this space"`, and append it to the popup.
- [ ] **Step 2: On `popupshowing`** (ignore if `event.target !== popup`): `targetId = event.explicitOriginalTarget?.closest?.("toolbarbutton")?.getAttribute("zen-workspace-id") || gZenWorkspaces.activeWorkspace`. Store it on the item (`item.dataset.uuid`) and set `checked` from `wantCompact(loadMap(), targetId)`.
- [ ] **Step 3: On item `command`:** `saveMap(setChoice(loadMap(), item.dataset.uuid, item.getAttribute("checked") === "true"))`. If `item.dataset.uuid === gZenWorkspaces.activeWorkspace`, call `apply()`.
- [ ] **Step 4: Manual check:** spec test step 4. Then Review Focus 5: right-click a different space, tick it, and confirm the current compact state doesn't change. Switch to that space and confirm it's compact.
- [ ] **Step 5: Commit** `git commit -am "feat: per-space compact checkbox in space menu"`

---

### Task 4: README, publish, install

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`** with three sections:
  1. What it does (2 lines).
  2. Install: set `sine.allow-unsafe-js` to `true` in `about:config`, open Sine settings, paste the repo URL, install, then restart Zen.
  3. How to use: Ctrl+Alt+C per space, or right-click a space and choose "Compact mode in this space".
- [ ] **Step 2: Commit** `git add README.md && git commit -m "docs: README"`
- [ ] **Step 3: Publish (needs the user's OK; outward-facing).** Create a public GitHub repo `zen-space-compact` and push `main`. Sine installs from the repo zip, so the repo must be public.
- [ ] **Step 4: Install and run the full spec test list** (steps 1 to 6). Check the Browser Console (Ctrl+Shift+J) for `[space-compact]` errors. Expected: none, and all six steps behave as the spec says.
