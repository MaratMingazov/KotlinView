/*
 * Реквизит диорам, часть 4 — растительность: деревья, кусты, клумбы, трава и decorate — разбросать их по суше.
 * Подключение: после iso-vehicles.js (там объявлен IsoObjects); от остального реквизита не зависит.
 */
(() => {
  const { svg, shade, PALETTE: C, rng } = Iso;

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

  Object.assign(IsoObjects, { decorate });
})();
