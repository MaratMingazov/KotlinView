/*
 * Живые диорамы для twin.html: снимок для сцены (diorama.js) собирается из store плитки рядом (tiles.js),
 * то есть из тех же событий WebSocket. Своей модели и своего сокета у диорамы нет — это второй взгляд на тот же объект.
 *
 * Сцена (остров, дороги, здания) строится один раз; машины — актёры: едут по маршрутам к своим местам из снимка
 * (fleet). Счётчики, шапка, маркизы боксов и светофор меняются на месте. Кадры — только пока кто-то едет.
 *
 * Подключение: после pool.js, semaphoretask.js, tiles.js и трёх файлов диорам. Всё лежит в объекте DioramaLive.
 */
const DioramaLive = (() => {
  const EXIT_MS = 1500; // сколько только что выполненная задача видна на выезде мойки

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

  // ---------- Машины: цели и маршруты ----------

  const sameTarget = (a, b) => a && b && a.kind === b.kind && a.i === b.i;

  /**
   * Актёры-машины одной живой сцены. Каждая машина — по ключу (id задачи или имя потока) и живёт, пока её ключ
   * есть в снимке. sync(targets) — Map ключ → цель { kind, i }: новой машине — въезд по мосту, у кого цель сменилась —
   * новый маршрут, кого в снимке больше нет — на выезд и за мост, там исчезает.
   * pathTo(car, target) — точки маршрута от текущего места до цели (у каждой сцены свои)
   */
  function fleet(stage, pathTo, colorOf, labelOf) {
    const cars = new Map(); // ключ → { car, target, leaving }

    function sync(targets, now = performance.now()) {
      for (const [key, target] of targets) {
        let entry = cars.get(key);
        if (!entry) {
          const color = colorOf(key);
          const car = IsoObjects.carActor(stage.s, `car-${key}`, color, { label: { lines: labelOf(key), color } });
          car.moveTo(...stage.points.entry, 'x');
          entry = { car, target: null, leaving: false };
          cars.set(key, entry);
        }
        if (entry.leaving || !sameTarget(entry.target, target)) {
          Object.assign(entry, { target, leaving: false });
          entry.car.go(pathTo(entry.car, target), { now });
        }
      }
      for (const [key, entry] of cars) {
        if (targets.has(key) || entry.leaving) continue;
        Object.assign(entry, { target: { kind: 'exit' }, leaving: true });
        entry.car.go(pathTo(entry.car, entry.target), { now });
      }
    }

    // Кадр: сдвинуть всех; доехавших до выезда — убрать. true — кто-то ещё едет
    function tick(now) {
      let moving = false;
      for (const [key, entry] of cars) {
        const still = entry.car.update(now);
        if (!still && entry.leaving) { entry.car.remove(); cars.delete(key); continue; }
        moving ||= still;
      }
      return moving;
    }

    return { sync, tick, get size() { return cars.size; } };
  }

  // Маршрут по полосе: если машина не на полосе (в боксе) — сначала выехать на неё. Порог 0.3: место на площадке
  // у шлагбаума чуть в стороне от полосы (0.15) — оттуда сразу по диагонали, без рывка поперёк и смены модели машины
  function viaLane(car, lane, points) {
    const out = Math.abs(car.pos.y - lane) > 0.3 ? [[car.pos.x, lane]] : [];
    return [...out, ...points];
  }

  // ---------- Живая мойка ----------

  /**
   * Мойка для плитки пула: сцена на столько боксов, сколько maximumPoolSize (или поле nThreads, пока пул спит).
   * Машина-задача: в очереди — на своём слоте, у воркера — в его боксе, выполнена — уезжает
   */
  function washStage(bays, uid) {
    const stage = Diorama.liveWash(bays, { scene: { uid } }), P = stage.points;
    const pathTo = (car, t) => {
      if (t.kind === 'bay') {
        // Уже в этом боксе — стоять; иначе — по полосе к его воротам и внутрь
        const [bx, by] = P.bay(t.i);
        if (Math.abs(car.pos.x - bx) < 0.05 && Math.abs(car.pos.y - by) < 0.05) return [];
        return viaLane(car, P.lane, [P.gate(t.i), [bx, by]]);
      }
      if (t.kind === 'slot') return viaLane(car, P.lane, [P.slot(t.i)]);
      return viaLane(car, P.lane, [P.exit]);
    };
    const cars = fleet(stage, pathTo, key => IsoObjects.carColor(key), key => [`task #${key}`]);
    let bayKeys = [];

    function update(snap) {
      stage.setTitle(snap.title);
      stage.setQueue(snap.queue.length, snap.queueCapacity);
      stage.setDone(snap.doneCount);
      // Маркиза и табличка бокса — по его потоку (перекрашивать, только когда поток в боксе сменился)
      snap.workers.slice(0, bays).forEach((w, i) => {
        const key = `${w.name}|${w.task?.id ?? ''}`;
        if (bayKeys[i] !== key) { bayKeys[i] = key; stage.paintBay(i, w); }
      });
      const targets = new Map();
      snap.queue.slice(0, Diorama.LIMITS.slots).forEach((t, i) => targets.set(t.id, { kind: 'slot', i }));
      snap.workers.slice(0, bays).forEach((w, i) => { if (w.task) targets.set(w.task.id, { kind: 'bay', i }); });
      cars.sync(targets);
    }

    return { root: stage.root, update, tick: now => cars.tick(now) };
  }

  // ---------- Живой шлагбаум ----------

  /**
   * Шлагбаум для плитки семафора: машина-поток ждёт у шлагбаума в порядке прихода, прошла acquire — едет на площадку
   * к домику (место за ней закреплено, пока она там), закончила — уезжает
   */
  function barrierStage(permits, uid) {
    const stage = Diorama.liveBarrier(permits, { scene: { uid } }), P = stage.points;
    const pathTo = (car, t) => {
      if (t.kind === 'wait') return viaLane(car, P.lane, [P.wait(t.i)]);
      if (t.kind === 'spot') return viaLane(car, P.lane, [P.gate, P.spot(t.i)]);
      return viaLane(car, P.lane, [P.exit]);
    };
    const cars = fleet(stage, pathTo, key => Iso.threadColor(key), key => [key]);
    const spots = new Map(); // поток → место на площадке: не перескакивать, когда соседний уехал

    function update(snap) {
      stage.setTitle([`Semaphore(${snap.permits})`, `guarding task #${snap.taskId} · ${snap.waiting.length} waiting`]);
      stage.setLight(snap.available, snap.permits, snap.waiting.length);
      const inside = snap.inside.slice(0, Diorama.LIMITS.inside).map(r => r.name);
      for (const name of spots.keys()) if (!inside.includes(name)) spots.delete(name);
      for (const name of inside) {
        if (spots.has(name)) continue;
        const taken = new Set(spots.values());
        let i = 0; while (taken.has(i)) i++;
        spots.set(name, i);
      }
      const targets = new Map();
      snap.waiting.slice(0, Diorama.LIMITS.waiting).forEach((name, i) => targets.set(name, { kind: 'wait', i }));
      for (const [name, i] of spots) targets.set(name, { kind: 'spot', i });
      cars.sync(targets);
    }

    return { root: stage.root, update, tick: now => cars.tick(now) };
  }

  // ---------- Панель: живая диорама рядом с плиткой ----------

  /**
   * Панель для плитки: сцена строится, когда меняется её «форма» (shapeOf: объект плитки, число боксов / разрешений),
   * и обновляется снимком на каждое update(tile). Кадры (requestAnimationFrame) — только пока кто-то едет
   */
  function panel({ shapeOf, build, snapshotOf }) {
    const el = KV.el('div', 'diorama-panel');
    let stage = null, shape = null, frame = null;

    const loop = now => {
      frame = stage?.tick(now) ? requestAnimationFrame(loop) : null;
    };

    function update(tile) {
      const next = shapeOf(tile);
      if (next.key !== shape?.key) {
        shape = next;
        stage = build(next);
        el.replaceChildren(stage.root);
      }
      stage.update(snapshotOf(tile));
      if (!frame) frame = requestAnimationFrame(loop);
    }

    return { el, update };
  }

  const fieldValue = (tile, name, max) => Math.min(Math.max(Number(tile.inputs[name]?.value) || 1, 1), max);

  const poolPanel = () => panel({
    shapeOf: tile => {
      const pool = Tiles.itemOf(tile);
      const bays = pool?.state ? Math.min(pool.state.maximumPoolSize, Diorama.LIMITS.bays) : fieldValue(tile, 'nThreads', Diorama.LIMITS.bays);
      return { key: `${tile.id ?? 'idle'}:${bays}`, bays };
    },
    build: shape => washStage(shape.bays, 'twin-pool'),
    snapshotOf: tile => {
      const pool = Tiles.itemOf(tile);
      return pool?.state ? poolSnapshot(tile.store, pool) : idlePool(fieldValue(tile, 'nThreads', Diorama.LIMITS.bays));
    },
  });

  const semaphorePanel = () => panel({
    shapeOf: tile => {
      const item = Tiles.itemOf(tile);
      const sem = item ? tile.store.semaphores.items.get(item.semaphoreId) : null;
      const permits = sem?.state ? sem.state.initialPermits : fieldValue(tile, 'permits', Diorama.LIMITS.inside);
      return { key: `${tile.id ?? 'idle'}:${permits}`, permits };
    },
    build: shape => barrierStage(shape.permits, 'twin-sem'),
    snapshotOf: tile => {
      const item = Tiles.itemOf(tile);
      if (item?.semaphoreId != null) return semaphoreSnapshot(tile.store, item);
      return idleSemaphore(fieldValue(tile, 'permits', Diorama.LIMITS.inside));
    },
  });

  return { poolSnapshot, semaphoreSnapshot, poolPanel, semaphorePanel };
})();
