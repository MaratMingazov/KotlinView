/*
 * Реквизит диорам, часть 1 — транспорт и грузы: машина вдоль дороги и поперёк (в бокс и из бокса), погрузчик,
 * актёры с маршрутом (общий vehicleActor), деревянный ящик-актёр (груз, который возят машины и погрузчики).
 * Здесь же объявлен IsoObjects — общий объект всего реквизита: остальные файлы iso-*.js дописывают в него свои вещи.
 * Каждый объект рисуется в сцену из iso-scene.js (s — сцена) и сам кладёт туда свои тени и таблички.
 * Смысла (пул, семафор) здесь нет: что и где стоит — решают описания структур (diorama-*.js) через набор (diorama-kit.js).
 * Подключение: после iso-scene.js, первым из iso-*.js (дальше — ground, buildings, nature).
 */
const IsoObjects = {};

(() => {
  const { svg, shade, mix, PALETTE: C, roundedRect } = Iso;

  const carColor = id => C.cars[id % C.cars.length];

  // ---------- Машины ----------

  /**
   * Машина вдоль x, «мордой» к +x: скруглённые кузов и кабина, круглые колёса, фары, у некоторых — багажник на крыше.
   * Возвращает узел — его можно положить в группу здания (машина внутри бокса); car() кладёт её на сцену сама.
   * faded — уже уехавшая: цвет выцветает к песку, а не прозрачностью (иначе видны внутренние грани)
   */
  function carNode(s, x, y, color, { faded = false, rack = false, facing = '+x' } = {}) {
    const g = svg('g'), body = faded ? mix(color, C.sand, 0.45) : color;
    const L = 0.92, W = 0.52;
    // Кабина сдвинута к корме: у машины «мордой» к −x — зеркально (кормой к +x)
    const back = facing === '-x', cab = back ? L - 0.18 - 0.5 : 0.18;
    g.append(s.prism(roundedRect(x, y, L, W, 0.13), 0.1, 0.22, body));
    g.append(s.prism(roundedRect(x + cab, y + 0.07, 0.5, W - 0.14, 0.1), 0.32, 0.14, C.glass));
    g.append(s.prism(roundedRect(x + cab + 0.01, y + 0.08, 0.48, W - 0.16, 0.1), 0.46, 0.04, body));
    if (rack) g.append(s.box(x + cab + 0.09, y + 0.13, 0.5, 0.32, W - 0.26, 0.05, shade(body, -0.35)));
    // Ближние колёса — диски на боку +y; на грани +x — фары («морда») или красные фонари (корма, едет к −x)
    for (const wx of [x + 0.2, x + L - 0.2]) {
      g.append(s.disc(wx, y + W + 0.005, 0.11, 0.1, 'y', C.wheel), s.disc(wx, y + W + 0.01, 0.11, 0.04, 'y', shade(C.wheel, 0.5)));
    }
    for (const wy of [y + 0.13, y + W - 0.13]) g.append(s.disc(x + L + 0.005, wy, 0.22, 0.045, 'x', back ? C.fail : '#fff5c8'));
    return g;
  }

  // label — табличка при наведении { lines, color, bar }; без неё машина просто стоит
  function car(s, x, y, color, options = {}) {
    s.castShadow(x + 0.04, y + 0.04, 0.84, 0.44, 0.45);
    const node = carNode(s, x, y, color, options);
    if (options.label) s.hover(node, s.label(x + 0.46, y + 0.26, 0.62, options.label.lines, options.label));
    s.add(x + y + 0.7, node);
    return node;
  }

  const CAR = { L: 0.92, W: 0.52 }; // длина и ширина машины (клетки)

  /**
   * Машина вдоль y — для въезда в бокс и выезда из него. facing: '-y' — едет от зрителя (к нам задом: видны красные
   * фонари), '+y' — к зрителю (видны фары). Колёса — на ближнем боку +x. Основание: x … x + W, y … y + L
   */
  function carNodeY(s, x, y, color, { faded = false, rack = false, facing = '-y' } = {}) {
    const g = svg('g'), body = faded ? mix(color, C.sand, 0.45) : color, { L, W } = CAR;
    g.append(s.prism(roundedRect(x, y, W, L, 0.13), 0.1, 0.22, body));
    g.append(s.prism(roundedRect(x + 0.07, y + 0.21, W - 0.14, 0.5, 0.1), 0.32, 0.14, C.glass));
    g.append(s.prism(roundedRect(x + 0.08, y + 0.22, W - 0.16, 0.48, 0.1), 0.46, 0.04, body));
    if (rack) g.append(s.box(x + 0.13, y + 0.3, 0.5, W - 0.26, 0.32, 0.05, shade(body, -0.35)));
    for (const wy of [y + 0.2, y + L - 0.2]) {
      g.append(s.disc(x + W + 0.005, wy, 0.11, 0.1, 'x', C.wheel), s.disc(x + W + 0.01, wy, 0.11, 0.04, 'x', shade(C.wheel, 0.5)));
    }
    const light = facing === '+y' ? '#fff5c8' : C.fail;
    for (const wx of [x + 0.13, x + W - 0.13]) g.append(s.disc(wx, y + L + 0.005, 0.22, 0.045, 'y', light));
    return g;
  }

  /**
   * Модель машины для актёра: вокруг начала координат (центр машины — в 0, 0), в ориентации dir:
   * 'x' — вдоль дороги, 'x-' — по дороге назад (развернулась), 'y-' — в бокс, 'y+' — из бокса.
   * Тень и табличка — свои у каждой модели
   */
  function carModel(s, color, dir, { faded, rack, label } = {}) {
    const { L, W } = CAR;
    if (dir === 'x' || dir === 'x-') { car(s, -L / 2, -W / 2, color, { faded, rack, label, facing: dir === 'x-' ? '-x' : '+x' }); return; }
    const x = -W / 2, y = -L / 2;
    s.castShadow(x + 0.04, y + 0.04, W - 0.08, L - 0.08, 0.45);
    const node = carNodeY(s, x, y, color, { faded, rack, facing: dir === 'y+' ? '+y' : '-y' });
    if (label) s.hover(node, s.label(0, 0, 0.62, label.lines, label));
    s.add(x + y + 0.7, node);
  }

  // Плавный разгон и торможение на всём маршруте
  const easeInOut = t => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;

  // Направление перегона → модель машины: по дороге (+x), назад по дороге (−x), в бокс (−y), из бокса (+y)
  const dirOf = (dx, dy) => Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'x-' : 'x') : dy < 0 ? 'y-' : 'y+';

  /**
   * Транспорт-актёр на отрисованной сцене s: четыре модели (dir — 'x', 'x-', 'y-', 'y+'), видна одна. Позиция — центр.
   * build(sc, dir) — нарисовать модель в начале координат. go(points) — проехать через точки [x, y] с постоянной
   * скоростью (speed клеток в секунду), но не быстрее minMs: даже короткий перегон виден глазу. Плавный разгон
   * и торможение. update(now) — на каждом кадре; true — ещё едет.
   * cargo — где лежит груз: { z, ahead } — высота и вынос вперёд по направлению (у погрузчика — на вилах).
   * single — одна модель на все направления (кран на рельсах не разворачивается): build(sc, 'x') строится один раз
   */
  function vehicleActor(s, key, build, { z: cargoZ = 0.5, ahead = 0, single = false } = {}) {
    const DIRS = ['x', 'x-', 'y-', 'y+'];
    const one = single ? s.actor(`${key}~any`, sc => build(sc, 'x')) : null;
    const models = Object.fromEntries(DIRS.map(dir => [dir, one ?? s.actor(`${key}~${dir}`, sc => build(sc, dir))]));
    let dir = null, route = null;
    const pos = { x: 0, y: 0 };

    function moveTo(x, y, d = dir ?? 'x') {
      Object.assign(pos, { x, y });
      if (d !== dir) {
        if (!one) for (const [k, m] of Object.entries(models)) m.show(k === d);
        dir = d;
      }
      models[d].moveTo(x, y);
    }

    function go(points, { speed = 6, minMs = 450, now = performance.now() } = {}) {
      const path = [[pos.x, pos.y], ...points];
      const legs = [];
      let total = 0;
      for (let i = 1; i < path.length; i++) {
        const [x0, y0] = path[i - 1], [x1, y1] = path[i];
        const len = Math.hypot(x1 - x0, y1 - y0);
        if (len < 1e-6) continue;
        legs.push({ x0, y0, x1, y1, len, from: total, dir: dirOf(x1 - x0, y1 - y0), to: i - 1 }); // to — индекс точки в points
        total += len;
      }
      route = legs.length ? { legs, total, start: now, ms: Math.max((total / speed) * 1000, minMs) } : null;
    }

    function update(now = performance.now()) {
      if (!route) return false;
      const k = Math.min((now - route.start) / route.ms, 1);
      const at = easeInOut(k) * route.total;
      const leg = route.legs.find(l => at <= l.from + l.len) ?? route.legs.at(-1);
      const f = Math.min((at - leg.from) / leg.len, 1);
      moveTo(leg.x0 + (leg.x1 - leg.x0) * f, leg.y0 + (leg.y1 - leg.y0) * f, leg.dir);
      if (k >= 1) route = null;
      return route != null;
    }

    function remove() { for (const m of new Set(Object.values(models))) m.remove(); }

    // К какой из точек последнего go(points) актёр едет сейчас (индекс в points); null — стоит
    function heading() {
      if (!route) return null;
      const at = easeInOut(Math.min((performance.now() - route.start) / route.ms, 1)) * route.total;
      return (route.legs.find(l => at <= l.from + l.len) ?? route.legs.at(-1)).to;
    }

    // Точка груза [x, y, z]: над центром или вынесена вперёд по направлению (вилы)
    function cargoPoint() {
      const [dx, dy] = { x: [1, 0], 'x-': [-1, 0], 'y+': [0, 1], 'y-': [0, -1] }[dir];
      return [pos.x + dx * ahead, pos.y + dy * ahead, cargoZ];
    }

    moveTo(0, 0, 'x');
    // cargoZ — высота, на которой лежит груз: набор кладёт туда ящик, который актёр везёт (точка — cargoPoint)
    return { key, pos, moveTo, go, update, remove, heading, cargoPoint, cargoZ, get moving() { return route != null; }, get dir() { return dir; } };
  }

  /** Машина-актёр: груз — на крыше. */
  const carActor = (s, key, color, options = {}) => vehicleActor(s, key, (sc, dir) => carModel(sc, color, dir, options), { z: 0.5 });

  // ---------- Погрузчик ----------

  // Корпус (длина вдоль хода, ширина), вилы: вынос груза от центра и высота, на которой лежит груз
  const FORKLIFT = { L: 0.62, W: 0.48, ahead: 0.56, forkZ: 0.08, cage: '#5b5f66', fork: '#8a8f96', seat: '#3d3f44' };

  /**
   * Погрузчик вокруг начала координат, вилами по направлению dir ('x', 'x-', 'y+', 'y-'): кузов цвета потока,
   * противовес сзади, защитная крыша на стойках, мачта и вилы впереди, колёса на ближнем боку.
   * Части строятся в осях «вперёд u / поперёк v» и переводятся в мир. label — табличка при наведении
   */
  function forkliftModel(s, color, dir, { label } = {}) {
    const { L, W, forkZ, cage, fork, seat } = FORKLIFT;
    const along = dir[0], sign = dir.endsWith('-') ? -1 : 1;
    // Коробка: u — от центра вперёд (du вперёд), v — поперёк от центра (dv в ширину)
    const B = (u, v, z, du, dv, h, col) => {
      const a = sign > 0 ? u : -u - du; // вдоль хода: для «назад» — зеркально
      return along === 'x' ? s.box(a, v, z, du, dv, h, col) : s.box(v, a, z, dv, du, h, col);
    };
    const g = svg('g');
    const body = [
      B(-L / 2, -W / 2, 0.08, L, W, 0.22, color),                              // кузов
      B(-L / 2, -W / 2 + 0.03, 0.08, 0.16, W - 0.06, 0.3, shade(color, -0.25)), // противовес
      B(-0.1, -0.1, 0.3, 0.16, 0.2, 0.08, seat),                                // сиденье
      ...[[-0.24, -W / 2 + 0.02], [-0.24, W / 2 - 0.06], [0.2, -W / 2 + 0.02], [0.2, W / 2 - 0.06]]
        .map(([u, v]) => B(u, v, 0.3, 0.04, 0.04, 0.46, cage)),                  // стойки крыши
      B(-0.26, -W / 2 + 0.01, 0.76, 0.5, W - 0.02, 0.04, cage),                 // крыша
    ];
    const front = [
      B(L / 2, -W / 2 + 0.06, 0.02, 0.05, 0.05, 0.9, cage), B(L / 2, W / 2 - 0.11, 0.02, 0.05, 0.05, 0.9, cage), // мачта
      B(L / 2 + 0.03, -0.15, forkZ - 0.03, 0.46, 0.06, 0.03, fork), B(L / 2 + 0.03, 0.09, forkZ - 0.03, 0.46, 0.06, 0.03, fork), // вилы
    ];
    // Вилы к зрителю (+x, +y) — поверх корпуса; от зрителя — под ним
    g.append(...(sign > 0 ? [...body, ...front] : [...front, ...body]));
    for (const u of [-0.18, 0.18]) {
      g.append(along === 'x'
        ? s.disc(u * sign, W / 2 + 0.01, 0.09, 0.09, 'y', C.wheel)
        : s.disc(W / 2 + 0.01, u * sign, 0.09, 0.09, 'x', C.wheel));
    }
    // Тень — корпус с вилами
    const span = L + 0.5, [sx, sw] = sign > 0 ? [-L / 2, span] : [L / 2 - span, span];
    if (along === 'x') s.castShadow(sx, -W / 2, sw, W, 0.6); else s.castShadow(-W / 2, sx, W, sw, 0.6);
    if (label) s.hover(g, s.label(0, 0, 0.95, label.lines, label));
    // Глубже ящика на вилах впереди (тот — актёр с глубиной своей точки), мельче — сзади
    s.add(0.4, g);
  }

  /** Погрузчик-актёр: груз — на вилах, впереди по ходу (cargoPoint). */
  const forkliftActor = (s, key, color, options = {}) =>
    vehicleActor(s, key, (sc, dir) => forkliftModel(sc, color, dir, options), { z: FORKLIFT.forkZ + 0.01, ahead: FORKLIFT.ahead });

  // ---------- Грузы ----------

  const CRATE = 0.45; // сторона ящика (клетки): крупный, чтобы очередь читалась издалека, и ещё помещается на крыше машины (0.52)

  // Деревянный ящик: доски по граням, на ближних гранях — планки крест-накрест обвязки по краю
  function crateNode(s, x, y, z) {
    const g = svg('g'), a = CRATE, slat = shade(C.wood, -0.28), edge = a * 0.1;
    g.append(s.box(x, y, z, a, a, a, C.wood));
    // Обвязка: планки по краям ближних граней и верха
    g.append(s.panel('y', y + a + 0.003, x, x + a, z + a - edge, z + a, slat), s.panel('y', y + a + 0.003, x, x + a, z, z + edge, slat));
    g.append(s.panel('x', x + a + 0.003, y, y + a, z + a - edge, z + a, shade(slat, -0.1)), s.panel('x', x + a + 0.003, y, y + a, z, z + edge, shade(slat, -0.1)));
    g.append(s.line([x + 0.02, y + a + 0.004, z + edge], [x + a - 0.02, y + a + 0.004, z + a - edge], slat));
    g.append(s.line([x + a + 0.004, y + 0.02, z + edge], [x + a + 0.004, y + a - 0.02, z + a - edge], shade(slat, -0.1)));
    g.append(s.line([x + 0.05, y + a / 2, z + a + 0.001], [x + a - 0.05, y + a / 2, z + a + 0.001], slat));
    return g;
  }

  /**
   * Ящик-актёр: центр основания — в (x, y), низ — на высоте z (на ленте, на крыше машины). Без своей тени: лежит
   * на чём-то, что её уже даёт. Глубина чуть больше, чем у машины в той же точке, — ящик на крыше рисуется поверх.
   * label — табличка при наведении { lines, color }
   */
  function crateActor(s, key, { label } = {}) {
    const a = s.actor(key, sc => {
      const node = crateNode(sc, -CRATE / 2, -CRATE / 2, 0);
      if (label) sc.hover(node, sc.label(0, 0, CRATE + 0.25, label.lines, label));
      sc.add(0.1, node);
    });
    return { key, moveTo: (x, y, z = 0) => a.moveTo(x, y, z), remove: () => a.remove() };
  }

  // vehicleActor — наружу: им строятся и другие актёры с маршрутом (люди — iso-people.js)
  Object.assign(IsoObjects, { CAR, carColor, carNode, car, vehicleActor, carActor, FORKLIFT, forkliftActor, CRATE, crateActor });
})();
