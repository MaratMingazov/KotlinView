/*
 * Реквизит диорам, часть 1 — машины: модель вдоль дороги и поперёк (в бокс и из бокса), машина-актёр с маршрутом.
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
  function carNode(s, x, y, color, { faded = false, rack = false } = {}) {
    const g = svg('g'), body = faded ? mix(color, C.sand, 0.45) : color;
    const L = 0.92, W = 0.52;
    g.append(s.prism(roundedRect(x, y, L, W, 0.13), 0.1, 0.22, body));
    g.append(s.prism(roundedRect(x + 0.18, y + 0.07, 0.5, W - 0.14, 0.1), 0.32, 0.14, C.glass));
    g.append(s.prism(roundedRect(x + 0.19, y + 0.08, 0.48, W - 0.16, 0.1), 0.46, 0.04, body));
    if (rack) g.append(s.box(x + 0.27, y + 0.13, 0.5, 0.32, W - 0.26, 0.05, shade(body, -0.35)));
    // Ближние колёса — диски на боку +y; фары — на «морде» +x
    for (const wx of [x + 0.2, x + L - 0.2]) {
      g.append(s.disc(wx, y + W + 0.005, 0.11, 0.1, 'y', C.wheel), s.disc(wx, y + W + 0.01, 0.11, 0.04, 'y', shade(C.wheel, 0.5)));
    }
    for (const wy of [y + 0.13, y + W - 0.13]) g.append(s.disc(x + L + 0.005, wy, 0.22, 0.045, 'x', '#fff5c8'));
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
   * 'x' — вдоль дороги, 'y-' — в бокс, 'y+' — из бокса. Тень и табличка — свои у каждой модели
   */
  function carModel(s, color, dir, { faded, rack, label } = {}) {
    const { L, W } = CAR;
    if (dir === 'x') { car(s, -L / 2, -W / 2, color, { faded, rack, label }); return; }
    const x = -W / 2, y = -L / 2;
    s.castShadow(x + 0.04, y + 0.04, W - 0.08, L - 0.08, 0.45);
    const node = carNodeY(s, x, y, color, { faded, rack, facing: dir === 'y+' ? '+y' : '-y' });
    if (label) s.hover(node, s.label(0, 0, 0.62, label.lines, label));
    s.add(x + y + 0.7, node);
  }

  // Плавный разгон и торможение на всём маршруте
  const easeInOut = t => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;

  // Направление перегона → модель машины: по дороге (+x), в бокс (−y), из бокса (+y)
  const dirOf = (dx, dy) => Math.abs(dx) >= Math.abs(dy) ? 'x' : dy < 0 ? 'y-' : 'y+';

  /**
   * Машина-актёр на отрисованной сцене s: три модели (dir), видна одна. Позиция — центр машины.
   * go(points) — проехать через точки [x, y] с постоянной скоростью (speed клеток в секунду), но не быстрее minMs:
   * даже короткий перегон виден глазу. Плавный разгон и торможение. update(now) — на каждом кадре; true — ещё едет
   */
  function carActor(s, key, color, options = {}) {
    const models = Object.fromEntries(['x', 'y-', 'y+'].map(dir => [dir, s.actor(`${key}~${dir}`, sc => carModel(sc, color, dir, options))]));
    let dir = null, route = null;
    const pos = { x: 0, y: 0 };

    function moveTo(x, y, d = dir ?? 'x') {
      Object.assign(pos, { x, y });
      if (d !== dir) {
        for (const [k, m] of Object.entries(models)) m.show(k === d);
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

    function remove() { for (const m of Object.values(models)) m.remove(); }

    // К какой из точек последнего go(points) машина едет сейчас (индекс в points); null — стоит
    function heading() {
      if (!route) return null;
      const at = easeInOut(Math.min((performance.now() - route.start) / route.ms, 1)) * route.total;
      return (route.legs.find(l => at <= l.from + l.len) ?? route.legs.at(-1)).to;
    }

    moveTo(0, 0, 'x');
    return { key, pos, moveTo, go, update, remove, heading, get moving() { return route != null; }, get dir() { return dir; } };
  }

  Object.assign(IsoObjects, { CAR, carColor, carNode, car, carActor });
})();
