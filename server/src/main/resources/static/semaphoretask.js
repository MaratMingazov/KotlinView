/*
 * SemaphoreRunnableTask — задача под семафором: модель по событиям WebSocket, отрисовка и REST-вызовы.
 * Общий для semaphoretask.html и плитки Semaphore на index.html.
 * Подключение: после base.js, components.js и semaphore.js (его модель семафора). Стили — semaphore.css.
 * Всё лежит в объекте SemaphoreTaskView.
 *
 * Составной объект, как пул: семафор и задача приходят отдельными объектами, объект ссылается на них
 * через state.semaphoreId / state.taskId. Потоки sem-runner-N склеиваются по имени: ждут — в семафоре, работают — в задаче.
 * Собственные события run не учитываем: всё видно по событиям частей.
 *
 * Картинка — комната со светофором у входа:
 *
 *                 ┌ acquire  release ─────────────────┐
 *   sem-runner-4  │ ● 1      ┌──────┐ ▓▓▓ sem-runner-1 │
 *   sem-runner-3  │ ○ /2     │ task │ ▓▓  sem-runner-2 │
 *                 │          └──────┘                 │
 *                 └───────────────────────────────────┘
 *   слева, снаружи — кто ждёт в acquire, в порядке прихода; светофор: зелёный с цифрой — есть свободные разрешения,
 *   красный — нет; внутри комнаты — задача (конверт и полоски потоков внутри run)
 */
const SemaphoreTaskView = (() => {
  const base = '/api/semaphorerunnabletask';
  const GUARDED = 'SEMAPHORE_RUNNABLE_TASK';
  const SEMAPHORE = 'SEMAPHORE';
  const TASK = 'RUNNABLE_TASK';
  const NOTICE_MS = 4000; // сколько видна строка об отказе remove
  const FLASH_MS = 800;   // сколько вспыхивает лампа при переключении и метка ◆ при появлении

  // ---------- REST ----------
  // Запросы и лог HTTP — UI.call из base.js. Объект появится по событию OBJECT_CREATED (после семафора и задачи)

  const create = (permits, durationMs, fair) => UI.call('POST', base, { permits, durationMs, fair });

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
      title: id => `POST ${base}/${id}/run — run() in a new thread: acquire → task.run → release`,
      run: id => UI.call('POST', `${base}/${id}/run`) },
  ];

  // ---------- Модель ----------

  /**
   * store.items — objectId → { id, semaphoreId, taskId, notice, lamp, extra, drawn }; store.apply(env) — учесть событие.
   * Семафоры — модель из semaphore.js (store.semaphores: waiting, state, бейджи), задачи — KV.trackTask (store.tasks):
   * каждое событие уходит в свою модель.
   * lamp / extra — что горело при прошлой отрисовке и с какого момента: по ним вспышка при переключении.
   * drawn — светофор уже рисовался: то, что видно при первой отрисовке, не вспыхивает
   */
  function createStore(render) {
    const items = new Map();
    const semaphores = SemaphoreView.createStore(render);
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
        items.set(d.objectId, { id: d.objectId, semaphoreId: null, taskId: null, notice: null, lamp: null, extra: null, drawn: false });
      }
      // Ссылки на части — в любом событии: страницу могли открыть уже после создания
      if (d.state) Object.assign(items.get(d.objectId), { semaphoreId: d.state.semaphoreId, taskId: d.state.taskId });
    }

    function notify(item, text) {
      item.notice = { text, start: performance.now() };
      setTimeout(render, NOTICE_MS);
      render();
    }

    return { items, semaphores, tasks, apply, notify };
  }

  // ---------- Отрисовка ----------

  /** Очередь у входа → комната (бейджи на рамке, светофор, задача внутри); под ней — уведомление об отказе. */
  function renderState(store, item) {
    const sem = item.semaphoreId != null ? store.semaphores.items.get(item.semaphoreId) : null;
    const row = KV.el('div', 'semroom-row');
    row.append(renderQueue(sem), renderRoom(store, item, sem));
    const out = [row];
    const n = item.notice;
    if (n && performance.now() - n.start < NOTICE_MS) out.push(KV.el('div', 'semtask-notice error', n.text));
    return out;
  }

  // Кто ждёт в acquire — снаружи, у двери, в порядке прихода (METHOD_IN). Без подписи: и так видно, что стоят у входа
  function renderQueue(sem) {
    const queue = KV.el('div', 'semroom-queue');
    for (const [thread, w] of sem?.waiting ?? []) {
      const chip = KV.el('span', 'thread-chip', thread + (w.permits !== 1 ? ` ×${w.permits}` : ''));
      chip.style.setProperty('--thread', KV.threadColor(thread));
      chip.title = `${thread} waits in ${w.method}(${w.permits}): no free permits`;
      queue.append(chip);
    }
    return queue;
  }

  function renderRoom(store, item, sem) {
    const room = KV.el('div', 'semroom');
    room.title = `semaphore #${item.semaphoreId ?? '?'} guarding task #${item.taskId ?? '?'}`;

    // На рамке — только acquire и release: tryAcquire в этой плитке не бывает
    if (sem) {
      const legend = KV.el('div', 'semroom-legend');
      legend.append(KV.renderBadges(pick(sem.methods, ['acquire', 'release'])));
      room.append(legend);
    }

    const inside = KV.el('div', 'semroom-inside');
    // Задача, которой ещё нет в модели (страницу открыли позже), — пустой конверт с «?», как в очереди пула
    const task = store.tasks.get(item.taskId) ?? { id: item.taskId ?? '?', durationMs: null, failedAt: null, runs: new Map() };
    inside.append(KV.renderTask(task, { size: 'mini' }));

    room.append(renderLight(item, sem?.state), inside);
    return room;
  }

  /**
   * Светофор: зелёный горит, пока есть свободные разрешения, — внутри цифра, сколько; красный — разрешений нет
   * (0 или долг: тогда в красном — отрицательное число). Под лампами — /initialPermits.
   * Разрешений больше начального — release без acquire «напечатал» лишнее: зелёная лампа в оранжевом кольце и метка ◆+N.
   * В этой плитке так не бывает (release делает сам поток), но семафор доступен и напрямую — POST /api/semaphore/{id}/release.
   * Метка — состояние, а не событие: горит, пока лишние есть; вспыхивает только при появлении
   */
  function renderLight(item, s) {
    const light = KV.el('div', 'semlight');
    const green = KV.el('span', 'lamp green');
    const red = KV.el('span', 'lamp red');
    light.append(green, red);
    if (!s) { light.append(KV.el('span', 'semlight-count', '?')); return light; }

    const available = s.availablePermits;
    const isGreen = available > 0;
    const extra = available - s.initialPermits;
    const now = performance.now();

    // Вспышка при переключении лампы. Первая отрисовка — без вспышки: лампа не переключалась, её просто увидели
    if (item.lamp?.green !== isGreen) item.lamp = { green: isGreen, since: item.lamp ? now : -Infinity };
    const lit = isGreen ? green : red;
    lit.classList.add('on');
    lit.textContent = String(available);
    flash(lit, now - item.lamp.since);
    (isGreen ? red : green).classList.add('off');
    green.title = isGreen ? `${available} free permit(s)` : 'no free permits';
    red.title = isGreen ? 'free permits available' : available < 0 ? `debt: ${available}, release() is needed first` : 'no free permits: acquire() waits';

    light.append(Object.assign(KV.el('span', 'semlight-count', `/${s.initialPermits}`), { title: 'initialPermits' }));

    if (extra > 0) {
      // Как у лампы: лишние, увиденные при первой отрисовке, — без вспышки, они не появились, их просто увидели
      if (item.extra === null) item.extra = { since: item.drawn ? now : -Infinity };
      green.classList.add('extra');
      const mark = KV.el('span', 'semlight-extra', `◆+${extra}`);
      mark.title = 'release() without acquire(): the semaphore does not check who releases — ' +
        `${extra} permit(s) above initialPermits`;
      flash(mark, now - item.extra.since);
      light.append(mark);
    } else {
      item.extra = null;
    }
    item.drawn = true;
    return light;
  }

  // Вспышка, продолженная с того места, где была до пересоздания элемента (render идёт на каждое событие)
  function flash(element, elapsed) {
    if (elapsed < FLASH_MS) element.style.animation = `lamp-flash ${FLASH_MS}ms ease-out ${-elapsed}ms forwards`;
  }

  // Бейджи только этих методов: renderBadges рисует всё, что есть в inside
  function pick(methods, names) {
    return {
      inside: Object.fromEntries(names.map(n => [n, methods.inside[n]])),
      fade: Object.fromEntries(names.map(n => [n, methods.fade[n]])),
    };
  }

  // ---------- Описание для плитки index.html ----------
  // fair — булев параметр: плитка рисует его чекбоксом

  const types = [GUARDED, SEMAPHORE, TASK];

  return {
    title: 'Semaphore',
    params: [['permits', 2], ['durationMs', 5000], ['fair', false]],
    types, createStore, remove, operations, renderState,
    create: values => create(values.permits, values.durationMs, values.fair),
    createWith: create, // для semaphoretask.html: с fair
  };
})();