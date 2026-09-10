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
|   pick 1 (30%)  |   pick 2 (45%)  |  pick 3 (25%, top)  |
|                 |                 |  pick 4 (25%, bottom) |
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