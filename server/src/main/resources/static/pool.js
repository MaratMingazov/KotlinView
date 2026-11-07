/*
 * ThreadPoolExecutor: модель по событиям WebSocket, отрисовка состояния пула и REST-вызовы.
 * Общий для threadpoolexecutor.html и плиток index.html.
 * Подключение: после base.js и components.js. Стили — pool.css. Всё лежит в объекте Pool.
 *
 * Пул — составной объект: очередь, фабрика и потоки приходят отдельными объектами.
 * Пул ссылается на них через state.queueId / state.threadFactoryId, воркеры склеиваются по имени потока.
 */
const Pool = (() => {
  const base = '/api/threadpoolexecutor';
  const tasksBase = '/api/tasks';
  const POOL = 'THREAD_POOL_EXECUTOR';
  const QUEUE = 'LINKED_BLOCKING_QUEUE_RUNNABLE';
  const FACTORY = 'THREAD_FACTORY';
  const THREAD = 'THREAD';
  const TASK = 'RUNNABLE_TASK';
  const TYPES = [POOL, QUEUE, FACTORY, THREAD, TASK];
  const INT_MAX = 2147483647;    // ёмкость LinkedBlockingQueue() без аргумента
  const DONE_FADE_MS = 1500;     // сколько тает колонка завершившегося потока
  const FAILED_FADE_MS = 4000;   // упавшего — дольше, чтобы успеть прочитать ошибку
  const NOTICE_MS = 4000;        // сколько видна строка об отказе / возвращённых задачах
  const TASK_DURATION_MS = 5000; // все задачи пока одной длины

  // ---------- REST ----------
  // Запросы и лог HTTP — UI.call из base.js

  const api = {
    // Пул появится по событию OBJECT_CREATED; ответ ({ objectId }) нужен, чтобы знать, чей это пул
    create: config => UI.call('POST', base, config),
    createSingle: () => UI.call('POST', `${base}/single`),
    createFixed: nThreads => UI.call('POST', `${base}/fixed`, { nThreads }),
    // execute новой задачи — два обычных запроса подряд: сервер принимает только taskId
    async execute(poolId, durationMs = TASK_DURATION_MS) {
      const created = await UI.call('POST', tasksBase, { durationMs });
      if (created) await UI.call('POST', `${base}/${poolId}/execute`, { taskId: created.objectId });
    },
    shutdown: poolId => UI.call('POST', `${base}/${poolId}/shutdown`),
    shutdownNow: poolId => UI.call('POST', `${base}/${poolId}/shutdownNow`),
    // Только TERMINATED; вместе с пулом удаляются его очередь и фабрика.
    // Отказ (409) событий не порождает — пишем его в строку-уведомление пула, иначе он виден только в логе HTTP
    async remove(store, poolId) {
      const res = await UI.request('DELETE', `${base}/${poolId}`);
      const pool = store.pools.get(poolId);
      if (!res.ok && pool) store.notify(pool, `remove pool ✗ ${errorMessage(res.body?.error)}`, true);
    },
  };

  // java.lang.IllegalStateException: Pool 3 must be terminated before removal → Pool 3 must be terminated before removal
  const errorMessage = error => error ? error.split(': ').slice(1).join(': ') || error : 'request failed';

  // Подсказки к кнопкам: что уйдёт на сервер
  const titles = {
    execute: id => `POST ${tasksBase} {durationMs: ${TASK_DURATION_MS}}, then POST ${base}/${id}/execute {taskId}`,
    shutdown: id => `POST ${base}/${id}/shutdown — reject new tasks, finish accepted ones`,
    shutdownNow: id => `POST ${base}/${id}/shutdownNow — interrupt workers, return queued tasks`,
    remove: id => `DELETE ${base}/${id} — TERMINATED only; removes its queue and factory too`,
  };

  // Узнать готовую конфигурацию Executors по параметрам: сервер не помечает пул, но набор параметров однозначен.
  // Очередь — как в пресетах сервера (PRESET_QUEUE_CAPACITY = 5), а не бесконечная, как в JDK
  const PRESET_QUEUE_CAPACITY = 5;
  function presetOf(s, queueCapacity) {
    const fixed = s.corePoolSize === s.maximumPoolSize && s.keepAliveMs === 0 && queueCapacity === PRESET_QUEUE_CAPACITY;
    if (!fixed) return null;
    return s.corePoolSize === 1 ? 'newSingleThreadExecutor()' : `newFixedThreadPool(${s.corePoolSize})`;
  }

  // java.util.concurrent.RejectedExecutionException: Task 4 rejected from … → RejectedExecutionException
  const shortError = error => error.split(':')[0].split('.').pop();

  // ---------- Модель ----------

  /**
   * Всё, что страница знает о пулах, по событиям WebSocket. render — перерисовать, когда что-то догорит по таймеру.
   * store.apply(env) — учесть событие; store.pools — poolId → пул.
   */
  function createStore(render) {
    // poolId → { id, state, methods, notice: { text, failed, start } | null }
    const pools = new Map();
    // queueId → { id, capacity, elements, methods, nodeEffect }
    const queues = new Map();
    // factoryId → { id, methods }
    const factories = new Map();
    // threadName → { objectId, name, factoryId, phase: 'NEW' | 'RUN' | 'DONE' | 'FAILED', error, endedAt }
    const threads = new Map();
    // threadName → { timeoutMs, start } — поток ждёт в poll(keepAlive) и умрёт, если не дождётся
    const polling = new Map();
    // taskId → задача из KV.trackTask: узлы очереди и занятые воркеры рисуются её конвертом — тем же, что на странице задачи.
    // Какую задачу выполняет поток, тоже отсюда: у задачи в runs есть этот поток в фазе RUN
    const tasks = new Map();

    function poolOf(id) {
      if (!pools.has(id)) pools.set(id, { id, state: null, methods: KV.methodsState(['execute', 'shutdown', 'shutdownNow', 'terminated']), notice: null });
      return pools.get(id);
    }
    function queueOf(id) {
      if (!queues.has(id)) queues.set(id, { id, capacity: null, elements: [], methods: KV.methodsState(['offer', 'take', 'poll', 'drainTo']), nodeEffect: null });
      return queues.get(id);
    }
    function factoryOf(id) {
      if (!factories.has(id)) factories.set(id, { id, methods: KV.methodsState(['newThread']) });
      return factories.get(id);
    }

    function apply(env) {
      const d = env.data;
      switch (d?.objectType) {
        case POOL: applyPool(env, d); break;
        case QUEUE: applyQueue(env, d); break;
        case FACTORY: applyFactory(env, d); break;
        case THREAD: applyThread(env, d); break;
        case TASK: KV.trackTask(tasks, env, render); break;
      }
    }

    function applyPool(env, d) {
      if (env.type === 'OBJECT_REMOVED') { pools.delete(d.objectId); return; }
      const pool = poolOf(d.objectId);
      if (d.state) pool.state = d.state;
      const phase = KV.trackMethod(pool.methods, env);
      if (d.method === 'execute' && phase === 'OUT_FAILED') {
        notify(pool, `execute(#${d.args.taskId}) ✗ ${shortError(d.error)}`, true);
      }
      if (d.method === 'shutdownNow' && phase === 'OUT' && d.result.length > 0) {
        notify(pool, `shutdownNow returned ${d.result.map(id => '#' + id).join(', ')} — never started`, false);
      }
    }

    function notify(pool, text, failed) {
      pool.notice = { text, failed, start: performance.now() };
      setTimeout(render, NOTICE_MS);
    }

    function applyQueue(env, d) {
      if (env.type === 'OBJECT_REMOVED') { queues.delete(d.objectId); return; }
      const queue = queueOf(d.objectId);
      // state в каждом событии полный — просто берём последний
      if (d.state) {
        queue.capacity = d.state.capacity;
        queue.elements = d.state.taskIds;
      }
      const phase = KV.trackMethod(queue.methods, env);
      if (!phase) return;
      if (d.method === 'poll') {
        if (phase === 'IN') polling.set(d.thread, { timeoutMs: d.args.timeoutMs, start: performance.now() });
        else polling.delete(d.thread);
      }
      const effect = queueEffectOf(d.method, phase, d);
      if (effect) KV.setEffect(queue, effect, render);
    }

    // Что подсветить в цепочке очереди после этого события (null — ничего). Только offer:
    // призраков в голове (снятый take/poll, прерванный take/poll, drainTo) пока не рисуем — с пустыми ячейками
    // ряд на время затухания становился на ячейку длиннее и потом сжимался
    function queueEffectOf(method, phase, d) {
      if (phase !== 'OUT' || method !== 'offer') return null;
      // При гонке «последний узел» — допущение, а не наблюдение
      if (d.result === true) return { new: d.state.taskIds.length - 1 };
      return { value: d.args.taskId, kind: 'failed', title: 'queue is full: offer returned false' };
    }

    function applyFactory(env, d) {
      if (env.type === 'OBJECT_REMOVED') { factories.delete(d.objectId); return; }
      KV.trackMethod(factoryOf(d.objectId).methods, env);
    }

    function applyThread(env, d) {
      // Колонку убирает не OBJECT_REMOVED, а таймер затухания после METHOD_OUT run
      if (env.type === 'OBJECT_REMOVED') return;
      const name = d.state.name;
      if (!threads.has(name)) {
        threads.set(name, { objectId: d.objectId, name, factoryId: d.state.threadFactoryId, phase: 'NEW', error: null, endedAt: null });
      }
      const thread = threads.get(name);
      if (d.method !== 'run') return;
      if (env.type === 'METHOD_IN') thread.phase = 'RUN';
      if (env.type === 'METHOD_OUT') finishThread(thread, 'DONE', null, DONE_FADE_MS);
      if (env.type === 'METHOD_OUT_FAILED') finishThread(thread, 'FAILED', d.error, FAILED_FADE_MS);
    }

    // Колонка не исчезает сразу: тает, потом удаляется
    function finishThread(thread, phase, error, fadeMs) {
      const endedAt = performance.now();
      Object.assign(thread, { phase, error, endedAt });
      polling.delete(thread.name);
      setTimeout(() => {
        if (threads.get(thread.name)?.endedAt === endedAt) { threads.delete(thread.name); render(); }
      }, fadeMs);
    }

    // items — то же, что pools: под этим именем store читают плитки index.html (общее описание структуры)
    return { pools, items: pools, queues, factories, threads, polling, tasks, apply, notify };
  }

  // ---------- Отрисовка ----------

  /** Состояние пула — элементы подряд: статус, строка-уведомление, очередь, воркеры. */
  // options.status: false — без runState в ряду бейджей (плитка index.html показывает его рядом с названием)
  function renderState(store, pool, options = {}) {
    const status = renderStatus(pool, options.status !== false);
    if (!pool.state) return [status];
    return [status, renderNotice(pool), renderQueue(store, pool.state.queueId), renderWorkers(store, pool)];
  }

  // Один ряд: бейджи методов пула и его runState. Счётчики — в подсказке к статусу
  function renderStatus(pool, withRunState) {
    const row = KV.renderBadges(pool.methods);
    if (withRunState && pool.state) row.append(renderRunState(pool));
    return row;
  }

  // Точка и runState (RUNNING / SHUTDOWN / …); счётчики — в подсказке
  function renderRunState(pool) {
    const s = pool.state;
    const status = KV.el('span', 'run-state');
    status.append(KV.el('span', `dot ${s.runState}`), s.runState);
    status.title = `threads ${s.poolSize} / core ${s.corePoolSize} / max ${s.maximumPoolSize} · active ${s.activeCount} · completed ${s.completedTaskCount}`;
    return status;
  }

  function renderNotice(pool) {
    const n = pool.notice;
    const elapsed = n ? performance.now() - n.start : Infinity;
    if (elapsed >= NOTICE_MS) return KV.el('div', 'notice');
    const row = KV.el('div', 'notice ' + (n.failed ? 'failed' : 'info'), n.text);
    row.style.animation = `fade-out ${NOTICE_MS}ms ease-in ${-elapsed}ms forwards`;
    return row;
  }

  function renderQueue(store, queueId) {
    const part = KV.el('div', 'part');
    const queue = store.queues.get(queueId);
    if (!queue) { part.append(KV.el('span', 'empty', `queue #${queueId} — no data`)); return part; }
    const title = KV.el('div', 'part-title');
    title.append(KV.el('span', 'name', 'queue'), KV.renderBadges(queue.methods));
    // Свободные ячейки — только для ограниченной очереди: ∞ (INT_MAX) и «ещё не знаем» не рисуем
    const capacity = queue.capacity != null && queue.capacity !== INT_MAX ? queue.capacity : undefined;
    // Узел — мини-конверт задачи из общего компонента
    const node = (taskId, label, index) => KV.taskNode(store.tasks, taskId, label, index);
    part.append(title, KV.renderChain(queue.elements, queue.nodeEffect, { node, slot: KV.taskSlot, capacity }));
    return part;
  }

  function renderWorkers(store, pool) {
    const factoryId = pool.state.threadFactoryId;
    const part = KV.el('div', 'part');
    const title = KV.el('div', 'part-title');
    title.append(KV.el('span', 'name', 'workers'));
    part.append(title);

    const queue = store.queues.get(pool.state.queueId);
    const list = KV.el('div', 'workers');
    // Порядок вставки в Map = порядок создания потоков
    let shown = 0;
    for (const thread of store.threads.values()) {
      if (thread.factoryId !== factoryId) continue;
      list.append(renderWorker(store, thread, queue));
      shown++;
    }
    // Свободные места до maximumPoolSize — как пустые ячейки очереди: потоки пул создаёт лениво, по execute.
    // Тающий завершённый поток тоже занимает место — его ячейка освободится, когда он исчезнет, и ряд не прыгнет
    for (let i = shown; i < pool.state.maximumPoolSize; i++) list.append(workerSlot());
    part.append(list);
    return part;
  }

  // Свободное место под воркера: бледная подпись и пунктирная рамка по размеру мини-конверта
  function workerSlot() {
    const column = KV.el('div', 'worker slot');
    column.append(KV.el('span', 'wname', 'worker'), KV.el('div', 'envelope-slot'));
    column.title = 'free place: the pool creates a thread on execute';
    return column;
  }

  // Какую задачу поток выполняет прямо сейчас (null — никакую)
  function taskRunBy(store, threadName) {
    for (const task of store.tasks.values()) {
      const run = task.runs.get(threadName);
      if (run?.phase === 'RUN') return { task, run };
    }
    return null;
  }

  // Чем занят воркер, видно не по событиям пула, а по событиям задачи (run) и очереди (take / poll) с его именем потока.
  // Колонка: сверху «worker», под ним либо его задача — тем же компонентом, что на странице задачи, — либо ожидание
  function renderWorker(store, thread, queue) {
    const column = KV.el('div', 'worker');
    column.style.setProperty('--thread', KV.threadColor(thread.name));
    // Пока просто «worker»: различаются цветом (по полному имени потока), полное имя — в подсказке
    column.append(KV.el('span', 'wname', 'worker'));
    const now = performance.now();

    const busy = taskRunBy(store, thread.name);
    const poll = store.polling.get(thread.name);
    // Без задачи на месте конверта — пустая рамка того же размера, под ней статус:
    // колонка не меняет высоту, а подпись у живого потока цветная — так он отличается от свободного места
    if (!busy) column.append(KV.el('div', 'envelope-slot'));
    if (thread.phase === 'DONE' || thread.phase === 'FAILED') {
      const failed = thread.phase === 'FAILED';
      // Только значок — чтобы колонка не расширялась; что случилось, написано в подсказке
      column.append(KV.el('span', 'wstatus ' + (failed ? 'failed' : 'done'), failed ? '✗' : '✓'));
      column.title = failed ? `${thread.name} failed: ${thread.error}` : `${thread.name} finished: left run() — keepAlive expired or pool stopped`;
      column.classList.add('ended');
      column.style.setProperty('--fade', `${failed ? FAILED_FADE_MS : DONE_FADE_MS}ms`);
      column.style.animationDelay = `${-(now - thread.endedAt)}ms`; // продолжить затухание после перерисовки
    } else if (busy) {
      // Конверт с полоской этого потока под ним; подпись уже над конвертом — на полоске её не дублируем
      const { task, run } = busy;
      column.append(KV.renderTask(task, { size: 'mini', thread: thread.name, names: false }));
      const elapsed = now - run.startedAt;
      column.title = `${thread.name} runs task#${task.id}: ${KV.seconds(Math.min(elapsed, task.durationMs ?? 0))} / ${KV.seconds(task.durationMs)}`;
    } else if (queue?.methods.inside.take.has(thread.name)) {
      column.append(KV.el('span', 'wstatus waiting', '⏳ take'));
      column.title = `${thread.name} waits in take() — core thread, waits forever`;
    } else if (poll) {
      column.append(KV.el('span', 'wstatus waiting', '⏳ poll'));
      const track = KV.el('div', 'track');
      track.append(bar('poll', 'drain', poll.timeoutMs, now - poll.start));
      column.append(track);
      column.title = `${thread.name} waits in poll(${KV.seconds(poll.timeoutMs)}) — dies on timeout (keepAlive)`;
    } else {
      // Между задачами: внутри getTask() до take/poll, или поток создан, но ещё не стартовал
      column.append(KV.el('span', 'wstatus', thread.phase === 'NEW' ? 'new' : '·'));
      column.title = thread.phase === 'NEW' ? `${thread.name}: created by newThread, not started yet` : `${thread.name}: between tasks`;
    }
    return column;
  }

  // Полоска едет сама: анимация на всю длительность с отрицательной задержкой — сколько уже прошло
  function bar(kind, animation, durationMs, elapsedMs) {
    const b = KV.el('div', `bar ${kind}`);
    b.style.animation = `${animation} ${durationMs}ms linear ${-Math.min(elapsedMs, durationMs)}ms forwards`;
    return b;
  }

  // ---------- Описание для плиток index.html ----------
  // Как у ArrayListView / LinkedListView: title, params, types, createStore, create(values), remove, operations, renderState

  const operations = ['execute', 'shutdown', 'shutdownNow'].map(name => ({ name, fields: [], title: titles[name], run: id => api[name](id) }));
  // В плитке runState стоит сразу после названия (renderTitleExtra), поэтому в ряду бейджей его нет
  const view = (title, params, create) => ({
    title, params, types: TYPES, createStore, create, remove: api.remove, operations,
    renderState: (store, pool) => renderState(store, pool, { status: false }),
    renderTitleExtra: (store, pool) => pool.state ? [renderRunState(pool)] : [],
  });
  const single = view('SingleThreadExecutor', [], () => api.createSingle());
  const fixed = view('FixedThreadPool', [['nThreads', 2]], values => api.createFixed(values.nThreads));

  return { TYPES, PRESET_QUEUE_CAPACITY, api, titles, presetOf, createStore, renderState, single, fixed };
})();