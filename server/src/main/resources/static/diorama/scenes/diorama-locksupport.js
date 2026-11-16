/*
 * Диорама LockSupport — «стоянка» — описанием для набора (diorama-kit.js). Выбрали 2026-11-15 из двух проб
 * (полиция и смотритель стоянки) — полицию. Договорённости — docs/DIORAMAS.md.
 * машина = поток parker-N (цвет потока), стоит на своём месте всю жизнь: работает (паркомат — прогресс задачи),
 * потом park — спит (z z); parkNanos — спит с будильником (полоска таймаута). unpark делает другой поток (HTTP) —
 * полицейская машина его цвета подъезжает по дороге к месту цели: спит — будит, работает — кладёт квитанцию
 * (разрешение) на машину; следующий park с квитанцией возвращается сразу.
 *
 * Поток (run объекта) — машина въезжает по дороге и встаёт на своё место (закреплено за потоком, пока он жив);
 * park вернулся — пропал из снимка, машина выезжает и уезжает к краю плиты. Мест — LIMITS.spots, потоков больше —
 * «+N» у въезда на площадку (на местах — первые пришедшие). Прогресс на паркомате и таймаут parkNanos — кадрами.
 * Работающая машина «с заведённым двигателем» — пар из выхлопной трубы; мигалка полиции мигает (оба — SVG <animate>).
 *
 * unpark — визит полиции (LockSupportView.recentUnparks: кто позвал, кому, этап цели на входе в unpark): машина цвета
 * вызывающего едет по дороге к месту цели, стоит и уезжает. Что с квитанцией — по этапу цели в момент unpark:
 *   спит (parked) — полиция будит: встреча без груза (ActorSpec.meet), когда стоят обе, машина вздрагивает и уезжает
 *   (разрешение park забирает сразу — квитанцию, которая тут же исчезла бы, не показываем);
 *   работает, квитанции нет — квитанция ложится на машину и лежит, пока не вернётся её park (разрешение заранее);
 *   работает, квитанция уже лежит — полиция постояла и уехала со своей: разрешение не копится.
 * Лежит ли квитанция — история событий (был unpark работающему, его park ещё не вернулся), а не копия разрешения
 * из JDK: расходится с ним только при ложном пробуждении, а оно на картинку не влияет.
 *
 * Ограничения: визит полиции живёт столько, сколько store помнит unpark (UNPARK_KEEP_MS): не успела доехать —
 * квитанция уедет вместе с ней; цели сверх мест («+N») полицию не вызывают — ехать некуда.
 *
 * Подключение: после diorama-kit.js и diorama-street.js. На index.html нужны ещё locksupport.js и tiles.js.
 * Всё лежит в объекте LockSupportDiorama: kind — описание для Kit.panel / Kit.show, LIMITS, demo.
 */
const LockSupportDiorama = (() => {
  const { svg, threadColor, PALETTE: C } = Iso;
  const O = IsoObjects;

  // Мест на стоянке; потоков больше — «+N»
  const LIMITS = { spots: 3 };

  // Раскладка (клетки мира): дорога вдоль x спереди, за ней площадка; места вдоль x, машины — носом от дороги (y-),
  // паркомат — у ближнего правого угла места; вызывающий unpark встаёт на дороге напротив места (curbN)
  const LOT = {
    island: [-1.4, -3.0, 6.6, 1.5], seed: 9, decorSeed: 27,
    roadAt: 0.25, lot: [-0.4, -2.4, 5.6, -0.2],
    xs: [0.7, 2.6, 4.5], carY: -1.35,
  };

  /**
   * Снимок: parkers — потоки на местах { name, spot, stage: 'work' | 'parked', run, timeout, ticket }:
   * run — запуск задачи { startedAt, durationMs } (прогресс на паркомате — кадрами), в демо — progress (доля);
   * timeout — у parkNanos { start, ms }, в демо — { left, ms }; ticket — на машине лежит квитанция (см. cargoOf);
   * extra — потоков сверх мест; callers — визиты полиции { id, thread, target, spot, kind: 'wake' | 'ticket' | 'bounce' }
   * (thread — кто позвал unpark, target — кому, spot — место цели в момент unpark).
   * Демо (честное): parker-1 работает, ему уже дали unpark; parker-2 спит в park, к нему подъехала полиция;
   * parker-3 спит в parkNanos — осталось 40% таймаута
   */
  const demo = {
    parkers: [
      { name: 'parker-1', spot: 0, stage: 'work', progress: 0.6, ticket: true },
      { name: 'parker-2', spot: 1, stage: 'parked' },
      { name: 'parker-3', spot: 2, stage: 'parked', timeout: { left: 0.4, ms: 2000 } },
    ],
    extra: 0,
    callers: [{ id: 1, thread: 'http-nio-8080-exec-2', target: 'parker-2', spot: 1, kind: 'wake' }],
  };

  /**
   * Пар из выхлопной трубы — «двигатель заведён», пока машина работает на месте. Облачка у заднего бампера (машина
   * стоит носом от дороги — зад к зрителю) поднимаются, растут и тают по очереди: SVG <animate> (SMIL), браузер
   * крутит их сам, без кадров набора. Рисует сцена у места, а не модель машины: у других сцен пара нет.
   * Возвращает узел — показать или спрятать
   */
  const PUFF = { n: 3, dur: 1.2, rise: 0.55, back: 0.25, r: [2, 6], opacity: 0.75 };
  function exhaust(s, x, y) {
    const g = svg('g'), from = s.P(x, y, 0.14), to = s.P(x, y + PUFF.back, 0.14 + PUFF.rise);
    for (let k = 0; k < PUFF.n; k++) {
      const c = svg('circle', { cx: from[0], cy: from[1], r: PUFF.r[0], fill: '#f4f4f4', opacity: 0 });
      const anim = (attributeName, a, b) => c.append(svg('animate', { attributeName, values: `${a};${b}`, dur: `${PUFF.dur}s`,
        begin: `${k * PUFF.dur / PUFF.n}s`, repeatCount: 'indefinite' }));
      anim('cx', from[0], to[0]); anim('cy', from[1], to[1]); anim('r', ...PUFF.r); anim('opacity', PUFF.opacity, 0);
      g.append(c);
    }
    g.style.display = 'none';
    s.add(x + y + 0.5, g); // глубже машины на месте: облачка — поверх её зада
    return g;
  }

  // Доля работы задачи и сколько осталось таймаута — к моменту now (живые — по времени, демо — как дано)
  const workOf = (p, now) => p.progress ?? (p.run?.durationMs ? Math.min((now - p.run.startedAt) / p.run.durationMs, 1) : 0);
  const leftOf = (t, now) => t.left ?? Math.max(0, 1 - (now - t.start) / t.ms);

  // ---------- Сцена ----------

  /**
   * Неподвижная стоянка: плита, дорога, площадка с разметкой, паркоматы; таблички «спит» над местами и «+N» у въезда.
   * Места: на дороге — entry, curb0… (напротив мест), exit; на площадке — spot0…, каждое — только со своего curb
   */
  function layout(s, shape) {
    const L = LOT;
    const st = Kit.street(s, { island: L.island, seed: L.seed, at: L.roadAt, ground: 'slab' });
    s.title(['LockSupport', 'park · parkNanos · unpark']);
    O.asphalt(s, ...L.lot);
    // Разметка мест: белые полосы между местами
    for (const x of [L.xs[0] - 0.95, ...L.xs.map(x => x + 0.95)]) {
      s.ground.push(s.flat(x - 0.04, L.lot[1] + 0.25, 0.08, L.lot[3] - L.lot[1] - 0.25, C.roadMark, 0.002));
    }

    const spots = L.xs.slice(0, shape.spots).map((x, i) => {
      const l = s.label(x, L.carY, 1.2, ['parking spot', 'a thread parks here: one permit at a time'], {});
      const meter = O.parkingMeter(s, x + 0.56, L.carY + 0.55, l);
      // Спит: z z; у parkNanos — та же табличка с будильником и полоской таймаута
      const zz = s.label(x, L.carY, 0.95, ['z z'], { permanent: true });
      // Выхлопная труба — у левого заднего угла машины (зад — к дороге, +y)
      const puffs = exhaust(s, x - 0.15, L.carY + O.CAR.L / 2);
      st.place(`spot${i}`, [x, L.carY]);
      st.lanePlace(`curb${i}`, x);
      return { meter, zz, puffs, x, p: null, shown: 'init', steaming: false };
    });
    // Потоков больше, чем мест, — «+N» у въезда на площадку
    const more = s.label(L.lot[0] + 0.2, L.carY, 0.8, ['+0'], { permanent: true });
    st.keepOut(L.lot);

    // Кто на каком месте — запомнить для кадров; «+N» — сразу
    function update(snap) {
      spots.forEach((t, i) => { t.p = snap.parkers.find(p => p.spot === i) ?? null; });
      if (snap.extra > 0) s.relabel(more, [`+${snap.extra}`]);
      s.showLabel(more, snap.extra > 0);
    }

    // Паркомат (прогресс задачи) и табличка спящего (z z, у parkNanos — с таймаутом) — шагом 2%; пар — пока машина
    // работает и уже стоит на месте (въезжающая ещё не работает); true — кто-то работает или ждёт: кадры нужны дальше
    function frame(now, actors = []) {
      let busy = false;
      for (const t of spots) {
        const car = t.p && actors.find(a => a.key === t.p.name);
        const steaming = t.p?.stage === 'work' && !!car && Math.hypot(car.x - t.x, car.y - L.carY) < 0.05;
        if (steaming !== t.steaming) { t.steaming = steaming; t.puffs.style.display = steaming ? '' : 'none'; }
        const p = t.p, color = p ? threadColor(p.name) : null;
        const work = p?.stage === 'work' ? workOf(p, now) : null;
        const left = p?.stage === 'parked' && p.timeout ? leftOf(p.timeout, now) : null;
        const key = `${p?.name}|${p?.stage}|${work == null ? '-' : Math.round(work * 50)}|${left == null ? '-' : Math.round(left * 50)}`;
        if (key !== t.shown) {
          t.shown = key;
          t.meter.set(work, color);
          if (p?.stage === 'parked') {
            s.relabel(t.zz, [left == null ? 'z z' : `z z ⏰ ${Math.ceil(left * p.timeout.ms / 1000)}s`],
              { color, bar: left == null ? undefined : { fraction: left, color } });
          }
          s.showLabel(t.zz, p?.stage === 'parked');
        }
        busy ||= (work != null && work < 1) || (left != null && left > 0);
      }
      return busy;
    }

    const facing = Object.fromEntries(spots.flatMap((_, i) => [[`spot${i}`, 'y-'], [`curb${i}`, 'x']]));
    return st.layout(L.decorSeed, { links: spots.map((_, i) => [`curb${i}`, `spot${i}`]), update, frame, facing });
  }

  // ---------- Кто где ----------

  const policeKey = (c, i) => `police-${c.id ?? i}`;
  const CALLER_LINE = {
    wake: c => `unpark(${c.target}): it sleeps in park — wakes it up`,
    ticket: c => `unpark(${c.target}): it works — leaves the permit, its next park() returns at once`,
    bounce: c => `unpark(${c.target}): it already has a permit — permits do not add up`,
  };

  /**
   * Машина потока — на своём месте (въезд и выезд — по дороге); полиция — напротив места цели, на визит unpark.
   * Спящую будят встречей: у её машины — meet с полицией (набор запомнит её по первому снимку и подержит машину,
   * когда та, проснувшись, пропадёт из снимка, — пока полиция не встанет напротив; тогда вздрог)
   */
  function actorsOf(snap) {
    const callers = snap.callers ?? [];
    return [
      ...snap.parkers.map(p => {
        const color = threadColor(p.name), i = callers.findIndex(c => c.kind === 'wake' && c.target === p.name);
        return { key: p.name, place: `spot${p.spot}`, color, label: { lines: [Kit.THREAD_LABEL, 'runs the task, then park()'], color },
          ...(i >= 0 && { meet: { with: policeKey(callers[i], i), at: `spot${p.spot}`, withAt: `curb${p.spot}`, pose: { jolt: true } } }) };
      }),
      ...callers.map((c, i) => {
        const color = threadColor(c.thread);
        return { key: policeKey(c, i), place: `curb${c.spot}`, model: 'police', color,
          label: { lines: [Kit.THREAD_LABEL, CALLER_LINE[c.kind ?? 'wake'](c)], color } };
      }),
    ];
  }

  const TICKET_LABEL = { lines: ['permit', 'unpark came while it worked: the next park() returns at once'] };

  /**
   * Квитанции. Лежит на работающей машине (ticket) — с визита unpark до её park; пока визит идёт — сначала на крыше
   * полиции и перелетает, когда стоят обе (via — место машины, viaFrom — полиция напротив). Лишняя (bounce) — на крыше
   * полиции: уезжает с ней. Разбудить спящую (wake) — без квитанции, встречей (actorsOf)
   */
  function cargoOf(snap) {
    const specs = [];
    const handoff = (c, i) => ({ via: `spot${c.spot}`, viaFrom: `curb${c.spot}`, from: [{ actor: policeKey(c, i) }] });
    (snap.callers ?? []).forEach((c, i) => {
      if (c.kind === 'bounce') specs.push({ key: `ticket-bounce-${c.id}`, model: 'ticket', actor: policeKey(c, i), label: TICKET_LABEL });
    });
    for (const p of snap.parkers) {
      if (!p.ticket) continue;
      // Визит, который положил квитанцию, ещё идёт — путь с крыши полиции
      const i = (snap.callers ?? []).findIndex(c => c.kind === 'ticket' && c.target === p.name);
      specs.push({ key: `ticket-${p.name}`, model: 'ticket', actor: p.name, label: TICKET_LABEL, ...(i >= 0 && handoff(snap.callers[i], i)) });
    }
    return specs;
  }

  // ---------- Снимок из плитки (index.html) ----------

  // Места закреплены за потоками: объект → (имя потока → место). Первое свободное; пока поток жив — то же
  const spotsByItem = new Map();
  function spotsOf(itemId, names) {
    if (!spotsByItem.has(itemId)) spotsByItem.set(itemId, new Map());
    const spots = spotsByItem.get(itemId);
    for (const name of spots.keys()) if (!names.includes(name)) spots.delete(name);
    for (const name of names) {
      if (spots.has(name)) continue;
      const taken = new Set(spots.values());
      const free = LOT.xs.findIndex((_, i) => i < LIMITS.spots && !taken.has(i));
      if (free >= 0) spots.set(name, free);
    }
    return spots;
  }

  /**
   * Визиты полиции и квитанции: объект → { visits (at разобранного unpark → визит или null), tickets (у кого лежит) }.
   * Вид визита — по этапу цели на входе в unpark (targetStage): parked — разбудить; work — положить квитанцию или,
   * если уже лежит, уехать с ней. Квитанция снимается, когда park цели вернулся (поток пропал со стоянки)
   */
  const callsByItem = new Map();
  let visitSeq = 0;
  function callersOf(item, spots, alive) {
    if (!callsByItem.has(item.id)) callsByItem.set(item.id, { visits: new Map(), tickets: new Set() });
    const mem = callsByItem.get(item.id), recent = LockSupportView.recentUnparks(item), callers = [];
    for (const name of mem.tickets) if (!alive.has(name)) mem.tickets.delete(name);
    for (const u of recent) {
      if (!mem.visits.has(u.at)) {
        const spot = spots.get(u.thread);
        // Цели нет на стоянке (сверх мест, уже уехала) — полиции ехать некуда
        const visit = spot == null || !u.targetStage ? null
          : { id: ++visitSeq, thread: u.by, target: u.thread, spot,
              kind: u.targetStage === 'parked' ? 'wake' : mem.tickets.has(u.thread) ? 'bounce' : 'ticket' };
        if (visit?.kind === 'ticket') mem.tickets.add(u.thread);
        mem.visits.set(u.at, visit);
      }
      const visit = mem.visits.get(u.at);
      if (visit) callers.push(visit);
    }
    // Визиты устаревших unpark — забыть
    for (const at of mem.visits.keys()) if (!recent.some(u => u.at === at)) mem.visits.delete(at);
    return { callers, tickets: mem.tickets };
  }

  /**
   * Снимок из store locksupport.js: на стоянке — потоки внутри run объекта, чей park ещё не вернулся (stage work /
   * parked); вернулся — пропал, машина уезжает (в плитке его плашка ещё тает). Запуск задачи — из store.tasks
   */
  function parkingSnapshot(store, item) {
    const task = store.tasks.get(item.taskId);
    const alive = [...item.threads].filter(([, p]) => p.stage !== 'done' && p.leftAt == null);
    const spots = spotsOf(item.id, alive.map(([name]) => name));
    const { callers, tickets } = callersOf(item, spots, new Set(alive.map(([name]) => name)));
    const parkers = alive.filter(([name]) => spots.has(name)).map(([name, p]) => {
      const run = task?.runs.get(name);
      return {
        name, spot: spots.get(name), stage: p.stage,
        run: run?.phase === 'RUN' ? { startedAt: run.startedAt, durationMs: task.durationMs } : null,
        timeout: p.stage === 'parked' && p.timeoutMs != null ? { start: p.parkedAt, ms: p.timeoutMs } : null,
        ticket: tickets.has(name),
      };
    });
    return { parkers, extra: alive.length - parkers.length, callers };
  }

  const idle = { parkers: [], extra: 0, callers: [] };

  /** @type {Kind} */
  const kind = {
    name: 'locksupport', uid: 'park', backdrop: 'none', // плита парит над страницей — без воды
    shapeOf: tile => ({ key: `${tile.id ?? 'idle'}`, spots: LIMITS.spots }),
    layout,
    snapshotOf(tile) {
      const item = Tiles.itemOf(tile);
      return item ? parkingSnapshot(tile.store, item) : idle;
    },
    actorsOf,
    cargoOf,
  };

  return { kind, LIMITS, demo, demoShape: { key: 'demo', spots: LIMITS.spots } };
})();