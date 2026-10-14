// ==UserScript==
// @name         HWHOneArenaBattle
// @name:ru      Авто-бой на арене
// @namespace    HWHOneArenaBattle
// @version      4.0
// @description  Conducts Arena/Grand Arena battles. Filter friendly clans. Arena banner: from UI or auto-pick.
// @description:ru Проводит бой на Арене/Гранд-Арене. Фильтр дружественных гильдий. Арена: баннер из UI или авто-подбор.
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

const REFILL = {
    arena:      { battle: 6,  cooldown: 5,  maxTries: 5, label: 'Арена' },
    grandArena: { battle: 21, cooldown: 20, maxTries: 5, label: 'Гранд-Арена' },
};

const COLOR_PRIORITY = {
    red: 0,
    orange: 1, yellow: 1, gold: 1,
    purple: 2, violet: 2,
    blue: 3,
    green: 4,
    grey: 5, gray: 5, white: 5,
};
function colorRank(color) {
    const c = String(color || '').toLowerCase();
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

/* ===== СПИСОК ГИЛЬДИЙ (для выбора дружественных) ===== */
async function fetchAllClansFromServer() {
    const result = {};
    for (const league of [1, 2, 3, 4]) {
        try {
            const r = await Caller.send({ name: 'clanWarGetLeagueTop', args: { league, current: true } });
            const clans = r?.clans || [];
            for (const c of clans) {
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
            if (c && c.ts && Date.now() - c.ts < 24 * 3600 * 1000 && c.data) {
                console.log(LOG, 'список гильдий: из кэша (24ч)');
                return c.data;
            }
        } catch (e) {}
    }
    const data = await fetchAllClansFromServer();
    try { localStorage.setItem(CLAN_LIST_CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); } catch (e) {}
    return data;
}

/* ===== ДИАЛОГ 1: базовые настройки ===== */
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

/* ===== ДИАЛОГ 2: дружественные гильдии ===== */
async function openFriendlyClansDialog() {
    HWHFuncs.setProgress('Загрузка списка гильдий...');
    const clans = await getAllClansCached();       // { id: title }
    const friends = loadFriendlyClans();

    // Свою гильдию исключаем
    const myClanId = String(HWHFuncs.getUserInfo()?.clanId || '');
    const ids = Object.keys(clans).filter(id => id !== myClanId);
    if (!ids.length) {
        HWHFuncs.popup.confirm('Не удалось получить список гильдий.<br>Попробуйте позже.', [{ msg: 'OK', result: 0, color: 'green' }]);
        return;
    }

    // Сортируем: сначала уже дружественные, потом остальные (по названию)
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
        return openFriendlyClansDialog();   // перезапуск
    }
    if (!result) { console.log(LOG, 'дружественные: отмена'); return; }

    const boxes = HWHFuncs.popup.getCheckBoxes();
    const newFriends = [];
    for (const b of boxes) {
        if (b.name.startsWith('clan_') && b.checked) {
            newFriends.push(b.name.replace('clan_', ''));
        }
    }
    saveFriendlyClans(newFriends);
    console.log(LOG, `дружественных гильдий сохранено: ${newFriends.length}`);
    HWHFuncs.setProgress(`Дружественных: ${newFriends.length}`, 3000);
}

/* ===== ФИЛЬТР СОПЕРНИКОВ ===== */
function isEnemyAllowed(enemy, myClanId, noAttackFriendly) {
    const cid = enemy?.user?.clanId ? String(enemy.user.clanId) : '';
    if (!cid) return true;                              // без клана — атакуем
    if (cid === String(myClanId)) return false;         // своя гильдия — не атакуем
    if (noAttackFriendly && loadFriendlyClans().includes(cid)) return false; // дружественная
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
            const slotsCount = slotKeys.length;
            const colorCounts = [0, 0, 0, 0, 0, 0];
            const colorNames = [];
            for (const sk of slotKeys) {
                const c = slots[sk]?.Yi?.oo || 'grey';
                const rank = colorRank(c);
                if (rank < 6) colorCounts[rank]++;
                colorNames.push(c);
            }
            list.push({ id, name, slotsCount, colorCounts, colorNames });
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
        for (let i = 0; i < 6; i++) {
            if (a.colorCounts[i] !== b.colorCounts[i]) return b.colorCounts[i] - a.colorCounts[i];
        }
        if (a.slotsCount !== b.slotsCount) return b.slotsCount - a.slotsCount;
        return a.id - b.id;
    });

    const top = sorted[0];
    const equals = sorted.filter(b =>
        b.slotsCount === top.slotsCount &&
        b.colorCounts.every((v, i) => v === top.colorCounts[i])
    );

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

/* ===== ОБРАБОТКА ОШИБОК ===== */
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
        console.log(LOG, `${ref.label}: сервер отказал, нет попыток`);
        HWHFuncs.setProgress(`${ref.label}: нет попыток`, 5000);
        return true;
    }
    return false;
}

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
            if (r && r.oldPlace && r.newPlace) { oldPlace = r.oldPlace; newPlace = r.newPlace; break; }
        }
        const grandPlaceNow = result?.state?.grandPlace;
        const score = `${wins}/${total}`;
        const placeInfo = (oldPlace && newPlace) ? `${oldPlace} → ${newPlace}`
                        : grandPlaceNow ? `место: ${grandPlaceNow}` : '';
        console.log(LOG, `Гранд-Арена: счёт ${score}${placeInfo ? `, ${placeInfo}` : ''}`);
        console.log(LOG, 'по боям:', battles.map(b => ({ order: b?.result?.battleOrder, win: b?.result?.win, stars: b?.result?.stars })));
        if (winFinal) {
            console.log(LOG, `Гранд-Арена ПОБЕДА ${score}${placeInfo ? ` (${placeInfo})` : ''}`);
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

/* ===== АРЕНА ===== */
async function runArenaBattle() {
    console.log(LOG, '=== запуск боя: Арена ===');
    HWHFuncs.setProgress('Арена: подготовка...');
    try {
        const [teamGetAll, teamGetFavor, team_getBanners, userGetInfo] = await Caller.send([
            'teamGetAll', 'teamGetFavor', 'team_getBanners', 'userGetInfo',
        ]);
        const arenaTeam = (teamGetAll?.arena) || [];
        const heroes = arenaTeam.filter(id => id < 6000).slice(0, 5);
        const pet = arenaTeam.filter(id => id >= 6000).pop() || null;
        const favor = (teamGetFavor?.arena) || {};

        const tgb = team_getBanners || {};
        let arenaBannerId = tgb.arena || null;
        let bannerSource = 'team_getBanners.arena';
        if (!arenaBannerId) { arenaBannerId = pickBestBannerId(); bannerSource = 'auto.pickBest'; }
        const banners = arenaBannerId ? [arenaBannerId] : [];
        console.log(LOG, `баннер для арены: ${arenaBannerId} (источник: ${bannerSource})`);

        if (!heroes.length) throw new Error('Не задана пачка для Арены');

        const settings = loadSettings();
        if (settings.onlyIfNoAttacksTodayArena && hadAttacksToday(userGetInfo, 'arena')) {
            console.log(LOG, 'Арена: сегодня уже были атаки — пропускаем');
            HWHFuncs.setProgress('Арена: сегодня уже атаковали', 5000);
            return false;
        }

        const tries = getTries(userGetInfo, 'arena');
        if (tries === 0) { HWHFuncs.setProgress('Арена: нет попыток', 5000); return false; }

        const enemy = await pickArenaEnemy(userGetInfo?.clanId, settings.noAttackFriendlyClans);
        console.log(LOG, 'Арена: бой с', enemy.user?.name || enemy.userId);

        const args = { userId: +enemy.userId, heroes, favor };
        if (pet) args.pet = pet;
        if (banners.length) args.banners = banners;

        let result;
        try { result = await Caller.send({ name: 'arenaAttack', args }); }
        catch (e) { if (handleRefillError(e, 'arena')) return false; throw e; }

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
    console.log(LOG, '=== запуск боя: Гранд-Арена ===');
    HWHFuncs.setProgress('Гранд-Арена: подготовка...');
    try {
        const [teamGetAll, teamGetFavor, team_getBanners, userGetInfo] = await Caller.send([
            'teamGetAll', 'teamGetFavor', 'team_getBanners', 'userGetInfo',
        ]);

        const grandTeams = (teamGetAll?.grand) || [];
        if (grandTeams.length < 3) throw new Error('Не заданы 3 пачки для Гранд-Арены');

        const heroes = grandTeams.map(t => (t || []).filter(id => id < 6000).slice(0, 5));
        const pets   = grandTeams.map(t => (t || []).filter(id => id >= 6000).pop() || null);
        const favor  = (teamGetFavor?.grand) || {};
        const raw = (team_getBanners?.grand) || [];
        const banners = [0, 1, 2].map(i => raw[i] || null);

        const settings = loadSettings();
        if (settings.onlyIfNoAttacksTodayGrand && hadAttacksToday(userGetInfo, 'grandArena')) {
            console.log(LOG, 'ГА: сегодня уже были атаки — пропускаем');
            HWHFuncs.setProgress('Гранд-Арена: сегодня уже атаковали', 5000);
            return false;
        }

        const tries = getTries(userGetInfo, 'grandArena');
        if (tries === 0) { HWHFuncs.setProgress('Гранд-Арена: нет попыток', 5000); return false; }

        const enemy = await pickGrandEnemy(userGetInfo?.clanId, settings.noAttackFriendlyClans);
        console.log(LOG, 'ГА: бой с', enemy.user?.name || enemy.userId);

        const args = { userId: +enemy.userId, heroes, pets, favor, banners };

        let result;
        try { result = await Caller.send({ name: 'grandAttack', args }); }
        catch (e) { if (handleRefillError(e, 'grandArena')) return false; throw e; }

        reportBattleResult(result, 'Гранд-Арена', 'grandArena');
        return true;
    } catch (e) {
        console.error(LOG, 'ошибка (ГА):', e);
        HWHFuncs.setProgress('Гранд-Арена: ошибка — ' + e.message, 5000);
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

    // Арена → ⚙️ → 🌐 → Гранд-Арена
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
        get title() { return 'Дружественные гильдии (не атаковать)'; },
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
            const arenaItem = { name: 'oneArenaBattle', label: 'Провести 1 бой на арене', title: 'Провести 1 бой на арене текущей пачкой', checked: false };
            const grandItem = { name: 'oneGrandArenaBattle', label: 'Провести 1 бой на Гранд-Арене', title: 'Провести 1 бой на Гранд-Арене (3 пачки)', checked: false };
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
