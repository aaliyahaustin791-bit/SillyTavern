// Fork Mobile — foundation extension for the SillyTavern mobile+agents fork.
// v0.1.0: floating action button + bottom sheet launcher + mobile CSS hooks.
// Phase 1 (mobile overhaul) and Phase 2 (helper agents) build on this.

import { extension_settings } from '../../extensions.js';
import { saveSettingsDebounced } from '../../../script.js';
import { isMobile } from '../../RossAscends-mods.js';

const extensionName = 'fork-mobile';
const defaultSettings = {
    fabEnabled: true,
};

// Mark the document so fork CSS can scope to mobile.
function applyMobileHooks() {
    if (isMobile()) {
        document.documentElement.dataset.forkMobile = '1';
    }
}

// --- UI: floating action button + bottom sheet ---------------------------

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
        { label: '📱 Mobile hooks', sub: 'active — html[data-fork-mobile="1"]', disabled: false },
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

// --- Settings UI ----------------------------------------------------------

function addSettings() {
    const settingsHtml = `
        <div class="fork-mobile-settings">
            <label for="fork-fab-toggle" class="checkbox_label">
                <input id="fork-fab-toggle" type="checkbox" data-setting="fabEnabled">
                <span>Show floating launcher button</span>
            </label>
            <small>Fork Mobile foundation — v0.1.0</small>
        </div>`;

    $('#extensions_settings').append(settingsHtml);

    $('#fork-fab-toggle').on('change', function () {
        extension_settings[extensionName].fabEnabled = $(this).prop('checked');
        saveSettingsDebounced();
        location.reload();
    });

    // Reflect current settings on the inputs.
    for (const key of Object.keys(defaultSettings)) {
        const value = extension_settings[extensionName][key];
        $(`#fork-${key.replace('_', '-')}-toggle`).prop('checked', value);
    }
}

// --- Init ------------------------------------------------------------------

jQuery(async () => {
    if (!Object.hasOwn(extension_settings, extensionName)) {
        extension_settings[extensionName] = { ...defaultSettings };
        saveSettingsDebounced();
    }

    applyMobileHooks();
    buildFab();
    addSettings();

    console.log('[fork-mobile] active (v0.1.0)');
});

export function init() {
    // Re-run when the extension is toggled on.
    jQuery(async () => {
        applyMobileHooks();
        buildFab();
    });
}
