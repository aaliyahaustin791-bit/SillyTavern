// Fork Mobile — foundation extension for the SillyTavern mobile+agents fork.
// v0.2.1: FAB + bottom sheet launcher, mobile CSS hooks, Phase 1 overhaul
// (long-message collapse w/ keyboard-aware resizing, typing input cap).

import { extension_settings } from '../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../script.js';
import { isMobile } from '../../RossAscends-mods.js';

const extensionName = 'fork-mobile';
const defaultSettings = {
    fabEnabled: true,
    collapseLong: true,
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

function buildFab() {
    if (!extension_settings[extensionName].fabEnabled) {
        return;
    }

    const fab = $('<div id="fork-fab" title="Fork launcher">✦</div>');
    $('body').append(fab);

    const sheet = $('<div id="fork-sheet" class="fork-hidden"></div>');
    const backdrop = $('<div id="fork-backdrop" class="fork-hidden"></div>');
    $('body').append(backdrop, sheet);

    const items = [
        { label: '🧠 Helper Agents', sub: 'coming in Phase 2', disabled: true },
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
        list.append(row);
    }

    const header = $('<div class="fork-sheet-header"></div>');
    header.append($('<span></span>').text('Fork Launcher'));
    header.append($('<button id="fork-sheet-close" class="fork-sheet-close">✕</button>'));

    sheet.append(header, list);

    const open = () => {
        sheet.removeClass('fork-hidden');
        backdrop.removeClass('fork-hidden');
    };
    const close = () => {
        sheet.addClass('fork-hidden');
        backdrop.addClass('fork-hidden');
    };

    fab.on('click', open);
    backdrop.on('click', close);
    $('#fork-sheet-close').on('click', close);
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
            <small>Fork Mobile — v0.2.10 (Phase 1: mobile overhaul)</small>
        </div>`;

    $('#extensions_settings').append(settingsHtml);

    $('#fork-fab-toggle, #fork-collapse-long-toggle').on('change', function () {
        const key = $(this).attr('data-setting');
        extension_settings[extensionName][key] = $(this).prop('checked');
        saveSettingsDebounced();
        location.reload();
    });

    // Reflect current settings on the inputs.
    for (const key of Object.keys(defaultSettings)) {
        const value = extension_settings[extensionName][key];
        $(`#fork-${camelToKebab(key)}-toggle`).prop('checked', value);
    }
}

// --- Init -------------------------------------------------------------------

jQuery(async () => {
    if (!Object.hasOwn(extension_settings, extensionName)) {
        extension_settings[extensionName] = { ...defaultSettings };
        saveSettingsDebounced();
    }

    injectCriticalCss();
    applyMobileHooks();
    buildFab();
    addSettings();
    initLongMessages();
    initComposeMode();

    console.log('[fork-mobile] active (v0.2.10)');
});

export function init() {
    // Re-run when the extension is toggled on.
    jQuery(async () => {
        injectCriticalCss();
        applyMobileHooks();
        buildFab();
        initLongMessages();
        initComposeMode();
    });
}
