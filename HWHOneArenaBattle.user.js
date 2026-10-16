// ==UserScript==
// @name         HWHOneArenaBattle
// @name:ru      Авто-бой на арене
// @namespace    HWHOneArenaBattle
// @version      4.5
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
const MAX_AGE_MS = 120 * 24 * 3600 * 1000;
const PRUNE_KEY = 'HWHOneArenaBattle.lastPrune';
const SIM_COUNT = 10;
const MIN_PROBABILITY_TO_SAVE = 0.6;
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
            { name: 'useBestPackFromHistory', label: 'При автоатаке на арене искать лучшую пачку в истории боёв', checked: s.useBestPackFromHistory },
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
    { msg: '  OK  ',        result: true,      color: 'green',  classes: ['arenaFriendBtn'], isOneSocket: true },
    { msg: 'Список',  result: 'refresh', color: 'orange', classes: ['arenaFriendBtn'] },
    { msg: 'Отмена',    result: false,     color: 'red',    isCancel: true, classes: ['arenaFriendBtn'] },
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
            HWHFuncs.setProgress(`Арена: ПОБЕДА ${r.oldPlace ?? '?'} → ${r.newPlace ?? '?'}`, 5000);
        } else {
            console.log(LOG, `Арена ПОРАЖЕНИЕ${r.oldPlace ? ` (${r.oldPlace})` : ''}`);
            HWHFuncs.setProgress(`Арена: ПОРАЖЕНИЕ`, 5000);
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
    }
    if (total === 0) return null;
    return wins / total;
}

/* ===== INDEXEDDB: сохранение и поиск ===== */
function packKey(heroes, pet) {
    const sorted = (heroes || []).slice().sort((a, b) => a - b);
    return sorted.join(',') + '|' + (pet || '');
}
async function dbGetAll(myDb) {
    return new Promise((resolve) => {
        const tx = myDb.db.transaction([DB_STORE], 'readonly');
        const store = tx.objectStore(DB_STORE);
        const req = store.getAll();
        req.onerror = () => resolve([]);
        req.onsuccess = () => resolve(req.result || []);
    });
}
async function dbGetAllKeys(myDb) {
    return new Promise((resolve) => {
        const tx = myDb.db.transaction([DB_STORE], 'readonly');
        const store = tx.objectStore(DB_STORE);
        const req = store.getAllKeys();
        req.onerror = () => resolve([]);
        req.onsuccess = () => resolve(req.result || []);
    });
}
async function pruneOldBattlesIfNeeded() {
    try {
        const last = parseInt(localStorage.getItem(PRUNE_KEY) || '0');
        if (Date.now() - last < 24 * 3600 * 1000) return;
        if (!HWHClasses.Database) return;
        const myDb = new HWHClasses.Database(DB_NAME, DB_STORE);
        await myDb.open();
        const keys = await dbGetAllKeys(myDb);
        const now = Date.now();
        let removed = 0;
        for (const key of keys) {
            const ts = parseInt(String(key).split('_')[1]);
            if (!ts || now - ts > MAX_AGE_MS) { await myDb.delete(key); removed++; }
        }
        localStorage.setItem(PRUNE_KEY, String(now));
        if (removed) console.log(LOG, `прунинг БД: удалено ${removed} записей (старше 120 дн.)`);
    } catch (e) {
        console.warn(LOG, 'ошибка прунинга:', e);
    }
}
async function saveBattleToDB(record) {
    if (!HWHClasses.Database) return;
    try {
        const myDb = new HWHClasses.Database(DB_NAME, DB_STORE);
        await myDb.open();
        const key = 'b_' + record.ts + '_' + Math.random().toString(36).slice(2, 8);
        await myDb.set(key, record);
        console.log(LOG, 'бой сохранён:', key);
    } catch (e) {
        console.warn(LOG, 'не удалось сохранить бой:', e);
    }
}
/* ================================================================= */
/* === ИМПОРТ ИСТОРИИ АРЕНЫ ИЗ battleGetByType (v4.3)              === */
/* ================================================================= */
function extractPackFromTeam(teamObj) {
    const ids = Object.values(teamObj || {})
        .map(u => u && u.id)
        .filter(Boolean);
    const heroes = ids.filter(id => id < 6000).sort((a, b) => a - b);
    const pet = ids.find(id => id >= 6000) || null;
    return { heroes, pet };
}

function convertReplayToRecords(replay, myUserId, source) {
    // battleGetByType: userId — владелец записи (я, если я атакующий);
    // typeId — противник. Моя атака = userId === myId.
    if (String(replay.userId) !== String(myUserId)) return null;

    const ts = (+replay.startTime || Math.floor(Date.now() / 1000)) * 1000;
    const replayId = replay.id;
    const base = {
        ts,
        replayId,
        source,
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
            defenderPack: def.heroes,
            defenderPet: def.pet,
            win: !!replay.result?.win,
            probability: null,
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
    const myDb = new HWHClasses.Database(DB_NAME, DB_STORE);
    await myDb.open();
    const existingIds = new Set(
        (await dbGetAll(myDb)).map(r => String(r.replayId)).filter(Boolean)
    );

    const LIMIT = 20; // сервер не принимает > 20
    let totalImported = 0;
    let totalSkippedLowProb = 0;
    let totalDuplicates = 0;
    let totalForeign = 0;

    console.log(LOG, `=== Импорт истории Арены (myUserId=${myUserId}) ===`);
    HWHFuncs.setProgress('История Арены: загрузка...', false);

    for (const source of ['arena']) {
        const type = source === 'arena' ? 'arena' : 'grand';
        let offset = 0;
        let page = 0;
        let srcImported = 0;

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
            console.log(LOG, `${source} стр.${page}: получено ${replays.length} реплеев (offset=${offset})`);

            if (!replays.length) {
                console.log(LOG, `${source}: пустая страница — конец истории`);
                break;
            }

            for (const replay of replays) {
                if (existingIds.has(String(replay.id))) { totalDuplicates++; continue; }
                const records = convertReplayToRecords(replay, myUserId, source);
                if (!records) {
                    totalForeign++;
                    continue;
                }
               
                const prob = await calcProbabilityForReplay(replay);

                if (prob !== null && prob < MIN_PROBABILITY_TO_SAVE) {
                    totalSkippedLowProb++;
                    console.log(
                        LOG,
                        `импорт: пропущен replayId=${replay.id} — probability ${(prob * 100).toFixed(0)}% < ${Math.round(MIN_PROBABILITY_TO_SAVE * 100)}%`
                    );
                    continue;
                }

                for (const rec of records) {
                    rec.probability = prob;
                    await saveBattleToDB(rec);
                    if (rec.replayId) existingIds.add(String(rec.replayId));
                    totalImported++;
                    srcImported++;
                }
            }

            HWHFuncs.setProgress(
                `История ${source}: стр.${page}, новых ${srcImported}, дублей ${totalDuplicates}`,
                false
            );

            if (replays.length < LIMIT) {
                console.log(LOG, `${source}: последняя страница (получено ${replays.length} < ${LIMIT})`);
                break;
            }
            offset += LIMIT;
            await new Promise(r => setTimeout(r, 200));
        }

        console.log(LOG, `${source}: итог — сохранено ${srcImported}`);
    }

    const summary = `История: +${totalImported} новых (дублей ${totalDuplicates}, не моих атак ${totalForeign}, низкий шанс ${totalSkippedLowProb})`;
    console.log(LOG, summary);
    HWHFuncs.setProgress(summary, 6000);
    return totalImported;
}
/* === Экспорт / Импорт IndexedDB в файл === */

async function exportArenaDB() {
    try {
        const myDb = new HWHClasses.Database(DB_NAME, DB_STORE);
        await myDb.open();
        const all = await dbGetAll(myDb);
        if (!all.length) {
            HWHFuncs.setProgress('БД пуста', 3000);
            return;
        }
        const payload = {
            version: 1,
            exportedAt: new Date().toISOString(),
            scriptVersion: GM_info.script.version,
            records: all,
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
        console.log(LOG, `экспорт: ${all.length} записей`);
        HWHFuncs.setProgress(`Экспорт: ${all.length} записей`, 3000);
    } catch (e) {
        console.error(LOG, 'экспорт ошибка:', e);
        HWHFuncs.setProgress('Экспорт: ошибка', 3000);
    }
}

async function importArenaDB() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    input.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        input.remove();
        if (!file) return;
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            const records = data?.records;
            if (!Array.isArray(records)) throw new Error('Нет поля "records"');

            const myDb = new HWHClasses.Database(DB_NAME, DB_STORE);
            await myDb.open();
            const existing = await dbGetAll(myDb);
            const existingIds = new Set(existing.map(r => String(r.replayId)).filter(Boolean));

            let added = 0, skipped = 0;
            for (const rec of records) {
                if (rec.replayId && existingIds.has(String(rec.replayId))) {
                    skipped++;
                    continue;
                }
                const key = 'b_' + (rec.ts || Date.now()) + '_' + Math.random().toString(36).slice(2, 8);
                await myDb.set(key, rec);
                if (rec.replayId) existingIds.add(String(rec.replayId));
                added++;
            }
            console.log(LOG, `импорт БД: +${added}, пропущено ${skipped}`);
            HWHFuncs.setProgress(`Импорт БД: +${added} (пропущено ${skipped})`, 4000);
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
        'История Арены (IndexedDB)',
        [
            { msg: '💾 Экспорт', result: 'export', color: 'green' },
            { msg: '📂 Импорт', result: 'import', color: 'blue' },
            { msg: '🔄 Загрузить с сервера', result: 'server', color: 'orange' },
            { msg: 'Отмена', result: false, isCancel: true, color: 'red' },
        ]
    );
    if (result === 'export') await exportArenaDB();
    else if (result === 'import') await importArenaDB();
    else if (result === 'server') await importArenaHistoryFromServer();
}
/**
 * Насколько похожи две пачки героев.
 * Возвращает долю совпадающих героев от размера большей пачки.
 * 1.0 — полное совпадение, 0.0 — ничего общего.
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
                // Если у обоих есть пет — он должен совпадать, иначе пропускаем
                if (defenderPet && r.defenderPet && defenderPet !== r.defenderPet) return false;
                return true;
            });
            if (fuzzy.length) {
                console.log(LOG, `точного матча нет — фолбэк на похожих защит (${fuzzy.length} записей)`);
            }
        }

        const source = exact.length ? exact : fuzzy;
        if (!source.length) return [];

        // === 3) Группируем по моей пачке и считаем simProbability ===
        const byAttacker = new Map();
        for (const r of source) {
            const akey = packKey(r.attackerPack, r.attackerPet);
            if (!byAttacker.has(akey)) {
                byAttacker.set(akey, {
                    attackerPack: r.attackerPack,
                    attackerPet: r.attackerPet,
                    wins: 0,
                    total: 0,
                    simSum: 0,
                    simCount: 0,
                    matched: 0,        // сколько записей попало в эту группу
                    exact: 0,          // сколько из них — точный матч по защите
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
        const favor = (teamGetFavor?.arena) || {};

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

        const enemy = await pickArenaEnemy(userGetInfo?.clanId, settings.noAttackFriendlyClans);
        console.log(LOG, 'Арена: бой с', enemy.user?.name || enemy.userId);

        const defHeroes = (enemy.heroes || []).filter(h => h.id < 6000).map(h => h.id);
        const defPet    = (enemy.heroes || []).find(h => h.id >= 6000)?.id || null;

        // Автовыбор лучшей пачки из истории
        if (settings.useBestPackFromHistory) {
            const best = await tryUseBestPack('arena', defHeroes, defPet, heroes, pet);
            if (best) {
                heroes = best.attackerPack.slice();
                pet = best.attackerPet;
                console.log(LOG, `Арена: используем лучшую пачку из БД: [${heroes.join(',')}] пет ${pet || '-'}`);
            }
        }

        const args = { userId: +enemy.userId, heroes, favor };
        if (pet) args.pet = pet;
        if (banners.length) args.banners = banners;

        let result;
        try { result = await Caller.send({ name: 'arenaAttack', args }); }
        catch (e) { if (handleRefillError(e, 'arena')) return false; throw e; }

        // Probability + сохранение
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
        try { await importArenaHistoryFromServer(1); } catch (e) { console.warn(LOG, e); }
        return true;
    } catch (e) {
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
        const favor  = (teamGetFavor?.grand) || {};
        const raw = (team_getBanners?.grand) || [];
        const banners = [0, 1, 2].map(i => raw[i] || null);

        const settings = loadSettings();
        if (settings.onlyIfNoAttacksTodayGrand && hadAttacksToday(userGetInfo, 'grandArena')) {
            console.log(LOG, 'ГА: сегодня уже атаковали — пропуск');
            HWHFuncs.setProgress('ГА: уже атаковали', 5000);
            return false;
        }
        const tries = getTries(userGetInfo, 'grandArena');
        if (tries === 0) { HWHFuncs.setProgress('ГА: нет попыток', 5000); return false; }

        const enemy = await pickGrandEnemy(userGetInfo?.clanId, settings.noAttackFriendlyClans);
        console.log(LOG, 'ГА: бой с', enemy.user?.name || enemy.userId);

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
        return true;
    } catch (e) {
        console.error(LOG, 'ошибка (ГА):', e);
        HWHFuncs.setProgress('ГА: ошибка — ' + e.message, 5000);
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
        /* Сокет и ряд растягиваем на всю ширину, но с внутренними отступами */
        .PopUp_blocks > .PopUp_btnSocket:has(.arenaFriendBtn) {
            align-self: stretch;
            width: 100%;
            box-sizing: border-box;
            padding: 4px 6px 6px 6px;
        }
        .PopUp_blocks > .PopUp_btnSocket > .PopUp_btnRow {
            width: 100%;
            box-sizing: border-box;
            gap: 4px;               /* отступ между кнопками */
        }

        /* Кнопки одинаковой ширины, ничего не вылезает */
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
        get title() { return 'История Арены: экспорт / импорт / загрузка с сервера'; },
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
