/*
 * Реквизит диорам, часть 3 — постройки: автомойка, бензоколонка, конвейер, склад, стеллаж, шлагбаум, светофор; мебель площадки — скамейка, фонарь, штакетник.
 * Подключение: после iso-vehicles.js (в боксах мойки стоят машины).
 */
(() => {
  const { svg, shade, threadColor, PALETTE: C } = Iso;
  const { CAR, carColor, carNode } = IsoObjects;

  const FREE_BAY = '#d8cfbf'; // маркиза свободного бокса: потока ещё нет — цвета у него тоже нет

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

  // ---------- Бензоколонка ----------

  const PUMP = { w: 0.3, d: 0.24, h: 0.72, gap: 0.22 }; // колонка стоит за машиной: между ними — gap (клетки)
  // wideX — правый вынос навеса у двусторонней колонки: столб правее дальней машины (по экрану — за её задним углом)
  const CANOPY = { h: 1.6, t: 0.14, pillar: 0.1, padX: [0.85, 0.75], padY: [0.3, 0.2], wideX: 1.45 };

  /**
   * Бензоколонка: магазинчик (shop — { x, y, w, d, h }), колонки и навес над ними на столбах.
   * pumps — центры машин у колонок [[x, y], …] (машины вдоль x, как на дороге): колонка — сразу за машиной (меньше y),
   * и машина её чуть закрывает — видна верхняя часть с табло. label — табличка магазинчика при наведении.
   * Возвращает label (живая сцена меняет текст) и setFuel(i, fraction, color): идёт заправка — шланг к машине и
   * полоска на табло цветом потока; fraction = null — колонка свободна (шланг на крючке, табло пустое).
   * pairs — двусторонние колонки: машины парами (0, 1), (2, 3)…: чётная — перед колонкой (как обычно), нечётная —
   * за ней (её центр — тот же x, дальше по y); колонка одна на пару, по центру первой; на ближней грани два табло:
   * верхнее — дальняя машина, нижнее — ближняя; навес — с выносом вправо (правый столб — правее дальней машины).
   * Пробовали ещё машины поперёк, носом в бокс, с колонкой сбоку и без навеса (2026-11-12) — не взяли
   */
  function fuelStation(s, { shop, pumps, label, pairs = false }) {
    const { L, W } = CAR;

    // Магазинчик: витрина во всю ближнюю стену, дверь, плоская крыша с бортиком и вывеской
    const g = svg('g'), { x, y, w, d, h } = shop;
    g.append(s.box(x, y, 0, w, d, h, C.building));
    g.append(s.panel('y', y + d + 0.003, x + 0.2, x + w - 0.75, 0.25, h - 0.2, C.glass));
    g.append(s.panel('y', y + d + 0.003, x + w - 0.55, x + w - 0.2, 0, h - 0.25, shade(C.wood, -0.1)));
    g.append(s.panel('x', x + w + 0.003, y + d / 2 - 0.25, y + d / 2 + 0.25, 0.4, h - 0.25, C.glass));
    g.append(s.box(x - 0.05, y - 0.05, h, w + 0.1, d + 0.1, 0.1, C.roof));
    g.append(s.box(x + w / 2 - 0.5, y + d - 0.1, h + 0.1, 1.0, 0.08, 0.28, C.accent));
    s.castShadow(x, y, w, d, h + 0.35);
    const l = s.label(x + w / 2, y + d / 2, h + 0.6, label.lines, label);
    s.hover(g, l);
    s.add(x + y + w / 2 + d / 2, g);

    // Колонка для машины i: своя (по умолчанию) или общая на пару (pairs) — по центру первой машины пары
    const carViews = [], pumpViews = [];
    pumps.forEach(([cx, cy], i) => {
      const far = pairs && i % 2 === 1;
      if (!far) pumpViews.push(pumpNode([cx - PUMP.w / 2, cy - W / 2 - PUMP.gap - PUMP.d]));
      const pump = pumpViews.at(-1), hose = svg('g'), screen = svg('g');
      pump.node.append(hose, screen);
      carViews.push({ cx, cy, far, pump, hose, screen, slot: !pairs ? 'full' : far ? 'top' : 'bottom' });
    });

    // Колонка: островок, корпус, тёмная голова с табло на ближней грани, крючок с пистолетом на боку +x
    function pumpNode([px, py]) {
      const node = svg('g'), front = py + PUMP.d + 0.003;
      s.castShadow(px, py, PUMP.w, PUMP.d, PUMP.h);
      node.append(s.box(px - 0.04, py - 0.04, 0, PUMP.w + 0.08, PUMP.d + 0.08, 0.06, C.curb)); // островок
      node.append(s.box(px, py, 0.06, PUMP.w, PUMP.d, PUMP.h - 0.06, C.post));
      node.append(s.box(px, py, PUMP.h - 0.2, PUMP.w, PUMP.d, 0.2, C.accent));
      node.append(s.box(px + PUMP.w, py + 0.08, 0.3, 0.05, 0.08, 0.14, '#4a4a4a')); // пистолет на крючке
      // Глубже машины перед ней — машина рисуется поверх; мельче машины за ней (pairs) — колонка поверх неё
      s.add(px + py + 0.3, node);
      return { node, px, py, front };
    }

    // Навес — над колонками; у pairs — с выносом вправо (wide): иначе правый столб встал бы перед дальней машиной
    canopy(s, pumps.map(p => p[0]), pumpViews, l, { wide: pairs });
    return { label: l, setFuel };

    function setFuel(i, fraction, color = C.ok) {
      const c = carViews[i];
      if (!c) return;
      const p = c.pump;
      c.hose.replaceChildren();
      c.screen.replaceChildren();
      if (fraction == null) return;
      // Табло: тёмная подложка и полоска заправки; у двусторонней колонки — два табло друг над другом
      const z = { full: [PUMP.h - 0.17, PUMP.h - 0.05], top: [PUMP.h - 0.11, PUMP.h - 0.04], bottom: [PUMP.h - 0.18, PUMP.h - 0.12] }[c.slot];
      const a0 = p.px + 0.05, a1 = p.px + PUMP.w - 0.05, [z0, z1] = z, inset = c.slot === 'full' ? 0.02 : 0.012;
      c.screen.append(s.panel('y', p.front, a0, a1, z0, z1, '#3a3a3a'));
      const f = Math.max(0, Math.min(fraction, 1));
      if (f > 0) c.screen.append(s.panel('y', p.front + 0.001, a0, a0 + (a1 - a0) * f, z0 + inset, z1 - inset, color));
      // Шланг: с бока колонки провисает к бензобаку у заднего колеса — на дальнем боку машины перед колонкой
      // или на ближнем боку машины за ней
      const [ax, ay] = s.P(p.px + PUMP.w + 0.03, p.py + 0.12, 0.36);
      const [mx, my] = c.far ? s.P(p.px + PUMP.w + 0.15, c.cy + W / 2 + 0.08, 0.06) : s.P(p.px + PUMP.w + 0.15, c.cy - W / 2 - 0.08, 0.06);
      const [bx, by] = c.far ? s.P(c.cx - L / 2 + 0.25, c.cy + W / 2, 0.3) : s.P(c.cx - L / 2 + 0.25, c.cy - W / 2, 0.3);
      c.hose.append(svg('path', { d: `M ${ax} ${ay} Q ${mx} ${my} ${bx} ${by}`, style: 'fill: none; stroke: #3a3a3a; stroke-width: 2; stroke-linecap: round' }));
    }
  }

  // Навес: узкая крыша над рядом колонок — не над машинами: в изометрии длинная крыша вдоль x закрывала бы машины
  // у своего дальнего конца. Столбы — по краям ряда, на линии колонок (не на пути машин); тень — мягким пятном.
  // xs — центры ряда по x, от них — ширина навеса.
  // wide — у двусторонней колонки (машина стоит и за колонкой): правый столб — правее дальней машины; на обычном
  // месте (padX) он встал бы прямо перед ней и перечеркнул. Пробовали ещё столбы за дальней машиной и один столб
  // у колонки (2026-11-12) — выбрали этот
  function canopy(s, xs, pumpViews, l, { wide = false } = {}) {
    const lineY = pumpViews[0].py + PUMP.d / 2;
    const x0 = Math.min(...xs) - CANOPY.padX[0], x1 = Math.max(...xs) + (wide ? CANOPY.wideX : CANOPY.padX[1]);
    const y0 = Math.min(...pumpViews.map(p => p.py)) - CANOPY.padY[0], y1 = Math.max(...pumpViews.map(p => p.front)) + CANOPY.padY[1];
    const P = CANOPY.pillar, pillars = [[x0, lineY], [x1 - P, lineY]];
    s.ground.push(svg('polygon', { points: s.pts([[x0 + 0.3, y0 + 0.2, 0], [x1 + 0.3, y0 + 0.2, 0], [x1 + 0.3, y1 + 0.2, 0], [x0 + 0.3, y1 + 0.2, 0]]),
      style: `fill: ${C.shadowColor}; opacity: .08` }));
    for (const [px, py] of pillars) {
      s.castShadow(px, py - P / 2, P, P, CANOPY.h);
      s.add(px + py + 0.3, s.box(px, py - P / 2, 0, P, P, CANOPY.h, '#d9d2c4'));
    }
    const roof = svg('g');
    roof.append(s.box(x0 - 0.1, y0 - 0.1, CANOPY.h, x1 - x0 + 0.2, y1 - y0 + 0.2, CANOPY.t, C.building));
    roof.append(s.panel('y', y1 + 0.1 + 0.003, x0 - 0.1, x1 + 0.1, CANOPY.h + 0.03, CANOPY.h + CANOPY.t - 0.03, C.accent)); // полоса по кромке
    s.hover(roof, l);
    s.add(x1 + y1 + 1, roof);
  }

  // ---------- Конвейер ----------

  // Ширина (шире дороги: массивный — главный объект сцены), высота ленты, шаг мест (ящик 0.45 и зазор), поле у торцов,
  // бортик; ролики — ширина и шаг; мотор — длина; band — высота жёлто-чёрной полосы на корпусе
  const BELT = { D: 1.5, H: 0.38, step: 0.85, pad: 0.25, rail: 0.08, roller: 0.08, rollerStep: 0.13, motor: 0.45, band: 0.1 };
  const BELT_COLOR = { plate: '#4a4d52', body: '#5d6670', gap: '#34373c', roller: '#c3c9d0', yellow: '#e8b83a', black: '#2d2f33', motor: '#4a7fb5', lamp: '#7fd36b' };

  /** Длина ленты конвейера на slots мест (без короба мотора за головой) — чтобы раскладка могла его отцентровать */
  const conveyorLength = slots => slots * BELT.step + BELT.pad * 2;

  /**
   * Роликовый конвейер вдоль x: массивный сплошной корпус (шире дороги) с жёлто-чёрной полосой, поперечные ролики, жёлтые бортики,
   * жёлтые стопоры между местами (видно, сколько помещается), за головой — короб мотора с лампочкой.
   * Голова — справа (+x, x0 + длина), хвост — слева; места для грузов — от головы: slotAt(0) — у головы.
   * slots — сколько мест; label — табличка при наведении { lines, color }; open — сколько из них открыто (от головы):
   * остальные, у хвоста, закрыты плитами с жёлтой штриховкой — лента одной длины при любой ёмкости, ёмкость видна сразу.
   * Ближний бортик — отдельным объектом глубже ящиков на ленте: ящик стоит между бортиками, а не поверх ближнего;
   * стопоры — по объекту на границу мест, по глубине между ящиками.
   * Возвращает { slotAt(i) → [x, y, z], label, length, head: [x, y], tail: [x, y] } — середины торцов ленты
   */
  function conveyor(s, x0, y0, slots, label, { open = slots } = {}) {
    const { D, H, step, pad, rail, roller, rollerStep, motor, band } = BELT, K = BELT_COLOR;
    const len = conveyorLength(slots), x1 = x0 + len, y1 = y0 + D, yc = y0 + D / 2;

    // Дальнее: корпус с полосой на ближней грани, просветы и ролики, дальний бортик
    const back = svg('g');
    back.append(s.box(x0, y0, 0, len, D, H, K.body));
    const n = Math.max(2, Math.round(len / 0.14));
    for (let k = 0; k < n; k++) {
      back.append(s.panel('y', y1 + 0.003, x0 + len * k / n, x0 + len * (k + 1) / n, H - band, H, k % 2 ? K.black : K.yellow));
    }
    back.append(s.flat(x0, y0 + rail, len, D - rail * 2, K.gap, H + 0.001));
    for (let x = x0 + 0.04; x < x1 - 0.08; x += rollerStep) back.append(s.box(x, y0 + rail, H, roller, D - rail * 2, 0.035, K.roller));
    back.append(s.box(x0, y0, H, len, rail, 0.1, K.yellow));
    s.castShadow(x0, y0, len, D, H);
    const l = s.label(x0 + len / 2, yc, H + 0.7, label.lines, label);
    s.hover(back, l);
    s.add(x0 + y0, back);

    // Закрытые места (сверх open, у хвоста): тёмная плита со штриховкой поверх роликов
    for (let i = open; i < slots; i++) {
      const cx = x1 - pad - step * (i + 0.5), w = step - 0.11, d = D - rail * 2 - 0.06, g = svg('g');
      g.append(s.box(cx - w / 2, yc - d / 2, H, w, d, 0.06, K.plate));
      for (let k = 0; k < 4; k++) {
        const x = cx - w / 2 + 0.1 + k * (w - 0.3) / 3;
        g.append(s.line([x, yc - d / 2 + 0.05, H + 0.062], [x + 0.14, yc + d / 2 - 0.05, H + 0.062], K.yellow));
      }
      g.append(svg('title', {}, 'closed: above the capacity of the queue'));
      s.add(cx + yc + 0.2, s.hover(g, l));
    }

    // Стопоры между местами: глубина — по их x, поэтому ящик левее стопора рисуется до него, правее — после
    for (let i = 1; i < slots; i++) {
      const xb = x1 - pad - step * i;
      s.add(xb + yc, s.hover(s.box(xb - 0.025, y0 + rail, H + 0.035, 0.05, D - rail * 2, 0.06, K.yellow), l));
    }

    // Ближний бортик — поверх ящиков
    const front = s.box(x0, y1 - rail, H, len, rail, 0.1, K.yellow);
    s.hover(front, l);
    s.add(x1 + y1 - 0.3, front); // глубже любого ящика на ленте (самый глубокий — у головы)

    // Короб мотора за головой: решётка на ближней грани, лампочка сверху
    const box = svg('g'), my0 = y0 + 0.15, mh = H + 0.22;
    box.append(s.box(x1, my0, 0, motor, D - 0.3, mh, K.motor));
    box.append(s.panel('y', y1 - 0.15 + 0.003, x1 + 0.08, x1 + motor - 0.08, H - 0.08, H + 0.12, shade(K.motor, -0.35)));
    box.append(s.box(x1 + 0.16, yc - 0.05, mh, 0.1, 0.1, 0.07, K.lamp));
    s.castShadow(x1, my0, motor, D - 0.3, mh);
    s.add(x1 + yc, s.hover(box, l));

    return {
      slotAt: i => [x1 - pad - step * (i + 0.5), yc, H + 0.001],
      label: l, length: len,
      head: [x1, yc], tail: [x0, yc],
    };
  }

  // ---------- Склад и стеллаж ----------

  const WAREHOUSE = { wall: '#f4e3c6', gate: '#b9a68a', gateW: 1.1, gateH: 0.95 };

  /**
   * Склад: широкое здание (x, y) – (x + w, y + d) высотой h, на ближней грани +y — двое ворот (рольставни),
   * плоская крыша с бортиком. Возвращает gateAt(i) → [x, y] — середина ворот у земли (сюда уезжают погрузчики)
   */
  function warehouse(s, x, y, w, d, h) {
    const K = WAREHOUSE, g = svg('g');
    g.append(s.box(x, y, 0, w, d, h, K.wall));
    const gateX = i => x + 0.4 + i * (w / 2);
    for (let i = 0; i < 2; i++) {
      const gx = gateX(i);
      g.append(s.panel('y', y + d + 0.003, gx, gx + K.gateW, 0, K.gateH, K.gate));
      for (let z = 0.15; z < K.gateH; z += 0.16) g.append(s.line([gx, y + d + 0.006, z], [gx + K.gateW, y + d + 0.006, z], shade(K.gate, -0.15)));
    }
    g.append(s.box(x - 0.05, y - 0.05, h, w + 0.1, d + 0.1, 0.08, C.roof));
    s.castShadow(x, y, w, d, h);
    s.add(x + y + w * 0.5, g);
    return { gateAt: i => [gateX(i) + K.gateW / 2, y + d] };
  }

  const RACK = { D: 0.5, step: 0.62, H: 1.05, post: '#b9b2a6', beam: '#d8cdb9' };

  /**
   * Стеллаж вдоль x на n мест: стойки и две полки — светлый и пустой, чтобы не спорить с очередью
   * (ящики на сцене — только задачи)
   */
  function rack(s, x, y, n) {
    const K = RACK, g = svg('g'), len = n * K.step;
    for (let i = 0; i <= n; i++) for (const yy of [y, y + K.D - 0.05]) g.append(s.box(x + i * K.step, yy, 0, 0.05, 0.05, K.H, K.post));
    for (const z of [0.05, 0.55]) g.append(s.box(x, y, z, len + 0.05, K.D, 0.04, K.beam));
    s.castShadow(x, y, len, K.D, K.H);
    s.add(x + y + len / 2, g);
  }

  // ---------- Шлагбаум и светофор ----------
  /**
   * Шлагбаум у ближнего края дороги: стойка и полосатая стрела поперёк полосы. Стрела вращается вокруг оси на стойке:
   * setOpen(0) — опущена поперёк дороги, setOpen(1) — поднята вертикально. Сегменты перестраиваются на каждом вызове
   */
  function barrierGate(s, x) {
    s.castShadow(x - 0.05, 1.3, 0.2, 0.2, 0.62);
    s.add(x + 1.5, s.box(x - 0.05, 1.3, 0, 0.2, 0.2, 0.62, C.post));
    const arm = svg('g');
    const SEGMENTS = 6, SEG = 0.22, HALF = 0.04, W = 0.08;      // сегменты по 0.22, сечение стрелы 0.08 × 0.08
    const pivot = { y: 1.3, z: 0.56 };                           // ось — на стойке, по центру сечения стрелы
    const face = (list, color) => svg('polygon', { points: s.pts(list), style: s.faceStyle(color) });

    function setOpen(f) {
      // Угол от горизонтали: стрела идёт от стойки в −y и поднимается к +z. d — вдоль стрелы, n — поперёк, «вверх»
      const a = f * Math.PI / 2, d = [-Math.cos(a), Math.sin(a)], n = [Math.sin(a), Math.cos(a)];
      const at = (len, side) => [pivot.y + d[0] * len + n[0] * side, pivot.z + d[1] * len + n[1] * side];
      arm.replaceChildren();
      for (let i = 0; i < SEGMENTS; i++) {
        const color = i % 2 ? '#f2f2f2' : '#d64545';
        const [y0, z0] = at(i * SEG, HALF), [y1, z1] = at((i + 1) * SEG, HALF);
        const [y2, z2] = at((i + 1) * SEG, -HALF), [y3, z3] = at(i * SEG, -HALF);
        // Видимые грани: «верх» (сторона n) и правый бок (+x)
        arm.append(face([[x, y0, z0], [x + W, y0, z0], [x + W, y1, z1], [x, y1, z1]], shade(color, 0.1)));
        arm.append(face([[x + W, y0, z0], [x + W, y1, z1], [x + W, y2, z2], [x + W, y3, z3]], shade(color, -0.32)));
      }
    }

    setOpen(0);
    s.add(x + 0.6, arm);
    return { setOpen };
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

  // ---------- Жилой дом с крыльцом ----------

  const HOUSE = { wall: '#fbe9d0', frame: '#fff8ee', lit: '#ffe3a0', door: '#a8744a', doorway: '#4a3a33', stone: '#e6dccb', floorH: 0.8 };

  /**
   * Жилой дом (общежитие): коробка (x, y) – (x + w, y + d) высотой floors этажей, двускатная крыша вдоль x.
   * Дверь — посередине ближней грани +y, над ней козырёк и фонарик; перед дверью — низкое крыльцо со ступенькой
   * (низкое: актёры стоят на земле, z у них нет). Окна — на гранях +y и +x, часть светится (детерминированно).
   * Почтового ящика нет — у SynchronousQueue задачу оставить негде.
   * Возвращает doorAt — [x, y] на крыльце у двери (отсюда выходят и сюда уходят жильцы), stepAt — перед ступенькой
   * (здесь передают пакет), setOpen(open) — дверь открыта (тёмный проём) или закрыта
   */
  function house(s, x, y, w, d, floors = 2) {
    const K = HOUSE, h = floors * K.floorH + 0.2, g = svg('g'), front = y + d + 0.003, side = x + w + 0.003;
    const dx = x + w / 2, rand = Iso.rng(Math.round((x + y) * 100) + floors);
    // Цоколь — до стены: стена закрывает его верх, видна только кромка
    g.append(s.box(x - 0.02, y - 0.02, 0, w + 0.04, d + 0.04, 0.12, shade(K.wall, -0.12)));
    g.append(s.box(x, y, 0, w, d, h, K.wall));

    // Окно: рама и стекло; некоторые светятся тёплым
    const glass = () => rand() < 0.3 ? K.lit : C.glass;
    const window = (plane, at, a, z) => {
      g.append(s.panel(plane, at, a - 0.04, a + 0.44, z - 0.04, z + 0.48, K.frame), s.panel(plane, at + 0.001, a, a + 0.4, z, z + 0.44, glass()));
    };
    for (let f = 0; f < floors; f++) {
      const z = 0.3 + f * K.floorH;
      for (let a = x + 0.35; a + 0.45 < x + w - 0.2; a += 0.75) {
        if (f === 0 && Math.abs(a + 0.2 - dx) < 0.6) continue; // у двери — без окон
        window('y', front, a, z);
      }
      for (let a = y + 0.3; a + 0.45 < y + d - 0.1; a += 0.75) window('x', side, a, z);
    }

    // Дверь: коробка-рама, полотно (или тёмный проём), ручка; козырёк и фонарик над ней
    g.append(s.panel('y', front, dx - 0.3, dx + 0.3, 0.12, 0.95, K.frame));
    const door = svg('g');
    g.append(door);
    function setOpen(open) {
      door.replaceChildren(s.panel('y', front + 0.002, dx - 0.24, dx + 0.24, 0.12, 0.9, open ? K.doorway : K.door));
      if (!open) door.append(s.panel('y', front + 0.004, dx + 0.14, dx + 0.18, 0.48, 0.53, '#e8d9b0'));
    }
    setOpen(false);
    g.append(s.box(dx - 0.45, y + d, 1.02, 0.9, 0.42, 0.05, C.roof));
    const [lx, ly] = s.P(dx + 0.4, front, 0.85);
    g.append(svg('circle', { cx: lx, cy: ly, r: 6, style: 'fill: #ffe9a8; opacity: .35' }), svg('circle', { cx: lx, cy: ly, r: 2.5, style: 'fill: #fff3c4' }));

    g.append(s.gableRoof(x, y, w, d, h, 0.7, C.roof));
    s.castShadow(x, y, w, d, h + 0.4);
    s.add(x + y + w * 0.5, g);

    // Крыльцо — в слое земли, а не объектом по глубине: оно почти плоское, и всё, что на нём стоит, всегда поверх
    // (объектом с глубиной своей середины оно закрывало жильца на левом краю). Шириной на троих: двое ждущих
    // по бокам от двери, проход посередине
    const py = y + d, PW = 2.1, PD = 0.6;
    s.ground.push(s.box(dx - PW / 2, py, 0, PW, PD, 0.05, K.stone), s.box(dx - PW / 2 + 0.1, py + PD, 0, PW - 0.2, 0.22, 0.025, shade(K.stone, -0.05)));

    return { doorAt: [dx, py + 0.3], stepAt: [dx, py + PD + 0.6], porch: [dx - PW / 2, py, dx + PW / 2, py + PD + 0.22], setOpen };
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

  Object.assign(IsoObjects, { washHouse, fuelStation, conveyor, conveyorLength, warehouse, rack, house, barrierGate, trafficLight, bench, streetLamp, picket });
})();
