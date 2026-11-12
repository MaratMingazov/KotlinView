/*
 * Реквизит диорам, часть 6 — грузовой порт: вода, причал с бортиком, рельсы, площадка под грузом (жёлто-чёрная
 * диагональ), ангар; актёры — портальный кран с тележкой на балке и баржа; груз — морской контейнер.
 * Смысла (пул, поток, задача) здесь нет: кто есть кто — решает описание структуры (diorama-cached.js).
 * Подключение: после iso-vehicles.js (vehicleActor) и iso-buildings.js.
 */
(() => {
  const { svg, shade, PALETTE: C, roundedRect } = Iso;
  const { vehicleActor } = IsoObjects;

  const PORT = {
    water: '#7fc6de', waterLight: '#a9dcec', quay: '#d9d0bf', coping: '#efe7d6',
    rail: '#7d838b', steel: '#5b5f66', spreader: '#e8b83a', deck: '#c9b89a', cabin: '#fff6ea', beacon: '#f29c38',
    hangar: '#e9dcc4', hangarDoor: '#a9977c', board: '#3d3f44',
  };
  const CONTAINER = { L: 0.9, W: 0.42, H: 0.42 };   // длина, ширина, высота (клетки)
  const CRANE = { H: 1.9, W: 0.9 };                   // высота портала; ширина между ногами вдоль рельсов
  const BARGE = { L: 3.1, W: 1.3, board: 0.3, cabU: 0.62, cabV: 0.82, cabH: 0.5, ahead: 0.35 };

  // Оси: u — вдоль балки крана / корпуса баржи, v — поперёк. axis 'x' — u = x, 'y' — u = y
  const axes = (s, axis) => ({
    pt: axis === 'y' ? (u, v) => [v, u] : (u, v) => [u, v],
    cube: axis === 'y' ? (u, v, z, du, dv, h, c) => s.box(v, u, z, dv, du, h, c) : (u, v, z, du, dv, h, c) => s.box(u, v, z, du, dv, h, c),
  });
  const across = axis => axis === 'x' ? 'y' : 'x';

  // ---------- Земля ----------

  /**
   * Вода — вровень с плитой: причал над ней — бортиком (coping), так вода читается ниже берега; пара бликов.
   * round — скругление углов: у края плиты вода не залезает на её скруглённые углы
   */
  function water(s, x0, y0, x1, y1, round = 0) {
    const poly = round ? roundedRect(x0, y0, x1 - x0, y1 - y0, round, 6) : [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    s.ground.push(svg('polygon', { points: s.pts(poly.map(([x, y]) => [x, y, 0.001])), style: `fill: ${PORT.water}; stroke: ${PORT.water}; stroke-width: .5` }));
    for (let i = 0; i < 7; i++) {
      const x = x0 + 0.6 + ((i * 2.3) % Math.max(1, x1 - x0 - 1.4)), y = y0 + 0.4 + ((i * 1.7) % Math.max(0.6, y1 - y0 - 0.8));
      s.ground.push(s.line([x, y, 0.002], [x + 0.5, y, 0.002], PORT.waterLight));
    }
  }

  const quay = (s, x0, y0, x1, y1) => s.ground.push(s.flat(x0, y0, x1 - x0, y1 - y0, PORT.quay, 0.002));
  // Бортик причала у воды: вдоль x (на линии y) или вдоль y (на линии x)
  const copingX = (s, x0, x1, y) => s.ground.push(s.box(x0, y - 0.06, 0, x1 - x0, 0.12, 0.09, PORT.coping));
  const copingY = (s, y0, y1, x) => s.ground.push(s.box(x - 0.06, y0, 0, 0.12, y1 - y0, 0.09, PORT.coping));

  // Рельс (пара ниток) вдоль axis от a0 до a1, at — поперёк
  function rail(s, axis, a0, a1, at) {
    const { pt } = axes(s, axis);
    for (const d of [-0.05, 0.05]) s.ground.push(s.line([...pt(a0, at + d), 0.004], [...pt(a1, at + d), 0.004], PORT.rail));
  }

  // Выпуклый многоугольник, обрезанный полуплоскостью a·x + b·y ≤ c (Сазерленд — Ходжмен для одной стороны)
  function clip(poly, a, b, c) {
    const out = [], f = ([x, y]) => a * x + b * y - c;
    poly.forEach((p, i) => {
      const q = poly[(i + 1) % poly.length], fp = f(p), fq = f(q);
      if (fp <= 0) out.push(p);
      if (fp * fq < 0) { const t = fp / (fp - fq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    });
    return out;
  }

  /**
   * Площадка под грузом с центром (cx, cy) под контейнер вдоль axis: жёлтая, чёрные полосы по диагонали
   * (x + y = const), по краю — чёрная рамка. Возвращает центр [x, y, z] — куда ставить контейнер
   */
  function hazardSlot(s, cx, cy, axis = 'y') {
    const pad = 0.12, stripe = 0.16, [L, W] = [CONTAINER.L + 2 * pad, CONTAINER.W + 2 * pad];
    const [w, d] = axis === 'x' ? [L, W] : [W, L], x0 = cx - w / 2, y0 = cy - d / 2;
    const rect = [[x0, y0], [x0 + w, y0], [x0 + w, y0 + d], [x0, y0 + d]], [yellow, black] = C.hazard;
    const poly = list => svg('polygon', { points: s.pts(list.map(([x, y]) => [x, y, 0.005])), style: `fill: ${black}; stroke: ${black}; stroke-width: .3` });
    s.ground.push(s.flat(x0, y0, w, d, yellow, 0.004));
    for (let k = x0 + y0; k < x0 + y0 + w + d; k += stripe * 2) {
      const band = clip(clip(rect, -1, -1, -k), 1, 1, k + stripe);
      if (band.length > 2) s.ground.push(poly(band));
    }
    s.ground.push(svg('polygon', { points: s.pts(rect.map(([x, y]) => [x, y, 0.006])), style: `fill: none; stroke: ${black}; stroke-width: 1.6` }));
    return [cx, cy, 0.006];
  }

  /**
   * Ангар — (x, y, w, d), высота h, ворота на грани face ('y' — ближняя +y, 'x' — +x): светлые стены, двускатная
   * крыша вдоль x, ворота-рольставни. label — табличка при наведении { lines }
   */
  function hangar(s, x, y, w, d, h, face, label) {
    const g = svg('g'), door = PORT.hangarDoor;
    g.append(s.box(x, y, 0, w, d, h, PORT.hangar));
    const [a0, a1] = face === 'y' ? [x + w * 0.2, x + w * 0.8] : [y + d * 0.2, y + d * 0.8];
    g.append(s.panel(face, face === 'y' ? y + d + 0.003 : x + w + 0.003, a0, a1, 0, h * 0.75, door));
    for (let z = 0.12; z < h * 0.75; z += 0.14) {
      g.append(face === 'y' ? s.line([a0, y + d + 0.006, z], [a1, y + d + 0.006, z], shade(door, -0.15))
        : s.line([x + w + 0.006, a0, z], [x + w + 0.006, a1, z], shade(door, -0.15)));
    }
    g.append(s.gableRoof(x, y, w, d, h, 0.55, C.roof));
    s.castShadow(x, y, w, d, h + 0.3);
    if (label) s.hover(g, s.label(x + w / 2, y + d / 2, h + 0.8, label.lines, label));
    s.add(x + y + w * 0.5 + d * 0.5, g);
    // Ворота — у земли посередине грани: оттуда выезжают краны
    return { gateAt: face === 'y' ? [(a0 + a1) / 2, y + d] : [x + w, (a0 + a1) / 2] };
  }

  // ---------- Контейнер ----------

  /**
   * Контейнер длиной вдоль axis, центр основания — (cx, cy), низ на z: короб, гофра по ближнему длинному боку,
   * на ближнем торце — двери с запорными штангами, по углам — фитинги
   */
  function containerNode(s, cx, cy, z, axis, color) {
    const g = svg('g'), { L, W, H } = CONTAINER;
    const [x, y, w, d] = axis === 'x' ? [cx - L / 2, cy - W / 2, L, W] : [cx - W / 2, cy - L / 2, W, L];
    g.append(s.box(x, y, z, w, d, H, color));
    const rib = shade(color, -0.18), dark = shade(color, -0.45), e = 0.002;
    for (let k = 1; k < 10; k++) {
      const t = k / 10;
      g.append(axis === 'x' ? s.line([x + w * t, y + d + e, z + 0.04], [x + w * t, y + d + e, z + H - 0.04], rib)
        : s.line([x + w + e, y + d * t, z + 0.04], [x + w + e, y + d * t, z + H - 0.04], shade(rib, -0.1)));
    }
    for (const t of [0.3, 0.5, 0.7]) {
      g.append(axis === 'x' ? s.line([x + w + e, y + d * t, z + 0.04], [x + w + e, y + d * t, z + H - 0.04], t === 0.5 ? dark : shade(rib, -0.1))
        : s.line([x + w * t, y + d + e, z + 0.04], [x + w * t, y + d + e, z + H - 0.04], t === 0.5 ? dark : rib));
    }
    const c = 0.06;
    for (const [fx, fy] of [[x, y + d - c], [x + w - c, y + d - c], [x + w - c, y]]) {
      g.append(s.box(fx, fy, z, c, c, c, dark), s.box(fx, fy, z + H - c, c, c, c, dark));
    }
    return g;
  }

  /**
   * Контейнер-груз: центр основания — в (x, y), низ — на высоте z (на палубе, под спредером, на площадке). Без своей
   * тени: лежит или висит на том, что её даёт. axis — вдоль чего длина; faded — полупрозрачный (поставлен и тает)
   */
  function containerActor(s, key, { color, axis = 'y', label, faded = false } = {}) {
    const a = s.actor(key, sc => {
      const node = containerNode(sc, 0, 0, 0, axis, color);
      if (faded) node.setAttribute('opacity', '0.45');
      if (label) sc.hover(node, sc.label(0, 0, CONTAINER.H + 0.3, label.lines, label));
      sc.add(0.1, node);
    });
    return { key, moveTo: (x, y, z = 0) => a.moveTo(x, y, z), remove: () => a.remove() };
  }

  // ---------- Баржа ----------

  // Корма — сзади по ходу: у меньшего u, если плывёт к большему
  const sternOf = dir => dir.endsWith('-') ? 1 : -1;
  const axisOf = dir => dir[0];

  /** Корпус баржи вокруг начала координат вдоль хода dir: цвет потока, палуба, белая полоса по борту, тень на воде. */
  function bargeHull(s, color, dir, label) {
    const axis = axisOf(dir), { L, W, board } = BARGE, deckZ = board - 0.04, g = svg('g');
    const [hx, hy, hw, hd] = axis === 'x' ? [-L / 2, -W / 2, L, W] : [-W / 2, -L / 2, W, L];
    g.append(s.prism(roundedRect(hx, hy, hw, hd, 0.4), -0.04, board, color));
    g.append(s.flat(hx + 0.12, hy + 0.12, hw - 0.24, hd - 0.24, PORT.deck, deckZ + 0.001));
    g.append(axis === 'x' ? s.panel('y', hy + hd + 0.003, hx + 0.35, hx + hw - 0.35, deckZ - 0.09, deckZ - 0.04, PORT.cabin)
      : s.panel('x', hx + hw + 0.003, hy + 0.35, hy + hd - 0.35, deckZ - 0.09, deckZ - 0.04, PORT.cabin));
    s.shadow(0, 0, 1.5, 0.2, 0);
    if (label) s.hover(g, s.label(0, 0, 1.1, label.lines, label));
    // Мельче контейнера на палубе (тот — груз с глубиной своей точки): палуба под ним, а не поверх
    s.add(-0.6, g);
  }

  /** Рубка у кормы: белая, крыша цвета потока, окна на ближних гранях. Отдельным актёром — своя глубина. */
  function bargeCabin(s, color, dir, label) {
    const axis = axisOf(dir), { L, board, cabU, cabV, cabH } = BARGE, deckZ = board - 0.04, { pt } = axes(s, axis);
    const su = sternOf(dir) * (L / 2 - 0.5), [rx, ry] = pt(su - cabU / 2, -cabV / 2), [rw, rd] = axis === 'x' ? [cabU, cabV] : [cabV, cabU];
    const g = svg('g'), z1 = deckZ + cabH;
    g.append(s.box(rx, ry, deckZ, rw, rd, cabH, PORT.cabin), s.box(rx - 0.04, ry - 0.04, z1, rw + 0.08, rd + 0.08, 0.06, shade(color, -0.15)));
    g.append(s.panel('y', ry + rd + 0.003, rx + 0.1, rx + rw - 0.1, deckZ + 0.22, z1 - 0.08, C.glass),
             s.panel('x', rx + rw + 0.003, ry + 0.1, ry + rd - 0.1, deckZ + 0.22, z1 - 0.08, C.glass));
    if (label) s.hover(g, s.label(0, 0, 1.1, label.lines, label));
    s.add(rx + ry + (rw + rd) / 2, g);
  }

  /**
   * Баржа-актёр: два транспорта с одним маршрутом — корпус и рубка. Порознь — ради глубины: контейнер на палубе
   * рисуется поверх корпуса, но под рубкой, когда она ближе к зрителю (баржа плывёт от нас). Груз — на палубе,
   * впереди центра по ходу (cargoPoint)
   */
  function bargeActor(s, key, color, { label } = {}) {
    const deckZ = BARGE.board - 0.04;
    const hull = vehicleActor(s, `${key}~hull`, (sc, dir) => bargeHull(sc, color, dir, label), { z: deckZ, ahead: BARGE.ahead });
    const cab = vehicleActor(s, `${key}~cab`, (sc, dir) => bargeCabin(sc, color, dir, label));
    return {
      key, pos: hull.pos, cargoZ: deckZ,
      moveTo(x, y, d) { hull.moveTo(x, y, d); cab.moveTo(x, y, d); },
      go(points, options) { const now = options?.now ?? performance.now(); hull.go(points, { ...options, now }); cab.go(points, { ...options, now }); },
      update(now) { cab.update(now); return hull.update(now); },
      heading: () => hull.heading(),
      cargoPoint: () => hull.cargoPoint(),
      remove() { hull.remove(); cab.remove(); },
      get moving() { return hull.moving; },
    };
  }

  // ---------- Портальный кран ----------

  /**
   * Портал крана вокруг начала координат (центр между ногами): ноги на двух рельсах (legs — по u, на ±), балка вдоль
   * axis от span[0] до span[1] — две решётчатые фермы, машинный дом цвета потока сверху, пилон с маячком и ванты,
   * кабина под балкой со стороны вылета (больший u), ходовые балки и крестовые связи. Тележки здесь нет — она актёр
   */
  function cranePortal(s, color, { axis, legs: [uA, uB], span: [u0, u1] }, label) {
    const { pt, cube } = axes(s, axis), { H, W } = CRANE, parts = [];
    const put = (u, v, node) => { const [x, y] = pt(u, v); parts.push({ d: x + y, node }); };
    const P3 = (u, v, z) => [...pt(u, v), z];
    const steel = shade(color, -0.35), lace = shade(color, -0.22), v0 = -W / 2, v1 = W / 2;
    const G = CRANE_GIRDER;

    for (const u of [uA, uB]) {
      put(u, 0, cube(u - 0.08, v0 - 0.08, 0, 0.16, W + 0.16, 0.12, PORT.steel));
      for (const v of [v0 - 0.02, v1 - 0.12]) put(u, v, cube(u - 0.07, v, 0.03, 0.14, 0.14, 0.09, shade(PORT.steel, -0.25)));
      for (const v of [v0, v1 - 0.12]) put(u, v, cube(u - 0.06, v, 0.12, 0.12, 0.12, H - 0.12, color));
      put(u, 0, s.line(P3(u + 0.06, v0 + 0.1, 0.3), P3(u + 0.06, v1 - 0.1, H - 0.15), steel));
      put(u, 0, s.line(P3(u + 0.06, v1 - 0.1, 0.3), P3(u + 0.06, v0 + 0.1, H - 0.15), steel));
      put(u, 0, cube(u - 0.08, v0, H, 0.16, W, 0.14, steel));
    }
    // Связь между рельсами — пониже балки, но выше контейнера под спредером
    put((uA + uB) / 2, v0, cube(uA, v0, H - 0.22, uB - uA, 0.1, 0.08, steel));
    put((uA + uB) / 2, v1, cube(uA, v1 - 0.1, H - 0.22, uB - uA, 0.1, 0.08, steel));

    // Две решётчатые фермы: пояса сверху и снизу, стойки и раскосы зигзагом на ближней грани
    for (const gv of [v0 + 0.05, v1 - 0.17]) {
      const face = gv + G.depth + 0.002, uEnd = gv > 0 ? u1 : u0;
      put(uEnd, gv, cube(u0, gv, G.z0, u1 - u0, G.depth, G.chord, color));
      put(uEnd, gv, cube(u0, gv, G.z1 - G.chord, u1 - u0, G.depth, G.chord, color));
      const n = Math.round((u1 - u0) / G.step);
      for (let k = 0; k <= n; k++) {
        const a = u0 + (u1 - u0) * k / n, b = u0 + (u1 - u0) * (k + 1) / n, lo = G.z0 + G.chord, hi = G.z1 - G.chord;
        put(uEnd, gv + 0.2, s.line(P3(a, face, lo), P3(a, face, hi), lace));
        if (k < n) put(uEnd, gv + 0.2, s.line(P3(a, face, k % 2 ? hi : lo), P3(b, face, k % 2 ? lo : hi), lace));
      }
    }
    // Машинный дом над ногами, пилон с маячком, ванты к концам балки
    const um = (uA + uB) / 2, mh = 0.34;
    put(um + 0.4, 0, cube(um - 0.55, v0 + 0.1, G.z1, 1.1, W - 0.2, mh, PORT.cabin));
    put(um + 0.45, 0, cube(um - 0.57, v0 + 0.08, G.z1 + mh, 1.14, W - 0.16, 0.06, color));
    const pylon = G.z1 + mh + 0.06, top = P3(um, 0, pylon + 0.5);
    put(um, 0, cube(um - 0.06, -0.06, pylon, 0.12, 0.12, 0.55, steel));
    put(um, 0, cube(um - 0.05, -0.05, pylon + 0.55, 0.1, 0.1, 0.07, PORT.beacon));
    put(u0 + 0.5, 0, s.line(top, P3(u0 + 0.15, 0, G.z1), steel));
    put(u1, 0, s.line(top, P3(u1 - 0.15, 0, G.z1), steel));
    // Кабина крановщика под балкой со стороны вылета
    const [kx, ky] = pt(uB + 0.2, v1 - 0.5), [kw, kd] = axis === 'x' ? [0.4, 0.42] : [0.42, 0.4], cab = svg('g');
    cab.append(s.box(kx, ky, H - 0.4, kw, kd, 0.36, PORT.cabin));
    cab.append(s.panel('y', ky + kd + 0.003, kx + 0.06, kx + kw - 0.06, H - 0.3, H - 0.1, C.glass), s.panel('x', kx + kw + 0.003, ky + 0.06, ky + kd - 0.06, H - 0.3, H - 0.1, C.glass));
    put(uB + 0.4, v1, cab);

    for (const v of [v0 + 0.05, v1 - 0.17]) {
      const [ax, ay] = pt(u0, v), [bx, by] = pt(u1, v + G.depth);
      s.castShadow(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay), 0.3);
    }
    const g = svg('g');
    for (const p of parts.sort((a, b) => a.d - b.d)) g.append(p.node);
    if (label) s.hover(g, s.label(...pt(um, 0), H + 1.4, label.lines, label));
    const [ex, ey] = pt(u1, v1);
    s.add(ex + ey + 0.8, g); // по переднему концу балки: она над водой и баржей
  }

  // Фермы балки: низ и верх (z), толщина пояса, глубина фермы поперёк, шаг раскосов
  const CRANE_GIRDER = { z0: CRANE.H + 0.14, z1: CRANE.H + 0.42, chord: 0.05, depth: 0.12, step: 0.36 };

  /**
   * Тележка вокруг начала координат: короб на фермах, лебёдка, четыре троса до спредера на высоте hookZ, спредер
   * с замками по углам. Глубже портала — сверху балки (тросы поверх ближней фермы — допустимо)
   */
  function craneTrolley(s, { axis, span: [, u1], hookZ }, depthOver) {
    const { pt, cube } = axes(s, axis), { W } = CRANE, G = CRANE_GIRDER, g = svg('g'), v0 = -W / 2;
    g.append(cube(-0.24, v0 + 0.1, G.z1, 0.48, W - 0.2, 0.14, PORT.steel), cube(-0.16, v0 + 0.22, G.z1 + 0.14, 0.32, W - 0.44, 0.06, shade(PORT.steel, 0.25)));
    for (const dv of [-0.16, 0.16]) for (const du of [-0.12, 0.12]) g.append(s.line([...pt(du, dv), G.z0], [...pt(du, dv), hookZ + 0.06], PORT.steel));
    const { L, W: CW } = CONTAINER, [sw, sd] = across(axis) === 'x' ? [L, CW] : [CW, L];
    g.append(s.box(-sw / 2, -sd / 2, hookZ, sw, sd, 0.06, PORT.spreader));
    for (const [cx, cy] of [[-sw / 2, sd / 2 - 0.06], [sw / 2 - 0.06, sd / 2 - 0.06], [sw / 2 - 0.06, -sd / 2]]) g.append(s.box(cx, cy, hookZ - 0.03, 0.06, 0.06, 0.03, PORT.steel));
    s.add(depthOver, g);
  }

  /**
   * Кран-актёр. Портал ездит по рельсам (go / update — как транспорт; модель одна при любом направлении: кран не
   * разворачивается), тележка — по балке: pose({ u } | { from?, to, start?, ms }, now) — смещение от центра вдоль axis,
   * сразу или переездом по времени; animate(now) — на каждом кадре, true — тележка ещё едет (или ждёт start). Груз — под спредером (cargoPoint):
   * контейнер висит, низом на hookZ − высота контейнера.
   * options: axis — вдоль чего балка, legs и span — смещения ног и концов балки от центра, hookZ — высота спредера,
   * trolley — где тележка сначала, label — табличка при наведении
   */
  function craneActor(s, key, color, { axis = 'x', legs = [-1, 1], span = [-2.9, 2.9], hookZ = 0.8, trolley: u = 0, label } = {}) {
    const look = { axis, legs, span, hookZ };
    const [ex, ey] = axes(s, axis).pt(span[1], CRANE.W / 2), over = ex + ey + 0.85;
    const portal = vehicleActor(s, `${key}~portal`, sc => cranePortal(sc, color, look, label), { z: hookZ - CONTAINER.H, single: true });
    const cart = s.actor(`${key}~trolley`, sc => craneTrolley(sc, look, over));
    const off = t => axis === 'x' ? [t, 0] : [0, t];
    let anim = null;
    const place = () => { const [dx, dy] = off(u); cart.moveTo(portal.pos.x + dx, portal.pos.y + dy, 0); };

    /**
     * Тележка: { u } — сразу туда; { from?, to, start?, ms } — от from (по умолчанию — где сейчас) до to за ms,
     * начиная с start (performance.now(); по умолчанию — сейчас). До start стоит в from, после — в to
     */
    function pose({ u: at, from = u, to = at, start, ms = 0 }, now = performance.now()) {
      anim = ms > 0 ? { from, to, start: start ?? now, ms } : null;
      if (!anim) { u = to; place(); } else animate(now);
    }
    function animate(now = performance.now()) {
      if (!anim) return false;
      const k = Math.min(Math.max((now - anim.start) / anim.ms, 0), 1);
      u = anim.from + (anim.to - anim.from) * k;
      place();
      if (k >= 1) anim = null;
      return anim != null;
    }
    place();
    return {
      key, pos: portal.pos, cargoZ: hookZ - CONTAINER.H, pose, animate,
      moveTo(x, y, d) { portal.moveTo(x, y, d); place(); },
      go: (points, options) => portal.go(points, options),
      update(now) { const moving = portal.update(now); place(); return moving; },
      heading: () => portal.heading(),
      cargoPoint() { const [dx, dy] = off(u); return [portal.pos.x + dx, portal.pos.y + dy, hookZ - CONTAINER.H]; },
      remove() { portal.remove(); cart.remove(); },
      get moving() { return portal.moving; },
      get trolley() { return u; },
    };
  }

  Object.assign(IsoObjects, {
    PORT, CONTAINER, CRANE, BARGE,
    water, quay, copingX, copingY, rail, hazardSlot, hangar,
    containerNode, containerActor, bargeActor, craneActor,
  });
})();
