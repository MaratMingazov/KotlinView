/*
 * Реквизит диорам, часть 2 — земля: остров с пляжем и лодками, дорога с мостами, разметка, плитка, столбик-счётчик.
 * Плоское — в слой земли сцены (s.ground), объёмное (камни, перила моста, столбик) — объектами с глубиной.
 * Подключение: после iso-vehicles.js (ROAD считается от размера машины).
 */
(() => {
  const { svg, shade, PALETTE: C, inside, blob, scaled } = Iso;
  const { CAR } = IsoObjects;

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

  /**
   * Соглашение «остров с дорогой» — общее для всех сцен: дорога вдоль x по полосе y = 0…1.2, концы — за мостами.
   * laneY — край машины на полосе (как в car()), lane — центр машины на полосе (так стоят актёры), ends — концы дороги
   */
  const ROAD = { laneY: 0.35, lane: 0.35 + CAR.W / 2, ends: [-6.3, 16.3] };

  Object.assign(IsoObjects, { ROAD, island, road, zebra, stopLine, slot, paved, sign });
})();
