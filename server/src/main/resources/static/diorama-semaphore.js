/*
 * Диорама задачи под семафором — «шлагбаум» — описанием для набора (diorama-kit.js).
 * машина = поток-раннер (цвет потока) · шлагбаум и светофор = семафор · домик на площадке = задача.
 * Поток ждёт у шлагбаума в порядке прихода; прошёл acquire — едет на площадку к домику (место за ним закреплено,
 * пока он там: группа мест spot*); закончил — пропадает из снимка, и набор увозит машину за мост.
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
    house: { x: 7.6, y: -1.3, w: 2.4, d: 1.2, h: 1.0 },
    inside: { y: 0.5, step: 1.6 },            // раннеры — перед домиком
    decorSeed: 23,
  };

  /**
   * Снимок семафора: permits — всего, available — свободно; inside — раннеры внутри задачи, waiting — ждущие
   * в acquire в порядке прихода
   */
  const demo = {
    permits: 2, available: 0, taskId: 7, taskDuration: '5.0s',
    inside: [{ name: 'sem-runner-1', progress: 0.6 }, { name: 'sem-runner-2', progress: 0.2 }],
    waiting: ['sem-runner-3', 'sem-runner-4', 'sem-runner-5'],
  };

  const titleOf = snap => [`Semaphore(${snap.permits})`, `guarding task #${snap.taskId} · ${snap.waiting.length} waiting`];
  const houseLines = snap => [`task #${snap.taskId}`, `${snap.taskDuration} · ${snap.inside.length} runners inside`];

  // ---------- Сцена ----------

  /** Неподвижная сцена: дорога, площадка, домик, шлагбаум, светофор; места: въезд, очередь, проезд, площадка, выезд. */
  function layout(s, shape) {
    const L = BARRIER, lot = L.lot, h = L.house;
    O.island(s, ...L.island, L.seed);
    s.title(['Semaphore', '…']);
    O.road(s, R.ends[0], lot.x0);
    O.road(s, lot.x1, R.ends[1]);

    // Площадка за шлагбаумом: плитка, штакетник по дальним краям (вход и выезд — открыты), скамейки, фонари
    O.paved(s, lot.x0, lot.y0, lot.x1, lot.y1);
    O.picket(s, lot.x0, lot.y0, lot.x1 - lot.x0, 'x');
    O.picket(s, lot.x0, lot.y0, -0.25 - lot.y0, 'y');
    O.bench(s, lot.x0 + 0.6, lot.y0 + 0.25);
    O.bench(s, lot.x1 - 1.3, lot.y1 - 0.55);
    O.streetLamp(s, lot.x0 + 1.6, lot.y0 + 0.3);
    O.streetLamp(s, lot.x1 - 0.4, lot.y1 - 0.4);

    // Шлагбаум опущен, перед ним стоп-линия; светофор: сколько разрешений свободно из скольких
    O.stopLine(s, L.gateX - 0.2);
    const gate = O.barrierGate(s, L.gateX);
    const light = O.trafficLight(s, L.gateX, { free: true, counter: `${shape.permits} / ${shape.permits}`, details: ['Semaphore', '…'] });
    const houseLabel = O.house(s, h.x, h.y, h.w, h.d, h.h, { lines: ['task #?', '…'], color: C.accent });

    // Ждущие сверх LIMITS.waiting — «+N» над хвостом очереди
    const waitX = i => L.waiting.firstX - i * L.waiting.step;
    const more = s.label(waitX(LIMITS.waiting - 1) + O.CAR.L / 2, R.laneY + O.CAR.W / 2, 0.62, ['+0'], { permanent: true });

    O.decorate(s, L.decorSeed, [[-8, -0.3, 18, 1.5], [lot.x0 - 0.3, lot.y0 - 0.3, lot.x1 + 0.3, lot.y1 + 0.3], [L.gateX - 0.6, -0.9, L.gateX + 0.4, 1.6]]);

    // Места: очередь и проезды — на полосе, одной цепочкой; на площадку — через проезд за шлагбаумом, с неё — на выезд
    const onLane = x => [x, R.lane];
    const places = { entry: onLane(R.ends[0] - 0.3), exit: onLane(R.ends[1] + 0.3), gate: onLane(L.gateX + 0.7), lotOut: onLane(lot.x1 + 0.2) };
    for (let i = 0; i < LIMITS.waiting; i++) places[`wait${i}`] = onLane(waitX(i) + O.CAR.L / 2);
    for (let i = 0; i < shape.permits; i++) places[`spot${i}`] = [h.x - 0.2 + i * L.inside.step + O.CAR.L / 2, L.inside.y + O.CAR.W / 2];
    const laneNames = Object.keys(places).filter(name => !name.startsWith('spot'));
    const links = [...Kit.lane(places, laneNames)];
    for (let i = 0; i < shape.permits; i++) links.push(['gate', `spot${i}`], [`spot${i}`, 'lotOut']);

    function update(snap) {
      s.retitle(titleOf(snap));
      light.set(snap.available > 0, `${snap.available} / ${snap.permits}`,
        ['Semaphore', `${snap.available} of ${snap.permits} permits free · ${snap.waiting.length} waiting`]);
      s.relabel(houseLabel, houseLines(snap));
      const extra = snap.waiting.length - LIMITS.waiting;
      if (extra > 0) s.relabel(more, [`+${extra}`]);
      s.showLabel(more, extra > 0);
    }

    /**
     * Стрела — «пропустили одного»: поднимается, когда к шлагбауму подъезжает машина, едущая на площадку
     * (её цель — spot…: поток прошёл acquire), и опускается, когда она проехала. Светофор — состояние, стрела — событие
     */
    let open = 0, lastFrame = null;
    function frame(now, actors) {
      const passing = actors.some(a => String(a.target).startsWith('spot') && a.x > L.gateX - GATE_ZONE.before && a.x < L.gateX + GATE_ZONE.after);
      const want = passing ? 1 : 0, dt = lastFrame == null ? 16 : Math.min(now - lastFrame, 50);
      lastFrame = now;
      const step = dt / GATE_SWING_MS;
      open = want > open ? Math.min(want, open + step) : Math.max(want, open - step);
      gate.setOpen(open);
      if (open === want) lastFrame = null; // покой: следующий взмах начнётся с нормального шага
      return open !== want;
    }

    return { places, links, entry: 'entry', exit: 'exit', update, frame };
  }

  /** Кто где: ждущие — по местам очереди, внутри — на свободное место площадки (закрепляется за потоком). */
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
      if (run.phase === 'RUN') inside.push({ name, progress: Kit.progress(run, task.durationMs) });
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

  // Пока не запущен: пустая площадка на столько мест, сколько стоит в поле permits
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
