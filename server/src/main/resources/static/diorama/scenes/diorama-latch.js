/*
 * Диорама CountDownLatch — «старт ралли» — описанием для набора (diorama-kit.js). Выбрали 2026-11-22 из двух проб:
 * табло с цифрой (A) и стартовые огни (A + B) — огни. Договорённости — docs/DIORAMAS.md.
 *
 * машина = поток в await (цвет потока): встаёт у стоп-линии трёхполосной дороги — по машине на полосу, в ряд, а не
 * друг за другом (latch выпускает всех, очереди «кто первый получит» нет) · судья = HTTP-поток, позвавший countDown
 * (его цвет): подходит к трибуне и стреляет вверх · стартовые огни на портале прямо над стоп-линией = count:
 * по огню на initialCount, горят красные — сколько countDown ещё нужно; каждый выстрел гасит один; на 0 все зелёные.
 * Пробовали и не взяли: створки ворот в полоску (читались как забор), тёмную площадку старта за однополосной дорогой
 * (одна машина — на дороге, остальные — на асфальте), табло с цифрой (старт закрыт «на словах»: проехать ничто не мешает).
 *
 * Подключение: после diorama-kit.js и diorama-street.js. На index.html нужны ещё countdownlatch.js и tiles.js. Всё лежит в объекте LatchDiorama: kind — описание для Kit.panel /
 * Kit.show, LIMITS, demo, demoShape.
 */
const LatchDiorama = (() => {
  const { svg, shade, threadColor, PALETTE: C } = Iso;
  const O = IsoObjects;

  // Мест на старте — по полосе; машин больше — «+N». Огней на портале — не больше lights (count ограничен полем
  // на index.html; созданный через REST с большим — горят все, точное число — в подсказке)
  const LIMITS = { grid: 3, lights: 5 };

  // Раскладка (клетки мира): трёхполосная дорога вдоль x через всю плиту (y от road[0] до road[1], полоса — lane);
  // машины на старте — по центру своих полос, носом к +x; въезд и выезд — по средней полосе
  const LANE = 0.85;
  const RALLY = {
    island: [-1.2, -2.6, 9.6, 2.4], seed: 5, decorSeed: 41,
    road: [1.2 - 3 * LANE, 1.2],
    gridX: 4.2, stopX: 4.85,
    judge: [6.35, 2.05], judgeIn: [8.6, 2.6], podium: [6.55, 1.55],
  };
  // Центры полос от ближней (+y) к дальней
  const ROWS = [0, 1, 2].map(i => RALLY.road[1] - LANE * (i + 0.5));

  // Сколько после выхода из await машина ещё в снимке. through — едет прямо на выезд: в снимке ей надо побыть, только
  // чтобы появиться (набор доведёт её до выезда и после); с промежуточным местом (out) она стояла бы на нём, пока
  // не пропадёт из снимка. Не дождавшаяся — постоять на месте, потом развернуться
  const THROUGH_MS = 300, GAVE_UP_MS = 300;

  /**
   * Снимок: initialCount, count; cars — машины на сцене { name, stage }: waiting (ждёт на старте), released (count
   * стал 0, ещё не тронулась — трогаются по одной), gaveUp (прервали / таймаут — развернётся), through (при входе
   * было 0 — проезжает не останавливаясь); на старте — первые LIMITS.grid по приходу, extra — ждущих сверх мест;
   * judge — недавний countDown { thread, kind: 'tick' | 'open' | 'idle', shooting } (shooting — вспышка ещё видна) или null.
   * Демо (честное): latch на 3, два countDown уже было — count 1; три машины ждут; судья только что выстрелил (2 → 1)
   */
  const demo = {
    initialCount: 3, count: 1,
    cars: ['latch-waiter-1', 'latch-waiter-2', 'latch-waiter-3'].map(name => ({ name, stage: 'waiting' })),
    extra: 0,
    judge: { thread: 'http-nio-8080-exec-4', kind: 'tick', shooting: true },
  };

  // ---------- Реквизит сцены ----------

  /** Трибуна судьи: низкий помост со ступенькой и стойка; судья стоит рядом */
  function podium(s, x, y) {
    const g = svg('g');
    g.append(s.box(x, y, 0, 0.6, 0.45, 0.22, C.wood), s.box(x + 0.6, y + 0.1, 0, 0.18, 0.3, 0.1, shade(C.wood, -0.1)));
    g.append(s.box(x + 0.05, y + 0.05, 0.22, 0.08, 0.08, 0.5, '#5b5f66'), s.box(x - 0.02, y - 0.02, 0.72, 0.22, 0.12, 0.05, C.accent));
    s.castShadow(x, y, 0.6, 0.45, 0.4);
    s.add(x + y + 0.3, g);
  }

  /**
   * Выстрел вверх: жёлтая вспышка над поднятой рукой судьи и облачко дыма. Возвращает узел — показать или спрятать
   */
  function shot(s, x, y) {
    const g = svg('g');
    const [cx, cy] = s.P(x, y, 1.05);
    const star = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, r = i % 2 ? 4 : 10;
      star.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`);
    }
    g.append(svg('circle', { cx, cy: cy - 14, r: 6, style: 'fill: #f4f4f4; opacity: .8' }),
      svg('circle', { cx: cx + 5, cy: cy - 19, r: 4, style: 'fill: #f4f4f4; opacity: .6' }),
      svg('polygon', { points: star.join(' '), style: 'fill: #ffd86b; stroke: #f2a93b; stroke-width: 1' }));
    g.style.display = 'none';
    s.add(x + y + 2, g);
    return g;
  }

  /**
   * Портал над стоп-линией — два столба на обочинах и перекладина вдоль y; на ней n огней (по initialCount).
   * set(count, n): горят красные — первые count, остальные погашены; count = 0 — все зелёные
   */
  function lightsGantry(s, x, [y0, y1], n, label) {
    // Высоко: перекладина на экране — над крышами машин у стоп-линии, а не поперёк них
    const g = svg('g'), z = 2.3;
    // Столбы — отдельно, каждый со своей глубиной: ближний — перед машинами, дальний — за ними
    for (const y of [y0, y1]) {
      s.add(x + y + 0.1, s.box(x - 0.06, y - 0.06, 0, 0.12, 0.12, z + 0.25, '#5b5f66'));
      s.castShadow(x - 0.06, y - 0.06, 0.12, 0.12, z + 0.25);
    }
    g.append(s.box(x - 0.1, y0, z, 0.2, y1 - y0, 0.3, '#2b2b2b'));
    const lamps = Array.from({ length: n }, (_, i) => {
      const y = y0 + (y1 - y0) * (i + 1) / (n + 1);
      const [cx, cy] = s.P(x + 0.1, y, z + 0.15);
      const glow = svg('circle', { cx, cy, r: 8 }), core = svg('circle', { cx, cy, r: 4.5 });
      g.append(glow, core);
      return { glow, core };
    });
    s.hover(g, label);
    s.add(x + y1 + 0.5, g); // перекладина — поверх всего под ней
    return {
      set(count) {
        lamps.forEach(({ glow, core }, i) => {
          const on = count === 0 || i < count, color = count === 0 ? C.ok : C.fail;
          core.setAttribute('style', `fill: ${color}; opacity: ${on ? 1 : 0.25}`);
          glow.setAttribute('style', `fill: ${color}; opacity: ${on ? 0.35 : 0}`);
        });
      },
    };
  }

  // ---------- Сцена ----------

  const countLines = snap => snap.count === 0
    ? ['go!', `count 0 of ${snap.initialCount}: await() returns at once — for good`]
    : [`count ${snap.count} of ${snap.initialCount}`, `${snap.count} more countDown() to start`];

  /**
   * Неподвижная сцена: плита, трёхполосная дорога со стоп-линией, над ней портал с огнями (count), трибуна.
   * Места: по средней полосе — entry, in (перед стартом), out (за стартом), exit; на старте — grid0… (по полосам);
   * у трибуны — judge (судья появляется прямо там: выстрел — в момент события, — и уходит на judgeIn у края плиты)
   */
  function layout(s, shape) {
      const L = RALLY, [v0, v1] = L.road, mid = ROWS[1];
      // Дорогу рисуем сами (трёхполосная); street — только плита и места: полоса мест — средняя (at — от её центра)
      const st = Kit.street(s, { island: L.island, seed: L.seed, ground: 'slab', roads: [], at: mid - O.ROAD.lane });
      const ends = [L.island[0] - 0.05, L.island[2] + 0.05];
      O.road(s, ...ends, { v0, v1, lanes: 3 });
      st.places.entry = [ends[0] + 0.05, mid];
      st.places.exit = [ends[1] - 0.05, mid];
      s.title(['CountDownLatch', 'await · countDown']);
      O.stopLine(s, L.stopX, v0, v1);

      podium(s, ...L.podium);
      const flash = shot(s, L.judge[0] + 0.15, L.judge[1] - 0.1);
      // Портал — прямо над стоп-линией: огни там, где машины ждут
      const countLabel = s.label(L.stopX, (v0 + v1) / 2, 2.85, ['count', '…'], {});
      const counter = lightsGantry(s, L.stopX, [v0 - 0.15, v1 + 0.15], shape.lights, countLabel);

      st.lanePlace('in', 1.4);
      st.lanePlace('out', 7.0);
      ROWS.slice(0, shape.grid).forEach((y, i) => st.place(`grid${i}`, [L.gridX, y]));
      st.place('judge', L.judge);
      st.place('judgeIn', L.judgeIn);
      const more = s.label(1.9, mid, 0.6, ['+0'], { permanent: true });
      const links = [...ROWS.slice(0, shape.grid).flatMap((_, i) => [['in', `grid${i}`], [`grid${i}`, 'out']]), ['judgeIn', 'judge']];
      st.keepOut([ends[0] - 1, v0 - 0.4, ends[1] + 1, v1 + 0.3], [L.podium[0] - 0.4, L.podium[1] - 0.3, L.judgeIn[0] + 0.4, L.judgeIn[1] + 0.4]);

      function update(snap) {
        counter.set(snap.count);
        flash.style.display = snap.judge?.shooting ? '' : 'none';
        if (snap.extra > 0) s.relabel(more, [`+${snap.extra}`]);
        s.showLabel(more, snap.extra > 0);
        s.relabel(countLabel, countLines(snap));
      }

      const facing = { judge: 'x', ...Object.fromEntries(ROWS.map((_, i) => [`grid${i}`, 'x'])) };
      return st.layout(L.decorSeed, { links, update, facing });
  }

  // ---------- Кто где ----------

  const JUDGE_LINE = {
    tick: 'countDown(): count − 1 — nobody wakes up yet',
    open: 'countDown(): count → 0 — start! all waiting threads wake up',
    idle: 'countDown(): count was already 0 — nothing happens',
  };

  const CAR_LINE = {
    waiting: 'waits in await() at the start',
    released: 'count is 0: await() returned — starting',
    gaveUp: 'left await() without the start (interrupted or timed out) — turns back',
    through: 'count was already 0: await() returned at once — drives through',
  };

  /**
   * Машины на старте — группа мест grid* (место закреплено за машиной, пока она там); проезжающая сразу — прямо на
   * выезд (въехала и проехала, без остановки); не дождавшаяся — уезжает назад, к въезду. Пропала из снимка — набор
   * увозит её на выезд: со старта — через out. Судья — у трибуны, уходит к краю плиты
   */
  function actorsOf(snap) {
    const cars = snap.cars.map(c => {
      const color = threadColor(c.name);
      return { key: c.name, place: c.stage === 'through' ? 'exit' : 'grid*', color,
        ...(c.stage === 'gaveUp' && { exit: 'entry' }),
        label: { lines: [Kit.THREAD_LABEL, CAR_LINE[c.stage]], color } };
    });
    const j = snap.judge;
    // Один судья на трибуне: ключ постоянный, другой поток — другой цвет (набор пересоздаст актёра на месте)
    const judge = j ? [{ key: 'judge', place: 'judge', model: 'person', color: threadColor(j.thread),
      entry: 'judge', exit: 'judgeIn', label: { lines: [Kit.THREAD_LABEL, JUDGE_LINE[j.kind]], color: threadColor(j.thread) } }] : [];
    return [...cars, ...judge];
  }

  // ---------- Снимок из плитки (index.html) ----------

  /**
   * Снимок из store countdownlatch.js: на старте — ждущие (waiting) и выпущенные, чья очередь трогаться ещё не пришла
   * (leaving released, departAt — в будущем), и только что не дождавшиеся (GAVE_UP_MS); по приходу (since), первые
   * LIMITS.grid. Ждущий, который вошёл при count 0, и вышедший through — проезжают (THROUGH_MS). Судья — последний
   * недавний countDown
   */
  function latchSnapshot(latch) {
    const now = performance.now(), s = latch.snapshot;
    const onGrid = [], cars = [];
    for (const [name, w] of latch.waiting) {
      if (w.countAtIn === 0) cars.push({ name, stage: 'through' });
      else onGrid.push({ name, stage: 'waiting', since: w.since });
    }
    for (const l of latch.leaving) {
      if (l.kind === 'released' && l.departAt > now) onGrid.push({ name: l.thread, stage: 'released', since: l.since });
      else if ((l.kind === 'timeout' || l.kind === 'interrupted') && now - l.at < GAVE_UP_MS) onGrid.push({ name: l.thread, stage: 'gaveUp', since: l.since });
      else if (l.kind === 'through' && now - l.at < THROUGH_MS) cars.push({ name: l.thread, stage: 'through' });
    }
    onGrid.sort((a, b) => a.since - b.since);
    const shot = CountDownLatchView.recentShots(latch).at(-1);
    return {
      initialCount: s?.initialCount ?? 0, count: s?.count ?? 0,
      cars: [...onGrid.slice(0, LIMITS.grid), ...cars],
      extra: Math.max(onGrid.length - LIMITS.grid, 0),
      judge: shot ? { thread: shot.by, kind: shot.kind, shooting: now - shot.at < CountDownLatchView.SHOT_MS } : null,
    };
  }

  // Огней — по initialCount, не больше LIMITS.lights; при 0 — один (зелёный: старт открыт)
  const lightsOf = count => Math.min(Math.max(count, 1), LIMITS.lights);

  // Поле count спящей плитки: Kit.field не годится — он поднимает 0 до 1, а latch на 0 — честный (открыт сразу)
  const countField = tile => Math.min(Math.max(Number(tile.inputs.count?.value) || 0, 0), LIMITS.lights);

  // Пока не запущен: пустой старт, огней — сколько в поле count
  const idle = count => ({ initialCount: count, count, cars: [], extra: 0, judge: null });

  /** @type {Kind} */
  const kind = {
    name: 'latch', uid: 'latch', backdrop: 'none', // плита парит над страницей — без воды
    // Сцена пересобирается при смене latch или initialCount: от него — число огней
    shapeOf(tile) {
      const latch = Tiles.itemOf(tile);
      const initial = latch?.snapshot ? latch.snapshot.initialCount : countField(tile);
      return { key: `${tile.id ?? 'idle'}:${initial}`, grid: LIMITS.grid, lights: lightsOf(initial) };
    },
    layout,
    snapshotOf(tile) {
      const latch = Tiles.itemOf(tile);
      return latch ? latchSnapshot(latch) : idle(countField(tile));
    },
    actorsOf,
  };

  return { kind, LIMITS, demo, demoShape: { key: 'demo', grid: LIMITS.grid, lights: lightsOf(demo.initialCount) } };
})();
