// ==UserScript==
// @name         HWHOneArenaBattle
// @name:ru      Авто-бой на арене
// @namespace    HWHOneArenaBattle
// @version      4.8
// @description  Conducts Arena/Grand Arena battles. Filter friendly clans. Saves battle history to IndexedDB with simProbability and auto-picks best attacker pack.
// @description:ru Проводит бой на Арене/Гранд-Арене. Фильтр дружественных гильдий. Сохраняет историю боёв в IndexedDB с simProbability и автовыбирает лучшую пачку атаки.
// @author       emz13666
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
const CLAN_LIST_CACHE_KEY = 'HWHOneArenaBattle.clanListCache';
const DB_NAME = 'HWHOneArenaBattle';
const DB_STORE = 'battles';
const DB_NAME_GRAND = 'HWHOneArenaBattle_Grand';
const DB_STORE_GRAND = 'grandBattles';
const MAX_AGE_MS = 120 * 24 * 3600 * 1000;
const PRUNE_KEY = 'HWHOneArenaBattle.lastPrune';
const SIM_COUNT = 10;
const MIN_PROBABILITY_TO_SAVE = 0.6;
const SEEN_REPLAYS_KEY = 'HWHOneArenaBattle.seenReplays';
const SEEN_REPLAYS_MAX = 50;
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
function updateLiveStatus(prefix) {
    liveStatusPrefix = prefix;
    liveStatusStart = Date.now();
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
    onlyIfNoAttacksTodayArena: false,
    onlyIfNoAttacksTodayGrand: false,
    noAttackFriendlyClans: true,
    useBestPackFromHistory: true,
};
function loadSettings() {
    try { return { ...defaultSettings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
    catch (e) { return { ...defaultSettings }; }
}
function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) {}
}
function loadFriendlyClans() {
    try { return JSON.parse(localStorage.getItem(FRIENDLY_CLANS_KEY) || '[]').map(String); }
    catch (e) { return []; }
}
function saveFriendlyClans(arr) {
    try { localStorage.setItem(FRIENDLY_CLANS_KEY, JSON.stringify(arr)); } catch (e) {}
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
        // Оставляем только последние SEEN_REPLAYS_MAX, чтобы не разрослось
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
            { msg: 'Сохранить', result: true, color: 'green' },
            { msg: 'Отмена', result: false, isCancel: true, color: 'red' },
        ],
        [
            { name: 'onlyIfNoAttacksTodayArena', label: 'Арена: атаковать только если не было атак за сегодня', checked: s.onlyIfNoAttacksTodayArena },
            { name: 'onlyIfNoAttacksTodayGrand', label: 'Гранд-Арена: атаковать только если не было атак за сегодня', checked: s.onlyIfNoAttacksTodayGrand },
            { name: 'noAttackFriendlyClans', label: 'Не атаковать дружественные гильдии', checked: s.noAttackFriendlyClans },
            { name: 'useBestPackFromHistory', label: 'При автоатаке искать лучшую пачку в истории боёв', checked: s.useBestPackFromHistory },
        ]
    );
    if (!result) { console.log(LOG, 'настройки: отмена'); return; }
    const boxes = HWHFuncs.popup.getCheckBoxes();
    const newSettings = { ...s };
    for (const b of boxes) if (b.name in newSettings) newSettings[b.name] = b.checked;
    saveSettings(newSettings);
    console.log(LOG, 'настройки сохранены:', newSettings);
    HWHFuncs.setProgress('Настройки сохранены', 3000);
}

/* ===== ДИАЛОГ: дружественные гильдии ===== */
async function openFriendlyClansDialog() {
    HWHFuncs.setProgress('Загрузка списка гильдий...');
    const clans = await getAllClansCached();
    const friends = loadFriendlyClans();
    const myClanId = String(HWHFuncs.getUserInfo()?.clanId || '');
    const ids = Object.keys(clans).filter(id => id !== myClanId);
    if (!ids.length) {
        HWHFuncs.popup.confirm('Не удалось получить список гильдий.<br>Попробуйте позже.', [{ msg: 'OK', result: 0, color: 'green' }]);
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
    if (!result) { console.log(LOG, 'дружественные: отмена'); return; }
    const boxes = HWHFuncs.popup.getCheckBoxes();
    const newFriends = boxes.filter(b => b.name.startsWith('clan_') && b.checked).map(b => b.name.replace('clan_', ''));
    saveFriendlyClans(newFriends);
    console.log(LOG, `дружественных гильдий сохранено: ${newFriends.length}`);
    HWHFuncs.setProgress(`Дружественных: ${newFriends.length}`, 3000);
}

/* ===== ФИЛЬТР СОПЕРНИКОВ ===== */
function isEnemyAllowed(enemy, myClanId, noAttackFriendly) {
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
        const player = Game.GameModel[fnP(Game.GameModel, 'get_instance')]()[protoFn(Game.GameModel, 0)];
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
            list.push({ id, name, slotsCount: slotKeys.length, colorCounts, colorNames });
        }
        return list;
    } catch (e) {
        console.warn(LOG, 'не удалось прочитать флаги:', e);
        return [];
    }
}
function pickBestBannerId() {
    const list = getBannersFromGame();
    if (!list.length) return null;
    const sorted = [...list].sort((a, b) => {
        for (let i = 0; i < 6; i++) if (a.colorCounts[i] !== b.colorCounts[i]) return b.colorCounts[i] - a.colorCounts[i];
        if (a.slotsCount !== b.slotsCount) return b.slotsCount - a.slotsCount;
        return a.id - b.id;
    });
    const top = sorted[0];
    const equals = sorted.filter(b => b.slotsCount === top.slotsCount && b.colorCounts.every((v, i) => v === top.colorCounts[i]));
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
        console.log(LOG, `Гранд-Арена: счёт ${score}${placeInfo ? `, ${placeInfo}` : ''}`);
        console.log(LOG, 'по боям:', battles.map(b => ({ order: b?.result?.battleOrder, win: b?.result?.win, stars: b?.result?.stars })));
        if (winFinal) {
            console.log(LOG, `Гранд-Арена ПОБЕДА ${score}`);
            HWHFuncs.setProgress(`Гранд-Арена: ПОБЕДА`, 5000);
        } else {
            console.log(LOG, `Гранд-Арена ПОРАЖЕНИЕ ${score}`);
            HWHFuncs.setProgress(`Гранд-Арена: ПОРАЖЕНИЕ`, 5000);
        }
        return;
    }

    const r = battles[0]?.result;
    if (r) {
        if (r.win) {
            console.log(LOG, `Арена ПОБЕДА: ${r.oldPlace} → ${r.newPlace}`);
            HWHFuncs.setProgress(`Арена: ПОБЕДА ${r.oldPlace ?? '?'} → ${r.newPlace ?? '?'}<br>Загрузка истории...`, 5000);
        } else {
            console.log(LOG, `Арена ПОРАЖЕНИЕ${r.oldPlace ? ` (${r.oldPlace})` : ''}`);
            HWHFuncs.setProgress(`Арена: ПОРАЖЕНИЕ<br>Загрузка истории...`, 5000);
        }
    } else {
        console.log(LOG, 'Арена: результат не получен');
        HWHFuncs.setProgress('Арена: бой завершён', 5000);
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
        await new Promise(r => setTimeout(r, 0));
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

/* ================================================================= */
/* === ИМПОРТ ИСТОРИИ ИЗ battleGetByType (v4.7)                     = */
/* ================================================================= */
function extractPackFromTeam(teamObj) {
    const units = Object.values(teamObj || {}).filter(u => u && u.id);
    const heroes = units.filter(u => u.id < 6000).map(u => u.id).sort((a, b) => a - b);
    const pet = units.find(u => u.id >= 6000)?.id || null;
    const favor = {};
    for (const u of units) {
        if (u.id < 6000 && u.favorPetId) {
            favor[u.id] = u.favorPetId;
        }
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
        // Сервер отдаёт каждый бой ГА отдельным реплеем: одна моя пачка vs одна защита.
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

    // Загружаем seenReplays из localStorage (переживает перезагрузку страницы)
    const seenReplays = loadSeenReplays();

    // Загружаем существующие replayId из обеих БД
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

            const total = replays.length;
            let idx = 0;

            for (const replay of replays) {
                idx++;
                const replayIdStr = String(replay.id);
                const prefix = `История ${source} [${idx}/${total}]:`;

                // 1. Уже в БД?
                if (existingIds.has(replayIdStr)) {
                    totalDuplicates++; srcDuplicates++;
                    pushLiveStatus(`${prefix} дубликат`);
                    continue;
                }

                // 2. Не моя атака?
                const records = convertReplayToRecords(replay, myUserId, source);
                if (!records) {
                    totalForeign++; srcForeign++;
                    pushLiveStatus(`${prefix} не моя атака`);
                    continue;
                }

                // 3. Уже считали в прошлый раз?
                if (seenReplays.has(replayIdStr)) {
                    totalSeen++; srcSeen++;
                    pushLiveStatus(`${prefix} уже считался, пропуск`);
                    continue;
                }

                // 4. Считаем с живым таймером
                startLiveStatus(`${prefix} расчёт вероятности`);
                const prob = await calcProbabilityForReplay(replay);

                // 5. Низкая вероятность?
                if (prob !== null && prob < MIN_PROBABILITY_TO_SAVE) {
                    totalSkippedLowProb++; srcSkippedProb++;
                    seenReplays.add(replayIdStr);
                    stopLiveStatus(`${prefix} ${(prob * 100).toFixed(0)}% — пропуск (< ${Math.round(MIN_PROBABILITY_TO_SAVE * 100)}%)`);
                    console.log(LOG, `импорт: пропущен replayId=${replay.id} — probability ${(prob * 100).toFixed(0)}% < ${Math.round(MIN_PROBABILITY_TO_SAVE * 100)}%`);
                    continue;
                }

                // 6. Сохраняем
                for (const rec of records) {
                    rec.probability = prob;
                    if (source === 'arena') await saveBattleToDB(rec);
                    else await saveGrandBattleToDB(rec);
                    existingIds.add(replayIdStr);
                    totalImported++; srcImported++;
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

    // Сохраняем seenReplays в localStorage
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
 * Возвращает долю совпадающих героев от размера большей пачки.
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

        // === 1) Точный матч по пачке защитника ===
        const exact = all.filter(r => packKey(r.defenderPack, r.defenderPet) === targetKey);

        // === 2) Фолбэк — нечёткий матч (>= 80% совпадения героев, пет не мешает) ===
        let fuzzy = [];
        if (!exact.length) {
            fuzzy = all.filter(r => {
                const sim = packSimilarity(r.defenderPack || [], defenderHeroes || []);
                if (sim < 0.8) return false;
                if (defenderPet && r.defenderPet && defenderPet !== r.defenderPet) return false;
                return true;
            });
            if (fuzzy.length) {
                console.log(LOG, `точного матча нет — фолбэк на похожих защит (${fuzzy.length} записей)`);
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
    if (!HWHClasses.Database) return null;
    if (!enemyVisibleTeams || !enemyVisibleTeams.length) return null;

    try {
        const dbG = new HWHClasses.Database(DB_NAME_GRAND, DB_STORE_GRAND);
        await dbG.open();
        const all = await dbGetAllGrand(dbG);
        if (!all.length) return null;

        const bestPerDef = [];

        for (const defTeam of enemyVisibleTeams) {
            const defHeroes = (defTeam.heroes || []).filter(h => h.id < 6000).map(h => h.id);
            const defPet    = (defTeam.heroes || []).find(h => h.id >= 6000)?.id || null;
            if (!defHeroes.length) continue;

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

            if (!source.length) continue;

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
                bestPerDef.push({
                    ...best,
                    againstDefHeroes: defHeroes,
                    againstDefPet: defPet,
                });
            }
        }

        if (!bestPerDef.length) return null;

        bestPerDef.sort((a, b) => b.prob - a.prob);

        const selected = [];
        const usedHeroes = new Set();

        for (const p of bestPerDef) {
            if (selected.length >= 3) break;
            if (p.heroes.some(h => usedHeroes.has(h))) continue;
            selected.push(p);
            p.heroes.forEach(h => usedHeroes.add(h));
        }

        for (let i = 0; i < currentHeroesArr.length && selected.length < 3; i++) {
            const pack = currentHeroesArr[i];
            if (!pack || pack.some(h => usedHeroes.has(h))) continue;
            selected.push({ heroes: pack, pet: currentPetsArr[i], favor: currentFavor, prob: 0 });
            pack.forEach(h => usedHeroes.add(h));
        }
        for (let i = 0; i < currentHeroesArr.length && selected.length < 3; i++) {
            if (currentHeroesArr[i]) {
                selected.push({ heroes: currentHeroesArr[i], pet: currentPetsArr[i], favor: currentFavor, prob: 0 });
            }
        }

        const mergedFavor = {};
        for (const s of selected) Object.assign(mergedFavor, s.favor || {});

        return {
            heroesArr: selected.map(s => s.heroes),
            petsArr: selected.map(s => s.pet),
            favor: mergedFavor,
            stats: bestPerDef.map(p => ({
                prob: p.prob,
                wins: p.wins,
                total: p.total,
                vsDefHeroes: p.againstDefHeroes,
            })),
        };
    } catch (e) {
        console.warn(LOG, 'ошибка поиска пачек ГА:', e);
        return null;
    }
}

/* ===== ПОИСК СОПЕРНИКОВ ===== */
async function pickArenaEnemy(myClanId, noAttackFriendly, maxAttempts = 10, delayMs = 1500) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const enemies = await Caller.send('arenaFindEnemies');
        if (!Array.isArray(enemies) || !enemies.length) throw new Error('Сервер не вернул соперников');
        const filtered = enemies.filter(e => isEnemyAllowed(e, myClanId, noAttackFriendly));
        if (filtered.length) {
            const ids = filtered.map(e => e.userId);
            let range = {};
            try { range = await Caller.send({ name: 'arenaCheckTargetRange', args: { ids } }); } catch (e) {}
            const inRange = filtered.filter(e => range[e.userId] !== false);
            if (inRange.length) {
                console.log(LOG, `Арена: соперник с попытки ${attempt}:`, inRange[0].user?.name || inRange[0].userId);
                return inRange[0];
            }
        }
        console.log(LOG, `Арена: попытка ${attempt}/${maxAttempts}: подходящих нет`);
        if (attempt < maxAttempts) await new Promise(r => setTimeout(r, delayMs));
    }
    throw new Error('Не удалось найти соперника (Арена)');
}

async function pickGrandEnemy(myClanId, noAttackFriendly, maxAttempts = 10, delayMs = 1500) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const enemies = await Caller.send('grandFindEnemies');
        if (!Array.isArray(enemies) || !enemies.length) throw new Error('Сервер не вернул соперников (ГА)');
        const filtered = enemies.filter(e => isEnemyAllowed(e, myClanId, noAttackFriendly));
        if (filtered.length) {
            const ids = filtered.map(e => e.userId);
            let range = {};
            try { range = await Caller.send({ name: 'grandCheckTargetRange', args: { ids } }); } catch (e) {}
            const inRange = filtered.filter(e => range[e.userId] !== false);
            if (inRange.length) {
                console.log(LOG, `ГА: соперник с попытки ${attempt}:`, inRange[0].user?.name || inRange[0].userId);
                return inRange[0];
            }
        }
        console.log(LOG, `ГА: попытка ${attempt}/${maxAttempts}: подходящих нет`);
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
        const best = alts[0];
        console.log(LOG, `лучшие пачки (по simProbability):`);
        for (const a of alts) {
            const marker = a.exact > 0 ? '[точных]' : '[фолбэк]';
            console.log(
                `   ${marker} [${a.attackerPack.join(',')}] пет ${a.attackerPet || '-'} → ` +
                `сим ${(a.simProbability * 100).toFixed(0)}%, ` +
                `факт ${a.wins}/${a.total} (${(a.histWinRate * 100).toFixed(0)}%), ` +
                `матчей: ${a.matched}`
            );
        }
        if (best.attackerPack.length !== 5) return null;
        return best;
    } catch (e) {
        console.warn(LOG, 'ошибка выбора пачки:', e);
        return null;
    }
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
        const enemy = await pickArenaEnemy(userGetInfo?.clanId, settings.noAttackFriendlyClans);
        console.log(LOG, 'Арена: бой с', enemy.user?.name || enemy.userId);

        const defHeroes = (enemy.heroes || []).filter(h => h.id < 6000).map(h => h.id);
        const defPet    = (enemy.heroes || []).find(h => h.id >= 6000)?.id || null;

        if (settings.useBestPackFromHistory) {
            HWHFuncs.setProgress('Арена: поиск лучшей пачки для атаки в истории боёв...', false);
            const best = await tryUseBestPack('arena', defHeroes, defPet, heroes, pet);
            if (best) {
                heroes = best.attackerPack.slice();
                pet = best.attackerPet;
                const newFavor = {};
                for (const hid of heroes) {
                    if (best.attackerFavor?.[hid]) {
                        newFavor[hid] = best.attackerFavor[hid];
                    } else if (favor[hid]) {
                        newFavor[hid] = favor[hid];
                    }
                }
                favor = newFavor;
                console.log(LOG, `Арена: используем лучшую пачку из БД: [${heroes.join(',')}] пет ${pet || '-'}`);
                HWHFuncs.setProgress(`Арена: бой с ${enemy.user?.name || enemy.userId}`, false);
            }
        }

        const args = { userId: +enemy.userId, heroes, favor };
        if (pet) args.pet = pet;
        if (banners.length) args.banners = banners;

        let result;
        try { result = await Caller.send({ name: 'arenaAttack', args }); }
        catch (e) { if (handleRefillError(e, 'arena')) return false; throw e; }

        const battle = result?.battles?.[0];
        let probability = null;
        if (battle) {
            HWHFuncs.setProgress('Арена: расчёт вероятности...', false);
            probability = await calcProbability(battle, SIM_COUNT);
            console.log(LOG, `Арена: probability = ${probability !== null ? (probability*100).toFixed(0) + '%' : 'н/д'}`);
        }
        if (probability !== null && probability >= MIN_PROBABILITY_TO_SAVE) {
            await saveBattleToDB({
                ts: Date.now(),
                attackerPack: heroes.slice().sort((a, b) => a - b),
                attackerPet: pet,
                attackerFavor: favor,
                defenderPack: defHeroes.slice().sort((a, b) => a - b),
                defenderPet: defPet,
                win: !!battle?.result?.win,
                probability,
                defenderName: enemy.user?.name || '',
                defenderClanId: enemy.user?.clanId ? String(enemy.user.clanId) : null,
                attackerClanId: userGetInfo?.clanId ? String(userGetInfo.clanId) : null,
                source: 'arena',
                replayId: battle?.id
            });
        } else {
            const probStr = probability === null ? 'н/д' : `${(probability * 100).toFixed(0)}%`;
            console.log(LOG, `Арена: бой не сохранён — probability ${probStr} < ${Math.round(MIN_PROBABILITY_TO_SAVE * 100)}%`);
        }
        await pruneOldBattlesIfNeeded();
        reportBattleResult(result, 'Арена', 'arena');

        // Импорт — в фоне, чтобы не блокировать UI после результата
        (async () => {
            try { await importArenaHistoryFromServer(1); } catch (e) { console.warn(LOG, e); }
        })();

        return true;    } catch (e) {
        console.error(LOG, 'ошибка (Арена):', e);
        HWHFuncs.setProgress('Арена: ошибка — ' + e.message, 5000);
        return false;
    }
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
        const enemy = await pickGrandEnemy(userGetInfo?.clanId, settings.noAttackFriendlyClans);
        console.log(LOG, 'Гранд-арена: бой с', enemy.user?.name || enemy.userId);

        if (settings.useBestPackFromHistory) {
            HWHFuncs.setProgress('Гранд-арена: поиск лучших пачек для атаки в истории боёв...', false);
            const visibleTeams = (enemy.heroes || []).map(teamArr => ({
                heroes: Array.isArray(teamArr) ? teamArr : Object.values(teamArr || {}),
            }));
            if (visibleTeams.length) {
                console.log(LOG, `Гранд-арена: видимых пачек защиты у ${enemy.user?.name || enemy.userId}: ${visibleTeams.length}`);
                const best = await findBestGrandPacks(visibleTeams, heroesArr, petsArr, favor);
                if (best) {
                    heroesArr = best.heroesArr;
                    petsArr = best.petsArr;
                    favor = best.favor;
                    console.log(LOG, `Гранд-арена: пачек из истории: ${best.stats.length}`);
                    best.stats.forEach((s, i) =>
                        console.log(`   #${i}: ${(s.prob * 100).toFixed(0)}% (${s.wins}/${s.total}) против [${s.vsDefHeroes.join(',')}]`)
                    );
                }
            }
        }

        const args = {
            userId: +enemy.userId,
            heroes: heroesArr,
            pets:   petsArr,
            favor,
            banners,
        };

        let result;
        try { result = await Caller.send({ name: 'grandAttack', args }); }
        catch (e) { if (handleRefillError(e, 'grandArena')) return false; throw e; }

        await pruneOldBattlesIfNeeded();
        reportBattleResult(result, 'Гранд-Арена', 'grandArena');

        // Расчёт и сохранение ГА — в фоне, чтобы не блокировать UI
        const battles = result?.battles || [];
        const enemyForSave = enemy;
        const userInfoForSave = userGetInfo;
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
        __friendlyClans: true,
        get msg() { return '🌐'; },
        get title() { return 'Дружественные гильдии'; },
        result() { openFriendlyClansDialog(); },
        color: 'green',
        classes: ['fixedSquare'],
    });
    arr.push({
        __arenaHistory: true,
        get msg() { return '📚'; },
        get title() { return 'История боёв: экспорт / импорт / загрузка с сервера'; },
        result() { openHistoryDialog(); },
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

    console.log(LOG, 'кнопки добавлены: Арена, ⚙️, 🌐, 📚, Гранд-Арена');
    return true;
}
function patchDoYourBest() {
    const Original = HWHClasses.doYourBest;
    if (!Original || Original.__patched) return false;
    class Patched extends Original {
        constructor(...args) {
            super(...args);
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

})();
