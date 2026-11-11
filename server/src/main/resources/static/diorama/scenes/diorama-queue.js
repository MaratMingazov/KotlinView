/*
 * Диорама LinkedBlockingQueue — «склад с конвейером» — описанием для набора (diorama-kit.js).
 * ящик = задача · конвейер = очередь (хвост у дороги, голова у двора) · транспорт = поток (цвет потока).
 * offer — грузовик (HTTP-поток) едет по дороге сверху с ящиком на крыше и встаёт у хвоста: принят — ящик ложится
 * на ленту, грузовик едет дальше вниз; очередь полна — разворачивается и увозит ящик назад (offer неблокирующий).
 * take — погрузчик (поток в take) выезжает из ворот склада и ждёт на своём месте во дворе (блокирующий: ждёт, пока
 * появится ящик); получил задачу — подъезжает к голове, берёт ящик на вилы и увозит в ворота склада.
 *
 * Подключение: после diorama-kit.js и diorama-street.js. На index.html нужны ещё blockingqueue.js и tiles.js (снимок).
 * Всё лежит в объекте QueueDiorama: kind — описание для Kit.panel / Kit.show, LIMITS, demo — снимок для prototype.html.
 */
const QueueDiorama = (() => {
  const { threadColor, PALETTE: C } = Iso;
  const O = IsoObjects;

  // Сколько помещается на острове: мест на ленте (ёмкость больше не даёт поле плитки) и ждущих в take; сверх — «+N»
  const LIMITS = { slots: 5, waiting: 3 };

  // Раскладка сцены (клетки мира). Дорога — вдоль y слева, конвейер — от неё вправо, двор со складом — справа
  const YARD = {
    island: [-4.6, -7.0, 12.2, 6.6], seed: 5, decorSeed: 13,
    road: { at: -2.8, ends: [-9.6, 9.2] },  // полоса дороги по x и её концы по y (за мостами)
    belt: { x0: -1.1, yc: -0.6 },            // хвост конвейера — у дороги; середина ленты по y
    zonePad: 0.3,                            // рабочая зона вокруг конвейера
    unload: 1.35,                            // выгрузка: центр погрузчика правее головы — вилы с ящиком за коробом мотора
    approach: 1.0, wait: { gap: 1.1, step: 1.25, y: 0.75 }, // подъезд к выгрузке; места ожидания — рядом ниже полосы
    paved: [-2.7, 11.2, 2.6],                // двор: y0, x1, y1; слева — вплотную к рабочей зоне
    warehouse: { x: 6.6, y: -3.9, w: 4.4, d: 1.2, h: 1.3, gate: 1 }, // склад и ворота, через которые ездят погрузчики
    racks: [[6.0, 1.8, 3], [8.5, 1.8, 3]],   // стеллажи у края двора: не на пути погрузчиков
  };

  /**
   * Снимок очереди: capacity — ёмкость; queue — задачи от головы к хвосту { id, dur }; waiting — потоки внутри take()
   * в порядке входа; offers — недавние offer { key, thread, taskId, dur, accepted } (accepted = null — ещё внутри offer,
   * результат неизвестен); takes — недавние take { thread, taskId, dur }
   */
  const demo = {
    capacity: 4,
    queue: [{ id: 21, dur: '5.0s' }, { id: 22, dur: '5.0s' }, { id: 23, dur: '5.0s' }, { id: 24, dur: '5.0s' }],
    waiting: ['taker-2'],
    offers: [{ key: 'offer-1', thread: 'http-nio-8080-exec-3', taskId: 25, dur: '5.0s', accepted: false }],
    takes: [{ thread: 'taker-1', taskId: 20, dur: '5.0s' }],
  };

  const titleOf = snap => [`LinkedBlockingQueue(${snap.capacity})`, `${snap.queue.length} / ${snap.capacity} · ${snap.waiting.length} waiting in take()`];
  const beltLines = snap => ['queue: offer → tail (at the road), take ← head (at the yard)', `${snap.queue.length} / ${snap.capacity}`];

  // ---------- Сцена ----------

  /**
   * Неподвижная сцена: остров, дорога вдоль y, рабочая зона с конвейером на shape.capacity мест, двор со складом.
   * Места: на дороге — north (въезд), load (у хвоста), south (выезд); во дворе — gate (у ворот склада), unload
   * (у головы), approach (подъезд к ней), wait0… (места ожидания take) и их выезды на полосу двора
   */
  function layout(s, shape) {
    const L = YARD, cap = shape.capacity;
    const st = Kit.street(s, { island: L.island, seed: L.seed, axis: 'y', at: L.road.at, ends: L.road.ends, entry: 'north', exit: 'south' });
    s.title(['LinkedBlockingQueue', '…']);

    // Конвейер на рабочей зоне: хвост у дороги; лента всегда на LIMITS.slots мест, сверх ёмкости — закрыты у хвоста
    // (сцена одна при любой ёмкости, двор — вплотную к зоне, погрузчики не едут по траве)
    const D = 1.5, by0 = L.belt.yc - D / 2, len = O.conveyorLength(LIMITS.slots), headX = L.belt.x0 + len;
    const zone = [L.belt.x0 - L.zonePad, by0 - L.zonePad, headX + 0.45 + L.zonePad, by0 + D + L.zonePad]; // + короб мотора
    O.workZone(s, ...zone);
    const belt = O.conveyor(s, L.belt.x0, by0, LIMITS.slots, { lines: beltLines({ queue: [], capacity: cap }) }, { open: cap });
    // Счётчик — у дальнего угла зоны за мотором: у хвоста его табличка закрывала бы грузовик
    const counter = O.sign(s, zone[2] - 0.15, zone[1] - 0.25, `0 / ${cap}`, C.text);

    // Двор: плитка, склад, стеллажи
    const yard = [zone[2], ...L.paved];
    O.paved(s, ...yard);
    const W = L.warehouse, house = O.warehouse(s, W.x, W.y, W.w, W.d, W.h);
    for (const [x, y, n] of L.racks) O.rack(s, x, y, n);

    // Дорога: погрузка — у хвоста
    st.lanePlace('load', L.belt.yc);

    // Двор: полоса вдоль головы (y = yc) — выгрузка, подъезд, выезды мест ожидания, поворот к воротам; места ожидания —
    // ниже полосы (там стоящие погрузчики не мешают едущим по ней); ворота — выше
    const y = L.belt.yc, unloadX = headX + L.unload, approachX = unloadX + L.approach;
    const [gateX, gateY] = house.gateAt(W.gate);
    st.place('unload', [unloadX, y]);
    st.place('approach', [approachX, y]);
    st.place('gateJoin', [gateX, y]);
    st.place('gate', [gateX, gateY + 0.45]);
    const yardLane = ['unload', 'approach', 'gateJoin'];
    const links = [['gate', 'gateJoin']];
    const waitX = i => approachX + L.wait.gap + i * L.wait.step;
    for (let i = 0; i < LIMITS.waiting; i++) {
      st.place(`wait${i}`, [waitX(i), L.wait.y]);
      st.place(`waitLane${i}`, [waitX(i), y]);
      yardLane.push(`waitLane${i}`);
      links.push([`waitLane${i}`, `wait${i}`]);
    }
    links.push(...Kit.lane(st.places, yardLane));
    // Ждущих больше мест — «+N» над последним
    const more = s.label(waitX(LIMITS.waiting - 1), L.wait.y, 0.95, ['+0'], { permanent: true });

    const cargoPlaces = Object.fromEntries(Array.from({ length: cap }, (_, i) => [`slot${i}`, belt.slotAt(i)]));

    // Растительность — не на рабочей зоне, не во дворе и не у дороги там, где стоит грузовик
    st.keepOut(zone, [yard[0] - 0.3, W.y - 0.3, yard[2] + 0.3, yard[3] + 0.3], [L.road.at - 0.5, y - 1.6, L.belt.x0, y + 2.2]);

    function update(snap) {
      s.retitle(titleOf(snap));
      s.relabel(counter, [`${snap.queue.length} / ${snap.capacity}`]);
      s.relabel(belt.label, beltLines(snap));
      const extra = snap.waiting.length - LIMITS.waiting;
      if (extra > 0) s.relabel(more, [`+${extra}`]);
      s.showLabel(more, extra > 0);
    }

    // Поставленные сразу (первая расстановка, статичный показ) — как приехали бы: грузовик — вниз по дороге,
    // у выгрузки — вилами к ленте, ждущие — к зрителю
    const facing = { load: 'y+', unload: 'x-', gate: 'y+', ...Object.fromEntries(Array.from({ length: LIMITS.waiting }, (_, i) => [`wait${i}`, 'y+'])) };
    return st.layout(L.decorSeed, { links, cargoPlaces, update, facing });
  }

  /**
   * Кто где. offer — грузовик на визит (ключ визита: один HTTP-поток может сделать несколько offer подряд): сверху
   * к погрузке; принят — дальше вниз, отклонён — разворачивается и назад наверх. take — погрузчик на поток: из ворот
   * склада на своё место ожидания; получил задачу — к выгрузке, оттуда с ящиком в ворота
   */
  function actorsOf(snap) {
    const actor = (key, thread, place, lines, model, entry, exit) => {
      const color = threadColor(thread);
      return { key, place, color, model, label: { lines: [Kit.THREAD_LABEL, lines], color }, entry, exit };
    };
    return [
      ...snap.offers.map(o => actor(o.key, o.thread, 'load', `offer(task #${o.taskId})`, 'car', 'north', o.accepted === false ? 'north' : 'south')),
      ...snap.waiting.slice(0, LIMITS.waiting).map((name, i) => actor(name, name, `wait${i}`, 'take(): waits for a task', 'forklift', 'gate', 'gate')),
      ...snap.takes.map(t => actor(t.thread, t.thread, 'unload', 'take()', 'forklift', 'gate', 'gate')),
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
    const offerOf = new Map(snap.offers.filter(o => o.accepted !== false).map(o => [o.taskId, o])); // принят или ещё неизвестно
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
    for (const o of snap.offers) if (!placed.has(o.taskId)) specs.push({ key: o.taskId, actor: o.key, label: label(o.taskId, o.dur) });
    return specs;
  }

  // ---------- Снимок из плитки (index.html) ----------

  /** Снимок из store blockingqueue.js: очередь и ждущие — из состояния, offer и take — из недавних визитов. */
  function queueSnapshot(store, queue) {
    const dur = id => KV.seconds(store.tasks.get(id)?.durationMs);
    const visits = BlockingQueueView.recentVisits(queue);
    return {
      capacity: queue.capacity ?? LIMITS.slots,
      queue: queue.elements.map(id => ({ id, dur: dur(id) })),
      waiting: [...queue.methods.inside.take],
      offers: visits.filter(v => v.method === 'offer' && !v.failed)
        .map(v => ({ key: `offer-${v.id}`, thread: v.thread, taskId: v.taskId, dur: dur(v.taskId), accepted: v.accepted })),
      takes: visits.filter(v => v.method === 'take' && v.accepted).map(v => ({ thread: v.thread, taskId: v.taskId, dur: dur(v.taskId) })),
    };
  }

  // Пока очередь не создана: пустая лента на столько мест, сколько стоит в поле capacity
  const idle = capacity => ({ capacity, queue: [], waiting: [], offers: [], takes: [] });

  /** @type {Kind} */
  const kind = {
    name: 'queue', uid: 'lbq',
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
