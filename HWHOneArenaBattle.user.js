// ==UserScript==
// @name         HWHOneArenaBattle
// @name:ru      Авто-бой на арене
// @namespace    HWHOneArenaBattle
// @version      4.17
// @description  Conducts Arena/Grand Arena battles. Filter friendly clans. Saves battle history to IndexedDB with simProbability and auto-picks best attacker pack.
// @description:ru Проводит бой на Арене/Гранд-Арене. Фильтр дружественных гильдий. Сохраняет историю боёв в IndexedDB с simProbability и автовыбирает лучшую пачку атаки.
// @author       emz13666 with AI
// @license      MIT
// @homepage     https://github.com/emz13666/HWHOneArenaBattle
// @supportURL   https://github.com/emz13666/HWHOneArenaBattle/issues
// @source       https://github.com/emz13666/HWHOneArenaBattle
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmQyNGQiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cG9seWxpbmUgcG9pbnRzPSIxNC41IDE3LjUgMyA2IDMgMyA2IDMgMTcuNSAxNC41Ij48L3BvbHlsaW5lPjxsaW5lIHgxPSIxMyIgeTE9IjE5IiB4Mj0iMTkiIHkyPSIxMyI+PC9saW5lPjxsaW5lIHgxPSIxNiIgeTE9IjE2IiB4Mj0iMjAiIHkyPSIyMCI+PC9saW5lPjxsaW5lIHgxPSIxOSIgeTE9IjIxIiB4Mj0iMjEiIHkyPSIxOSI+PC9saW5lPjxwb2x5bGluZSBwb2ludHM9IjE0LjUgNi41IDE4IDMgMjEgMyAyMSA2IDE3LjUgOS41Ij48L3BvbHlsaW5lPjxsaW5lIHgxPSI1IiB5MT0iMTQiIHgyPSI5IiB5Mj0iMTgiPjwvbGluZT48bGluZSB4MT0iNyIgeTE9IjE3IiB4Mj0iMTEiIHkyPSIxMyI+PC9saW5lPjxsaW5lIHgxPSIzIiB5MT0iMTkiIHgyPSI1IiB5Mj0iMTciPjwvbGluZT48L3N2Zz4=
// @match        https://www.hero-wars.com/*
// @match        https://www.hero-wars.cn/*
// @match        https://apps-1701433570146040.apps.fbsbx.com/*
// @run-at       document-end
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/emz13666/HWHOneArenaBattle/main/HWHOneArenaBattle.user.js
// @updateURL    https://raw.githubusercontent.com/emz13666/HWHOneArenaBattle/main/HWHOneArenaBattle.user.js
// ==/UserScript==

(async function () {
'use strict';

const LOG = '[HWHOneArenaBattle]';
const SETTINGS_KEY = 'HWHOneArenaBattle.settings';
const FRIENDLY_CLANS_KEY = 'HWHOneArenaBattle.friendlyClans';
const FRIENDLY_PLAYERS_KEY = 'HWHOneArenaBattle.friendlyPlayers';
const CLAN_LIST_CACHE_KEY = 'HWHOneArenaBattle.clanListCache';
const DB_NAME = 'HWHOneArenaBattle';
const DB_STORE = 'battles';
const DB_NAME_GRAND = 'HWHOneArenaBattle_Grand';
const DB_STORE_GRAND = 'grandBattles';
const MAX_AGE_MS = 120 * 24 * 3600 * 1000;
const PRUNE_KEY = 'HWHOneArenaBattle.lastPrune';
const SIM_COUNT = 10;
const MIN_PROBABILITY_DEFAULT = 0.5;
let MIN_PROBABILITY_TO_SAVE = MIN_PROBABILITY_DEFAULT;

const SEEN_REPLAYS_KEY = 'HWHOneArenaBattle.seenReplays';
const SEEN_REPLAYS_MAX = 500;
const FRIENDLY_PLAYERS_SLOTS = 7;
const SEARCH_MAX_ITER = 50;
const SEARCH_FALLBACK_ITER = 10;
const SEARCH_RETRY_DELAY_MS = 500;
const REFILL = {
    arena:      { battle: 6,  cooldown: 5,  maxTries: 5, label: 'Арена' },
    grandArena: { battle: 21, cooldown: 20, maxTries: 5, label: 'Гранд-Арена' },
};

const COLOR_PRIORITY = {
    red: 0, orange: 1, yellow: 1, gold: 1,
    purple: 2, violet: 2, blue: 3, green: 4,
    grey: 5, gray: 5, white: 5,
};

function colorRank(c) {
    c = String(c || '').toLowerCase();
    return c in COLOR_PRIORITY ? COLOR_PRIORITY[c] : 6;
}

/* ===== Живой статус ===== */
let liveStatusTimer = null;
let liveStatusPrefix = '';
let liveStatusStart = 0;
let liveStatusHistory = [];

/* ===== Автосмена ГА (объявлено заранее) ===== */
let grandShuffleTimer = null;
let grandShuffleBusy = false;
let grandShuffleEnabled = false;

function startLiveStatus(prefix) {
    stopLiveStatus();
    liveStatusPrefix = prefix;
    liveStatusStart = Date.now();
    const render = () => {
        const elapsed = ((Date.now() - liveStatusStart) / 1000).toFixed(1);
        const hist = liveStatusHistory.slice(-3).join('<br>');
        const line = `${liveStatusPrefix} (${elapsed}с)`;
        HWHFuncs.setProgress(hist ? `${hist}<br>${line}` : line, false);
    };
    render();
    liveStatusTimer = setInterval(render, 200);
}

function pushLiveStatus(line) {
    liveStatusHistory.push(line);
    if (liveStatusHistory.length > 3) liveStatusHistory.shift();
}

function stopLiveStatus(finalMessage) {
    if (liveStatusTimer) {
        clearInterval(liveStatusTimer);
        liveStatusTimer = null;
    }
    if (finalMessage) {
        pushLiveStatus(finalMessage);
        const hist = liveStatusHistory.slice(-3).join('<br>');
        HWHFuncs.setProgress(hist, false);
    }
    liveStatusHistory = [];
}

/* ===== ОЖИДАНИЕ HWH ===== */
async function waitForHelper(timeout = 60000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const g = globalThis;
        if (g.HWHClasses && g.HWHFuncs && g.HWHFuncs.addExtentionName && g.HWHData && g.Caller) return true;
        await new Promise(r => setTimeout(r, 500));
    }
    return false;
}
if (!await waitForHelper()) {
    console.log('%c' + LOG + ' Объект расширения не найден', 'color: red');
    return;
}
console.log(`%cStart Extension ${GM_info.script.name}, v${GM_info.script.version} by ${GM_info.script.author}`, 'color: #ffd24d');
try {
    globalThis.HWHFuncs.addExtentionName(GM_info.script.name, GM_info.script.version, GM_info.script.author);
} catch (e) {}

const { Caller, HWHFuncs, HWHClasses, HWHData } = globalThis;

/* ===== НАСТРОЙКИ ===== */
const defaultSettings = {
    saveHistory: true,
    onlyIfNoAttacksTodayArena: false,
    onlyIfNoAttacksTodayGrand: false,
    noAttackFriendlyClans: true,
    noAttackFriendlyPlayers: true,
    useBestPackFromHistory: true,
    grandShuffle: false,
    grandShuffleIntervalSec: 15,
    minWinProbability: MIN_PROBABILITY_DEFAULT,
};

function loadSettings() {
    try { return { ...defaultSettings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
    catch (e) { return { ...defaultSettings }; }
}
function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) {}
}

function applyMinProbabilityFromSettings() {
    const v = Number(loadSettings().minWinProbability);
    MIN_PROBABILITY_TO_SAVE = (Number.isFinite(v) && v >= 0 && v <= 1)
        ? v
        : MIN_PROBABILITY_DEFAULT;
    return MIN_PROBABILITY_TO_SAVE;
}
applyMinProbabilityFromSettings();
console.log(LOG, `порог вероятности: ${Math.round(MIN_PROBABILITY_TO_SAVE * 100)}%`);

function loadFriendlyClans() {
    try { return JSON.parse(localStorage.getItem(FRIENDLY_CLANS_KEY) || '[]').map(String); }
    catch (e) { return []; }
}
function saveFriendlyClans(arr) {
    try { localStorage.setItem(FRIENDLY_CLANS_KEY, JSON.stringify(arr)); } catch (e) {}
}

function loadFriendlyPlayers() {
    try { return JSON.parse(localStorage.getItem(FRIENDLY_PLAYERS_KEY) || '[]').map(String); }
    catch (e) { return []; }
}
function saveFriendlyPlayers(arr) {
    try {
        const uniq = [...new Set(arr.map(v => String(v).trim()).filter(Boolean))];
        localStorage.setItem(FRIENDLY_PLAYERS_KEY, JSON.stringify(uniq));
    } catch (e) {}
}

function loadSeenReplays() {
    try {
        const raw = localStorage.getItem(SEEN_REPLAYS_KEY);
        if (!raw) return new Set();
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return new Set(arr.map(String));
    } catch (e) {}
    return new Set();
}
function saveSeenReplays(set) {
    try {
        const arr = [...set].slice(-SEEN_REPLAYS_MAX);
        localStorage.setItem(SEEN_REPLAYS_KEY, JSON.stringify(arr));
    } catch (e) {
        console.warn(LOG, 'не удалось сохранить seenReplays:', e);
    }
}

/* ===== СПИСОК ГИЛЬДИЙ ===== */
async function fetchAllClansFromServer() {
    const result = {};
    for (const league of [1, 2, 3, 4]) {
        try {
            const r = await Caller.send({ name: 'clanWarGetLeagueTop', args: { league, current: true } });
            for (const c of (r?.clans || [])) {
                if (c?.id && c?.title) result[String(c.id)] = c.title;
            }
        } catch (e) {
            console.warn(LOG, `не удалось получить лигу ${league}:`, e.message);
        }
    }
    console.log(LOG, `получено гильдий: ${Object.keys(result).length}`);
    return result;
}
async function getAllClansCached(forceRefresh = false) {
    if (!forceRefresh) {
        try {
            const c = JSON.parse(localStorage.getItem(CLAN_LIST_CACHE_KEY) || 'null');
            if (c && c.ts && Date.now() - c.ts < 24 * 3600 * 1000 && c.data) return c.data;
        } catch (e) {}
    }
    const data = await fetchAllClansFromServer();
    try { localStorage.setItem(CLAN_LIST_CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); } catch (e) {}
    return data;
}

/* ===== ДИАЛОГ: базовые настройки ===== */
async function openSettingsDialog() {
    const s = loadSettings();
    const result = await HWHFuncs.popup.confirm(
        'Настройки авто-боя',
        [
            { msg: `Порог: ${Math.round(MIN_PROBABILITY_TO_SAVE * 100)}%…`, result: 'minProb', color: 'orange' },
            { msg: 'Интервал ГА…', result: 'interval', color: 'blue' },
            { msg: '🌐', title: 'Дружественные гильдии', result: 'clans', color: 'green', classes: ['fixedSquare'] },
            { msg: '👥', title: 'Друзья (дружественные игроки)', result: 'players', color: 'green', classes: ['fixedSquare'] },
            { msg: '📚', title: 'История боёв: экспорт / импорт / загрузка с сервера', result: 'history', color: 'blue', classes: ['fixedSquare'] },
            { msg: 'Сохранить', result: true, color: 'green' },
            { msg: 'Отмена', result: false, isCancel: true, color: 'red' },
        ],
        [
            { name: 'saveHistory', label: 'Сохранять историю боёв (расчёт вероятности)', checked: s.saveHistory },
            { name: 'useBestPackFromHistory', label: 'При автоатаке искать лучшую пачку в истории боёв (недоступно без истории боёв)', checked: s.useBestPackFromHistory && s.saveHistory },
            { name: 'onlyIfNoAttacksTodayArena', label: 'Арена: атаковать только если не было атак за сегодня', checked: s.onlyIfNoAttacksTodayArena },
            { name: 'onlyIfNoAttacksTodayGrand', label: 'Гранд-Арена: атаковать только если не было атак за сегодня', checked: s.onlyIfNoAttacksTodayGrand },
            { name: 'noAttackFriendlyClans', label: 'Не атаковать дружественные гильдии', checked: s.noAttackFriendlyClans },
            { name: 'noAttackFriendlyPlayers', label: 'Не атаковать друзей (список «👥 Друзья»)', checked: s.noAttackFriendlyPlayers !== false },
            { name: 'grandShuffle', label: `ГА: автосмена защиты каждые ${s.grandShuffleIntervalSec} сек`, checked: s.grandShuffle },
        ]
    );

    if (result === 'interval') {
        const boxes = HWHFuncs.popup.getCheckBoxes();
        const tmp = { ...s };
        for (const b of boxes) if (b.name in tmp) tmp[b.name] = b.checked;
        const val = await HWHFuncs.popup.confirm(
            'Интервал автосмены защиты ГА (секунды):',
            [
                { msg: 'Сохранить', isInput: true, default: String(tmp.grandShuffleIntervalSec), color: 'green' },
                { msg: 'Отмена', result: false, isCancel: true, color: 'red' },
            ]
        );
        if (val) {
            const n = Number.parseInt(val, 10);
            if (Number.isFinite(n) && n >= 5 && n <= 3600) {
                tmp.grandShuffleIntervalSec = n;
                saveSettings(tmp);
                HWHFuncs.setProgress(`Интервал ГА: ${n} сек`, 3000);
            } else {
                HWHFuncs.setProgress('Интервал должен быть 5–3600 сек', 4000);
            }
        }
        return openSettingsDialog();
    }

    if (result === 'minProb') {
        const boxes = HWHFuncs.popup.getCheckBoxes();
        const tmp = { ...s };
        for (const b of boxes) if (b.name in tmp) tmp[b.name] = b.checked;

        const val = await HWHFuncs.popup.confirm(
            'Порог вероятности победы для сохранения/применения пачки (%):',
            [
                { msg: 'Сохранить', isInput: true, default: String(Math.round((tmp.minWinProbability ?? MIN_PROBABILITY_DEFAULT) * 100)), color: 'green' },
                { msg: 'Отмена', result: false, isCancel: true, color: 'red' },
            ]
        );
        if (val) {
            const n = Number.parseInt(val, 10);
            if (Number.isFinite(n) && n >= 0 && n <= 100) {
                tmp.minWinProbability = n / 100;
                saveSettings(tmp);
                applyMinProbabilityFromSettings();
                HWHFuncs.setProgress(`Порог вероятности: ${n}%`, 3000);
            } else {
                HWHFuncs.setProgress('Порог должен быть 0–100%', 4000);
            }
        }
        return openSettingsDialog();
    }

    if (result === 'clans') {
        await openFriendlyClansDialog();
        return openSettingsDialog();
    }
    if (result === 'players') {
        await openFriendlyPlayersDialog();
        return openSettingsDialog();
    }
    if (result === 'history') {
        await openHistoryDialog();
        return openSettingsDialog();
    }

    if (!result) { console.log(LOG, 'настройки: отмена'); return; }
    const boxes = HWHFuncs.popup.getCheckBoxes();
    const newSettings = { ...s };
    for (const b of boxes) if (b.name in newSettings) newSettings[b.name] = b.checked;

    if (!newSettings.saveHistory) newSettings.useBestPackFromHistory = false;

    saveSettings(newSettings);
    applyMinProbabilityFromSettings();
    console.log(LOG, 'настройки сохранены:', newSettings);
    HWHFuncs.setProgress('Настройки сохранены', 3000);

    if (newSettings.grandShuffle && !grandShuffleEnabled) startGrandShuffle();
    if (!newSettings.grandShuffle && grandShuffleEnabled) stopGrandShuffle();
}

/* ===== ДИАЛОГ: дружественные гильдии ===== */
async function openFriendlyClansDialog() {
    HWHFuncs.setProgress('Загрузка списка гильдий...');
    const clans = await getAllClansCached();
    const friends = loadFriendlyClans();
    const myClanId = String(HWHFuncs.getUserInfo()?.clanId || '');
    const ids = Object.keys(clans).filter(id => id !== myClanId);
    if (!ids.length) {
        await HWHFuncs.popup.confirm('Не удалось получить список гильдий.<br>Попробуйте позже.', [{ msg: 'OK', result: 0, color: 'green' }]);
        return;
    }
    ids.sort((a, b) => {
        const aF = friends.includes(a), bF = friends.includes(b);
        if (aF !== bF) return bF - aF;
        return clans[a].localeCompare(clans[b]);
    });
    const checkboxes = ids.map(id => ({
        name: 'clan_' + id,
        label: `${clans[id]} (id ${id})`,
        checked: friends.includes(id),
    }));
    ensureFriendBtnStyle();
    const result = await HWHFuncs.popup.confirm(
        `Дружественные гильдии (${ids.length})`,
        [
            { msg: '  OK  ', result: true, color: 'green', classes: ['arenaFriendBtn'], isOneSocket: true },
            { msg: 'Список', result: 'refresh', color: 'orange', classes: ['arenaFriendBtn'] },
            { msg: 'Отмена', result: false, color: 'red', isCancel: true, classes: ['arenaFriendBtn'] },
        ],
        checkboxes
    );
    if (result === 'refresh') {
        await getAllClansCached(true);
        HWHFuncs.setProgress('Список гильдий обновлён', 3000);
        return openFriendlyClansDialog();
    }
    if (!result) { console.log(LOG, 'дружественные гильдии: отмена'); return; }
    const boxes = HWHFuncs.popup.getCheckBoxes();
    const newFriends = boxes.filter(b => b.name.startsWith('clan_') && b.checked).map(b => b.name.replace('clan_', ''));
    saveFriendlyClans(newFriends);
    console.log(LOG, `дружественных гильдий сохранено: ${newFriends.length}`);
    HWHFuncs.setProgress(`Дружественных гильдий: ${newFriends.length}`, 3000);
}

/* ===== ДИАЛОГ: друзья ===== */
async function openFriendlyPlayersDialog() {
    let players = loadFriendlyPlayers().slice(0, FRIENDLY_PLAYERS_SLOTS);
    while (players.length < FRIENDLY_PLAYERS_SLOTS) players.push('');

    const buttons = players.map((v, i) => ({
        msg: `${i + 1}. ${v || '—'}`,
        result: `slot_${i}`,
        color: 'blue',
    }));
    buttons.push({ msg: 'Сохранить', result: true, color: 'green' });
    buttons.push({ msg: 'Очистить всё', result: 'clear', color: 'orange' });
    buttons.push({ msg: 'Отмена', result: false, isCancel: true, color: 'red' });

    const result = await HWHFuncs.popup.confirm(
        `Друзья — ID игроков (до ${FRIENDLY_PLAYERS_SLOTS} шт.)`,
        buttons
    );

    if (result === 'clear') {
        saveFriendlyPlayers([]);
        HWHFuncs.setProgress('Список друзей очищен', 3000);
        return openFriendlyPlayersDialog();
    }
    if (typeof result === 'string' && result.startsWith('slot_')) {
        const idx = Number(result.slice(5));
        const val = await HWHFuncs.popup.confirm(
            `ID друга (слот ${idx + 1}):`,
            [
                { msg: 'OK', isInput: true, default: players[idx], color: 'green' },
                { msg: 'Очистить слот', result: '__clear__', color: 'orange' },
                { msg: 'Отмена', result: false, isCancel: true, color: 'red' },
            ]
        );
        if (val === '__clear__') players[idx] = '';
        else if (val) {
            const parts = String(val).split(/[\s,;]+/).filter(Boolean);
            if (parts.length) {
                players[idx] = parts[0];
                for (let k = 1; k < parts.length; k++) {
                    const free = players.findIndex((p, j) => j !== idx && !p);
                    if (free >= 0) players[free] = parts[k];
                    else break;
                }
            }
        }
        saveFriendlyPlayers(players.filter(Boolean));
        return openFriendlyPlayersDialog();
    }
    if (result === true) {
        saveFriendlyPlayers(players.filter(Boolean));
        const cnt = players.filter(Boolean).length;
        console.log(LOG, `друзей сохранено: ${cnt}`);
        HWHFuncs.setProgress(`Друзей: ${cnt}`, 3000);
    }
}

/* ===== ФИЛЬТР СОПЕРНИКОВ ===== */
function isEnemyAllowed(enemy, myClanId, noAttackFriendly) {
    const settings = loadSettings();

    const uid = enemy?.userId != null ? String(enemy.userId) : '';
    if (uid && settings.noAttackFriendlyPlayers !== false && loadFriendlyPlayers().includes(uid)) {
        return false;
    }

    const cid = enemy?.user?.clanId ? String(enemy.user.clanId) : '';
    if (!cid) return true;
    if (cid === String(myClanId)) return false;
    if (noAttackFriendly && loadFriendlyClans().includes(cid)) return false;
    return true;
}

/* ===== ФЛАГИ ===== */
function getBannersFromGame() {
    try {
        const g = cheats.getSelfGame();
        const Game = cheats.getGame();
        const protoFn = cheats.getProtoFn, fnP = cheats.getFnP, findInstanceOf = cheats.findInstanceOf;
        const player = Game.GameModel[fnP(Game.GameModel, 'get_instance')()][protoFn(Game.GameModel, 0)];
        const pbd = findInstanceOf(player, g['game.model.user.banner.PlayerBannerData']);
        if (!pbd) return [];
        const OeD  = pbd?.mj?.Oe?.D;
        const xudD = pbd?.xud?.D;
        if (!OeD) return [];
        const list = [];
        for (const key of Object.keys(OeD)) {
            if (key === 'TC') continue;
            const meta = OeD[key];
            const id = meta?.Me?._id;
            if (!id) continue;
            const name = meta.Me.Ci || ('bank#' + id);
            const slots = xudD?.[id]?.$e?.D;
            const slotKeys = slots ? Object.keys(slots) : [];
            const colorCounts = [0,0,0,0,0,0];
            const colorNames = [];
            for (const sk of slotKeys) {
                const c = slots[sk]?.Yi?.oo || 'grey';
                const rank = colorRank(c);
                if (rank < 6) colorCounts[rank]++;
                colorNames.push(c);
            }
            list.push({
                id, name,
                slotsCount: slotKeys.length,
                colorCounts, colorNames,
                owned: !!xudD?.[id],
            });
        }
        return list;
    } catch (e) {
        console.warn(LOG, 'не удалось прочитать флаги:', e);
        return [];
    }
}
function pickBestBannerId() {
    const list = getBannersFromGame().filter(b => b.owned && b.slotsCount > 0);
    if (!list.length) {
        console.log(LOG, 'флагов с активными слотами нет — параметр banners не отправляем');
        return null;
    }
    const sorted = [...list].sort((a, b) => {
        for (let i = 0; i < 6; i++) if (a.colorCounts[i] !== b.colorCounts[i]) return b.colorCounts[i] - a.colorCounts[i];
        if (a.slotsCount !== b.slotsCount) return b.slotsCount - a.slotsCount;
        return a.id - b.id;
    });
    const top = sorted[0];
    const equals = sorted.filter(b =>
        b.slotsCount === top.slotsCount &&
        b.colorCounts.every((v, i) => v === top.colorCounts[i])
    );
    const picked = equals[Math.floor(Math.random() * equals.length)];
    console.log(LOG, `равнозначных флагов: ${equals.length} [${equals.map(b => b.id).join(', ')}], выбран: ${picked.id}`);
    return picked.id;
}

/* ===== ПОПЫТКИ / КУЛДАУНЫ ===== */
function getRefill(userGetInfo, id) {
    try { return (userGetInfo?.refillable || []).find(x => x.id === id) || null; } catch (e) { return null; }
}
function getTries(userGetInfo, kind) {
    const r = getRefill(userGetInfo, REFILL[kind].battle);
    return r ? (r.amount | 0) : -1;
}
function hadAttacksToday(userGetInfo, kind) {
    const tries = getTries(userGetInfo, kind);
    if (tries < 0) return false;
    return tries < REFILL[kind].maxTries;
}

/* ===== ОШИБКИ ===== */
function handleRefillError(e, kind) {
    const msg = String(e?.message || e);
    const ref = REFILL[kind];
    const m = msg.match(/Refillable (\d+).*delta (\d+)/);
    if (m) {
        const [, refillId, delta] = m;
        let label = `Refillable ${refillId}`;
        if (refillId === String(REFILL.arena.cooldown)) label = 'Арена';
        else if (refillId === String(REFILL.grandArena.cooldown)) label = 'Гранд-Арена';
        console.log(LOG, `${label}: кулдаун ${delta} сек`);
        HWHFuncs.setProgress(`${label}: подожди ${delta} сек`, 5000);
        return true;
    }
    if (msg.includes('NotEnough') && msg.includes('Refillable ' + String(ref.battle))) {
        console.log(LOG, `${ref.label}: нет попыток`);
        HWHFuncs.setProgress(`${ref.label}: нет попыток`, 5000);
        return true;
    }
    return false;
}

/* ===== РЕЗУЛЬТАТ ===== */
function reportBattleResult(result, label, kind) {
    const isGrand = kind === 'grandArena';
    const battles = result?.battles || [];
    const appliedBanners = battles.map(b => b?.effects?.attackersBanner?.id).filter(Boolean);
    if (appliedBanners.length) console.log(LOG, `сервер применил флаги: [${appliedBanners.join(', ')}]`);

    if (isGrand) {
        const total = battles.length;
        const wins = battles.filter(b => b?.result?.win).length;
        const losses = total - wins;
        const winFinal = (typeof result?.win === 'boolean') ? result.win : (wins > losses);
        let oldPlace = null, newPlace = null;
        for (const b of battles) {
            const r = b?.result;
            if (r?.oldPlace && r?.newPlace) { oldPlace = r.oldPlace; newPlace = r.newPlace; break; }
        }
        const gp = result?.state?.grandPlace;
        const score = `${wins}/${total}`;
        const placeInfo = (oldPlace && newPlace) ? `${oldPlace} → ${newPlace}` : (gp ? `место: ${gp}` : '');
        const mark = winFinal ? '✅' : '❌';
        console.log(LOG, `${mark} Гранд-Арена: ${winFinal ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ'} ${score}${placeInfo ? `, ${placeInfo}` : ''}`);
        console.log(LOG, 'по боям:', battles.map(b => ({ order: b?.result?.battleOrder, win: b?.result?.win, stars: b?.result?.stars })));
        if (winFinal) HWHFuncs.setProgress(`✅ Гранд-Арена: ПОБЕДА`, 5000);
        else HWHFuncs.setProgress(`❌ Гранд-Арена: ПОРАЖЕНИЕ`, 5000);
        return;
    }

    const r = battles[0]?.result;
    if (r) {
        const mark = r.win ? '✅' : '❌';
        if (r.win) {
            console.log(LOG, `${mark} Арена ПОБЕДА: ${r.oldPlace} → ${r.newPlace}`);
            HWHFuncs.setProgress(`${mark} Арена: ПОБЕДА ${r.oldPlace ?? '?'} → ${r.newPlace ?? '?'}<br>Загрузка истории...`, 5000);
        } else {
            console.log(LOG, `${mark} Арена ПОРАЖЕНИЕ${r.oldPlace ? ` (${r.oldPlace})` : ''}`);
            HWHFuncs.setProgress(`${mark} Арена: ПОРАЖЕНИЕ<br>Загрузка истории...`, 5000);
        }
    } else {
        console.log(LOG, '❓ Арена: результат не получен');
        HWHFuncs.setProgress('❓ Арена: бой завершён', 5000);
    }
}

/* ===== СИМУЛЯЦИЯ ВЕРОЯТНОСТИ ===== */
async function calcProbability(battle, N = SIM_COUNT) {
    if (!battle || typeof Calc !== 'function') return null;
    let wins = 0, total = 0;
    for (let i = 0; i < N; i++) {
        try {
            const sim = structuredClone(battle);
            sim.seed = Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1e6);
            sim.progress = [{ attackers: { input: ['auto', 0, 0, 'auto', 0, 0] } }];
            const r = await Calc(sim);
            total++;
            if (r?.result?.win) wins++;
        } catch (e) {
            console.warn(LOG, `симуляция ${i + 1}/${N} упала:`, e.message);
        }
        await new Promise(r => setTimeout(r, 20));
    }
    if (total === 0) return null;
    return wins / total;
}

/* ===== INDEXEDDB: сохранение и поиск ===== */
function packKey(heroes, pet) {
    const sorted = (heroes || []).slice().sort((a, b) => a - b);
    return sorted.join(',') + '|' + (pet || '');
}
async function dbGetAll(myDb, store = DB_STORE) {
    return new Promise((resolve) => {
        const tx = myDb.db.transaction([store], 'readonly');
        const req = tx.objectStore(store).getAll();
        req.onerror = () => resolve([]);
        req.onsuccess = () => resolve(req.result || []);
    });
}
async function dbGetAllGrand(myDb) {
    return dbGetAll(myDb, DB_STORE_GRAND);
}
async function dbGetAllKeys(myDb, store = DB_STORE) {
    return new Promise((resolve) => {
        const tx = myDb.db.transaction([store], 'readonly');
        const req = tx.objectStore(store).getAllKeys();
        req.onerror = () => resolve([]);
        req.onsuccess = () => resolve(req.result || []);
    });
}
async function pruneOldBattlesIfNeeded() {
    try {
        const last = parseInt(localStorage.getItem(PRUNE_KEY) || '0');
        if (Date.now() - last < 24 * 3600 * 1000) return;
        if (!HWHClasses.Database) return;
        const now = Date.now();
        let removed = 0;
        const dbA = new HWHClasses.Database(DB_NAME, DB_STORE);
        await dbA.open();
        const keysA = await dbGetAllKeys(dbA, DB_STORE);
        for (const key of keysA) {
            const ts = parseInt(String(key).split('_')[1]);
            if (!ts || now - ts > MAX_AGE_MS) { await dbA.delete(key); removed++; }
        }
        try {
            const dbG = new HWHClasses.Database(DB_NAME_GRAND, DB_STORE_GRAND);
            await dbG.open();
            const keysG = await dbGetAllKeys(dbG, DB_STORE_GRAND);
            for (const key of keysG) {
                const ts = parseInt(String(key).split('_')[1]);
                if (!ts || now - ts > MAX_AGE_MS) { await dbG.delete(key); removed++; }
            }
        } catch (e) {}
        localStorage.setItem(PRUNE_KEY, String(now));
        if (removed) console.log(LOG, `прунинг БД: удалено ${removed} записей (старше 120 дн.)`);
    } catch (e) {
        console.warn(LOG, 'ошибка прунинга:', e);
    }
}
async function saveBattleToDB(record, store = DB_STORE) {
    if (!HWHClasses.Database) return;
    try {
        const isGrand = store === DB_STORE_GRAND;
        const myDb = new HWHClasses.Database(isGrand ? DB_NAME_GRAND : DB_NAME, store);
        await myDb.open();
        const key = (isGrand ? 'g_' : 'b_') + record.ts + '_' + Math.random().toString(36).slice(2, 8);
        await myDb.set(key, record);
        console.log(LOG, (isGrand ? 'ГА бой сохранён: ' : 'бой сохранён: ') + key);
    } catch (e) {
        console.warn(LOG, 'не удалось сохранить бой:', e);
    }
}
async function saveGrandBattleToDB(record) {
    return saveBattleToDB(record, DB_STORE_GRAND);
}

async function hasAnyHistoryAtOrAboveThreshold(kind) {
    if (!HWHClasses.Database) return false;
    try {
        const isGrand = kind === 'grandArena';
        const store = isGrand ? DB_STORE_GRAND : DB_STORE;
        const dbName = isGrand ? DB_NAME_GRAND : DB_NAME;
        const db = new HWHClasses.Database(dbName, store);
        await db.open();
        const all = isGrand ? await dbGetAllGrand(db) : await dbGetAll(db);
        return all.some(r => typeof r.probability === 'number' && r.probability >= MIN_PROBABILITY_TO_SAVE);
    } catch (e) {
        return false;
    }
}

/* ================================================================= */
/* === ИМПОРТ ИСТОРИИ ИЗ battleGetByType                           = */
/* ================================================================= */
function extractPackFromTeam(teamObj) {
    const units = Object.values(teamObj || {}).filter(u => u && u.id);
    const heroes = units.filter(u => u.id < 6000).map(u => u.id).sort((a, b) => a - b);
    const pet = units.find(u => u.id >= 6000)?.id || null;
    const favor = {};
    for (const u of units) {
        if (u.id < 6000 && u.favorPetId) favor[u.id] = u.favorPetId;
    }
    return { heroes, pet, favor };
}

function convertReplayToRecords(replay, myUserId, source) {
    if (String(replay.userId) !== String(myUserId)) return null;

    const ts = (+replay.startTime || Math.floor(Date.now() / 1000)) * 1000;
    const base = {
        ts,
        replayId: replay.id,
        source,
        defenderId: String(replay.typeId),
        defenderName: '',
        defenderClanId: null,
        attackerClanId: null,
    };

    if (source === 'arena') {
        const attackers = replay.attackers || {};
        const defenders = Array.isArray(replay.defenders) ? replay.defenders[0] : (replay.defenders || {});
        const atk = extractPackFromTeam(attackers);
        const def = extractPackFromTeam(defenders);
        if (!atk.heroes.length) return null;
        return [{
            ...base,
            attackerPack: atk.heroes,
            attackerPet: atk.pet,
            attackerFavor: atk.favor,
            defenderPack: def.heroes,
            defenderPet: def.pet,
            defenderFavor: def.favor,
            win: !!replay.result?.win,
            probability: null,
        }];
    }

    if (source === 'grandArena') {
        const defArr = Array.isArray(replay.defenders) ? replay.defenders : [replay.defenders];
        const atk = extractPackFromTeam(replay.attackers || {});
        const def = extractPackFromTeam(defArr[0] || {});
        if (!atk.heroes.length) return null;
        return [{
            ...base,
            attackerPack: atk.heroes,
            attackerPet: atk.pet,
            attackerFavor: atk.favor,
            defenderPack: def.heroes,
            defenderPet: def.pet,
            defenderFavor: def.favor,
            win: !!replay.result?.win,
            probability: null,
            battleOrder: replay.result?.battleOrder ?? 0,
        }];
    }

    return null;
}

async function calcProbabilityForReplay(replay) {
    try {
        const battle = structuredClone(replay);
        if (!battle.progress || !battle.progress.length) {
            battle.progress = [{ attackers: { input: ['auto', 0, 0, 'auto', 0, 0] } }];
        }
        if (!battle.type) battle.type = 'arena';
        return await calcProbability(battle, SIM_COUNT);
    } catch (e) {
        console.warn(LOG, 'calcProbabilityForReplay ошибка:', e.message);
        return null;
    }
}

async function importArenaHistoryFromServer(maxPages = Infinity) {
    if (!HWHClasses.Database) {
        console.log(LOG, 'импорт: HWHClasses.Database недоступен');
        return 0;
    }
    const myUserId = String(HWHFuncs.getUserInfo()?.id || '');
    if (!myUserId) {
        console.log(LOG, 'импорт истории: нет userInfo.id');
        HWHFuncs.setProgress('История: нет userInfo.id', 4000);
        return 0;
    }

    const seenReplays = loadSeenReplays();

    const dbA = new HWHClasses.Database(DB_NAME, DB_STORE);
    await dbA.open();
    const existingIds = new Set(
        (await dbGetAll(dbA, DB_STORE)).map(r => String(r.replayId)).filter(Boolean)
    );
    try {
        const dbG = new HWHClasses.Database(DB_NAME_GRAND, DB_STORE_GRAND);
        await dbG.open();
        (await dbGetAllGrand(dbG)).forEach(r => { if (r.replayId) existingIds.add(String(r.replayId)); });
    } catch (e) {}

    const LIMIT = 20;
    let totalImported = 0;
    let totalSkippedLowProb = 0;
    let totalDuplicates = 0;
    let totalForeign = 0;
    let totalSeen = 0;
    let totalProcessed = 0;

    console.log(LOG, `=== Импорт истории (myUserId=${myUserId}) ===`);

    for (const source of ['arena', 'grandArena']) {
        const type = source === 'arena' ? 'arena' : 'grand';
        let offset = 0;
        let page = 0;
        let srcImported = 0;
        let srcSeen = 0;
        let srcSkippedProb = 0;
        let srcDuplicates = 0;
        let srcForeign = 0;

        console.log(LOG, `--- источник: ${source} (type=${type}) ---`);

        while (page < maxPages) {
            page++;
            let resp;
            try {
                resp = await Caller.send({
                    name: 'battleGetByType',
                    args: { type, limit: LIMIT, offset },
                });
            } catch (e) {
                const msg = String(e?.message || e);
                console.warn(LOG, `battleGetByType(${type}) стр.${page} ошибка:`, msg);
                HWHFuncs.setProgress(`История ${source}: ошибка — ${msg}`, 5000);
                break;
            }

            const replays = resp?.replays || [];
            console.log(LOG, `${source} стр.${page}: получено ${replays.length} реплеев`);
            if (!replays.length) break;

            const fresh = [];
            let pageDuplicates = 0;
            let pageSeen = 0;
            let pageForeign = 0;

            for (const replay of replays) {
                const rid = String(replay.id);
                if (existingIds.has(rid)) { pageDuplicates++; totalDuplicates++; srcDuplicates++; continue; }
                if (seenReplays.has(rid)) { pageSeen++; totalSeen++; srcSeen++; continue; }
                if (String(replay.userId) !== myUserId) { pageForeign++; totalForeign++; srcForeign++; continue; }
                fresh.push(replay);
            }

            console.log(
                LOG,
                `${source} стр.${page}: новых ${fresh.length} ` +
                `(дублей ${pageDuplicates}, уже считалось ${pageSeen}, не моих ${pageForeign})`
            );

            if (!fresh.length) {
                HWHFuncs.setProgress(
                    `История ${source}: стр.${page} — новых нет (дублей ${pageDuplicates}, считалось ${pageSeen}, чужих ${pageForeign})`,
                    false
                );
                if (replays.length < LIMIT) break;
                offset += LIMIT;
                await new Promise(r => setTimeout(r, 200));
                continue;
            }

            const total = fresh.length;
            let idx = 0;

            for (const replay of fresh) {
                idx++;
                const replayIdStr = String(replay.id);
                const prefix = `История ${source} [${idx}/${total}]:`;

                const records = convertReplayToRecords(replay, myUserId, source);
                if (!records) {
                    totalForeign++;
                    srcForeign++;
                    pushLiveStatus(`${prefix} не моя атака`);
                    continue;
                }

                startLiveStatus(`${prefix} расчёт вероятности`);
                const prob = await calcProbabilityForReplay(replay);

                if (prob !== null && prob < MIN_PROBABILITY_TO_SAVE) {
                    totalSkippedLowProb++;
                    srcSkippedProb++;
                    seenReplays.add(replayIdStr);
                    stopLiveStatus(`${prefix} ${(prob * 100).toFixed(0)}% — пропуск (< ${Math.round(MIN_PROBABILITY_TO_SAVE * 100)}%)`);
                    console.log(LOG, `импорт: пропущен replayId=${replay.id} — probability ${(prob * 100).toFixed(0)}% < ${Math.round(MIN_PROBABILITY_TO_SAVE * 100)}%`);
                    continue;
                }

                for (const rec of records) {
                    rec.probability = prob;
                    if (source === 'arena') await saveBattleToDB(rec);
                    else await saveGrandBattleToDB(rec);
                    existingIds.add(replayIdStr);
                    totalImported++;
                    srcImported++;
                }
                seenReplays.add(replayIdStr);
                totalProcessed++;
                stopLiveStatus(`${prefix} ✓ сохранено (${(prob * 100).toFixed(0)}%)`);
            }

            if (replays.length < LIMIT) break;
            offset += LIMIT;
            await new Promise(r => setTimeout(r, 200));
        }

        console.log(
            LOG,
            `${source}: сохранено ${srcImported}, уже считалось ${srcSeen}, низкий шанс ${srcSkippedProb}, дублей ${srcDuplicates}, не моих ${srcForeign}`
        );
        HWHFuncs.setProgress(
            `История ${source}: сохранено ${srcImported}, пропущено ${srcSeen + srcSkippedProb}`,
            false
        );
    }

    saveSeenReplays(seenReplays);

    const summary = `История: +${totalImported} новых, уже считалось ${totalSeen}, низкий шанс ${totalSkippedLowProb}, дублей ${totalDuplicates}, не моих ${totalForeign}`;
    console.log(LOG, summary);
    HWHFuncs.setProgress(summary, 6000);
    return totalImported;
}

/* === Экспорт / Импорт IndexedDB в файл === */

async function exportAllDB() {
    try {
        const dbA = new HWHClasses.Database(DB_NAME, DB_STORE);
        await dbA.open();
        const arena = await dbGetAll(dbA, DB_STORE);

        let grand = [];
        try {
            const dbG = new HWHClasses.Database(DB_NAME_GRAND, DB_STORE_GRAND);
            await dbG.open();
            grand = await dbGetAllGrand(dbG);
        } catch (e) {}

        if (!arena.length && !grand.length) {
            HWHFuncs.setProgress('БД пуста', 3000);
            return;
        }

        const payload = {
            version: 2,
            exportedAt: new Date().toISOString(),
            scriptVersion: GM_info.script.version,
            arena,
            grand,
        };

        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `hwh_arena_backup_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        console.log(LOG, `экспорт: Арена ${arena.length}, ГА ${grand.length}`);
        HWHFuncs.setProgress(`Экспорт: Арена ${arena.length}, ГА ${grand.length}`, 4000);
    } catch (e) {
        console.error(LOG, 'экспорт ошибка:', e);
        HWHFuncs.setProgress('Экспорт: ошибка', 3000);
    }
}

async function importAllDB() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    input.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        input.remove();
        if (!file) return;
        try {
            const data = JSON.parse(await file.text());
            let arenaRecords = [];
            let grandRecords = [];

            if (data.arena || data.grand) {
                arenaRecords = data.arena || [];
                grandRecords = data.grand || [];
            } else if (Array.isArray(data.records)) {
                arenaRecords = data.records;
            } else if (Array.isArray(data)) {
                arenaRecords = data;
            } else {
                throw new Error('Неизвестный формат файла');
            }

            const dbA = new HWHClasses.Database(DB_NAME, DB_STORE);
            await dbA.open();
            const existingA = new Set((await dbGetAll(dbA, DB_STORE)).map(r => String(r.replayId)).filter(Boolean));
            let addedA = 0, skippedA = 0;
            for (const rec of arenaRecords) {
                if (rec.replayId && existingA.has(String(rec.replayId))) { skippedA++; continue; }
                const key = 'b_' + (rec.ts || Date.now()) + '_' + Math.random().toString(36).slice(2, 8);
                await dbA.set(key, rec);
                if (rec.replayId) existingA.add(String(rec.replayId));
                addedA++;
            }

            let addedG = 0, skippedG = 0;
            if (grandRecords.length) {
                try {
                    const dbG = new HWHClasses.Database(DB_NAME_GRAND, DB_STORE_GRAND);
                    await dbG.open();
                    const existingG = new Set((await dbGetAllGrand(dbG)).map(r => String(r.replayId)).filter(Boolean));
                    for (const rec of grandRecords) {
                        if (rec.replayId && existingG.has(String(rec.replayId))) { skippedG++; continue; }
                        const key = 'g_' + (rec.ts || Date.now()) + '_' + Math.random().toString(36).slice(2, 8);
                        await dbG.set(key, rec);
                        if (rec.replayId) existingG.add(String(rec.replayId));
                        addedG++;
                    }
                } catch (e) {
                    console.warn(LOG, 'импорт ГА ошибка:', e);
                }
            }

            console.log(LOG, `импорт БД: Арена +${addedA} (проп. ${skippedA}), ГА +${addedG} (проп. ${skippedG})`);
            HWHFuncs.setProgress(`Импорт: Арена +${addedA}, ГА +${addedG}`, 5000);
        } catch (err) {
            console.error(LOG, 'импорт БД ошибка:', err);
            HWHFuncs.setProgress('Импорт БД: ошибка — ' + err.message, 4000);
        }
    });
    document.body.appendChild(input);
    input.click();
}

async function openHistoryDialog() {
    if (!loadSettings().saveHistory) {
        const go = await HWHFuncs.popup.confirm(
            'Сохранение истории боёв отключено в настройках.<br>Открыть историю всё равно?',
            [
                { msg: 'Открыть', result: true, color: 'green' },
                { msg: 'Отмена', result: false, isCancel: true, color: 'red' },
            ]
        );
        if (!go) return;
    }
    const result = await HWHFuncs.popup.confirm(
        'История боёв (IndexedDB)',
        [
            { msg: '💾 Экспорт', result: 'export', color: 'green' },
            { msg: '📂 Импорт', result: 'import', color: 'blue' },
            { msg: '🔄 Загрузить с сервера', result: 'server', color: 'orange' },
            { msg: 'Отмена', result: false, isCancel: true, color: 'red' },
        ]
    );
    if (result === 'export') await exportAllDB();
    else if (result === 'import') await importAllDB();
    else if (result === 'server') await importArenaHistoryFromServer();
}

/**
 * Насколько похожи две пачки героев.
 */
function packSimilarity(a, b) {
    if (!a?.length || !b?.length) return 0;
    const setB = new Set(b);
    const overlap = a.filter(x => setB.has(x)).length;
    return overlap / Math.max(a.length, b.length);
}

async function findBestAttackerPacks(defenderHeroes, defenderPet, topN = 5) {
    if (!HWHClasses.Database) return [];
    try {
        const myDb = new HWHClasses.Database(DB_NAME, DB_STORE);
        await myDb.open();
        const all = await dbGetAll(myDb);

        const targetKey = packKey(defenderHeroes, defenderPet);

        const hasDefenderFavor = (r) => {
            const f = r.defenderFavor;
            if (!f || typeof f !== 'object') return false;
            return Object.keys(f).some(k => f[k] != null);
        };

        const exact = all.filter(r =>
            hasDefenderFavor(r) &&
            packKey(r.defenderPack, r.defenderPet) === targetKey
        );

        let fuzzy = [];
        if (!exact.length) {
            fuzzy = all.filter(r => {
                if (!hasDefenderFavor(r)) return false;
                const sim = packSimilarity(r.defenderPack || [], defenderHeroes || []);
                if (sim < 0.8) return false;
                if (defenderPet && r.defenderPet && defenderPet !== r.defenderPet) return false;
                return true;
            });
            if (fuzzy.length) {
                console.log(LOG, `точного совпадения нет — ищем по похожим защитам (${fuzzy.length} записей)`);
            }
        }

        const source = exact.length ? exact : fuzzy;
        if (!source.length) return [];

        const byAttacker = new Map();
        for (const r of source) {
            const akey = packKey(r.attackerPack, r.attackerPet);
            if (!byAttacker.has(akey)) {
                byAttacker.set(akey, {
                    attackerPack: r.attackerPack,
                    attackerPet: r.attackerPet,
                    attackerFavor: r.attackerFavor || {},
                    wins: 0,
                    total: 0,
                    simSum: 0,
                    simCount: 0,
                    matched: 0,
                    exact: 0,
                });
            }
            const e = byAttacker.get(akey);
            e.total++;
            if (r.win) e.wins++;
            if (typeof r.probability === 'number') {
                e.simSum += r.probability;
                e.simCount++;
            }
            e.matched++;
            if (exact.includes(r)) e.exact++;
        }

        return [...byAttacker.values()]
            .map(e => ({
                ...e,
                histWinRate: e.total > 0 ? e.wins / e.total : 0,
                simProbability: e.simCount > 0 ? e.simSum / e.simCount : null,
            }))
            .filter(e => e.simProbability !== null && e.attackerPack?.length === 5)
            .sort((a, b) => b.simProbability - a.simProbability)
            .slice(0, topN);
    } catch (e) {
        console.warn(LOG, 'ошибка поиска пачек:', e);
        return [];
    }
}

async function findBestGrandPacks(enemyVisibleTeams, currentHeroesArr, currentPetsArr, currentFavor) {
    if (!HWHClasses.Database) {
        console.log(LOG, 'ГА-поиск: HWHClasses.Database недоступен');
        return null;
    }
    if (!enemyVisibleTeams || !enemyVisibleTeams.length) {
        console.log(LOG, 'ГА-поиск: нет видимых пачек защиты');
        return null;
    }
    try {
        const dbG = new HWHClasses.Database(DB_NAME_GRAND, DB_STORE_GRAND);
        await dbG.open();
        const all = await dbGetAllGrand(dbG);
        console.log(LOG, `ГА-поиск: записей в истории ГА = ${all.length}, видимых защит = ${enemyVisibleTeams.length}`);
        if (!all.length) {
            console.log(LOG, 'ГА-поиск: история ГА пуста');
            return null;
        }

        // Слоты по позициям защит: 0..2, null = не нашли
        const slots = [null, null, null];

        for (let defIdx = 0; defIdx < enemyVisibleTeams.length && defIdx < 3; defIdx++) {
            const defTeam = enemyVisibleTeams[defIdx];
            const defHeroes = (defTeam.heroes || []).filter(h => h.id < 6000).map(h => h.id);
            const defPet    = (defTeam.heroes || []).find(h => h.id >= 6000)?.id || null;
            if (!defHeroes.length) {
                console.log(LOG, `ГА-поиск: защита #${defIdx + 1} без героев, пропуск`);
                continue;
            }

            const targetKey = packKey(defHeroes, defPet);
            let source = all.filter(r => packKey(r.defenderPack, r.defenderPet) === targetKey);
            if (!source.length) {
                source = all.filter(r => {
                    const sim = packSimilarity(r.defenderPack || [], defHeroes);
                    if (sim < 0.8) return false;
                    if (defPet && r.defenderPet && defPet !== r.defenderPet) return false;
                    return true;
                });
            }
            if (!source.length) {
                console.log(LOG, `ГА-поиск: защита #${defIdx + 1} — матчей нет`);
                continue;
            }

            const byAtk = new Map();
            for (const r of source) {
                const atkKey = packKey(r.attackerPack, r.attackerPet);
                if (!byAtk.has(atkKey)) {
                    byAtk.set(atkKey, {
                        heroes: r.attackerPack,
                        pet: r.attackerPet,
                        favor: r.attackerFavor || {},
                        wins: 0, total: 0, simSum: 0, simCount: 0,
                    });
                }
                const e = byAtk.get(atkKey);
                e.total++;
                if (r.win) e.wins++;
                if (typeof r.probability === 'number') { e.simSum += r.probability; e.simCount++; }
            }

            let best = null;
            for (const e of byAtk.values()) {
                e.prob = e.simCount > 0 ? e.simSum / e.simCount : (e.wins / e.total);
                if (!best || e.prob > best.prob) best = e;
            }
            if (best) {
                slots[defIdx] = {
                    ...best,
                    position: defIdx,
                    againstDefHeroes: defHeroes,
                    againstDefPet: defPet,
                };
            }
        }

        const qualified = slots.filter(s => s && s.prob >= MIN_PROBABILITY_TO_SAVE);

        if (!qualified.length) {
            console.log(LOG, `ГА-поиск: ни одна пачка не прошла порог ${Math.round(MIN_PROBABILITY_TO_SAVE * 100)}%`);
            return null;
        }

        console.log(LOG, `ГА-поиск: пачек >= порога: ${qualified.length} (${slots.map((s, i) => s ? `#${i + 1}:${(s.prob * 100).toFixed(0)}%` : `#${i + 1}:—`).join(', ')})`);

        // Заполняем свободные позиции текущими пачками (с учётом usedHeroes по уже выбранным)
        const usedHeroes = new Set();
        for (const s of slots) if (s) s.heroes.forEach(h => usedHeroes.add(h));

        for (let pos = 0; pos < 3; pos++) {
            if (slots[pos]) continue;
            for (let i = 0; i < currentHeroesArr.length; i++) {
                const pack = currentHeroesArr[i];
                if (!pack || pack.some(h => usedHeroes.has(h))) continue;
                slots[pos] = { heroes: pack, pet: currentPetsArr[i] || null, favor: currentFavor || {}, prob: 0, position: pos, fallback: true };
                pack.forEach(h => usedHeroes.add(h));
                break;
            }
        }
        // если совсем не хватило — просто первые свободные текущие пачки
        for (let pos = 0; pos < 3; pos++) {
            if (slots[pos]) continue;
            for (let i = 0; i < currentHeroesArr.length; i++) {
                const pack = currentHeroesArr[i];
                if (!pack) continue;
                const already = slots.some(s => s && s.heroes.length === pack.length && pack.every((h, k) => s.heroes[k] === h));
                if (already) continue;
                slots[pos] = { heroes: pack, pet: currentPetsArr[i] || null, favor: currentFavor || {}, prob: 0, position: pos, fallback: true };
                break;
            }
        }

        const mergedFavor = {};
        for (const s of slots) if (s) Object.assign(mergedFavor, s.favor || {});

        return {
            slots,
            heroesArr: slots.map(s => s ? s.heroes : null),
            petsArr:   slots.map(s => s ? s.pet   : null),
            favor: mergedFavor,
            stats: qualified.map(p => ({
                position: p.position,
                prob: p.prob,
                wins: p.wins,
                total: p.total,
                vsDefHeroes: p.againstDefHeroes,
                vsDefPet: p.againstDefPet,
            })),
        };
    } catch (e) {
        console.warn(LOG, 'ошибка поиска пачек ГА:', e);
        return null;
    }
}

/* ===== ПОИСК СОПЕРНИКОВ ===== */
async function pickArenaEnemy(myClanId, noAttackFriendly, excludeSet, maxAttempts = 10, delayMs = 1500) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const enemies = await Caller.send('arenaFindEnemies');
        if (!Array.isArray(enemies) || !enemies.length) throw new Error('Сервер не вернул соперников');

        const filtered = enemies.filter(e =>
            isEnemyAllowed(e, myClanId, noAttackFriendly) &&
            !(excludeSet && excludeSet.has(String(e.userId)))
        );
        if (!filtered.length) {
            console.log(LOG, `Арена: попытка ${attempt}/${maxAttempts}: все кандидаты уже проверены или отфильтрованы`);
        } else {
            const ids = filtered.map(e => e.userId);
            let range = {};
            try { range = await Caller.send({ name: 'arenaCheckTargetRange', args: { ids } }); } catch (e) {}
            const inRange = filtered.filter(e => range[e.userId] !== false);
            if (inRange.length) {
                const picked = inRange[0];
                console.log(LOG, `Арена: соперник с попытки ${attempt}:`, picked.user?.name || picked.userId);
                return picked;
            }
        }
        if (attempt < maxAttempts) await new Promise(r => setTimeout(r, delayMs));
    }
    throw new Error('Не удалось найти соперника (Арена)');
}

async function pickGrandEnemy(myClanId, noAttackFriendly, excludeSet, maxAttempts = 10, delayMs = 1500) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const enemies = await Caller.send('grandFindEnemies');
        if (!Array.isArray(enemies) || !enemies.length) throw new Error('Сервер не вернул соперников (ГА)');

        const filtered = enemies.filter(e =>
            isEnemyAllowed(e, myClanId, noAttackFriendly) &&
            !(excludeSet && excludeSet.has(String(e.userId)))
        );
        if (!filtered.length) {
            console.log(LOG, `ГА: попытка ${attempt}/${maxAttempts}: все кандидаты уже проверены или отфильтрованы`);
        } else {
            const ids = filtered.map(e => e.userId);
            let range = {};
            try { range = await Caller.send({ name: 'grandCheckTargetRange', args: { ids } }); } catch (e) {}
            const inRange = filtered.filter(e => range[e.userId] !== false);
            if (inRange.length) {
                const picked = inRange[0];
                console.log(LOG, `ГА: соперник с попытки ${attempt}:`, picked.user?.name || picked.userId);
                return picked;
            }
        }
        if (attempt < maxAttempts) await new Promise(r => setTimeout(r, delayMs));
    }
    throw new Error('Не удалось найти соперника (ГА)');
}

/* ===== ВЫБОР ПАЧКИ ПО simProbability ===== */
async function tryUseBestPack(kind, defHeroes, defPet, fallbackHeroes, fallbackPet) {
    try {
        const alts = await findBestAttackerPacks(defHeroes, defPet, 5);
        if (!alts.length) {
            console.log(LOG, 'лучших пачек в БД не найдено — использую сохранённую пачку');
            return null;
        }

        const MIN_APPLY = MIN_PROBABILITY_TO_SAVE;

        console.log(LOG, `лучшие пачки (по simProbability):`);
        for (const a of alts) {
            const marker = a.exact > 0 ? '[точная защита]' : '[похожая защита]';
            const pass = a.simProbability >= MIN_APPLY;
            console.log(
                `   ${pass ? '✓' : '✗'} ${marker} [${a.attackerPack.join(',')}] пет ${a.attackerPet || '-'} → ` +
                `сим ${(a.simProbability * 100).toFixed(0)}%, ` +
                `факт ${a.wins}/${a.total} (${(a.histWinRate * 100).toFixed(0)}%), ` +
                `матчей: ${a.matched}`
            );
        }

        const qualified = alts
            .filter(a => a.simProbability >= MIN_APPLY && a.attackerPack?.length === 5)
            .sort((a, b) => b.simProbability - a.simProbability);

        if (!qualified.length) {
            console.log(LOG, `лучших пачек с сим >= ${Math.round(MIN_APPLY * 100)}% не найдено — использую текущую пачку`);
            return null;
        }

        const best = qualified[0];
        console.log(LOG, `выбрана пачка с сим ${(best.simProbability * 100).toFixed(0)}%`);
        return best;
    } catch (e) {
        console.warn(LOG, 'ошибка выбора пачки:', e);
        return null;
    }
}

/* ===== ПОИСК ЦЕЛИ ПО НОВОМУ АЛГОРИТМУ ===== */
async function findArenaTarget(settings, myClanId) {
    const historyHasHighProb = await hasAnyHistoryAtOrAboveThreshold('arena');
    console.log(LOG, `Арена: в истории есть бои >= ${Math.round(MIN_PROBABILITY_TO_SAVE * 100)}%: ${historyHasHighProb}`);

    const checked = new Set();

    for (let iter = 1; iter <= SEARCH_MAX_ITER; iter++) {
        let enemy;
        try {
            enemy = await pickArenaEnemy(myClanId, settings.noAttackFriendlyClans, checked, 1, 0);
        } catch (e) {
            console.log(LOG, `Арена: итерация ${iter}/${SEARCH_MAX_ITER}: нет непроверенных подходящих соперников`);
            await new Promise(r => setTimeout(r, 1000));
            continue;
        }

        const uid = String(enemy.userId);
        checked.add(uid);

        const defHeroes = (enemy.heroes || []).filter(h => h.id < 6000).map(h => h.id);
        const defPet    = (enemy.heroes || []).find(h => h.id >= 6000)?.id || null;

        let best = null;
        if (settings.saveHistory && settings.useBestPackFromHistory) {
            best = await tryUseBestPack('arena', defHeroes, defPet, null, null);
        }

        if (best) {
            console.log(LOG, `Арена: итерация ${iter}/${SEARCH_MAX_ITER}: найден соперник ${enemy.user?.name || enemy.userId} с пачкой ${(best.simProbability * 100).toFixed(0)}% (проверено: ${checked.size})`);
            return { enemy, best, defHeroes, defPet, checkedCount: checked.size };
        }

        if (!historyHasHighProb) {
            console.log(LOG, `Арена: итерация ${iter}/${SEARCH_MAX_ITER}: истории >= порога нет — атакуем текущей пачкой ${enemy.user?.name || enemy.userId} (проверено: ${checked.size})`);
            return { enemy, best: null, defHeroes, defPet, checkedCount: checked.size };
        }

        console.log(LOG, `Арена: итерация ${iter}/${SEARCH_MAX_ITER}: соперник ${enemy.user?.name || enemy.userId} — нет пачки >= ${Math.round(MIN_PROBABILITY_TO_SAVE * 100)}%, ищем дальше (проверено: ${checked.size})`);
        await new Promise(r => setTimeout(r, SEARCH_RETRY_DELAY_MS));
    }

    console.log(LOG, `Арена: за ${SEARCH_MAX_ITER} итераций пачка >= порога не найдена, переходим к фолбэку (до ${SEARCH_FALLBACK_ITER} итераций)`);
    for (let iter = 1; iter <= SEARCH_FALLBACK_ITER; iter++) {
        let enemy;
        try {
            enemy = await pickArenaEnemy(myClanId, settings.noAttackFriendlyClans, null, 1, 0);
        } catch (e) {
            console.log(LOG, `Арена: фолбэк ${iter}/${SEARCH_FALLBACK_ITER}: нет подходящего соперника`);
            await new Promise(r => setTimeout(r, 1000));
            continue;
        }

        const defHeroes = (enemy.heroes || []).filter(h => h.id < 6000).map(h => h.id);
        const defPet    = (enemy.heroes || []).find(h => h.id >= 6000)?.id || null;

        console.log(LOG, `Арена: фолбэк ${iter}/${SEARCH_FALLBACK_ITER}: атакуем текущей пачкой ${enemy.user?.name || enemy.userId} (проверено ранее: ${checked.size})`);
        return { enemy, best: null, defHeroes, defPet, checkedCount: checked.size };
    }

    console.log(LOG, `Арена: за ${SEARCH_MAX_ITER} + ${SEARCH_FALLBACK_ITER} итераций подходящий соперник не найден. Проверено уникальных: ${checked.size}`);
    return null;
}

async function findGrandTarget(settings, myClanId, heroesArr, petsArr, favor) {
    const historyHasHighProb = await hasAnyHistoryAtOrAboveThreshold('grandArena');
    console.log(LOG, `ГА: в истории есть бои >= ${Math.round(MIN_PROBABILITY_TO_SAVE * 100)}%: ${historyHasHighProb}`);

    const checked = new Set();

    for (let iter = 1; iter <= SEARCH_MAX_ITER; iter++) {
        let enemy;
        try {
            enemy = await pickGrandEnemy(myClanId, settings.noAttackFriendlyClans, checked, 1, 0);
        } catch (e) {
            console.log(LOG, `ГА: итерация ${iter}/${SEARCH_MAX_ITER}: нет непроверенных подходящих соперников`);
            await new Promise(r => setTimeout(r, 1000));
            continue;
        }

        const uid = String(enemy.userId);
        checked.add(uid);

        let best = null;
        const visibleTeams = (enemy.heroes || []).map(teamArr => ({
            heroes: Array.isArray(teamArr) ? teamArr : Object.values(teamArr || {}),
        }));
        if (settings.saveHistory && settings.useBestPackFromHistory && visibleTeams.length) {
            best = await findBestGrandPacks(visibleTeams, heroesArr, petsArr, favor);
        }

        if (best) {
            console.log(LOG, `ГА: итерация ${iter}/${SEARCH_MAX_ITER}: найден соперник ${enemy.user?.name || enemy.userId}, пачек >= порога: ${best.stats.length} (проверено: ${checked.size})`);
            return { enemy, best, checkedCount: checked.size };
        }

        if (!historyHasHighProb) {
            console.log(LOG, `ГА: итерация ${iter}/${SEARCH_MAX_ITER}: истории >= порога нет — атакуем текущими пачками ${enemy.user?.name || enemy.userId} (проверено: ${checked.size})`);
            return { enemy, best: null, checkedCount: checked.size };
        }

        console.log(LOG, `ГА: итерация ${iter}/${SEARCH_MAX_ITER}: соперник ${enemy.user?.name || enemy.userId} — нет пачек >= ${Math.round(MIN_PROBABILITY_TO_SAVE * 100)}%, ищем дальше (проверено: ${checked.size})`);
        await new Promise(r => setTimeout(r, SEARCH_RETRY_DELAY_MS));
    }

    console.log(LOG, `ГА: за ${SEARCH_MAX_ITER} итераций пачки >= порога не найдены, переходим к фолбэку (до ${SEARCH_FALLBACK_ITER} итераций)`);
    for (let iter = 1; iter <= SEARCH_FALLBACK_ITER; iter++) {
        let enemy;
        try {
            enemy = await pickGrandEnemy(myClanId, settings.noAttackFriendlyClans, null, 1, 0);
        } catch (e) {
            console.log(LOG, `ГА: фолбэк ${iter}/${SEARCH_FALLBACK_ITER}: нет подходящего соперника`);
            await new Promise(r => setTimeout(r, 1000));
            continue;
        }

        console.log(LOG, `ГА: фолбэк ${iter}/${SEARCH_FALLBACK_ITER}: атакуем текущими пачками ${enemy.user?.name || enemy.userId} (проверено ранее: ${checked.size})`);
        return { enemy, best: null, checkedCount: checked.size };
    }

    console.log(LOG, `ГА: за ${SEARCH_MAX_ITER} + ${SEARCH_FALLBACK_ITER} итераций подходящий соперник не найден. Проверено уникальных: ${checked.size}`);
    return null;
}

/* ===== АРЕНА ===== */
async function runArenaBattle() {
    console.log(LOG, '=== Арена ===');
    HWHFuncs.setProgress('Арена: подготовка...');
    try {
        const [teamGetAll, teamGetFavor, team_getBanners, userGetInfo] = await Caller.send([
            'teamGetAll', 'teamGetFavor', 'team_getBanners', 'userGetInfo',
        ]);
        const arenaTeam = (teamGetAll?.arena) || [];
        let heroes = arenaTeam.filter(id => id < 6000).slice(0, 5);
        let pet = arenaTeam.filter(id => id >= 6000).pop() || null;
        let favor = (teamGetFavor?.arena) || {};

        const tgb = team_getBanners || {};
        let arenaBannerId = tgb.arena || null;
        let bannerSource = 'team_getBanners.arena';
        if (!arenaBannerId) { arenaBannerId = pickBestBannerId(); bannerSource = 'auto.pickBest'; }
        const banners = arenaBannerId ? [arenaBannerId] : [];
        console.log(LOG, `флаг: ${arenaBannerId} (${bannerSource})`);

        if (!heroes.length) throw new Error('Нет пачки для Арены');

        const settings = loadSettings();
        if (settings.onlyIfNoAttacksTodayArena && hadAttacksToday(userGetInfo, 'arena')) {
            console.log(LOG, 'Арена: сегодня уже атаковали — пропуск');
            HWHFuncs.setProgress('Арена: уже атаковали', 5000);
            return false;
        }
        const tries = getTries(userGetInfo, 'arena');
        if (tries === 0) { HWHFuncs.setProgress('Арена: нет попыток', 5000); return false; }

        HWHFuncs.setProgress('Арена: поиск соперника...', false);
        const target = await findArenaTarget(settings, userGetInfo?.clanId);
        if (!target) {
            HWHFuncs.setProgress('Арена: подходящий соперник не найден', 5000);
            return false;
        }
        const { enemy, best, defHeroes, defPet } = target;
        console.log(LOG, 'Арена: бой с', enemy.user?.name || enemy.userId);
        console.log(LOG, `Арена: проверено уникальных соперников: ${target.checkedCount}`);
        if (!best) console.log(LOG, 'Арена: сработал фолбэк — бой текущей пачкой');

        if (best) {
            heroes = best.attackerPack.slice();
            pet = best.attackerPet;
            const newFavor = {};
            for (const hid of heroes) {
                if (best.attackerFavor?.[hid]) newFavor[hid] = best.attackerFavor[hid];
                else if (favor[hid]) newFavor[hid] = favor[hid];
            }
            favor = newFavor;
            console.log(LOG, `Арена: используем лучшую пачку: [${heroes.join(',')}] пет ${pet || '-'} (сим ${(best.simProbability * 100).toFixed(0)}%)`);
        } else {
            console.log(LOG, 'Арена: истории >= порога нет — атакуем текущей пачкой');
        }

        const args = { userId: +enemy.userId, heroes, favor };
        if (pet) args.pet = pet;
        if (banners.length) args.banners = banners;

        let result;
        try {
            result = await Caller.send({ name: 'arenaAttack', args });
            if (result === null) {
                console.warn(LOG, 'arenaAttack: сервер вернул null (возможно, ошибка сети или сессии)');
                HWHFuncs.setProgress('Арена: сервер не ответил, попробуйте ещё раз', 5000);
                return false;
            }
        } catch (e) {
            if (handleRefillError(e, 'arena')) return false;
            throw e;
        }

        await pruneOldBattlesIfNeeded();
        reportBattleResult(result, 'Арена', 'arena');

        const battle = result?.battles?.[0];
        const heroesForSave = heroes.slice();
        const petForSave = pet;
        const favorForSave = { ...favor };
        const defHeroesForSave = defHeroes.slice();
        const defPetForSave = defPet;
        const enemyForSave = enemy;
        const userInfoForSave = userGetInfo;

        if (settings.saveHistory) {
            (async () => {
                try {
                    let probability = null;
                    if (battle) {
                        probability = await calcProbability(battle, SIM_COUNT);
                        console.log(LOG, `Арена: probability = ${probability !== null ? (probability*100).toFixed(0) + '%' : 'н/д'}`);
                    }
                    if (probability !== null && probability >= MIN_PROBABILITY_TO_SAVE) {
                        await saveBattleToDB({
                            ts: Date.now(),
                            attackerPack: heroesForSave.slice().sort((a, b) => a - b),
                            attackerPet: petForSave,
                            attackerFavor: favorForSave,
                            defenderPack: defHeroesForSave.slice().sort((a, b) => a - b),
                            defenderPet: defPetForSave,
                            win: !!battle?.result?.win,
                            probability,
                            defenderName: enemyForSave.user?.name || '',
                            defenderClanId: enemyForSave.user?.clanId ? String(enemyForSave.user.clanId) : null,
                            attackerClanId: userInfoForSave?.clanId ? String(userInfoForSave.clanId) : null,
                            source: 'arena',
                            replayId: battle?.id
                        });
                    } else {
                        const probStr = probability === null ? 'н/д' : `${(probability * 100).toFixed(0)}%`;
                        console.log(LOG, `Арена: бой не сохранён — probability ${probStr} < ${Math.round(MIN_PROBABILITY_TO_SAVE * 100)}%`);
                    }
                    await importArenaHistoryFromServer(1);
                } catch (e) {
                    console.warn(LOG, 'фоновый расчёт Арены ошибка:', e);
                }
            })();
        } else {
            console.log(LOG, 'Арена: сохранение истории выключено — расчёт вероятности и запись в БД пропущены');
        }

        return true;
    } catch (e) {
        console.error(LOG, 'ошибка (Арена):', e);
        HWHFuncs.setProgress('Арена: ошибка — ' + e.message, 5000);
        return false;
    }
}

/* ===== АВТОСМЕНА ЗАЩИТЫ ГРАНД-АРЕНЫ ===== */
async function readGrandDefense() {
    const names = ['arenaGetAll', 'teamGetFavor', 'team_getBanners'];
    const [arenaAll, favor, banners] = await Caller.send(names);

    const teams = arenaAll?.grandHeroes;
    if (!Array.isArray(teams) || teams.length === 0) {
        throw new Error('grandArenaNotAvailable');
    }
    if (teams.length !== 3) {
        throw new Error('grandHeroes не содержит 3 пачки');
    }

    const heroes = [];
    const pets = [];
    for (const team of teams) {
        if (!Array.isArray(team)) throw new Error('Некорректный состав пачки');
        const units = team.map(u => Number(u?.id ?? u));
        const teamHeroes = units.filter(id => id < 6000);
        const teamPets = units.filter(id => id >= 6000);
        if (teamHeroes.length !== 5) throw new Error('В пачке не 5 героев');
        heroes.push(teamHeroes);
        pets.push(teamPets[0] || 0);
    }

    const rawBanners = banners?.grand_def;
    if (!Array.isArray(rawBanners) || rawBanners.length !== 3) {
        throw new Error('Нет grand_def флагов');
    }
    const bannerIds = rawBanners.map(v => (v === null ? 0 : Number(v?.id ?? v)));

    const rawFavor = favor?.grand_def;
    const favorObj = (rawFavor && typeof rawFavor === 'object' && !Array.isArray(rawFavor)) ? { ...rawFavor } : {};

    return { heroes, pets, banners: bannerIds, favor: favorObj };
}

async function shuffleGrandDefense() {
    if (grandShuffleBusy) return false;
    grandShuffleBusy = true;
    try {
        const def = await readGrandDefense();

        const orders = [
            [1, 0, 2], [2, 1, 0], [0, 2, 1],
            [1, 2, 0], [2, 0, 1],
        ];
        const order = orders[Math.floor(Math.random() * orders.length)];

        const args = {
            heroes:  order.map(i => def.heroes[i].slice()),
            pets:    order.map(i => def.pets[i]),
            favor:   { ...def.favor },
            banners: order.map(i => def.banners[i]),
        };

        const response = await Caller.send({
            name: 'grandSetHeroes',
            args,
            ident: 'grandSetHeroes',
        });

        const rpcError = response?.error || response?.results?.find(r => r.result?.error)?.result.error;
        if (rpcError) {
            throw new Error(rpcError.description || rpcError.message || 'Ошибка grandSetHeroes');
        }
        console.log(LOG, `ГА: защита переставлена в порядке [${order.join(', ')}]`);
        return true;
    } catch (e) {
        if (e.message === 'grandArenaNotAvailable') {
            console.log(LOG, 'ГА: ещё не открыта на этом аккаунте — автосмена остановлена');
            grandShuffleEnabled = false;
            if (grandShuffleTimer) { clearTimeout(grandShuffleTimer); grandShuffleTimer = null; }
            return false;
        }
        console.warn(LOG, 'ГА: ошибка перестановки защиты:', e);
        return false;
    } finally {
        grandShuffleBusy = false;
    }
}

function startGrandShuffle() {
    if (grandShuffleTimer) return;

    try {
        const sm = HWHClasses?.ScriptMenu?.getInst?.();
        if (!sm?.status) {
            setTimeout(startGrandShuffle, 1000);
            return;
        }
    } catch (e) {
        setTimeout(startGrandShuffle, 1000);
        return;
    }

    const settings = loadSettings();
    const intervalSec = Math.max(5, Math.min(3600, Number(settings.grandShuffleIntervalSec) || 15));

    grandShuffleEnabled = true;
    console.log(LOG, `ГА: автосмена защиты запущена (каждые ${intervalSec} сек)`);
    try {
        HWHFuncs.setProgress(`ГА: автосмена защиты каждые ${intervalSec} сек`, 4000);
    } catch (e) {}

    const tick = async () => {
        if (!grandShuffleEnabled) return;
        try { await shuffleGrandDefense(); } catch (e) {}
        if (grandShuffleEnabled) {
            const s = loadSettings();
            const sec = Math.max(5, Math.min(3600, Number(s.grandShuffleIntervalSec) || 15));
            grandShuffleTimer = setTimeout(tick, sec * 1000);
        }
    };
    tick();
}

function stopGrandShuffle() {
    grandShuffleEnabled = false;
    if (grandShuffleTimer) {
        clearTimeout(grandShuffleTimer);
        grandShuffleTimer = null;
    }
    console.log(LOG, 'ГА: автосмена защиты остановлена');
    try {
        HWHFuncs.setProgress('ГА: автосмена защиты остановлена', 4000);
    } catch (e) {}
}

/* ===== ГРАНД-АРЕНА ===== */
async function runGrandArenaBattle() {
    console.log(LOG, '=== Гранд-Арена ===');
    HWHFuncs.setProgress('Гранд-Арена: подготовка...');
    try {
        const [teamGetAll, teamGetFavor, team_getBanners, userGetInfo] = await Caller.send([
            'teamGetAll', 'teamGetFavor', 'team_getBanners', 'userGetInfo',
        ]);
        const grandTeams = (teamGetAll?.grand) || [];
        if (grandTeams.length < 3) throw new Error('Нет 3 пачек для ГА');
        let heroesArr = grandTeams.map(t => (t || []).filter(id => id < 6000).slice(0, 5));
        let petsArr   = grandTeams.map(t => (t || []).filter(id => id >= 6000).pop() || null);
        let favor     = (teamGetFavor?.grand) || {};
        const raw = (team_getBanners?.grand) || [];
        const banners = [0, 1, 2].map(i => raw[i] || null);

        const settings = loadSettings();
        if (settings.onlyIfNoAttacksTodayGrand && hadAttacksToday(userGetInfo, 'grandArena')) {
            console.log(LOG, 'Гранд-арена: сегодня уже атаковали — пропуск');
            HWHFuncs.setProgress('Гранд-арена: уже атаковали', 5000);
            return false;
        }
        const tries = getTries(userGetInfo, 'grandArena');
        if (tries === 0) { HWHFuncs.setProgress('Гранд-арена: нет попыток', 5000); return false; }

        HWHFuncs.setProgress('Гранд-арена: поиск соперника...', false);
        const target = await findGrandTarget(settings, userGetInfo?.clanId, heroesArr, petsArr, favor);
        if (!target) {
            HWHFuncs.setProgress('Гранд-арена: подходящий соперник не найден', 5000);
            return false;
        }
        const { enemy, best } = target;
        console.log(LOG, 'Гранд-арена: бой с', enemy.user?.name || enemy.userId);
        console.log(LOG, `Гранд-арена: проверено уникальных соперников: ${target.checkedCount}`);
        if (!best) console.log(LOG, 'Гранд-арена: сработал фолбэк — бой текущими пачками');

        if (best) {
            // best.heroesArr / petsArr — длина 3, индекс = позиция; null = не нашли
            heroesArr = best.heroesArr.map((h, i) => h || heroesArr[i]);
            petsArr   = best.petsArr.map((p, i) => p !== null ? p : petsArr[i]);
            favor = best.favor;

            console.log(LOG, `Гранд-арена: пачек >= порога: ${best.stats.length}`);
            best.stats.forEach(s =>
                console.log(`   позиция #${s.position + 1}: ${(s.prob * 100).toFixed(0)}% (${s.wins}/${s.total}) против [${s.vsDefHeroes.join(',')}]|${s.vsDefPet || '-'}`)
            );
            console.log(LOG, 'Гранд-арена: порядок пачек сохранён по позициям защит, флаги остаются на своих позициях');
        } else {
            console.log(LOG, 'Гранд-арена: истории >= порога нет — атакуем текущими пачками');
        }

        const args = {
            userId: +enemy.userId,
            heroes: heroesArr,
            pets:   petsArr,
            favor,
            banners,
        };

        let result;
        try {
            result = await Caller.send({ name: 'grandAttack', args });
            if (result == null) {
                console.warn(LOG, 'grandAttack: сервер вернул null (скорее всего HTTP 500 из-за невалидных аргументов)');
                HWHFuncs.setProgress('Гранд-арена: сервер отклонил запрос, попробуйте позже', 5000);
                return false;
            }
        } catch (e) {
            if (handleRefillError(e, 'grandArena')) return false;
            throw e;
        }

        await pruneOldBattlesIfNeeded();
        reportBattleResult(result, 'Гранд-Арена', 'grandArena');

        const battles = result?.battles || [];
        const enemyForSave = enemy;
        const userInfoForSave = userGetInfo;
        if (settings.saveHistory) {
            (async () => {
                try {
                    for (let i = 0; i < battles.length; i++) {
                        const b = battles[i];
                        const atk = extractPackFromTeam(b.attackers || {});
                        const defArr = Array.isArray(b.defenders) ? b.defenders : [b.defenders];
                        const def = extractPackFromTeam(defArr[0] || {});
                        if (!atk.heroes.length) continue;

                        const prob = await calcProbabilityForReplay(b);
                        if (prob !== null && prob >= MIN_PROBABILITY_TO_SAVE) {
                            await saveGrandBattleToDB({
                                ts: Date.now() + i,
                                replayId: b.id || `g_${enemyForSave.userId}_${Date.now()}_${i}`,
                                defenderId: String(enemyForSave.userId),
                                defenderName: enemyForSave.user?.name || '',
                                defenderClanId: enemyForSave.user?.clanId ? String(enemyForSave.user.clanId) : null,
                                attackerClanId: userInfoForSave?.clanId ? String(userInfoForSave.clanId) : null,
                                attackerPack: atk.heroes,
                                attackerPet: atk.pet,
                                attackerFavor: atk.favor,
                                defenderPack: def.heroes,
                                defenderPet: def.pet,
                                defenderFavor: def.favor,
                                win: !!b.result?.win,
                                probability: prob,
                                battleOrder: b.result?.battleOrder ?? i,
                                source: 'grandArena',
                            });
                        }
                    }
                    await importArenaHistoryFromServer(1);
                } catch (e) {
                    console.warn(LOG, 'фоновый расчёт ГА ошибка:', e);
                }
            })();
        } else {
            console.log(LOG, 'ГА: сохранение истории выключено — расчёт вероятности и запись в БД пропущены');
        }

        return true;
    } catch (e) {
        console.error(LOG, 'ошибка (ГА):', e);
        HWHFuncs.setProgress('Гранд-арена: ошибка — ' + e.message, 5000);
        return false;
    }
}

/* ===== КНОПКИ ===== */
function ensureSquareButtonStyle() {
    const STYLE_ID = 'hwh-one-arena-square-btn-v5';
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = `
        .PopUp_btnGap.fixedSquare {
            flex: 0 0 auto !important;
            width: 40px !important;
            min-width: 40px !important;
            max-width: 40px !important;
            height: 40px !important;
            padding-left: 2px !important;
            padding-right: 2px !important;
            box-sizing: border-box !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
        }
        .PopUp_btnGap.fixedSquare .PopUp_btnPlate {
            min-width: 0 !important;
            width: 100% !important;
            height: 100% !important;
            padding: 0 !important;
            font-size: 18px !important;
            line-height: 1 !important;
            overflow: visible !important;
            box-sizing: border-box !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
        }
    `;
    document.head.appendChild(st);
}
function ensureFriendBtnStyle() {
    if (!document.getElementById('hwh-arena-friend-btns')) {
        const st = document.createElement('style');
        st.id = 'hwh-arena-friend-btns';
        st.textContent = `
        .PopUp_blocks > .PopUp_btnSocket:has(.arenaFriendBtn) {
            align-self: stretch;
            width: 100%;
            box-sizing: border-box;
            padding: 4px 6px 6px 6px;
        }
        .PopUp_blocks > .PopUp_btnSocket > .PopUp_btnRow {
            width: 100%;
            box-sizing: border-box;
            gap: 4px;
        }
        .PopUp_btnRow .PopUp_btnGap.arenaFriendBtn {
            flex: 1 1 0;
            min-width: 0;
            box-sizing: border-box;
            padding-left: 0;
            padding-right: 0;
        }
        .PopUp_btnRow .PopUp_btnGap.arenaFriendBtn .PopUp_btnPlate {
            width: 100%;
            min-width: 0;
            box-sizing: border-box;
            padding-left: 4px;
            padding-right: 4px;
            font-size: 14px;
            white-space: nowrap;
        }
    `;
        document.head.appendChild(st);
    }
}
function installActionButtons() {
    const arr = HWHData.actionsPopupButtons;
    if (!arr) return false;
    ensureSquareButtonStyle();
    for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i] && (arr[i].__arena || arr[i].__grandArena || arr[i].__arenaSettings || arr[i].__friendlyClans || arr[i].__arenaHistory)) {
            arr.splice(i, 1);
        }
    }
    arr.push({
        __arena: true,
        get msg() { return 'Провести 1 бой на Арене'; },
        get title() { return 'Провести 1 бой на Арене текущей пачкой'; },
        result() { runArenaBattle(); },
        color: 'red',
    });
    arr.push({
        __arenaSettings: true,
        get msg() { return '⚙️'; },
        get title() { return 'Настройки авто-боя'; },
        result() { openSettingsDialog(); },
        color: 'blue',
        classes: ['fixedSquare'],
    });
    arr.push({
        __grandArena: true,
        get msg() { return 'Провести 1 бой на Гранд-Арене'; },
        get title() { return 'Провести 1 бой на Гранд-Арене (3 пачки)'; },
        result() { runGrandArenaBattle(); },
        color: 'violet',
    });

    console.log(LOG, 'кнопки добавлены: Арена, ⚙️, Гранд-Арена');
    return true;
}
function patchDoYourBest() {
    const Original = HWHClasses.doYourBest;
    if (!Original) return false;
    if (Original.__patched || HWHClasses.doYourBest.__patched) return true;
    if (globalThis.__HWHOneArena_doYourBestPatched) return true;

    class Patched extends Original {
        constructor(...args) {
            super(...args);
            this.funcList = (this.funcList || []).filter(
                f => f.name !== 'oneArenaBattle' && f.name !== 'oneGrandArenaBattle'
            );
            const idx = this.funcList.findIndex(f => f.name === 'testDungeon');
            const arenaItem = { name: 'oneArenaBattle', label: 'Провести 1 бой на арене', checked: false };
            const grandItem = { name: 'oneGrandArenaBattle', label: 'Провести 1 бой на Гранд-Арене', checked: false };
            if (idx >= 0) this.funcList.splice(idx + 1, 0, arenaItem, grandItem);
            else this.funcList.push(arenaItem, grandItem);
            if (!this.functions) this.functions = {};
            this.functions.oneArenaBattle = runArenaBattle;
            this.functions.oneGrandArenaBattle = runGrandArenaBattle;
        }
    }
    Patched.__patched = true;
    HWHClasses.doYourBest = Patched;
    globalThis.__HWHOneArena_doYourBestPatched = true;
    console.log(LOG, 'галочки добавлены в "Сделать всё"');
    return true;
}

let buttonsInstalled = false, doYourBestPatched = false;
function tryInstallAll() {
    if (!buttonsInstalled) buttonsInstalled = installActionButtons();
    if (!doYourBestPatched) doYourBestPatched = patchDoYourBest();
    return buttonsInstalled && doYourBestPatched;
}
tryInstallAll();

let attempts = 0;
const maxAttempts = 120;
const retryTimer = setInterval(() => {
    attempts++;
    const done = tryInstallAll();
    if (done || attempts >= maxAttempts) {
        clearInterval(retryTimer);
        if (done) console.log(`%c${LOG} v${GM_info.script.version} готов`, 'color: #7fff7f');
        else console.warn(LOG, 'не удалось установить элементы за 60 сек');
    }
}, 500);

try { HWHFuncs.Events.on('startGame', () => tryInstallAll()); } catch (e) {}

/* ===== АВТОСТАРТ АВТОСМЕНЫ ГА С РЕТРАЯМИ ===== */
(function scheduleGrandShuffleAutoStart() {
    const START_DELAY_MS = 30000;
    const RETRY_MS = 1000;
    const MAX_RETRIES = 30;
    let attempts = 0;

    function tryStart() {
        attempts++;
        try {
            if (!loadSettings().grandShuffle) {
                console.log(LOG, 'ГА-автостарт: галочка выключена — пропуск');
                return;
            }
            const sm = HWHClasses?.ScriptMenu?.getInst?.();
            if (!sm?.status) {
                if (attempts < MAX_RETRIES) {
                    setTimeout(tryStart, RETRY_MS);
                } else {
                    console.warn(LOG, 'ГА-автостарт: HWH-меню не готово после', MAX_RETRIES, 'попыток');
                }
                return;
            }
            if (grandShuffleEnabled) {
                console.log(LOG, 'ГА-автостарт: уже запущено');
                return;
            }
            console.log(LOG, 'ГА-автостарт: запуск');
            startGrandShuffle();
        } catch (e) {
            console.warn(LOG, 'ошибка автозапуска автосмены ГА:', e);
        }
    }

    setTimeout(tryStart, START_DELAY_MS);
})();
})();
