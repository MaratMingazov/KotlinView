/*
 * SemaphoreRunnableTask — задача под семафором: модель по событиям WebSocket, отрисовка и REST-вызовы.
 * Плитка Semaphore на index.html и tiles.html.
 * Подключение: после base.js, components.js и semaphore.js (его модель семафора). Стили — semaphore.css.
 * Всё лежит в объекте SemaphoreTaskView.
 *
 * Составной объект, как пул: семафор и задача приходят отдельными объектами, объект ссылается на них
 * через state.semaphoreId / state.taskId. Потоки sem-runner-N склеиваются по имени: ждут — в семафоре, работают — в задаче.
 * Собственные события run — только кто внутри (entered): по ним «комната» видит поток между acquire и task.run.
 *
 * Картинка — «комната»: бейджи методов первой строкой, под ними задача — рамка, разрешения — места в ней:
 *
 *   acquire  release
 *                     ┌ task ───────┐
 *   [thread] [thread] │ [▓▓▓thread] │   слева — очередь ждущих, первый — у рамки;
 *                     │ [┊ free   ┊]│   внутри — потоки в run() (заливка — прогресс) и свободные места
 *                     └─────────────┘
 */
const SemaphoreTaskView = (() => {
  const base = '/api/semaphorerunnabletask';
  const GUARDED = 'SEMAPHORE_RUNNABLE_TASK';
  const SEMAPHORE = 'SEMAPHORE';
  const TASK = 'RUNNABLE_TASK';
  const NOTICE_MS = 4000; // сколько видна строка об отказе remove

  // ---------- REST ----------
  // Запросы и лог HTTP — UI.call из base.js. Объект появится по событию OBJECT_CREATED (после семафора и задачи)

  const create = (permits, durationMs, fair, mode = 'ACQUIRE', timeoutMs = 2000) =>
    UI.call('POST', base, { permits, durationMs, fair, mode, timeoutMs });

  // Как поток входит в задачу (AcquireMode на сервере): подпись в списке пульта
  const MODES = [['ACQUIRE', 'acquire()'], ['TRY_ACQUIRE', 'tryAcquire()'], ['TRY_ACQUIRE_TIMEOUT', 'tryAcquire(timeout)']];
  const REJECT_MS = 1500; // сколько тает плашка потока, получившего отказ (столько модель семафора помнит вышедших)

  // Отказ (409 — кто-то внутри) событий не порождает: пишем его в строку-уведомление, иначе он виден только в логе HTTP
  async function remove(store, id) {
    const res = await UI.request('DELETE', `${base}/${id}`);
    const item = store.items.get(id);
    if (!res.ok && item) store.notify(item, `remove ✗ ${errorMessage(res.body?.error)}`);
  }

  // java.lang.IllegalStateException: SemaphoreRunnableTask 7 has threads inside run → SemaphoreRunnableTask 7 has …
  const errorMessage = error => error ? error.split(': ').slice(1).join(': ') || error : 'request failed';

  const operations = [
    // Только run: release поток делает сам, на выходе из задачи
    { name: 'run', fields: [],
      title: id => `POST ${base}/${id}/run — run() in a new thread: acquire / tryAcquire → task.run → release`,
      run: id => UI.call('POST', `${base}/${id}/run`) },
  ];

  // ---------- Модель ----------

  /**
   * store.items — objectId → { id, semaphoreId, taskId, mode, timeoutMs, entered, notice }; store.apply(env) — учесть событие.
   * Семафоры — модель из semaphore.js (store.semaphores: waiting, leaving, state, бейджи), задачи — KV.trackTask
   * (store.tasks): каждое событие уходит в свою модель. entered — кто внутри run() объекта
   */
  function createStore(render) {
    const items = new Map();
    const semaphores = SemaphoreModel.createStore(render);
    const tasks = new Map();

    function apply(env) {
      const d = env.data;
      switch (d?.objectType) {
        case SEMAPHORE: semaphores.apply(env); break;
        case TASK: KV.trackTask(tasks, env, render); break;
        case GUARDED: applyGuarded(env, d); break;
      }
    }

    function applyGuarded(env, d) {
      if (env.type === 'OBJECT_REMOVED') { items.delete(d.objectId); return; }
      if (!items.has(d.objectId)) {
        items.set(d.objectId, { id: d.objectId, semaphoreId: null, taskId: null, mode: null, timeoutMs: null, entered: new Set(), notice: null });
      }
      // Кто внутри run() объекта (от входа до выхода, включая ожидание) — для «комнаты»: взявший разрешение,
      // но ещё не вошедший в run задачи, виден только так
      const item = items.get(d.objectId);
      if (d.method === 'run') {
        if (env.type === 'METHOD_IN') item.entered.add(d.thread);
        else if (env.type === 'METHOD_OUT' || env.type === 'METHOD_OUT_FAILED') item.entered.delete(d.thread);
      }
      // Ссылки на части и способ входа — в любом событии: страницу могли открыть уже после создания
      if (d.state) {
        const { semaphoreId, taskId, mode, timeoutMs } = d.state;
        Object.assign(items.get(d.objectId), { semaphoreId, taskId, mode, timeoutMs });
      }
    }

    function notify(item, text) {
      item.notice = { text, start: performance.now() };
      setTimeout(render, NOTICE_MS);
      render();
    }

    return { items, semaphores, tasks, apply, notify };
  }

  // ---------- Отрисовка ----------

  /**
   * Первой строкой — бейджи метода входа (acquire или tryAcquire — по mode) и release, под ними — «комната»;
   * ниже — уведомление об отказе remove. Семафора ещё нет в модели (страницу открыли позже) — пустая рамка
   */
  function renderState(store, item) {
    const sem = item.semaphoreId != null ? store.semaphores.items.get(item.semaphoreId) : null;
    const task = store.tasks.get(item.taskId) ?? { id: item.taskId ?? '?', durationMs: null, failedAt: null, runs: new Map() };
    const enter = item.mode && item.mode !== 'ACQUIRE' ? 'tryAcquire' : 'acquire';
    const out = sem ? [KV.renderBadges(pick(sem.methods, [enter, 'release'])), renderRoom(item, sem, task)] : [renderRoom(item, null, task)];
    const n = item.notice;
    if (n && performance.now() - n.start < NOTICE_MS) out.push(KV.el('div', 'semtask-notice error', n.text));
    return out;
  }

  /**
   * Задача — рамка, разрешения — места в ней. Слева, у входа, — очередь ждущих (ближний к рамке — первый);
   * у ждущего с таймаутом внизу убывает полоска — сколько осталось. Получивший отказ подъезжает к рамке,
   * отскакивает и тает. Внутри: потоки в run() — плашка заполняется прогрессом; взявший разрешение, но ещё не
   * вошедший в run, — бледная плашка; разрешение держит кто-то вне задачи (POST /api/semaphore/{id}/acquire) —
   * занятое место без имени; свободное — пунктир; «напечатанное» лишним release — оранжевый пунктир;
   * долг (разрешений < 0) — запертые места. Свободных нет — рамка красноватая.
   */
  function renderRoom(item, sem, task) {
    const row = KV.el('div', 'semroom-row');
    if (!sem) {
      const frame = KV.el('div', 'semroom');
      frame.append(KV.el('span', 'semroom-label', 'task'));
      frame.title = 'semaphore state unknown';
      row.append(frame);
      return row;
    }
    row.append(renderRoomQueue(item, sem), renderRoomFrame(item, sem, task));
    return row;
  }

  function roomChip(thread, title, cls = '') {
    const chip = KV.el('div', `semroom-chip ${cls}`.trim());
    chip.style.setProperty('--thread', KV.threadColor(thread));
    chip.title = title;
    return chip;
  }

  function renderRoomQueue(item, sem) {
    const queue = KV.el('div', 'semroom-queue');
    const now = performance.now();
    for (const [thread, w] of sem.waiting) {
      const timed = w.timeoutMs !== undefined;
      const chip = roomChip(thread, timed
        ? `${thread} waits in tryAcquire(${KV.seconds(w.timeoutMs)}): no free permits`
        : `${thread} waits in acquire(): no free permits`);
      if (timed) {
        const bar = KV.el('div', 'countdown');
        bar.style.animation = `semroom-count ${w.timeoutMs}ms linear ${-(now - (w.since ?? now))}ms forwards`;
        chip.append(bar);
      }
      chip.append(KV.el('span', 'name', KV.THREAD_LABEL));
      queue.append(chip);
    }
    for (const l of sem.leaving) {
      const age = now - l.start;
      if (l.kind !== 'none' || age >= REJECT_MS) continue;
      const chip = roomChip(l.thread, item.mode === 'TRY_ACQUIRE_TIMEOUT'
        ? `${l.thread}: tryAcquire() timed out after ${KV.seconds(item.timeoutMs)} — task did not run`
        : `${l.thread}: tryAcquire() returned false — no free permits, task did not run`, 'rejected');
      chip.style.animation = `semroom-bounce ${REJECT_MS}ms ease-in-out ${-age}ms forwards`;
      chip.append(KV.el('span', 'name', KV.THREAD_LABEL));
      queue.append(chip);
    }
    return queue;
  }

  function renderRoomFrame(item, sem, task) {
    const s = sem.state;
    const frame = KV.el('div', 'semroom');
    frame.append(KV.el('span', 'semroom-label', 'task'));
    if (!s) { frame.title = 'semaphore state unknown'; return frame; }

    // Места: обычные — по initialPermits; свободное сверх них — «напечатано» лишним release; долг — запертые
    const slots = Math.max(s.initialPermits, 0), available = s.availablePermits;
    const free = available >= 0 ? Math.min(available, slots) : 0;
    const extra = available > slots ? available - slots : 0;
    const locked = available < 0 ? -available : 0;
    const held = slots - free;

    const now = performance.now();
    const chips = [];
    // Внутри run(): заливка — прогресс, едет сама до конца задачи
    for (const [thread, run] of task.runs) {
      if (run.phase !== 'RUN') continue;
      const chip = roomChip(thread, `${thread} runs the task`);
      if (task.durationMs) {
        const fill = KV.el('div', 'fill');
        fill.style.animation = `fill-up ${task.durationMs}ms linear ${-Math.min(now - run.startedAt, task.durationMs)}ms forwards`;
        chip.append(fill);
      }
      chip.append(KV.el('span', 'name', KV.THREAD_LABEL));
      chips.push(chip);
    }
    // Внутри run() объекта, но не ждёт, не в run задачи и не получил отказ: взял разрешение и ещё не вошёл
    // в задачу (или уже вышел из неё и отдаёт разрешение) — мгновения, видны в замедленном режиме
    const rejected = new Set(sem.leaving.filter(l => l.kind === 'none').map(l => l.thread));
    for (const thread of item.entered) {
      if (sem.waiting.has(thread) || task.runs.get(thread)?.phase === 'RUN' || rejected.has(thread)) continue;
      const chip = roomChip(thread, `${thread} holds a permit, not inside task.run()`, 'entering');
      chip.append(KV.el('span', 'name', KV.THREAD_LABEL));
      chips.push(chip);
    }
    frame.append(...chips);
    // Разрешение держит кто-то вне задачи — место занято, но без имени: семафор владельца не знает
    for (let i = chips.length; i < held; i++) frame.append(Object.assign(KV.el('div', 'semroom-slot held'), { title: 'permit held outside the task' }));
    for (let i = 0; i < free; i++) frame.append(Object.assign(KV.el('div', 'semroom-slot'), { title: 'free permit' }));
    for (let i = 0; i < extra; i++) frame.append(Object.assign(KV.el('div', 'semroom-slot extra'), { title: 'release() without acquire(): a permit above initialPermits' }));
    for (let i = 0; i < locked; i++) frame.append(Object.assign(KV.el('div', 'semroom-slot locked'), { title: 'debt: release() is needed first' }));

    if (free === 0 && extra === 0) frame.classList.add('full');
    frame.title = `${s.initialPermits} permit(s) · ${available} free · ${s.fair ? 'fair' : 'nonfair'}`;
    return frame;
  }

  // Бейджи только этих методов: renderBadges рисует всё, что есть в inside
  function pick(methods, names) {
    return {
      inside: Object.fromEntries(names.map(n => [n, methods.inside[n]])),
      fade: Object.fromEntries(names.map(n => [n, methods.fade[n]])),
    };
  }

  // ---------- Описание для плитки tiles.html ----------
  // fair — булев параметр: плитка рисует его чекбоксом

  const types = [GUARDED, SEMAPHORE, TASK];

  return {
    title: 'Semaphore',
    // Способ входа — списком; таймаут — только у tryAcquire(timeout). На index.html — свои params
    params: [['permits', 2], ['durationMs', 5000], ['fair', false], ['mode', 'ACQUIRE', { options: MODES }],
      ['timeoutMs', 2000, { showIf: values => values.mode === 'TRY_ACQUIRE_TIMEOUT' }]],
    types, createStore, remove, operations, renderState,
    create: values => create(values.permits, values.durationMs, values.fair, values.mode, values.timeoutMs),
  };
})();