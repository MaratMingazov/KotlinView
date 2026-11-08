/*
 * Диорамы: «автомойка» (fixed-пул) и «шлагбаум» (задача под семафором). Статичные снимки, без сервера и анимации.
 * Здесь — только смысл: что из снимка где стоит и что написано в табличках. Как это нарисовано — iso-objects.js.
 * Подключение: после iso-scene.js и iso-objects.js. Всё лежит в объекте Diorama.
 */
const Diorama = (() => {
  const { createScene, threadColor, PALETTE: C } = Iso;
  const O = IsoObjects;
  const percent = fraction => `${Math.round(fraction * 100)}%`;

  // ---------- Снимки ----------

  const POOL = {
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

  const SEMAPHORE = {
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

  function carWash() {
    const s = createScene(), L = WASH;
    O.island(s, ...L.island, L.seed);
    O.road(s, ...ROAD_ENDS, { skip: L.noMarks });
    O.zebra(s, L.zebraX);

    // Очередь: места разметкой, на занятых — машины-задачи
    const slotX = i => L.queue.headX - i * L.queue.step;
    for (let i = 0; i < POOL.queueCapacity; i++) O.slot(s, slotX(i), L.queue.y);
    POOL.queue.forEach((t, i) => {
      const color = O.carColor(t.id);
      O.car(s, slotX(i) + 0.08, LANE_Y, color, { rack: t.id % 3 === 0,
        label: { lines: [`task #${t.id}`, i === 0 ? 'queued · next in line' : `queued · ${i + 1} in line`], color } });
    });
    O.sign(s, ...L.queueSign, `${POOL.queue.length} / ${POOL.queueCapacity}`, C.text);

    // Только что пришла: на въезде
    for (const t of POOL.incoming) {
      const color = O.carColor(t.id);
      O.car(s, L.incomingX, LANE_Y, color, { label: { lines: [`task #${t.id}`, 'just submitted'], color } });
    }

    // Мойка — одно здание, ворота на каждый бокс-воркер; к воротам — съезды с дороги
    const wash = O.washHouse(s, L.house.x, L.house.y, POOL.workers, w => {
      const color = threadColor(w.name);
      return { lines: [w.name, `task #${w.task.id} · ${percent(w.progress)}`], color, bar: { fraction: w.progress, color } };
    });
    POOL.workers.forEach((w, i) => {
      const [bx, by] = wash.bayCenter(i);
      s.ground.push(s.flat(bx - 0.55, by, 1.1, -by, C.road));
    });
    s.title(['ThreadPoolExecutor', `newFixedThreadPool(${POOL.workers.length}) · queue ${POOL.queueCapacity}`]);

    // Выезд: помытые уезжают (выцветшие), счётчик выполненных
    POOL.done.forEach((t, i) => {
      const color = O.carColor(t.id);
      O.car(s, L.exit[i].x, LANE_Y, color, { faded: true, rack: !!L.exit[i].rack, label: { lines: [`task #${t.id}`, 'done'], color } });
    });
    O.sign(s, ...L.doneSign, `✓ ${POOL.doneCount}`);

    // Растительность — не на дороге, не в мойке со съездами и не у столбиков
    const [qx, qy] = L.queueSign, [dx, dy] = L.doneSign;
    O.decorate(s, L.decorSeed, [
      [-8, -0.3, 18, 1.5],
      [L.house.x - 0.2, L.house.y - 0.3, L.house.x + wash.width + 0.6, 0],
      [qx - 0.2, qy - 0.25, qx + 0.3, qy + 0.35],
      [dx - 0.2, dy - 0.25, dx + 0.3, dy + 0.35],
    ]);
    return s.render();
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

  function barrier() {
    const s = createScene(), L = BARRIER, lot = L.lot;
    O.island(s, ...L.island, L.seed);
    s.title([`Semaphore(${SEMAPHORE.permits})`, `guarding task #${SEMAPHORE.taskId} · ${SEMAPHORE.waiting.length} waiting`]);
    for (const [from, to] of L.roads) O.road(s, from, to);

    // Площадка за шлагбаумом: плитка, штакетник по дальним краям (вход и выезд — открыты), скамейки, фонари
    O.paved(s, lot.x0, lot.y0, lot.x1, lot.y1);
    O.picket(s, lot.x0, lot.y0, lot.x1 - lot.x0, 'x');
    O.picket(s, lot.x0, lot.y0, -0.25 - lot.y0, 'y');
    O.bench(s, lot.x0 + 0.6, lot.y0 + 0.25);
    O.bench(s, lot.x1 - 1.3, lot.y1 - 0.55);
    O.streetLamp(s, lot.x0 + 1.6, lot.y0 + 0.3);
    O.streetLamp(s, lot.x1 - 0.4, lot.y1 - 0.4);

    // Ждущие у шлагбаума: цвет — поток, в порядке прихода
    SEMAPHORE.waiting.forEach((name, i) => {
      const color = threadColor(name);
      O.car(s, L.waiting.firstX - i * L.waiting.step, LANE_Y, color,
        { label: { lines: [name, `waits in acquire() · ${i === 0 ? 'first' : `#${i + 1}`}`], color } });
    });

    // Шлагбаум опущен, перед ним стоп-линия; светофор: сколько разрешений свободно из скольких
    O.stopLine(s, L.gateX - 0.2);
    O.barrierGate(s, L.gateX);
    const { available, permits } = SEMAPHORE;
    O.trafficLight(s, L.gateX, {
      free: available > 0,
      counter: `${available} / ${permits}`,
      details: ['Semaphore', `${available} of ${permits} permits free · ${SEMAPHORE.waiting.length} waiting`],
    });

    // Задача — домик на площадке; перед ним те, кто прошёл шлагбаум и сейчас внутри run
    const h = L.house;
    O.house(s, h.x, h.y, h.w, h.d, h.h, { lines: [`task #${SEMAPHORE.taskId}`, `${SEMAPHORE.taskDuration} · ${SEMAPHORE.inside.length} runners inside`], color: C.accent });
    SEMAPHORE.inside.forEach((r, i) => {
      const color = threadColor(r.name);
      O.car(s, h.x - 0.2 + i * L.inside.step, L.inside.y, color,
        { label: { lines: [r.name, `in task #${SEMAPHORE.taskId} · ${percent(r.progress)}`], color, bar: { fraction: r.progress, color } } });
    });

    O.decorate(s, L.decorSeed, [[-8, -0.3, 18, 1.5], [lot.x0 - 0.3, lot.y0 - 0.3, lot.x1 + 0.3, lot.y1 + 0.3], [L.gateX - 0.6, -0.9, L.gateX + 0.4, 1.6]]);
    return s.render();
  }

  // ---------- Монтирование ----------

  function mount({ washRoot, barrierRoot }) {
    washRoot.replaceChildren(carWash());
    barrierRoot.replaceChildren(barrier());
  }

  return { mount };
})();
