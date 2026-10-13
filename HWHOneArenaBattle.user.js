// ==UserScript==
// @name         HWHOneArenaBattle
// @name:ru      Авто-бой на арене
// @namespace    HWHOneArenaBattle
// @version      1.3
// @description  Conducts one Arena battle with the current team against any suggested opponent (except guildmates). Adds a checkbox to the "Do All" form and a button to the "Actions" menu.
// @description:ru Проводит один бой на арене текущей пачкой с любым предложенным соперником (кроме согильдийца). Добавляет галочку в форму "Сделать всё" и кнопку в меню "Действия".
// @author       emz13666
// @license      MIT
// @homepage     https://github.com/emz13666/HWHOneArenaBattle
// @supportURL   https://github.com/emz13666/HWHOneArenaBattle/issues
// @source       https://github.com/emz13666/HWHOneArenaBattle
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmQyNGQiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSIxMCIvPjxjaXJjbGUgY3g9IjEyIiBjeT0iMTIiIHI9IjYiLz48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSIyIi8+PC9zdmc+
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

  const LOG = '[HWH One Arena]';
  const SCRIPT_NAME = GM_info.script.name;
  const SCRIPT_VER = GM_info.script.version;
  const SCRIPT_AUTHOR = GM_info.script.author;

  async function waitForHelper(timeout = 60000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (
        globalThis.HWHFuncs &&
        globalThis.HWHClasses &&
        globalThis.HWHClasses.doYourBest &&
        globalThis.HWHData &&
        globalThis.Caller
      ) return true;
      await new Promise(r => setTimeout(r, 500));
    }
    return false;
  }

  if (!await waitForHelper()) {
    console.log('%c' + LOG + ' HeroWarsHelper не найден', 'color: red');
    return;
  }

  try {
    HWHFuncs.addExtentionName(SCRIPT_NAME, SCRIPT_VER, SCRIPT_AUTHOR);
    console.log(LOG, 'зарегистрировано как расширение:', SCRIPT_NAME, 'v' + SCRIPT_VER, 'by', SCRIPT_AUTHOR);
  } catch (e) {
    console.warn(LOG, 'не удалось зарегистрировать расширение:', e);
  }

  const { Caller, HWHFuncs, HWHClasses, HWHData } = globalThis;

  async function getArenaPack() {
    let arenaInfo = null;
    try { arenaInfo = await Caller.send('arenaGetInfo'); } catch (e) {}
    const [teamGetAll, teamGetFavor, userGetInfo] = await Caller.send([
      'teamGetAll', 'teamGetFavor', 'userGetInfo',
    ]);
    const arenaTeam = (teamGetAll && teamGetAll.arena) || [];
    const heroes = arenaTeam.filter(id => id < 6000).slice(0, 5);
    const pet = arenaTeam.filter(id => id >= 6000).pop();
    const favor = (teamGetFavor && teamGetFavor.arena) || {};
    const banners = (userGetInfo && userGetInfo.banners)
      || (arenaInfo && arenaInfo.banners)
      || [];
    return { heroes, pet, favor, banners, userGetInfo };
  }

  async function pickEnemy(myClanId, maxAttempts = 10, delayMs = 1500) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const enemies = await Caller.send('arenaFindEnemies');
      if (!Array.isArray(enemies) || !enemies.length) {
        throw new Error('Сервер не вернул соперников');
      }

      const filtered = enemies.filter(e => {
        const cid = e && e.user && e.user.clanId;
        return !cid || String(cid) !== String(myClanId);
      });

      if (filtered.length > 0) {
        const ids = filtered.map(e => e.userId);
        let range = {};
        try {
          range = await Caller.send({ name: 'arenaCheckTargetRange', args: { ids } });
        } catch (e) { range = {}; }
        const inRange = filtered.filter(e => range[e.userId] !== false);
        if (inRange.length > 0) {
          console.log(LOG, `найден соперник с попытки ${attempt}:`, inRange[0].user?.name || inRange[0].userId);
          return inRange[0];
        }
      }

      console.log(LOG, `попытка ${attempt}/${maxAttempts}: подходящих соперников нет (все из гильдии или вне зоны)`);
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
    throw new Error('Не удалось найти подходящего соперника после ' + maxAttempts + ' попыток');
  }

  async function runOneArenaBattle() {
    console.log(LOG, '=== запуск одного боя на арене ===');
    try {
      const { heroes, pet, favor, banners, userGetInfo } = await getArenaPack();
      if (!heroes.length) throw new Error('Не задана пачка для арены');
      console.log(LOG, 'пачка:', { heroes, pet, favor, banners });
      const myClanId = userGetInfo && userGetInfo.clanId;
      const enemy = await pickEnemy(myClanId);
      console.log(LOG, 'бой с', enemy.user?.name || enemy.userId);
      const args = { userId: +enemy.userId, heroes, favor };
      if (pet) args.pet = pet;
      if (banners && banners.length) args.banners = banners;
      const result = await Caller.send({ name: 'arenaAttack', args });
      const battle = result && result.battles && result.battles[0];
      const r = battle && battle.result;
      if (r) {
        if (r.win) {
          console.log(LOG, `ПОБЕДА: ${r.oldPlace} → ${r.newPlace}`);
        } else {
          console.log(LOG, `ПОРАЖЕНИЕ (место: ${r.oldPlace})`);
        }
      } else {
        console.log(LOG, 'бой завершён (результат не получен)');
      }
      console.log(LOG, 'ответ сервера:', result);
      return r && r.win;
    } catch (e) {
      console.error(LOG, 'ошибка:', e);
      return false;
    }
  }

  function installArenaButton() {
    const arr = HWHData.actionsPopupButtons;
    if (!arr || arr.some(b => b && b.__oneArena)) return;
    arr.push({
      __oneArena: true,
      get msg() { return 'Провести 1 бой на арене'; },
      get title() { return 'Провести 1 бой на арене текущей пачкой'; },
      result() { runOneArenaBattle(); },
      color: 'red',
    });
    console.log(LOG, 'кнопка добавлена в меню "Действия"');
  }

  function patchDoYourBest() {
    const Original = HWHClasses.doYourBest;
    if (!Original || Original.__patched) return;
    class Patched extends Original {
      constructor(...args) {
        super(...args);
        this.funcList.push({
          name: 'oneArenaBattle',
          label: 'Провести 1 бой на арене',
          title: 'Провести 1 бой на арене текущей пачкой',
          checked: false,
        });
        this.functions.oneArenaBattle = runOneArenaBattle;
      }
    }
    Patched.__patched = true;
    HWHClasses.doYourBest = Patched;
    console.log(LOG, 'галочка добавлена в форму "Сделать всё"');
  }

  installArenaButton();
  patchDoYourBest();
  try {
    HWHFuncs.Events.on('startGame', () => {
      installArenaButton();
      patchDoYourBest();
    });
  } catch (e) {}

  console.log(`%c${LOG} v${SCRIPT_VER} готов`, 'color: #7fff7f');
})();
