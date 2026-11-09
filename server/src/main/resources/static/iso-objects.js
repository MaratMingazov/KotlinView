/*
 * Объекты диорам: остров, дорога и разметка, машины, автомойка, домик, шлагбаум со светофором, растения и мелочи.
 * Каждый объект рисуется в сцену из iso-scene.js (s — сцена) и сам кладёт туда свои тени и таблички.
 * Смысла (пул, семафор) здесь нет: что и где стоит — решают описания структур (diorama-*.js) через набор (diorama-kit.js).
 * Подключение: после iso-scene.js. Всё лежит в объекте IsoObjects.
 */
const IsoObjects = (() => {
  const { svg, shade, mix, threadColor, PALETTE: C, inside, blob, scaled, roundedRect, rng } = Iso;

  const carColor = id => C.cars[id % C.cars.length];
  const FREE_BAY = '#d8cfbf'; // маркиза свободного бокса: потока ещё нет — цвета у него тоже нет

  // ---------- Остров ----------

  /**
   * Остров по прямоугольнику (x0, y0) – (x1, y1): мелководье и пена вокруг, береговой склон (видны только грани
   * к зрителю), песчаный пляж, трава, камни у кромки, лодки. Контур травы — «суша» сцены: растения ставятся только на неё
   */
  function island(s, x0, y0, x1, y1, seed = 1) {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2 + 0.4, ry = (y1 - y0) / 2 + 0.6, DEPTH = 0.45;
    const shore = blob(cx, cy, rx, ry, seed);
    const flatPoly = (poly, z, style) => svg('polygon', { points: s.pts(poly.map(([x, y]) => [x, y, z])), style });

    // Мелководье — светлое пятно чуть шире острова, по нему — белая кромка пены
    s.ground.push(flatPoly(scaled(shore, cx, cy, 1.09), -DEPTH, `fill: ${C.shallow}; opacity: .85`));
    s.ground.push(flatPoly(scaled(shore, cx, cy, 1.025), -DEPTH, 'fill: none; stroke: #ffffff; stroke-width: 3; opacity: .7; stroke-linejoin: round'));

    // Склон: участок берега виден, если его внешняя нормаль смотрит к зрителю (+x или +y); оттенок — по направлению
    const sides = [];
    for (let i = 0; i < shore.length; i++) {
      const [xa, ya] = shore[i], [xb, yb] = shore[(i + 1) % shore.length];
      const mx = (xa + xb) / 2, my = (ya + yb) / 2;
      const nx = (mx - cx) / (rx * rx), ny = (my - cy) / (ry * ry);
      if (nx + ny <= 0) continue;
      const t = Math.max(0, nx) / (Math.max(0, nx) + Math.max(0, ny) || 1);
      const color = shade(C.cliff, -0.12 - 0.22 * t);
      sides.push({ depth: mx + my, node: svg('polygon', {
        points: s.pts([[xa, ya, -DEPTH], [xb, yb, -DEPTH], [xb, yb, 0], [xa, ya, 0]]),
        style: `fill: ${color}; stroke: ${color}; stroke-width: .8; stroke-linejoin: round` }) });
    }
    s.ground.push(...sides.sort((a, b) => a.depth - b.depth).map(o => o.node));

    // Пляж и трава: трава — тот же контур, чуть меньше; между ними — полоска песка
    s.ground.push(flatPoly(shore, 0, `fill: ${C.sand}; stroke: ${C.sand}; stroke-width: 1`));
    s.ground.push(flatPoly(scaled(shore, cx, cy, 0.93), 0, `fill: ${C.grass}; stroke: ${shade(C.grass, -0.08)}; stroke-width: 1.5`));
    s.setLand(scaled(shore, cx, cy, 0.88));
    s.shore = shore;          // по нему дорога решает, где кончается суша и начинается мост
    s.shoreCenter = [cx, cy]; // от него пальмы отступают от кромки внутрь

    // Камни у кромки: по берегу через неравные промежутки
    for (const a of [0.35, 0.9, 1.3, 2.45, 2.8, 4.1, 5.6]) {
      const i = Math.round((a / (Math.PI * 2)) * shore.length) % shore.length;
      const [x, y] = scaled([shore[i]], cx, cy, 1.03)[0];
      rock(s, x, y, -DEPTH + 0.02, (0.18 + ((i * 7) % 5) * 0.04) * 0.75);
    }

    // Лодки: корпус, мачта, парус — у дальнего и ближнего берега
    for (const [bx, by, color] of [[cx - rx * 0.55, cy - ry - 0.9, C.cars[1]], [cx + rx * 0.62, cy + ry + 0.7, C.cars[0]]]) {
      const g = svg('g');
      g.append(s.box(bx, by, -DEPTH - 0.05, 1.0, 0.42, 0.2, color), s.box(bx + 0.1, by + 0.06, -DEPTH + 0.15, 0.8, 0.3, 0.04, C.boat));
      g.append(s.box(bx + 0.46, by + 0.17, -DEPTH + 0.15, 0.05, 0.05, 0.9, C.wood));
      const [mx, my] = s.P(bx + 0.48, by + 0.19, -DEPTH + 1.0), [fx, fy] = s.P(bx + 0.48, by + 0.19, -DEPTH + 0.25);
      g.append(svg('polygon', { points: `${mx},${my} ${fx},${fy} ${fx + 18},${fy - 4}`, style: `fill: ${C.boat}; stroke: ${shade(C.boat, -0.1)}; stroke-width: 1` }));
      s.shadow(bx + 0.5, by + 0.2, 0.55, 0.25, -0.45);
      s.add(bx + by, g);
    }
  }

  // Камень: призма с неровным основанием, верх светлее — как обкатанный булыжник
  function rock(s, x, y, z, size) {
    s.add(x + y - 0.5, s.prism(blob(x, y, size, size * 0.8, x * 3 + y, 9), z, size * 0.7, C.rock));
  }

  // ---------- Дорога и разметка ----------

  /**
   * Дорога вдоль x по полосе y0 – y1: полотно, светлая полоса износа у краёв, бордюры-бортики (у них есть высота —
   * дорога «утоплена»), пунктир посередине. По острову — только по суше: за берегом продолжается деревянным мостом.
   * skip — [от, до] по x без пунктира (места очереди размечены рамками — пунктир сквозь них лишний)
   */
  function road(s, x0, x1, { y0 = 0, y1 = 1.2, skip = null } = {}) {
    const mid = (y0 + y1) / 2, onShore = x => inside(s.shore, x, mid);
    // Край суши: от конца дороги идём к острову, пока не окажемся на берегу
    const edge = (from, step) => { let x = from; while (!onShore(x) && Math.abs(x - from) < 30) x += step; return x; };
    const xl = onShore(x0) ? x0 : edge(x0, 0.05), xr = onShore(x1) ? x1 : edge(x1, -0.05);
    if (xl > x0) bridge(s, x0, xl + 0.3, y0, y1);
    if (xr < x1) bridge(s, xr - 0.3, x1, y0, y1);
    x0 = xl; x1 = xr;

    s.ground.push(s.flat(x0, y0, x1 - x0, y1 - y0, C.road));
    s.ground.push(s.flat(x0, y0, x1 - x0, 0.1, shade(C.road, 0.12)), s.flat(x0, y1 - 0.1, x1 - x0, 0.1, shade(C.road, 0.12)));
    s.ground.push(s.box(x0, y0 - 0.14, 0, x1 - x0, 0.14, 0.06, C.curb), s.box(x0, y1, 0, x1 - x0, 0.14, 0.06, C.curb));
    for (let x = x0 + 0.3; x < x1 - 0.4; x += 0.9) {
      if (skip && x + 0.45 > skip[0] && x < skip[1]) continue;
      const [a, b] = [s.P(x, mid, 0), s.P(x + 0.45, mid, 0)];
      s.ground.push(svg('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], style: `stroke: ${C.roadMark}; stroke-width: 2.2; stroke-linecap: round` }));
    }
  }

  // Мост над водой: сваи, настил из досок поперёк, перила по краям
  function bridge(s, x0, x1, y0, y1) {
    const deck = -0.08, g = svg('g');
    for (let x = x0; x < x1; x += 1.5) {
      g.append(s.box(x + 0.2, y0 - 0.1, -0.45, 0.12, 0.12, 0.4, shade(C.wood, -0.25)), s.box(x + 0.2, y1 - 0.02, -0.45, 0.12, 0.12, 0.4, shade(C.wood, -0.25)));
    }
    g.append(s.box(x0, y0 - 0.15, deck, x1 - x0, y1 - y0 + 0.3, 0.1, C.wood));
    for (let x = x0 + 0.15; x < x1; x += 0.3) g.append(s.line([x, y0 - 0.15, deck + 0.1], [x, y1 + 0.15, deck + 0.1], shade(C.wood, -0.18)));
    g.append(s.box(x0, y0 - 0.15, deck + 0.1, x1 - x0, 0.06, 0.22, shade(C.wood, -0.08)));
    s.ground.push(g);
    // Ближние перила — объектом: машины на мосту должны быть за ними. Глубина — по дальнему концу:
    // по ближнему машина у середины моста оказывалась «глубже» и рисовалась поверх перил
    s.add(x1 + y1 + 0.2, s.box(x0, y1 + 0.09, deck + 0.1, x1 - x0, 0.06, 0.22, shade(C.wood, -0.08)));
  }

  // «Зебра»: полосы вдоль движения, через всю ширину дороги
  function zebra(s, x, y0 = 0, y1 = 1.2) {
    for (let y = y0 + 0.08; y < y1 - 0.1; y += 0.22) s.ground.push(s.flat(x, y, 0.55, 0.12, C.roadMark));
  }

  // Стоп-линия поперёк полосы: здесь машины ждут, пока поднимут шлагбаум
  function stopLine(s, x, y0 = 0, y1 = 1.2) {
    s.ground.push(s.flat(x, y0 + 0.05, 0.1, y1 - y0 - 0.1, C.roadMark));
  }

  // Место на дороге (ячейка очереди): белая рамка разметкой
  function slot(s, x, y) {
    s.ground.push(svg('polygon', { points: s.pts([[x, y, 0], [x + 1.05, y, 0], [x + 1.05, y + 0.9, 0], [x, y + 0.9, 0]]),
      style: `fill: none; stroke: ${C.roadMark}; stroke-width: 1.6; opacity: .9; stroke-linejoin: round` }));
  }

  // Площадка, выложенная плиткой: основа и швы сеткой
  function paved(s, x0, y0, x1, y1) {
    s.ground.push(s.flat(x0, y0, x1 - x0, y1 - y0, C.pad));
    const seam = shade(C.pad, -0.07);
    for (let x = x0 + 0.5; x < x1; x += 0.5) s.ground.push(s.line([x, y0, 0], [x, y1, 0], seam));
    for (let y = y0 + 0.5; y < y1; y += 0.5) s.ground.push(s.line([x0, y, 0], [x1, y, 0], seam));
  }

  // Столбик со счётчиком у дороги: короткий, виден всегда («3 / 5», «✓ 17»)
  function sign(s, x, y, text, color) {
    s.castShadow(x, y, 0.08, 0.08, 0.9);
    s.add(x + y + 0.2, s.box(x, y, 0, 0.08, 0.08, 0.9, C.post));
    return s.label(x + 0.04, y + 0.04, 0.95, [text], { color, permanent: true });
  }

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
   * Соглашение «остров с дорогой» — общее для всех сцен: дорога вдоль x по полосе y = 0…1.2, концы — за мостами.
   * laneY — край машины на полосе (как в car()), lane — центр машины на полосе (так стоят актёры), ends — концы дороги
   */
  const ROAD = { laneY: 0.35, lane: 0.35 + CAR.W / 2, ends: [-6.3, 16.3] };

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

  // ---------- Постройки ----------

  /**
   * Автомойка: одно здание с воротами на каждый бокс, двускатная крыша, над воротами полосатые маркизы цветом потока,
   * над крышей — пузыри. Здание — два объекта разной глубины, чтобы машина в боксе (в том числе едущая, актёр)
   * вставала между ними: «зад» (пол, задняя стена, перегородки) → машины → «перёд» (простенки и перемычка, торец,
   * крыша, маркизы). workers — [{ name, task }]: name = null — свободный бокс (потока ещё нет: пул создаёт их лениво),
   * маркиза нейтральная; task = null — воркер есть, но ждёт задачу (бокс пуст). labelOf(worker) — табличка бокса
   * { lines, color, bar }: одна на машину и маркизу.
   * Возвращает геометрию боксов (ворота, место машины) и paintBay — перекрасить маркизу и табличку на живой сцене
   */
  function washHouse(s, x0, y0, workers, labelOf) {
    const BAY = 1.85, D = 1.9, H = 1.25, GATE = 0.95, T = 0.12;
    const W = workers.length * BAY + T, yf = y0 + D;
    const carX = i => x0 + i * BAY + (BAY - CAR.L) / 2 + T / 2, carY = yf - 0.85; // машина — ближе к воротам

    // Зад. Внутри темнее, чем снаружи: так проёмы ворот читаются как проёмы
    const back = svg('g');
    back.append(s.box(x0, y0, 0, W, D, 0.04, shade(C.pad, -0.25)));
    back.append(s.box(x0, y0, 0, W, T, H, shade(C.building, -0.3)));
    for (let i = 0; i <= workers.length; i++) back.append(s.box(x0 + i * BAY, y0, 0, T, D - T, H, shade(C.building, -0.2)));
    s.add(x0 + y0, back);

    // Машины в боксах (снимок) — между задом и передом, как и машины-актёры
    const bayLabels = workers.map((w, i) => { const l = labelOf(w); return s.label(x0 + i * BAY + BAY / 2, yf + 0.15, H, l.lines, l); });
    workers.forEach((w, i) => {
      if (w.task) s.add(carX(i) + carY + 0.7, s.hover(carNode(s, carX(i), carY, carColor(w.task.id)), bayLabels[i]));
    });

    // Перёд: перемычка над воротами, простенки между ними, торец с окошком, крыша
    const front = svg('g');
    front.append(s.box(x0, yf - T, GATE, W, T, H - GATE, C.building));
    for (let i = 0; i <= workers.length; i++) front.append(s.box(x0 + i * BAY, yf - T, 0, T, T, GATE, C.building));
    front.append(s.box(x0 + W - T, y0, 0, T, D, H, C.building));
    front.append(s.panel('x', x0 + W + 0.003, y0 + 0.6, y0 + 1.3, 0.45, 0.85, C.glass));
    front.append(s.gableRoof(x0, y0, W, D, H, 0.4, C.roof, 0.1));
    // Маркизы: короткая наклонная полосатая ткань на перемычке, выше проёма — ворота не закрывает.
    // Полосы — цвет потока и белый: какой бокс чей, видно издалека
    const stripeStyle = (color, k) => `fill: ${k % 2 ? '#fffaf0' : color}; stroke: ${shade(color, -0.2)}; stroke-width: .5`;
    const awnings = workers.map((w, i) => {
      const color = w.name ? threadColor(w.name) : FREE_BAY, a0 = x0 + i * BAY + T, a1 = a0 + BAY - T, n = 6;
      const top = H - 0.02, low = H - 0.17, out = 0.3, awning = svg('g');
      for (let k = 0; k < n; k++) {
        const u0 = a0 + (a1 - a0) * (k / n), u1 = a0 + (a1 - a0) * ((k + 1) / n);
        awning.append(svg('polygon', { points: s.pts([[u0, yf, top], [u1, yf, top], [u1, yf + out, low], [u0, yf + out, low]]), style: stripeStyle(color, k) }));
      }
      front.append(s.hover(awning, bayLabels[i]));
      return awning;
    });
    // Пузыри над крышей — «тут моют»
    for (const [bx, bz, r] of [[0.25, 0.3, 5], [0.55, 0.55, 3.5], [0.75, 0.25, 4], [0.4, 0.8, 2.5]]) {
      const [sx, sy] = s.P(x0 + W * bx, y0 + D / 2, H + 0.5 + bz);
      front.append(svg('circle', { cx: sx, cy: sy, r, style: 'fill: #ffffff; opacity: .75; stroke: #bfe3f2; stroke-width: 1' }));
    }
    // Тень — по солнцу, вправо за торец: эллипс под центром ложился тёмным пятном на дорогу
    s.castShadow(x0, y0, W, D, H + 0.25);
    s.add(x0 + y0 + W + D, front);

    return {
      width: W,
      bayCenter: i => [x0 + i * BAY + BAY / 2, yf],              // середина ворот бокса i
      parkAt: i => [carX(i) + CAR.L / 2, carY + CAR.W / 2],      // центр машины в боксе i
      // Живая сцена: поток в боксе сменился (или появился) — перекрасить маркизу, поменять табличку
      paintBay(i, worker) {
        const color = worker.name ? threadColor(worker.name) : FREE_BAY;
        [...awnings[i].children].forEach((stripe, k) => stripe.setAttribute('style', stripeStyle(color, k)));
        const l = labelOf(worker);
        s.relabel(bayLabels[i], l.lines, { color: l.color, bar: l.bar });
      },
    };
  }

  // Домик: стены, дверь и окна на ближних гранях, двускатная крыша. label — табличка при наведении
  function house(s, x, y, w, d, h, label) {
    const g = svg('g');
    g.append(s.box(x, y, 0, w, d, h, C.building));
    g.append(s.panel('y', y + d + 0.003, x + w / 2 - 0.2, x + w / 2 + 0.2, 0, 0.62, shade(C.wood, -0.1)));
    for (const wx of [x + 0.35, x + w - 0.75]) g.append(s.panel('y', y + d + 0.003, wx, wx + 0.4, 0.4, 0.75, C.glass));
    g.append(s.panel('x', x + w + 0.003, y + d / 2 - 0.25, y + d / 2 + 0.25, 0.4, 0.75, C.glass));
    g.append(s.gableRoof(x, y, w, d, h, 0.55, C.roof));
    s.castShadow(x, y, w, d, h + 0.35);
    const l = label ? s.label(x + w / 2, y + d / 2, h + 0.6, label.lines, label) : null;
    if (l) s.hover(g, l);
    // Глубина — по середине: машины перед домиком (больше y) рисуются поверх
    s.add(x + y + w / 2 + d / 2, g);
    return l; // живая сцена меняет текст таблички на месте
  }

  // ---------- Шлагбаум и светофор ----------

  // Шлагбаум у ближнего края дороги: стойка и полосатая стрела поперёк полосы, опущенная
  function barrierGate(s, x) {
    s.castShadow(x - 0.05, 1.3, 0.2, 0.2, 0.62);
    s.add(x + 1.5, s.box(x - 0.05, 1.3, 0, 0.2, 0.2, 0.62, C.post));
    const arm = svg('g');
    for (let i = 0; i < 6; i++) arm.append(s.box(x, 1.3 - (i + 1) * 0.22, 0.52, 0.08, 0.22, 0.08, i % 2 ? '#f2f2f2' : '#d64545'));
    s.add(x + 0.6, arm);
  }

  /**
   * Светофор у дальнего края дороги: горит красный или зелёный (free), второй погашен.
   * counter — короткий счётчик, виден всегда; details — табличка при наведении { lines }
   */
  function trafficLight(s, x, { free, counter, details }) {
    const light = svg('g');
    s.castShadow(x - 0.3, -0.6, 0.08, 0.08, 1.9);
    light.append(s.box(x - 0.3, -0.6, 0, 0.08, 0.08, 1.3, '#4a4a4a'), s.box(x - 0.38, -0.66, 1.3, 0.24, 0.2, 0.6, '#2b2b2b'));
    // Лампа: свечение и ядро; горит — свечение видно и ядро яркое, погашена — только тусклое ядро
    const lamp = (z, color) => {
      const [cx, cy] = s.P(x - 0.26, -0.46, z);
      const glow = svg('circle', { cx, cy, r: 9, style: `fill: ${color}; opacity: .35` });
      const core = svg('circle', { cx, cy, r: 5, style: `fill: ${color}` });
      light.append(glow, core);
      return on => { glow.style.display = on ? '' : 'none'; core.style.opacity = on ? 1 : 0.25; };
    };
    const red = lamp(1.75, C.fail), green = lamp(1.5, C.ok);
    const color = free ? C.ok : C.fail;
    const counterLabel = s.label(x - 0.26, -0.56, 2.05, [counter], { color, permanent: true });
    const detailsLabel = s.label(x - 0.26, -0.56, 2.05, details, { color });
    s.hover(light, detailsLabel);
    s.add(x - 1, light);
    // Живая сцена: переключить лампы и обновить числа на месте
    const set = (isFree, counterText, detailLines) => {
      red(!isFree); green(isFree);
      const c = isFree ? C.ok : C.fail;
      s.relabel(counterLabel, [counterText], { color: c });
      s.relabel(detailsLabel, detailLines, { color: c });
    };
    red(!free); green(free);
    return { set };
  }

  // ---------- Площадка: скамейка, фонарь, штакетник ----------

  // Скамейка: ножки, сиденье, спинка
  function bench(s, x, y) {
    const g = svg('g');
    for (const lx of [x + 0.05, x + 0.55]) g.append(s.box(lx, y + 0.05, 0, 0.05, 0.22, 0.18, shade(C.wood, -0.3)));
    g.append(s.box(x, y, 0.18, 0.65, 0.3, 0.05, C.wood), s.box(x, y, 0.23, 0.65, 0.05, 0.22, C.wood));
    s.castShadow(x, y, 0.65, 0.3, 0.4);
    s.add(x + y + 0.4, g);
  }

  // Фонарь: столб и тёплый шар со свечением
  function streetLamp(s, x, y) {
    const g = svg('g');
    g.append(s.box(x, y, 0, 0.06, 0.06, 1.1, '#5b5f66'));
    const [cx, cy] = s.P(x + 0.03, y + 0.03, 1.2);
    g.append(svg('circle', { cx, cy, r: 9, style: 'fill: #ffe9a8; opacity: .3' }), svg('circle', { cx, cy, r: 4.5, style: 'fill: #fff3c4' }));
    s.castShadow(x, y, 0.06, 0.06, 1.2);
    s.add(x + y + 0.1, g);
  }

  // Штакетник вдоль x или y: столбики-рейки и две перекладины
  function picket(s, x0, y0, len, along) {
    const g = svg('g'), step = 0.22, rail = shade(C.wood, -0.1);
    const at = t => along === 'x' ? [x0 + t, y0] : [x0, y0 + t];
    const bar = z => along === 'x' ? s.box(x0, y0, z, len, 0.03, 0.04, rail) : s.box(x0, y0, z, 0.03, len, 0.04, rail);
    g.append(bar(0.1));
    for (let t = 0; t <= len; t += step) { const [px, py] = at(t); g.append(s.box(px, py, 0, 0.06, 0.06, 0.36, C.wood)); }
    g.append(bar(0.24));
    s.add(x0 + y0 + (along === 'x' ? 0 : len / 2), g);
  }

  // ---------- Растительность ----------

  // Дерево: kind — 'round' (лиственное), 'cone' (ёлка), 'palm'; scale — размер; crown — оттенок зелени
  function plant(s, x, y, { kind = 'round', scale = 1, crown = C.greens[0] } = {}) {
    const g = svg('g');
    if (kind === 'palm') {
      // Ствол — изогнутая цепочка колец, наверху веер листьев
      const base = s.P(x, y, 0), top = s.P(x + 0.25 * scale, y - 0.05, 1.5 * scale);
      const mid = [(base[0] + top[0]) / 2 - 6 * scale, (base[1] + top[1]) / 2];
      const trunk = `M ${base[0]} ${base[1]} Q ${mid[0]} ${mid[1]} ${top[0]} ${top[1]}`;
      g.append(svg('path', { d: trunk, style: `fill: none; stroke: ${C.trunk}; stroke-width: ${5 * scale}; stroke-linecap: round` }));
      g.append(svg('path', { d: trunk, style: `fill: none; stroke: ${shade(C.trunk, 0.25)}; stroke-width: ${5 * scale}; stroke-dasharray: 2 4` }));
      for (const a of [-160, -120, -60, -20, 30, 150]) {
        const r = (a * Math.PI) / 180, len = 17 * scale;
        const ex = top[0] + Math.cos(r) * len, ey = top[1] + Math.sin(r) * len * 0.6 + 5 * scale;
        g.append(svg('path', { d: `M ${top[0]} ${top[1]} Q ${(top[0] + ex) / 2} ${Math.min(top[1], ey) - 7 * scale} ${ex} ${ey}`,
          style: `fill: none; stroke: ${a > 0 ? shade(crown, -0.15) : crown}; stroke-width: ${4.5 * scale}; stroke-linecap: round` }));
      }
      s.shadow(x + 0.2, y, 0.35 * scale, 0.6);
    } else if (kind === 'cone') {
      // Ёлка: ствол и три яруса; левая половина ярусов светлее — свет слева
      g.append(s.box(x, y, 0, 0.1, 0.1, 0.25 * scale, C.trunk));
      const [cx, cy] = s.P(x + 0.05, y + 0.05, 0.2 * scale);
      for (let i = 0; i < 3; i++) {
        const w = (15 - i * 3.5) * scale, by = cy - i * 10 * scale, ty = by - 18 * scale;
        g.append(svg('polygon', { points: `${cx - w},${by} ${cx},${by + 3 * scale} ${cx},${ty}`, style: `fill: ${shade(crown, 0.08)}` }),
                 svg('polygon', { points: `${cx},${by + 3 * scale} ${cx + w},${by} ${cx},${ty}`, style: `fill: ${shade(crown, -0.15)}` }));
      }
      s.shadow(x + 0.05, y + 0.05, 0.36 * scale, 0.5);
    } else {
      // Лиственное: ствол и крона из трёх кругов — основа, тень снизу справа, блик сверху слева
      g.append(s.box(x, y, 0, 0.14 * scale, 0.14 * scale, 0.4 * scale, C.trunk));
      const [cx, cy] = s.P(x + 0.07 * scale, y + 0.07 * scale, 0.85 * scale);
      const r = 14 * scale;
      g.append(svg('circle', { cx, cy, r, style: `fill: ${crown}` }),
               svg('circle', { cx: cx + r * 0.25, cy: cy + r * 0.2, r: r * 0.75, style: `fill: ${shade(crown, -0.1)}; opacity: .5` }),
               svg('circle', { cx: cx - r * 0.3, cy: cy - r * 0.35, r: r * 0.42, style: `fill: ${shade(crown, 0.3)}` }));
      // Тень кроны — вплотную к стволу: при сдвиге на полную высоту кроны пятно отрывалось от дерева
      s.shadow(x + 0.07, y + 0.07, 0.46 * scale, 0.45 * scale);
    }
    s.contact(x, y, 0.12, 0.12);
    s.add(x + y + 0.3, g);
  }

  // Куст: несколько кругов, у верхнего — блик
  function bush(s, x, y, green, scale = 1) {
    const g = svg('g'), [cx, cy] = s.P(x, y, 0.15);
    for (const [dx, dy, r] of [[-5, 2, 6], [5, 2, 6], [0, -3, 7]]) g.append(svg('circle', { cx: cx + dx * scale, cy: cy + dy * scale, r: r * scale, style: `fill: ${shade(green, dy < 0 ? 0 : -0.1)}` }));
    g.append(svg('circle', { cx: cx - 2 * scale, cy: cy - 6 * scale, r: 2.5 * scale, style: `fill: ${shade(green, 0.35)}` }));
    s.shadow(x, y, 0.3 * scale, 0.2);
    s.add(x + y, g);
  }

  // Клумба: россыпь цветных точек; трава — пучок коротких штрихов. Плоские — в слой земли
  function flowers(s, x, y, r) {
    const [cx, cy] = s.P(x, y, 0);
    for (let i = 0; i < 6; i++) {
      const a = r() * Math.PI * 2, d = r() * 7;
      s.ground.push(svg('circle', { cx: cx + Math.cos(a) * d, cy: cy + Math.sin(a) * d * 0.5, r: 1.9, style: `fill: ${C.flowers[Math.floor(r() * C.flowers.length)]}` }));
    }
  }
  function tuft(s, x, y) {
    const [cx, cy] = s.P(x, y, 0);
    s.ground.push(svg('path', { d: `M ${cx - 3} ${cy} l -1 -5 M ${cx} ${cy} l 0 -7 M ${cx + 3} ${cy} l 1.5 -5`,
      style: `fill: none; stroke: ${shade(C.grass, -0.22)}; stroke-width: 1.2; stroke-linecap: round` }));
  }

  /**
   * Разбросать растительность по суше, обходя запретные зоны keepOut: [x0, y0, x1, y1] (дорога, здания, площадка).
   * Пальмы — вдоль кромки берега, остальное — по всей траве. seed — у каждой сцены свой пейзаж
   */
  function decorate(s, seed, keepOut) {
    const r = rng(seed);
    const free = (x, y, m = 0.4) => s.onLand(x, y) && !keepOut.some(([x0, y0, x1, y1]) => x > x0 - m && x < x1 + m && y > y0 - m && y < y1 + m);
    const placed = [];
    const spaced = (x, y, d) => placed.every(([px, py]) => Math.hypot(px - x, py - y) > d);
    const randomPoint = () => [-5 + r() * 20, -4.5 + r() * 9.5];
    const pick = (n, d, fn) => {
      for (let tries = 0, made = 0; made < n && tries < n * 40; tries++) {
        const [x, y] = randomPoint();
        if (!free(x, y) || !spaced(x, y, d)) continue;
        placed.push([x, y]); fn(x, y); made++;
      }
    };
    const anyGreen = () => C.greens[Math.floor(r() * C.greens.length)];
    pick(9, 1.3, (x, y) => plant(s, x, y, { kind: 'round', scale: 0.75 + r() * 0.5, crown: anyGreen() }));
    pick(5, 1.1, (x, y) => plant(s, x, y, { kind: 'cone', scale: 0.8 + r() * 0.4, crown: C.pine }));
    // Пальмы: чуть внутрь от кромки, подальше от дороги и столбиков — крона наклонена и наезжала бы на них
    for (const k of [0.15, 0.3, 0.62, 0.8]) {
      const [bx, by] = s.shore[Math.floor(k * s.shore.length)], [ox, oy] = s.shoreCenter;
      const [cx, cy] = [(bx - ox) * 0.86 + ox, (by - oy) * 0.86 + oy];
      if (free(cx, cy, 0.8) && spaced(cx, cy, 0.9)) { placed.push([cx, cy]); plant(s, cx, cy, { kind: 'palm', scale: 0.9 + r() * 0.2, crown: C.greens[0] }); }
    }
    pick(10, 0.8, (x, y) => bush(s, x, y, anyGreen(), 0.8 + r() * 0.4));
    for (let i = 0; i < 18; i++) { const [x, y] = randomPoint(); if (free(x, y, 0.2)) flowers(s, x, y, r); }
    for (let i = 0; i < 40; i++) { const [x, y] = randomPoint(); if (free(x, y, 0.1)) tuft(s, x, y); }
  }

  return {
    carColor, island, road, zebra, stopLine, slot, paved, sign,
    car, carActor, CAR, ROAD, washHouse, house, barrierGate, trafficLight, bench, streetLamp, picket, decorate,
  };
})();
