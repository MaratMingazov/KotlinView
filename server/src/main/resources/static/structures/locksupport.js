/*
 * LockSupportRunnableTask — задача, после которой поток паркуется: модель по событиям WebSocket и REST-вызовы.
 * Плитка LockSupport на index.html.
 * Подключение: после base.js и components.js. Всё лежит в объекте LockSupportView.
 *
 * Составной объект, как задача под семафором: LockSupport и задача приходят отдельными объектами, объект ссылается
 * на них через state.lockSupportId / state.taskId. Потоки parker-N склеиваются по имени: работают — в задаче,
 * спят — в LockSupport (park / parkNanos). Собственные события run — вся жизнь потока: от входа до выхода.
 * unpark — клик по плашке потока: кому дали разрешение, видно в args события unpark.
 * Стили — locksupport.css (общее для «комнаты» — .room* в components.css).
 *
 * Картинка — «комната»: бейджи первой строкой, под ними две рамки:
 *
 *   park  unpark
 *              ┌ task ─────────────┐ ┌ parked ──────┐
 *   [thread]   │ [▓▓▓▓░ thread]    │ │ [ thread ]   │   слева — кто только что позвал unpark (HTTP-поток, тает);
 *              └───────────────────┘ └──────────────┘   task — работают (заливка — прогресс задачи),
 *                                                       parked — спят в park / parkNanos (полоска — таймаут)
 *
 * Вышедший из park тает там, где был, причина — в подсказке. Разрешения на картинке нет: JDK его не отдаёт.
 * Видно по поведению: park, вернувшийся без ожидания, тает в рамке parked сразу.
 */
const LockSupportView = (() => {
  const base = '/api/locksupportrunnabletask';
  const PARKING = 'LOCK_SUPPORT_RUNNABLE_TASK';
  const LOCK_SUPPORT = 'LOCK_SUPPORT';
  const TASK = 'RUNNABLE_TASK';
  // Плашка вышедшего из park тает и вспышка unpark гаснет, как бейдж метода: одно событие, один ритм (KV.FADE_MS).
  // Упавший (failed) — дольше, как полоска упавшего run у KV.trackTask: успеть прочитать причину
  const DONE_MS = KV.FADE_MS;
  const FAILED_MS = 4000;
  const UNPARK_MS = KV.FADE_MS;
  const UNPARK_KEEP_MS = 2500; // сколько store помнит unpark: диорама ведёт к цели полицию — ей надо успеть доехать
  const fadeMsOf = p => p.result === 'failed' ? FAILED_MS : DONE_MS;
  const CALLERS_SHOWN = 2; // плашек тех, кто позвал unpark, — не больше (как у пула): место постоянное, рамки не прыгают

  // Как поток паркуется после задачи (ParkMode на сервере): подпись в списке пульта
  const MODES = [['PARK', 'park()'], ['PARK_NANOS', 'parkNanos(timeout)']];

  // ---------- REST ----------
  // Запросы и лог HTTP — UI.call из base.js. Объект появится по событию OBJECT_CREATED (после LockSupport и задачи)

  const create = (durationMs, mode = 'PARK', timeoutMs = 2000) => UI.call('POST', base, { durationMs, mode, timeoutMs });

  // Отказ (404 — поток уже закончил run, 409 — кто-то внутри) событий не порождает: пишем его в строку-уведомление
  async function unparkOf(store, id, thread) {
    const res = await UI.request('POST', `${base}/${id}/unpark`, { thread });
    const item = store.items.get(id);
    if (!res.ok && item) store.notify(item, `unpark(${thread}) ✗ ${KV.errorMessage(res.body?.error)}`);
  }

  async function remove(store, id) {
    const res = await UI.request('DELETE', `${base}/${id}`);
    const item = store.items.get(id);
    if (!res.ok && item) store.notify(item, `remove ✗ ${KV.errorMessage(res.body?.error)}`);
  }

  const operations = [
    // Только run: unpark — клик по плашке потока
    { name: 'run', fields: [],
      title: id => `POST ${base}/${id}/run — run() in a new thread: task.run, then park`,
      run: id => UI.call('POST', `${base}/${id}/run`) },
  ];

  // ---------- Модель ----------

  /**
   * store.items — objectId → { id, lockSupportId, taskId, mode, timeoutMs, threads, unparks, notice }:
   * threads — поток → { stage, parkedAt, timeoutMs, result, leftAt } по этапам:
   *   work — внутри run объекта, ещё не в park (работает задача: прогресс — в store.tasks);
   *   parked — внутри park / parkNanos (timeoutMs — у parkNanos, parkedAt — для отсчёта);
   *   done — park вернулся (doneAt), result — почему: returned / timeout / interrupted (failed — park бросил исключение);
   *   leftAt — вышел из run объекта: плашка тает (DONE_MS, упавший — FAILED_MS) и пропадает;
   * unparks — недавние unpark (UNPARK_KEEP_MS) { thread, threadState, by, targetStage, at }: threadState — состояние
   * цели в момент вызова (args), by — кто позвал unpark (HTTP-поток: разрешение даёт другой поток), targetStage — этап
   * цели (work / parked) на METHOD_IN unpark: запись — на входе, а не на выходе, — разбуженный поток мог выйти из park
   * раньше, чем пришёл METHOD_OUT unpark (их шлют разные потоки), а на входе цель ещё точно не проснулась.
   * store.lockSupports — lockSupportId → { id, parked, methods } (бейджи park / parkNanos / unpark);
   * store.tasks — задачи (KV.trackTask): прогресс работы у каждого потока свой
   */
  function createStore(render) {
    const items = new Map();
    const lockSupports = new Map();
    const tasks = new Map();

    function apply(env) {
      const d = env.data;
      switch (d?.objectType) {
        case PARKING: applyItem(env, d); break;
        case LOCK_SUPPORT: applyLockSupport(env, d); break;
        case TASK: KV.trackTask(tasks, env, render); break;
      }
    }

    function itemOf(id) {
      if (!items.has(id)) {
        items.set(id, { id, lockSupportId: null, taskId: null, mode: null, timeoutMs: null, threads: new Map(), unparks: [], notice: null });
      }
      return items.get(id);
    }

    // Поток объекта; страницу могли открыть, когда он уже внутри — тогда заводим по первому его событию
    function parkerOf(item, thread) {
      if (!item.threads.has(thread)) item.threads.set(thread, { stage: 'work', parkedAt: null, doneAt: null, timeoutMs: null, result: null, leftAt: null });
      return item.threads.get(thread);
    }

    function applyItem(env, d) {
      if (env.type === 'OBJECT_REMOVED') { items.delete(d.objectId); return; }
      const item = itemOf(d.objectId);
      // Ссылки на части и способ парковки — в любом событии: страницу могли открыть уже после создания
      if (d.state) {
        const { lockSupportId, taskId, mode, timeoutMs } = d.state;
        Object.assign(item, { lockSupportId, taskId, mode, timeoutMs });
      }
      if (d.method !== 'run') return;
      if (env.type === 'METHOD_IN') {
        item.threads.set(d.thread, { stage: 'work', parkedAt: null, doneAt: null, timeoutMs: null, result: null, leftAt: null });
      } else if (env.type === 'METHOD_OUT' || env.type === 'METHOD_OUT_FAILED') {
        // Вышел из run (park вернулся или задача упала): плашка тает, потом пропадает
        const p = parkerOf(item, d.thread), leftAt = performance.now();
        if (env.type === 'METHOD_OUT_FAILED' && p.stage !== 'done') Object.assign(p, { stage: 'done', doneAt: leftAt, result: 'failed' });
        p.leftAt = leftAt;
        setTimeout(() => { if (item.threads.get(d.thread)?.leftAt === leftAt) { item.threads.delete(d.thread); render(); } }, fadeMsOf(p));
      }
    }

    function applyLockSupport(env, d) {
      if (env.type === 'OBJECT_REMOVED') { lockSupports.delete(d.objectId); return; }
      if (!lockSupports.has(d.objectId)) {
        lockSupports.set(d.objectId, { id: d.objectId, parked: [], methods: KV.methodsState(['park', 'parkNanos', 'unpark']) });
      }
      const ls = lockSupports.get(d.objectId);
      if (d.state) ls.parked = d.state.parked ?? [];
      const phase = KV.trackMethod(ls.methods, env);
      if (!phase) return;
      // Чей это LockSupport: объект ссылается на него через lockSupportId (пришёл раньше — OBJECT_CREATED частей первыми)
      const item = [...items.values()].find(i => i.lockSupportId === d.objectId);
      if (!item) return;
      const now = performance.now();
      if (d.method === 'park' || d.method === 'parkNanos') {
        const p = parkerOf(item, d.thread);
        if (phase === 'IN') Object.assign(p, { stage: 'parked', parkedAt: now, timeoutMs: d.args?.timeoutMs ?? null });
        else Object.assign(p, { stage: 'done', doneAt: now, result: phase === 'OUT' ? d.result : 'failed' });
      } else if (d.method === 'unpark' && phase === 'IN') {
        // На входе: цель ещё не проснулась — её этап сейчас честный (см. unparks). by — кто позвал (HTTP-поток)
        item.unparks = item.unparks.filter(u => now - u.at < UNPARK_KEEP_MS);
        item.unparks.push({ thread: d.args.thread, threadState: d.args.threadState, by: d.thread,
          targetStage: item.threads.get(d.args.thread)?.stage ?? null, at: now });
        setTimeout(render, UNPARK_MS);      // вспышка в плитке погасла
        setTimeout(render, UNPARK_KEEP_MS); // диорама: визит полиции закончился
      }
    }

    const notify = (item, text) => KV.notify(item, text, render);

    return { items, lockSupports, tasks, apply, notify };
  }

  // Недавние unpark объекта (store удаляет старые только при новом unpark): плитке — за UNPARK_MS (вспышка),
  // диораме — за UNPARK_KEEP_MS (визит полиции)
  const recentUnparks = (item, ms = UNPARK_MS) => item.unparks.filter(u => performance.now() - u.at < ms);

  // ---------- Отрисовка ----------

  const WAIT_MS = 50; // park вернулся быстрее — «без ожидания»: разрешение уже было (или ложное пробуждение)

  /**
   * Первой строкой — бейджи метода парковки (park или parkNanos — по mode) и unpark, под ними — «комната»;
   * ниже — уведомление об отказе remove / unpark. LockSupport ещё нет в модели (страницу открыли позже) — без бейджей
   */
  function renderState(store, item) {
    const ls = item.lockSupportId != null ? store.lockSupports.get(item.lockSupportId) : null;
    const task = store.tasks.get(item.taskId) ?? { durationMs: null, runs: new Map() };
    const park = item.mode === 'PARK_NANOS' ? 'parkNanos' : 'park';
    const out = ls ? [KV.renderBadges(ls.methods, [park, 'unpark'])] : [];
    const working = KV.el('div', 'room ls-room'), parked = KV.el('div', 'room ls-room');
    working.append(KV.el('span', 'room-label', 'task'));
    parked.append(KV.el('span', 'room-label', 'parked'));
    working.title = `task.run(): works ${KV.seconds(task.durationMs)}, then ${park}()`;
    parked.title = item.mode === 'PARK_NANOS' ? `inside parkNanos(${KV.seconds(item.timeoutMs)})` : 'inside park(): sleeps until unpark';
    const now = performance.now(), unparks = recentUnparks(item);
    for (const [thread, p] of item.threads) {
      const chip = renderChip(store, item, task, thread, p, now, unparks.findLast(u => u.thread === thread));
      // Вышедший из park — там, где спал; упавший до park (задача бросила исключение) — в task
      (p.stage === 'work' || (p.stage === 'done' && p.parkedAt == null) ? working : parked).append(chip);
    }
    const row = KV.el('div', 'room-row');
    row.append(renderCallers(unparks, now), working, parked);
    out.push(row);
    const notice = KV.renderNotice(item);
    if (notice) out.push(notice);
    return out;
  }

  /**
   * Слева от рамок — кто только что позвал unpark (HTTP-поток, его цвет): появляется и тает тем же ритмом, что
   * вспышка цели и бейдж unpark. Первый — ближе к рамке; место постоянное (room-queue entry), как у пула
   */
  function renderCallers(unparks, now) {
    const callers = KV.el('div', 'room-queue entry');
    for (const u of unparks.slice(-CALLERS_SHOWN).reverse()) {
      const chip = KV.roomChip(u.by, `${u.by}: unpark(${u.thread}) — the thread was ${u.threadState}`);
      chip.style.animation = `fade-out ${UNPARK_MS}ms ease-in ${-(now - u.at)}ms forwards`;
      callers.append(chip);
    }
    return callers;
  }

  /**
   * Плашка потока. work — заливка — прогресс задачи; parked — у parkNanos внизу убывает полоска таймаута;
   * done — тает, в подсказке причина выхода. Работающий и спящий — кнопка: клик — unpark этого потока.
   * Недавний unpark — короткая вспышка, в подсказке — состояние цели в момент вызова (args)
   */
  function renderChip(store, item, task, thread, p, now, unpark) {
    const call = p.timeoutMs != null ? `parkNanos(${KV.seconds(p.timeoutMs)})` : 'park()';
    let title, cls = '';
    if (p.stage === 'work') title = `${thread} runs the task, then ${item.mode === 'PARK_NANOS' ? `parkNanos(${KV.seconds(item.timeoutMs)})` : 'park()'}`;
    else if (p.stage === 'parked') title = `${thread} sleeps in ${call}`;
    else {
      const quick = p.parkedAt != null && p.doneAt - p.parkedAt < WAIT_MS;
      title = p.result === 'timeout' ? `${thread}: ${call} timed out`
        : p.result === 'interrupted' ? `${thread}: ${call} returned — the thread was interrupted`
        : p.result === 'failed' ? `${thread}: run failed`
        : quick ? `${thread}: ${call} returned without waiting — a permit was given earlier (or a spurious wakeup)`
        : `${thread}: ${call} returned — unpark (or a spurious wakeup)`;
      cls = `done ${p.result === 'returned' ? '' : 'failed'}`;
    }
    if (unpark) title += ` · unpark() ${Math.round(now - unpark.at)} ms ago, the thread was ${unpark.threadState}`;
    const active = p.stage !== 'done';
    if (active) title += ' · click: unpark';
    const chip = KV.roomChip(thread, title, `${cls} ${active ? 'clickable' : ''}`.trim());

    const run = task.runs.get(thread);
    if (p.stage === 'work' && run?.phase === 'RUN' && task.durationMs) {
      const fill = KV.el('div', 'fill');
      fill.style.animation = `fill-up ${task.durationMs}ms linear ${-Math.min(now - run.startedAt, task.durationMs)}ms forwards`;
      chip.prepend(fill); // подпись — поверх заливки
    }
    if (p.stage === 'parked' && p.timeoutMs != null) {
      const bar = KV.el('div', 'countdown');
      bar.style.animation = `room-count ${p.timeoutMs}ms linear ${-(now - p.parkedAt)}ms forwards`;
      chip.prepend(bar);
    }
    const anims = [];
    if (p.stage === 'done') anims.push(`fade-out ${fadeMsOf(p)}ms ease-in ${-(now - (p.leftAt ?? p.doneAt))}ms forwards`);
    if (unpark) anims.push(`ls-unpark ${UNPARK_MS}ms ease-out ${-(now - unpark.at)}ms forwards`);
    if (anims.length) chip.style.animation = anims.join(', ');
    if (active) chip.onclick = () => unparkOf(store, item.id, thread);
    return chip;
  }


  // ---------- Описание для плитки (tiles.js) ----------

  const types = [PARKING, LOCK_SUPPORT, TASK];

  return {
    title: 'LockSupport',
    // Способ парковки — списком; таймаут — только у parkNanos
    params: [['durationMs', 5000], ['mode', 'PARK', { options: MODES }],
      ['timeoutMs', 2000, { showIf: values => values.mode === 'PARK_NANOS' }]],
    types, createStore, remove, operations, renderState,
    recentUnparks: item => recentUnparks(item, UNPARK_KEEP_MS), // диорама (diorama-locksupport.js)
    // Поля могут не прийти (на index.html параметров нет) — значения по умолчанию
    create: values => create(values.durationMs ?? 5000, values.mode ?? 'PARK', values.timeoutMs ?? 2000),
  };
})();