/*
 * Реквизит диорам, часть 3 — постройки: автомойка, домик, бензоколонка, шлагбаум, светофор; мебель площадки — скамейка, фонарь, штакетник.
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

  // ---------- Бензоколонка ----------

  const PUMP = { w: 0.3, d: 0.24, h: 0.72, gap: 0.22 }; // колонка стоит за машиной: между ними — gap (клетки)
  const CANOPY = { h: 1.6, t: 0.14, pillar: 0.1, padX: [0.85, 0.75], padY: [0.3, 0.2] };

  /**
   * Бензоколонка: магазинчик (shop — { x, y, w, d, h }), колонки и навес над ними на столбах.
   * pumps — центры машин у колонок [[x, y], …] (машины вдоль x, как на дороге): колонка — сразу за машиной (меньше y),
   * и машина её чуть закрывает — видна верхняя часть с табло. label — табличка магазинчика при наведении.
   * Возвращает label (живая сцена меняет текст) и setFuel(i, fraction, color): идёт заправка — шланг к машине и
   * полоска на табло цветом потока; fraction = null — колонка свободна (шланг на крючке, табло пустое)
   */
  function fuelStation(s, { shop, pumps, label }) {
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

    // Колонки: корпус, тёмная голова с табло на ближней грани, крючок с пистолетом на боку +x
    const pumpViews = pumps.map(([cx, cy]) => {
      const px = cx - PUMP.w / 2, py = cy - W / 2 - PUMP.gap - PUMP.d, front = py + PUMP.d + 0.003;
      const node = svg('g'), hose = svg('g'), screen = svg('g');
      s.castShadow(px, py, PUMP.w, PUMP.d, PUMP.h);
      node.append(s.box(px - 0.04, py - 0.04, 0, PUMP.w + 0.08, PUMP.d + 0.08, 0.06, C.curb)); // островок
      node.append(s.box(px, py, 0.06, PUMP.w, PUMP.d, PUMP.h - 0.06, C.post));
      node.append(s.box(px, py, PUMP.h - 0.2, PUMP.w, PUMP.d, 0.2, C.accent));
      node.append(s.box(px + PUMP.w, py + 0.08, 0.3, 0.05, 0.08, 0.14, '#4a4a4a')); // пистолет на крючке
      node.append(hose, screen);
      s.add(px + py + 0.3, node); // глубже машины перед ней — машина рисуется поверх
      return { cx, cy, px, py, front, hose, screen };
    });

    // Навес: узкая крыша над рядом колонок — не над машинами: в изометрии длинная крыша вдоль x закрывала бы машины
    // у своего дальнего конца. Столбы — по краям ряда, на линии колонок (не на пути машин); тень — мягким пятном
    const xs = pumps.map(p => p[0]), lineY = pumpViews[0].py + PUMP.d / 2;
    const x0 = Math.min(...xs) - CANOPY.padX[0], x1 = Math.max(...xs) + CANOPY.padX[1];
    const y0 = Math.min(...pumpViews.map(p => p.py)) - CANOPY.padY[0], y1 = Math.max(...pumpViews.map(p => p.front)) + CANOPY.padY[1];
    s.ground.push(svg('polygon', { points: s.pts([[x0 + 0.3, y0 + 0.2, 0], [x1 + 0.3, y0 + 0.2, 0], [x1 + 0.3, y1 + 0.2, 0], [x0 + 0.3, y1 + 0.2, 0]]),
      style: `fill: ${C.shadowColor}; opacity: .08` }));
    const P = CANOPY.pillar;
    for (const px of [x0, x1 - P]) {
      s.castShadow(px, lineY - P / 2, P, P, CANOPY.h);
      s.add(px + lineY + 0.3, s.box(px, lineY - P / 2, 0, P, P, CANOPY.h, '#d9d2c4'));
    }
    const roof = svg('g');
    roof.append(s.box(x0 - 0.1, y0 - 0.1, CANOPY.h, x1 - x0 + 0.2, y1 - y0 + 0.2, CANOPY.t, C.building));
    roof.append(s.panel('y', y1 + 0.1 + 0.003, x0 - 0.1, x1 + 0.1, CANOPY.h + 0.03, CANOPY.h + CANOPY.t - 0.03, C.accent)); // полоса по кромке
    s.hover(roof, l);
    s.add(x1 + y1 + 1, roof);

    function setFuel(i, fraction, color = C.ok) {
      const p = pumpViews[i];
      if (!p) return;
      p.hose.replaceChildren();
      p.screen.replaceChildren();
      if (fraction == null) return;
      // Табло: тёмная подложка и полоска заправки
      const a0 = p.px + 0.05, a1 = p.px + PUMP.w - 0.05, z0 = PUMP.h - 0.17, z1 = PUMP.h - 0.05;
      p.screen.append(s.panel('y', p.front, a0, a1, z0, z1, '#3a3a3a'));
      const f = Math.max(0, Math.min(fraction, 1));
      if (f > 0) p.screen.append(s.panel('y', p.front + 0.001, a0, a0 + (a1 - a0) * f, z0 + 0.02, z1 - 0.02, color));
      // Шланг: с бока колонки провисает к бензобаку на дальнем боку машины (у заднего колеса)
      const [ax, ay] = s.P(p.px + PUMP.w + 0.03, p.py + 0.12, 0.36);
      const [mx, my] = s.P(p.px + PUMP.w + 0.15, p.cy - W / 2 - 0.08, 0.06);
      const [bx, by] = s.P(p.cx - L / 2 + 0.25, p.cy - W / 2, 0.3);
      p.hose.append(svg('path', { d: `M ${ax} ${ay} Q ${mx} ${my} ${bx} ${by}`, style: 'fill: none; stroke: #3a3a3a; stroke-width: 2; stroke-linecap: round' }));
    }

    return { label: l, setFuel };
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

  Object.assign(IsoObjects, { washHouse, house, fuelStation, barrierGate, trafficLight, bench, streetLamp, picket });
})();
