// ==UserScript==
// @name         HWHOneArenaBattle
// @name:ru      Авто-бой на арене
// @namespace    HWHOneArenaBattle
// @version      4.2
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
const SIM_COUNT = 20;

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
            { name: 'useBestPackFromHistory', label: 'Использовать лучшую пачку из истории (по simProbability)', checked: s.useBestPackFromHistory },
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
    const result = await HWHFuncs.popup.confirm(
        `Дружественные гильдии (${ids.length})`,
        [
            { msg: 'Сохранить', result: true, color: 'green' },
            { msg: 'Обновить список', result: 'refresh', color: 'orange' },
            { msg: 'Отмена', result: false, isCancel: true, color: 'red' },
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

/* ===== БАННЕРЫ ===== */
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
        console.warn(LOG, 'не удалось прочитать баннеры:', e);
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
    console.log(LOG, `равнозначных: ${equals.length} [${equals.map(b => b.id).join(', ')}], выбран: ${picked.id}`);
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
    if (msg.includes('NotEnough') && msg.includes('Refillable ' + ref.battle)) {
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
    if (appliedBanners.length) console.log(LOG, `сервер применил баннеры: [${appliedBanners.join(', ')}]`);

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
            HWHFuncs.setProgress(`Гранд-Арена: ПОБЕДА ${score}`, 5000);
        } else {
            console.log(LOG, `Гранд-Арена ПОРАЖЕНИЕ ${score}`);
            HWHFuncs.setProgress(`Гранд-Арена: ПОРАЖЕНИЕ ${score}`, 5000);
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
async function findBestAttackerPacks(defenderHeroes, defenderPet, topN = 5) {
    if (!HWHClasses.Database) return [];
    try {
        const myDb = new HWHClasses.Database(DB_NAME, DB_STORE);
        await myDb.open();
        const all = await dbGetAll(myDb);
        const targetKey = packKey(defenderHeroes, defenderPet);
        const byAttacker = new Map();
        for (const r of all) {
            if (packKey(r.defenderPack, r.defenderPet) !== targetKey) continue;
            const akey = packKey(r.attackerPack, r.attackerPet);
            if (!byAttacker.has(akey)) {
                byAttacker.set(akey, {
                    attackerPack: r.attackerPack,
                    attackerPet: r.attackerPet,
                    wins: 0,
                    total: 0,
                    simSum: 0,
                    simCount: 0,
                });
            }
            const e = byAttacker.get(akey);
            e.total++;
            if (r.win) e.wins++;
            if (typeof r.probability === 'number') {
                e.simSum += r.probability;
                e.simCount++;
            }
        }
        return [...byAttacker.values()]
            .map(e => ({
                ...e,
                histWinRate: e.total > 0 ? e.wins / e.total : 0,
                simProbability: e.simCount > 0 ? e.simSum / e.simCount : null,
            }))
            .filter(e => e.simProbability !== null)
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
        if (!alts.length) return null;
        const best = alts[0];
        console.log(LOG, `лучшие пачки (по simProbability):`);
        for (const a of alts) {
            console.log(`   [${a.attackerPack.join(',')}] пет ${a.attackerPet || '-'} → сим ${(a.simProbability*100).toFixed(0)}%, факт ${a.wins}/${a.total} (${(a.histWinRate*100).toFixed(0)}%)`);
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
        console.log(LOG, `баннер: ${arenaBannerId} (${bannerSource})`);

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
        });

        await pruneOldBattlesIfNeeded();
        reportBattleResult(result, 'Арена', 'arena');
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

        // Сохраняем каждый бой отдельно + считаем probability для каждого
        const battles = result?.battles || [];
        for (let i = 0; i < battles.length; i++) {
            const b = battles[i];
            const r = b?.result;
            const atkHeroes = heroesArr[i] || [];
            const atkPet    = petsArr[i] || null;
            const defTeam   = enemy.heroes?.[i] || [];
            const defHeroes = defTeam.filter(h => h.id < 6000).map(h => h.id);
            const defPet    = defTeam.find(h => h.id >= 6000)?.id || null;

            HWHFuncs.setProgress(`ГА: расчёт вероятности ${i + 1}/${battles.length}...`, false);
            const probability = await calcProbability(b, SIM_COUNT);
            console.log(LOG, `ГА бой ${i + 1}: probability = ${probability !== null ? (probability*100).toFixed(0) + '%' : 'н/д'}`);

            await saveBattleToDB({
                ts: Date.now() + i,
                attackerPack: atkHeroes.slice().sort((a, b) => a - b),
                attackerPet: atkPet,
                defenderPack: defHeroes.slice().sort((a, b) => a - b),
                defenderPet: defPet,
                win: !!r?.win,
                probability,
                defenderName: enemy.user?.name || '',
                defenderClanId: enemy.user?.clanId ? String(enemy.user.clanId) : null,
                attackerClanId: userGetInfo?.clanId ? String(userGetInfo.clanId) : null,
                source: 'grandArena',
                battleOrder: r?.battleOrder ?? i,
            });
        }

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
function installActionButtons() {
    const arr = HWHData.actionsPopupButtons;
    if (!arr) return false;
    ensureSquareButtonStyle();
    for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i] && (arr[i].__arena || arr[i].__grandArena || arr[i].__arenaSettings || arr[i].__friendlyClans)) {
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
        __grandArena: true,
        get msg() { return 'Провести 1 бой на Гранд-Арене'; },
        get title() { return 'Провести 1 бой на Гранд-Арене (3 пачки)'; },
        result() { runGrandArenaBattle(); },
        color: 'violet',
    });
    console.log(LOG, 'кнопки добавлены: Арена, ⚙️, 🌐, Гранд-Арена');
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
