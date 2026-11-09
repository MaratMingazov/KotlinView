/*
 * Набор для диорам: всё, что одинаково у любой структуры. Структура описывает себя одним объектом (Kind) — как
 * построить сцену, какие на ней места, какой снимок взять из плитки и кто где стоит. Остальное делает набор:
 * сеть маршрутов, актёры (появиться на въезде, доехать по сети до своего места, уехать на выезд), панель рядом
 * с плиткой и статичный показ (prototype.html).
 *
 * Смысл и облик разделены: Kind говорит «актёр #12 — в месте slot2, модель car»; как выглядит модель — реестр
 * Kit.models. Заменить машину на погрузчик — новая модель, а не новый режиссёр.
 *
 * Подключение: после iso-scene.js и реквизита (iso-*.js), до описаний структур (diorama-*.js). Всё лежит в объекте Kit.
 */

/**
 * Описание структуры.
 * @typedef {Object} Kind
 * @property {string} name                                   — для отладки
 * @property {string} uid                                    — префикс id сцены (градиенты, таблички) на странице
 * @property {(tile: Object) => Shape} shapeOf               — «форма» сцены по плитке: другая форма — пересобрать сцену
 * @property {(s: Object, shape: Shape) => Layout} layout    — построить неподвижную сцену и объявить места
 * @property {(tile: Object, shape: Shape) => Object} snapshotOf — снимок из store плитки: единственное место, знающее store
 * @property {(snapshot: Object, shape: Shape) => ActorSpec[]} actorsOf — кто где должен стоять
 */

/**
 * @typedef {Object} Shape
 * @property {string} key — сравнивается между обновлениями: сменился — сцена строится заново
 */

/**
 * Что возвращает Kind.layout: места (центры, мир), связи между ними, въезд и выезд, обновление на месте.
 * @typedef {Object} Layout
 * @property {Object<string, number[]>} places               — имя → [x, y]
 * @property {string[][]} links                              — пары имён мест, по которым можно ехать (в обе стороны)
 * @property {string} entry                                  — где появляется новый актёр
 * @property {string} exit                                   — куда уезжает пропавший из снимка (и там исчезает)
 * @property {(snapshot: Object) => void} [update]           — обновить на месте счётчики, шапку, реквизит
 * @property {(now: number, actors: ActorView[]) => boolean} [frame] — мелкая анимация реквизита на каждом кадре
 *                                                              (стрела, вспышка); true — «ещё анимирую», кадры нужны дальше
 */

/**
 * Где актёр сейчас — для Layout.frame.
 * @typedef {Object} ActorView
 * @property {string|number} key
 * @property {number} x
 * @property {number} y
 * @property {string} target                                 — куда едет сейчас (или где стоит)
 */

/**
 * Где должен быть актёр. Облик (model, color, look) сменился — актёр пересоздаётся на том же месте.
 * @typedef {Object} ActorSpec
 * @property {string|number} key                             — постоянный ключ: id задачи, имя потока
 * @property {string} place                                  — имя места из Layout.places или группа «префикс*»:
 *                                                              набор сам выберет свободное (spot0, spot1, …) и закрепит его
 * @property {string} [model='car']                          — модель из Kit.models
 * @property {string} color
 * @property {Object} [look]                                 — параметры модели (у машины: faded, rack)
 * @property {{ lines: string[], color?: string, bar?: Object }} [label] — табличка при наведении (фиксируется при создании)
 * @property {string|number} [carries]                       — задел: ключ груза, который актёр везёт (ещё не реализовано)
 */
const Kit = (() => {
  // ---------- Модели актёров ----------

  /**
   * Реестр моделей: имя → (s, key, spec) => актёр с интерфейсом { pos, moveTo(x, y), go(points), update(now),
   * heading(), remove() } — как у IsoObjects.carActor. Новая модель (погрузчик, лодка) — новая запись здесь
   */
  const models = {
    car: (s, key, spec) => IsoObjects.carActor(s, key, spec.color, { ...spec.look, label: spec.label }),
  };

  // ---------- Сеть маршрутов ----------

  /**
   * Связи «по цепочке» для мест на одной дороге: соединяет соседние по x. Чтобы не перечислять связи руками
   * и не ошибиться в порядке, когда мест станет больше
   */
  function lane(places, names) {
    const sorted = [...names].sort((a, b) => places[a][0] - places[b][0]);
    return sorted.slice(1).map((name, i) => [sorted[i], name]);
  }

  // Кратчайший путь по сети (Дейкстра; вес связи — расстояние): список имён мест от from до to включительно
  function shortestPath(net, from, to) {
    if (from === to) return [from];
    const dist = new Map([[from, 0]]), prev = new Map(), done = new Set();
    while (true) {
      let cur = null;
      for (const [name, d] of dist) if (!done.has(name) && (cur === null || d < dist.get(cur))) cur = name;
      if (cur === null) return null; // не связано
      if (cur === to) break;
      done.add(cur);
      for (const next of net.neighbours.get(cur) ?? []) {
        const d = dist.get(cur) + Math.hypot(net.places[next][0] - net.places[cur][0], net.places[next][1] - net.places[cur][1]);
        if (d < (dist.get(next) ?? Infinity)) { dist.set(next, d); prev.set(next, cur); }
      }
    }
    const path = [to];
    while (path[0] !== from) path.unshift(prev.get(path[0]));
    return path;
  }

  function network(layout) {
    const neighbours = new Map();
    const link = (a, b) => {
      if (!layout.places[a] || !layout.places[b]) throw new Error(`Kit: связь с неизвестным местом ${a} — ${b}`);
      if (!neighbours.has(a)) neighbours.set(a, new Set());
      neighbours.get(a).add(b);
    };
    for (const [a, b] of layout.links) { link(a, b); link(b, a); }
    return { places: layout.places, neighbours };
  }

  // ---------- Актёры и время ----------

  /**
   * Время анимации отделено от времени событий, но не уходит от него далеко:
   * SPEED, MIN_MS — обычная скорость и минимальная длительность перегона (короткий перегон всё равно виден);
   * DWELL_MS — сколько актёр стоит в месте, если дальше у него ещё остановки (видно, что он там был);
   * MAX_LAG_MS — сколько актёру можно отставать: остаток его плана дольше — всё проигрывается быстрее
   */
  const TIME = { SPEED: 6, MIN_MS: 450, DWELL_MS: 250, MAX_LAG_MS: 1000 };

  const lookOf = spec => JSON.stringify([spec.model ?? 'car', spec.color, spec.look ?? null]);

  /**
   * Актёры одной сцены — с «режиссёром времени». У каждого — план: очередь мест, куда ему ещё надо.
   * sync(specs): новое место не отменяет текущий маршрут, а встаёт в план; пропавший из specs — в конец плана выезд
   * (сначала побывает во всех своих местах, потом уедет и исчезнет); instant — всех сразу на места, планы очистить.
   * tick(now): доехал — постоять DWELL_MS (если дальше ещё есть куда) и ехать к следующему месту плана.
   * Перегоны и стоянки ускоряются, если весь остаток плана при обычной скорости дольше MAX_LAG_MS
   */
  function cast(s, layout) {
    const net = network(layout);
    // ключ → { actor, look, at, route, routeTarget, plan: [места], leaving, readyAt }
    // at — где стоит (или откуда уехал); route — имена мест текущего маршрута, routeTarget — его конец
    const actors = new Map();

    function create(spec) {
      const make = models[spec.model ?? 'car'];
      if (!make) throw new Error(`Kit: нет модели «${spec.model}»`);
      return make(s, `${spec.model ?? 'car'}-${spec.key}`, spec);
    }

    // Где актёр «логически»: место, к которому едет сейчас, или где стоит
    function anchorOf(entry) {
      const i = entry.route ? entry.actor.heading() : null;
      return i != null ? entry.route[i] : entry.routeTarget ?? entry.at;
    }

    // Последнее запланированное место: туда актёр в итоге приедет (для групп мест и сравнения со снимком)
    const finalOf = entry => entry.plan.at(-1) ?? entry.routeTarget ?? entry.at;

    function pathOrThrow(from, to) {
      const path = shortestPath(net, from, to);
      if (!path) throw new Error(`Kit: нет пути ${from} → ${to}`);
      return path;
    }
    const lengthOf = path => path.slice(1).reduce((sum, name, i) => sum + Math.hypot(
      net.places[name][0] - net.places[path[i]][0], net.places[name][1] - net.places[path[i]][1]), 0);

    // Во сколько раз ускорить, чтобы остаток плана от места from уложился в MAX_LAG_MS (1 — не ускорять)
    function speedup(from, plan) {
      let ms = 0, at = from;
      plan.forEach((to, i) => {
        ms += Math.max((lengthOf(pathOrThrow(at, to)) / TIME.SPEED) * 1000, TIME.MIN_MS) + (i < plan.length - 1 ? TIME.DWELL_MS : 0);
        at = to;
      });
      return Math.max(1, ms / TIME.MAX_LAG_MS);
    }

    // Ехать по маршруту route (имена мест) с ускорением k: машина стартует с того места, где она сейчас
    function go(entry, route, k, now) {
      Object.assign(entry, { route, routeTarget: route.at(-1), k, dwellMs: TIME.DWELL_MS / k });
      entry.actor.go(route.map(name => net.places[name]), { now, speed: TIME.SPEED * k, minMs: TIME.MIN_MS / k });
    }

    // Следующее место плана: маршрут от того места, где стоит
    function start(entry, now) {
      const target = entry.plan.shift();
      if (target === entry.at) return;
      go(entry, pathOrThrow(entry.at, target), speedup(entry.at, [target, ...entry.plan]), now);
    }

    /**
     * План вырос, пока актёр в пути: пересчитать ускорение с учётом нового плана. Если надо заметно быстрее —
     * продолжить текущий перегон быстрее с того же места (иначе ускорение досталось бы только следующим перегонам,
     * а отставание копилось бы на том, что уже едет)
     */
    function retime(entry, now) {
      if (!entry.route) return;
      const anchor = anchorOf(entry);
      const k = speedup(anchor, [entry.routeTarget, ...entry.plan]);
      if (k > entry.k * 1.15) go(entry, pathOrThrow(anchor, entry.routeTarget), k, now);
    }

    function placeAt(entry, name) {
      entry.actor.moveTo(...net.places[name], 'x');
      Object.assign(entry, { at: name, route: null, routeTarget: null, plan: [], readyAt: 0 });
    }

    // Облик сменился — пересоздать на том же месте; если ехал — продолжить к той же цели от ближайшего места впереди
    function recreate(entry, spec, now) {
      const { x, y } = entry.actor.pos, anchor = anchorOf(entry);
      entry.actor.remove();
      entry.actor = create(spec);
      entry.actor.moveTo(x, y, 'x');
      entry.look = lookOf(spec);
      if (entry.route) go(entry, pathOrThrow(anchor, entry.routeTarget), entry.k, now);
    }

    /**
     * Группа мест («spot*»): каждому актёру — свободное место группы, и пока он в группе — то же самое
     * (соседний уехал — остальные не перескакивают). Сначала оставить тем, кто уже в группе (по последнему
     * запланированному месту), потом раздать новым
     */
    function resolveGroups(specs) {
      const groups = specs.filter(spec => spec.place.endsWith('*'));
      if (!groups.length) return specs;
      const taken = new Set(), chosen = new Map();
      const inGroup = (place, prefix) => place?.startsWith(prefix) && /^\d+$/.test(place.slice(prefix.length));
      for (const spec of groups) {
        const entry = actors.get(spec.key), prefix = spec.place.slice(0, -1), current = entry && finalOf(entry);
        if (entry && !entry.leaving && inGroup(current, prefix) && !taken.has(current)) { taken.add(current); chosen.set(spec.key, current); }
      }
      for (const spec of groups) {
        if (chosen.has(spec.key)) continue;
        const prefix = spec.place.slice(0, -1);
        let i = 0;
        while (taken.has(`${prefix}${i}`)) i++;
        if (!net.places[`${prefix}${i}`]) throw new Error(`Kit: в группе ${spec.place} нет свободного места для ${spec.key}`);
        taken.add(`${prefix}${i}`);
        chosen.set(spec.key, `${prefix}${i}`);
      }
      return specs.map(spec => chosen.has(spec.key) ? { ...spec, place: chosen.get(spec.key) } : spec);
    }

    function sync(rawSpecs, { instant = false, now = performance.now() } = {}) {
      const specs = resolveGroups(rawSpecs);
      const wanted = new Set();
      for (const spec of specs) {
        if (!net.places[spec.place]) throw new Error(`Kit: неизвестное место «${spec.place}» у актёра ${spec.key}`);
        wanted.add(spec.key);
        let entry = actors.get(spec.key);
        if (entry && entry.look !== lookOf(spec)) recreate(entry, spec, now);
        if (!entry) {
          entry = { actor: create(spec), look: lookOf(spec), leaving: false };
          actors.set(spec.key, entry);
          placeAt(entry, instant ? spec.place : layout.entry);
        }
        if (instant) { placeAt(entry, spec.place); entry.leaving = false; continue; }
        // Вернулся в снимок, пока собирался уехать: выезд из плана убрать
        if (entry.leaving) {
          entry.leaving = false;
          if (entry.plan.at(-1) === layout.exit) entry.plan.pop();
        }
        if (finalOf(entry) !== spec.place) { entry.plan.push(spec.place); retime(entry, now); }
      }
      for (const [key, entry] of actors) {
        if (wanted.has(key) || entry.leaving) continue;
        entry.leaving = true;
        entry.plan.push(layout.exit);
        retime(entry, now);
      }
    }

    // Кадр. true — кто-то едет или ещё ждёт следующей остановки: кадры нужны дальше
    function tick(now) {
      let busy = false;
      for (const [key, entry] of actors) {
        if (entry.route && !entry.actor.update(now)) {
          // Доехал: если дальше ещё есть куда — постоять, чтобы остановку было видно
          entry.at = entry.routeTarget;
          entry.route = entry.routeTarget = null;
          entry.readyAt = now + (entry.plan.length ? entry.dwellMs : 0);
        }
        if (!entry.route && entry.plan.length && now >= entry.readyAt) start(entry, now);
        if (!entry.route && !entry.plan.length && entry.leaving && entry.at === layout.exit) {
          entry.actor.remove();
          actors.delete(key);
          continue;
        }
        busy ||= !!entry.route || entry.plan.length > 0;
      }
      return busy;
    }

    // Где актёры сейчас — для мелкой анимации реквизита (Layout.frame)
    const view = () => [...actors].map(([key, e]) => ({ key, x: e.actor.pos.x, y: e.actor.pos.y, target: e.routeTarget ?? e.plan[0] ?? e.at }));

    return { sync, tick, view, get size() { return actors.size; } };
  }

  // ---------- Сцена структуры ----------

  // Построить сцену по форме: неподвижное — один раз, актёры — потом, через sync
  function stage(kind, shape) {
    const s = Iso.createScene({ uid: kind.uid });
    const layout = kind.layout(s, shape);
    const root = s.render();
    return { s, layout, root, actors: cast(s, layout) };
  }

  /** Статичный показ (prototype.html): сцена по снимку, актёры сразу на своих местах, один кадр frame — без анимации. */
  function show(kind, snapshot, shape) {
    const st = stage(kind, shape);
    st.layout.update?.(snapshot);
    st.actors.sync(kind.actorsOf(snapshot, shape), { instant: true });
    st.layout.frame?.(performance.now(), st.actors.view()); // один кадр: реквизит, зависящий от актёров (табло колонок)
    return st.root;
  }

  /**
   * Живая диорама рядом с плиткой (twin.html): сцена пересобирается, только когда меняется форма (Kind.shapeOf);
   * на каждое update(tile) — снимок, обновление на месте и места актёров. Первая синхронизация после постройки —
   * мгновенная: страницу могли открыть, когда объект уже работает. Кадры — только пока кто-то едет
   */
  function panel(kind) {
    const el = KV.el('div', 'diorama-panel');
    let st = null, shape = null, frame = null, fresh = false;

    // Кадр: актёры и мелкая анимация реквизита; кадры нужны, пока кто-то из них занят
    const loop = now => {
      const moving = st?.actors.tick(now);
      const animating = st?.layout.frame?.(now, st.actors.view()) ?? false;
      frame = moving || animating ? requestAnimationFrame(loop) : null;
    };

    function update(tile) {
      const next = kind.shapeOf(tile);
      if (next.key !== shape?.key) {
        shape = next;
        st = stage(kind, shape);
        el.replaceChildren(st.root);
        fresh = true;
      }
      const snapshot = kind.snapshotOf(tile, shape);
      st.layout.update?.(snapshot);
      st.actors.sync(kind.actorsOf(snapshot, shape), { instant: fresh });
      fresh = false;
      if (!frame) frame = requestAnimationFrame(loop);
    }

    return { el, update };
  }

  // ---------- Помощники для описаний структур ----------

  /**
   * Число из поля параметра спящей плитки (nThreads, permits) — в пределах 1…max: «пустая» сцена рисуется
   * на столько боксов / мест, сколько сейчас стоит в поле
   */
  const field = (tile, name, max) => Math.min(Math.max(Number(tile.inputs[name]?.value) || 1, 1), max);

  /** Доля выполнения запуска задачи (run из KV.trackTask) к этому моменту: 0…1; длительность неизвестна — 0. */
  const progress = (run, durationMs) => durationMs ? Math.min((performance.now() - run.startedAt) / durationMs, 1) : 0;

  return { models, lane, panel, show, field, progress, TIME };
})();
