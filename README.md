# Space Compact

A [Sine](https://github.com/CosmoCreeper/Sine) mod for Zen Browser that remembers compact mode on/off **per space**.
Switch spaces and compact mode follows. Spaces you haven't set yet stay out of compact mode.

## Install

1. Install Sine if you don't have it.
2. In `about:config`, set `sine.allow-unsafe-js` to `true`. Sine only runs JavaScript from store mods unless this is on.
3. Open Sine's settings, paste this repo's GitHub URL into the install box, and install.
4. Restart Zen.

## Use

- **Remember per space:** in any space, turn compact mode on or off the normal way (`Ctrl+Alt+C`, or the toolbar menu). That choice is saved for that space.
- **Right-click a space:** tick or untick **Compact mode in this space**. This works on spaces you're not currently in, too.

Choices are stored in the pref `mod.spacecompact.map`. To reset everything, delete that pref in `about:config`.

## Develop

```bash
node --test --test-concurrency=1 tests/*.test.mjs
```

The mod uses Zen internals (`gZenWorkspaces.changeWorkspace`, `gZenCompactModeManager.preference`, `#zenWorkspaceMoreActions`). If a Zen update renames them, the Browser Console (`Ctrl+Shift+J`) shows a `[space-compact]` error.
