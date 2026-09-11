// Fork Mobile — foundation extension for the SillyTavern mobile+agents fork.
// v0.2.1: FAB + bottom sheet launcher, mobile CSS hooks, Phase 1 overhaul
// (long-message collapse w/ keyboard-aware resizing, typing input cap).

import { extension_settings } from '../../extensions.js';
import { eventSource, event_types, saveSettings, saveSettingsDebounced } from '../../../script.js';
import { isMobile } from '../../RossAscends-mods.js';

const extensionName = 'fork-mobile';
const defaultSettings = {
    fabEnabled: true,
    collapseLong: true,
    topCollapse: true,
};

// --- Compose mode: toggle an attribute while typing (no hiding) -----------
// When the keyboard is open (textarea focused) we set data-fork-composing="1"
// on <html>. CSS then SHRINKS the full-screen tracker panel into a compact
// corner widget so the chat is visible — the panel is never hidden.

let composeObserver = null;

function setComposing(on) {
    document.documentElement.dataset.forkComposing = on ? '1' : '0';
}

function initComposeMode() {
    // focusin/out bubble (unlike focus/blur) — reliable on mobile.
    $(document).on('focusin.forkCompose', '#send_textarea', () => setComposing(true));
    $(document).on('focusout.forkCompose', '#send_textarea', () => setComposing(false));
    // Fallback poll in case focus events don't fire.
    setInterval(() => {
        const focused = document.activeElement?.id === 'send_textarea';
        if (focused !== (document.documentElement.dataset.forkComposing === '1')) {
            setComposing(focused);
        }
    }, 400);
    setComposing(document.activeElement?.id === 'send_textarea');
}

// Belt-and-suspenders: these rules are ALSO in style-v029.css, but we inject
// them directly so the input shrink + mobile hooks apply even if the external
// stylesheet is ever stale-cached or fails to load.

function injectCriticalCss() {
    const id = 'fork-mobile-critical';
    if (document.getElementById(id)) return;
    const css = `
        /* Critical FAB/sheet positioning — must not depend on style-v030.css
           loading: if the stylesheet is stale or refused, the FAB would render
           as an unstyled div at the end of body (below the fold, invisible). */
        #fork-fab {
            position: fixed !important;
            /* Anchor from TOP with viewport units: bottom:0 renders above the
               viewport in this environment (containing-block hijack), while
               vh units always resolve against the viewport. 200px up from the
               viewport bottom clears the browser's bottom bar (~144px of
               chrome overlays the layout viewport in Kiwi). */
            top: calc(100vh - 200px) !important;
            right: calc(16px + env(safe-area-inset-right)) !important;
            bottom: auto !important;
            width: 56px !important;
            height: 56px !important;
            border-radius: 50% !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            font-size: 22px !important;
            color: #fff !important;
            background: linear-gradient(135deg, #8b5cf6, #d946ef) !important;
            box-shadow: 0 4px 16px rgba(139, 92, 246, 0.45) !important;
            cursor: pointer !important;
            z-index: 99999 !important;
            user-select: none !important;
        }
        #fork-sheet {
            position: fixed !important;
            /* Top-anchored with vh — bottom:0 renders above the viewport in
               this environment (see containing-block saga). z-index must beat
               rpg-companion's floating widget (z-index 999999) or it eats the
               ✕ clicks. */
            top: 0 !important;
            bottom: auto !important;
            left: 0 !important;
            right: 0 !important;
            height: min(74vh, 540px) !important;
            z-index: 1000001 !important;
            background: var(--main-surface, #1e1e2e) !important;
            border-radius: 0 0 18px 18px !important;
            padding: 10px 16px 16px !important;
            overflow-y: auto !important;
        }
        #fork-backdrop {
            position: fixed !important;
            top: 0 !important;
            bottom: auto !important;
            left: 0 !important;
            right: 0 !important;
            height: 100vh !important;
            background: rgba(0, 0, 0, 0.55) !important;
            z-index: 1000000 !important;
        }
        #send_textarea {
            min-height: 44px !important;
            height: 44px !important;
            max-height: 120px !important;
            resize: none !important;
            field-sizing: normal !important;
        }
        body:has(#send_textarea:focus) #send_textarea {
            height: auto !important;
            max-height: 120px !important;
        }
        /* While typing, dock the full-screen tracker overlay into a compact
           bottom-left corner widget so the chat is visible. The panel is NOT
           hidden — only the overlay's full-screen dim + centering is lifted,
           and only the small panel remains interactive. */
        html[data-fork-composing="1"] .rt-settings-overlay {
            position: fixed !important;
            inset: auto auto 8px 8px !important;
            padding: 0 !important;
            display: block !important;
            align-items: initial !important;
            justify-content: initial !important;
            width: auto !important;
            height: auto !important;
            pointer-events: none !important;
        }
        html[data-fork-composing="1"] .rt-settings-overlay .rt-so-panel {
            width: min(280px, 42vw) !important;
            height: 260px !important;
            max-height: 260px !important;
            pointer-events: auto !important;
        }
        html[data-fork-composing="1"] .rt-settings-overlay .rt-so-dim {
            display: none !important;
        }
        html[data-fork-composing="1"] .rpg-tracker-panel {
            inset: auto auto 8px 8px !important;
            top: auto !important;
            right: auto !important;
            width: min(280px, 42vw) !important;
            height: 260px !important;
            max-height: 260px !important;
            z-index: 1999 !important;
        }
        /* Top-bar collapse: hide the drawer icon row, keep the drawer contents
           (they are absolutely positioned and must stay reachable). */
        html[data-fork-topmenu="1"] #top-settings-holder > .drawer > .drawer-toggle {
            display: none !important;
        }
        html[data-fork-topmenu="1"] #top-settings-holder {
            justify-content: flex-end !important;
            padding-right: calc(10px + env(safe-area-inset-right)) !important;
        }
        #fork-topmenu-btn {
            width: 40px !important;
            height: 40px !important;
            flex: 0 0 auto !important;
            border-radius: 50% !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            font-size: 20px !important;
            cursor: pointer !important;
            color: var(--SmartThemeBodyColor, #fff) !important;
            background: var(--SmartThemeBlurTintColor, rgba(255,255,255,0.08)) !important;
            border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.15)) !important;
            user-select: none !important;
            align-self: center !important;
        }
        /* Panel + backdrop: top-anchored fixed (bottom:0 is unreliable in this
           environment), z-index above rpg-companion's 999999 widget. */
        #fork-topmenu-panel {
            position: fixed !important;
            bottom: auto !important;
            left: auto !important;
            right: calc(8px + env(safe-area-inset-right)) !important;
            width: min(300px, calc(100vw - 16px)) !important;
            max-height: 68dvh !important;
            overflow-y: auto !important;
            z-index: 1000001 !important;
            background: var(--main-surface, #1e1e2e) !important;
            border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.15)) !important;
            border-radius: 16px !important;
            padding: 8px !important;
            box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45) !important;
        }
        #fork-topmenu-backdrop {
            position: fixed !important;
            top: 0 !important;
            bottom: auto !important;
            left: 0 !important;
            right: 0 !important;
            height: 100vh !important;
            background: rgba(0, 0, 0, 0.45) !important;
            z-index: 1000000 !important;
        }
    `;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = css;
    document.head.appendChild(style);
}

// Mirrors the CSS gate in style.css: coarse pointer + narrow viewport.
const mobileQuery = window.matchMedia('(max-width: 1000px) and (pointer: coarse)');

// --- Mobile hooks ----------------------------------------------------------

function applyMobileHooks() {
    if (isMobile()) {
        document.documentElement.dataset.forkMobile = '1';
    }
}

// --- Phase 1: long-message collapse (wall-of-text fix) ---------------------

// Messages the typing mode auto-collapsed, so we can restore them on blur.
const autoCollapsedWhileTyping = new Set();

function getViewportHeight() {
    // visualViewport is the reliable keyboard signal on Android: its height
    // shrinks when the keyboard opens even when the layout viewport doesn't.
    return window.visualViewport ? window.visualViewport.height : window.innerHeight;
}

function processLongMessages() {
    if (!mobileQuery.matches || !extension_settings[extensionName].collapseLong) {
        return;
    }

    const vh = getViewportHeight();
    const typing = document.activeElement?.id === 'send_textarea';
    const threshold = vh * (typing ? 0.32 : 0.55);
    const capPx = Math.round(vh * 0.32);

    $('#chat .mes').each(function () {
        const $mes = $(this);
        const $text = $mes.find('.mes_text').first();
        if (!$text.length) {
            return;
        }

        const h = $text[0].scrollHeight;

        if (h > threshold) {
            if ($mes.hasClass('mes-long-expanded')) {
                // Keyboard space is precious: pull expanded long messages
                // back to collapsed while typing, restore on blur.
                if (typing) {
                    $mes.addClass('mes-long-collapsed').removeClass('mes-long-expanded');
                    autoCollapsedWhileTyping.add($mes[0]);
                    if (!$text.find('.mes-long-toggle').length) {
                        $text.append('<div class="mes-text-fade"></div><div class="mes-long-toggle">⤓ more</div>');
                    }
                    $text.css('max-height', capPx + 'px');
                }
                return;
            }

            if (!$mes.hasClass('mes-long-collapsed')) {
                $mes.addClass('mes-long-collapsed');
                $text.append('<div class="mes-text-fade"></div><div class="mes-long-toggle">⤓ more</div>');
            }
            // Inline px cap beats the CSS dvh fallback and tracks the keyboard.
            $text.css('max-height', capPx + 'px');
        } else if (!$mes.hasClass('mes-long-expanded')) {
            // Below threshold again (keyboard closed / shorter message).
            if (autoCollapsedWhileTyping.has($mes[0])) {
                autoCollapsedWhileTyping.delete($mes[0]);
                $mes.addClass('mes-long-expanded').removeClass('mes-long-collapsed');
                $text.find('.mes-text-fade, .mes-long-toggle').remove();
                $text.css('max-height', '');
            } else if (!$mes.hasClass('mes-long-manual')) {
                $mes.removeClass('mes-long-collapsed');
                $text.find('.mes-text-fade, .mes-long-toggle').remove();
                $text.css('max-height', '');
            }
        }
    });
}

function initLongMessages() {
    if (!extension_settings[extensionName].collapseLong) {
        return;
    }

    // One delegated listener for all toggles (safe against ST re-renders).
    $(document).off('click.forkLong').on('click.forkLong', '.mes-long-toggle', function (e) {
        e.stopPropagation();
        const $mes = $(this).closest('.mes');
        autoCollapsedWhileTyping.delete($mes[0]);
        if ($mes.hasClass('mes-long-collapsed')) {
            $mes.removeClass('mes-long-collapsed mes-long-manual').addClass('mes-long-expanded');
            // Clear the inline px cap set at collapse time. Inline styles beat
            // stylesheet rules, so without this the text stays cropped forever.
            $mes.find('.mes_text').css('max-height', '');
            $(this).text('⤒ collapse');
        } else {
            $mes.addClass('mes-long-collapsed mes-long-manual');
            $(this).text('⤓ more');
        }
    });

    eventSource.on(event_types.USER_MESSAGE_RENDERED, processLongMessages);
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, processLongMessages);
    eventSource.on(event_types.MESSAGE_SWIPED, processLongMessages);
    eventSource.on(event_types.MESSAGE_EDITED, processLongMessages);
    eventSource.on(event_types.CHAT_CHANGED, processLongMessages);

    // Keyboard open/close re-evaluation (visualViewport fires on Android
    // even when the layout viewport doesn't resize).
    let resizeTimer = null;
    const onViewportChange = () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(processLongMessages, 120);
    };
    window.visualViewport?.addEventListener('resize', onViewportChange);
    $('#send_textarea').on('focus blur', onViewportChange);

    processLongMessages();
}

// --- UI: floating action button + bottom sheet -----------------------------

/** Hand the launcher off to the fork-agents extension (decoupled via event). */
function launchAgents() {
    document.dispatchEvent(new CustomEvent('fork-launch-agents'));
}

// Something transforms <body>/<html> (observed: html carries an IDENTITY
// transform matrix(1,0,0,1,0,0) — any root transform hijacks the containing
// block for every fixed descendant, so bottom:0 lands above the viewport).
// Pin our floating elements to <html> and neutralize the identity transform.
let forkPinnedInterval = null;
function keepForkPinned() {
    if (forkPinnedInterval) return;
    forkPinnedInterval = setInterval(() => {
        const hs = getComputedStyle(document.documentElement).transform;
        if (hs && hs !== 'none' && hs === 'matrix(1, 0, 0, 1, 0, 0)') {
            document.documentElement.style.transform = 'none';
            console.log('[fork-mobile] neutralized html identity transform');
        }
        for (const id of ['fork-fab', 'fork-sheet', 'fork-backdrop', 'fork-topmenu-panel', 'fork-topmenu-backdrop']) {
            const el = document.getElementById(id);
            if (el && el.parentElement !== document.documentElement) {
                document.documentElement.appendChild(el);
                console.log('[fork-mobile] re-pinned #' + id, 'from', el.parentElement?.tagName, el.parentElement?.id);
            }
        }
    }, 800);
}

function buildFab() {
    if (!extension_settings[extensionName].fabEnabled) {
        return;
    }
    // buildFab runs from BOTH the boot IIFE and init() — without this guard
    // two FABs/sheets/backdrops stack (same ids, same position → looks like
    // one, but bindings and z-fighting break).
    if (document.getElementById('fork-fab')) {
        return;
    }

    const fab = $('<div id="fork-fab" title="Fork launcher">✦</div>');
    // Inline the critical positioning — same top-anchored viewport strategy as
    // the critical CSS (bottom:0 renders above the viewport in this env).
    fab[0].style.top = 'calc(100vh - 200px)';
    fab[0].style.bottom = 'auto';
    fab[0].style.right = '16px';
    fab[0].style.position = 'fixed';
    fab[0].style.zIndex = '99999';
    $('body').append(fab);

    const sheet = $('<div id="fork-sheet" class="fork-hidden"></div>');
    const backdrop = $('<div id="fork-backdrop" class="fork-hidden"></div>');
    $('body').append(backdrop, sheet);

    const items = [
        { label: '🧠 Helper Agents', sub: 'Lorebook Keeper · Character Smith', action: launchAgents },
        { label: '🎨 Fork Theme', sub: 'coming in Phase 3', disabled: true },
        { label: '📱 Mobile overhaul', sub: 'active — collapse, input cap, perf CSS', disabled: false },
    ];

    const list = $('<div class="fork-sheet-list"></div>');
    for (const item of items) {
        const row = $('<div class="fork-sheet-item"></div>');
        if (item.disabled) {
            row.addClass('fork-disabled');
        }
        row.append($('<div class="fork-sheet-label"></div>').text(item.label));
        row.append($('<div class="fork-sheet-sub"></div>').text(item.sub));
        if (item.action) {
            row.on('click', () => {
                close();
                item.action();
            });
        }
        list.append(row);
    }

    const header = $('<div class="fork-sheet-header"></div>');
    header.append($('<span></span>').text('Fork Launcher'));
    header.append($('<button id="fork-sheet-close" class="fork-sheet-close">✕</button>'));

    sheet.append(header, list);

    const open = () => {
        // Inline critical positioning (top-anchored, viewport units) so the
        // sheet CANNOT render off-screen even if stylesheets fail or the
        // containing block is hijacked. z-index beats rpg-companion's widget.
        const sEl = sheet[0];
        const bEl = backdrop[0];
        if (sEl) {
            sEl.style.position = 'fixed';
            sEl.style.top = '0';
            sEl.style.bottom = 'auto';
            sEl.style.left = '0';
            sEl.style.right = '0';
            sEl.style.height = 'min(74vh, 540px)';
            sEl.style.zIndex = '1000001';
            sEl.style.display = 'flex';
            sEl.style.flexDirection = 'column';
        }
        if (bEl) {
            bEl.style.position = 'fixed';
            bEl.style.top = '0';
            bEl.style.bottom = 'auto';
            bEl.style.left = '0';
            bEl.style.right = '0';
            bEl.style.height = '100vh';
            bEl.style.zIndex = '1000000';
            bEl.style.display = 'block';
        }
        sheet.removeClass('fork-hidden');
        backdrop.removeClass('fork-hidden');
    };
    const close = () => {
        // Inline display:none — hiding must never depend on the stylesheet.
        const sEl = sheet[0];
        const bEl = backdrop[0];
        if (sEl) sEl.style.display = 'none';
        if (bEl) bEl.style.display = 'none';
        sheet.addClass('fork-hidden');
        backdrop.addClass('fork-hidden');
    };

    fab.on('click', open);
    backdrop.on('click', close);
    // Delegated so the ✕ always binds to the visible sheet, even if the sheet
    // was re-parented by the pinner or a second instance existed.
    $(document).on('click', '#fork-sheet-close', close);
}

// --- Collapsible top bar: drawer icon row -> one menu button ---------------
// When topCollapse is on, every .drawer-toggle in #top-settings-holder is
// hidden (CSS) and a single ⋮ button takes their place. Tapping it opens a
// dropdown panel listing all drawer actions (icons + labels, rebuilt fresh on
// every open so statuses/connection colors are current). Selecting an item
// clicks the REAL .drawer-toggle, so ST's own open/close logic (closing other
// drawers, pinned panels, icon state classes) runs untouched. Drawer contents
// are never hidden — only their header icons are.

function topmenuApplyAttr() {
    document.documentElement.dataset.forkTopmenu = extension_settings[extensionName].topCollapse ? '1' : '0';
}

function topmenuCollectItems() {
    const items = [];
    // The 9 stock drawers: each .drawer wraps a .drawer-toggle (icon) and a
    // .drawer-content (panel). The content stays in place; we only drive the
    // toggle.
    document.querySelectorAll('#top-settings-holder > .drawer').forEach((drawer) => {
        const toggle = drawer.querySelector('.drawer-toggle');
        const iconEl = drawer.querySelector('.drawer-icon');
        const content = drawer.querySelector('.drawer-content');
        if (!toggle || !iconEl) return;
        // FA glyph classes only — drop the drawer state classes and fixed-width.
        const iconClasses = [...iconEl.classList].filter(c => !['drawer-icon', 'closedIcon', 'openIcon', 'fa-fw'].includes(c));
        items.push({
            title: iconEl.getAttribute('title') || drawer.id,
            iconClasses,
            active: () => !!content && content.classList.contains('openDrawer'),
            run: () => toggle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })),
        });
    });
    // Anything extensions appended into #top-bar at runtime (rare; #top-bar is
    // empty in stock HTML) — fold it into the menu too so nothing is orphaned.
    const topBar = document.getElementById('top-bar');
    if (topBar) {
        [...topBar.children].forEach((child) => {
            if (child.id === 'fork-topmenu-btn') return;
            const icon = child.querySelector('i') || child;
            const iconClasses = icon.classList ? [...icon.classList].filter(c => c.startsWith('fa-')) : [];
            items.push({
                title: child.getAttribute('title') || (child.textContent || '').trim().slice(0, 40) || 'Button',
                iconClasses,
                active: () => false,
                run: () => child.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })),
            });
        });
    }
    return items;
}

function buildTopMenu() {
    if (!extension_settings[extensionName].topCollapse) {
        return;
    }
    if (document.getElementById('fork-topmenu-btn')) {
        return; // double-build guard (runs from boot IIFE AND init())
    }

    const btn = $('<div id="fork-topmenu-btn" title="Menu" data-i18n="[title]Menu">⋮</div>');
    const panel = $('<div id="fork-topmenu-panel" class="fork-hidden"></div>');
    const backdrop = $('<div id="fork-topmenu-backdrop" class="fork-hidden"></div>');

    // Button rides inside the (now empty) top bar strip, right-aligned.
    const holder = document.getElementById('top-settings-holder');
    if (holder) {
        holder.appendChild(btn[0]);
    } else {
        $('body').append(btn);
    }
    $('body').append(backdrop, panel);

    const header = $('<div class="fork-topmenu-header"></div>');
    header.append($('<span class="fork-topmenu-title"></span>').text('Menu'));
    header.append($('<button id="fork-topmenu-close" class="fork-sheet-close">✕</button>'));
    panel.append(header);

    const open = () => {
        // Rebuild rows on EVERY open: icon classes carry live state (API plug
        // color, open/closed drawer states, titles, extension-added buttons).
        const list = $('<div class="fork-topmenu-list"></div>');
        for (const item of topmenuCollectItems()) {
            const row = $('<div class="fork-topmenu-row"></div>');
            const ic = $('<i class="fork-topmenu-ic"></i>');
            for (const cls of item.iconClasses) ic.addClass(cls);
            row.append(ic);
            row.append($('<span class="fork-topmenu-label"></span>').text(item.title));
            if (item.active()) {
                row.addClass('fork-topmenu-active');
                row.append($('<span class="fork-topmenu-dot" title="Open now"></span>'));
            }
            row.on('click', () => {
                close();
                item.run();
            });
            list.append(row);
        }
        panel.find('.fork-topmenu-list').remove();
        panel.append(list);

        // Top-anchored inline geometry (bottom anchoring is unreliable here).
        const rootStyle = getComputedStyle(document.documentElement);
        const barH = parseFloat(rootStyle.getPropertyValue('--topBarBlockSize')) || 44;
        const pEl = panel[0];
        const bEl = backdrop[0];
        if (pEl) {
            pEl.style.position = 'fixed';
            pEl.style.top = Math.round(barH + 4) + 'px';
            pEl.style.bottom = 'auto';
            pEl.style.right = 'calc(8px + env(safe-area-inset-right))';
            pEl.style.zIndex = '1000001';
            pEl.style.display = 'block';
        }
        if (bEl) {
            bEl.style.position = 'fixed';
            bEl.style.top = '0';
            bEl.style.bottom = 'auto';
            bEl.style.left = '0';
            bEl.style.right = '0';
            bEl.style.height = '100vh';
            bEl.style.zIndex = '1000000';
            bEl.style.display = 'block';
        }
        panel.removeClass('fork-hidden');
        backdrop.removeClass('fork-hidden');
    };

    const close = () => {
        const pEl = panel[0];
        const bEl = backdrop[0];
        if (pEl) pEl.style.display = 'none';
        if (bEl) bEl.style.display = 'none';
        panel.addClass('fork-hidden');
        backdrop.addClass('fork-hidden');
    };

    btn.on('click', open);
    backdrop.on('click', close);
    $(document).on('click', '#fork-topmenu-close', close);
}

// --- Swipe-down to close: settings drawers + the top-bar menu ---------------
// Mobile gesture: with the top bar collapsed, open drawer panels have no visible
// close icon (their .drawer-toggle is hidden), so closing meant hunting menu
// buttons. Pull any open .drawer-content (or the ⋮ menu panel) down like a sheet:
// a long downward pull closes via ST's own toggle click.
//
// ⚠️ SENSITIVITY FIX (2026-09-11) — v1 dismissed the panel while people were just
// scrolling presets. Two causes, both fixed here:
//   1. It trusted ONE scrollTop (the panel's own). ST nests scroll areas (prompt
//      manager, preset editor, floated sections) and on mobile the panel itself
//      often never scrolls while an inner box (or the document) does — so the
//      "scrolled to top" gate stayed green mid-list and every downward stroke
//      dismissed the pane. Now EVERY scrollable box between the touch point and
//      the document is snapshotted, and the gesture ABORTS the instant any of
//      them moves: real scrolling always wins, only an overscroll at the very
//      top can reach the dismiss threshold.
//   2. 80px of 1:1 finger travel was far too easy to hit. Now: 26px dead zone,
//      panel follows at 55% (heavier feel), strict vertical intent
//      (|dy| > 1.4|dx|), and 120px of raw travel required to actually close.

function initSwipeClose() {
    if (!(isMobile() || mobileQuery.matches)) {
        return; // desktop keeps mouse/dots/X workflows
    }

    const CLOSE_PX = 120;     // raw downward travel required to dismiss
    const DEAD_ZONE = 26;     // no visual movement before this (scroll strokes stay untouched)
    const RESISTANCE = 0.55;  // panel follows the finger at this fraction
    const DOMINANCE = 1.4;    // |dy| must beat |dx| by this factor to count as vertical

    let startY = null;
    let startX = null;
    let el = null;
    let dragging = false;
    let cancelled = false;
    let scrollables = [];
    let scrollSnapshot = [];

    const docScroller = document.scrollingElement || document.documentElement;

    const isCloseable = (target) => {
        const $c = $(target).closest('.drawer-content.openDrawer, #fork-topmenu-panel:not(.fork-hidden)');
        return $c.length ? $c[0] : null;
    };

    // Every scrollable box from the touch point up to the document, plus the page
    // scroller. We watch ALL of them: whichever one actually scrolls tells us the
    // user is reading, not dismissing.
    const collectScrollables = (target) => {
        const out = [];
        let n = target && target.nodeType === 1 ? target : (target ? target.parentElement : null);
        while (n && n.nodeType === 1) {
            const cs = getComputedStyle(n);
            const oy = cs.overflowY;
            if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && n.scrollHeight > n.clientHeight + 2) {
                out.push(n);
            }
            n = n.parentElement;
        }
        if (!out.includes(docScroller)) out.push(docScroller);
        return out;
    };

    // Only the panel's own scroll boxes block the gesture at touchstart; the page
    // scroller is excluded so a scrolled document can never lock dismissal out
    // permanently (a document scroll still aborts mid-gesture via scrollMoved).
    const anyPaneScrolled = () => scrollables.some((s) => s !== docScroller && s.scrollTop > 1);
    const scrollMoved = () => scrollables.some((s, i) => Math.abs(s.scrollTop - (scrollSnapshot[i] || 0)) > 1);

    const springBack = (node) => {
        node.style.transition = 'transform 0.18s ease-out';
        node.style.transform = '';
        setTimeout(() => { node.style.transition = ''; }, 220);
    };

    $(document).off('.forkSwipe')
        .on('touchstart.forkSwipe', function (e) {
            const t = e.originalEvent.touches[0];
            if (!t) return;
            const candidate = isCloseable(e.target);
            if (!candidate) return;
            scrollables = collectScrollables(e.target);
            scrollSnapshot = scrollables.map((s) => s.scrollTop);
            // Mid-list = the user is scrolling this pane; never take the gesture.
            if (anyPaneScrolled()) return;
            startY = t.clientY;
            startX = t.clientX;
            el = candidate;
            dragging = false;
            cancelled = false;
            el.__forkRaw = 0;
            el.__forkDy = 0;
        })
        .on('touchmove.forkSwipe', function (e) {
            if (!el || cancelled) return;
            const t = e.originalEvent.touches[0];
            if (!t) return;
            // The moment anything scrolls under the finger, this is a scroll stroke.
            if (scrollMoved()) {
                cancelled = true;
                if (dragging) springBack(el);
                el = null;
                dragging = false;
                return;
            }
            const dy = t.clientY - startY;
            const dx = t.clientX - startX;
            if (!dragging) {
                // Horizontal intent or upward scroll = not our gesture.
                if (Math.abs(dx) * DOMINANCE > Math.abs(dy) || dy < 0) {
                    el = null;
                    return;
                }
                if (dy < DEAD_ZONE) {
                    return;
                }
                dragging = true;
                el.style.transition = 'none';
            }
            const pull = Math.max(0, (dy - DEAD_ZONE) * RESISTANCE);
            el.__forkRaw = dy;
            el.__forkDy = pull;
            el.style.transform = 'translateY(' + pull + 'px)';
        })
        .on('touchend.forkSwipe touchcancel.forkSwipe', function () {
            if (!el) return;
            const el0 = el;
            const raw = el0.__forkRaw || 0;
            const wasCancelled = cancelled;
            el = null;
            dragging = false;
            cancelled = false;
            if (!wasCancelled && raw > CLOSE_PX) {
                // Slide fully off, then close through the real toggle.
                el0.style.transition = 'transform 0.16s ease-in';
                el0.style.transform = 'translateY(100%)';
                setTimeout(() => {
                    el0.style.transform = '';
                    el0.style.transition = '';
                    if (el0.id === 'fork-topmenu-panel') {
                        const btn = document.getElementById('fork-topmenu-close');
                        if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                    } else {
                        const drawer = el0.closest('.drawer');
                        const toggle = drawer && drawer.querySelector('.drawer-toggle');
                        if (toggle) {
                            toggle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                        } else {
                            el0.classList.remove('openDrawer');
                            el0.classList.add('closedDrawer');
                        }
                    }
                }, 160);
            } else {
                // Spring back.
                springBack(el0);
            }
        });
}

// --- Settings UI -----------------------------------------------------------

function camelToKebab(str) {
    return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function addSettings() {
    const settingsHtml = `
        <div class="fork-mobile-settings">
            <label for="fork-fab-toggle" class="checkbox_label">
                <input id="fork-fab-toggle" type="checkbox" data-setting="fabEnabled">
                <span>Show floating launcher button</span>
            </label>
            <label for="fork-collapse-long-toggle" class="checkbox_label">
                <input id="fork-collapse-long-toggle" type="checkbox" data-setting="collapseLong">
                <span>Collapse long messages (tap to expand)</span>
            </label>
            <label for="fork-topcollapse-toggle" class="checkbox_label">
                <input id="fork-topcollapse-toggle" type="checkbox" data-setting="topCollapse">
                <span>Collapse top bar icons into a ⋮ menu</span>
            </label>
            <small>Fork Mobile — v0.2.31 (top bar menu · home font · portrait cards · swipe-close tolerates scrolling)</small>
        </div>`;

    $('#extensions_settings').append(settingsHtml);

    $('#fork-fab-toggle, #fork-collapse-long-toggle, #fork-topcollapse-toggle').on('change', function () {
        const key = $(this).attr('data-setting');
        extension_settings[extensionName][key] = $(this).prop('checked');
        // Await the ACTUAL save before reloading — saveSettingsDebounced is
        // debounced, so reloading immediately loses the change (toggle reverts).
        saveSettings().then(() => location.reload());
    });

    // Reflect current settings on the inputs.
    // Iterate the REAL inputs and read the key from data-setting — the old
    // `#fork-${camelToKebab(key)}-toggle` selector built `#fork-fab-enabled-toggle`
    // which doesn't exist (the id is `fork-fab-toggle`), so the FAB checkbox
    // NEVER showed its saved state and every toggle looked like it "reverted".
    $('#fork-fab-toggle, #fork-collapse-long-toggle, #fork-topcollapse-toggle').each(function () {
        const key = $(this).attr('data-setting');
        $(this).prop('checked', !!extension_settings[extensionName][key]);
    });
}

// --- Home typography: Playfair Display for names/labels --------------------
// Loaded once via Google Fonts <link> (no core index.html edit needed).
function injectHomeFont() {
    if (document.getElementById('fork-home-font')) return;
    const link = document.createElement('link');
    link.id = 'fork-home-font';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400&display=swap';
    document.head.appendChild(link);
}

// --- Init -------------------------------------------------------------------

jQuery(async () => {
    // Merge defaults PER KEY — existing installs have extension_settings saved
    // WITHOUT new keys (e.g. topCollapse added in v0.2.25); a whole-object
    // `if (!hasOwn)` guard never fills them in, so new features silently no-op.
    extension_settings[extensionName] = { ...defaultSettings, ...extension_settings[extensionName] };
    saveSettingsDebounced();

    injectCriticalCss();
    injectHomeFont();
    applyMobileHooks();
    topmenuApplyAttr();
    buildFab();
    buildTopMenu();
    keepForkPinned();
    addSettings();
    initLongMessages();
    initComposeMode();
    initSwipeClose();

    console.log('[fork-mobile] active v0.2.30 {topmenu:' + (extension_settings[extensionName].topCollapse ? 1 : 0) + '}');
});

export function init() {
    // Re-run when the extension is toggled on.
    jQuery(async () => {
        injectCriticalCss();
        injectHomeFont();
        applyMobileHooks();
        topmenuApplyAttr();
        buildFab();
        buildTopMenu();
        keepForkPinned();
        initLongMessages();
        initComposeMode();
        initSwipeClose();
    });
}
