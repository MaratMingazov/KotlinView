/*
 * Диорама задачи под семафором — «бензоколонка за шлагбаумом» — описанием для набора (diorama-kit.js).
 * машина = поток-раннер (цвет потока) · шлагбаум и светофор = семафор · бензоколонка = задача · заправка = run().
 * Поток ждёт у шлагбаума в порядке прихода; прошёл acquire — едет к свободному месту у колонки (место за ним закреплено,
 * пока он там: группа мест spot*) и заправляется — табло колонки показывает прогресс run(); закончил — пропадает
 * из снимка, и набор увозит машину к краю плиты.
 * Сцена — на парящей плите, площадка — асфальт без разметки; одна двусторонняя колонка: машина перед ней и за ней
 * (не больше LIMITS.inside = 2 разрешений), короткий навес над ней.
 *
 * Подключение: после diorama-kit.js. На index.html нужны ещё semaphoretask.js и tiles.js (снимок из плитки).
 * Всё лежит в объекте SemaphoreDiorama: kind — описание для Kit.panel / Kit.show, LIMITS, demo — снимок для prototype.html.
 */
const SemaphoreDiorama = (() => {
  const { threadColor, PALETTE: C } = Iso;
  const O = IsoObjects, R = O.ROAD;

  // Сколько помещается на плите. Больше не рисуем: ждущих сверх — «+N»; разрешений — не больше мест у колонки
  const LIMITS = { waiting: 4, inside: 2 };

  // Стрела: взмах (вверх или вниз) — за GATE_SWING_MS; поднята, пока пропущенная машина в зоне шлагбаума (клетки по x)
  const GATE_SWING_MS = 250;
  const GATE_ZONE = { before: 2.0, after: 1.4 };

  // Раскладка сцены (клетки мира)
  // Раскладка сцены (клетки мира). Плита — вплотную к содержимому: очередь из LIMITS.waiting машин, шлагбаум, площадка
  // (кончается сразу за навесом, с запасом под выезд, скамейку и фонарь), короткий выезд
  const BARRIER = {
    slab: [-0.6, -1.7, 10.6, 2.0], seed: 2.3,
    lot: { x0: 5.4, x1: 10.0, y0: -1.8, y1: 2.2 },
    gateX: 4.6,
    waiting: { firstX: 3.3, step: 1.25 },     // первый — у стоп-линии, остальные — за ним
    shop: { x: 5.6, y: 1.35, w: 1.4, d: 0.7, h: 0.85 }, // магазинчик — у ближнего края: сзади его закрыл бы навес
    pump: { x: 7.4, y: 0.5 },                 // ближняя машина у колонки: левый край (как в car()) и дальний бок
    decorSeed: 23,
  };

  /**
   * Снимок семафора: permits — всего, available — свободно; inside — раннеры внутри задачи { name, startedAt,
   * durationMs } (прогресс считается на каждом кадре) или { name, progress } (статичный показ); waiting — ждущие
   * (acquire, tryAcquire с таймаутом) в порядке прихода; rejected — только что получившие отказ (tryAcquire → false):
   * { name, waited } — waited: ждал в очереди (таймаут), иначе отказ сразу
   */
  const demo = {
    permits: 2, available: 0, taskId: 7, taskDuration: '5.0s',
    inside: [{ name: 'sem-runner-1', progress: 0.6 }, { name: 'sem-runner-2', progress: 0.2 }], // progress — только в демо
    waiting: ['sem-runner-3', 'sem-runner-4', 'sem-runner-5'],
    rejected: [],
  };

  // Сколько после отказа машина в снимке: успеть развернуться (дальше набор и так доведёт её до выезда entry)
  const REJECTED_MS = 1500;

  const titleOf = snap => [`Semaphore(${snap.permits})`, `guarding task #${snap.taskId} · ${snap.waiting.length} waiting`];
  const shopLines = snap => [`task #${snap.taskId}`, `${snap.taskDuration} · ${snap.inside.length} fueling`];

  // ---------- Сцена ----------

  /** Неподвижная сцена: дорога, площадка, бензоколонка, шлагбаум, светофор; места: въезд, очередь, проезд, колонка, выезд. */
  function layout(s, shape) {
    const L = BARRIER, lot = L.lot;
    // Дорога — двумя кусками: между ними площадка; на плите — до её краёв
    const st = Kit.street(s, { island: L.slab, seed: L.seed, ground: 'slab', roads: [[R.ends[0], lot.x0], [lot.x1, R.ends[1]]] });
    s.title(['Semaphore', '…']);

    // Площадка за шлагбаумом: асфальт без разметки (рамки мест читались бы как очередь слотов, а разрешения семафора
    // обезличены — кто прошёл, тот встаёт к любому свободному месту); штакетник по дальним краям (вход и выезд —
    // открыты), скамейка, фонари — в дальних углах (у ближнего правого фонарь встал бы перед машиной у колонки)
    O.asphalt(s, lot.x0, lot.y0, lot.x1, lot.y1);
    O.picket(s, lot.x0, lot.y0, lot.x1 - lot.x0, 'x');
    O.picket(s, lot.x0, lot.y0, -0.25 - lot.y0, 'y');
    O.bench(s, lot.x1 - 1.3, lot.y1 - 0.55);
    O.streetLamp(s, lot.x0 + 1.6, lot.y0 + 0.3);
    O.streetLamp(s, lot.x1 - 0.4, lot.y0 + 0.3);

    // Шлагбаум опущен, перед ним стоп-линия; светофор: сколько разрешений свободно из скольких
    O.stopLine(s, L.gateX - 0.2);
    const gate = O.barrierGate(s, L.gateX);
    const light = O.trafficLight(s, L.gateX, { free: true, counter: `${shape.permits} / ${shape.permits}`, details: ['Semaphore', '…'] });

    // Бензоколонка: одна двусторонняя колонка; место spot0 — машина перед ней (вдоль дороги), spot1 — за ней.
    // Навес — над колонкой, с выносом вправо: правый столб — правее дальней машины (fuelStation с pairs)
    const behind = O.CAR.W + 2 * 0.22 + 0.24; // от центра ближней машины до центра дальней: машина, два зазора, колонка
    const spots = Array.from({ length: shape.permits }, (_, i) => [L.pump.x + O.CAR.L / 2, L.pump.y + O.CAR.W / 2 - i * behind]);
    const station = O.fuelStation(s, { shop: L.shop, pumps: spots, label: { lines: ['task #?', '…'], color: C.accent }, pairs: true });

    // Места: очередь и проезды — на полосе, одной цепочкой; на площадку — через проезд за шлагбаумом, с неё — на выезд.
    // Ждущие сверх LIMITS.waiting — «+N» над хвостом очереди
    st.lanePlace('gate', L.gateX + 0.7);
    st.lanePlace('lotOut', lot.x1 + 0.2);
    const waiting = st.waitLine('wait', LIMITS.waiting, i => L.waiting.firstX - i * L.waiting.step + O.CAR.L / 2);
    spots.forEach((at, i) => st.place(`spot${i}`, at));
    const links = spots.flatMap((_, i) => [['gate', `spot${i}`], [`spot${i}`, 'lotOut']]);

    st.keepOut([lot.x0 - 0.3, lot.y0 - 0.3, lot.x1 + 0.3, lot.y1 + 0.3], [L.gateX - 0.6, -0.9, L.gateX + 0.4, 1.6]);

    let runs = new Map(); // кто внутри задачи (по имени потока) — для табло колонок
    function update(snap) {
      runs = new Map(snap.inside.map(r => [r.name, r]));
      s.retitle(titleOf(snap));
      light.set(snap.available > 0, `${snap.available} / ${snap.permits}`,
        ['Semaphore', `${snap.available} of ${snap.permits} permits free · ${snap.waiting.length} waiting`]);
      s.relabel(station.label, shopLines(snap));
      waiting.update(snap.waiting.length);
    }

    /**
     * Стрела — «пропустили одного»: поднимается, когда к шлагбауму подъезжает машина, едущая на площадку
     * (её цель — spot…: поток прошёл acquire), и опускается, когда она проехала. Светофор — состояние, стрела — событие
     */
    let open = 0, lastFrame = null;
    function swingGate(now, actors) {
      const passing = actors.some(a => String(a.target).startsWith('spot') && a.x > L.gateX - GATE_ZONE.before && a.x < L.gateX + GATE_ZONE.after);
      const want = passing ? 1 : 0, dt = lastFrame == null ? 16 : Math.min(now - lastFrame, 50);
      lastFrame = now;
      const step = dt / GATE_SWING_MS;
      open = want > open ? Math.min(want, open + step) : Math.max(want, open - step);
      gate.setOpen(open);
      if (open === want) lastFrame = null; // покой: следующий взмах начнётся с нормального шага
      return open !== want;
    }

    /**
     * Табло колонок: колонка i заправляет, когда у неё стоит машина (доехала до spot{i}), а её поток — внутри задачи.
     * Пока машина едет — колонка пустая. Перерисовка — только когда сменилась доля (шаг 2%) или поток
     */
    const pumpKeys = [];
    function fuelPumps(now, actors) {
      const parked = new Map();
      for (const a of actors) {
        const i = spots.findIndex(([x, y]) => Math.hypot(a.x - x, a.y - y) < 0.02);
        if (i >= 0 && a.target === `spot${i}`) parked.set(i, a.key);
      }
      let fueling = false;
      spots.forEach((_, i) => {
        const name = parked.get(i), run = name != null ? runs.get(name) : null;
        const f = run ? (run.progress ?? Kit.progress(run, run.durationMs)) : null;
        if (run && run.progress == null && f < 1) fueling = true;
        const key = f == null ? '' : `${name}|${Math.round(f * 50)}`;
        if (pumpKeys[i] !== key) { pumpKeys[i] = key; station.setFuel(i, f, f == null ? undefined : threadColor(name)); }
      });
      return fueling;
    }

    // Кадр: стрела и табло; true — кадры нужны дальше
    function frame(now, actors) {
      const swinging = swingGate(now, actors);
      return fuelPumps(now, actors) || swinging;
    }

    return st.layout(L.decorSeed, { links, update, frame });
  }

  /**
   * Кто где: ждущие — по местам очереди, внутри — к свободному месту у колонки (место закрепляется за потоком).
   * Получивший отказ разворачивается и уезжает назад, к въезду: через шлагбаум он не проезжал. Ждавший (таймаут) —
   * сразу со своего места в очереди; получивший отказ сразу (tryAcquire()) — сначала подъезжает к шлагбауму, на место
   * за ждущими, видит красный и разворачивается: доехал — стоит DWELL_MS, пропал из снимка — уезжает на exit (entry).
   * Явно, по rejected, а не exit у ждущих: получивший разрешение на миг пропадает из снимка (между acquire и run) —
   * он дёрнулся бы назад
   */
  function actorsOf(snap) {
    const car = (name, place, extra) => { const color = threadColor(name); return { key: name, place, color, label: { lines: [Kit.THREAD_LABEL], color }, ...extra }; };
    const queued = Math.min(snap.waiting.length, LIMITS.waiting);
    let tail = queued; // следующее место за ждущими; сверх мест — все в последнее
    return [
      ...snap.waiting.slice(0, LIMITS.waiting).map((name, i) => car(name, `wait${i}`)),
      ...snap.inside.slice(0, LIMITS.inside).map(r => car(r.name, 'spot*')),
      ...(snap.rejected ?? []).map(r => car(r.name,
        r.waited ? 'entry' : `wait${Math.min(tail++, LIMITS.waiting - 1)}`, { exit: 'entry' })),
    ];
  }

  // ---------- Снимок из плитки (index.html) ----------

  /**
   * Снимок из store semaphoretask.js: ждущие и получившие отказ — из модели семафора (отказ — leaving вида none,
   * как в плитке), внутри — потоки в run() задачи
   */
  function semaphoreSnapshot(store, item) {
    const sem = store.semaphores.items.get(item.semaphoreId);
    const task = store.tasks.get(item.taskId);
    const inside = [];
    for (const [name, run] of task?.runs ?? []) {
      if (run.phase === 'RUN') inside.push({ name, startedAt: run.startedAt, durationMs: task.durationMs });
    }
    return {
      permits: sem?.state?.initialPermits ?? 0,
      available: sem?.state?.availablePermits ?? 0,
      taskId: item.taskId ?? '?',
      taskDuration: KV.seconds(task?.durationMs),
      inside,
      waiting: [...(sem?.waiting.keys() ?? [])],
      rejected: (sem?.leaving ?? []).filter(l => l.kind === 'none' && performance.now() - l.start < REJECTED_MS)
        .map(l => ({ name: l.thread, waited: l.blocking })),
    };
  }

  // Пока не запущен: пустая бензоколонка на столько мест, сколько стоит в поле permits
  const idle = permits => ({ permits, available: permits, taskId: '?', taskDuration: '?', inside: [], waiting: [], rejected: [] });

  /** @type {Kind} */
  const kind = {
    name: 'semaphore', uid: 'sem', backdrop: 'none', // плита парит над страницей — без воды
    shapeOf(tile) {
      const item = Tiles.itemOf(tile);
      const sem = item ? tile.store.semaphores.items.get(item.semaphoreId) : null;
      const permits = Math.min(sem?.state ? sem.state.initialPermits : Kit.field(tile, 'permits', LIMITS.inside), LIMITS.inside);
      return { key: `${tile.id ?? 'idle'}:${permits}`, permits };
    },
    layout,
    snapshotOf(tile, shape) {
      const item = Tiles.itemOf(tile);
      return item?.semaphoreId != null ? semaphoreSnapshot(tile.store, item) : idle(shape.permits);
    },
    actorsOf,
  };

  return { kind, LIMITS, demo, demoShape: { key: 'demo', permits: demo.permits } };
})();
