/*
 * Диорамы: «автомойка» (fixed-пул) и «шлагбаум» (задача под семафором).
 * Сцена рисует снимок — простой объект «что сейчас происходит». Откуда он — не её дело: на prototype.html это
 * демо-снимки ниже, на twin.html — снимки из store живой плитки (diorama-live.js).
 * Здесь — только смысл: что из снимка где стоит и что написано в табличках. Как это нарисовано — iso-objects.js.
 * Подключение: после iso-scene.js и iso-objects.js. Всё лежит в объекте Diorama.
 */
const Diorama = (() => {
  const { createScene, threadColor, PALETTE: C } = Iso;
  const O = IsoObjects;
  const percent = fraction => `${Math.round(fraction * 100)}%`;

  // Сколько помещается на острове. Больше — не рисуем: плитки на twin.html не дают создать больше (tiles.js, max)
  const LIMITS = { slots: 5, bays: 3, waiting: 4, inside: 3, exit: 2 };

  // ---------- Демо-снимки (prototype.html) ----------

  /**
   * Снимок пула: queue — задачи в очереди (голова — первая); workers — по боксу на поток до maximumPoolSize:
   * { name, task: { id } | null, progress } — name = null: свободный бокс; done — только что выполненные (уезжают)
   */
  const SAMPLE_POOL = {
    title: ['ThreadPoolExecutor', 'newFixedThreadPool(3) · queue 5'],
    queueCapacity: 5,
    incoming: [{ id: 24 }],
    queue: [{ id: 21 }, { id: 22 }, { id: 23 }],
    workers: [
      { name: 'worker-1', task: { id: 18 }, progress: 0.8 },
      { name: 'worker-2', task: { id: 19 }, progress: 0.45 },
      { name: 'worker-3', task: { id: 20 }, progress: 0.1 },
    ],
    done: [{ id: 17 }, { id: 16 }],
    doneCount: 17,
  };

  /** Снимок семафора: inside — раннеры внутри задачи (с прогрессом), waiting — ждущие в acquire, по порядку прихода. */
  const SAMPLE_SEMAPHORE = {
    permits: 2, available: 0, taskId: 7, taskDuration: '5.0s',
    inside: [{ name: 'sem-runner-1', progress: 0.6 }, { name: 'sem-runner-2', progress: 0.2 }],
    waiting: ['sem-runner-3', 'sem-runner-4', 'sem-runner-5'],
  };

  // Общее для обеих сцен: машина стоит на полосе (y — край полосы + отступ); дорога уходит мостами за берег
  const LANE_Y = 0.35;
  const ROAD_ENDS = [-6.3, 16.3];

  // ---------- Диорама 1: автомойка = fixed-пул ----------
  // машина = задача · белые рамки на дороге = ячейки очереди · бокс мойки = поток-воркер (маркиза — его цвет)

  const WASH = {
    island: [-4.4, -3.2, 14.4, 2.7], seed: 1,
    noMarks: [-0.6, 5.9],                  // без пунктира: очередь и «зебра»
    zebraX: 5.3,                           // переход между головой очереди и мойкой
    queue: { headX: 4.1, step: 1.15, y: 0.15 }, // голова — ближе всего к мойке, хвост — к въезду
    incomingX: -3.6,
    house: { x: 5.9, y: -2.5 },
    exit: [{ x: 11.8 }, { x: 13.6, rack: true }],
    queueSign: [1.2, 1.75], doneSign: [12.4, 1.75],
    decorSeed: 11,
  };

  // Табличка бокса: свободный, ждущий задачу или работающий — с полоской прогресса
  function bayLabel(w) {
    if (!w.name) return { lines: ['free bay', 'no thread yet: the pool creates it on execute'] };
    const color = threadColor(w.name);
    if (!w.task) return { lines: [w.name, 'idle · waits in take()'], color };
    return { lines: [w.name, `task #${w.task.id} · ${percent(w.progress)}`], color, bar: { fraction: w.progress, color } };
  }

  /**
   * Построить мойку по снимку. live — живая сцена: без машин (их везут актёры, diorama-live.js), а вместо этого
   * вернуть ручки — счётчики, боксы и точки маршрутов. Без live — обычный снимок
   */
  function buildWash(pool, { scene, live = false } = {}) {
    const s = createScene(scene), L = WASH;
    O.island(s, ...L.island, L.seed);
    O.road(s, ...ROAD_ENDS, { skip: L.noMarks });
    O.zebra(s, L.zebraX);

    // Очередь: места разметкой (не больше, чем помещается), на занятых — машины-задачи
    const slotX = i => L.queue.headX - i * L.queue.step;
    const slots = Math.min(pool.queueCapacity, LIMITS.slots);
    for (let i = 0; i < slots; i++) O.slot(s, slotX(i), L.queue.y);
    if (!live) pool.queue.slice(0, slots).forEach((t, i) => {
      const color = O.carColor(t.id);
      O.car(s, slotX(i) + 0.08, LANE_Y, color, { rack: t.id % 3 === 0,
        label: { lines: [`task #${t.id}`, i === 0 ? 'queued · next in line' : `queued · ${i + 1} in line`], color } });
    });
    const queueSign = O.sign(s, ...L.queueSign, `${pool.queue.length} / ${pool.queueCapacity}`, C.text);

    // Только что пришла: на въезде
    for (const t of live ? [] : pool.incoming ?? []) {
      const color = O.carColor(t.id);
      O.car(s, L.incomingX, LANE_Y, color, { label: { lines: [`task #${t.id}`, 'just submitted'], color } });
    }

    // Мойка — одно здание, ворота на каждый бокс-воркер; к воротам — съезды с дороги
    const workers = pool.workers.slice(0, LIMITS.bays);
    const wash = O.washHouse(s, L.house.x, L.house.y, live ? workers.map(w => ({ ...w, task: null })) : workers, bayLabel);
    workers.forEach((w, i) => {
      const [bx, by] = wash.bayCenter(i);
      s.ground.push(s.flat(bx - 0.55, by, 1.1, -by, C.road));
    });
    if (pool.title) s.title(pool.title);

    // Выезд: только что выполненные уезжают (выцветшие), счётчик выполненных
    (live ? [] : pool.done.slice(0, LIMITS.exit)).forEach((t, i) => {
      const color = O.carColor(t.id);
      O.car(s, L.exit[i].x, LANE_Y, color, { faded: true, rack: !!L.exit[i].rack, label: { lines: [`task #${t.id}`, 'done'], color } });
    });
    const doneSign = O.sign(s, ...L.doneSign, `✓ ${pool.doneCount}`);

    // Растительность — не на дороге, не в мойке со съездами и не у столбиков
    const [qx, qy] = L.queueSign, [dx, dy] = L.doneSign;
    O.decorate(s, L.decorSeed, [
      [-8, -0.3, 18, 1.5],
      [L.house.x - 0.2, L.house.y - 0.3, L.house.x + wash.width + 0.6, 0],
      [qx - 0.2, qy - 0.25, qx + 0.3, qy + 0.35],
      [dx - 0.2, dy - 0.25, dx + 0.3, dy + 0.35],
    ]);
    return { s, wash, queueSign, doneSign, slotX };
  }

  /** Автомойка по снимку пула. scene — { uid } для createScene; render — { hover, onHover } для render() */
  function carWash(pool = SAMPLE_POOL, { scene, render } = {}) {
    return buildWash(pool, { scene }).s.render(render);
  }

  // Центр машины на полосе: машина стоит от края полосы на LANE_Y, ширина — IsoObjects.CAR.W
  const LANE = LANE_Y + O.CAR.W / 2;

  /**
   * Живая мойка: остров и здание на bays боксов, без машин. Возвращает сцену (s.actor — для машин), корень <svg>
   * и что менять на месте: счётчики, шапку, боксы. points — точки маршрутов машин (центры, мир): въезд и выезд
   * за мостами, полоса, слоты очереди, ворота и место в каждом боксе
   */
  function liveWash(bays, { scene } = {}) {
    const empty = { queueCapacity: LIMITS.slots, queue: [], incoming: [], done: [], doneCount: 0,
      workers: Array.from({ length: Math.min(bays, LIMITS.bays) }, () => ({ name: null, task: null, progress: 0 })),
      title: ['ThreadPoolExecutor', '…'] };
    const built = buildWash(empty, { scene, live: true });
    const root = built.s.render();
    const { s, wash, slotX } = built;
    return {
      s, root,
      setQueue: (n, capacity) => s.relabel(built.queueSign, [`${n} / ${capacity}`]),
      setDone: n => s.relabel(built.doneSign, [`✓ ${n}`]),
      setTitle: lines => s.retitle(lines),
      paintBay: (i, worker) => wash.paintBay(i, worker),
      bayLabel,
      points: {
        lane: LANE,
        entry: [ROAD_ENDS[0] - 0.3, LANE], exit: [ROAD_ENDS[1] + 0.3, LANE],
        slot: i => [slotX(i) + 0.08 + O.CAR.L / 2, LANE],
        gate: i => [wash.bayCenter(i)[0], LANE],
        bay: i => wash.parkAt(i),
      },
    };
  }

  // ---------- Диорама 2: шлагбаум = задача под семафором ----------
  // машина = поток-раннер (цвет потока) · шлагбаум и светофор = семафор · домик на площадке = задача

  const BARRIER = {
    island: [-4.4, -2.9, 14.4, 3.1], seed: 2.3, // площадка до y = 2.2 — остров чуть шире вниз, чем у мойки
    roads: [[ROAD_ENDS[0], 5.4], [11.4, ROAD_ENDS[1]]], // до площадки и после неё
    lot: { x0: 5.4, x1: 11.4, y0: -1.8, y1: 2.2 },
    gateX: 4.6,
    waiting: { firstX: 3.3, step: 1.25 },     // первый — у стоп-линии, остальные — за ним
    house: { x: 7.6, y: -1.3, w: 2.4, d: 1.2, h: 1.0 },
    inside: { y: 0.5, step: 1.6 },            // раннеры — перед домиком
    decorSeed: 23,
  };

  /** Построить шлагбаум по снимку. live — без машин (их везут актёры), с ручками для обновления на месте */
  function buildBarrier(sem, { scene, live = false } = {}) {
    const s = createScene(scene), L = BARRIER, lot = L.lot;
    O.island(s, ...L.island, L.seed);
    s.title([`Semaphore(${sem.permits})`, `guarding task #${sem.taskId} · ${sem.waiting.length} waiting`]);
    for (const [from, to] of L.roads) O.road(s, from, to);

    // Площадка за шлагбаумом: плитка, штакетник по дальним краям (вход и выезд — открыты), скамейки, фонари
    O.paved(s, lot.x0, lot.y0, lot.x1, lot.y1);
    O.picket(s, lot.x0, lot.y0, lot.x1 - lot.x0, 'x');
    O.picket(s, lot.x0, lot.y0, -0.25 - lot.y0, 'y');
    O.bench(s, lot.x0 + 0.6, lot.y0 + 0.25);
    O.bench(s, lot.x1 - 1.3, lot.y1 - 0.55);
    O.streetLamp(s, lot.x0 + 1.6, lot.y0 + 0.3);
    O.streetLamp(s, lot.x1 - 0.4, lot.y1 - 0.4);

    // Ждущие у шлагбаума: цвет — поток, в порядке прихода. Не поместились — «+N» над последней машиной
    const shown = live ? [] : sem.waiting.slice(0, LIMITS.waiting);
    const waitX = i => L.waiting.firstX - i * L.waiting.step;
    shown.forEach((name, i) => {
      const color = threadColor(name);
      O.car(s, waitX(i), LANE_Y, color, { label: { lines: [name, `waits in acquire() · ${i === 0 ? 'first' : `#${i + 1}`}`], color } });
    });
    const more = sem.waiting.length - shown.length;
    if (more > 0) s.label(waitX(shown.length - 1) + 0.46, LANE_Y + 0.26, 0.62, [`+${more}`], { permanent: true });

    // Шлагбаум опущен, перед ним стоп-линия; светофор: сколько разрешений свободно из скольких
    O.stopLine(s, L.gateX - 0.2);
    O.barrierGate(s, L.gateX);
    const { available, permits } = sem;
    const light = O.trafficLight(s, L.gateX, {
      free: available > 0,
      counter: `${available} / ${permits}`,
      details: ['Semaphore', `${available} of ${permits} permits free · ${sem.waiting.length} waiting`],
    });

    // Задача — домик на площадке; перед ним те, кто прошёл шлагбаум и сейчас внутри run
    const h = L.house;
    O.house(s, h.x, h.y, h.w, h.d, h.h, { lines: [`task #${sem.taskId}`, `${sem.taskDuration} · ${sem.inside.length} runners inside`], color: C.accent });
    (live ? [] : sem.inside.slice(0, LIMITS.inside)).forEach((r, i) => {
      const color = threadColor(r.name);
      O.car(s, h.x - 0.2 + i * L.inside.step, L.inside.y, color,
        { label: { lines: [r.name, `in task #${sem.taskId} · ${percent(r.progress)}`], color, bar: { fraction: r.progress, color } } });
    });

    O.decorate(s, L.decorSeed, [[-8, -0.3, 18, 1.5], [lot.x0 - 0.3, lot.y0 - 0.3, lot.x1 + 0.3, lot.y1 + 0.3], [L.gateX - 0.6, -0.9, L.gateX + 0.4, 1.6]]);
    return { s, light, waitX };
  }

  /** Шлагбаум по снимку семафора. scene — { uid } для createScene; render — { hover, onHover } для render() */
  function barrier(sem = SAMPLE_SEMAPHORE, { scene, render } = {}) {
    return buildBarrier(sem, { scene }).s.render(render);
  }

  /**
   * Живой шлагбаум: остров, площадка, домик, светофор — без машин. Возвращает сцену, корень <svg>, что менять
   * на месте (светофор, шапку) и точки маршрутов: въезд и выезд за мостами, место в очереди у шлагбаума,
   * проезд за шлагбаум и место на площадке у домика
   */
  function liveBarrier(permits, { scene } = {}) {
    const idle = { permits, available: permits, taskId: '?', taskDuration: '?', inside: [], waiting: [] };
    const built = buildBarrier(idle, { scene, live: true });
    const root = built.s.render();
    const { s, light, waitX } = built, h = BARRIER.house;
    return {
      s, root,
      setLight: (available, total, waiting) => light.set(available > 0, `${available} / ${total}`,
        ['Semaphore', `${available} of ${total} permits free · ${waiting} waiting`]),
      setTitle: lines => s.retitle(lines),
      points: {
        lane: LANE,
        entry: [ROAD_ENDS[0] - 0.3, LANE], exit: [ROAD_ENDS[1] + 0.3, LANE],
        wait: i => [waitX(i) + O.CAR.L / 2, LANE],
        gate: [BARRIER.gateX + 0.7, LANE],
        spot: i => [h.x - 0.2 + i * BARRIER.inside.step + O.CAR.L / 2, BARRIER.inside.y + O.CAR.W / 2],
      },
    };
  }

  // ---------- Демо: prototype.html ----------

  function mount({ washRoot, barrierRoot }) {
    washRoot.replaceChildren(carWash());
    barrierRoot.replaceChildren(barrier());
  }

  return { mount, carWash, barrier, liveWash, liveBarrier, LIMITS };
})();
