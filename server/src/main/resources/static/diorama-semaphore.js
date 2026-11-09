/*
 * Диорама задачи под семафором — «бензоколонка за шлагбаумом» — описанием для набора (diorama-kit.js).
 * машина = поток-раннер (цвет потока) · шлагбаум и светофор = семафор · бензоколонка = задача · заправка = run().
 * Поток ждёт у шлагбаума в порядке прихода; прошёл acquire — едет к свободной колонке (место за ним закреплено,
 * пока он там: группа мест spot*) и заправляется — табло колонки показывает прогресс run(); закончил — пропадает
 * из снимка, и набор увозит машину за мост.
 *
 * Подключение: после diorama-kit.js. На twin.html нужны ещё semaphoretask.js и tiles.js (снимок из плитки).
 * Всё лежит в объекте SemaphoreDiorama: kind — описание для Kit.panel / Kit.show, LIMITS, demo — снимок для prototype.html.
 */
const SemaphoreDiorama = (() => {
  const { threadColor, PALETTE: C } = Iso;
  const O = IsoObjects, R = O.ROAD;

  // Сколько помещается на острове. Больше не рисуем: ждущих сверх — «+N»; разрешений — не больше мест на площадке
  const LIMITS = { waiting: 4, inside: 3 };

  // Стрела: взмах (вверх или вниз) — за GATE_SWING_MS; поднята, пока пропущенная машина в зоне шлагбаума (клетки по x)
  const GATE_SWING_MS = 250;
  const GATE_ZONE = { before: 2.0, after: 1.4 };

  // Раскладка сцены (клетки мира)
  const BARRIER = {
    island: [-4.4, -2.9, 14.4, 3.1], seed: 2.3, // площадка до y = 2.2 — остров чуть шире вниз, чем у мойки
    lot: { x0: 5.4, x1: 11.4, y0: -1.8, y1: 2.2 },
    gateX: 4.6,
    waiting: { firstX: 3.3, step: 1.25 },     // первый — у стоп-линии, остальные — за ним
    shop: { x: 5.6, y: 1.35, w: 1.4, d: 0.7, h: 0.85 }, // магазинчик — у ближнего края: сзади его закрыл бы навес
    pumps: { firstX: 7.4, y: 0.5, step: 1.6 },          // места у колонок: край машины (как в car())
    decorSeed: 23,
  };

  /**
   * Снимок семафора: permits — всего, available — свободно; inside — раннеры внутри задачи { name, startedAt,
   * durationMs } (прогресс считается на каждом кадре) или { name, progress } (статичный показ); waiting — ждущие
   * в acquire в порядке прихода
   */
  const demo = {
    permits: 2, available: 0, taskId: 7, taskDuration: '5.0s',
    inside: [{ name: 'sem-runner-1', progress: 0.6 }, { name: 'sem-runner-2', progress: 0.2 }], // progress — только в демо
    waiting: ['sem-runner-3', 'sem-runner-4', 'sem-runner-5'],
  };

  const titleOf = snap => [`Semaphore(${snap.permits})`, `guarding task #${snap.taskId} · ${snap.waiting.length} waiting`];
  const shopLines = snap => [`task #${snap.taskId}`, `${snap.taskDuration} · ${snap.inside.length} fueling`];

  // ---------- Сцена ----------

  /** Неподвижная сцена: дорога, площадка, бензоколонка, шлагбаум, светофор; места: въезд, очередь, проезд, колонки, выезд. */
  function layout(s, shape) {
    const L = BARRIER, lot = L.lot;
    O.island(s, ...L.island, L.seed);
    s.title(['Semaphore', '…']);
    O.road(s, R.ends[0], lot.x0);
    O.road(s, lot.x1, R.ends[1]);

    // Площадка за шлагбаумом: плитка, штакетник по дальним краям (вход и выезд — открыты), скамейка, фонари.
    // У дальнего края скамейки нет: её закрыл бы навес над колонками
    O.paved(s, lot.x0, lot.y0, lot.x1, lot.y1);
    O.picket(s, lot.x0, lot.y0, lot.x1 - lot.x0, 'x');
    O.picket(s, lot.x0, lot.y0, -0.25 - lot.y0, 'y');
    O.bench(s, lot.x1 - 1.3, lot.y1 - 0.55);
    O.streetLamp(s, lot.x0 + 1.6, lot.y0 + 0.3);
    O.streetLamp(s, lot.x1 - 0.4, lot.y1 - 0.4);

    // Шлагбаум опущен, перед ним стоп-линия; светофор: сколько разрешений свободно из скольких
    O.stopLine(s, L.gateX - 0.2);
    const gate = O.barrierGate(s, L.gateX);
    const light = O.trafficLight(s, L.gateX, { free: true, counter: `${shape.permits} / ${shape.permits}`, details: ['Semaphore', '…'] });

    // Бензоколонка: по колонке на разрешение; место машины у колонки i — spot{i}
    const spotAt = i => [L.pumps.firstX + i * L.pumps.step + O.CAR.L / 2, L.pumps.y + O.CAR.W / 2];
    const spots = Array.from({ length: shape.permits }, (_, i) => spotAt(i));
    const station = O.fuelStation(s, { shop: L.shop, pumps: spots, label: { lines: ['task #?', '…'], color: C.accent } });

    // Ждущие сверх LIMITS.waiting — «+N» над хвостом очереди
    const waitX = i => L.waiting.firstX - i * L.waiting.step;
    const more = s.label(waitX(LIMITS.waiting - 1) + O.CAR.L / 2, R.laneY + O.CAR.W / 2, 0.62, ['+0'], { permanent: true });

    O.decorate(s, L.decorSeed, [[-8, -0.3, 18, 1.5], [lot.x0 - 0.3, lot.y0 - 0.3, lot.x1 + 0.3, lot.y1 + 0.3], [L.gateX - 0.6, -0.9, L.gateX + 0.4, 1.6]]);

    // Места: очередь и проезды — на полосе, одной цепочкой; на площадку — через проезд за шлагбаумом, с неё — на выезд
    const onLane = x => [x, R.lane];
    const places = { entry: onLane(R.ends[0] - 0.3), exit: onLane(R.ends[1] + 0.3), gate: onLane(L.gateX + 0.7), lotOut: onLane(lot.x1 + 0.2) };
    for (let i = 0; i < LIMITS.waiting; i++) places[`wait${i}`] = onLane(waitX(i) + O.CAR.L / 2);
    spots.forEach((at, i) => { places[`spot${i}`] = at; });
    const laneNames = Object.keys(places).filter(name => !name.startsWith('spot'));
    const links = [...Kit.lane(places, laneNames)];
    for (let i = 0; i < shape.permits; i++) links.push(['gate', `spot${i}`], [`spot${i}`, 'lotOut']);

    let runs = new Map(); // кто внутри задачи (по имени потока) — для табло колонок
    function update(snap) {
      runs = new Map(snap.inside.map(r => [r.name, r]));
      s.retitle(titleOf(snap));
      light.set(snap.available > 0, `${snap.available} / ${snap.permits}`,
        ['Semaphore', `${snap.available} of ${snap.permits} permits free · ${snap.waiting.length} waiting`]);
      s.relabel(station.label, shopLines(snap));
      const extra = snap.waiting.length - LIMITS.waiting;
      if (extra > 0) s.relabel(more, [`+${extra}`]);
      s.showLabel(more, extra > 0);
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

    return { places, links, entry: 'entry', exit: 'exit', update, frame };
  }

  /** Кто где: ждущие — по местам очереди, внутри — к свободной колонке (место закрепляется за потоком). */
  function actorsOf(snap) {
    const car = (name, place) => { const color = threadColor(name); return { key: name, place, color, label: { lines: [name], color } }; };
    return [
      ...snap.waiting.slice(0, LIMITS.waiting).map((name, i) => car(name, `wait${i}`)),
      ...snap.inside.slice(0, LIMITS.inside).map(r => car(r.name, 'spot*')),
    ];
  }

  // ---------- Снимок из плитки (twin.html) ----------

  /** Снимок из store semaphoretask.js: ждущие — из модели семафора, внутри — потоки в run() задачи. */
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
    };
  }

  // Пока не запущен: пустая бензоколонка на столько колонок, сколько стоит в поле permits
  const idle = permits => ({ permits, available: permits, taskId: '?', taskDuration: '?', inside: [], waiting: [] });

  /** @type {Kind} */
  const kind = {
    name: 'semaphore', uid: 'sem',
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
