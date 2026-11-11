/*
 * Диорама SynchronousQueue — «доставка к подъезду» — описанием для набора (diorama-kit.js).
 * пакет с едой = задача · курьер на самокате = поток в offer / put · жилец = поток в take · дом без почтового ящика =
 * ёмкость 0: пакет оставить негде, только из рук в руки.
 * put — курьер приезжает по дороге и ждёт на тротуаре, каждый на своём месте (очередь нечестная — стек: пару
 * получит не первый пришедший). take — жилец выходит из двери и ждёт на крыльце. Нашлась пара — курьер подъезжает
 * к ступеньке, жилец спускается к нему, пакет переходит из короба в руки; курьер уезжает, жилец уносит пакет домой.
 * offer — курьер подъезжает к ступеньке: если жилец ждёт — передача, если нет — постоял и уехал назад с пакетом.
 * Обе стороны сразу не ждут: ждут либо курьеры, либо жильцы. Сцена — на парящей плите, без воды.
 *
 * Подключение: после diorama-kit.js, diorama-street.js и iso-people.js. На index.html нужны ещё synchronousqueue.js
 * и tiles.js (снимок). Всё лежит в объекте SyncDiorama: kind — описание для Kit.panel / Kit.show, LIMITS, demo.
 */
const SyncDiorama = (() => {
  const { threadColor } = Iso;
  const O = IsoObjects, R = O.ROAD;

  // Сколько ждущих помещается: курьеров на тротуаре и жильцов на крыльце; сверх — «+N»
  const LIMITS = { park: 3, porch: 3 };

  // Раскладка сцены (клетки мира): дом сзади, перед ним тротуар, спереди дорога вдоль x
  const STREET = {
    island: [-3.6, -3.6, 7.6, 3.5], seed: 7, decorSeed: 31,
    road: { at: 1.6, ends: [-5.8, 10.8] },
    house: { x: 0.5, y: -2.6, w: 4, d: 1.8, floors: 2 },
    walk: [-2.4, -0.2, 6.6, 1.5],             // тротуар: x0, y0, x1, y1
    park: { firstX: 1.2, step: 1.0, y: 0.8 }, // места ждущих курьеров — левее крыльца
    meetC: 0.85,                              // курьер у ступеньки (y); жилец — на ступеньке (meetR)
    porchWait: [[1.7, -0.35], [3.3, -0.35], [1.7, 0.15]], // ждущие жильцы: по бокам от двери и на ступеньке
    bench: [4.6, 0.1], lamp: [-1.9, 0.0],     // фонарь — у левого края тротуара: у крыльца он закрывал дверь
  };

  /**
   * Снимок: givers — визиты offer / put { id, thread, method, taskId, dur, state, pair }, takers — визиты take / poll
   * { id, thread, taskId, dur, state, pair } (state, pair — как в store synchronousqueue.js: pair — id визита
   * с другой стороны). Демо: двое ждут в put, третий только что отдал пакет жильцу
   */
  const demo = {
    givers: [
      { id: 1, thread: 'putter-1', method: 'put', taskId: 11, dur: '5.0s', state: 'inside', pair: null },
      { id: 2, thread: 'putter-2', method: 'put', taskId: 12, dur: '5.0s', state: 'inside', pair: null },
      { id: 3, thread: 'putter-3', method: 'put', taskId: 13, dur: '5.0s', state: 'done', pair: 4 },
    ],
    takers: [{ id: 4, thread: 'taker-1', taskId: 13, dur: '5.0s', state: 'done', pair: 3 }],
  };

  const waitingGivers = snap => snap.givers.filter(g => g.method === 'put' && g.state === 'inside' && g.pair == null);
  const waitingTakers = snap => snap.takers.filter(t => t.state === 'inside');
  const titleOf = snap => ['SynchronousQueue', `${waitingGivers(snap).length} waiting in put · ${waitingTakers(snap).length} waiting in take`];

  // ---------- Сцена ----------

  /**
   * Неподвижная сцена: остров, дорога, тротуар, дом с крыльцом. Места: на дороге — entry, parkLane0…, curb, exit;
   * курьеры — park0… (ждут), meetC (у ступеньки); жильцы — door (выходят и уходят), porch0… (ждут), meetRIn
   * (перед дверью — оттуда к ступеньке по прямой, лицом к курьеру), meetR (на ступеньке)
   */
  function layout(s) {
    const L = STREET, H = L.house;
    // Парящая плита вместо острова (фон сцены прозрачный — kind.backdrop)
    const st = Kit.street(s, { island: L.island, seed: L.seed, at: L.road.at, ends: L.road.ends, ground: 'slab' });
    s.title(['SynchronousQueue', '…']);

    O.paved(s, ...L.walk);
    const home = O.house(s, H.x, H.y, H.w, H.d, H.floors);
    O.bench(s, ...L.bench);
    O.streetLamp(s, ...L.lamp);

    const [dx, doorY] = home.doorAt, stepY = home.porch[3];
    // Дорога: съезды к местам ожидания и к крыльцу
    const parkX = i => L.park.firstX - i * L.park.step;
    st.lanePlace('curb', dx);
    const links = [['curb', 'meetC']];
    for (let i = 0; i < LIMITS.park; i++) {
      st.lanePlace(`parkLane${i}`, parkX(i));
      st.place(`park${i}`, [parkX(i), L.park.y]);
      links.push([`parkLane${i}`, `park${i}`]);
    }
    st.place('meetC', [dx, L.meetC]);
    // Крыльцо: дверь → перед дверью → ступенька; места ожидания — к «перед дверью»
    st.place('door', [dx, doorY]);
    st.place('meetRIn', [dx, doorY + 0.3]);
    st.place('meetR', [dx, stepY + 0.1]); // у края ступеньки, лицом к курьеру
    links.push(['door', 'meetRIn'], ['meetRIn', 'meetR']);
    L.porchWait.forEach((at, i) => { st.place(`porch${i}`, at); links.push([`porch${i}`, 'meetRIn']); });

    // «+N» — над последним местом ожидания с каждой стороны
    const moreC = s.label(parkX(LIMITS.park - 1), L.park.y, 1.05, ['+0'], { permanent: true });
    const moreR = s.label(...L.porchWait[LIMITS.porch - 1], 0.95, ['+0'], { permanent: true });

    st.keepOut([H.x - 0.4, H.y - 0.4, H.x + H.w + 0.6, H.y + H.d + 0.2], home.porch, L.walk);

    function update(snap) {
      s.retitle(titleOf(snap));
      for (const [label, count, limit] of [[moreC, waitingGivers(snap).length, LIMITS.park], [moreR, waitingTakers(snap).length, LIMITS.porch]]) {
        const extra = count - limit;
        if (extra > 0) s.relabel(label, [`+${extra}`]);
        s.showLabel(label, extra > 0);
      }
    }

    // Дверь открыта, пока жилец рядом с ней (выходит или заходит); перерисовка — только когда меняется
    let open = null;
    function frame(now, actors) {
      const near = actors.some(a => String(a.key).startsWith('take-') && Math.hypot(a.x - dx, a.y - doorY) < 0.6);
      if (near !== open) { open = near; home.setOpen(near); }
      return false;
    }

    const facing = { meetC: 'y-', meetR: 'y+', door: 'y+', meetRIn: 'y+',
      ...Object.fromEntries(Array.from({ length: LIMITS.park }, (_, i) => [`park${i}`, 'y-'])),
      ...Object.fromEntries(L.porchWait.map((_, i) => [`porch${i}`, 'y+'])) };
    return st.layout(L.decorSeed, { links, update, frame, facing });
  }

  // ---------- Кто где ----------

  const giverKey = g => `give-${g.id}`;
  const takerKey = t => `take-${t.id}`;

  // Ждущих больше мест — на местах остаются первые пришедшие (уже стоят), новые — в «+N». Не «последние пришедшие»:
  // тогда при каждом новом ждущем самый старый пропадал бы из снимка, и набор увозил бы его, хотя поток ещё ждёт.
  // Спрятанный, получивший пару (стек — скорее всего он), подъезжает к ступеньке прямо с дороги
  const oldest = (list, n) => list.slice(0, n);

  /** Кто из визитов на сцене и где: курьеры — ждут на тротуаре или у ступеньки; жильцы — на крыльце или на ступеньке. */
  function placesOf(snap) {
    const places = new Map();
    const parked = new Set(oldest(waitingGivers(snap), LIMITS.park).map(g => g.id));
    for (const g of snap.givers) {
      if (g.state === 'failed') continue;                 // прерван — уезжает (пропал из снимка)
      if (g.method === 'put' && g.state === 'inside' && g.pair == null) {
        if (parked.has(g.id)) places.set(giverKey(g), 'park*');
      } else places.set(giverKey(g), 'meetC');            // offer, передача или отказ — у ступеньки
    }
    const waiting = new Set(oldest(waitingTakers(snap), LIMITS.porch).map(t => t.id));
    for (const t of snap.takers) {
      if (t.state === 'inside') { if (waiting.has(t.id)) places.set(takerKey(t), 'porch*'); }
      else if (t.state === 'done') places.set(takerKey(t), 'meetR'); // poll не дождался или прерван — уходит в дверь
    }
    return places;
  }

  function actorsOf(snap) {
    const places = placesOf(snap), out = [];
    const label = (thread, line) => ({ lines: [Kit.THREAD_LABEL, line], color: threadColor(thread) });
    for (const g of snap.givers) {
      const place = places.get(giverKey(g));
      if (!place) continue;
      const line = g.state === 'rejected' ? `offer(task #${g.taskId}): nobody waits — leaves` :
        g.state === 'inside' && g.pair == null ? `${g.method}(task #${g.taskId}): waits for a taker` : `${g.method}(task #${g.taskId})`;
      out.push({ key: giverKey(g), place, model: 'courier', color: threadColor(g.thread), label: label(g.thread, line),
        exit: g.state === 'rejected' ? 'entry' : 'exit' });
    }
    for (const t of snap.takers) {
      const place = places.get(takerKey(t));
      if (!place) continue;
      out.push({ key: takerKey(t), place, model: 'person', color: threadColor(t.thread),
        label: label(t.thread, t.state === 'inside' ? 'take(): waits for a giver' : `take() got task #${t.taskId}`), entry: 'door', exit: 'door' });
    }
    return out;
  }

  /**
   * Пакеты. Пары нет — на курьере (в коробе). Пара есть — переходит к жильцу, когда оба на местах: жилец на ступеньке,
   * курьер перед ней (viaFrom); дальше жилец уносит пакет в дверь. Жилец получил задачу, а курьера нет (страницу
   * открыли посреди передачи) — пакет сразу у жильца
   */
  function cargoOf(snap) {
    const places = placesOf(snap), specs = [], placed = new Set();
    const label = (id, dur) => ({ lines: [`task #${id}`, dur] });
    const takerById = new Map(snap.takers.map(t => [t.id, t]));
    for (const g of snap.givers) {
      if (g.taskId == null || !places.has(giverKey(g))) continue;
      const t = takerById.get(g.pair);
      placed.add(g.taskId);
      if (t && places.has(takerKey(t))) {
        specs.push({ key: g.taskId, model: 'bag', actor: takerKey(t), via: 'meetR', viaFrom: 'meetC', from: [{ actor: giverKey(g) }], label: label(g.taskId, g.dur) });
      } else {
        specs.push({ key: g.taskId, model: 'bag', actor: giverKey(g), label: label(g.taskId, g.dur) });
      }
    }
    for (const t of snap.takers) {
      if (t.taskId == null || placed.has(t.taskId) || !places.has(takerKey(t))) continue;
      specs.push({ key: t.taskId, model: 'bag', actor: takerKey(t), label: label(t.taskId, t.dur) });
    }
    return specs;
  }

  // ---------- Снимок из плитки (index.html) ----------

  /** Снимок из store synchronousqueue.js: недавние визиты, разделённые на отдающих и получающих. */
  function syncSnapshot(store, queue) {
    const dur = id => KV.seconds(store.tasks.get(id)?.durationMs);
    const visits = SynchronousQueueView.recentVisits(queue).map(v => ({ ...v, dur: dur(v.taskId) }));
    return {
      givers: visits.filter(v => v.method === 'offer' || v.method === 'put'),
      takers: visits.filter(v => v.method === 'take' || v.method === 'poll'),
    };
  }

  const idle = { givers: [], takers: [] };

  /** @type {Kind} */
  const kind = {
    name: 'sync', uid: 'sync', backdrop: 'none',
    shapeOf: tile => ({ key: `${tile.id ?? 'idle'}` }),
    layout,
    snapshotOf(tile) {
      const queue = Tiles.itemOf(tile);
      return queue ? syncSnapshot(tile.store, queue) : idle;
    },
    actorsOf,
    cargoOf,
  };

  return { kind, LIMITS, demo, demoShape: { key: 'demo' } };
})();
