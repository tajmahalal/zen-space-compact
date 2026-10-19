# Space Compact: design

Date: 2026-10-19

## Goal

A Zen Browser mod, loaded by Sine, that keeps compact mode on in the spaces the user chooses and off in the rest. It switches automatically when the active space changes.

## Agreed with the user

- Loader: Sine (JavaScript mod). Not a CSS-only store mod.
- How spaces are chosen: both of these, sharing one saved setting:
  1. Remember per space: toggling compact mode normally (Ctrl+Alt+C, toolbar, or menu) saves that state for the current space.
  2. Right-click menu: a checkbox, "Compact mode in this space", in the space's context menu.
- A space with no saved choice: compact **off**.

## Zen internals relied on (verified in `zen-browser/desktop`, branch `dev`, 2026-10-19)

| Need | API | Source |
|---|---|---|
| Read compact state | `gZenCompactModeManager.preference` (getter reads `zen-compact-mode="true"` on `document.documentElement`) | `src/zen/compact-mode/ZenCompactMode.mjs` |
| Set compact state | `gZenCompactModeManager.preference = bool` | same |
| Active space ID | `gZenWorkspaces.activeWorkspace` (UUID string) | `src/zen/spaces/ZenSpaceManager.mjs` |
| Space switch | `gZenWorkspaces.changeWorkspace(workspace, ...args)` (async; every switch path calls it, including startup with `{ onInit: true }`, swipes and shortcuts) | same |
| List spaces | `gZenWorkspaces.getWorkspaces()` → `[{ uuid, name, icon, ... }]` | same |
| Space context menu | `<menupopup id="zenWorkspaceMoreActions">`; target space = `event.explicitOriginalTarget?.closest("toolbarbutton")?.getAttribute("zen-workspace-id")`, falling back to the active space | same, `updateWorkspaceActionsMenu` |

These are internal, undocumented APIs. A Zen update can rename them. The script checks that they exist and logs one console error instead of throwing if they don't.

## Files

```
zen-space-compact/
  theme.json             Sine manifest: id, name, description, version, "scripts" → space-compact.uc.mjs
  space-compact.uc.mjs   all logic (~120 lines)
  README.md              install and test steps
```

## Design

### Storage

- One string pref: `mod.spacecompact.map`, JSON `{ "<space uuid>": true | false }`.
- Read with `Services.prefs.getStringPref(name, "{}")`. Corrupt JSON → treat as `{}`.
- Written whenever a choice changes. Entries for deleted spaces are pruned on startup (keep only UUIDs in `getWorkspaces()`).

### Applying on switch

- Wrap `gZenWorkspaces.changeWorkspace`: call the original, `await` it, then `apply()`.
- `apply()`: `want = map[activeWorkspace] === true`; if `gZenCompactModeManager.preference !== want`, set it inside an `applying` guard.
- Startup: the script may load after Zen's first `changeWorkspace`, so it also calls `apply()` once `gZenWorkspaces` and `gZenCompactModeManager` exist (and again after `SessionStore.promiseAllWindowsRestored`, because Zen restores its own saved compact state then).

### Recording user toggles

- A `MutationObserver` on `document.documentElement`, attribute `zen-compact-mode`.
- On change: if the `applying` guard is set or a space switch is in progress, ignore it. Otherwise save `map[activeWorkspace] = preference`.
- Because of the guard, the mod's own switching never overwrites a saved choice.

### Right-click menu

- On `popupshowing` of `#zenWorkspaceMoreActions`, insert (once) a `menuitem` with `type="checkbox"`, label "Compact mode in this space", and set `checked` from the map for the target space.
- On `command`: save the new value for the target space. If the target is the active space, also `apply()`.

### Failure handling

- Missing Zen globals: retry for up to 10 s (Zen initialises asynchronously), then log `[space-compact] Zen APIs not found` and stop.
- Zen's setter can refuse to enable compact mode (`shouldBeCompact` is false, e.g. while the library is open). The mod accepts that and doesn't retry.
- Private windows / spaces disabled: `changeWorkspace` returns early; `apply()` does nothing if `activeWorkspace` is empty.

## Out of scope

- Separate per-space choices for sidebar vs toolbar hiding (uses Zen's global setting).
- Syncing choices across devices.
- Publishing to the Sine marketplace (possible later; needs a GitHub repo).

## Testing (manual, in Zen; no automated harness exists for Sine mods)

1. Install locally in Sine; restart Zen. No `[space-compact]` errors in the Browser Console (Ctrl+Shift+J).
2. Space A: press Ctrl+Alt+C to turn compact on. Switch to space B: compact goes off.
3. Switch back to A: compact comes back on.
4. Right-click space B → tick "Compact mode in this space": compact turns on, and the tick is still there when you reopen the menu.
5. Create a new space C: compact is off.
6. Restart Zen: A and B stay compact, C doesn't.
