/*
 * ThreadPoolExecutor: модель по событиям WebSocket, отрисовка состояния пула и REST-вызовы.
 * Плитки на index.html и tiles.html.
 * Подключение: после base.js, components.js и synchronousqueue.js (очередь CachedThreadPool).
 * Стили — pool.css и synchronousqueue.css. Всё лежит в объекте Pool.
 *
 * Пул — составной объект: очередь, фабрика и потоки приходят отдельными объектами.
 * Пул ссылается на них через state.queueId / state.threadFactoryId, воркеры склеиваются по имени потока.
 *
 * Вид — «комната» (общие стили .room* — components.css), как у LinkedBlockingQueue и семафора:
 *
 *   execute  shutdown  shutdownNow  terminated
 *             ┌ queue(5) ───────────────┐  ┌ workers ┐
 *   [thread]  │ ┊  ┊ ┊  ┊ #7  #6  #5    │  │ [▓▓#4 ] │   слева — кто только что звал execute (тает; отказ — отскакивает);
 *             └─────────────────────────┘  │ [ take] │   очередь — труба, голова справа; воркеры — места до
 *                                          │ [┊    ┊]│   maximumPoolSize: рамка цвета потока, внутри его задача
 *                                          └─────────┘   (заливка — прогресс) или ожидание; пунктир — потока ещё нет
 */
const Pool = (() => {
  const base = '/api/threadpoolexecutor';
  const tasksBase = '/api/tasks';
  const POOL = 'THREAD_POOL_EXECUTOR';
  const QUEUE = 'LINKED_BLOCKING_QUEUE_RUNNABLE';     // очередь fixed / single
  const SYNC_QUEUE = 'SYNCHRONOUS_QUEUE_RUNNABLE';   // очередь cached
  const FACTORY = 'THREAD_FACTORY';
  const THREAD = 'THREAD';
  const TASK = 'RUNNABLE_TASK';
  const TYPES = [POOL, QUEUE, SYNC_QUEUE, FACTORY, THREAD, TASK];
  const INT_MAX = 2147483647;    // ёмкость LinkedBlockingQueue() без аргумента
  const DONE_FADE_MS = 1500;     // сколько тает колонка завершившегося потока
  const FAILED_FADE_MS = 4000;   // упавшего — дольше, чтобы успеть прочитать ошибку
  const NOTICE_MS = 4000;        // сколько видна строка об отказе / возвращённых задачах
  const TASK_DURATION_MS = 5000; // все задачи пока одной длины
  const NEW_MS = 1500;           // сколько подсвечена задача, только что попавшая в очередь (= перерисовка KV.setEffect)
  const VISIT_MS = 1200;         // сколько помнится законченный execute: плашка вызывающего тает или отскакивает (как у LBQ)
  const CALLERS_SHOWN = 2;       // плашек вызывающих у входа — не больше: место постоянное, рамка не прыгает
  const FLY_MS = 900;            // сколько летит задача firstTask от вызывающего к новому воркеру (меньше VISIT_MS)

  // ---------- REST ----------
  // Запросы и лог HTTP — UI.call из base.js

  const api = {
    // Пул появится по событию OBJECT_CREATED; ответ ({ objectId }) нужен, чтобы знать, чей это пул
    create: config => UI.call('POST', base, config),
    createSingle: () => UI.call('POST', `${base}/single`),
    createFixed: nThreads => UI.call('POST', `${base}/fixed`, { nThreads }),
    createCached: () => UI.call('POST', `${base}/cached`),
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
  // Очередь — как в пресетах сервера (PRESET_QUEUE_CAPACITY = 5), а не бесконечная, как в JDK.
  // Cached — как на сервере: не больше 5 потоков и keepAlive 10 с (в JDK — Integer.MAX_VALUE и 60 с)
  const PRESET_QUEUE_CAPACITY = 5;
  const CACHED_MAX_THREADS = 5;
  const CACHED_KEEP_ALIVE_MS = 10000;
  function presetOf(s, queueCapacity) {
    const cached = s.corePoolSize === 0 && s.maximumPoolSize === CACHED_MAX_THREADS && s.keepAliveMs === CACHED_KEEP_ALIVE_MS && queueCapacity === 0;
    if (cached) return 'newCachedThreadPool()';
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
    // taskId → задача из KV.trackTask: длительность — в подсказке ячейки очереди и прогресс у воркера.
    // Какую задачу выполняет поток, тоже отсюда: у задачи в runs есть этот поток в фазе RUN
    const tasks = new Map();

    /*
     * У пула ещё visits — недавние execute: { id, thread, taskId, outcome, at } (at — performance.now(); id — порядковый
     * номер: один HTTP-поток может звать execute несколько раз подряд, плашка у каждого своя). Визит открывается
     * на METHOD_IN (outcome = null — ещё внутри), закрывается на METHOD_OUT: внутри был offer вызывающего с этой задачей,
     * вернувший true, — 'queued' (LinkedBlockingQueue: легла в очередь) или 'handed' (SynchronousQueue cached-пула:
     * её взял ждущий воркер); иначе 'firstTask' — пул создал воркера и отдал задачу ему мимо очереди;
     * METHOD_OUT_FAILED — 'rejected'. Законченные старше VISIT_MS удаляются.
     * Полёт задачи к воркеру (firstTask и handed): worker — к кому, flyAt — когда вылетела
     */
    let visitSeq = 0;
    function poolOf(id) {
      if (!pools.has(id)) pools.set(id, { id, state: null, methods: KV.methodsState(['execute', 'shutdown', 'shutdownNow', 'terminated']), notice: null, visits: [] });
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

    // Очереди cached-пулов (SynchronousQueue) — своя модель из synchronousqueue.js: место передачи вместо ячеек.
    // id общие на все реестры, поэтому очередь пула ищется по queueId сразу в обеих моделях (queueById)
    const sync = SynchronousQueueView.createStore(render);

    function apply(env) {
      const d = env.data;
      switch (d?.objectType) {
        case POOL: applyPool(env, d); break;
        case QUEUE: applyQueue(env, d); trackOffer(env, d); break;
        case SYNC_QUEUE: sync.apply(env); trackPoll(env, d); trackOffer(env, d); trackHandoff(env, d); break;
        case FACTORY: applyFactory(env, d); break;
        case THREAD: applyThread(env, d); break;
        // Задачи нужны обеим моделям: ячейки и воркеры пула, подсказки SynchronousQueue
        case TASK: KV.trackTask(tasks, env, render); sync.apply(env); break;
      }
    }

    // Воркер ждёт в poll(keepAlive) — для полоски обратного отсчёта у воркера. У LBQ это делает applyQueue
    function trackPoll(env, d) {
      if (d.method !== 'poll') return;
      if (env.type === 'METHOD_IN') polling.set(d.thread, { timeoutMs: d.args.timeoutMs, start: performance.now() });
      else if (env.type !== 'METHOD_PROGRESS') polling.delete(d.thread);
    }

    // Очередь пула любого типа: LinkedBlockingQueue (ячейки) или SynchronousQueue (место передачи)
    const queueById = id => queues.get(id) ?? sync.items.get(id);
    // Ёмкость очереди пула: у SynchronousQueue всегда 0; undefined — очередь ещё не пришла
    const queueCapacity = id => queues.has(id) ? queues.get(id).capacity : sync.items.has(id) ? 0 : undefined;

    // offer вызывающего внутри execute вернул true — задача легла в очередь (у cached — её взял ждущий воркер)
    function trackOffer(env, d) {
      if (d.method !== 'offer' || env.type !== 'METHOD_OUT' || d.result !== true) return;
      for (const pool of pools.values()) {
        const visit = pool.visits.find(v => v.outcome === null && v.thread === d.thread && v.taskId === d.args?.taskId);
        if (visit) { visit.queued = d.objectType === SYNC_QUEUE ? 'handed' : 'queued'; return; }
      }
    }

    // cached: воркер вышел из poll / take SynchronousQueue с задачей — это ему её передали из рук в руки, летит к нему.
    // Его METHOD_OUT может прийти и до, и после конца execute вызывающего: визит ищем любой, ещё без воркера
    function trackHandoff(env, d) {
      if ((d.method !== 'poll' && d.method !== 'take') || env.type !== 'METHOD_OUT' || d.result == null) return;
      for (const pool of pools.values()) {
        const visit = pool.visits.find(v => v.taskId === d.result && !v.worker);
        if (visit) { Object.assign(visit, { worker: d.thread, flyAt: performance.now() }); setTimeout(render, FLY_MS); return; }
      }
    }

    // Визиты execute: открыть на METHOD_IN, закрыть на METHOD_OUT / METHOD_OUT_FAILED (см. visits у poolOf)
    function trackVisit(pool, d, phase) {
      const now = performance.now();
      pool.visits = pool.visits.filter(v => v.outcome === null || now - v.at < VISIT_MS);
      if (phase === 'IN') {
        pool.visits.push({ id: ++visitSeq, thread: d.thread, taskId: d.args?.taskId, outcome: null, queued: null, at: now });
        return;
      }
      // Тот же поток не может быть внутри execute дважды: открытый визит — последний с outcome = null
      const open = pool.visits.findLast(v => v.thread === d.thread && v.outcome === null);
      const visit = open ?? { id: ++visitSeq, thread: d.thread, taskId: d.args?.taskId, queued: null };
      Object.assign(visit, { outcome: phase === 'OUT_FAILED' ? 'rejected' : visit.queued ?? 'firstTask', at: now });
      // Отказ у работающего пула — очередь полна и потоков уже maximumPoolSize (после shutdown очередь не полна, а закрыта)
      visit.saturated = visit.outcome === 'rejected' && d.state?.runState === 'RUNNING';
      if (!open) pool.visits.push(visit);
      // firstTask: кому отдали — последнему потоку фабрики пула (newThread был внутри этого execute, до METHOD_OUT).
      // Пока задача летит к нему (FLY_MS), его место пустое; долетела — перерисовать
      if (visit.outcome === 'firstTask') {
        visit.worker = [...threads.values()].findLast(t => t.factoryId === pool.state?.threadFactoryId)?.name ?? null;
        visit.flyAt = now;
        setTimeout(render, FLY_MS);
      }
      setTimeout(render, VISIT_MS); // визит устарел — плашка ушла
    }

    function applyPool(env, d) {
      if (env.type === 'OBJECT_REMOVED') { pools.delete(d.objectId); return; }
      const pool = poolOf(d.objectId);
      if (d.state) pool.state = d.state;
      const phase = KV.trackMethod(pool.methods, env);
      if (d.method === 'execute' && phase) trackVisit(pool, d, phase);
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

    // Что подсветить в трубе после этого события (null — ничего): только принятую offer. Отказ видно по вызывающему
    // у входа (плашка отскакивает, рамка вспыхивает)
    function queueEffectOf(method, phase, d) {
      if (phase !== 'OUT' || method !== 'offer' || d.result !== true) return null;
      // При гонке «последний узел» — допущение, а не наблюдение
      return { new: d.state.taskIds.length - 1 };
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

    // items — то же, что pools: под этим именем store читают плитки tiles.html (общее описание структуры)
    return { pools, items: pools, queues, sync, factories, threads, polling, tasks, apply, notify, queueById, queueCapacity };
  }

  // ---------- Отрисовка ----------

  /**
   * Состояние пула — элементы подряд: статус, строка-уведомление, «комната» (общие стили .room* — components.css):
   * труба очереди (голова справа, хвост слева — как у LinkedBlockingQueue), правее — рамка воркеров
   */
  // options.status: false — без runState в ряду бейджей (плитка tiles.html показывает его рядом с названием)
  function renderState(store, pool, options = {}) {
    const status = renderStatus(pool, options.status !== false);
    if (!pool.state) return [status];
    const row = KV.el('div', 'room-row pool-room');
    const flights = flightsOf(pool);
    row.append(renderCallers(pool), renderQueue(store, pool), renderWorkers(store, pool, new Set(flights.map(v => v.worker))));
    renderFlights(row, flights);
    return [status, renderNotice(pool), row];
  }

  // Задачи, которые ещё летят к своему воркеру: firstTask (новому) и handed (ждущему в poll SynchronousQueue)
  const flightsOf = pool => pool.visits.filter(v => v.worker && performance.now() - v.flyAt < FLY_MS);

  /**
   * Плашка задачи летит по прямой от вызывающего (его плашки у входа; её уже нет — от края входа у рамки) к месту
   * воркера: firstTask — поверх трубы, мимо очереди, к новому; handed — через стенку handoff к ждущему. Откуда и куда — известно только после вёрстки:
   * row вставляют в страницу сразу после renderState, координаты берём на следующем кадре. Полёт продолжается
   * после перерисовки с того места, где был (отрицательная задержка)
   */
  function renderFlights(row, flights) {
    const plates = flights.map(v => {
      const plate = KV.el('div', 'room-task flying', `#${v.taskId}`);
      plate.title = v.outcome === 'handed' ? `task #${v.taskId}: handed over to a waiting worker`
        : `task #${v.taskId}: firstTask — handed to the new worker past the queue`;
      row.append(plate);
      return { v, plate };
    });
    if (plates.length === 0) return;
    requestAnimationFrame(() => {
      if (!row.isConnected) return;
      const base = row.getBoundingClientRect();
      for (const { v, plate } of plates) {
        const target = row.querySelector(`.worker-place[data-thread="${CSS.escape(v.worker)}"]`);
        const caller = row.querySelector(`.room-chip[data-visit="${v.id}"]`);
        const entry = row.querySelector('.room-queue.entry').getBoundingClientRect();
        if (!target) { plate.remove(); continue; }
        const from = caller?.getBoundingClientRect() ?? { left: entry.right - plate.offsetWidth, top: entry.top + (entry.height - plate.offsetHeight) / 2 };
        const to = target.getBoundingClientRect();
        Object.assign(plate.style, { left: `${from.left - base.left}px`, top: `${from.top - base.top}px`, visibility: 'visible' });
        plate.style.setProperty('--fly-x', `${to.left - from.left}px`);
        plate.style.setProperty('--fly-y', `${to.top - from.top}px`);
        plate.style.animation = `first-task ${FLY_MS}ms ease-in-out ${-(performance.now() - v.flyAt)}ms forwards`;
      }
    });
  }

  /**
   * У входа (.room-queue.entry: первый в DOM — у рамки, новые ближе): кто только что звал execute. Ещё внутри —
   * просто плашка; задача в очереди или у нового воркера — плашка тает: execute для вызывающего закончился;
   * отказ (RejectedExecutionException) — подъезжает к рамке, отскакивает и тает
   */
  function renderCallers(pool) {
    const side = KV.el('div', 'room-queue entry');
    const now = performance.now();
    const recent = pool.visits.filter(v => v.outcome === null || now - v.at < VISIT_MS);
    for (const v of recent.slice(-CALLERS_SHOWN).reverse()) {
      const call = `execute(task #${v.taskId})`, age = now - v.at;
      const chip = KV.el('div', v.outcome === 'rejected' ? 'room-chip rejected' : 'room-chip');
      chip.dataset.visit = v.id; // отсюда вылетает задача к воркеру (firstTask, handed)
      chip.style.setProperty('--thread', KV.threadColor(v.thread));
      chip.append(KV.el('span', 'name', KV.THREAD_LABEL));
      if (v.outcome === null) chip.title = `${v.thread} is inside ${call}`;
      else if (v.outcome === 'rejected') {
        chip.title = `${v.thread}: ${call} ✗ RejectedExecutionException`;
        chip.style.animation = `room-bounce ${VISIT_MS}ms ease-in-out ${-age}ms forwards`;
      } else {
        chip.title = v.outcome === 'queued' ? `${v.thread}: ${call} — the task went to the queue`
          : v.outcome === 'handed' ? `${v.thread}: ${call} — handed over to a worker waiting in poll()`
          : `${v.thread}: ${call} — the pool created a worker and gave it the task (firstTask, past the queue)`;
        chip.style.animation = `fade-out ${VISIT_MS}ms ease-in ${-age}ms forwards`;
      }
      side.append(chip);
    }
    return side;
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

  const PIPE_MAX = 8; // ячеек в трубе у неограниченной очереди; остальное — «+N» у хвоста

  function renderQueue(store, pool) {
    const queueId = pool.state.queueId;
    const queue = store.queueById(queueId);
    // SynchronousQueue (cached): не рамка, а стенка — мест нет, задачу положить некуда (стиль — synchronousqueue.css).
    // Задача пролетает её насквозь — от вызывающего к воркеру (renderFlights)
    if (queue && store.sync.items.has(queueId)) {
      const wall = KV.el('div', 'room-wall');
      wall.append(KV.el('span', 'room-wall-label', 'handoff'));
      wall.title = 'SynchronousQueue, capacity 0: nothing is stored — a task goes straight to a waiting worker, ' +
        'or offer() returns false and the pool creates a new worker';
      return wall;
    }
    // Труба: свободные ячейки (к хвосту) → «+N» → задачи от хвоста к голове. Свободные — только у ограниченной
    const bounded = queue?.capacity != null && queue.capacity !== INT_MAX;
    const frame = KV.el('div', 'room horizontal');
    frame.append(KV.el('span', 'room-label', `queue(${queue?.capacity == null ? '?' : bounded ? queue.capacity : '∞'})`));
    if (!queue) { frame.title = `queue #${queueId} — no data`; return frame; }
    const elements = queue.elements;
    const shown = bounded ? elements : elements.slice(0, PIPE_MAX);
    if (bounded) for (let i = elements.length; i < queue.capacity; i++) frame.append(Object.assign(KV.el('div', 'room-slot'), { title: 'free place' }));
    if (shown.length < elements.length) frame.append(KV.el('span', 'room-more', `+${elements.length - shown.length}`));
    // Только что принятая offer — подсвечена (nodeEffect.new — её индекс), продолжая с того места, где была
    const effect = queue.nodeEffect, age = effect ? performance.now() - effect.start : Infinity;
    for (let i = shown.length - 1; i >= 0; i--) {
      const id = shown[i];
      const cell = KV.el('div', 'room-task', `#${id}`);
      cell.title = `task #${id}, ${KV.seconds(store.tasks.get(id)?.durationMs)}${i === 0 ? ' · head: a worker takes it next' : ''}`;
      if (effect?.new === i && age < NEW_MS) cell.style.animation = `room-new ${NEW_MS}ms ease-out ${-age}ms forwards`;
      frame.append(cell);
    }
    // Полную очередь не подсвечиваем; положить не смогли (отказ работающего пула) — рамка вспыхивает красным,
    // вместе с отскоком плашки вызывающего
    const now = performance.now();
    const rejected = pool.visits.findLast(v => v.saturated && now - v.at < VISIT_MS);
    if (rejected) frame.style.animation = `queue-reject ${VISIT_MS}ms ease-in-out ${-(now - rejected.at)}ms forwards`;
    frame.title = `${elements.length} / ${bounded ? queue.capacity : '∞'} · head on the right, tail on the left`;
    return frame;
  }

  /**
   * Воркеры — рамка, места в ней — до maximumPoolSize. Место живого потока — рамка его цвета: внутри задача,
   * которую он выполняет (номер, заливка — прогресс), или чего он ждёт (take / poll); свободное место — пунктир:
   * потоки пул создаёт лениво, по execute. Тающий завершённый поток тоже занимает место — ряд не прыгнет.
   * landing — потоки, к которым ещё летит задача firstTask: их место пока пустое (рамка цвета потока)
   */
  function renderWorkers(store, pool, landing) {
    const s = pool.state;
    const frame = KV.el('div', 'room');
    frame.append(KV.el('span', 'room-label', 'workers'));
    const queue = store.queueById(s.queueId);
    // Порядок вставки в Map = порядок создания потоков
    let shown = 0;
    for (const thread of store.threads.values()) {
      if (thread.factoryId !== s.threadFactoryId) continue;
      frame.append(renderWorker(store, thread, queue, landing.has(thread.name)));
      shown++;
    }
    for (let i = shown; i < s.maximumPoolSize; i++) frame.append(Object.assign(KV.el('div', 'room-slot'), { title: 'free place: the pool creates a thread on execute' }));
    frame.title = `threads ${s.poolSize} / max ${s.maximumPoolSize} · active ${s.activeCount}`;
    return frame;
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
  // Место — рамка цвета потока (по полному имени, оно — в подсказке); внутри — задача или ожидание.
  // Анимации едут сами: на всю длительность с отрицательной задержкой — сколько уже прошло
  function renderWorker(store, thread, queue, landing) {
    const place = KV.el('div', 'room-task worker-place' + (landing ? ' landing' : ''));
    place.dataset.thread = thread.name; // сюда прилетает задача firstTask
    place.style.setProperty('--thread', KV.threadColor(thread.name));
    const now = performance.now();
    const state = (cls, text, title) => { place.classList.add(cls); place.append(KV.el('span', 'text', text)); place.title = title; };

    const busy = taskRunBy(store, thread.name);
    const poll = store.polling.get(thread.name);
    if (thread.phase === 'DONE' || thread.phase === 'FAILED') {
      const failed = thread.phase === 'FAILED';
      // Только значок; что случилось, написано в подсказке
      state(failed ? 'failed' : 'done', failed ? '✗' : '✓',
        failed ? `${thread.name} failed: ${thread.error}` : `${thread.name} finished: left run() — keepAlive expired or pool stopped`);
      place.classList.add('ended');
      place.style.setProperty('--fade', `${failed ? FAILED_FADE_MS : DONE_FADE_MS}ms`);
      place.style.animationDelay = `${-(now - thread.endedAt)}ms`; // продолжить затухание после перерисовки
    } else if (busy) {
      // Номер задачи — тот же, что был в очереди; заливка цвета потока — прогресс run()
      const { task, run } = busy;
      const elapsed = now - run.startedAt;
      if (task.durationMs) {
        const fill = KV.el('div', 'fill');
        fill.style.animation = `fill-up ${task.durationMs}ms linear ${-Math.min(elapsed, task.durationMs)}ms forwards`;
        place.append(fill);
      }
      state('busy', `#${task.id}`, `${thread.name} runs task #${task.id}: ${KV.seconds(Math.min(elapsed, task.durationMs ?? 0))} / ${KV.seconds(task.durationMs)}`);
    } else if (queue?.methods.inside.take?.has(thread.name)) {
      state('idle', 'take', `${thread.name} waits in take() — core thread, waits forever`);
    } else if (poll) {
      // Ждёт с таймаутом (keepAlive): полоска внизу убывает — сколько осталось до смерти потока
      const countdown = KV.el('div', 'countdown');
      countdown.style.animation = `room-count ${poll.timeoutMs}ms linear ${-Math.min(now - poll.start, poll.timeoutMs)}ms forwards`;
      place.append(countdown);
      state('idle', 'poll', `${thread.name} waits in poll(${KV.seconds(poll.timeoutMs)}) — dies on timeout (keepAlive)`);
    } else {
      // Между задачами: внутри getTask() до take/poll, или поток создан, но ещё не стартовал
      state('idle', thread.phase === 'NEW' ? 'new' : '·',
        thread.phase === 'NEW' ? `${thread.name}: created by newThread, not started yet` : `${thread.name}: between tasks`);
    }
    return place;
  }

  // ---------- Описание для плиток tiles.html ----------
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
  const cached = view('CachedThreadPool', [], () => api.createCached());

  return { PRESET_QUEUE_CAPACITY, presetOf, single, fixed, cached };
})();