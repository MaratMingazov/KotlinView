/*
 * Набор для диорам: всё, что одинаково у любой структуры. Структура описывает себя одним объектом (Kind) — как
 * построить сцену, какие на ней места, какой снимок взять из плитки и кто где стоит. Остальное делает набор:
 * сеть маршрутов, актёры (появиться на въезде, доехать по сети до своего места, уехать на выезд), панель рядом
 * с плиткой и статичный показ (prototype.html).
 *
 * Смысл и облик разделены: Kind говорит «актёр #12 — в месте slot2, модель car»; как выглядит модель — реестр
 * Kit.models. Заменить машину на погрузчик — новая модель, а не новый режиссёр.
 *
 * Подключение: после iso-scene.js и iso-objects.js, до описаний структур (diorama-*.js). Всё лежит в объекте Kit.
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

  // ---------- Актёры ----------

  const lookOf = spec => JSON.stringify([spec.model ?? 'car', spec.color, spec.look ?? null]);

  /**
   * Актёры одной сцены. sync(specs) — каждому его место: новый появляется на въезде (или сразу на месте, если instant),
   * у кого место сменилось — едет по сети от ближайшего места впереди, пропавший из specs — едет на выезд и исчезает.
   * tick(now) — кадр; true — кто-то ещё едет
   */
  function cast(s, layout) {
    const net = network(layout);
    const actors = new Map(); // ключ → { actor, look, place, route: [имена мест] | null, leaving }

    function create(spec) {
      const make = models[spec.model ?? 'car'];
      if (!make) throw new Error(`Kit: нет модели «${spec.model}»`);
      return make(s, `${spec.model ?? 'car'}-${spec.key}`, spec);
    }

    // Где актёр «логически»: место, к которому едет сейчас, или где стоит
    function anchorOf(entry) {
      const i = entry.actor.heading();
      return i != null && entry.route ? entry.route[i] : entry.place;
    }

    function drive(entry, target, now) {
      const from = anchorOf(entry);
      const path = shortestPath(net, from, target);
      if (!path) throw new Error(`Kit: нет пути ${from} → ${target}`);
      entry.route = path;
      entry.place = target;
      entry.actor.go(path.map(name => net.places[name]), { now });
    }

    function place(entry, name) {
      entry.actor.moveTo(...net.places[name], 'x');
      Object.assign(entry, { place: name, route: null });
    }

    /**
     * Группа мест («spot*»): каждому актёру — свободное место группы, и пока он в группе — то же самое
     * (соседний уехал — остальные не перескакивают). Сначала оставить тем, кто уже стоит в группе, потом раздать новым
     */
    function resolveGroups(specs) {
      const groups = specs.filter(spec => spec.place.endsWith('*'));
      if (!groups.length) return specs;
      const taken = new Set(), chosen = new Map();
      const inGroup = (place, prefix) => place?.startsWith(prefix) && /^\d+$/.test(place.slice(prefix.length));
      for (const spec of groups) {
        const prefix = spec.place.slice(0, -1), current = actors.get(spec.key)?.place;
        if (!actors.get(spec.key)?.leaving && inGroup(current, prefix) && !taken.has(current)) { taken.add(current); chosen.set(spec.key, current); }
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
        // Облик сменился — пересоздать на том же месте (табличка — новая, от нового spec)
        if (entry && entry.look !== lookOf(spec)) {
          const { x, y } = entry.actor.pos;
          entry.actor.remove();
          entry.actor = create(spec);
          entry.actor.moveTo(x, y, 'x');
          entry.look = lookOf(spec);
        }
        if (!entry) {
          entry = { actor: create(spec), look: lookOf(spec), place: null, route: null, leaving: false };
          actors.set(spec.key, entry);
          place(entry, instant ? spec.place : layout.entry);
        }
        if (instant) { place(entry, spec.place); entry.leaving = false; continue; }
        if (entry.leaving || entry.place !== spec.place) { entry.leaving = false; drive(entry, spec.place, now); }
      }
      for (const [key, entry] of actors) {
        if (wanted.has(key) || entry.leaving) continue;
        entry.leaving = true;
        drive(entry, layout.exit, now);
      }
    }

    function tick(now) {
      let moving = false;
      for (const [key, entry] of actors) {
        const still = entry.actor.update(now);
        if (!still && entry.leaving) { entry.actor.remove(); actors.delete(key); continue; }
        moving ||= still;
      }
      return moving;
    }

    return { sync, tick, get size() { return actors.size; } };
  }

  // ---------- Сцена структуры ----------

  // Построить сцену по форме: неподвижное — один раз, актёры — потом, через sync
  function stage(kind, shape) {
    const s = Iso.createScene({ uid: kind.uid });
    const layout = kind.layout(s, shape);
    const root = s.render();
    return { s, layout, root, actors: cast(s, layout) };
  }

  /** Статичный показ (prototype.html): сцена по снимку, актёры сразу на своих местах, без анимации. */
  function show(kind, snapshot, shape) {
    const st = stage(kind, shape);
    st.layout.update?.(snapshot);
    st.actors.sync(kind.actorsOf(snapshot, shape), { instant: true });
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

    const loop = now => { frame = st?.actors.tick(now) ? requestAnimationFrame(loop) : null; };

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

  return { models, lane, panel, show, field, progress };
})();
