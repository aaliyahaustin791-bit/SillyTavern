// Fork Mobile — foundation extension for the SillyTavern mobile+agents fork.
// v0.2.0: FAB + bottom sheet launcher, mobile CSS hooks, Phase 1 overhaul
// (long-message collapse, typing-time input cap).

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

function processLongMessages() {
    if (!mobileQuery.matches || !extension_settings[extensionName].collapseLong) {
        return;
    }

    const typing = document.activeElement?.id === 'send_textarea';
    const threshold = window.innerHeight * (typing ? 0.3 : 0.55);

    $('#chat .mes').each(function () {
        const $mes = $(this);
        const $text = $mes.find('.mes_text').first();
        if (!$text.length) {
            return;
        }

        if ($text[0].scrollHeight > threshold) {
            if (!$mes.hasClass('mes-long-collapsed') && !$mes.hasClass('mes-long-expanded')) {
                $mes.addClass('mes-long-collapsed');
                $text.append('<div class="mes-text-fade"></div><div class="mes-long-toggle">⤓ more</div>');
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
        if ($mes.hasClass('mes-long-collapsed')) {
            $mes.removeClass('mes-long-collapsed').addClass('mes-long-expanded');
            $(this).text('⤒ collapse');
        } else {
            $mes.removeClass('mes-long-expanded').addClass('mes-long-collapsed');
            $(this).text('⤓ more');
        }
    });

    eventSource.on(event_types.USER_MESSAGE_RENDERED, processLongMessages);
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, processLongMessages);
    eventSource.on(event_types.MESSAGE_SWIPED, processLongMessages);
    eventSource.on(event_types.MESSAGE_EDITED, processLongMessages);
    eventSource.on(event_types.CHAT_CHANGED, processLongMessages);
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
            <small>Fork Mobile — v0.2.0 (Phase 1: mobile overhaul)</small>
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
    addSettings();
    initLongMessages();

    console.log('[fork-mobile] active (v0.2.0)');
});

export function init() {
    // Re-run when the extension is toggled on.
    jQuery(async () => {
        applyMobileHooks();
        buildFab();
        initLongMessages();
    });
}
