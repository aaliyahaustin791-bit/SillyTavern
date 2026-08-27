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

/** Robust JSON extraction: strip reasoning, fences, and prose around the JSON. */
function extractJson(text) {
    let s = String(text || '');
    s = s.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
    s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
    s = s.replace(/```json\s*|```/gi, '');
    s = s.replace(/^[^{[]*/, '');
    s = s.replace(/[^}\]]*$/, '');
    s = s.trim();
    if (!s) return null;
    try { return JSON.parse(s); } catch { return null; }
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
        const result = agent.parseOutput(raw);
        panel.showResult(agent, result, raw);
    } catch (err) {
        console.error('[fork-agents]', agent.id, err);
        panel.showError(agent, err, panel.lastRaw);
    }
}

// --- Launcher (agent picker bottom sheet) ------------------------------------

// Module-level open/close: the button in settings binds directly to these, and
// fork-mobile's FAB dispatches 'fork-launch-agents' which calls openAgentsLauncher.
function openAgentsLauncher() {
    if (!settings().enabled) {
        toastr.warning('Helper Agents are disabled in extension settings.');
        return;
    }
    $('#fa-launcher').removeClass('fa-hidden');
    $('#fa-backdrop').removeClass('fa-hidden');
    console.log('[fork-agents] launcher opened');
}

function closeAgentsLauncher() {
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
        const actions = [];
        if (agent.apply) actions.push({ id: 'apply', label: agent.applyLabel || 'Apply', primary: true });
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
        this.agent = null;
        this.result = null;
    },

    _show() {
        $('#fa-panel-header-title').text(this.agent?.icon ? `${this.agent.icon} ${this.agent.name}` : 'Helper Agent');
        $('#fa-panel').removeClass('fa-hidden');
        $('#fa-backdrop').removeClass('fa-hidden');
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
    if (result?.entries) return JSON.stringify(result.entries, null, 2);
    if (result?.card) return JSON.stringify(result.card, null, 2);
    if (result && typeof result === 'object') return JSON.stringify(result, null, 2);
    return raw || '';
}

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

// --- Agents -------------------------------------------------------------------

// Lorebook Keeper — propose world-info entries from the recent scene.
registerAgent({
    id: 'lorebook-keeper',
    name: 'Lorebook Keeper',
    icon: '📖',
    tagline: 'Propose world-info entries from the recent scene',
    category: 'writer',
    phase: 'manual',
    maxTokens: 2000,
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
- content: durable, specific, written from the facts in the chat — never invent new plot.
- constant: true ONLY for always-relevant setting facts (world name, magic rules, a character's core identity). Default false.
- selective: true when the entry should only show when its key matches.
- Do NOT duplicate the existing lorebook keys listed below — if the fact is already covered, leave it out.`;

        const prompt = `Character: {{char}}
User: {{user}}
${input ? `Focus: ${input}\n` : ''}${existing.length ? `Existing lorebook keys (do not duplicate these):\n${existing.join(', ')}\n` : ''}
Recent chat:
{{recentChat}}`;

        return { systemPrompt, prompt: expandMacros(prompt, ctx, { input, recentChat }) };
    },

    parseOutput(raw) {
        const json = extractJson(raw);
        if (!json || !Array.isArray(json.entries)) {
            throw new Error('Model did not return a JSON object with an "entries" array.');
        }
        const entries = json.entries
            .map(e => ({
                key: Array.isArray(e.key) ? e.key.map(k => String(k).trim()).filter(Boolean) : [String(e.key || '').trim()].filter(Boolean),
                content: String(e.content || '').trim(),
                comment: String(e.comment || '').trim(),
                constant: !!e.constant,
                selective: !!e.selective,
            }))
            .filter(e => e.key.length && e.content);
        if (!entries.length) throw new Error('Model returned no usable entries.');
        return { entries };
    },

    renderResult(result) {
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

// Character Smith — draft a full V2 character card from one line.
registerAgent({
    id: 'character-smith',
    name: 'Character Smith',
    icon: '🛠️',
    tagline: 'Draft a full V2 character card from one line',
    category: 'writer',
    phase: 'manual',
    maxTokens: 3000,
    needsInput: true,
    inputPlaceholder: 'e.g. "a sarcastic tavern keeper who secretly runs the city guild"',
    applyLabel: 'Save character',

    async buildPrompt(ctx, input) {
        const recentChat = getChatSnapshot(ctx, settings().maxContextMessages);

        const systemPrompt = `You are the Character Smith, a character card designer for SillyTavern (V2 spec).
Turn the user's idea into a complete, playable character card. Output ONLY valid JSON, no markdown, no commentary:
{
  "ch_name": "Name",
  "description": "Vivid 2nd-person description: appearance, mannerisms, background, current situation (2-4 sentences).",
  "personality": "Personality traits and speech style, one concise paragraph.",
  "scenario": "The scene or setting where this character meets {{user}}.",
  "first_mes": "The character's opening message: immersive, in-character, addresses {{user}} directly, 2-4 sentences of action and dialogue.",
  "mes_example": "Example dialogue in SillyTavern format: <START>\\n{{char}}: ...\\n{{user}}: ...\\n<START>\\n...",
  "system_prompt": "",
  "post_history_instructions": "",
  "creator_notes": "Brief author notes: inspiration, intended use.",
  "character_version": "1.0",
  "tags": ["genre", "theme", "trope"],
  "talkativeness": "0.5",
  "alternate_greetings": []
}
Rules: the JSON must be complete and valid; first_mes must hook the user immediately; personality must be distinct and consistent; do not reuse existing characters.`;

        const prompt = `Create a character from this idea: {{input}}
${recentChat ? `\nBase the voice and tone on this scene's style:\n{{recentChat}}` : ''}`;

        return { systemPrompt, prompt: expandMacros(prompt, ctx, { input, recentChat }) };
    },

    parseOutput(raw) {
        const json = extractJson(raw);
        const card = json?.card || json;
        if (!card || typeof card !== 'object' || !String(card.ch_name || '').trim()) {
            throw new Error('Model did not return a character card with a "ch_name".');
        }
        return { card };
    },

    renderResult(result) {
        const c = result.card;
        const chip = (v) => v ? `<span class="fa-chip">${escapeHtml(v)}</span>` : '';
        return `
            <div class="fa-card-preview">
                <div class="fa-card-name">${escapeHtml(c.ch_name || 'Unnamed')}</div>
                <div class="fa-card-row"><b>Description:</b> ${escapeHtml(c.description || '—')}</div>
                <div class="fa-card-row"><b>Personality:</b> ${escapeHtml(c.personality || '—')}</div>
                <div class="fa-card-row"><b>Scenario:</b> ${escapeHtml(c.scenario || '—')}</div>
                <div class="fa-card-row"><b>First message:</b> ${escapeHtml(c.first_mes || '—')}</div>
                <div class="fa-card-row"><b>Example dialogue:</b> ${escapeHtml(c.mes_example || '—')}</div>
                <div class="fa-card-row"><b>Tags:</b> ${(c.tags || []).map(t => chip(t)).join('') || '—'}</div>
            </div>`;
    },

    async apply(result, ctx) {
        const card = result.card;
        const name = String(card.ch_name || '').trim();
        if (!name) { toastr.warning('Card has no ch_name.'); return false; }

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
            tags: Array.isArray(card.tags) ? card.tags.map(String).filter(Boolean) : [],
            talkativeness: String(card.talkativeness ?? '0.5'),
            world: '',
            depth_prompt_prompt: String(card.depth_prompt_prompt || ''),
            depth_prompt_depth: String(card.depth_prompt_depth ?? '4'),
            depth_prompt_role: String(card.depth_prompt_role || 'system'),
            fav: 'false',
            alternate_greetings: Array.isArray(card.alternate_greetings) ? card.alternate_greetings : [],
            extensions: '{}',
        };

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
            const data = await response.json();
            toastr.success(`Created "${data.name || name}" — find it in your character list.`);
            return true;
        } catch (err) {
            console.error('[fork-agents] character create failed', err);
            toastr.error(`Character create failed: ${err?.message || err}`);
            return false;
        }
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
                description: 'Agent id or name: lorebook-keeper, character-smith',
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
        helpString: 'Run a fork helper agent. Examples: /agent name=lorebook-keeper prompt=the tavern | /agent character-smith "a pirate captain with a debt"',
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
            <button id="fa-open-launcher" class="menu_button">🧠 Open Helper Agents</button>
            <small>Fork Agents — v0.1.0 (Phase 2: helper agent framework)</small>
        </div>`;

    $('#extensions_settings').append(html);

    $('#fa-enabled-toggle').on('change', function () {
        extension_settings[extensionName].enabled = $(this).prop('checked');
        // Await the ACTUAL save before reloading — saveSettingsDebounced is
        // debounced, so reloading immediately loses the change (toggle reverts).
        saveSettings().then(() => location.reload());
    });

    // Instant-apply for the text/number inputs (runtime reads settings live).
    $('#fa-lorebook-input, #fa-context-input').on('change', function () {
        const key = $(this).attr('data-setting');
        const value = key === 'maxContextMessages'
            ? Math.max(5, Math.min(200, Number($(this).val()) || 30))
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
}

// --- Init -----------------------------------------------------------------------

jQuery(async () => {
    if (!Object.hasOwn(extension_settings, extensionName)) {
        extension_settings[extensionName] = { ...defaultSettings };
        saveSettingsDebounced();
    }

    buildLauncher();
    buildPanel();
    addSettings();
    registerSlashCommands();

    console.log('[fork-agents] active (v0.1.0)');
});

export function init() {
    jQuery(async () => {
        buildLauncher();
        buildPanel();
        addSettings();
        registerSlashCommands();
        console.log('[fork-agents] re-init (v0.1.0)');
    });
}
