/*
 * Диорама пула — «автомойка» — описанием для набора (diorama-kit.js).
 * машина = задача · белые рамки на дороге = места очереди · бокс мойки = поток-воркер (маркиза — его цвет).
 * Задача в очереди — на своём месте; у воркера — в его боксе (взятая сразу, firstTask, — мимо очереди);
 * выполнена — пропадает из снимка, и набор увозит машину за мост.
 *
 * Подключение: после diorama-kit.js. На index.html нужны ещё pool.js и tiles.js (снимок из плитки).
 * Всё лежит в объекте PoolDiorama: kind — описание для Kit.panel / Kit.show, LIMITS, demo — снимок для prototype.html.
 */
const PoolDiorama = (() => {
  const { threadColor, PALETTE: C } = Iso;
  const O = IsoObjects;
  const percent = fraction => `${Math.round(fraction * 100)}%`;

  // Сколько помещается на острове. Больше не рисуем: плитка на index.html не даёт создать больше (tiles.js, max)
  const LIMITS = { slots: 5, bays: 3 };

  // Раскладка сцены (клетки мира)
  const WASH = {
    island: [-4.4, -3.2, 14.4, 2.7], seed: 1,
    noMarks: [-0.6, 5.9],                        // без пунктира: очередь и «зебра»
    zebraX: 5.3,                                 // переход между головой очереди и мойкой
    queue: { headX: 4.1, step: 1.15, y: 0.15 },  // голова — ближе всего к мойке, хвост — к въезду
    incomingX: -3.6,                             // «только что пришла» (снимок prototype.html)
    house: { x: 5.9, y: -2.5 },
    out: [11.8, 13.6],                           // уехавшие (снимок prototype.html) — на выезде
    queueSign: [1.2, 1.75], doneSign: [12.4, 1.75],
    decorSeed: 11,
  };

  /**
   * Снимок пула — что сейчас происходит:
   * queue — задачи в очереди, голова первая; workers — по боксу на поток до maximumPoolSize:
   * { name, task: { id } | null, progress } (name = null — свободный бокс: потока ещё нет);
   * incoming и done — только для статичного показа: живые машины приезжают и уезжают сами
   */
  const demo = {
    title: ['ThreadPoolExecutor', 'newFixedThreadPool(3) · queue 5'],
    queueCapacity: 5,
    queue: [{ id: 21 }, { id: 22 }, { id: 23 }],
    workers: [
      { name: 'worker-1', task: { id: 18 }, progress: 0.8 },
      { name: 'worker-2', task: { id: 19 }, progress: 0.45 },
      { name: 'worker-3', task: { id: 20 }, progress: 0.1 },
    ],
    incoming: [{ id: 24 }],
    done: [{ id: 17 }, { id: 16 }],
    doneCount: 17,
  };

  // Табличка бокса: свободный, ждущий задачу или работающий — с полоской прогресса
  function bayLabel(w) {
    if (!w.name) return { lines: ['free bay', 'no thread yet: the pool creates it on execute'] };
    const color = threadColor(w.name);
    if (!w.task) return { lines: [Kit.THREAD_LABEL, 'idle · waits in take()'], color };
    return { lines: [Kit.THREAD_LABEL, `task #${w.task.id} · ${percent(w.progress)}`], color, bar: { fraction: w.progress, color } };
  }

  // ---------- Сцена ----------

  /** Неподвижная мойка на shape.bays боксов и места для машин: въезд, очередь, ворота и боксы, выезд. */
  function layout(s, shape) {
    const L = WASH;
    const st = Kit.street(s, { island: L.island, seed: L.seed, skip: L.noMarks });
    O.zebra(s, L.zebraX);

    const slotX = i => L.queue.headX - i * L.queue.step;
    for (let i = 0; i < LIMITS.slots; i++) O.slot(s, slotX(i), L.queue.y);
    const queueSign = O.sign(s, ...L.queueSign, `0 / ${LIMITS.slots}`, C.text);

    // Мойка — сначала все боксы свободные: кто в них работает, расскажет update (маркизы и таблички — на месте)
    const free = Array.from({ length: shape.bays }, () => ({ name: null, task: null, progress: 0 }));
    const wash = O.washHouse(s, L.house.x, L.house.y, free, bayLabel);
    free.forEach((w, i) => {
      const [bx, by] = wash.bayCenter(i);
      s.ground.push(s.flat(bx - 0.55, by, 1.1, -by, C.road)); // съезд с дороги к воротам
    });
    s.title(['ThreadPoolExecutor', '…']);
    const doneSign = O.sign(s, ...L.doneSign, '✓ 0');

    // Растительность — не в мойке со съездами и не у столбиков
    const [qx, qy] = L.queueSign, [dx, dy] = L.doneSign;
    st.keepOut(
      [L.house.x - 0.2, L.house.y - 0.3, L.house.x + wash.width + 0.6, 0],
      [qx - 0.2, qy - 0.25, qx + 0.3, qy + 0.35],
      [dx - 0.2, dy - 0.25, dx + 0.3, dy + 0.35],
    );

    // Места: всё на полосе — одной цепочкой по x; бокс — только через свои ворота
    st.lanePlace('incoming', L.incomingX + O.CAR.L / 2);
    for (let i = 0; i < LIMITS.slots; i++) st.lanePlace(`slot${i}`, slotX(i) + 0.08 + O.CAR.L / 2);
    for (let i = 0; i < shape.bays; i++) {
      st.lanePlace(`gate${i}`, wash.bayCenter(i)[0]);
      st.place(`bay${i}`, wash.parkAt(i));
    }
    L.out.forEach((x, i) => st.lanePlace(`out${i}`, x + O.CAR.L / 2));

    // Обновить на месте: шапку, счётчики, маркизы и таблички боксов (маркизу — только когда сменился поток)
    const bayKeys = [];
    function update(snap) {
      s.retitle(snap.title);
      s.relabel(queueSign, [`${snap.queue.length} / ${snap.queueCapacity}`]);
      s.relabel(doneSign, [`✓ ${snap.doneCount}`]);
      snap.workers.slice(0, shape.bays).forEach((w, i) => {
        const key = `${w.name}|${w.task?.id ?? ''}|${percent(w.progress)}`;
        if (bayKeys[i] !== key) { bayKeys[i] = key; wash.paintBay(i, w); }
      });
    }

    return st.layout(L.decorSeed, { links: Array.from({ length: shape.bays }, (_, i) => [`gate${i}`, `bay${i}`]), update });
  }

  /** Кто где: очередь — по местам, у воркера — в его боксе; в статичном показе — ещё «только что пришла» и уехавшие. */
  function actorsOf(snap, shape) {
    const car = (t, place, look = {}) => {
      const color = O.carColor(t.id);
      return { key: t.id, place, color, look: { rack: t.id % 3 === 0, ...look }, label: { lines: [`task #${t.id}`], color } };
    };
    const specs = [];
    snap.queue.slice(0, LIMITS.slots).forEach((t, i) => specs.push(car(t, `slot${i}`)));
    snap.workers.slice(0, shape.bays).forEach((w, i) => { if (w.task) specs.push(car(w.task, `bay${i}`)); });
    for (const t of snap.incoming ?? []) specs.push(car(t, 'incoming'));
    (snap.done ?? []).slice(0, WASH.out.length).forEach((t, i) => specs.push(car(t, `out${i}`, { faded: true, rack: i === 1 })));
    return specs;
  }

  // ---------- Снимок из плитки (index.html) ----------

  /**
   * Снимок из store pool.js. Боксы — по одному на место до maximumPoolSize: сначала живые потоки фабрики пула
   * (в порядке создания), потом свободные места. Воркер занят, если внутри run() какой-то задачи есть его поток
   */
  function poolSnapshot(store, pool) {
    const s = pool.state;
    const queue = store.queueById(s.queueId);
    const threads = [...store.threads.values()].filter(t => t.factoryId === s.threadFactoryId && (t.phase === 'NEW' || t.phase === 'RUN'));
    const runOf = name => {
      for (const task of store.tasks.values()) {
        const run = task.runs.get(name);
        if (run?.phase === 'RUN') return { task, run };
      }
      return null;
    };
    const workers = threads.map(t => {
      const busy = runOf(t.name);
      return { name: t.name, task: busy ? { id: busy.task.id } : null, progress: busy ? Kit.progress(busy.run, busy.task.durationMs) : 0 };
    });
    for (let i = workers.length; i < s.maximumPoolSize; i++) workers.push({ name: null, task: null, progress: 0 });
    const capacity = queue?.capacity ?? Pool.PRESET_QUEUE_CAPACITY;
    return {
      title: ['ThreadPoolExecutor', `${Pool.presetOf(s, capacity) ?? `core ${s.corePoolSize} / max ${s.maximumPoolSize}`} · ${s.runState}`],
      queueCapacity: capacity,
      queue: (queue?.elements ?? []).map(id => ({ id })),
      workers,
      doneCount: s.completedTaskCount,
    };
  }

  // Пока пул не создан: пустая мойка на столько боксов, сколько стоит в поле nThreads
  const idle = bays => ({
    title: ['ThreadPoolExecutor', 'not started — press ▶ start on the left'],
    queueCapacity: LIMITS.slots, queue: [], doneCount: 0,
    workers: Array.from({ length: bays }, () => ({ name: null, task: null, progress: 0 })),
  });

  /** @type {Kind} */
  const kind = {
    name: 'pool', uid: 'pool',
    shapeOf(tile) {
      const pool = tile && Tiles.itemOf(tile);
      const bays = pool?.state ? Math.min(pool.state.maximumPoolSize, LIMITS.bays) : Kit.field(tile, 'nThreads', LIMITS.bays);
      return { key: `${tile.id ?? 'idle'}:${bays}`, bays };
    },
    layout,
    snapshotOf(tile, shape) {
      const pool = Tiles.itemOf(tile);
      return pool?.state ? poolSnapshot(tile.store, pool) : idle(shape.bays);
    },
    actorsOf,
  };

  return { kind, LIMITS, demo, demoShape: { key: 'demo', bays: demo.workers.length } };
})();
