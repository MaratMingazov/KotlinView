/*
 * Диорама CachedThreadPool — «грузовой порт с пирсом» — описанием для набора (diorama-kit.js). Договорённости —
 * docs/DIORAMAS.md, раздел «CachedThreadPool: порт».
 * баржа = вызывающий поток (execute) · контейнер = задача · портальный кран = воркер (цвет потока) ·
 * ангар = ThreadFactory (newThread выкатывает кран) · площадки для контейнеров у пирса нет — SynchronousQueue.
 *
 * execute — баржа появляется, когда известно, куда ей (execute не блокируется: итог — через микросекунды). Задачу
 * взял ждущий в poll кран или пул выкатил новый (firstTask) — баржа заходит по полосе воды перед пирсом со своей
 * стороны (у каждого причала своя: крану у конца пирса — слева, у берега — справа; пути барж разных кранов не
 * пересекаются), швартуется, кран снимает контейнер прямо с борта, баржа уходит назад той же стороной. Отказ (оба
 * крана заняты, пул — не больше 2 потоков) — баржа заходит слева, доходит до середины полосы и разворачивается
 * с контейнером. run() — кран стоит на своём месте, тележка везёт контейнер по балке от баржи к его площадке
 * (жёлто-чёрная диагональ); run закончился — контейнер стоит на площадке, пока тает запуск задачи. Кран ждёт
 * в poll(keepAlive) — над ним табличка с убывающей полоской; не дождался — поток умер, кран уезжает в ангар.
 *
 * Подключение: после diorama-kit.js и iso-port.js. На index.html нужны ещё pool.js и tiles.js (снимок).
 * Всё лежит в объекте CachedDiorama: kind — описание для Kit.panel / Kit.show, LIMITS, demo.
 */
const CachedDiorama = (() => {
  const { threadColor } = Iso;
  const O = IsoObjects;

  // Кранов на пирсе — столько же, сколько потоков у пула на index.html (Pool.cachedOf); барж на сцене — не больше
  const LIMITS = { cranes: 2, barges: 2 };

  // Раскладка (клетки мира). Пирс вдоль y по центру x = 4.5; места кранов — дальнее (0) и ближнее к берегу (1):
  // дальнее занимается первым, чтобы второй кран не проезжал сквозь первый. Причал крана — слева или справа от пирса
  const PORT = {
    slab: [-1.2, -4.6, 10.2, 5.6], water: [-1.0, -0.9, 10.0, 5.4],
    pier: { x0: 3.0, x1: 6.0, y1: 3.4 }, shoreY: -0.9, pierX: 4.5,
    hangar: [3.0, -4.5, 3.0, 1.6, 1.4],
    spots: [{ y: 2.3, berthX: 1.9 }, { y: 0.75, berthX: 7.1 }],
    strip: { y: 4.4, leftX: 0.9, mouthX: 4.5, rightX: 8.1 }, // полоса воды перед пирсом: края — вход и выход барж
    decorSeed: 43,
  };
  const CRANE = { legs: [-1, 1], span: [-2.9, 2.9], hookZ: 0.85 }; // от центра пирса
  // Тележка во время run: над баржей — первые HOLD доли (время на передачу контейнера), к площадке — за MOVE
  const RUN = { hold: 0.3, move: 0.65, backMs: 600 };

  const berthU = i => PORT.spots[i].berthX - PORT.pierX; // смещение тележки над баржей у причала места i
  const craneKey = name => `crane-${name}`;
  const bargeKey = v => `barge-${v.id}`;

  // ---------- Сцена ----------

  /** Неподвижный порт: плита, вода, берег, пирс с рельсами, ангар, площадки под грузом; места барж и кранов. */
  function layout(s) {
    const P = PORT, { x0, x1, y1 } = P.pier, [rl, rr] = CRANE.legs.map(d => P.pierX + d);
    O.slab(s, ...P.slab);
    O.water(s, ...P.water, 0.45);
    O.quay(s, P.slab[0], P.slab[1], P.slab[2], P.shoreY);
    O.quay(s, x0, P.shoreY, x1, y1);
    O.copingX(s, P.slab[0], x0, P.shoreY); O.copingX(s, x1, P.slab[2], P.shoreY);
    O.copingY(s, P.shoreY, y1, x0); O.copingY(s, P.shoreY, y1, x1); O.copingX(s, x0, x1, y1);
    for (const at of [rl, rr]) O.rail(s, 'y', P.hangar[1] + 0.5, y1 - 0.2, at);
    const { gateAt } = O.hangar(s, ...P.hangar, 'y', { lines: ['ThreadFactory', 'newThread rolls out a crane'] });
    const cargoPlaces = Object.fromEntries(P.spots.map((sp, i) => [`slot${i}`, O.hazardSlot(s, P.pierX, sp.y)]));
    s.title(['ThreadPoolExecutor', '…']);

    // Места кранов: ворота ангара → берег → ближнее место → дальнее
    const places = {
      gate: [gateAt[0], gateAt[1] - 0.4], shore: [P.pierX, P.shoreY - 0.7],
      ...Object.fromEntries(P.spots.map((sp, i) => [`spot${i}`, [P.pierX, sp.y]])),
    };
    const links = [['gate', 'shore'], ['shore', 'spot1'], ['spot1', 'spot0']];
    // Места барж: у каждого причала своя сторона полосы перед пирсом — inL → cornerL → berth0 и inR → cornerR → berth1;
    // mouth — середина полосы (туда доходит баржа с отказом), со стороны inL
    const { y, leftX, mouthX, rightX } = P.strip;
    Object.assign(places, {
      inL: [leftX, y], cornerL: [P.spots[0].berthX, y], mouth: [mouthX, y], cornerR: [P.spots[1].berthX, y], inR: [rightX, y],
      berth0: [P.spots[0].berthX, P.spots[0].y], berth1: [P.spots[1].berthX, P.spots[1].y],
    });
    links.push(['inL', 'cornerL'], ['cornerL', 'mouth'], ['cornerL', 'berth0'], ['inR', 'cornerR'], ['cornerR', 'berth1']);

    // keepAlive: табличка над краном, пока он ждёт в poll — полоска убывает (кадром, а не событием)
    const keep = P.spots.map((sp, i) => {
      const l = s.label(P.pierX + 1.3, sp.y + 0.45, 2.3, ['keepAlive'], { bar: { fraction: 1, color: '#999' }, permanent: true });
      return { l, poll: null, color: null, shown: 'init', i }; // спрятать — на первом кадре (узла таблички до render ещё нет)
    });

    O.decorate(s, P.decorSeed, [[P.water[0] - 0.2, P.shoreY - 0.05, P.slab[2], P.slab[3]], [x0 - 0.2, P.slab[1], x1 + 0.2, y1 + 0.1]]);

    function update(snap) {
      s.retitle(snap.title);
      for (const k of keep) {
        const w = snap.workers.find(w => w.spot === k.i);
        k.poll = w && !w.run ? w.poll : null;
        k.color = w ? threadColor(w.name) : null;
      }
    }

    // Полоска keepAlive — шагом 2%; true — кто-то ждёт: кадры нужны дальше
    function frame(now) {
      let busy = false;
      for (const k of keep) {
        const left = k.poll ? Math.max(0, 1 - (now - k.poll.start) / k.poll.timeoutMs) : null;
        const step = left == null ? null : Math.round(left * 50);
        if (step !== k.shown) {
          k.shown = step;
          if (left != null) s.relabel(k.l, [`keepAlive ${Math.ceil(left * k.poll.timeoutMs / 1000)}s`], { color: k.color, bar: { fraction: left, color: k.color } });
          s.showLabel(k.l, left != null);
        }
        busy ||= left != null && left > 0;
      }
      return busy;
    }

    const facing = { berth0: 'y-', berth1: 'y-', inR: 'x-', cornerR: 'x-' };
    return { places, links, entry: 'inL', exit: 'inL', cargoPlaces, facing, update, frame };
  }

  // ---------- Кто где ----------

  // Тележка крана: run — от баржи к площадке по времени запуска (в демо — по progress); ждёт — над своим причалом
  function poseOf(w) {
    const from = berthU(w.spot);
    if (!w.run) return { to: from, ms: RUN.backMs };
    if (w.run.progress != null) {
      const k = Math.min(Math.max((w.run.progress - RUN.hold) / RUN.move, 0), 1);
      return { u: from * (1 - k) };
    }
    const d = w.run.durationMs ?? 0;
    return { from, to: 0, start: w.run.startedAt + d * RUN.hold, ms: Math.max(d * RUN.move, 1) };
  }

  // Причал баржи: у крана, который взял её задачу (по запуску задачи или по визиту); null — ещё не знаем
  function bargeSpot(snap, v) {
    const byRun = snap.workers.find(w => w.run?.taskId === v.taskId || w.done.includes(v.taskId));
    return byRun?.spot ?? snap.workers.find(w => w.name === v.worker)?.spot ?? null;
  }

  function actorsOf(snap) {
    const label = (thread, line) => ({ lines: [Kit.THREAD_LABEL, line], color: threadColor(thread) });
    const out = snap.workers.map(w => ({
      key: craneKey(w.name), place: `spot${w.spot}`, model: 'crane', color: threadColor(w.name),
      look: { axis: 'x', ...CRANE }, pose: poseOf(w), entry: 'gate', exit: 'gate',
      label: label(w.name, 'gantry crane = pool worker'),
    }));
    for (const v of snap.barges) {
      const spot = bargeSpot(snap, v), rejected = v.outcome === 'rejected';
      if (!rejected && spot == null) continue; // ещё не знаем, куда ей: появится через мгновение — сразу со своей стороны
      const side = rejected ? 'inL' : spot === 0 ? 'inL' : 'inR';
      out.push({ key: bargeKey(v), place: rejected ? 'mouth' : `berth${spot}`, model: 'barge', color: threadColor(v.thread),
        entry: side, exit: side,
        label: label(v.thread, rejected ? `execute(task #${v.taskId}) ✗ rejected — turns back` : `execute(task #${v.taskId})`) });
    }
    return out;
  }

  /**
   * Контейнеры. Задачу выполняет кран — контейнер на нём; передача «баржа → кран», когда оба на местах: кран на своём
   * месте, баржа у его причала (viaFrom). run закончился, запуск ещё тает — контейнер на площадке крана. Иначе —
   * на барже (ещё не отдали или отказ: увозит с собой)
   */
  function cargoOf(snap) {
    const specs = [], placed = new Set();
    const spec = (id, rest) => ({ key: id, model: 'container', color: O.carColor(id), axis: 'y', label: { lines: [`task #${id}`, snap.dur?.(id) ?? ''] }, ...rest });
    const bargeOf = id => snap.barges.find(v => v.taskId === id);
    for (const w of snap.workers) {
      for (const id of w.done) { placed.add(id); specs.push(spec(id, { place: `slot${w.spot}` })); }
      if (!w.run) continue;
      const id = w.run.taskId, b = bargeOf(id);
      placed.add(id);
      specs.push(spec(id, { actor: craneKey(w.name), via: `spot${w.spot}`, viaFrom: `berth${w.spot}`, from: b ? [{ actor: bargeKey(b) }] : [] }));
    }
    // На барже — только если баржа уже на сцене (у неё есть куда плыть)
    for (const v of snap.barges) {
      if (v.taskId == null || placed.has(v.taskId) || (v.outcome !== 'rejected' && bargeSpot(snap, v) == null)) continue;
      specs.push(spec(v.taskId, { actor: bargeKey(v) }));
    }
    return specs;
  }

  // ---------- Снимок из плитки (index.html) ----------

  // Места кранов закреплены за потоками: пул → (имя потока → место). Набор места не выбирает — баржа должна знать причал
  const spotsByPool = new Map();
  function spotsOf(poolId, names) {
    if (!spotsByPool.has(poolId)) spotsByPool.set(poolId, new Map());
    const spots = spotsByPool.get(poolId);
    for (const name of spots.keys()) if (!names.includes(name)) spots.delete(name);
    for (const name of names) {
      if (spots.has(name)) continue;
      const taken = new Set(spots.values());
      const free = PORT.spots.findIndex((_, i) => !taken.has(i));
      if (free >= 0) spots.set(name, free);
    }
    return spots;
  }

  /**
   * Снимок из store pool.js: краны — живые потоки фабрики пула (с закреплённым местом), у каждого — запуск задачи
   * (run: { taskId, startedAt, durationMs }), только что выполненные (done — запуск ещё тает), poll — ждёт задачу;
   * баржи — недавние execute (Pool.recentVisits) с итогом и воркером
   */
  function cachedSnapshot(store, pool) {
    const s = pool.state;
    const alive = [...store.threads.values()].filter(t => t.factoryId === s.threadFactoryId && (t.phase === 'NEW' || t.phase === 'RUN'));
    const spots = spotsOf(pool.id, alive.map(t => t.name));
    const workers = alive.filter(t => spots.has(t.name)).map(t => {
      let run = null;
      const done = [];
      for (const task of store.tasks.values()) {
        const r = task.runs.get(t.name);
        if (r?.phase === 'RUN') run = { taskId: task.id, startedAt: r.startedAt, durationMs: task.durationMs };
        else if (r?.phase === 'DONE') done.push(task.id);
      }
      return { name: t.name, spot: spots.get(t.name), run, done, poll: store.polling.get(t.name) ?? null };
    });
    const barges = Pool.recentVisits(pool).slice(0, LIMITS.barges)
      .map(v => ({ id: v.id, thread: v.thread, taskId: v.taskId, outcome: v.outcome, worker: v.worker ?? null }));
    return {
      title: ['ThreadPoolExecutor', `${Pool.presetOf(s, 0) ?? `core ${s.corePoolSize} / max ${s.maximumPoolSize}`} · max ${s.maximumPoolSize} · ${s.runState}`],
      workers, barges, dur: id => KV.seconds(store.tasks.get(id)?.durationMs),
    };
  }

  const idle = { title: ['ThreadPoolExecutor', 'not started — press ▶ start on the left'], workers: [], barges: [] };

  // Демо (миниатюра в карусели): кран 1 несёт #7 к площадке, кран 2 снимает #9 с баржи у правого причала,
  // на его площадке ещё стоит выполненная #6; баржа с #10 получила отказ и разворачивается посередине полосы
  const demo = {
    title: ['ThreadPoolExecutor', 'newCachedThreadPool() · max 2'],
    workers: [
      { name: 'pool-3-thread-1', spot: 0, run: { taskId: 7, progress: 0.6 }, done: [], poll: null },
      { name: 'pool-3-thread-2', spot: 1, run: { taskId: 9, progress: 0.1 }, done: [6], poll: null },
    ],
    barges: [
      { id: 1, thread: 'http-nio-8080-exec-2', taskId: 9, outcome: 'handed', worker: 'pool-3-thread-2' },
      { id: 2, thread: 'http-nio-8080-exec-5', taskId: 10, outcome: 'rejected', worker: null },
    ],
  };

  /** @type {Kind} */
  const kind = {
    name: 'cached', uid: 'cached', backdrop: 'none',
    shapeOf: tile => ({ key: `${tile.id ?? 'idle'}` }),
    layout,
    snapshotOf(tile) {
      const pool = Tiles.itemOf(tile);
      return pool?.state ? cachedSnapshot(tile.store, pool) : idle;
    },
    actorsOf,
    cargoOf,
  };

  return { kind, LIMITS, demo, demoShape: { key: 'demo' } };
})();
