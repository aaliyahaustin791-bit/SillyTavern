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

// --- Compose mode: hide overlay widgets while typing (JS-driven) ----------

const COMPOSE_HIDE_SELECTORS = [
    '.rpg-panel',
    '.rt-so-panel',
    '.rpg-tracker-panel',
    '.rpg-tracker-agent-panel',
    '.rpg-tracker-delta-panel',
    '.rpg-tracker-status-indicator',
    '.rpg-tracker-prompt-bar',
    '.rpg-tracker-nav',
    '.rpg-tracker-delta-toolbar',
    '.rt-rel-float',
    '.rt-immersion-hero-overlay',
    '.rt-npc-creator-panel',
    '.rt-npc-portrait-gen-overlay',
    '.rt-loc-image-gen-overlay',
    '.rt-charpicker-overlay',
    '.rt-benched-panel',
    '.rt-settings-overlay',
    '.rt-beta-unlock-overlay',
];

let composeObserver = null;

function setComposeMode(hide) {
    document.documentElement.dataset.forkComposing = hide ? '1' : '0';
    // Visual debug: colored top border when composing is active.
    document.documentElement.style.setProperty(
        '--fork-compose-indicator',
        hide ? '2px solid #d946ef' : '0px solid transparent',
    );
    const apply = () => {
        for (const sel of COMPOSE_HIDE_SELECTORS) {
            document.querySelectorAll(sel).forEach((node) => {
                const el = /** @type {HTMLElement} */ (node);
                if (hide) {
                    el.style.setProperty('display', 'none', 'important');
                } else {
                    el.style.removeProperty('display');
                }
            });
        }
    };
    apply();
    if (hide && !composeObserver) {
        composeObserver = new MutationObserver(() => apply());
        composeObserver.observe(document.body, { childList: true, subtree: true });
    } else if (!hide && composeObserver) {
        composeObserver.disconnect();
        composeObserver = null;
    }
}

function initComposeMode() {
    // focusin/out bubble (unlike focus/blur) — more reliable on mobile.
    $(document).on('focusin.forkCompose', '#send_textarea', () => setComposeMode(true));
    $(document).on('focusout.forkCompose', '#send_textarea', () => setComposeMode(false));
    // Fallback poll: if the textarea stays focused without firing events,
    // re-apply compose mode every 400ms. Cleared when not composing.
    setInterval(() => {
        if (document.activeElement?.id === 'send_textarea' && document.documentElement.dataset.forkComposing !== '1') {
            setComposeMode(true);
        }
    }, 400);
    setComposeMode(document.activeElement?.id === 'send_textarea');
}

// --- Manual compose-mode toggle (in case focus events fail on mobile) -----

function buildComposeToggle() {
    const btn = $('<div id="fork-compose-toggle" title="Toggle compose mode">⌨</div>');
    $('body').append(btn);
    btn.on('click', (e) => {
        e.stopPropagation();
        const next = document.documentElement.dataset.forkComposing !== '1';
        setComposeMode(next);
    });
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
            <small>Fork Mobile — v0.2.5 (Phase 1: mobile overhaul)</small>
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

    applyMobileHooks();
    buildFab();
    buildComposeToggle();
    addSettings();
    initLongMessages();
    initComposeMode();

    console.log('[fork-mobile] active (v0.2.5)');
});

export function init() {
    // Re-run when the extension is toggled on.
    jQuery(async () => {
        applyMobileHooks();
        buildFab();
        buildComposeToggle();
        initLongMessages();
        initComposeMode();
    });
}
