/*
 * Живые диорамы для twin.html: снимок для сцены (diorama.js) собирается из store плитки рядом (tiles.js),
 * то есть из тех же событий WebSocket. Своей модели и своего сокета у диорамы нет — это второй взгляд на тот же объект.
 *
 * Этап 1 — живое зеркало: сцена перерисовывается целиком на каждое событие и по таймеру (растут полоски прогресса).
 * Машины пока не едут, а перескакивают между местами.
 *
 * Подключение: после pool.js, semaphoretask.js, tiles.js и трёх файлов диорам. Всё лежит в объекте DioramaLive.
 */
const DioramaLive = (() => {
  const EXIT_MS = 1500; // сколько только что выполненная задача видна на выезде мойки
  const TICK_MS = 250;  // перерисовка по таймеру, пока плитка живая: полоски прогресса растут между событиями

  const progressOf = (run, durationMs) => durationMs ? Math.min((performance.now() - run.startedAt) / durationMs, 1) : 0;

  // ---------- Пул → снимок автомойки ----------

  /**
   * Снимок пула из store pool.js. Боксы — по одному на место до maximumPoolSize: сначала живые потоки фабрики пула
   * (в порядке создания), потом свободные места. Воркер занят, если внутри run() какой-то задачи есть его поток
   */
  function poolSnapshot(store, pool) {
    const s = pool.state;
    const queue = store.queueById(s.queueId);
    const threads = [...store.threads.values()].filter(t => t.factoryId === s.threadFactoryId && (t.phase === 'NEW' || t.phase === 'RUN'));
    const now = performance.now();

    const runOf = name => {
      for (const task of store.tasks.values()) {
        const run = task.runs.get(name);
        if (run?.phase === 'RUN') return { task, run };
      }
      return null;
    };
    const workers = threads.map(t => {
      const busy = runOf(t.name);
      return { name: t.name, task: busy ? { id: busy.task.id } : null, progress: busy ? progressOf(busy.run, busy.task.durationMs) : 0 };
    });
    for (let i = workers.length; i < s.maximumPoolSize; i++) workers.push({ name: null, task: null, progress: 0 });

    // Только что выполненные потоками этого пула — уезжают с мойки, пока не истечёт EXIT_MS
    const names = new Set(threads.map(t => t.name));
    const done = [];
    for (const task of store.tasks.values()) {
      for (const [name, run] of task.runs) {
        if (run.phase === 'DONE' && names.has(name) && now - run.endedAt < EXIT_MS) done.push({ id: task.id, endedAt: run.endedAt });
      }
    }
    done.sort((a, b) => b.endedAt - a.endedAt);

    const capacity = queue?.capacity ?? Pool.PRESET_QUEUE_CAPACITY;
    return {
      title: ['ThreadPoolExecutor', `${Pool.presetOf(s, capacity) ?? `core ${s.corePoolSize} / max ${s.maximumPoolSize}`} · ${s.runState}`],
      queueCapacity: capacity,
      queue: (queue?.elements ?? []).map(id => ({ id })),
      incoming: [],
      workers,
      done,
      doneCount: s.completedTaskCount,
    };
  }

  // Пока пул не создан: пустая мойка на столько боксов, сколько стоит в поле nThreads
  const idlePool = bays => ({
    title: ['ThreadPoolExecutor', 'not started — press ▶ start on the left'],
    queueCapacity: Pool.PRESET_QUEUE_CAPACITY, queue: [], incoming: [], done: [], doneCount: 0,
    workers: Array.from({ length: bays }, () => ({ name: null, task: null, progress: 0 })),
  });

  // ---------- Задача под семафором → снимок шлагбаума ----------

  /** Снимок из store semaphoretask.js: ждущие — из модели семафора, внутри — потоки в run() задачи. */
  function semaphoreSnapshot(store, item) {
    const sem = store.semaphores.items.get(item.semaphoreId);
    const task = store.tasks.get(item.taskId);
    const inside = [];
    for (const [name, run] of task?.runs ?? []) {
      if (run.phase === 'RUN') inside.push({ name, progress: progressOf(run, task.durationMs) });
    }
    return {
      permits: sem?.state?.initialPermits ?? 0,
      available: sem?.state?.availablePermits ?? 0,
      taskId: item.taskId ?? '?',
      taskDuration: KV.seconds(task?.durationMs),
      inside,
      waiting: [...(sem?.waiting.keys() ?? [])],
    };
  }

  const idleSemaphore = permits => ({ permits, available: permits, taskId: '?', taskDuration: '?', inside: [], waiting: [] });

  // ---------- Панель: диорама рядом с плиткой ----------

  /**
   * Панель для плитки tile: перерисовывает сцену из снимка на каждое update() и по таймеру, пока плитка живая.
   * draw(snapshot, options) — Diorama.carWash / Diorama.barrier; snapshotOf(tile) — снимок (живой или «не запущен»).
   * Табличка под курсором переживает перерисовку: стабильный uid сцены и запомненный id таблички
   */
  function panel(draw, snapshotOf, uid) {
    const el = KV.el('div', 'diorama-panel');
    let hover = null, tile = null, timer = null;
    const onHover = id => { hover = id; };

    function paint() {
      if (!tile) return;
      el.replaceChildren(draw(snapshotOf(tile), { scene: { uid }, render: { hover, onHover } }));
    }

    function update(t) {
      tile = t;
      paint();
      const live = Tiles.itemOf(t) != null;
      if (live && !timer) timer = setInterval(paint, TICK_MS);
      if (!live && timer) { clearInterval(timer); timer = null; }
    }

    return { el, update };
  }

  // Готовые панели для двух плиток twin.html
  const poolPanel = () => panel(Diorama.carWash, tile => {
    const pool = Tiles.itemOf(tile);
    if (pool?.state) return poolSnapshot(tile.store, pool);
    const bays = Math.min(Number(tile.inputs.nThreads?.value) || 1, Diorama.LIMITS.bays);
    return idlePool(bays);
  }, 'twin-pool');

  const semaphorePanel = () => panel(Diorama.barrier, tile => {
    const item = Tiles.itemOf(tile);
    if (item?.semaphoreId != null) return semaphoreSnapshot(tile.store, item);
    return idleSemaphore(Math.min(Number(tile.inputs.permits?.value) || 1, Diorama.LIMITS.inside));
  }, 'twin-sem');

  return { poolSnapshot, semaphoreSnapshot, panel, poolPanel, semaphorePanel };
})();
