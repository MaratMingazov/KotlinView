/*
 * Диорама LinkedBlockingQueue — «конвейер» — описанием для набора (diorama-kit.js).
 * ящик = задача · конвейер = очередь (голова справа, хвост слева) · машина = поток (цвет потока).
 * offer — машина приезжает слева с ящиком на крыше: принят — ящик ложится на ленту, машина уезжает назад пустой;
 * очередь полна — разворачивается и увозит ящик назад (offer неблокирующий: не ждёт).
 * take — машина приезжает справа и ждёт у выгрузки в порядке входа в take (блокирующий: ждёт, пока появится ящик);
 * получила задачу — забирает ящик с головы ленты и уезжает назад.
 *
 * Подключение: после diorama-kit.js. На twin.html нужны ещё blockingqueue.js и tiles.js (снимок из плитки).
 * Всё лежит в объекте QueueDiorama: kind — описание для Kit.panel / Kit.show, LIMITS, demo — снимок для prototype.html.
 */
const QueueDiorama = (() => {
  const { threadColor, PALETTE: C } = Iso;
  const O = IsoObjects;

  // Сколько помещается на острове: мест на ленте (ёмкость больше не даёт поле плитки) и ждущих в take; сверх — «+N»
  const LIMITS = { slots: 5, waiting: 3 };

  // Раскладка сцены (клетки мира)
  const BELT = {
    island: [-4.4, -3.0, 14.4, 3.0], seed: 4,
    centerX: 4.4, y: -1.75,                // конвейер — за дорогой, по центру острова
    apron: { padX: 0.8, y0: -2.05 },       // площадка под конвейером: до бордюра дороги
    wait: { gap: 1.4, step: 1.2 },         // ждущие take — справа от выгрузки
    decorSeed: 5,
  };

  /**
   * Снимок очереди: capacity — ёмкость; queue — задачи от головы к хвосту { id, dur }; waiting — потоки внутри take()
   * в порядке входа; offers — недавние offer { key, thread, taskId, dur, accepted } (accepted = null — ещё внутри offer,
   * результат неизвестен); takes — недавние take { thread, taskId, dur }
   */
  const demo = {
    capacity: 4,
    queue: [{ id: 21, dur: '5.0s' }, { id: 22, dur: '5.0s' }, { id: 23, dur: '5.0s' }, { id: 24, dur: '5.0s' }],
    waiting: [],
    offers: [{ key: 'offer-1', thread: 'http-nio-8080-exec-3', taskId: 25, dur: '5.0s', accepted: false }],
    takes: [{ thread: 'taker-1', taskId: 20, dur: '5.0s' }],
  };

  const titleOf = snap => [`LinkedBlockingQueue(${snap.capacity})`, `${snap.queue.length} / ${snap.capacity} · ${snap.waiting.length} waiting in take()`];
  const beltLines = snap => ['queue: offer → tail (left), take ← head (right)', `${snap.queue.length} / ${snap.capacity}`];

  // ---------- Сцена ----------

  /** Неподвижная сцена: дорога, площадка с конвейером на shape.capacity мест; места: въезды с двух сторон, погрузка, выгрузка, ожидание. */
  function layout(s, shape) {
    const L = BELT, cap = shape.capacity;
    const st = Kit.street(s, { island: L.island, seed: L.seed, entry: 'west', exit: 'east' });
    s.title(['LinkedBlockingQueue', '…']);

    // Конвейер на площадке за дорогой; длина — по ёмкости
    const len = O.conveyorLength(cap), x0 = L.centerX - len / 2;
    O.paved(s, x0 - L.apron.padX, L.apron.y0, x0 + len + L.apron.padX, -0.14);
    const belt = O.conveyor(s, x0, L.y, cap, { lines: beltLines({ queue: [], capacity: cap }) });
    // Счётчик — левее площадки: над лентой его табличка закрывала бы хвост
    const counter = O.sign(s, x0 - L.apron.padX - 0.45, -0.45, `0 / ${cap}`, C.text);

    // Места на полосе: погрузка у хвоста, выгрузка у головы, ожидание take — правее выгрузки (сверх мест — «+N»)
    const [tailX] = belt.tail, [headX] = belt.head;
    st.lanePlace('load', tailX + 0.1);
    st.lanePlace('unload', headX - 0.1);
    const waitX = i => headX + L.wait.gap + i * L.wait.step;
    const waiting = st.waitLine('wait', LIMITS.waiting, waitX);
    const cargoPlaces = Object.fromEntries(Array.from({ length: cap }, (_, i) => [`slot${i}`, belt.slotAt(i)]));

    // Растительность — не у дороги там, где стоят машины (дерево перед машиной закрывало бы её),
    // не на площадке и не у счётчика
    st.keepOut(
      [x0 - 1.5, 1.2, waitX(LIMITS.waiting - 1) + 1, 2.6],
      [x0 - L.apron.padX - 0.3, L.apron.y0 - 0.3, x0 + len + L.apron.padX + 0.3, 0],
      [x0 - L.apron.padX - 0.8, -0.8, x0 - L.apron.padX, 0],
    );

    function update(snap) {
      s.retitle(titleOf(snap));
      s.relabel(counter, [`${snap.queue.length} / ${snap.capacity}`]);
      s.relabel(belt.label, beltLines(snap));
      waiting.update(snap.waiting.length);
    }

    return st.layout(L.decorSeed, { cargoPlaces, update });
  }

  /**
   * Кто где. offer — машина на визит (ключ визита: один HTTP-поток может сделать несколько offer подряд), с запада
   * к погрузке и назад; take — машина на поток, с востока: ждёт на своём месте, получила задачу — к выгрузке и назад
   */
  function actorsOf(snap) {
    const car = (key, thread, place, lines, entry, exit) => {
      const color = threadColor(thread);
      return { key, place, color, label: { lines: [Kit.THREAD_LABEL, lines], color }, entry, exit };
    };
    return [
      ...snap.offers.map(o => car(o.key, o.thread, 'load', `offer(task #${o.taskId})`, 'west', 'west')),
      ...snap.waiting.slice(0, LIMITS.waiting).map((name, i) => car(name, name, `wait${i}`, 'take(): waits for a task', 'east', 'east')),
      ...snap.takes.map(t => car(t.thread, t.thread, 'unload', 'take()', 'east', 'east')),
    ];
  }

  /**
   * Где ящики. На ленте — по местам от головы; только что принятый — сначала на крыше машины offer (from) и ложится
   * на ленту, когда та встала у погрузки. Взятый take — на крыше машины take (с выгрузки); если его положили за
   * микросекунды до этого — он всё равно проедет на машине offer и полежит у головы. Остальные ящики визитов offer —
   * на крыше своей машины: отклонённый (уедет назад) и тот, чей offer ещё не ответил
   */
  function cargoOf(snap, shape) {
    const label = (id, dur) => ({ lines: [`task #${id}`, dur] });
    const offerOf = new Map(snap.offers.filter(o => o.accepted !== false).map(o => [o.taskId, o])); // принят или ещё неизвестно
    const specs = [], placed = new Set();
    snap.queue.slice(0, shape.capacity).forEach((t, i) => {
      const o = offerOf.get(t.id);
      placed.add(t.id);
      specs.push({ key: t.id, place: `slot${i}`, label: label(t.id, t.dur), ...(o && { via: 'load', from: [{ actor: o.key }] }) });
    });
    for (const t of snap.takes) {
      const o = offerOf.get(t.taskId);
      placed.add(t.taskId);
      specs.push({ key: t.taskId, actor: t.thread, via: 'unload', label: label(t.taskId, t.dur),
        from: o ? [{ actor: o.key }, { place: 'slot0', via: 'load' }] : [] });
    }
    for (const o of snap.offers) if (!placed.has(o.taskId)) specs.push({ key: o.taskId, actor: o.key, label: label(o.taskId, o.dur) });
    return specs;
  }

  // ---------- Снимок из плитки (twin.html) ----------

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
