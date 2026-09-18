// Fork Agents — native helper agent framework for the SillyTavern mobile+agents fork.
// Phase 2 of the fork roadmap (Marinara-inspired, native, not bolted on).
//
// Framework pieces:
//   - Agent registry: agents are plain definitions {id, name, icon, buildPrompt,
//     parseOutput, renderResult, apply?} registered via registerAgent().
//   - Runtime: shared LLM call (active model via generateRaw/generateQuietPrompt),
//     chat snapshot, {{macro}} expansion, robust JSON extraction.
//   - Result panel: bottom sheet with loading/result/error states and
//     Apply / Copy / Send-to-chat / Done actions.
//   - Launcher: bottom sheet listing agents; opened from fork-mobile's FAB
//     (CustomEvent 'fork-launch-agents') or the settings button.
//   - Slash commands: /agent name=... prompt=...
//
// The registry carries a `phase` field ('manual' for now) so Marinara-style
// auto-run cadence (pre-generation / post-processing) can be added later
// without changing agent definitions.

import { extension_settings, getContext } from '../../extensions.js';
import { addOneMessage, chat, getRequestHeaders, saveChatConditional, saveSettings, saveSettingsDebounced } from '../../../script.js';
import { getMessageTimeStamp } from '../../RossAscends-mods.js';
import { loadWorldInfo, createWorldInfoEntry, saveWorldInfo } from '../../world-info.js';
import { SlashCommandParser } from '../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandNamedArgument } from '../../slash-commands/SlashCommandArgument.js';

const extensionName = 'fork-agents';

const defaultSettings = {
    enabled: true,
    lorebookTarget: '',        // empty = use the current character's world
    maxContextMessages: 30,    // how many recent chat messages agents read
    smithMaxTokens: 7000,      // Character Smith output budget (1 card per call)
};

function settings() {
    return extension_settings[extensionName];
}

// --- Utilities --------------------------------------------------------------

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Strip ST/Kimi/deepseek system markup that pollutes external prompts. */
function stripMeta(text) {
    let s = String(text || '');
    s = s.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
    s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
    s = s.replace(/\[REPORT CARD[^\]]*\][\s\S]*?(?=\n|$)/gi, '');
    s = s.replace(/^Stage \d+:.*$/gim, '');
    s = s.replace(/^→ .*$/gm, '');
    s = s.replace(/^Temperature.*$/gm, '');
    s = s.replace(/\n{3,}/g, '\n\n');
    return s.trim();
}

/** Robust JSON extraction: strip reasoning, fences, and prose around the JSON.
 *  Strategy 1: whole-string parse after stripping CoT wrappers + fences.
 *  Strategy 2: brace-balanced scan from the first { or [ — ignores braces
 *  inside strings and stops at the balanced close, so prose/truncation before
 *  or after the JSON can't break it. (Kimi leaks <plan>/<think> CoT blocks and
 *  sometimes wraps the JSON in commentary.)
 *  Strategy 3: first line that parses standalone. */
function extractJson(text) {
    let s = String(text || '');
    s = s.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
    s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
    s = s.replace(/<plan>[\s\S]*?<\/plan>/gi, '');
    s = s.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');
    s = s.replace(/```json\s*/gi, '').replace(/```/gi, '');
    s = s.trim();
    if (!s) return null;

    // Strategy 1
    try { return JSON.parse(s); } catch { /* fall through */ }

    // Strategy 2: brace-balanced scan
    let start = -1;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '{' || c === '[') { start = i; break; }
    }
    if (start >= 0) {
        const openCh = s[start];
        const closeCh = openCh === '{' ? '}' : ']';
        let depth = 0, inStr = false, esc = false, end = -1;
        for (let i = start; i < s.length; i++) {
            const c = s[i];
            if (esc) { esc = false; continue; }
            if (c === '\\') { esc = true; continue; }
            if (inStr) { if (c === '"') inStr = false; continue; }
            if (c === '"') { inStr = true; continue; }
            if (c === openCh) depth++;
            else if (c === closeCh) { depth--; if (depth === 0) { end = i + 1; break; } }
        }
        if (end > start) {
            try { return JSON.parse(s.slice(start, end)); } catch { /* fall through */ }
        }
    }

    // Strategy 3: per-line parse
    for (const line of s.split('\n')) {
        const l = line.trim();
        if (l.startsWith('{') || l.startsWith('[')) {
            try { return JSON.parse(l); } catch { /* keep scanning */ }
        }
    }
    return null;
}

function copyText(text) {
    const done = () => toastr.success('Copied to clipboard.');
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
        fallbackCopy(text, done);
    }
}

function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch { toastr.warning('Copy failed — select the text manually.'); }
    ta.remove();
}

// --- CSS self-loading ---------------------------------------------------------
// Belt-and-suspenders: fetch our own stylesheet and inject it as an inline
// <style> at boot. If addExtensionStyle's <link> ever fails or the browser
// refuses it, the sheets still get their positioning/visibility rules, so the
// launcher can NEVER render as an unstyled block below the fold.

async function ensureCss() {
    if (document.getElementById('fork-agents-css-inline')) return;
    try {
        const response = await fetch('/scripts/extensions/fork-agents/style.css', { cache: 'no-cache' });
        if (!response.ok) throw new Error(`CSS fetch ${response.status}`);
        const css = await response.text();
        const style = document.createElement('style');
        style.id = 'fork-agents-css-inline';
        style.textContent = css;
        document.head.appendChild(style);
        console.log(`[fork-agents] CSS injected inline (${css.length} bytes)`);
    } catch (err) {
        console.error('[fork-agents] CSS injection failed', err);
    }
}

// --- Agent registry ---------------------------------------------------------

const agents = new Map();

function registerAgent(agent) {
    if (!agent?.id) throw new Error('[fork-agents] agent needs an id');
    agents.set(agent.id, agent);
}

function getAgents() {
    return [...agents.values()];
}

function resolveAgent(name) {
    const n = String(name || '').trim().toLowerCase();
    if (!n) return null;
    if (agents.has(n)) return agents.get(n);
    return getAgents().find(a =>
        a.id.toLowerCase() === n || a.name.toLowerCase() === n ||
        a.name.toLowerCase().includes(n) || a.id.toLowerCase().includes(n));
}

// --- Runtime: chat context, macros, model calls ------------------------------

function getChatSnapshot(ctx, maxMessages) {
    const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];
    const out = [];
    for (const msg of chat) {
        if (!msg || msg.is_system) continue;
        const text = String(msg.mes || msg.text || '').trim();
        if (!text) continue;
        const speaker = msg.is_user ? (ctx.name1 || 'You') : (msg.name || ctx.name2 || 'Character');
        const clean = stripMeta(text).slice(0, 500);
        if (!clean) continue;
        out.push(`${speaker}: ${clean}`);
    }
    return out.slice(-(maxMessages || 30)).join('\n');
}

function expandMacros(template, ctx, vars) {
    return String(template)
        .replace(/\{\{user\}\}/gi, () => ctx?.name1 || 'User')
        .replace(/\{\{char\}\}/gi, () => ctx?.name2 || ctx?.name || 'Character')
        .replace(/\{\{input\}\}/gi, () => vars.input || '(none)')
        .replace(/\{\{recentChat\}\}/gi, () => vars.recentChat || '(no recent chat)')
        .replace(/\{\{lastMessage\}\}/gi, () => vars.lastMessage || '(none)');
}

async function callModel({ systemPrompt, prompt, maxTokens }) {
    const ctx = getContext();
    if (ctx?.generateRaw) {
        // Direct pipeline — skips intermediate processing, most reliable for JSON.
        return String(await ctx.generateRaw({
            prompt,
            systemPrompt,
            responseLength: maxTokens,
            trimToSentence: false,
        }) ?? '');
    }
    if (ctx?.generateQuietPrompt) {
        return String(await ctx.generateQuietPrompt({
            quietPrompt: prompt,
            quietToLoud: false,
            skipWIAN: true,
            responseLength: maxTokens,
            trimToSentence: false,
            removeReasoning: false, // deepseek/kimi family strip out entirely if true
        }) ?? '');
    }
    throw new Error('No model call available on the ST context.');
}

async function runAgent(agent, input, { skipInput = false } = {}) {
    if (!agent) return;
    if (!skipInput) {
        panel.open(agent);
        return;
    }
    try {
        const ctx = getContext();
        panel.showLoading(agent, `${agent.name} is thinking…`);
        const promptData = await agent.buildPrompt(ctx, input || '', runtime);
        const raw = await callModel({ ...promptData, maxTokens: agent.maxTokens || 2000 });
        // parseOutput may be async (agents that run extra passes, e.g. Character
        // Smith's field top-up) — await so both shapes work.
        const result = await agent.parseOutput(raw, { ctx, input: input || '', callModel, agent });
        if (typeof agent.onResult === 'function') agent.onResult(ctx, input || '', result);
        panel.showResult(agent, result, raw);
    } catch (err) {
        console.error('[fork-agents]', agent.id, err);
        panel.showError(agent, err, panel.lastRaw);
    }
}

// --- Launcher (agent picker bottom sheet) ------------------------------------

// Module-level open/close: the button in settings binds directly to these, and
// fork-mobile's FAB dispatches 'fork-launch-agents' which calls openAgentsLauncher.
// NOTE: we set inline styles (not just class toggles) so no stale/cached CSS,
// class mismatch, or !important war can hide the sheets.
async function openAgentsLauncher() {
    const s = settings();
    if (!s || !s.enabled) {
        toastr.warning('Helper Agents are disabled in extension settings.');
        return;
    }
    try {
        await ensureCss();
        let launcher = document.getElementById('fa-launcher');
        let backdrop = document.getElementById('fa-backdrop');
        if (!launcher || !backdrop) {
            buildLauncher();
            launcher = document.getElementById('fa-launcher');
            backdrop = document.getElementById('fa-backdrop');
        }
        // RE-PARENT to <html> (NOT body): the debug toastr proved the sheets sit
        // in body (parent=BODY) with correct inline styles yet render at y=-304.
        // That means BODY itself is a shifted containing block — its class list
        // shows 'drop_target translate nemo-prompt-ui-modern' etc. (some
        // extension's DOM/transform hack). Transformed ancestors hijack
        // position:fixed. <html> is far less likely to be transformed.
        if (launcher) document.documentElement.appendChild(launcher);
        if (backdrop) document.documentElement.appendChild(backdrop);
        // ALL critical styles inline. Anchor from the TOP: with bottom:0 the
        // sheet consistently renders ABOVE the viewport (y=-287) even with
        // every containing-block condition clean (elT/bodyT/htmlT=none,
        // cpos=fixed, parent=HTML). top:0 lands at the viewport top in every
        // scenario, and vh units resolve against the viewport, not any
        // containing block — so these values cannot miss.
        if (launcher) {
            launcher.style.position = 'fixed';
            launcher.style.top = '0';
            launcher.style.bottom = 'auto';
            launcher.style.left = '0';
            launcher.style.right = '0';
            launcher.style.height = 'min(62vh, 520px)';
            launcher.style.display = 'flex';
            launcher.style.zIndex = '1000001';
        }
        if (backdrop) {
            backdrop.style.position = 'fixed';
            backdrop.style.top = '0';
            backdrop.style.bottom = 'auto';
            backdrop.style.left = '0';
            backdrop.style.right = '0';
            backdrop.style.height = '100vh';
            backdrop.style.display = 'block';
            backdrop.style.zIndex = '1000000';
        }
        // Kill any stuck transform/animation state on the sheet itself (a
        // stylesheet animation frozen at a translate keyframe moves the sheet
        // too), and neutralize html's IDENTITY transform (observed:
        // matrix(1,0,0,1,0,0)). A transform on the root element makes it the
        // containing block for every fixed descendant — bottom:0 then resolves
        // against html's box instead of the viewport (observed: y=-287, fully
        // above the screen). Identity → none is visually identical.
        const hsNow = getComputedStyle(document.documentElement).transform;
        if (hsNow && hsNow !== 'none' && hsNow === 'matrix(1, 0, 0, 1, 0, 0)') {
            document.documentElement.style.transform = 'none';
        }
        if (launcher) {
            launcher.style.transform = 'none';
            launcher.style.animation = 'none';
            launcher.style.top = 'auto';
        }
        if (backdrop) {
            backdrop.style.transform = 'none';
            backdrop.style.animation = 'none';
            backdrop.style.top = 'auto';
        }
        // Keep them pinned to body against any DOM manager.
        keepAgentsPinned();
        $('#fa-launcher').removeClass('fa-hidden');
        $('#fa-backdrop').removeClass('fa-hidden');
        // Diagnostic toastr: dump the sheet's REAL rendered geometry so we can
        // see where it lands without the user needing the console.
        let geo = 'n/a';
        if (launcher) {
            const r = launcher.getBoundingClientRect();
            const p = launcher.parentElement;
            const cs = getComputedStyle(launcher);
            const bs = getComputedStyle(document.body);
            const hs = getComputedStyle(document.documentElement);
            geo = `${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.x)},${Math.round(r.y)} vh=${Math.round(window.innerHeight)} parent=${p ? p.tagName + '#' + p.id + '.' + (p.className || '') : 'none'} cpos=${cs.position} top=${cs.top} bot=${cs.bottom} elT=${cs.transform || 'none'} bodyT=${bs.transform || 'none'} htmlT=${hs.transform || 'none'} scrollY=${Math.round(window.scrollY)} docH=${Math.round(document.body.scrollHeight)}`;
        }
        const fab = document.getElementById('fork-fab');
        toastr.success(`Launcher OK · ${geo} · fab=${fab ? 'present' : 'missing'}`);
        console.log('[fork-agents] launcher opened', { launcher: !!launcher, backdrop: !!backdrop, geo, fab: !!fab });
    } catch (err) {
        toastr.error(`Launcher error: ${err?.message || err}`);
        console.error('[fork-agents] open failed', err);
    }
}

/** Poll: if anything re-parents our sheets, move them back to html. Also
 *  neutralize an identity transform stuck on <html> (root transform hijacks
 *  the containing block for all fixed descendants). */
let agentsPinnedInterval = null;
function keepAgentsPinned() {
    if (agentsPinnedInterval) return;
    agentsPinnedInterval = setInterval(() => {
        const hs = getComputedStyle(document.documentElement).transform;
        if (hs && hs !== 'none' && hs === 'matrix(1, 0, 0, 1, 0, 0)') {
            document.documentElement.style.transform = 'none';
            console.log('[fork-agents] neutralized html identity transform');
        }
        for (const id of ['fa-launcher', 'fa-backdrop', 'fa-panel']) {
            const el = document.getElementById(id);
            if (el && el.parentElement !== document.documentElement) {
                document.documentElement.appendChild(el);
                console.log('[fork-agents] re-pinned #' + id, 'from', el.parentElement?.tagName, el.parentElement?.id);
            }
        }
    }, 800);
}

function closeAgentsLauncher() {
    const launcher = document.getElementById('fa-launcher');
    const backdrop = document.getElementById('fa-backdrop');
    if (launcher) launcher.style.display = 'none';
    if (backdrop) backdrop.style.display = 'none';
    $('#fa-launcher').addClass('fa-hidden');
    $('#fa-backdrop').addClass('fa-hidden');
}

function buildLauncher() {
    if (document.getElementById('fa-launcher')) return;

    const launcher = $(`<div id="fa-launcher" class="fa-hidden"></div>`);
    const backdrop = $('<div id="fa-backdrop" class="fa-hidden"></div>');
    $('body').append(backdrop, launcher);

    const header = $('<div class="fa-header"></div>');
    header.append($('<span class="fa-title">🧠 Helper Agents</span>'));
    header.append($('<button id="fa-launcher-close" class="fa-close">✕</button>'));
    launcher.append(header);

    const list = $('<div class="fa-list"></div>');
    for (const agent of getAgents()) {
        const row = $('<div class="fa-agent-row"></div>');
        row.append($('<span class="fa-agent-icon"></span>').text(agent.icon));
        const col = $('<div class="fa-agent-info"></div>');
        col.append($('<div class="fa-agent-name"></div>').text(agent.name));
        col.append($('<div class="fa-agent-tagline"></div>').text(agent.tagline));
        row.append(col);
        row.on('click', () => { closeAgentsLauncher(); panel.open(agent); });
        list.append(row);
    }
    launcher.append(list);

    launcher.append($('<div class="fa-hint">Or type: /agent name=lorebook-keeper prompt=…</div>'));

    $('#fa-launcher-close').on('click', closeAgentsLauncher);
    backdrop.on('click', closeAgentsLauncher);

    // Opened from fork-mobile's FAB sheet (and anywhere else that dispatches it).
    document.addEventListener('fork-launch-agents', openAgentsLauncher);
}

// --- Result panel -------------------------------------------------------------

const panel = {
    agent: null,
    result: null,
    lastRaw: '',

    open(agent) {
        this.agent = agent;
        this.result = null;
        this.lastRaw = '';
        const body = $('#fa-panel-body').empty();
        body.append($('<textarea id="fa-input" class="fa-input" placeholder=""></textarea>')
            .attr('placeholder', agent.inputPlaceholder || 'Optional input…'));
        if (agent.needsInput) {
            body.append($('<div class="fa-input-hint">Input is optional — run with an empty box to use the recent scene as-is.</div>'));
        }
        this._setFooter([{ id: 'run', label: 'Run', primary: true }, { id: 'done', label: 'Done' }]);
        this._show();
        // No auto-focus: popping the keyboard on mobile would cover the panel.
    },

    showLoading(agent, status) {
        this.agent = agent;
        this.lastRaw = '';
        $('#fa-panel-body').empty().append(
            $('<div class="fa-loading"></div>')
                .append($('<div class="fa-spinner"></div>'))
                .append($('<div class="fa-status"></div>').text(status || 'Working…')));
        this._setFooter([]);
        this._show();
    },

    showResult(agent, result, raw) {
        this.agent = agent;
        this.result = result;
        this.lastRaw = raw || '';
        const body = $('#fa-panel-body').empty();
        try {
            const html = agent.renderResult ? agent.renderResult(result) : `<pre class="fa-pre">${escapeHtml(JSON.stringify(result, null, 2))}</pre>`;
            body.append(html);
        } catch (e) {
            console.warn('[fork-agents] renderResult failed', e);
            body.append(`<pre class="fa-pre">${escapeHtml(raw || '')}</pre>`);
        }
        if (agent.conversational) {
            // Inline follow-up box: turns the panel into a conversation loop.
            // The agent's onResult hook stores the Q&A so follow-ups keep context.
            const followupHint = escapeHtml(agent.followupPlaceholder || 'Ask a follow-up — the advisor remembers this conversation…');
            body.append(`<div class="fa-followup" style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(128,128,128,.35);display:flex;gap:8px;align-items:stretch;">
                <textarea id="fa-followup-input" placeholder="${followupHint}" style="flex:1 1 auto;min-width:0;min-height:44px;max-height:96px;resize:vertical;background:rgba(0,0,0,.35);color:inherit;border:1px solid rgba(128,128,128,.4);border-radius:8px;padding:8px;font:inherit;font-size:14px;"></textarea>
                <button id="fa-followup-clear" class="fa-btn" style="flex:0 0 auto;" title="Forget this chat's thread for this agent">Clear</button>
                <button id="fa-followup-btn" class="fa-btn fa-btn-primary" style="flex:0 0 auto;">Ask</button>
            </div>`);
        }
        const actions = [];
        if (agent.apply) {
            // applyLabel may be a function of the result — Character Smith
            // relabels the button per stage (save / build / how-to-continue).
            const label = typeof agent.applyLabel === 'function'
                ? agent.applyLabel(result)
                : (result?.applyLabel || agent.applyLabel);
            actions.push({ id: 'apply', label: label || 'Apply', primary: true });
        }
        actions.push({ id: 'copy', label: 'Copy' });
        actions.push({ id: 'send', label: 'Send to chat' });
        actions.push({ id: 'done', label: 'Done' });
        this._setFooter(actions);
        this._show();
    },

    showError(agent, err, raw) {
        this.agent = agent;
        this.lastRaw = raw || '';
        const body = $('#fa-panel-body').empty();
        body.append($('<div class="fa-error"></div>').text(`Failed: ${err?.message || err}`));
        if (raw) {
            body.append($('<details class="fa-raw"><summary>Raw model output</summary></details>')
                .append($('<pre class="fa-pre"></pre>').text(raw)));
        }
        this._setFooter([{ id: 'copy', label: 'Copy raw' }, { id: 'done', label: 'Done' }]);
        this._show();
    },

    close() {
        $('#fa-panel').addClass('fa-hidden');
        $('#fa-backdrop').addClass('fa-hidden');
        const panelEl = document.getElementById('fa-panel');
        const backdrop = document.getElementById('fa-backdrop');
        if (panelEl) panelEl.style.display = 'none';
        if (backdrop) backdrop.style.display = 'none';
        this.agent = null;
        this.result = null;
    },

    _show() {
        $('#fa-panel-header-title').text(this.agent?.icon ? `${this.agent.icon} ${this.agent.name}` : 'Helper Agent');
        $('#fa-panel').removeClass('fa-hidden');
        $('#fa-backdrop').removeClass('fa-hidden');
        const panelEl = document.getElementById('fa-panel');
        const backdrop = document.getElementById('fa-backdrop');
        if (panelEl) {
            panelEl.style.position = 'fixed';
            panelEl.style.top = '0';
            panelEl.style.bottom = 'auto';
            panelEl.style.left = '0';
            panelEl.style.right = '0';
            panelEl.style.height = 'min(80vh, 640px)';
            panelEl.style.display = 'flex';
            panelEl.style.zIndex = '1000001';
        }
        if (backdrop) {
            backdrop.style.position = 'fixed';
            backdrop.style.top = '0';
            backdrop.style.bottom = 'auto';
            backdrop.style.left = '0';
            backdrop.style.right = '0';
            backdrop.style.height = '100vh';
            backdrop.style.display = 'block';
            backdrop.style.zIndex = '1000000';
        }
    },

    _setFooter(actions) {
        const footer = $('#fa-panel-footer').empty();
        for (const a of actions) {
            const btn = $('<button class="fa-btn"></button>').text(a.label);
            if (a.primary) btn.addClass('fa-btn-primary');
            btn.on('click', () => handlePanelAction(a.id));
            footer.append(btn);
        }
    },
};

async function handlePanelAction(actionId) {
    switch (actionId) {
        case 'run': {
            const input = String($('#fa-input').val() || '').trim();
            const agent = panel.agent;
            if (!agent) return;
            runAgent(agent, input, { skipInput: true });
            break;
        }
        case 'apply': {
            const agent = panel.agent;
            if (!agent?.apply || !panel.result) return;
            const checks = Array.from(document.querySelectorAll('#fa-panel .fa-entry-check'));
            const selected = checks.filter(c => c.checked).map(c => Number(c.dataset.idx));
            if (checks.length && !selected.length) {
                toastr.info('No entries selected — check at least one.');
                return;
            }
            panel.showLoading(agent, `Applying ${agent.name} output…`);
            try {
                const ok = await agent.apply(panel.result, getContext(), { selected });
                if (ok) {
                    toastr.success(`${agent.name}: done.`);
                    panel.close();
                } else {
                    panel.showResult(agent, panel.result, panel.lastRaw);
                }
            } catch (err) {
                console.error('[fork-agents] apply failed', err);
                panel.showError(agent, err, panel.lastRaw);
            }
            break;
        }
        case 'copy': {
            copyText(resultToText(panel.result, panel.lastRaw));
            break;
        }
        case 'send': {
            const text = resultToText(panel.result, panel.lastRaw);
            if (!text) { toastr.warning('Nothing to send.'); return; }
            // Canonical ST system-message shape (mirrors /comment).
            const mes = {
                name: panel.agent?.name || 'Agent',
                is_user: false,
                is_system: true,
                send_date: getMessageTimeStamp(),
                mes: text,
                extra: { gen_id: Date.now(), api: 'fork-agents' },
            };
            chat.push(mes);
            addOneMessage(mes, { scroll: true });
            saveChatConditional();
            toastr.success('Sent to chat as a system note.');
            break;
        }
        case 'done':
            panel.close();
            break;
    }
}

function resultToText(result, raw) {
    if (typeof result?.text === 'string') return result.text;
    if (result?.entries) return JSON.stringify(result.entries, null, 2);
    if (result?.card) return JSON.stringify(result.card, null, 2);
    if (result && typeof result === 'object') return JSON.stringify(result, null, 2);
    return raw || '';
}

// Conversational follow-up (agents with `conversational: true`): the inline
// Ask box re-runs the agent with the new input; the agent's onResult hook
// stores the Q&A so the thread keeps context. Delegated on document so it
// survives the panel's re-renders.
$(document).on('click', '#fa-followup-btn', function () {
    const agent = panel.agent;
    if (!agent?.conversational) return;
    const input = String($('#fa-followup-input').val() || '').trim();
    if (!input) { toastr.info('Type a follow-up first.'); return; }
    runAgent(agent, input, { skipInput: true });
});
$(document).on('click', '#fa-followup-clear', function () {
    const agent = panel.agent;
    if (!agent?.conversational) return;
    if (agent.id === 'character-smith') {
        clearSmithThread(getContext());
        toastr.info('Cleared this chat’s Character Smith thread (draft card + interview answers).');
        $('#fa-followup-input').val('');
        return;
    }
    if (advisorMemory.delete(advisorChatKey(getContext()))) {
        saveAdvisorMemory(advisorMemory);
        toastr.info('Cleared this chat’s advisor memory.');
    }
    $('#fa-followup-input').val('');
});
$(document).on('keydown', '#fa-followup-input', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        $('#fa-followup-btn').trigger('click');
    }
});

function buildPanel() {
    if (document.getElementById('fa-panel')) return;

    const panelEl = $(`<div id="fa-panel" class="fa-hidden"></div>`);
    const header = $('<div class="fa-header"></div>');
    header.append($('<span id="fa-panel-header-title" class="fa-title">Helper Agent</span>'));
    header.append($('<button id="fa-panel-close" class="fa-close">✕</button>'));
    panelEl.append(header);
    panelEl.append($('<div id="fa-panel-body" class="fa-body"></div>'));
    panelEl.append($('<div id="fa-panel-footer" class="fa-footer"></div>'));
    $('body').append(panelEl);

    $('#fa-panel-close').on('click', () => panel.close());
}

/** Harvest complete entry objects from truncated/partial JSON via regex.
 *  Matches complete "key":[...] + "content":"..." pairs; anything cut off
 *  mid-string is skipped. Returns [] if nothing complete exists. */
function salvageEntries(raw) {
    const out = [];
    const re = /\{\s*"key"\s*:\s*\[([\s\S]*?)\]\s*,\s*"content"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    let m;
    while ((m = re.exec(String(raw || '')))) {
        const keys = [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(x => x[1].trim()).filter(Boolean);
        const content = m[2];
        if (keys.length && content) {
            out.push({ key: keys, content, comment: '', constant: false, selective: false });
        }
    }
    return out;
}

// --- Agents -------------------------------------------------------------------

// Lorebook Keeper — propose world-info entries from the recent scene.
registerAgent({
    id: 'lorebook-keeper',
    name: 'Lorebook Keeper',
    icon: '📖',
    tagline: 'Propose world-info entries from the recent scene',
    category: 'writer',
    phase: 'manual',
    maxTokens: 4000,
    needsInput: true,
    inputPlaceholder: 'Optional focus — e.g. "the tavern", "the war", "the guild"…',
    applyLabel: 'Add checked entries',

    async buildPrompt(ctx, input, rt) {
        const recentChat = getChatSnapshot(ctx, settings().maxContextMessages);
        const target = rt.getLorebookTarget(ctx);
        const existing = target ? await rt.getLorebookKeys(target) : [];

        const systemPrompt = `You are the Lorebook Keeper, a world-building curator for a roleplay chat.
Your job: read the recent scene and propose durable world-info (lorebook) entries — setting facts, locations, NPCs, factions, items, and ongoing plot states worth remembering later.

Output ONLY valid JSON, no markdown, no commentary:
{"entries":[{"key":["trigger phrase 1","trigger phrase 2"],"content":"2-5 sentences, present tense, neutral narrator voice","comment":"one short line: when this should trigger","constant":false,"selective":false}]}

Rules:
- Propose 2-6 entries. Skip one-off actions and dialogue-only beats.
- key: 1-3 short trigger phrases (lowercase, 2-6 words) that would appear in later chat when this fact matters.
- content: 2-3 SHORT sentences, under 180 characters total. Durable, specific, written from the facts in the chat — never invent new plot.
- constant: true ONLY for always-relevant setting facts (world name, magic rules, a character's core identity). Default false.
- selective: true when the entry should only show when its key matches.
- Do NOT duplicate the existing lorebook keys listed below — if the fact is already covered, leave it out.
- Keep the WHOLE response compact; every entry must be COMPLETE — do not truncate.`;

        const prompt = `Character: {{char}}
User: {{user}}
${input ? `Focus: ${input}\n` : ''}${existing.length ? `Existing lorebook keys (do not duplicate these):\n${existing.join(', ')}\n` : ''}
Recent chat:
{{recentChat}}`;

        return { systemPrompt, prompt: expandMacros(prompt, ctx, { input, recentChat }) };
    },

    parseOutput(raw) {
        const json = extractJson(raw);
        let entries = [];
        if (json && Array.isArray(json.entries)) {
            entries = json.entries;
        } else if (json && Array.isArray(json.lorebook_entries)) {
            entries = json.lorebook_entries;
        } else if (json && Array.isArray(json.world_info)) {
            entries = json.world_info;
        } else if (json && Array.isArray(json.data?.entries)) {
            entries = json.data.entries;
        }
        if (!entries.length) {
            // Truncation salvage: if the response was cut off mid-JSON but some
            // entries are COMPLETE, harvest them with a regex instead of
            // failing (the 2000-token cap used to truncate mid-content).
            entries = salvageEntries(raw);
        }
        if (!entries.length) {
            // Fail soft: don't throw away the model's output — surface it as a
            // raw-text result so the user can read/copy it and we can debug.
            return { entries: [], raw: String(raw || ''), parseFailed: true };
        }
        const parsed = entries
            .map(e => ({
                key: Array.isArray(e.key) ? e.key.map(k => String(k).trim()).filter(Boolean) : [String(e.key || '').trim()].filter(Boolean),
                content: String(e.content || '').trim(),
                comment: String(e.comment || '').trim(),
                constant: !!e.constant,
                selective: !!e.selective,
            }))
            .filter(e => e.key.length && e.content);
        if (!parsed.length) {
            return { entries: [], raw: String(raw || ''), parseFailed: true };
        }
        return { entries: parsed };
    },

    renderResult(result) {
        if (result.parseFailed) {
            // Fail soft: show the model's raw output so it's never lost.
            const shown = String(result.raw || '').slice(0, 4000);
            return `<div class="fa-result-intro fa-warn">The model's reply didn't parse into entries — showing it raw so you can still read/copy it. (If this repeats, tell the developer — the parser may need to learn this model's format.)</div>
                <div class="fa-raw-block">${escapeHtml(shown)}</div>`;
        }
        const intro = `<div class="fa-result-intro">${result.entries.length} proposed entr${result.entries.length === 1 ? 'y' : 'ies'} — uncheck any to skip, then Apply.</div>`;
        const cards = result.entries.map((e, i) => `
            <label class="fa-entry-card">
                <input type="checkbox" class="fa-entry-check" data-idx="${i}" checked>
                <div class="fa-entry-body">
                    <div class="fa-entry-keys">${(e.key || []).map(k => `<span class="fa-chip">${escapeHtml(k)}</span>`).join('') || '<em>no keys</em>'}</div>
                    <div class="fa-entry-content">${escapeHtml(e.content)}</div>
                    <div class="fa-entry-meta">${e.constant ? 'constant · ' : ''}${e.selective ? 'selective · ' : ''}${escapeHtml(e.comment)}</div>
                </div>
            </label>`).join('');
        return intro + cards;
    },

    async apply(result, ctx, { selected }) {
        const rt = runtime;
        const target = rt.getLorebookTarget(ctx);
        if (!target) {
            toastr.warning('No lorebook targeted. Give the character a world, or set one in extension settings.');
            return false;
        }
        const data = await loadWorldInfo(target);
        if (!data || typeof data.entries !== 'object') {
            toastr.error(`Could not load lorebook "${target}".`);
            return false;
        }

        const existingKeys = new Set();
        for (const entry of Object.values(data.entries)) {
            for (const k of (entry.key || [])) if (typeof k === 'string') existingKeys.add(k.trim().toLowerCase());
        }

        const indices = Array.isArray(selected) && selected.length ? selected : result.entries.map((_, i) => i);
        let added = 0;
        for (const i of indices) {
            const e = result.entries[i];
            if (!e) continue;
            const keys = e.key.map(k => k.toLowerCase());
            if (keys.some(k => existingKeys.has(k))) continue;
            const entry = createWorldInfoEntry(target, data);
            if (!entry) continue;
            entry.key = e.key;
            entry.keysecondary = [];
            entry.content = e.content;
            entry.comment = e.comment;
            entry.constant = e.constant;
            entry.selective = e.selective;
            data.entries[entry.uid] = entry;
            keys.forEach(k => existingKeys.add(k));
            added++;
        }

        if (!added) {
            toastr.info('Nothing new to add — all proposed entries already exist in the lorebook.');
            return false;
        }
        await saveWorldInfo(target, data, true);
        toastr.success(`Added ${added} entr${added === 1 ? 'y' : 'ies'} to "${target}".`);
        return true;
    },
});

// Character Smith — build a full V2 character card from a short idea.
// The prompt is the Character & World Builder v2.0 method (the same one the
// Hermes st-character-world-builder skill uses): prose over lists, field
// FLOORS instead of ceilings, in-scene greetings, embedded-lorebook world
// cards, and an interview mode for thin ideas. A second "top-up" pass in
// parseOutput rewrites any field that still came back short — the direct fix
// for cards that used to arrive bland, short and vague.

const SMITH_MEMORY_KEY = 'fork-agents:smithMemory';
const SMITH_MAX_CHATS = 12;
const SMITH_MAX_TURNS = 6;

function loadSmithMemory() {
    try {
        const raw = localStorage.getItem(SMITH_MEMORY_KEY);
        if (!raw) return new Map();
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return new Map();
        const map = new Map();
        for (const [key, entry] of parsed) {
            if (typeof key !== 'string' || !entry || typeof entry !== 'object') continue;
            const turns = Array.isArray(entry.turns)
                ? entry.turns.filter(t => t && typeof t.q === 'string' && typeof t.a === 'string').slice(-SMITH_MAX_TURNS)
                : [];
            map.set(key, {
                card: entry.card && typeof entry.card === 'object' ? entry.card : null,
                turns,
                pendingQuestions: typeof entry.pendingQuestions === 'string' ? entry.pendingQuestions : '',
                inventory: typeof entry.inventory === 'string' ? entry.inventory.slice(0, 4000) : '',
                stage: typeof entry.stage === 'string' ? entry.stage : '',
            });
        }
        return map;
    } catch {
        return new Map();
    }
}

function saveSmithMemory() {
    try {
        const trimmed = [...smithMemory.entries()].slice(-SMITH_MAX_CHATS);
        localStorage.setItem(SMITH_MEMORY_KEY, JSON.stringify(trimmed));
    } catch {
        // storage unavailable — the thread stays in-page for this session
    }
}

let smithMemory = loadSmithMemory();

function smithChatKey(ctx) {
    const g = ctx?.groupId ?? (ctx?.characterId === undefined ? (ctx?.chatId ?? '') : '');
    if (g) return 'g:' + String(g);
    return 'c:' + String(ctx?.characterId ?? '?');
}

function getSmithEntry(ctx) {
    return smithMemory.get(smithChatKey(ctx)) || { card: null, turns: [], pendingQuestions: '', inventory: '', stage: '' };
}

/** Record what the agent presented and where it says it is in the method. */
function setSmithStage(ctx, stage, inventory) {
    const entry = getSmithEntry(ctx);
    entry.stage = String(stage || '');
    if (typeof inventory === 'string' && inventory.trim()) entry.inventory = inventory.slice(0, 4000);
    setSmithEntry(ctx, entry);
}

function setSmithEntry(ctx, entry) {
    smithMemory.set(smithChatKey(ctx), entry);
    saveSmithMemory();
}

function rememberSmithTurn(ctx, question, answer) {
    const entry = getSmithEntry(ctx);
    entry.turns = [...entry.turns, {
        q: String(question || '').slice(0, 900),
        a: String(answer || '').slice(0, 500),
    }].slice(-SMITH_MAX_TURNS);
    entry.pendingQuestions = '';
    setSmithEntry(ctx, entry);
}

function rememberSmithCard(ctx, card) {
    const entry = getSmithEntry(ctx);
    entry.card = compactCard(card);
    setSmithEntry(ctx, entry);
}

function clearSmithThread(ctx) {
    if (smithMemory.delete(smithChatKey(ctx))) saveSmithMemory();
}

/** Bound what we keep in localStorage: enough to revise from, not a full copy. */
function compactCard(card) {
    const clip = (v, n) => String(v ?? '').slice(0, n);
    const out = {
        ch_name: clip(card.ch_name, 80),
        description: clip(card.description, 2600),
        personality: clip(card.personality, 800),
        scenario: clip(card.scenario, 700),
        first_mes: clip(card.first_mes, 1400),
        mes_example: clip(card.mes_example, 1800),
        creator_notes: clip(card.creator_notes, 900),
        system_prompt: clip(card.system_prompt, 500),
        post_history_instructions: clip(card.post_history_instructions, 500),
        character_version: clip(card.character_version, 40),
        talkativeness: clip(card.talkativeness, 8),
        tags: Array.isArray(card.tags) ? card.tags.slice(0, 12).map(String) : [],
        alternate_greetings: Array.isArray(card.alternate_greetings)
            ? card.alternate_greetings.slice(0, 4).map(g => clip(g, 1000))
            : [],
    };
    const entries = card?.character_book?.entries;
    if (Array.isArray(entries) && entries.length) {
        out.character_book = {
            name: clip(card.character_book?.name, 80),
            entry_outline: entries.slice(0, 30).map(e => ({
                keys: Array.isArray(e?.keys) ? e.keys.slice(0, 5).map(String) : [],
                comment: clip(e?.comment, 120),
                constant: !!e?.constant,
                insertion_order: Number(e?.insertion_order) || 0,
            })),
        };
    }
    return out;
}

/** Character & World Builder — the shared constitution for every mode. */
const SMITH_RULES = `CHARACTER & WORLD BUILDER v2.0 — SillyTavern chara_card_v2.

You are an expert character/world designer AND JSON developer for SillyTavern roleplay cards. You turn a short idea into a complete, playable card that reads like it was written by a novelist who has known this person for years.

[NON-NEGOTIABLE WRITING RULES]
1. PROSE OVER LISTS. Personality, behaviour, dress, items and relationships are ALWAYS natural-language prose. Never emit trait lists such as "cold, loyal, calculating". Show it instead: "She does not raise her voice because she has never needed to."
2. NO VAGUE FILLER. Every sentence carries a specific, playable detail — a habit, a tell, a scar, a name, a debt, an object, a superstition. "Mysterious and dangerous" is a failure. "Still carries her brother's knife from the trial and checks the edge every morning" is a character.
3. THE FIELD LENGTHS BELOW ARE FLOORS, NOT TARGETS. Write until the information is genuinely spent. A short, general card is a FAILED card. Never wrap up early to be safe, and never pad with restatement — add new, usable detail instead.
4. OPEN IN SCENE. first_mes and every alternate greeting start mid-moment with the character present and active — speaking, doing, deciding. Never "Hello, I am X." Never a narrator's summary of them.
5. {{user}} IS THE PLAYER. Never invent or narrate {{user}}'s history, feelings, words or decisions. Refer to them as {{user}}.
6. ORIGINAL IDEAS: the user's idea is the only source of truth for facts. You MAY add small connective detail (a mother's name, a street, a shift pattern, a favoured drink) but it must be consistent and unremarkable, and must never contradict the idea.
7. EXISTING PROPERTIES: use your canon knowledge, and state the exact era/version/arc in creator_notes so it can be corrected.
8. ONE VOICE. Vocabulary, rhythm, verbal tics and the things this character would never say must stay consistent across description, personality, first_mes, alternate_greetings and mes_example.
9. OUTPUT RULES: output ONLY the JSON object requested — no markdown, no code fences, no commentary before or after. Every bracket and brace closed. Do not truncate: a card cut off mid-field is worthless.`;

/** Default mode: one independent character card (Schema 1). */
const SMITH_CHARACTER_MODE = `[MODE: CHARACTER CARD — default]
Output ONE JSON object, exactly these keys:
{"ch_name":"","description":"","personality":"","scenario":"","first_mes":"","mes_example":"","creator_notes":"","system_prompt":"","post_history_instructions":"","character_version":"1.0","tags":[],"talkativeness":"0.5","alternate_greetings":[]}

FIELD FLOORS (minimums — exceed them whenever the idea supports it):
  ch_name → the name only, no title padding.
  description → 300-500 words. THE SPINE OF THE CARD: SillyTavern sends this every turn, so it must stand alone. Cover all nine layers, woven into prose in this order:
      1 IDENTITY — role, archetype, what they are for in this world.
      2 APPEARANCE — four or more sentences: height, build, face, hair, eyes, skin, hands, one distinguishing physical detail, and how they hold themselves (posture, stillness, what their hands do while they talk).
      3 PRESENT SITUATION — where they are now and what is currently pressing on them.
      4 PERSONALITY — who they are and what drives them, in prose, contradictions included.
      5 VOICE — speech patterns, vocabulary register, rhythm, verbal tics, and what they never say.
      6 RELATIONSHIPS — name the people, and what each bond costs them.
      7 DRESS & CARRIED THINGS — woven in naturally, never enumerated.
      8 SECRETS — what they hide; what they will not admit even to themselves.
      9 BEHAVIOUR — under pressure, in conflict, in intimacy, when caught off guard, when drunk or exhausted.
    Open with presence, not taxonomy: "She moves through a crowd like the crowd already knows to step aside." — never "She is a tall woman with dark hair."
  personality → 1-3 punchy lines, 60-120 tokens: the compressed spine of the description. Still prose, still specific, no lists.
  scenario → "" UNLESS the user explicitly asked for an opening situation. Never invent one.
  first_mes → 150-300 tokens. In-scene, in-voice, {{user}} addressed or implicated, and something to answer: a question, a demand, a situation mid-motion.
  alternate_greetings → 2-3 strings, each 120-280 tokens. Same voice, genuinely DIFFERENT scene — different place, mood, stakes or era. Never a rephrase of first_mes.
  mes_example → 320-550 words of <START> blocks, 3-5 exchanges, formatted as:
      <START>
      {{user}}: ...
      {{char}}: ...
    Show voice and behaviour in different registers: casual, angry, tender, refusing, caught off guard, and seductive if the card is intimate. Voice, not plot. Some {{char}} replies should be short, one word, or silence — real people are not always eloquent.
  creator_notes → 150-300 words of direct instructions to the AI: tone, pacing, what to ALWAYS do, what to NEVER do (clichés to avoid), how to handle conflict and escalation, and the exact canon version if this is an existing character.
  system_prompt → "" unless the user asked for an instruction block.
  post_history_instructions → "" unless asked.
  character_version → "1.0".
  tags → 4-8 lowercase tags: genre, archetype, content descriptors.
  talkativeness → "0.5" (0.3 reserved, 0.7 gregarious — it must match the personality).
NO "character_book" and no lorebook in character mode.`;

/** World mode: narrator/world card (Schema 2) with an embedded lorebook. */
const SMITH_WORLD_MODE = `[MODE: WORLD CARD with embedded lorebook]
Output ONE JSON object, exactly these keys:
{"ch_name":"","description":"","personality":"","scenario":"","first_mes":"","mes_example":"","creator_notes":"","character_version":"1.0","tags":[],"talkativeness":"0.5","alternate_greetings":[],"character_book":{"name":"","description":"","scan_depth":4,"token_budget":2048,"recursive_scanning":true,"extensions":{},"entries":[]}}

CARD FIELDS
  description → the world primer, 1-2 paragraphs: place, era, what is happening, how power and danger work — plus the protagonist's appearance if there is one. NOTHING ELSE. No cast list, no location list, no history dump: those live in the lorebook.
  personality → TONE ONLY — genre, emotional temperature, themes. "gothic dread; human cost over spectacle; nothing is ever cleanly won." NEVER character traits.
  first_mes → an atmospheric narrator hook: texture, not scenario. Never "you are in X".
  mes_example → 250-450 words of narrator/NPC exchanges showing the world's voice.
  creator_notes → how to run this world: large-cast handling, pacing, genre rules, what never happens here.
  scenario → "" (world cards have no scenario).

EMBEDDED LOREBOOK — entries MUST be a JSON ARRAY (never a keyed object), each with EXACTLY these fields:
  {"id":0,"keys":["Name","Name's","Titled Name"],"secondary_keys":[],"comment":"Name - Category","content":"...","constant":false,"selective":false,"insertion_order":100,"position":"after_char","enabled":true,"prevent_recursion":false,"extensions":{"uid":0,"addMemo":true,"useProbability":true}}
  - id and extensions.uid increment together from 0. There is no "uid" outside extensions and no other identifier.
  - NEVER use "key", "order", integer position, or "disable" — those are standalone-file field names and a card that mixes them imports with every entry silently dropped.
  - enabled is ALWAYS true (omitting it disables the entry on import).
  - selective is true ONLY when secondary_keys has values, otherwise false.
  - No two entries may share an insertion_order.
Write 8-20 entries across four layers:
  L1 WORLD RULES — constant:true, prevent_recursion:true, position:"before_char", insertion_order 900-999. Prefix each rule with "RULE:" and use absolute language (MUST, CANNOT, WILL INSTANTLY). Keep them small: they load every turn.
  L2 FACTION / CAST ANCHORS — constant:true, prevent_recursion:false, position:"before_char", insertion_order 700-899. One per faction, organisation, family or crew. Each MUST name every member plus at least one rival or ally by name, and say what they control and what they want. Naming members is what seeds recursion into the character entries. If the world has no factions, use role anchors: "The Protagonists", "The Antagonists", "The Supporting Cast".
  L3 CHARACTERS — constant:false, prevent_recursion:false, position:"after_char", insertion_order 150-599 (protagonist 600-699, majors 400-599, the rest 150-249). Full entry per named character: appearance (3-4 sentences), personality as prose, voice, behaviour under pressure and in intimacy, relationships (name the people), dress and carried items, secrets.
  L4 LOCATIONS / ITEMS / EVENTS / CONCEPTS — constant:false, position:"after_char", insertion_order 1-399 (locations 300-399, items 100-149, events 50-99, concepts 1-19). Locations MUST name the NPCs and items present — that is what makes the world chain open — and open with sensory detail (what you hear or smell before you see it). Items and events: prevent_recursion:true. Events: include "sticky": 5 for an active scene, 3 for a passing event, 15 for a permanent change.
  keys → 2-5 natural variants, always including possessives and titles: ["Kael","Kael's","Captain Kael"]. Never a bare generic word like "city" or "warrior".
Also keep recursive_scanning:true and scan_depth:4. Use token_budget 2048 for 8-20 entries, 4096 above that.`;

/** THE METHOD — the builder's pre-generation workflow, walked one turn at a
 *  time. The agent declares its stage in JSON so the extension can render and
 *  gate the right action for each step. */
const SMITH_WORKFLOW = `[THE METHOD — work through the builder's steps ACROSS TURNS. You output exactly ONE JSON object per turn, and it MUST declare where you are with "stage".]
This is a conversation, not a one-shot generator. An idea is not a card.

  STEP 1-3 — stage "inventory" (first turn, and for as long as gaps remain)
    Identify the source, compile what is known, and present a structured inventory that makes the GAPS visible as questions. NEVER write the card on this turn.
    Format:
    {"stage":"inventory","source":"existing property: <name> (<era/version>) — or — original creation","inventory":"📋 INVENTORY — <name>\n\n▶ SOURCE ...\n\n✓ IDENTITY ...\n✓ APPEARANCE ...\n✓ VOICE ...\n⚠ GAPS — needs your call","questions":["Sharp, specific question?","Next question?"]}
    - EXISTING PROPERTY: draw the inventory from your canon knowledge. Mark anything you are unsure of "⚠ UNVERIFIED" instead of guessing, and ask which version/era is wanted.
    - ORIGINAL CREATION: the user is the ONLY source of truth. List what they actually gave you under ✓, and put everything else under ⚠ GAPS as a question. NEVER invent facts, and never present your own inventions as settled — a name you made up is a gap, not a fact.
    - The inventory is for ONE character in character mode; in world mode cover the cast, factions, locations, items, timeline and rules as separate ✓ groups.
    - The user may answer over several messages: each time, re-present the UPDATED inventory with the gaps that are still open, and ask again. Do not fill in the leftovers yourself.

  STEP 4-5 — stage "ready" (the answers have closed every gap that matters)
    Present the FINAL, gap-free inventory, state that nothing is left unverified, and ask: "Ready to generate?" Set the label so the user can just tap it.
    Format: {"stage":"ready","inventory":"📋 INVENTORY — <name> ...✓ everything settled","questions":[],"applyLabel":"✅ Build the card"}
    You STILL may not write the card on this turn.

  STEP 6 — stage "card" (only after the user confirms: yes / go / build / generate / "looks good")
    Output the complete card exactly as the mode section above specifies.
    Format: {"stage":"card","card":{ ... }}

HARD RULES
- Never skip from the first idea to a card unless the user explicitly said "skip", "direct", "just build it", "no questions" or "quick" — those mean: go straight to stage "card", filling gaps with reasonable, consistent inference and noting nothing further.
- Never write the card while the user has not confirmed the inventory. A short, generic card produced early is a failure, not efficiency.
- Never ask the user for something you can decide yourself (a minor relative's name, a street name, an outfit detail) — those are gaps you resolve with inference and then show in the inventory.
- Do ask about anything that would change the card: who they are, what they want vs need, the wound, their voice, how {{user}} fits, the era/version for canon, and (world mode) the era, power structure, central conflict and tone.
- If the user contradicts or corrects the inventory, update it and mark the correction as user-specified.
- If the user asks for a change to a card you already built in this conversation, that is stage "card" again with the COMPLETE revised card — never a diff.
- Keep "inventory" readable prose-with-labels, not JSON-in-a-string noise: short labelled lines, ✓ for settled, ⚠ for open.`;

const SMITH_DIRECT = `[DIRECT MODE — the user asked to skip the walkthrough]
This turn, do NOT present an inventory and do NOT ask questions. Output {"stage":"card","card":{ ... }} immediately, using the mode spec above in full. Fill every unspecified detail with specific, internally consistent inference and state in creator_notes what you had to infer.`;

const SMITH_FULL_DETAIL = 'FULL DETAIL REQUESTED: the lengths above become floors with no ceiling. Description may run 3-5 paragraphs, mes_example 5-8 exchanges, greetings 3 long scenes, creator_notes comprehensive. Write until the material is genuinely exhausted.';

const SMITH_TOPUP_SYSTEM = SMITH_RULES + `

[MODE: FIELD TOP-UP]
A card was drafted and some fields came back too thin for play. You are rewriting ONLY the named fields — longer, denser and more specific — while preserving everything already established: the name, every fact, and the exact voice.
Rules:
- Do not contradict or replace established facts; deepen them (add history, habits, physical tells, named relationships, concrete objects, sensory detail).
- Keep the same character voice and register in first_mes / alternate_greetings / mes_example.
- Never pad with restatement, atmosphere without information, or synonyms of what is already there.
- Output ONLY a JSON object containing the requested keys and nothing else.`;

/** Word/char floors used to decide whether a field needs a top-up pass. */
const SMITH_THIN = {
    description: 1100,
    personality: 240,
    first_mes: 520,
    mes_example: 950,
    creator_notes: 520,
};

function smithThinFields(card) {
    const out = [];
    for (const [field, minChars] of Object.entries(SMITH_THIN)) {
        if (String(card?.[field] || '').trim().length < minChars) out.push(field);
    }
    const greetings = Array.isArray(card?.alternate_greetings) ? card.alternate_greetings.filter(g => String(g || '').trim()) : [];
    if (greetings.length < 2) out.push('alternate_greetings');
    return out;
}

function smithWordCount(text) {
    const s = String(text || '').trim();
    return s ? s.split(/\s+/).length : 0;
}

/** Split an input line into a mode + the idea itself. */
function parseSmithMode(input) {
    const raw = String(input || '').trim();
    let m = raw.match(/^(?:world|worldbuild|worldbook|lorebook|setting)\s*[:\-]\s*([\s\S]*)$/i);
    if (m) return { mode: 'world', idea: m[1].trim(), explicit: true };
    m = raw.match(/^(?:character|char|card)\s*[:\-]\s*([\s\S]*)$/i);
    if (m) return { mode: 'character', idea: m[1].trim(), explicit: true };
    return { mode: 'character', idea: raw, explicit: false };
}

function formatSmithTurns(turns) {
    return turns.map((t, i) => `Q${i + 1}: ${t.q}\nA${i + 1}: ${t.a}`).join('\n');
}

/** Where the last buildPrompt expected the model to be — parseOutput uses it to
 *  catch a model that jumps straight to a card. */
let smithExpected = null;

/** Verbs/phrases that mean "change the card you just built" rather than "here
 *  is a new character". Bias matters: mistaking an idea for a revision is the
 *  bug that made the walkthrough unreachable, so only clear change-intent
 *  counts as a revision. */
const SMITH_REVISION_RE = /\b(?:change|revise|edited?|rework|rewrite|expand|deepen|flesh out|shorten|trim|tweak|adjust|swap|replace|rename|add|remove|drop|delete|instead|another (?:version|greeting|scene|pass|opening)|try again|regenerate|do it again|make (?:her|him|them|it|this|the)\b|should (?:be|have|not)\b|needs? (?:a|an|to|more|less)\b|less (?:vague|short|detail)|more (?:detail|dialogue|depth|backstory)|colder|warmer|darker|softer|meaner|nicer|funnier|harsher|kinder|older|younger|taller|shorter|do not|don't)\b/i;

function smithLooksLikeRevision(text) {
    return SMITH_REVISION_RE.test(String(text || ''));
}

/** Does this message read like a NEW brief rather than a change to the last card?
 *  Order matters: talking about the existing character, or clear change-intent,
 *  counts as a revision no matter how long the message is. */
function smithLooksLikeNewIdea(body, explicit = false, card = null, raw = '') {
    const s = String(body || '').trim();
    if (!s) return true;                              // empty box = "build from the recent scene"
    if (smithRefersToCard(card, raw || s)) return false;   // asking ABOUT the built character
    if (smithLooksLikeRevision(s)) return false;      // change-intent always wins
    if (explicit) return true;                        // "world: …" / "character: …" is a new brief
    if (/^(?:a|an|the|my|our|his|her|their)\s+\S+/i.test(s) && smithWordCount(s) >= 4) return true;
    return smithWordCount(s) >= 8;                    // a long message with no change-intent is a brief
}

function smithRefersToCard(card, text) {
    const name = String(card?.ch_name || '').trim().toLowerCase();
    if (!name) return false;
    const first = name.split(/[\s'’]+/)[0];
    if (first.length < 3) return false;
    return String(text || '').toLowerCase().includes(first);
}

/** Shared shape for steps 1-5 results (inventory / ready). */
function smithInventoryResult(json, extra = {}) {
    const questions = Array.isArray(json?.questions) ? json.questions.map(q => String(q).trim()).filter(Boolean) : [];
    const inventory = String(json?.inventory ?? json?.text ?? '').trim();
    return {
        stage: String(json?.stage || '').toLowerCase() === 'ready' ? 'ready' : 'inventory',
        inventory,
        questions,
        source: String(json?.source || '').trim(),
        applyLabel: typeof json?.applyLabel === 'string' && json.applyLabel.trim() ? json.applyLabel.trim() : undefined,
        text: [inventory, ...questions.map((q, i) => `${i + 1}. ${q}`)].filter(Boolean).join('\n\n'),
        ...extra,
    };
}

/** Force a model's lorebook entries into the exact embedded shape ST expects.
 *  Guards the "card imports but every entry is silently dropped" failure. */
function normalizeSmithBook(book) {
    const entries = Array.isArray(book?.entries) ? book.entries : [];
    const out = {
        name: String(book?.name || 'Embedded Lorebook'),
        description: String(book?.description || ''),
        scan_depth: Number(book?.scan_depth) || 4,
        token_budget: Number(book?.token_budget) || 2048,
        recursive_scanning: true,
        extensions: {},
        entries: [],
    };
    entries.forEach((raw, index) => {
        if (!raw || typeof raw !== 'object') return;
        const keys = (Array.isArray(raw.keys) ? raw.keys : Array.isArray(raw.key) ? raw.key : [raw.key])
            .map(k => String(k ?? '').trim()).filter(Boolean);
        const content = String(raw.content || '').trim();
        if (!keys.length || !content) return;
        const secondary = (Array.isArray(raw.secondary_keys) ? raw.secondary_keys
            : Array.isArray(raw.keysecondary) ? raw.keysecondary
                : Array.isArray(raw.secondary) ? raw.secondary : [])
            .map(k => String(k ?? '').trim()).filter(Boolean);
        const position = raw.position === 'before_char' || raw.position === 0 ? 'before_char' : 'after_char';
        const order = Number.isFinite(Number(raw.insertion_order)) ? Number(raw.insertion_order)
            : Number.isFinite(Number(raw.order)) ? Number(raw.order) : 100;
        out.entries.push({
            id: index,
            keys,
            secondary_keys: secondary,
            comment: String(raw.comment || `${keys[0]} - ${raw.constant ? 'World' : 'Entry'}`),
            content,
            constant: !!raw.constant,
            selective: secondary.length > 0,
            insertion_order: order,
            position,
            enabled: raw.enabled === false ? true : true,
            prevent_recursion: !!(raw.prevent_recursion ?? raw.preventRecursion),
            extensions: {
                uid: index,
                addMemo: true,
                useProbability: true,
                ...(Number.isFinite(Number(raw.sticky)) && Number(raw.sticky) > 0 ? { sticky: Number(raw.sticky) } : {}),
            },
        });
    });
    return out;
}

registerAgent({
    id: 'character-smith',
    name: 'Character Smith',
    icon: '🛠️',
    tagline: 'Walks the builder method: inventory → your call → rich card',
    category: 'writer',
    phase: 'manual',
    // Output budget is a setting: a builder-grade card needs 3-6k tokens, and
    // the old hardcoded 3000 was part of why cards came back thin.
    get maxTokens() {
        return Math.min(16000, Math.max(1500, Number(settings()?.smithMaxTokens) || 7000));
    },
    needsInput: true,
    conversational: true,
    inputPlaceholder: 'Give the idea — e.g. "a sarcastic tavern keeper who secretly runs the city guild". Character Smith then walks the builder method with you. Prefix "world:" for a world card, "direct:" to skip the walkthrough.',
    followupPlaceholder: 'Answer the open decisions — or say "yes" to build · after the card: "expand her backstory", "make him colder"…',
    // The action button changes meaning per stage: save the card, continue the
    // walkthrough, or explain what to do next.
    applyLabel: (result) => {
        if (result?.card) return 'Save character';
        if (result?.stage === 'ready') return String(result?.applyLabel || '✅ Build the card');
        return 'Answer below ↓';
    },

    buildPrompt(ctx, input, rt) {
        const raw = String(input || '').trim();
        // Escape hatches out of the walkthrough ("skip", "direct: …", "just build it").
        const directPrefix = raw.replace(/^(?:direct|quick|skip|no questions|just build(?: it)?|straight to)\s*[:\-]?\s*/i, '');
        const forceDirect = directPrefix !== raw;
        // "new: …" / "another: …" explicitly starts a fresh build.
        const newPrefix = raw.replace(/^(?:new|another|fresh)\b\s*[:\-]?\s*/i, '');
        const wantsNew = newPrefix !== raw;
        const body = forceDirect ? directPrefix : (wantsNew ? newPrefix : raw);
        const { mode: detected, idea, explicit } = parseSmithMode(body);
        let entry = getSmithEntry(ctx);

        // "start over" / "new idea" wipes the thread and restarts at Step 1.
        if (wantsNew || /^(?:start over|start again|new character|new card|reset|restart|forget (?:this|it))\b/i.test(raw)) {
            clearSmithThread(ctx);
            entry = getSmithEntry(ctx);
        }

        // The questions the agent asked last turn become this turn's answers.
        if (entry.pendingQuestions && raw && !forceDirect) {
            rememberSmithTurn(ctx, entry.pendingQuestions, raw);
            entry = getSmithEntry(ctx);
        }

        const confirmed = /^(?:yes|y|yep|yeah|yup|sure|ok|okay|go|go ahead|generate|build|build it|do it|looks good|good|ready|proceed|confirm|confirmed)\b/i.test(raw);

        // ⚠ A stored card must not swallow every later message. Previously ANY
        // non-affirmative turn with a card in the thread became a "revise this"
        // prompt, so a second idea could never reach the inventory and the
        // walkthrough looked broken. Only clear change-intent (or naming the
        // existing character) is a revision; anything else starts a fresh build.
        let priorCard = entry.card;
        const revisionTurn = !!priorCard && !forceDirect && !confirmed
            && !smithLooksLikeNewIdea(body, explicit, priorCard, raw);
        if (priorCard && !forceDirect && !confirmed && !revisionTurn) {
            clearSmithThread(ctx);
            entry = getSmithEntry(ctx);
            priorCard = null;
            if (raw) toastr.info('New idea — starting a fresh walkthrough (the previous draft was set aside).');
        }

        const hasThread = entry.turns.length > 0;
        const mode = explicit ? detected : (priorCard?.character_book ? 'world' : detected);

        let systemPrompt = SMITH_RULES + '\n\n' + SMITH_WORKFLOW + '\n\n';
        systemPrompt += mode === 'world' ? SMITH_WORLD_MODE : SMITH_CHARACTER_MODE;
        if (forceDirect) systemPrompt += '\n\n' + SMITH_DIRECT;

        // Say out loud which step of the method this turn is — deterministic
        // hints beat hoping the model remembers where it is.
        const lines = [];
        if (forceDirect) {
            lines.push(`DIRECT BUILD. The user asked to skip the walkthrough. Idea: ${idea || '(use the recent scene)'}`);
        } else if (revisionTurn) {
            lines.push('REVISION REQUEST (stage "card"). Here is the card you built earlier in this conversation, compacted:',
                JSON.stringify(priorCard),
                'Change ONLY what this turn asks for — keep every other established fact, name and voice exactly. Output the COMPLETE card again, every field in full. Never a diff or a partial card.');
            if (raw) lines.push(`This turn's instruction: ${raw}`);
        } else if (priorCard && confirmed) {
            lines.push('The user confirmed. Output stage "card" now — the complete card, revised from the earlier build rather than restarted:',
                JSON.stringify(priorCard));
        } else if (!hasThread) {
            lines.push(`STEP 1-3 (first turn of this build). The user's idea: ${idea || '(no idea given — derive it from the recent scene)'}`,
                'Present the inventory for this idea NOW, with every decision you cannot settle yourself listed as a question in "questions". Do NOT output a card on this turn.');
        } else {
            lines.push(`STEP 3-5. Earlier in this conversation you presented this inventory:\n${entry.inventory || '(inventory text not retained — re-present it from the answers below)'}`,
                'The user has just replied. Re-present the UPDATED inventory, keeping only the gaps that are genuinely still open.',
                confirmed
                    ? 'The user CONFIRMED: if no material gap remains, output stage "card" now. If a decision that would change the card is genuinely still missing, ask about it instead (stage "inventory") rather than guessing.'
                    : 'Still gathering: output stage "inventory" with the remaining gaps as questions, or stage "ready" plus "Ready to generate?" if nothing important is left open. Do NOT output the card on this turn.');
        }
        if (entry.turns.length && !forceDirect) {
            lines.push(`Answers already given in this conversation (treat as facts — never contradict them, never ask again):\n${formatSmithTurns(entry.turns)}`);
        }
        if (/full detail|insane detail|max detail|maximum detail/i.test(raw)) lines.push(SMITH_FULL_DETAIL);
        const recentChat = getChatSnapshot(ctx, settings().maxContextMessages);
        if (recentChat) {
            lines.push(`Recent scene from the open chat — match its voice and tone, but do NOT import its events as facts about this card:\n${recentChat}`);
        }
        lines.push('Output ONLY ONE JSON object with a "stage" key. No markdown, no code fences, no commentary.');

        const prompt = expandMacros(lines.join('\n\n'), ctx, { input: raw, recentChat });
        // parseOutput reads this to catch a model that skips straight to a card.
        smithExpected = {
            stage: (forceDirect || revisionTurn || (priorCard && confirmed)) ? 'card' : 'inventory',
            systemPrompt,
            prompt,
        };
        return { systemPrompt, prompt };
    },

    async parseOutput(raw, rt) {
        const json = extractJson(raw);
        const stage = String(json?.stage || '').toLowerCase();
        const hasCard = !!(json && typeof json === 'object' && (json.card || json.ch_name || json.data));
        const questions = Array.isArray(json?.questions) ? json.questions.map(q => String(q).trim()).filter(Boolean) : [];

        if (!hasCard) {
            // Steps 1-5 (inventory / ready) — or prose we could not structure.
            // Never throw here: the conversation must survive a sloppy turn,
            // and the prose itself is exactly what the user needs to read.
            const inventory = String(json?.inventory ?? json?.text ?? '').trim();
            // NOTE: `!questions` is false for an EMPTY array (JS truthiness) —
            // check .length, or the raw-prose fallback returns an empty panel.
            if (!inventory && !questions.length) {
                return { stage: 'inventory', inventory: String(raw || '').trim(), questions: [], source: '', unparsed: true, text: raw };
            }
            return smithInventoryResult(json);
        }

        // The method says steps 1-5 run first. If the model jumped straight to a
        // card while an inventory was expected, pull it back with ONE corrective
        // call; if it still insists, keep the card and say so in the panel.
        if (smithExpected?.stage === 'inventory' && typeof rt?.callModel === 'function') {
            try {
                const retryRaw = await rt.callModel({
                    systemPrompt: smithExpected.systemPrompt,
                    prompt: `${smithExpected.prompt}\n\n⚠ You skipped the method: you returned a card before the inventory was verified. Do it properly now — output ONE JSON object with "stage":"inventory" (or "ready" if nothing material is open) and the open decisions as "questions". No card on this turn.`,
                    maxTokens: 3000,
                });
                const retry = extractJson(retryRaw);
                if (retry && !retry.card && !retry.ch_name && (retry.inventory || retry.questions?.length)) {
                    return smithInventoryResult(retry, { corrected: true });
                }
            } catch (err) {
                console.warn('[fork-agents] character smith walkthrough correction failed', err);
            }
        }

        const card = json.card || json;
        if (typeof card !== 'object' || Array.isArray(card)) {
            throw new Error('Model did not return a character card object.');
        }
        if (!card.ch_name && card.name) card.ch_name = card.name;
        if (!String(card.ch_name || '').trim()) {
            throw new Error('Model did not return a character card with a name.');
        }
        for (const field of ['description', 'personality', 'scenario', 'first_mes', 'mes_example', 'creator_notes', 'system_prompt', 'post_history_instructions']) {
            card[field] = String(card[field] ?? '').trim();
        }
        if (!Array.isArray(card.tags)) card.tags = card.tags ? [String(card.tags)] : [];
        if (!Array.isArray(card.alternate_greetings)) {
            card.alternate_greetings = card.alternate_greetings ? [String(card.alternate_greetings)] : [];
        }

        // Top-up pass: any field that came back under the floor gets rewritten
        // longer in one extra call, then merged back only if it really grew.
        const thin = smithThinFields(card);
        let toppedUp = [];
        if (thin.length && typeof rt?.callModel === 'function') {
            try {
                const patchRaw = await rt.callModel({
                    systemPrompt: SMITH_TOPUP_SYSTEM,
                    prompt: [
                        `Card so far (JSON):\n${JSON.stringify(compactCard(card))}`,
                        `These fields are too thin and must be rewritten longer, denser and more specific: ${thin.join(', ')}`,
                        thin.includes('alternate_greetings')
                            ? 'For alternate_greetings output 3 strings, each a complete in-scene opener of 120-280 tokens, all different scenes.'
                            : '',
                        'Output ONLY a JSON object with those keys and nothing else.',
                    ].filter(Boolean).join('\n\n'),
                    maxTokens: 3000,
                });
                const patch = extractJson(patchRaw);
                const fixed = patch?.card || patch;
                if (fixed && typeof fixed === 'object') {
                    for (const field of thin) {
                        if (field === 'alternate_greetings') {
                            const list = (Array.isArray(fixed.alternate_greetings) ? fixed.alternate_greetings : [])
                                .map(g => String(g || '').trim()).filter(Boolean);
                            if (list.length >= 2) { card.alternate_greetings = list; toppedUp.push(field); }
                            continue;
                        }
                        const next = String(fixed[field] ?? '').trim();
                        if (next.length > String(card[field] || '').length) { card[field] = next; toppedUp.push(field); }
                    }
                }
            } catch (err) {
                console.warn('[fork-agents] character smith top-up pass failed (keeping the drafted card)', err);
            }
        }
        if (Array.isArray(card?.character_book?.entries) && card.character_book.entries.length) {
            card.character_book = normalizeSmithBook(card.character_book);
            if (!card.character_book.entries.length) delete card.character_book;
        }
        return { stage: 'card', card, thin: smithThinFields(card), toppedUp, methodSkipped: smithExpected?.stage === 'inventory' };
    },

    onResult(ctx, input, result) {
        if (!result) return;
        if (result.stage === 'card' || result.card) {
            setSmithStage(ctx, 'card', '');
            rememberSmithTurn(ctx, input, `card: ${result.card.ch_name} (${smithWordCount(result.card.description)} word description)`);
            rememberSmithCard(ctx, result.card);
            return;
        }
        // Steps 1-5: keep the inventory + the open questions so the next turn
        // can pick the method back up where it left off.
        setSmithStage(ctx, result.stage || 'inventory', result.inventory || '');
        const entry = getSmithEntry(ctx);
        entry.pendingQuestions = (result.questions || []).join('\n');
        setSmithEntry(ctx, entry);
    },

    renderResult(result) {
        const warn = 'style="color:#e0a44a"';
        if (!result?.card) {
            // Inventory (steps 1-3) or final read-back (steps 4-5) — no card yet.
            const ready = result?.stage === 'ready';
            const questions = result?.questions || [];
            const inventory = String(result?.inventory || '').trim();
            return `
            <div class="fa-card-preview">
                <div class="fa-card-name">${ready ? '📋 Inventory — ready to generate' : '📋 Inventory — steps 1-3 of the builder method'}</div>
                ${result?.source ? `<div class="fa-card-row"><b>Source:</b> ${escapeHtml(result.source)}</div>` : ''}
                ${result?.unparsed ? `<div class="fa-card-row" ${warn}><b>⚠ Couldn't parse structured output</b> — showing the raw text; reply with your corrections and the walkthrough continues.</div>` : ''}
                ${result?.corrected ? `<div class="fa-card-row" ${warn}><b>⚠ The model tried to skip the walkthrough</b> and went straight to a card — it was pulled back to the inventory. Reply <b>direct:</b> any time to build immediately instead.</div>` : ''}
                <details class="fa-card-block" open><summary>Inventory — tap to collapse</summary><div class="fa-entry-content">${escapeHtml(inventory).replace(/\n/g, '<br>')}</div></details>
                ${questions.length ? `<div class="fa-card-row"><b>${questions.length} open decision${questions.length === 1 ? '' : 's'} — answer in the <b>Ask</b> box below</b> (one per line is fine, partial answers are fine, keep going until they're all settled):</div>
                <ol class="fa-qlist">${questions.map(q => `<li>${escapeHtml(q)}</li>`).join('')}</ol>` : ''}
                <div class="fa-card-row">${ready
                    ? 'Nothing material is left open. Reply <b>yes</b> (or tap the button) and the full card gets written — with every field above its floor.'
                    : 'Character Smith will <b>not</b> write the card until you confirm the inventory — that is what stops it coming back short and vague. Impatient? Reply <b>skip</b> to build straight from what it has.'}</div>
            </div>`;
        }
        const c = result.card;
        const chip = (v) => v ? `<span class="fa-chip">${escapeHtml(v)}</span>` : '';
        const stat = (label, text, floor) => {
            const words = smithWordCount(text);
            const short = floor !== undefined && String(text || '').trim().length < floor;
            const count = `${words} words / ${String(text || '').length} chars`;
            return `<div class="fa-card-row"><b>${label}</b> <span class="fa-count" ${short ? warn : ''}>${short ? '⚠ ' : ''}${count}</span></div>`;
        };
        const greetings = (c.alternate_greetings || []).filter(g => String(g || '').trim());
        const book = c?.character_book?.entries || [];
        const thinLeft = result.thin?.length
            ? `<div class="fa-card-row" ${warn}><b>Still thin:</b> ${escapeHtml(result.thin.join(', '))} — ask a follow-up to expand them (e.g. "expand the description and example dialogue").</div>`
            : '<div class="fa-card-row"><b>Detail check:</b> every field above its floor ✓</div>';
        const block = (label, text) => String(text || '').trim()
            ? `<details class="fa-card-block"><summary>${label}</summary><div class="fa-entry-content">${escapeHtml(String(text)).replace(/\n/g, '<br>')}</div></details>`
            : '';
        return `
            <div class="fa-card-preview">
                <div class="fa-card-name">${escapeHtml(c.ch_name || 'Unnamed')}${book.length ? ` <span class="fa-chip">world card · ${book.length} lorebook entries</span>` : ''}</div>
                ${stat('Description', c.description, SMITH_THIN.description)}
                ${stat('Personality', c.personality, SMITH_THIN.personality)}
                ${stat('First message', c.first_mes, SMITH_THIN.first_mes)}
                ${stat('Example dialogue', c.mes_example, SMITH_THIN.mes_example)}
                ${stat('Creator notes', c.creator_notes, SMITH_THIN.creator_notes)}
                <div class="fa-card-row"><b>Alternate greetings:</b> ${greetings.length ? chip(greetings.length + ' scenes') : '<span style="color:#e0a44a">⚠ none</span>'}</div>
                ${c.scenario ? stat('Scenario', c.scenario) : '<div class="fa-card-row"><b>Scenario:</b> <i>empty (not requested)</i></div>'}
                <div class="fa-card-row"><b>Tags:</b> ${(c.tags || []).map(t => chip(t)).join('') || '—'}</div>
                ${result.toppedUp?.length ? `<div class="fa-card-row"><b>Top-up pass:</b> rewrote ${escapeHtml(result.toppedUp.join(', '))}</div>` : ''}
                ${thinLeft}
                ${result?.methodSkipped ? `<div class="fa-card-row" ${warn}><b>⚠ Built without the walkthrough</b> — the model ignored the inventory step (twice). Save it as-is, or reply <b>start over</b> to run the method properly.</div>` : ''}
                <div class="fa-card-row"><b>Next:</b> reply with a change to revise this card · <b>new: &lt;idea&gt;</b> for a fresh walkthrough · <b>Save character</b> to keep it.</div>
                ${book.length ? `<div class="fa-card-row"><b>Lorebook layers:</b> ${book.filter(e => e.constant).length} always-on · ${book.filter(e => !e.constant).length} keyword-triggered</div>` : ''}
                ${block('Full description', c.description)}
                ${block('First message', c.first_mes)}
                ${block('Example dialogue', c.mes_example)}
                ${greetings.length ? block(`Alternate greetings (${greetings.length})`, greetings.map((g, i) => `— ${i + 1} —\n${g}`).join('\n\n')) : ''}
                ${block('Creator notes', c.creator_notes)}
                ${book.length ? block('Lorebook entry keys', book.map((e, i) => `${i + 1}. ${(e.keys || []).join(' / ')}${e.constant ? ' [always on]' : ''} — ${e.comment}`).join('\n')) : ''}
            </div>`;
    },

    async apply(result, ctx) {
        const card = result?.card;
        if (!card) {
            // Steps 1-5: the action button means "continue the walkthrough".
            if (result?.stage === 'ready') {
                toastr.info('Building the card from the verified inventory…');
                runAgent(agents.get('character-smith'), 'yes — build the card', { skipInput: true });
                return true;
            }
            toastr.info('Not yet — answer the numbered decisions in the Ask box below (partial answers and "skip" both work).');
            return false;
        }
        const name = String(card.ch_name || '').trim();
        if (!name) { toastr.warning('Card has no name.'); return false; }

        const body = {
            ch_name: name,
            description: String(card.description || ''),
            first_mes: String(card.first_mes || ''),
            personality: String(card.personality || ''),
            scenario: String(card.scenario || ''),
            mes_example: String(card.mes_example || ''),
            creator_notes: String(card.creator_notes || ''),
            system_prompt: String(card.system_prompt || ''),
            post_history_instructions: String(card.post_history_instructions || ''),
            creator: 'Fork Agent (Character Smith)',
            character_version: String(card.character_version || '1.0'),
            tags: Array.isArray(card.tags) ? card.tags.map(t => String(t).toLowerCase()).filter(Boolean) : [],
            talkativeness: String(card.talkativeness ?? '0.5'),
            world: '',
            depth_prompt_prompt: String(card.depth_prompt_prompt || ''),
            depth_prompt_depth: String(card.depth_prompt_depth ?? '4'),
            depth_prompt_role: String(card.depth_prompt_role || 'system'),
            fav: 'false',
            alternate_greetings: Array.isArray(card.alternate_greetings) ? card.alternate_greetings.map(String).filter(Boolean) : [],
            extensions: '{}',
        };

        // An embedded lorebook travels inside json_data: createCharacter keeps
        // unknown json_data keys, and ST's own "Import Card Lore" flow turns
        // character_book into a linked world-info file. (Verified against
        // charaFormatData + convertCharacterBook in the fork's src/.)
        const book = card?.character_book?.entries?.length ? card.character_book : null;
        if (book) body.json_data = JSON.stringify({ data: { character_book: book } });

        try {
            const response = await fetch('/api/characters/create', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify(body),
            });
            if (!response.ok) {
                const text = await response.text().catch(() => '');
                toastr.error(`Character create failed (${response.status}). ${text.slice(0, 200)}`);
                return false;
            }
            await response.json().catch(() => ({}));
            toastr.success(`Created "${name}" — find it in your character list.`);
            if (book) {
                toastr.info(`"${name}" carries ${book.entries.length} embedded lorebook entries. Open a chat with it and accept "import the embedded World/Lorebook", or use More… → Import Card Lore.`, 'Lorebook attached', { timeOut: 12000 });
            }
            return true;
        } catch (err) {
            console.error('[fork-agents] character create failed', err);
            toastr.error(`Character create failed: ${err?.message || err}`);
            return false;
        }
    },
});

// Story Advisor — conversational planning partner grounded in the open chat.
// Reads the recent scene, remembers this session's Q&A per chat, and answers
// planning / premise / character questions with evidence from canon.

// Conversation memory: keyed by the open chat (character or group) so each
// chat gets its own thread; capped at the last 5 exchanges. Persisted to
// localStorage (survives reloads, still per-chat); falls back to in-page
// memory only if storage is unavailable (private mode, quota).
const ADVISOR_MEMORY_KEY = 'fork-agents:advisorMemory';
const ADVISOR_MAX_TURNS = 5;
const ADVISOR_MAX_CHATS = 20;

function loadAdvisorMemory() {
    try {
        const raw = localStorage.getItem(ADVISOR_MEMORY_KEY);
        if (!raw) return new Map();
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return new Map();
        const map = new Map();
        for (const [key, turns] of parsed) {
            if (typeof key !== 'string' || !Array.isArray(turns)) continue;
            map.set(key, turns
                .filter(t => t && typeof t.q === 'string' && typeof t.a === 'string')
                .slice(-ADVISOR_MAX_TURNS));
        }
        return map;
    } catch {
        return new Map();
    }
}

function saveAdvisorMemory(map) {
    try {
        const trimmed = [...map.entries()].slice(-ADVISOR_MAX_CHATS);
        localStorage.setItem(ADVISOR_MEMORY_KEY, JSON.stringify(trimmed));
    } catch {
        // storage unavailable — the thread stays in-page for this session
    }
}

let advisorMemory = loadAdvisorMemory();

function advisorChatKey(ctx) {
    const g = ctx?.groupId ?? (ctx?.characterId === undefined ? (ctx?.chatId ?? '') : '');
    if (g) return 'g:' + String(g);
    return 'c:' + String(ctx?.characterId ?? '?');
}

function getAdvisorMemory(ctx) {
    return advisorMemory.get(advisorChatKey(ctx)) || [];
}

function rememberAdvisorTurn(ctx, question, answer) {
    const key = advisorChatKey(ctx);
    const list = advisorMemory.get(key) || [];
    list.push({
        q: String(question || '').slice(0, 400),
        a: String(answer || '').slice(0, 700),
    });
    advisorMemory.set(key, list.slice(-ADVISOR_MAX_TURNS));
    saveAdvisorMemory(advisorMemory);
}

registerAgent({
    id: 'story-advisor',
    name: 'Story Advisor',
    icon: '🎭',
    tagline: 'Plan scenes, premises & actions with the current chat in mind',
    category: 'writer',
    phase: 'manual',
    maxTokens: 2500,
    needsInput: true,
    conversational: true,
    inputPlaceholder: 'Ask anything about this story — e.g. "Do you think {{char}} would like it if {{user}} got them a gift?"',

    async buildPrompt(ctx, input, rt) {
        const recentChat = getChatSnapshot(ctx, settings().maxContextMessages);
        const prior = getAdvisorMemory(ctx);
        const priorBlock = prior.length
            ? '\nEarlier in this conversation you already answered (the user may be following up — stay consistent with these):\n' +
              prior.map((m, i) => `Q${i + 1}: ${m.q}\nA${i + 1}: ${m.a}`).join('\n') + '\n'
            : '';

        const systemPrompt = `You are the Story Advisor, a seasoned writing partner for an interactive roleplay. The user is the author/player planning what happens next in their story with {{char}}. You see the recent scene of their open chat.

Ground EVERY answer in what is actually established in the scene — the characters' personalities, their relationship, the current situation, mood, and open tension. If something is NOT established, say it is speculation; never invent canon and pass it off as fact.

How to answer:
1. Direct verdict first: a clear take (e.g. "Yes — she'd love it, but timing matters: …").
2. Evidence: 2-4 concrete beats from the chat that support your take.
3. Options: 2-3 plausible directions with what each would likely trigger in the character (emotions, reactions, complications).
4. Recommendation: one suggested path — and if the user is planning their next message, suggest a concrete beat for it.

For premise/pacing/planning questions, think in dramatic beats: what the scene needs, what the character wants vs what they fear, how tension escalates, and a satisfying payoff. Prefer MACRO emotional beats (mood shifts, decisions, stakes) over micro physical tells — never advise "her eyes flickered"-style details.

Keep it tight: under 350 words, plain text, short paragraphs, simple "-" bullets. Address the user directly as the writer. Never speak as {{char}} — you advise about the story, you do not join it.`;

        const prompt = `Character: {{char}}\nUser: {{user}}\nRecent scene:\n{{recentChat}}\n${priorBlock}${input
            ? `Question: ${input}`
            : 'No question given — give a short read of where this scene stands and the single most promising next beat.'}`;

        return { systemPrompt, prompt: expandMacros(prompt, ctx, { input, recentChat }) };
    },

    parseOutput(raw) {
        const text = stripMeta(raw)
            .replace(/<plan>[\s\S]*?<\/plan>/gi, '')
            .trim();
        return text ? { text } : { text: String(raw || '').trim() };
    },

    renderResult(result) {
        const text = String(result.text || '');
        const paras = text.split(/\n{2,}/).map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
        return `<div class="fa-advisor">${paras || '<p><em>(empty reply)</em></p>'}</div>`;
    },

    onResult(ctx, input, result) {
        rememberAdvisorTurn(ctx, input, result.text);
    },
});

// Music DJ — fork-agents agent that reads the current scene's mood and picks a
// background track, Marinara-style. Registered from fork-agents' index.js.
//
// It talks to the fork-music extension over a small window-level bridge:
//   window.__forkMusic.getState()          → { source, moods, library: [{title, mood}] }
//   window.__forkMusic.play(query/us)      → plays, resolves true/false
//   window.__forkMusic.stop()              → stops
// The agent never imports the player directly so either extension can be
// disabled without breaking the other.

const MUSIC_DJ_ID = 'music-dj';

function musicBridge() {
    return (typeof window !== 'undefined' && window.__forkMusic) ? window.__forkMusic : null;
}

function musicState() {
    const bridge = musicBridge();
    if (!bridge || typeof bridge.getState !== 'function') {
        return { source: 'unknown', moods: [], library: [], current: null, available: false };
    }
    try {
        const state = bridge.getState() || {};
        return Object.assign({ source: 'local', moods: [], library: [], current: null, available: true }, state);
    } catch (error) {
        console.warn('[fork-agents] music state unavailable', error);
        return { source: 'unknown', moods: [], library: [], current: null, available: false };
    }
}

function extractMusicJson(raw) {
    // fork-agents' robust extractor is defined above these registrations.
    try {
        const parsed = extractJson(raw);
        if (parsed && typeof parsed === 'object') return parsed;
    } catch { /* fall through to the shape check below */ }
    return null;
}

registerAgent({
    id: MUSIC_DJ_ID,
    name: 'Music DJ',
    icon: '🎵',
    tagline: 'Reads the scene and plays matching background music',
    category: 'misc',
    phase: 'manual',
    maxTokens: 700,
    needsInput: true,
    conversational: true,
    inputPlaceholder: 'Optional vibe — e.g. "something tense and quiet", "a warm tavern song", "make it ominous"',
    applyLabel: 'Play this track',

    async buildPrompt(ctx, input, rt) {
        const recentChat = getChatSnapshot(ctx, 12);
        const state = musicState();
        const library = Array.isArray(state.library) ? state.library : [];
        const source = state.source || 'local';

        const libraryBlock = library.length
            ? library.slice(0, 80).map(track => `- "${track.title}"${track.mood ? ` (mood: ${track.mood})` : ''}`).join('\n')
            : '(the local library is empty)';
        const moodBlock = state.moods && state.moods.length ? state.moods.join(', ') : '(none tagged)';
        const currentBlock = state.current
            ? `${state.current.title}${state.current.mood ? ` (${state.current.mood})` : ''}`
            : 'nothing';

        const systemPrompt = `You are the Music DJ for an interactive roleplay. You read the most recent turns of the scene and choose ONE piece of background music that fits its current emotional register.

Judge the MOOD, not the literal events: tension, warmth, dread, romance, comedy, melancholy, triumph, calm, urgency. Prefer a track that supports the scene without fighting it — quiet for introspection, driving for action, sparse for grief.

You are choosing for the "${source}" source.
${source === 'local'
        ? 'Pick a title FROM THE LIBRARY LIST below, copied exactly. Do not invent titles.'
        : 'You may invent a specific, searchable song title + artist that fits.'}

Reply with ONLY this JSON object and nothing else:
{"title": "<track title>", "mood": "<one or two words>", "reason": "<max 18 words on why it fits the scene>", "stop": false}

Set "stop": true (and leave title empty) only when the scene has clearly ended or music would be intrusive — for example a silent, solemn moment or a scene break.`;

        const prompt = `Recent scene:\n${recentChat}\n\nNow playing: ${currentBlock}\nAvailable moods: ${moodBlock}\nLibrary:\n${libraryBlock}\n\n${input ? `Requested vibe: ${input}` : 'Pick the best fit for the current moment.'}`;

        return { systemPrompt, prompt: expandMacros(prompt, ctx, { input, recentChat }) };
    },

    parseOutput(raw) {
        const fallbackText = String(raw || '').trim();
        const data = extractMusicJson(raw);
        if (!data) {
            return { parseFailed: true, raw: fallbackText, stop: false, title: '', mood: '', reason: '' };
        }
        const title = String(data.title || data.track || data.song || '').trim();
        return {
            title,
            mood: String(data.mood || '').trim(),
            reason: String(data.reason || data.why || '').trim(),
            stop: data.stop === true || /^true$/i.test(String(data.stop || '')),
            raw: fallbackText,
            parseFailed: false,
        };
    },

    renderResult(result) {
        if (result.parseFailed) {
            return `<div class="fa-music-dj">
                <p><em>Could not parse the DJ's pick — raw output below.</em></p>
                <pre class="fa-pre">${escapeHtml(result.raw || '')}</pre>
            </div>`;
        }
        if (result.stop) {
            return `<div class="fa-music-dj">
                <div class="fa-music-title">⏹ No music for this moment</div>
                <div class="fa-music-reason">${escapeHtml(result.reason || 'The DJ judged music would not fit the scene.')}</div>
            </div>`;
        }
        return `<div class="fa-music-dj">
            <div class="fa-music-title">♪ ${escapeHtml(result.title || '(no title)')}</div>
            ${result.mood ? `<div class="fa-music-mood">mood: ${escapeHtml(result.mood)}</div>` : ''}
            <div class="fa-music-reason">${escapeHtml(result.reason || '')}</div>
        </div>`;
    },

    async apply(result, ctx) {
        // The player boots asynchronously — wait briefly for its ready signal
        // so an early DJ run doesn't report "extension disabled".
        if (window.__forkMusicReady) {
            await Promise.race([
                window.__forkMusicReady,
                new Promise((resolve) => setTimeout(resolve, 4000)),
            ]);
        }
        const bridge = musicBridge();
        if (!bridge) {
            if (typeof toastr !== 'undefined') toastr.warning('Enable the Fork Music extension to play tracks.');
            return false;
        }
        if (result.stop) {
            await bridge.stop();
            return true;
        }
        if (!result.title) {
            if (typeof toastr !== 'undefined') toastr.warning('The DJ did not name a track.');
            return false;
        }
        const ok = await bridge.play(result.title, result.mood);
        if (!ok && typeof toastr !== 'undefined') {
            toastr.warning(`No match for "${result.title}" in the library.`);
        }
        return !!ok;
    },
});

// --- Runtime helpers shared with agents ---------------------------------------

const runtime = {
    getLorebookTarget(ctx) {
        const fromSettings = String(settings().lorebookTarget || '').trim();
        if (fromSettings) return fromSettings;
        // ctx.character does NOT exist on the ST context — use the characters array.
        const card = ctx?.characters?.[ctx?.characterId]?.data;
        return String(card?.world || '').trim();
    },

    async getLorebookKeys(name) {
        const data = await loadWorldInfo(name);
        if (!data?.entries) return [];
        const keys = [];
        for (const entry of Object.values(data.entries)) {
            for (const k of (entry.key || [])) {
                if (typeof k === 'string' && k.trim()) keys.push(k.trim().toLowerCase());
            }
        }
        return keys.slice(0, 60);
    },
};

// --- Slash commands ------------------------------------------------------------

let slashRegistered = false;

function registerSlashCommands() {
    if (slashRegistered) return;
    slashRegistered = true;

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'agent',
        callback: agentCommandCallback,
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'name',
                description: 'Agent id or name: lorebook-keeper, character-smith, story-advisor',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: false,
                acceptsMultiple: false,
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'prompt',
                description: 'Optional input for the agent',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: false,
                acceptsMultiple: false,
            }),
        ],
        helpString: 'Run a fork helper agent. Examples: /agent name=lorebook-keeper prompt=the tavern | /agent character-smith "a pirate captain with a debt" | /agent story-advisor "Would {{char}} like a gift from {{user}}?"',
    }));
}

function agentCommandCallback(args, value) {
    let name = String(args?.name || '').trim();
    let prompt = String(args?.prompt || '').trim();

    // Positional form: /agent <agent-name> <rest-of-line-as-prompt>
    if (!name && value) {
        const v = String(value).trim();
        const space = v.search(/\s/);
        if (space === -1) {
            name = v;
        } else {
            name = v.slice(0, space).trim();
            prompt = v.slice(space + 1).trim();
        }
    }

    const agent = resolveAgent(name);
    if (!agent) {
        toastr.warning(`Agent "${name}" not found. Available: ${getAgents().map(a => a.id).join(', ')}`);
        return '';
    }
    runAgent(agent, prompt, { skipInput: true });
    return '';
}

// --- Settings UI ----------------------------------------------------------------

function camelToKebab(str) {
    return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function addSettings() {
    if (document.getElementById('fa-enabled-toggle')) return;

    const html = `
        <div class="fork-agents-settings">
            <label for="fa-enabled-toggle" class="checkbox_label">
                <input id="fa-enabled-toggle" type="checkbox" data-setting="enabled">
                <span>Enable Helper Agents (FAB launcher + /agent)</span>
            </label>
            <div class="fa-settings-row">
                <label for="fa-lorebook-input">Lorebook target (empty = character's world)</label>
                <input id="fa-lorebook-input" type="text" data-setting="lorebookTarget" placeholder="e.g. My World">
            </div>
            <div class="fa-settings-row">
                <label for="fa-context-input">Recent messages agents read</label>
                <input id="fa-context-input" type="number" min="5" max="200" step="1" data-setting="maxContextMessages">
            </div>
            <div class="fa-settings-row">
                <label for="fa-smith-tokens">Character Smith output budget (tokens)</label>
                <input id="fa-smith-tokens" type="number" min="1500" max="16000" step="500" data-setting="smithMaxTokens">
            </div>
            <button id="fa-open-launcher" class="menu_button">🧠 Open Helper Agents</button>
            <small>Fork Agents — v0.1.20 (Character Smith: guarded builder-method walkthrough)</small>
        </div>`;

    $('#extensions_settings').append(html);

    $('#fa-enabled-toggle').on('change', function () {
        extension_settings[extensionName].enabled = $(this).prop('checked');
        // Await the ACTUAL save before reloading — saveSettingsDebounced is
        // debounced, so reloading immediately loses the change (toggle reverts).
        saveSettings().then(() => location.reload());
    });

    // Instant-apply for the text/number inputs (runtime reads settings live).
    $('#fa-lorebook-input, #fa-context-input, #fa-smith-tokens').on('change', function () {
        const key = $(this).attr('data-setting');
        const num = Number($(this).val());
        const value = key === 'maxContextMessages' ? Math.max(5, Math.min(200, num || 30))
            : key === 'smithMaxTokens' ? Math.min(16000, Math.max(1500, num || 7000))
                : $(this).val();
        extension_settings[extensionName][key] = value;
        saveSettingsDebounced();
        toastr.success('Agent settings saved.');
    });

    // Delegated binding on document: survives re-renders of the settings panel
    // and works even if addSettings runs before this element exists.
    $(document).on('click', '#fa-open-launcher', openAgentsLauncher);

    // Reflect current settings on the inputs.
    $('#fa-enabled-toggle').prop('checked', !!extension_settings[extensionName].enabled);
    $('#fa-lorebook-input').val(extension_settings[extensionName].lorebookTarget || '');
    $('#fa-context-input').val(extension_settings[extensionName].maxContextMessages || 30);
    $('#fa-smith-tokens').val(extension_settings[extensionName].smithMaxTokens || 7000);
}

// --- Init -----------------------------------------------------------------------

jQuery(async () => {
    // Per-key default merge, ALWAYS — not just for brand-new installs. An
    // existing install has the settings object saved WITHOUT any key added
    // later, so a whole-object guard leaves it undefined and the feature
    // silently no-ops (the v0.2.25 fork-mobile lesson).
    extension_settings[extensionName] = { ...defaultSettings, ...extension_settings[extensionName] };
    saveSettingsDebounced();

    await ensureCss();
    buildLauncher();
    buildPanel();
    addSettings();
    registerSlashCommands();

    console.log('[fork-agents] active (v0.1.20)');
});

export function init() {
    jQuery(async () => {
        await ensureCss();
        buildLauncher();
        buildPanel();
        addSettings();
        registerSlashCommands();
        console.log('[fork-agents] re-init (v0.1.20)');
    });
}
