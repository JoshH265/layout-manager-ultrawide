// ============================================================================
// Layout Manager — KWin script for KDE Plasma 6
//
// Provides preset and dynamic window layouts switchable via keyboard shortcuts.
// Pressing the shortcut of the currently-active mode again turns it off
// (windows stay exactly where they are).
//
//   - Gaming       : Meta+F2, then click the main window — it becomes the
//                    anchor (center); side windows fill the remaining space
//                    and reflow live as the anchor is resized
//   - Center Stage : dynamic — the focused window is pulled to center, the
//                    previous center window is pushed to a side stack
//   - Click-Pick   : Meta+F1, then click windows in order → auto-applies a
//                    fixed composition (30/45/25 with the last two stacked)
//
// INSTALL:
//   kpackagetool6 --type=KWin/Script -i ./layout-manager/
//   then enable in System Settings -> Window Management -> KWin Scripts
//   (or see README for notes)
//
// CONFIG: edit the CONFIG object below, then re-apply (toggle the script off/on)
//   in System Settings, or run: plasma-interactiveconsole --kwin to test.
// ============================================================================


// ----------------------------------------------------------------------------
// CONFIG — edit this block to add/change modes and slots.
// ----------------------------------------------------------------------------
var CONFIG = {
    defaultMode: "off",

    // Mode switching keys. Leave null to disable that shortcut.
    // Pressing the shortcut of the currently-active mode turns it OFF.
    shortcuts: {
        mode_gaming:       "Meta+F2",
        mode_focuscenter:  "Meta+F3",
        mode_pick:         "Meta+F1"    // click-to-pick composition
    },

    // Click-pick composition template.
    // Meta+F1, then click windows IN ORDER:
    //   pick 1 -> slot 1, pick 2 -> slot 2, pick 3 -> slot 3, pick 4 -> slot 4.
    // Auto-applies once 4 windows are picked.
    // Fractions are of the client area: leftFrac/widthFrac (x) and
    // topFrac/heightFrac (y).
    pick: {
        slots: [
            { name: "s1", leftFrac: 0.0, widthFrac: 0.30, topFrac: 0.0, heightFrac: 1.0 },
            { name: "s2", leftFrac: 0.3, widthFrac: 0.45, topFrac: 0.0, heightFrac: 1.0 },
            { name: "s3", leftFrac: 0.75, widthFrac: 0.25, topFrac: 0.0, heightFrac: 0.5 },
            { name: "s4", leftFrac: 0.75, widthFrac: 0.25, topFrac: 0.5, heightFrac: 0.5 }
        ]
    },

    modes: {
        // ------------------------------------------------------------- GAMING
        // Meta+F2 arms a pick; click the main window -> it becomes the anchor.
        // Its current width defines center; side windows reflow to fill the
        // remaining left/right space whenever the main window is resized.
        gaming: {
            type: "gaming",
            description: "Gaming — click main window, sides follow its size",
            // Only used for the initial center placement (and hence the sides
            // that fill the rest at click time).
            slots: [
                { name: "left",   leftFrac: 0,     widthFrac: 0.2 },
                { name: "center", leftFrac: 0.2,   widthFrac: 0.6 },
                { name: "right",  leftFrac: 0.8,   widthFrac: 0.2 }
            ]
        },

        // ------------------------------------------------------ CENTER STAGE
        focuscenter: {
            type: "focuscenter",
            description: "Center Stage — focused window to center",
            centerWidthFrac: 0.5,   // fraction of width the center occupies
            sideWidthFrac: 0.25,    // fraction each side stack occupies
            stackOffset: 40         // px vertical offset per stacked window
        },

        // ---------------------------------------------------------------- OFF
        // No layout applied. Windows stay exactly where they are until you
        // start another mode.
        off: {
            type: "off",
            description: "Off — no layout applied"
        }
    }
};

// Options that are best kept as constants
var USER_MODE_DEFAULTS = {
    focuscenter:  "right"
};

// ============================================================================
// Implementation — no need to edit below here unless you know what you're doing
// ============================================================================

var state = {
    activeMode: null,
    // focuscenter state
    currentCenter: null,        // internalId of centered window
    originOf: {},               // internalId -> slot name
    sideLists: { left: [], right: [] }, // arrays of internalIds per side
    // click-pick state (Meta+F1)
    pickActive: false,          // true while Meta+F1 pick mode is armed
    picked: [],                 // internalIds in click order (max 4)
    // gaming mode state (Meta+F2)
    gamingArmed: false,         // true while F2 is waiting for an anchor click
    gamingCenter: null,         // internalId of the anchor (main) window
    gamingConn: null            // frameGeometryChanged connection handle
};

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function isWindowWorthManaging(win) {
    if (!win) return false;
    if (!win.normalWindow) return false;
    if (win.minimized) return false;
    if (win.fullScreen) return false;
    if (win.onAllDesktops) return false;
    return win.moveable && win.resizeable;
}

function idOf(win) {
    // internalId is stable across the window's lifetime
    return win.internalId ? win.internalId.toString() : (win.pid + ":" + win.caption);
}

function getClientArea() {
    var win = workspace.activeWindow;
    if (win) {
        try {
            var a = workspace.clientArea(KWin.WorkArea, win);
            if (a && a.width > 0) return a;
        } catch (e) {}
    }
    return workspace.clientArea(KWin.WorkArea, workspace.activeScreen, workspace.currentDesktop);
}

function staticRegions(modeCfg, area) {
    var regions = {};
    var slots = modeCfg.slots;
    for (var i = 0; i < slots.length; i++) {
        var s = slots[i];
        regions[s.name] = {
            x: Math.round(area.x + area.width * s.leftFrac),
            y: area.y,
            width: Math.round(area.width * s.widthFrac),
            height: area.height
        };
    }
    return regions;
}

function centerRegions(modeCfg, area) {
    var cW = Math.round(area.width * modeCfg.centerWidthFrac);
    var sideW = Math.round(area.width * modeCfg.sideWidthFrac);
    var centerX = Math.round(area.x + (area.width - cW) / 2);
    var center = { x: centerX, y: area.y, width: cW, height: area.height };
    var left = { x: area.x, y: area.y, width: sideW, height: area.height };
    var right = { x: area.x + area.width - sideW, y: area.y, width: sideW, height: area.height };
    return { center: center, left: left, right: right };
}

function place(win, region, stackIndex) {
    if (!win || !region) return;
    var x = region.x;
    var y = region.y + (stackIndex || 0) * (CONFIG.modes.focuscenter.stackOffset || 0);
    var w = region.width;
    var h = region.height - (stackIndex || 0) * (CONFIG.modes.focuscenter.stackOffset || 0);
    // A plain object is required for frameGeometry in KWin 6 (Qt.rect is gone)
    win.frameGeometry = { x: x, y: y, width: w, height: h };
    win.keepAbove = false;
}

function collectManagedWindows() {
    var out = [];
    var wins = workspace.windowList();
    for (var i = 0; i < wins.length; i++) {
        if (isWindowWorthManaging(wins[i])) out.push(wins[i]);
    }
    return out;
}

// ----------------------------------------------------------------------------
// Center Stage (focus follows) mode
// ----------------------------------------------------------------------------
function resetFocusCenter() {
    state.currentCenter = null;
    state.originOf = {};
    state.sideLists = { left: [], right: [] };
}

function findWindow(sid) {
    if (!sid) return null;
    var wins = workspace.windowList();
    for (var i = 0; i < wins.length; i++) {
        if (idOf(wins[i]) === sid) return wins[i];
    }
    return null;
}

function removeFromSide(sid) {
    for (var side in state.sideLists) {
        var list = state.sideLists[side];
        var idx = list.indexOf(sid);
        if (idx !== -1) list.splice(idx, 1);
    }
}

function pushToSide(sid, side) {
    removeFromSide(sid);
    // newest first so it sits at the top (stackOffset 0)
    var list = state.sideLists[side] || (state.sideLists[side] = []);
    list.unshift(sid);
    state.originOf[sid] = side;
}

function handleFocusCenter(win) {
    if (!win) return;
    if (!isWindowWorthManaging(win)) return;
    var sid = idOf(win);
    if (sid === state.currentCenter) return; // already centered, nothing to do

    var modeCfg = CONFIG.modes.focuscenter;
    var area = getClientArea();
    var regions = centerRegions(modeCfg, area);

    // Capture the previous center before moving on
    var previousCenter = state.currentCenter ? findWindow(state.currentCenter) : null;

    // Decide side for the window being pushed out
    var pushSide = state.originOf[sid];
    if (!pushSide) pushSide = USER_MODE_DEFAULTS.focuscenter;

    // Move the newly focused window to center
    removeFromSide(sid);
    state.currentCenter = sid;
    place(win, regions.center, 0);

    // Push the previous center window to the chosen side stack
    if (previousCenter) {
        var prevSid = idOf(previousCenter);
        var prevSide = state.originOf[prevSid] || pushSide;
        pushToSide(prevSid, prevSide);
    }

    // Re-render all side stacks
    forceRedrawSides(regions);
}

function forceRedrawSides(regions) {
    var modeCfg = CONFIG.modes.focuscenter;
    for (var side in state.sideLists) {
        var list = state.sideLists[side];
        var region = regions[side];
        if (!region) continue;
        var wins = list.map(function (sid) { return findWindow(sid); });
        for (var k = 0; k < wins.length; k++) {
            if (wins[k]) place(wins[k], region, k);
        }
    }
}

function applyFocusCenterMode() {
    resetFocusCenter();
    var area = getClientArea();
    var regions = centerRegions(CONFIG.modes.focuscenter, area);
    // place all currently managed windows into side stacks
    var wins = collectManagedWindows();
    var side = "left";
    var n = 0;
    for (var i = 0; i < wins.length; i++) {
        var sid = idOf(wins[i]);
        pushToSide(sid, (n % 2 === 0) ? "left" : "right");
        n++;
    }
    // focus the active window into center
    var act = workspace.activeWindow;
    if (act && isWindowWorthManaging(act)) {
        handleFocusCenter(act);
    } else {
        forceRedrawSides(regions);
    }
}

// ----------------------------------------------------------------------------
// Mode switching
// ----------------------------------------------------------------------------
function applyOffMode() {
    // stop tracking focus-center state; windows stay exactly where they are
    resetFocusCenter();
    resetGaming();
    print("LayoutManager off: mode disabled, windows left as-is");
}

function switchMode(modeName) {
    if (!CONFIG.modes[modeName]) return;
    // switching away from pick mode cancels it
    if (state.pickActive && modeName !== "off") cancelPickMode();
    // leaving gaming (or cancelling its arming) resets its anchor
    if (modeName !== "gaming" &&
        (state.gamingArmed || state.activeMode === "gaming")) resetGaming();
    state.activeMode = modeName;
    var type = CONFIG.modes[modeName].type;
    if (type === "focuscenter") {
        applyFocusCenterMode();
    } else if (type === "gaming") {
        armGaming();
    } else if (type === "off") {
        applyOffMode();
    } else {
        print("LayoutManager: unknown mode type for '" + modeName + "'");
    }
}

// Toggle: pressing the key of the active mode turns it OFF; pressing another
// mode's key activates that mode.
function toggleMode(modeName) {
    if (state.activeMode === modeName) {
        switchMode("off");
    } else {
        switchMode(modeName);
    }
}

// ----------------------------------------------------------------------------
// Click-pick mode (Meta+F1)
// ----------------------------------------------------------------------------
function startPickMode() {
    state.pickActive = true;
    state.picked = [];
    print("LayoutManager pick: armed (Meta+F1 to cancel). Click up to " +
          CONFIG.pick.slots.length + " windows in order.");
}

function cancelPickMode() {
    state.pickActive = false;
    state.picked = [];
    print("LayoutManager pick: cancelled, nothing moved");
}

function togglePickMode() {
    if (state.pickActive) {
        cancelPickMode();
    } else {
        startPickMode();
    }
}

function handlePickWindow(win) {
    if (!state.pickActive) return false;
    if (!isWindowWorthManaging(win)) return false;
    var sid = idOf(win);

    // clicking an already-picked window removes it (toggle)
    var idx = state.picked.indexOf(sid);
    if (idx !== -1) {
        state.picked.splice(idx, 1);
        print("LayoutManager pick: removed, " + state.picked.length + "/" +
              CONFIG.pick.slots.length + " picked");
        return true;
    }

    if (state.picked.length >= CONFIG.pick.slots.length) return true;
    state.picked.push(sid);
    print("LayoutManager pick: " + state.picked.length + "/" +
          CONFIG.pick.slots.length + " picked");

    if (state.picked.length === CONFIG.pick.slots.length) {
        applyPickComposition();
    }
    return true;
}

function applyPickComposition() {
    var slots = CONFIG.pick.slots;
    var area = getClientArea();
    for (var i = 0; i < slots.length && i < state.picked.length; i++) {
        var win = findWindow(state.picked[i]);
        if (!win) continue;
        var s = slots[i];
        place(win, {
            x: Math.round(area.x + area.width * s.leftFrac),
            y: Math.round(area.y + area.height * s.topFrac),
            width: Math.round(area.width * s.widthFrac),
            height: Math.round(area.height * s.heightFrac)
        }, 0);
    }
    state.picked = [];
    state.pickActive = false;
    state.activeMode = "off";
    print("LayoutManager pick: applied composition (" + slots.length +
          " windows), mode off");
}

// ----------------------------------------------------------------------------
// Gaming mode (Meta+F2): click-to-anchor + live side-follow
// ----------------------------------------------------------------------------
function armGaming() {
    if (state.pickActive) cancelPickMode();
    state.gamingArmed = true;
    print("LayoutManager gaming: armed (Meta+F2 to cancel). " +
          "Click the main window.");
}

function disconnectGaming() {
    if (state.gamingConn) {
        state.gamingConn.disconnect();
        state.gamingConn = null;
    }
}

function resetGaming() {
    state.gamingArmed = false;
    state.gamingCenter = null;
    disconnectGaming();
}

function toggleGamingMode() {
    if (state.gamingArmed) {
        // pressing F2 while armed = cancel the pick and exit gaming
        switchMode("off");
    } else if (state.activeMode === "gaming") {
        switchMode("off");
    } else {
        switchMode("gaming");
    }
}

// The anchor window's live frameGeometry is the source of truth for the layout:
// sides fill whatever space remains around it (clamped to >= 0).
function gamingRegions(area) {
    var fg = findWindow(state.gamingCenter).frameGeometry;
    var left = {
        x: area.x, y: area.y,
        width: Math.max(0, fg.x - area.x),
        height: area.height
    };
    var right = {
        x: fg.x + fg.width, y: area.y,
        width: Math.max(0, area.x + area.width - (fg.x + fg.width)),
        height: area.height
    };
    return { left: left, right: right };
}

function applyGamingLayout() {
    if (state.activeMode !== "gaming") return;
    if (!state.gamingCenter) return;
    var anchor = findWindow(state.gamingCenter);
    if (!anchor) return;

    var area = getClientArea();
    var regions = gamingRegions(area);

    // The anchor is read-only here: it keeps whatever geometry the user gave
    // it (width, position). Sides fill whatever space remains around it.

    // everything else: alternate across the two side slots. Within a side,
    // windows sit directly on top of each other in the full slot region
    // (overlap, not cascaded or compressed).
    var sides = { left: [], right: [] };
    var wins = collectManagedWindows();
    var n = 0;
    for (var i = 0; i < wins.length; i++) {
        if (idOf(wins[i]) === state.gamingCenter) continue;
        sides[(n % 2 === 0) ? "left" : "right"].push(wins[i]);
        n++;
    }

    for (var side in sides) {
        var list = sides[side];
        if (!list.length) continue;
        var region = regions[side];
        if (region.width <= 0) continue;
        for (var k = 0; k < list.length; k++) {
            place(list[k], {
                x: region.x, y: region.y,
                width: region.width, height: region.height
            }, 0);
        }
    }
}

function handleGamingPick(win) {
    if (!state.gamingArmed) return false;
    if (!isWindowWorthManaging(win)) return false;

    disconnectGaming();
    state.gamingCenter = idOf(win);
    state.gamingArmed = false;
    state.activeMode = "gaming";

    // initial placement: anchor at the template center (60%)
    var area = getClientArea();
    var regions = staticRegions(CONFIG.modes.gaming, area);
    place(win, regions.center, 0);

    // follow the anchor's size live so sides reflow as the user resizes it
    state.gamingConn = win.frameGeometryChanged.connect(function () {
        if (state.activeMode === "gaming" && state.gamingCenter) {
            applyGamingLayout();
        }
    });

    applyGamingLayout();
    print("LayoutManager gaming: anchor set, mode active");
    return true;
}

// ----------------------------------------------------------------------------
// Event hooks
// ----------------------------------------------------------------------------
workspace.windowActivated.connect(function (win) {
    // while pick mode is armed, every click/focus is a pick
    if (state.pickActive) {
        handlePickWindow(win);
        return;
    }
    // while gaming is armed, the next click is the anchor (main) window
    if (state.gamingArmed) {
        handleGamingPick(win);
        return;
    }
    if (!state.activeMode) return;
    var type = CONFIG.modes[state.activeMode].type;
    if (type === "off") return;
    if (type === "focuscenter") {
        handleFocusCenter(win);
    }
});

workspace.windowRemoved.connect(function (win) {
    var sid = idOf(win);
    if (state.currentCenter === sid) state.currentCenter = null;
    removeFromSide(sid);
    delete state.originOf[sid];
    var pIdx = state.picked.indexOf(sid);
    if (pIdx !== -1) state.picked.splice(pIdx, 1);
    if (state.gamingCenter === sid) {
        resetGaming();
        // windows we had placed in the sides are gone too; fall back to off
        if (state.activeMode === "gaming") switchMode("off");
    }
});

// re-apply on geometry/screen change so positions track the G9 correctly
workspace.virtualScreenGeometryChanged.connect(function () {
    if (!state.activeMode) return;
    var modeCfg = CONFIG.modes[state.activeMode];
    var type = modeCfg.type;
    if (type === "off") return;
    if (type === "focuscenter") {
        var area = getClientArea();
        forceRedrawSides(centerRegions(modeCfg, area));
        if (state.currentCenter) {
            var cw = findWindow(state.currentCenter);
            if (cw) place(cw, centerRegions(modeCfg, area).center, 0);
        }
    } else if (type === "gaming") {
        applyGamingLayout();
    } else {
        print("LayoutManager: unknown mode type for '" + state.activeMode + "'");
    }
});

// ----------------------------------------------------------------------------
// Shortcuts registration
// Note: shortcuts must be assigned in System Settings -> Shortcuts -> KWin
// after install for them to be active.
// ----------------------------------------------------------------------------
function bindShortcuts() {
    registerShortcut("layout-manager-mode-gaming",
        "Layout Manager: Gaming layout",
        CONFIG.shortcuts.mode_gaming, toggleGamingMode);

    registerShortcut("layout-manager-mode-focuscenter",
        "Layout Manager: Center Stage layout",
        CONFIG.shortcuts.mode_focuscenter, function () { toggleMode("focuscenter"); });

    registerShortcut("layout-manager-mode-pick",
        "Layout Manager: Click-pick composition",
        CONFIG.shortcuts.mode_pick, togglePickMode);
}

// ----------------------------------------------------------------------------
// Init
// ----------------------------------------------------------------------------
function init() {
    bindShortcuts();
    state.activeMode = CONFIG.defaultMode;
    // seed the active mode
    var modeCfg = CONFIG.modes[state.activeMode];
    if (modeCfg.type === "focuscenter") {
        // don't force-arrange everything on startup; wait for focus
        resetFocusCenter();
    } else if (modeCfg.type === "off") {
        // nothing to arrange
    } else if (modeCfg.type === "gaming") {
        // wait for the user to pick the main window
        armGaming();
    } else {
        print("LayoutManager: unknown mode type for '" + state.activeMode + "'");
    }
    print("Layout Manager loaded. Active mode: " + state.activeMode);
}

init();
