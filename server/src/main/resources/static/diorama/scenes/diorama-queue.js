/*
 * Диорама LinkedBlockingQueue — «конвейер-мост между двумя дорогами» — описанием для набора (diorama-kit.js).
 * ящик = задача · конвейер = очередь (хвост у левой дороги, голова у правой) · транспорт = поток (цвет потока).
 * Сцена — на парящей плите: слева дорога отдающих (грузовики), справа — берущих (погрузчики), между ними только
 * конвейер: «производители → очередь → потребители».
 * offer — грузовик (HTTP-поток) едет по левой дороге сверху с ящиком на крыше и встаёт у хвоста: принят — ящик ложится
 * на ленту, грузовик едет дальше вниз; очередь полна — разворачивается и увозит ящик назад (offer неблокирующий).
 * take — погрузчик (поток в take) приезжает по правой дороге сверху и ждёт на ней ниже подъезда к голове (блокирующий:
 * ждёт, пока появится ящик); получил задачу — подъезжает к голове, берёт ящик на вилы и увозит наверх.
 * put — как offer, но на полной ленте грузовик не разворачивается, а ждёт в очереди на дороге перед погрузкой; место
 * освободилось — подъезжает, ящик ложится на хвост. poll — как take, но ждёт не дольше таймаута: не дождался —
 * погрузчик уезжает пустым.
 *
 * Подключение: после diorama-kit.js и diorama-street.js. На index.html нужны ещё blockingqueue.js и tiles.js (снимок).
 * Всё лежит в объекте QueueDiorama: kind — описание для Kit.panel / Kit.show, LIMITS, demo — снимок для prototype.html.
 */
const QueueDiorama = (() => {
  const { threadColor, PALETTE: C } = Iso;
  const O = IsoObjects;

  // Сколько помещается на плите: мест на ленте (ёмкость больше не даёт поле плитки), ждущих в take / poll на правой
  // дороге и ждущих в put на левой; сверх — «+N» (на местах — первые пришедшие: стоящие не уезжают, когда приходит новый)
  const LIMITS = { slots: 5, waiting: 3, putWaiting: 3 };

  // Раскладка сцены (клетки мира): обе дороги — вдоль y, конвейер — между ними. Плита — вплотную к содержимому:
  // по y хватает на очередь put выше погрузки и на ждущих take ниже подъезда
  const BRIDGE = {
    slab: [-2.9, -4.0, 6.7, 2.6], seed: 5, decorSeed: 13,
    road: -2.8,                   // левая дорога (отдающие): начало полосы по x
    takeRoad: 5.4,                // правая дорога (берущие)
    belt: { x0: -1.1, yc: -0.6 }, // хвост конвейера — у левой дороги; середина ленты по y
    zonePad: 0.3,                 // рабочая зона вокруг конвейера
    unload: 1.35,                 // выгрузка: центр погрузчика правее головы — вилы с ящиком за коробом мотора
    putStep: 1.1,                 // очередь put на левой дороге: от погрузки вверх, шаг — длина машины с зазором
    waitStep: 1.1,                // ждущие take на правой дороге: от подъезда вниз
  };

  /**
   * Снимок очереди: capacity — ёмкость; queue — задачи от головы к хвосту { id, dur }; waiting — потоки внутри take / poll
   * в порядке входа { thread, timeoutMs } (timeoutMs — только у poll); offers — недавние offer { key, thread, taskId, dur,
   * accepted } (accepted = null — ещё внутри offer, результат неизвестен); puts — недавние put, так же (accepted = null —
   * ждёт места); takes — недавние take / poll, получившие задачу { thread, taskId, dur }
   */
  const demo = {
    capacity: 4,
    queue: [{ id: 21, dur: '5.0s' }, { id: 22, dur: '5.0s' }, { id: 23, dur: '5.0s' }, { id: 24, dur: '5.0s' }],
    waiting: [],
    offers: [{ key: 'offer-1', thread: 'http-nio-8080-exec-3', taskId: 25, dur: '5.0s', accepted: false }],
    puts: [{ key: 'put-2', thread: 'putter-1', taskId: 26, dur: '5.0s', accepted: null }],
    takes: [{ thread: 'taker-1', taskId: 20, dur: '5.0s' }],
  };

  const titleOf = snap => [`LinkedBlockingQueue(${snap.capacity})`,
    `${snap.queue.length} / ${snap.capacity} · ${waitingPuts(snap).length} waiting in put · ${snap.waiting.length} waiting in take / poll`];
  const waitingPuts = snap => snap.puts.filter(p => p.accepted === null);
  const beltLines = snap => ['queue: offer → tail (left road), take ← head (right road)', `${snap.queue.length} / ${snap.capacity}`];

  // ---------- Сцена ----------

  /**
   * Неподвижная сцена: плита, две дороги вдоль y, между ними — рабочая зона с конвейером на shape.capacity мест.
   * Места: на левой дороге — north (въезд), putWait0… (очередь put), load (у хвоста), south (выезд); на правой —
   * gate (въезд и выезд погрузчиков, сверху), approach (подъезд к голове), wait0… (ждущие take / poll, ниже подъезда);
   * unload — у головы, между конвейером и правой дорогой
   */
  function layout(s, shape) {
    const L = BRIDGE, cap = shape.capacity;
    const st = Kit.street(s, { island: L.slab, seed: L.seed, axis: 'y', at: L.road, ground: 'slab', entry: 'north', exit: 'south' });
    s.title(['LinkedBlockingQueue', '…']);

    // Конвейер на рабочей зоне: хвост у левой дороги; лента всегда на LIMITS.slots мест, сверх ёмкости — закрыты у хвоста
    // (сцена одна при любой ёмкости)
    const D = 1.5, by0 = L.belt.yc - D / 2, len = O.conveyorLength(LIMITS.slots), headX = L.belt.x0 + len;
    const zone = [L.belt.x0 - L.zonePad, by0 - L.zonePad, headX + 0.45 + L.zonePad, by0 + D + L.zonePad]; // + короб мотора
    O.workZone(s, ...zone);
    const belt = O.conveyor(s, L.belt.x0, by0, LIMITS.slots, { lines: beltLines({ queue: [], capacity: cap }) }, { open: cap });
    // Счётчик — у дальнего угла зоны за мотором: у хвоста его табличка закрывала бы грузовик
    const counter = O.sign(s, zone[2] - 0.15, zone[1] - 0.25, `0 / ${cap}`, C.text);

    // Левая дорога (отдающие): погрузка у хвоста, выше — очередь put, первый пришедший — ближе к погрузке
    const y = L.belt.yc;
    st.lanePlace('load', y);
    const putLine = st.waitLine('putWait', LIMITS.putWaiting, i => y - L.putStep * (i + 1));

    // Правая дорога (берущие) — от края до края плиты; погрузчики въезжают и уезжают сверху (gate), ждут на полосе ниже
    // подъезда (первый — ближе к нему); выгрузка — у головы, между конвейером и дорогой
    const band = [L.takeRoad, L.takeRoad + 1.2], laneX = L.takeRoad + O.ROAD.lane;
    const top = L.slab[1] - 0.6 + 0.35, bottom = L.slab[3] + 0.6 - 0.35; // края плиты по y (как у Kit.street)
    O.road(s, top, bottom, { axis: 'y', v0: band[0], v1: band[1] });
    st.place('unload', [headX + L.unload, y]);
    st.place('gate', [laneX, top - 0.3]);
    st.place('approach', [laneX, y]);
    const takeLane = ['gate', 'approach'];
    for (let i = 0; i < LIMITS.waiting; i++) {
      st.place(`wait${i}`, [laneX, y + L.waitStep * (i + 1)]);
      takeLane.push(`wait${i}`);
    }
    const links = [['unload', 'approach'], ...Kit.lane(st.places, takeLane, 'y')];
    // Ждущих больше мест — «+N» над последним
    const more = s.label(laneX, y + L.waitStep * LIMITS.waiting, 0.95, ['+0'], { permanent: true });

    const cargoPlaces = Object.fromEntries(Array.from({ length: cap }, (_, i) => [`slot${i}`, belt.slotAt(i)]));

    // Растительность — не на рабочей зоне, не на правой дороге, не между головой и ней, не у погрузки
    st.keepOut(zone, [band[0] - 0.3, top - 1, band[1] + 0.3, bottom + 1], [zone[2], y - 0.5, band[0], y + 0.5],
      [L.road - 0.5, y - 1.6, L.belt.x0, y + 2.2]);

    function update(snap) {
      s.retitle(titleOf(snap));
      s.relabel(counter, [`${snap.queue.length} / ${snap.capacity}`]);
      s.relabel(belt.label, beltLines(snap));
      const extra = snap.waiting.length - LIMITS.waiting;
      if (extra > 0) s.relabel(more, [`+${extra}`]);
      s.showLabel(more, extra > 0);
      putLine.update(waitingPuts(snap).length);
    }

    // Поставленные сразу (первая расстановка, статичный показ) — как приехали бы: грузовики — вниз по левой дороге,
    // у выгрузки — вилами к ленте, ждущие на правой — к подъезду (вверх)
    const facing = { load: 'y+', unload: 'x-', gate: 'y+',
      ...Object.fromEntries(Array.from({ length: LIMITS.waiting }, (_, i) => [`wait${i}`, 'y-'])),
      ...Object.fromEntries(Array.from({ length: LIMITS.putWaiting }, (_, i) => [`putWait${i}`, 'y+'])) };
    return st.layout(L.decorSeed, { links, cargoPlaces, update, facing });
  }

  /**
   * Кто где. offer — грузовик на визит (ключ визита: один HTTP-поток может сделать несколько offer подряд): сверху
   * к погрузке; принят — дальше вниз, отклонён — разворачивается и назад наверх. put — грузовик на визит: ждёт места
   * в очереди на дороге (первые пришедшие — на местах, остальные — «+N»), положил — от погрузки вниз. take / poll —
   * погрузчик на поток: по правой дороге сверху (gate) на своё место ожидания; получил задачу — к выгрузке, оттуда
   * с ящиком наверх; poll не дождался — пропал из снимка и пустым уезжает наверх
   */
  function actorsOf(snap) {
    const actor = (key, thread, place, lines, model, entry, exit) => {
      const color = threadColor(thread);
      return { key, place, color, model, label: { lines: [Kit.THREAD_LABEL, lines], color }, entry, exit };
    };
    const shownPuts = new Map(waitingPuts(snap).slice(0, LIMITS.putWaiting).map((p, i) => [p.key, `putWait${i}`]));
    const call = w => w.timeoutMs != null ? `poll(${w.timeoutMs / 1000}s)` : 'take()';
    return [
      ...snap.offers.map(o => actor(o.key, o.thread, 'load', `offer(task #${o.taskId})`, 'car', 'north', o.accepted === false ? 'north' : 'south')),
      ...snap.puts.filter(p => p.accepted !== null || shownPuts.has(p.key)).map(p => p.accepted === null
        ? actor(p.key, p.thread, shownPuts.get(p.key), `put(task #${p.taskId}): the queue is full, waits for space`, 'car', 'north', 'south')
        : actor(p.key, p.thread, 'load', `put(task #${p.taskId})`, 'car', 'north', 'south')),
      ...snap.waiting.slice(0, LIMITS.waiting).map((w, i) => actor(w.thread, w.thread, `wait${i}`, `${call(w)}: waits for a task`, 'forklift', 'gate', 'gate')),
      ...snap.takes.map(t => actor(t.thread, t.thread, 'unload', `${t.method ?? 'take'}()`, 'forklift', 'gate', 'gate')),
    ];
  }

  /**
   * Где ящики. На ленте — по местам от головы; только что принятый — сначала на крыше грузовика offer (from),
   * ложится на хвост ленты, когда тот встал у погрузки, и доезжает по ленте до своего места. Взятый take — на вилах
   * погрузчика (с выгрузки); если его положили за микросекунды до этого — он всё равно проедет на грузовике, по ленте
   * и полежит у головы. Остальные ящики визитов offer — на крыше своего грузовика: отклонённый (уедет назад) и тот,
   * чей offer ещё не ответил
   */
  function cargoOf(snap, shape) {
    const label = (id, dur) => ({ lines: [`task #${id}`, dur] });
    // Грузовики с ящиками: offer и put — одинаково (put — тот же путь «крыша → хвост ленты», только дождавшись места)
    const givers = [...snap.offers, ...snap.puts];
    const offerOf = new Map(givers.filter(o => o.accepted !== false).map(o => [o.taskId, o])); // принят или ещё неизвестно
    const tail = `slot${shape.capacity - 1}`;
    // Путь с грузовика на ленту: на хвост (когда грузовик у погрузки), дальше — по ленте
    const onBelt = (o, place) => [{ actor: o.key }, ...(place === tail ? [] : [{ place: tail, via: 'load' }])];
    const specs = [], placed = new Set();
    snap.queue.slice(0, shape.capacity).forEach((t, i) => {
      const o = offerOf.get(t.id), place = `slot${i}`;
      placed.add(t.id);
      specs.push({ key: t.id, place, label: label(t.id, t.dur), ...(o && (place === tail ? { via: 'load', from: onBelt(o, place) } : { from: onBelt(o, place) })) });
    });
    for (const t of snap.takes) {
      const o = offerOf.get(t.taskId);
      placed.add(t.taskId);
      specs.push({ key: t.taskId, actor: t.thread, via: 'unload', label: label(t.taskId, t.dur),
        from: o ? [...onBelt(o, 'slot0'), ...(tail === 'slot0' ? [{ place: 'slot0', via: 'load' }] : [{ place: 'slot0' }])] : [] });
    }
    // Остальные — на крыше своего грузовика (отклонённый offer, ещё не ответивший, ждущий put), если грузовик на сцене
    const shown = new Set(actorsOf(snap).map(a => a.key));
    for (const o of givers) if (!placed.has(o.taskId) && shown.has(o.key)) specs.push({ key: o.taskId, actor: o.key, label: label(o.taskId, o.dur) });
    return specs;
  }

  // ---------- Снимок из плитки (index.html) ----------

  /**
   * Снимок из store blockingqueue.js: очередь и ждущие в take / poll — из состояния, offer / put / take / poll — из
   * недавних визитов. Ждущий put — визит с accepted = null (открыт на METHOD_IN, закроется, когда ляжет в очередь)
   */
  function queueSnapshot(store, queue) {
    const dur = id => KV.seconds(store.tasks.get(id)?.durationMs);
    const visits = BlockingQueueView.recentVisits(queue);
    const givers = method => visits.filter(v => v.method === method && !v.failed)
      .map(v => ({ key: `${method}-${v.id}`, thread: v.thread, taskId: v.taskId, dur: dur(v.taskId), accepted: v.accepted }));
    return {
      capacity: queue.capacity ?? LIMITS.slots,
      queue: queue.elements.map(id => ({ id, dur: dur(id) })),
      waiting: [...queue.takers].map(([thread, w]) => ({ thread, timeoutMs: w.timeoutMs ?? null })),
      offers: givers('offer'),
      puts: givers('put'),
      takes: visits.filter(v => (v.method === 'take' || v.method === 'poll') && v.accepted)
        .map(v => ({ thread: v.thread, method: v.method, taskId: v.taskId, dur: dur(v.taskId) })),
    };
  }

  // Пока очередь не создана: пустая лента на столько мест, сколько стоит в поле capacity
  const idle = capacity => ({ capacity, queue: [], waiting: [], offers: [], puts: [], takes: [] });

  /** @type {Kind} */
  const kind = {
    name: 'queue', uid: 'lbq', backdrop: 'none', // плита парит над страницей — без воды
    shapeOf(tile) {
      const queue = Tiles.itemOf(tile);
      const capacity = Math.min(queue?.capacity ?? Kit.field(tile, 'capacity', LIMITS.slots), LIMITS.slots);
      return { key: `${tile.id ?? 'idle'}:${capacity}`, capacity };
    },
    layout,
    snapshotOf(tile, shape) {
      const queue = Tiles.itemOf(tile);
      return queue ? queueSnapshot(tile.store, queue) : idle(shape.capacity);
    },
    actorsOf,
    cargoOf,
  };

  return { kind, LIMITS, demo, demoShape: { key: 'demo', capacity: demo.capacity } };
})();
