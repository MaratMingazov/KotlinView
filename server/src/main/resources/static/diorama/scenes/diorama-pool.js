/*
 * Диорама FixedThreadPool — «мастерская у конвейера» — описанием для набора (diorama-kit.js). Договорённости —
 * docs/DIORAMAS.md, «Пул (FixedThreadPool): два вида потоков» (выбрали 2026-11-13 из трёх проб).
 * грузовик = вызывающий поток (execute → offer: кладёт ящик на хвост и уезжает) · ящик = задача ·
 * конвейер = workQueue (LinkedBlockingQueue, та же лента, что у сцены очереди) · погрузчик = воркер пула (цвет потока,
 * живёт в пуле) · верстак = место воркера: run() — ящик на верстаке, табло — прогресс · гараж = ThreadFactory.
 * Свободный воркер ждёт в take() у своего верстака; получил задачу — едет к голове, берёт ящик и везёт к верстаку.
 * firstTask — новый погрузчик выезжает из гаража и берёт ящик у грузовика из рук в руки, мимо ленты.
 *
 * execute — грузовик появляется, когда известен итог (execute не блокируется: итог — через микросекунды; визиты —
 * Pool.recentVisits): queued — подъезжает к хвосту, ящик ложится на ленту, уезжает вниз; rejected — постоял у хвоста
 * и разворачивается наверх с ящиком; firstTask — встаёт у гаража, новый погрузчик выезжает к нему, берёт ящик
 * из рук в руки и везёт к своему верстаку.
 * shutdown — новые execute получают отказ (грузовик разворачивается), лента дорабатывается, свободные воркеры прерываются
 * в take() и уезжают в гараж (поток закончился — пропал из снимка). shutdownNow — ещё и ящики с ленты соскальзывают
 * на коврик перед ней: drainTo вернул их вызывающему списком (Pool.recentDrain); выполняемые задачи прерываются.
 *
 * Подключение: после diorama-kit.js, diorama-street.js и iso-port.js (гараж — ангар порта). На index.html нужны ещё
 * pool.js и tiles.js (снимок из плитки). Всё лежит в объекте PoolDiorama: kind — описание для Kit.panel / Kit.show,
 * LIMITS, demo — снимок для миниатюры и prototype.html.
 */
const PoolDiorama = (() => {
  const { threadColor, PALETTE: C } = Iso;
  const O = IsoObjects;
  const percent = fraction => `${Math.round(fraction * 100)}%`;

  // Сколько помещается: мест на ленте (очередь пресета сервера — 5) и верстаков (nThreads на index.html — не больше)
  const LIMITS = { slots: 5, bays: 3 };

  // Раскладка (клетки мира). Дорога вызывающих — вдоль y слева; конвейер — вдоль x, хвост у дороги, голова у двора;
  // справа двор воркеров с верстаками; сзади гараж и проезд от него во двор
  const SHOP = {
    island: [-2.9, -4.2, 8.8, 2.6], seed: 5, decorSeed: 17,
    road: -2.8,                              // дорога вызывающих: начало полосы по x
    belt: { x0: -1.1, yc: -0.6 }, zonePad: 0.3,
    yard: [4.6, -3.6, 9.0, 2.6],             // двор воркеров (асфальт)
    path: [-0.9, -2.75, 4.6, -1.95],         // проезд от гаража во двор
    garage: [-0.9, -4.5, 2.6, 1.4, 1.2],     // x, y, w, d, h; ворота — на грани +y
    unload: 1.35,                            // погрузчик у головы: правее неё, вилами к ленте
    laneX: 5.0,                              // проезд по двору вдоль y — через место у головы
    benchX: 7.3, parkX: 6.55,                // верстак и погрузчик перед ним (вилами к верстаку)
    benchYs: [-2.8, -0.6, 1.6],              // середины верстаков по y: первый — дальний
    handY: -2.35, meetX: -1.0,               // firstTask: грузовик на дороге и погрузчик на проезде у гаража
    returned: { y0: 0.75, y1: 1.45 },        // коврик перед лентой: сюда соскальзывают ящики, снятые shutdownNow
  };

  const crateLabel = (id, dur) => ({ lines: [`task #${id}`, dur ?? ''] });
  const workerLine = w => w.run ? `run(task #${w.task.id}) · ${percent(w.progress)}` : w.task ? `took task #${w.task.id} from the head` : 'take(): waits for a task';

  /**
   * Снимок пула: capacity — ёмкость очереди, queue — задачи от головы { id, dur }; workers — по верстаку на место
   * до maximumPoolSize: { name, task: { id, dur } | null, progress, run, taking } (name = null — потока ещё нет;
   * run — внутри run(); taking — недавно взял задачу из головы (take): едет за ящиком к голове и везёт его к верстаку);
   * first — ключ грузовика, у которого он берёт ящик firstTask; pending — поток только что создан внутри execute,
   * итог ещё неизвестен: ждёт у ворот гаража, ящика пока нет);
   * visits — недавние execute с известным итогом { id, thread, taskId, dur, outcome: 'queued' | 'rejected' | 'firstTask' }
   */
  const demo = {
    title: ['ThreadPoolExecutor', 'newFixedThreadPool(3) · queue 5'],
    capacity: 5,
    queue: [{ id: 21, dur: '5.0s' }, { id: 22, dur: '5.0s' }, { id: 23, dur: '5.0s' }],
    workers: [
      { name: 'pool-1-thread-1', task: { id: 18, dur: '5.0s' }, progress: 0.7, run: true },
      { name: 'pool-1-thread-2', task: { id: 19, dur: '5.0s' }, progress: 0.3, run: true },
      { name: 'pool-1-thread-3', task: { id: 20, dur: '5.0s' }, progress: 0, run: false, taking: true },
    ],
    visits: [{ id: 1, thread: 'http-nio-8080-exec-4', taskId: 24, dur: '5.0s', outcome: 'queued' }],
  };

  // ---------- Сцена ----------

  /**
   * Неподвижная сцена: плита, дорога вызывающих, конвейер на рабочей зоне, двор с shape.bays верстаками, гараж.
   * Места: на дороге — north (въезд), hand (firstTask), load (у хвоста), south (выезд); погрузчики — gate (ворота
   * гаража, въезд и выезд), meet (берёт ящик у грузовика), yardIn (вход во двор), unload (у головы), park0… (у верстаков)
   */
  function layout(s, shape) {
    const L = SHOP;
    const st = Kit.street(s, { island: L.island, seed: L.seed, axis: 'y', at: L.road, ground: 'slab', entry: 'north', exit: 'south' });
    s.title(['ThreadPoolExecutor', '…']);

    // Очередь: лента всегда на LIMITS.slots мест, сверх ёмкости — закрыты у хвоста
    const D = 1.5, by0 = L.belt.yc - D / 2, headX = L.belt.x0 + O.conveyorLength(LIMITS.slots);
    const zone = [L.belt.x0 - L.zonePad, by0 - L.zonePad, headX + 0.45 + L.zonePad, by0 + D + L.zonePad];
    O.workZone(s, ...zone);
    const beltLines = snap => ['workQueue: LinkedBlockingQueue', `${snap.queue.length} / ${snap.capacity} · execute → offer → tail · take() ← head`];
    const belt = O.conveyor(s, L.belt.x0, by0, LIMITS.slots, { lines: beltLines({ queue: [], capacity: shape.capacity }) }, { open: shape.capacity });
    const counter = O.sign(s, zone[2] - 0.15, zone[1] - 0.25, `0 / ${shape.capacity}`, C.text);

    // Коврик «возвращено» перед лентой: shutdownNow снимает ящики (drainTo) и возвращает их вызывающему списком —
    // ящики соскальзывают сюда со своих мест, табличка показывает список, пока его помнит store (Pool.recentDrain).
    // Виден только тогда: в остальное время пустой коврик — лишний элемент
    const R = L.returned, rx0 = L.belt.x0, rx1 = headX, rlines = ['shutdownNow()', 'drained from the queue: returned, never started'];
    const ret = s.label((rx0 + rx1) / 2, (R.y0 + R.y1) / 2, 0.7, rlines, { permanent: true });
    const mat = s.flat(rx0, R.y0, rx1 - rx0, R.y1 - R.y0, '#d9cdb5');
    s.ground.push(s.hover(mat, s.label((rx0 + rx1) / 2, (R.y0 + R.y1) / 2, 0.3, rlines, {})));
    const retPlaces = Array.from({ length: LIMITS.slots }, (_, i) => [`ret${i}`, [belt.slotAt(i)[0], (R.y0 + R.y1) / 2, 0.001]]);
    let retShown = 'init';

    // Двор воркеров, проезд и гараж
    O.asphalt(s, ...L.yard);
    O.asphalt(s, ...L.path);
    const { gateAt } = O.hangar(s, ...L.garage, 'y', { lines: ['ThreadFactory', 'newThread: a new forklift rolls out'] });

    // Верстаки — по одному на место воркера; табло пустое, пока воркер не внутри run()
    const benches = L.benchYs.slice(0, shape.bays).map(y => {
      const l = s.label(L.benchX + 0.4, y, 1.2, ['worker place', 'free: no thread yet'], {});
      return { l, bench: O.workbench(s, L.benchX, y - O.BENCH.D / 2, l), shown: null };
    });

    const cargoPlaces = {
      ...Object.fromEntries(Array.from({ length: shape.capacity }, (_, i) => [`slot${i}`, belt.slotAt(i)])),
      ...Object.fromEntries(benches.map((b, i) => [`bench${i}`, b.bench.top])),
      ...Object.fromEntries(retPlaces),
    };

    // Места: дорога — по цепочке сама; погрузчики — гараж ↔ проезд ↔ двор (вдоль laneX) ↔ верстаки
    st.lanePlace('hand', L.handY);
    st.lanePlace('load', L.belt.yc);
    const pathY = (L.path[1] + L.path[3]) / 2;
    st.place('gate', [gateAt[0], pathY]);
    st.place('meet', [L.meetX, pathY]);
    st.place('yardIn', [L.laneX, pathY]);
    st.place('unload', [headX + L.unload, L.belt.yc]);
    st.place('yardOut', [L.laneX, L.benchYs[2]]);
    const links = [['meet', 'gate'], ['gate', 'yardIn'], ['yardIn', 'unload'], ['unload', 'yardOut']];
    const laneAt = ['yardIn', 'unload', 'yardOut']; // откуда съезд к верстаку i
    benches.forEach((_, i) => {
      st.place(`park${i}`, [L.parkX, L.benchYs[i]]);
      links.push([laneAt[i], `park${i}`]);
    });

    st.keepOut(zone, L.yard, L.path, [rx0 - 0.2, R.y0 - 0.2, rx1 + 0.2, R.y1 + 0.3], [L.garage[0] - 0.3, L.garage[1], L.garage[0] + L.garage[2] + 0.3, L.path[3]],
      [L.road - 0.5, L.handY - 0.8, L.belt.x0, L.belt.yc + 1.2]);

    // Обновить на месте: шапка, счётчики, табло и таблички верстаков (табло — шагом 2%)
    function update(snap) {
      s.retitle(snap.title);
      s.relabel(counter, [`${snap.queue.length} / ${snap.capacity}`]);
      s.relabel(belt.label, beltLines(snap));
      const drained = snap.drain?.taskIds.map(id => `#${id}`).join(', ') ?? null;
      if (drained !== retShown) {
        retShown = drained;
        if (drained != null) s.relabel(ret, ['shutdownNow()', drained ? `returned ${drained} — never started` : 'the queue was empty: nothing returned']);
        s.showLabel(ret, drained != null);
        mat.style.display = drained != null ? '' : 'none';
      }
      const freeLine = snap.runState && snap.runState !== 'RUNNING' ? 'no thread: the pool is shut down' : 'free: no thread yet';
      snap.workers.slice(0, benches.length).forEach((w, i) => {
        const b = benches[i], color = w.name ? threadColor(w.name) : null;
        const working = w.run && !w.taking && !w.first && !w.pending; // пока везёт ящик к верстаку, табло ещё пустое
        const key = `${w.name}|${working ? Math.round(w.progress * 50) : '-'}|${freeLine}`;
        if (b.shown === key) return;
        b.shown = key;
        b.bench.set(working ? w.progress : null, color);
        s.relabel(b.l, w.name ? [Kit.THREAD_LABEL, workerLine(w)] : ['worker place', freeLine],
          { color, bar: w.run ? { fraction: w.progress, color } : undefined });
      });
    }

    // Поставленные сразу: грузовик — вниз по дороге, у головы — вилами к ленте, у верстака — вилами к верстаку
    const facing = { load: 'y+', hand: 'y+', meet: 'x-', unload: 'x-', gate: 'x', ...Object.fromEntries(benches.map((_, i) => [`park${i}`, 'x'])) };
    return st.layout(L.decorSeed, { links, cargoPlaces, update, facing });
  }

  // ---------- Кто где ----------

  const truckKey = v => `caller-${v.id}`;
  const TRUCK = {
    queued: { place: 'load', exit: 'south', line: v => `execute(task #${v.taskId}) → offer → the queue` },
    rejected: { place: 'load', exit: 'north', line: v => `execute(task #${v.taskId}) ✗ rejected — turns back` },
    firstTask: { place: 'hand', exit: 'south', line: v => `execute(task #${v.taskId}) → firstTask: hands it to a new worker` },
  };

  /**
   * Кто где. Воркер — у своего верстака (ждёт в take() или выполняет run); взял задачу из головы — у головы;
   * firstTask — у места передачи перед гаражом; только что создан (итог execute неизвестен) — у ворот гаража.
   * Грузовик — на визит execute: к хвосту (queued, rejected) или к гаражу (firstTask); уезжает вниз, отказ — наверх
   */
  function actorsOf(snap, shape) {
    const specs = [];
    snap.workers.slice(0, shape.bays).forEach((w, i) => {
      if (!w.name) return;
      const color = threadColor(w.name);
      const place = w.pending ? 'gate' : w.first ? 'meet' : w.taking ? 'unload' : `park${i}`;
      specs.push({ key: w.name, place, model: 'forklift', color, entry: 'gate', exit: 'gate',
        label: { lines: [Kit.THREAD_LABEL, `pool worker · ${workerLine(w)}`], color } });
    });
    for (const v of snap.visits ?? []) {
      const color = threadColor(v.thread), T = TRUCK[v.outcome];
      specs.push({ key: truckKey(v), place: T.place, exit: T.exit, color, label: { lines: [Kit.THREAD_LABEL, T.line(v)], color } });
    }
    return specs;
  }

  /**
   * Ящики. На ленте — по местам от головы; только что принятый (queued) — сначала на крыше грузовика, ложится на хвост,
   * когда тот встал у хвоста, и доезжает по ленте до своего места. Воркер взял задачу (taking) — ящик с головы ложится
   * ему на вилы, когда он встал у головы (набор держит погрузчик там, пока ящик не лёг); если ящик взяли сразу после
   * offer — он всё равно проедет крышу, ленту и голову. firstTask — из рук в руки: с крыши грузовика у гаража на вилы
   * погрузчика у места передачи (стоят оба). В run() — на верстаке, когда погрузчик встал у него. Остальные ящики
   * визитов (отказ) — на крыше своего грузовика
   */
  function cargoOf(snap, shape) {
    const tail = `slot${snap.capacity - 1}`;
    const queuedOf = new Map((snap.visits ?? []).filter(v => v.outcome === 'queued').map(v => [v.taskId, v]));
    // Путь с крыши грузовика на ленту: на хвост (когда грузовик у хвоста), дальше — по ленте до места place
    const onBelt = (v, place) => [{ actor: truckKey(v) }, ...(place === tail ? [] : [{ place: tail, via: 'load' }])];
    const specs = [], placed = new Set();
    snap.queue.slice(0, shape.capacity).forEach((t, i) => {
      const v = queuedOf.get(t.id), place = `slot${i}`;
      placed.add(t.id);
      specs.push({ key: t.id, place, label: crateLabel(t.id, t.dur), ...(v && { from: onBelt(v, place), ...(place === tail && { via: 'load' }) }) });
    });
    snap.workers.slice(0, shape.bays).forEach((w, i) => {
      if (!w.task || w.pending) return;
      const label = crateLabel(w.task.id, w.task.dur), v = queuedOf.get(w.task.id);
      placed.add(w.task.id);
      if (w.first) specs.push({ key: w.task.id, actor: w.name, via: 'meet', viaFrom: 'hand', from: [{ actor: w.first }], label });
      else if (w.taking) specs.push({ key: w.task.id, actor: w.name, via: 'unload', label,
        from: [...(v ? onBelt(v, 'slot0') : []), { place: 'slot0', ...(v && tail === 'slot0' && { via: 'load' }) }] });
      else specs.push({ key: w.task.id, place: `bench${i}`, via: `park${i}`, label });
    });
    // shutdownNow: снятые с ленты — на коврике перед своим местом (k — место в очереди, голова первая)
    (snap.drain?.taskIds ?? []).slice(0, LIMITS.slots).forEach((id, k) => {
      if (placed.has(id)) return;
      placed.add(id);
      specs.push({ key: id, place: `ret${k}`, label: crateLabel(id, snap.dur?.(id)) });
    });
    for (const v of snap.visits ?? []) {
      if (!placed.has(v.taskId) && v.outcome !== 'firstTask') specs.push({ key: v.taskId, actor: truckKey(v), label: crateLabel(v.taskId, v.dur) });
    }
    return specs;
  }

  // ---------- Снимок из плитки (index.html) ----------

  // Когда снимок впервые увидел поток: пул → (имя потока → performance.now()). Снимок берётся на каждое событие,
  // поэтому это почти момент создания: поток, появившийся внутри открытого execute, — тот, кому достанется firstTask
  const seenByPool = new Map();
  function firstSeen(poolId, names) {
    if (!seenByPool.has(poolId)) seenByPool.set(poolId, new Map());
    const seen = seenByPool.get(poolId), now = performance.now();
    for (const name of seen.keys()) if (!names.includes(name)) seen.delete(name);
    for (const name of names) if (!seen.has(name)) seen.set(name, now);
    return seen;
  }

  /**
   * Снимок из store pool.js. Верстаки — по одному на место до maximumPoolSize: сначала живые потоки фабрики пула
   * (в порядке создания), потом свободные места. Воркер занят, если внутри run() какой-то задачи есть его поток.
   * Грузовики — визиты execute с известным итогом (Pool.recentVisits)
   */
  function poolSnapshot(store, pool) {
    const s = pool.state;
    const queue = store.queueById(s.queueId);
    const dur = id => KV.seconds(store.tasks.get(id)?.durationMs);
    const threads = [...store.threads.values()].filter(t => t.factoryId === s.threadFactoryId && (t.phase === 'NEW' || t.phase === 'RUN'));
    const runOf = name => {
      for (const task of store.tasks.values()) {
        const run = task.runs.get(name);
        if (run?.phase === 'RUN') return { task, run };
      }
      return null;
    };
    const recent = Pool.recentVisits(pool);
    // Итог визита: конец execute — или раньше, если offer вызывающего внутри execute уже положил задачу в очередь
    // (v.queued): в том же событии задача появляется на ленте, и без грузовика ящик возник бы сразу там
    const visits = recent.map(v => ({ v, outcome: v.outcome ?? (v.queued === 'queued' ? 'queued' : null) }))
      .filter(x => x.outcome)
      .map(({ v, outcome }) => ({ id: v.id, thread: v.thread, taskId: v.taskId, dur: dur(v.taskId), outcome, worker: v.worker ?? null }));
    // Внутри execute (итог ещё неизвестен) пул мог создать поток: он появился после начала этого execute
    const seen = firstSeen(pool.id, threads.map(t => t.name));
    const open = recent.filter(v => v.outcome === null);
    const isPending = name => open.some(v => seen.get(name) >= v.at);
    // Воркер взял задачу из головы недавно (take) — едет за ящиком; между take и run() — микросекунды, поэтому
    // «взял» держится Pool.recentTake, а не только до начала run. firstTask — пока помнится визит, отдавший ему задачу
    const workers = threads.map(t => {
      const busy = runOf(t.name), take = Pool.recentTake(queue, t.name);
      const firstVisit = visits.find(v => v.outcome === 'firstTask' && v.worker === t.name);
      const first = firstVisit ? truckKey(firstVisit) : null;
      if (busy) {
        return { name: t.name, task: { id: busy.task.id, dur: dur(busy.task.id) }, progress: Kit.progress(busy.run, busy.task.durationMs),
          run: true, taking: !first && take?.taskId === busy.task.id, first, pending: !first && !take && isPending(t.name) };
      }
      if (take && !store.tasks.get(take.taskId)?.runs.get(t.name)) {
        return { name: t.name, task: { id: take.taskId, dur: dur(take.taskId) }, progress: 0, run: false, taking: true };
      }
      return { name: t.name, task: null, progress: 0, run: false, pending: isPending(t.name) };
    });
    for (let i = workers.length; i < s.maximumPoolSize; i++) workers.push({ name: null, task: null, progress: 0, run: false });
    const capacity = queue?.capacity ?? Pool.PRESET_QUEUE_CAPACITY;
    return {
      title: ['ThreadPoolExecutor', `${Pool.presetOf(s, capacity) ?? `core ${s.corePoolSize} / max ${s.maximumPoolSize}`} · ${s.runState}`],
      capacity,
      queue: (queue?.elements ?? []).map(id => ({ id, dur: dur(id) })),
      workers,
      visits,
      drain: Pool.recentDrain(pool),
      runState: s.runState,
      dur,
    };
  }

  // Пока пул не создан: пустая мастерская на столько верстаков, сколько стоит в поле nThreads
  const idle = bays => ({
    title: ['ThreadPoolExecutor', 'not started — press ▶ start on the left'],
    capacity: LIMITS.slots, queue: [], visits: [],
    workers: Array.from({ length: bays }, () => ({ name: null, task: null, progress: 0, run: false })),
  });

  /** @type {Kind} */
  const kind = {
    name: 'pool', uid: 'pool', backdrop: 'none', // плита парит над страницей — без воды
    shapeOf(tile) {
      const pool = tile && Tiles.itemOf(tile);
      const bays = pool?.state ? Math.min(pool.state.maximumPoolSize, LIMITS.bays) : Kit.field(tile, 'nThreads', LIMITS.bays);
      return { key: `${tile.id ?? 'idle'}:${bays}`, bays, capacity: LIMITS.slots };
    },
    layout,
    snapshotOf(tile, shape) {
      const pool = Tiles.itemOf(tile);
      return pool?.state ? poolSnapshot(tile.store, pool) : idle(shape.bays);
    },
    actorsOf,
    cargoOf,
  };

  return { kind, LIMITS, demo, demoShape: { key: 'demo', bays: demo.workers.length, capacity: demo.capacity } };
})();
