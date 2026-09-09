# Layout Manager — KWin script for KDE Plasma 6

Preset and dynamic window layouts, switchable with keyboard shortcuts,
working on a single ultra-wide (G9) display.

> **Built by agents:** this project was authored entirely by AI coding agents
> running through [opencode](https://opencode.ai), as a test of agent-driven
> development capabilities. All code, docs, and iteration were agent-produced.

## Shortcuts

| Key       | Action |
|-----------|--------|
| `Meta+F2` | **Gaming** — press, then click the main window: it becomes the anchor (~center); side windows fill the remaining left/right space and **reflow live as you resize the anchor** |
| `Meta+F3` | Toggle **Center Stage** — focused window pulled to center, previous pushed to a side stack |
| `Meta+F1` | **Click-Pick** — click up to 4 windows in order to compose a fixed layout |

**Pressing the key of the currently-active mode again turns the mode off** —
windows stay exactly where they are (nothing is restored or moved). This is the
"off" behavior; there is no separate off shortcut.

### Gaming (Meta+F2)

1. Press `Meta+F2` (re-press to cancel the pick).
2. Click the window you want to treat as the main window.
3. It is placed in the center; every other open window fills the left/right
   side slots. On each side, windows sit directly on top of each other
   (fully overlapping) rather than being cascaded or compressed.
4. Grab a side edge of the main window and drag — the side windows reflow to
   fill the gap (or shrink) to match its new width.

Gaming is anchored purely by the main window's *width*: side windows always
stay full-height.

### Click-Pick composition (Meta+F1)

1. Press `Meta+F1` to arm pick mode.
2. Click windows **in order** — click order decides placement. No holding of
   keys needed; pick mode stays armed until you pick 4 or cancel.
3. The 4-slot template auto-applies once 4 windows are picked:

```
|   pick 1 (35%)  |  pick 2 (35%)  |  pick 3 (30%, top)  |
|                 |                 |  pick 4 (30%, bottom) |
```

- Re-clicking an already-picked window removes it (toggle).
- Press `Meta+F1` again before 4 picks to cancel (nothing moves).
- The template widths can be edited in the `CONFIG.pick.slots` array.

> All shortcuts can be reassigned in System Settings -> Shortcuts -> KWin
> (search for "Layout Manager").

## Install

```bash
kpackagetool6 --type=KWin/Script -i ./layout-manager/
```

Enable in System Settings -> Window Management -> KWin Scripts
(tick "Layout Manager").

## Configure

All configuration lives in the `CONFIG` object at the top of
`contents/code/main.js` (KWin scripts cannot read files from disk, so this is
the source of truth). A documented reference copy of the templates is at
`~/.config/layout-manager/layouts.json`.

## Reloading after config changes

After editing `CONFIG`, unload and re-run the script from a terminal
(toggling the script in System Settings does **not** reliably reload it):

```bash
qdbus6 org.kde.KWin /Scripting unloadScript layout-manager
ID=$(qdbus6 org.kde.KWin /Scripting loadScript \
  ~/.local/share/kwin/scripts/layout-manager/contents/code/main.js layout-manager)
qdbus6 org.kde.KWin "/Scripting/Script$ID" run
```

The `loadScript` call returns a script id; the code only runs once you call
`run` on the matching `/Scripting/Script<id>` node. Verify with
`journalctl --since "1 min ago" | grep "Layout Manager"`. Do NOT restart the
KWin compositor service to reload scripts (this black-screens the session).

## Troubleshooting / iteration

- Fast iteration: use `plasma-interactiveconsole --kwin` to live-test snippets.
- Debug logs: `journalctl -f QT_CATEGORY=js QT_CATEGORY=kwin_scripting`
  (or `kdebugsettings` -> KWin Scripting -> Full Debug).
- Uninstall: `kpackagetool6 --type=KWin/Script -r layout-manager`

## Notes / limitations

- Windows that are part of KWin's built-in tiling may conflict with manual
  `frameGeometry` placement; if a window stays in a stale tile, untile it first.
- Shortcuts registered by the script linger in System Settings if the script
  is later removed.