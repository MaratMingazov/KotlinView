/*
 * Изометрический «движок» диорам на SVG: палитра, цвета, геометрия и сцена — проекция, слои, примитивы, тени, таблички.
 * Ничего не знает ни о пулах, ни о семафорах: это делают iso-objects.js (объекты) и diorama.js (сцены).
 * Подключение: первым из трёх. Всё лежит в объекте Iso.
 *
 * Мир — клетки (x, y, z): «к зрителю» — больше x + y, вверх — z. Солнце слева-сзади: грань +y светлее, +x темнее,
 * тени падают в сторону +x. Рисуем алгоритмом художника: земля → тени → объекты по глубине → таблички.
 */
const Iso = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs = {}, text) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // ---------- Цвета ----------

  const rgbOf = hex => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const toHex = rgb => '#' + rgb.map(c => Math.round(c).toString(16).padStart(2, '0')).join('');

  // k > 0 — светлее (к белому), k < 0 — темнее: три грани одного цвета дают объём.
  // Возвращает hex — результат можно затемнить ещё раз (тёмное дерево перил из цвета дерева)
  const shade = (hex, k) => toHex(rgbOf(hex).map(c => (k >= 0 ? c + (255 - c) * k : c * (1 + k))));

  // Смешать два hex-цвета: k = 0 — первый, 1 — второй
  function mix(a, b, k) {
    const [r1, g1, b1] = rgbOf(a), [r2, g2, b2] = rgbOf(b);
    return toHex([r1 + (r2 - r1) * k, g1 + (g2 - g1) * k, b1 + (b2 - b1) * k]);
  }

  function hsl(h, s, l) {
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return toHex([f(0), f(8), f(4)].map(x => x * 255));
  }

  // Оттенок потока по имени. Не как KV.threadColor ((h * 31 + c) % 360): у имён, различающихся последним символом
  // (worker-1, worker-2), там оттенки отличаются на 1°. Здесь хеш перемешивается и разносится «золотым углом»
  const hue = name => {
    let h = 2166136261;
    for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return ((h >>> 0) * 137.508) % 360;
  };
  const threadColor = name => hsl(hue(name), 60, 72);

  // ---------- Палитра: уютный остров ----------

  const PALETTE = {
    // Вода и земля
    water: '#8fd3e8', deep: '#5fb0d0', shallow: '#b4e7f1', sand: '#f3e2b3', cliff: '#e2c48c', grass: '#9fd67c', rock: '#b9b3a8',
    // Дорога и площадки
    road: '#a9b0b8', roadMark: '#fbf7ee', curb: '#f1e8d6', pad: '#efe3c8',
    // Постройки и дерево
    building: '#fff1dc', roof: '#e88f7a', glass: '#bfe3f2', wood: '#c9a27a', post: '#fff6ea', boat: '#f6efe3',
    // Растительность: зелень тёплая, с уклоном в жёлтый; ёлки темнее, но той же семьи
    trunk: '#9a6b4a', greens: ['#7cc36b', '#6cb862', '#97d070', '#84c467'], pine: '#5e9f58',
    flowers: ['#ffffff', '#f7a8b8', '#ffd86b', '#c9a7f0'],
    // Машины — одна пастельная «семья», как цвета потоков: одинаковые насыщенность и светлота
    cars: [8, 205, 44, 130, 268, 24].map(h => hsl(h, 62, 76)), wheel: '#5b4a44',
    // Смысловые цвета
    text: '#6b4f3a', ok: '#5aa469', fail: '#e0675f', accent: '#e88f7a',
    // Свет: прозрачность и размытие теней, их цвет (холодный — мягче на тёплой траве), градиент на боковых гранях
    shadow: 0.2, shadowBlur: 2.2, shadowColor: '#3b4a6b', faceGradient: 0.14, faceStroke: 0.6,
    // Таблички
    label: { bg: '#fff8ec', border: '#efe0c4', text: '#6b4f3a', dim: '#9a8672', track: '#eadcc3', rx: 8 },
  };
  const C = PALETTE;

  // ---------- Геометрия ----------

  // Выпуклая оболочка точек [x, y] — монотонная цепь Эндрю
  function convexHull(points) {
    const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const half = list => {
      const out = [];
      for (const q of list) {
        while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop();
        out.push(q);
      }
      out.pop();
      return out;
    };
    return [...half(p), ...half([...p].reverse())];
  }

  // Точка внутри многоугольника (луч вправо, чётность пересечений)
  function inside(poly, x, y) {
    let r = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) r = !r;
    }
    return r;
  }

  // Неровный эллипс: радиус «дышит» несколькими гармониками — берег и камни выглядят природно, но без острых углов
  function blob(cx, cy, rx, ry, seed, n = 120) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const k = 1 + 0.05 * Math.sin(3 * a + seed) + 0.035 * Math.cos(5 * a + 2 * seed) + 0.02 * Math.sin(9 * a + 3 * seed);
      pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
    }
    return pts;
  }
  const scaled = (poly, cx, cy, f) => poly.map(([x, y]) => [cx + (x - cx) * f, cy + (y - cy) * f]);

  // Прямоугольник со скруглёнными углами — основание для призмы (кузов, кабина)
  function roundedRect(x, y, w, d, r, n = 4) {
    const list = [];
    const corner = (cx, cy, from) => {
      for (let i = 0; i <= n; i++) {
        const a = from + (i / n) * (Math.PI / 2);
        list.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
    };
    corner(x + w - r, y + r, -Math.PI / 2); corner(x + w - r, y + d - r, 0);
    corner(x + r, y + d - r, Math.PI / 2); corner(x + r, y + r, Math.PI);
    return list;
  }

  // Детерминированный «случайный» генератор (mulberry32): сцена каждый раз одна и та же, но выглядит естественно
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- Сцена ----------

  const S = 30;                     // пикселей на клетку
  const SUN = [0.85, 0.12];         // смещение тени на единицу высоты (мир, x / y): солнце слева-сзади
  const LABEL = { font: 11, small: 10, char: 6.6, lineH: 13, padX: 8, padY: 4, dot: 4, lift: 8 };
  let sceneCount = 0;

  /**
   * Новая сцена. Объекты кладут узлы в слои: ground (земля, по порядку добавления), тени, objects (по глубине),
   * таблички. render() собирает всё в <svg>; viewBox — по границам всего нарисованного.
   */
  function createScene() {
    const P = (x, y, z) => [(x - y) * 0.866 * S, (x + y) * 0.5 * S - z * S]; // изометрия 30°
    const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    const track = (sx, sy) => {
      bounds.minX = Math.min(bounds.minX, sx); bounds.maxX = Math.max(bounds.maxX, sx);
      bounds.minY = Math.min(bounds.minY, sy); bounds.maxY = Math.max(bounds.maxY, sy);
    };
    const ground = [], shadows = [], contacts = [], objects = [], labels = [];
    const uid = `d${++sceneCount}`; // id градиентов и табличек уникальны: на странице несколько диорам
    let land = null, hud = null, labelCount = 0;

    // Точки мира → атрибут points; заодно расширяют границы сцены
    const pts = list => list.map(([x, y, z]) => { const [sx, sy] = P(x, y, z); track(sx, sy); return `${sx.toFixed(1)},${sy.toFixed(1)}`; }).join(' ');
    // Контур грани — её же цветом: так между соседними гранями нет «волосяных» щелей
    const faceStyle = (fill, opacity = 1) =>
      `fill: ${fill}; fill-opacity: ${opacity}; stroke: ${fill}; stroke-width: ${C.faceStroke}; stroke-linejoin: round`;

    // ---------- Примитивы ----------

    // Боковая грань: заливка и накладка-градиент — к низу грань чуть темнее, как от рассеянного света
    function side(g, points, fill, opacity = 1, h = 1) {
      g.append(svg('polygon', { points, style: faceStyle(fill, opacity) }));
      if (h > 0.12) g.append(svg('polygon', { points, style: `fill: url(#${uid}-fg); stroke: none; pointer-events: none` }));
    }

    // Коробка: видны верх и две грани к зрителю — +y (левая) и +x (правая)
    function box(x, y, z, w, d, h, color, opacity = 1) {
      const g = svg('g');
      side(g, pts([[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]]), shade(color, -0.15), opacity, h);
      side(g, pts([[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]]), shade(color, -0.32), opacity, h);
      g.append(svg('polygon', { points: pts([[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]]), style: faceStyle(shade(color, 0.1), opacity) }));
      return g;
    }

    /**
     * Призма с любым основанием (мир, x / y): видны боковые грани, чья внешняя нормаль смотрит к зрителю (+x / +y),
     * и верх. Оттенок грани — по направлению нормали, как у box: к +y светлее, к +x темнее. Скруглённые формы — отсюда
     */
    function prism(base, z, h, color) {
      const g = svg('g');
      const cx = base.reduce((a, p) => a + p[0], 0) / base.length, cy = base.reduce((a, p) => a + p[1], 0) / base.length;
      const sides = [];
      for (let i = 0; i < base.length; i++) {
        const [x1, y1] = base[i], [x2, y2] = base[(i + 1) % base.length];
        let nx = y2 - y1, ny = -(x2 - x1);
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        if (nx * (mx - cx) + ny * (my - cy) < 0) { nx = -nx; ny = -ny; } // нормаль — наружу
        if (nx + ny <= 1e-9) continue;
        const t = Math.max(0, nx) / (Math.max(0, nx) + Math.max(0, ny) || 1);
        sides.push({ depth: mx + my, fill: shade(color, -0.15 - 0.17 * t), p: [[x1, y1, z], [x2, y2, z], [x2, y2, z + h], [x1, y1, z + h]] });
      }
      for (const f of sides.sort((a, b) => a.depth - b.depth)) side(g, pts(f.p), f.fill, 1, h);
      g.append(svg('polygon', { points: pts(base.map(([x, y]) => [x, y, z + h])), style: faceStyle(shade(color, 0.1)) }));
      return g;
    }

    // Диск на вертикальной плоскости: 'y' — плоскость x-z (колёса на ближнем боку), 'x' — плоскость y-z (фары спереди)
    function disc(x, y, z, r, plane, fill) {
      const list = [];
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2, u = Math.cos(a) * r, v = Math.sin(a) * r;
        list.push(plane === 'y' ? [x + u, y, z + v] : [x, y + u, z + v]);
      }
      return svg('polygon', { points: pts(list), style: `fill: ${fill}; stroke: ${shade(fill, -0.2)}; stroke-width: .6` });
    }

    // Прямоугольник на ближней грани: 'y' — на грани +y (от a0 до a1 по x), 'x' — на грани +x (по y). Окна, двери
    function panel(plane, at, a0, a1, z0, z1, fill) {
      const list = plane === 'y'
        ? [[a0, at, z0], [a1, at, z0], [a1, at, z1], [a0, at, z1]]
        : [[at, a0, z0], [at, a1, z0], [at, a1, z1], [at, a0, z1]];
      return svg('polygon', { points: pts(list), style: `fill: ${fill}; stroke: ${shade(fill, -0.2)}; stroke-width: .6; stroke-linejoin: round` });
    }

    // Двускатная крыша вдоль x над прямоугольником (x, y, w, d) с основанием на высоте z: конёк посередине по y
    function gableRoof(x, y, w, d, z, rise, color, overhang = 0.15) {
      const g = svg('g'), o = overhang, ym = y + d / 2;
      const face = (list, k) => svg('polygon', { points: pts(list), style: faceStyle(shade(color, k)) });
      g.append(
        face([[x - o, y - o, z], [x + w + o, y - o, z], [x + w + o, ym, z + rise], [x - o, ym, z + rise]], 0.05),          // дальний скат
        face([[x + w, y, z], [x + w, y + d, z], [x + w, ym, z + rise]], -0.3),                                              // фронтон справа
        face([[x - o, y + d + o, z], [x + w + o, y + d + o, z], [x + w + o, ym, z + rise], [x - o, ym, z + rise]], -0.08), // ближний скат
      );
      return g;
    }

    // Плоский прямоугольник на полу (асфальт, площадка, разметка)
    const flat = (x, y, w, d, color, z = 0) =>
      svg('polygon', { points: pts([[x, y, z], [x + w, y, z], [x + w, y + d, z], [x, y + d, z]]), style: `fill: ${color}; stroke: ${color}; stroke-width: .5` });

    function line(from, to, color) {
      const [a, b] = [P(...from), P(...to)];
      return svg('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], style: `stroke: ${color}; stroke-width: 1.5` });
    }

    // ---------- Тени ----------

    // Круглая тень (крона, куст, лодка): эллипс, сдвинутый от основания по солнцу на высоту h
    function shadow(cx, cy, r, h = 0.4, z = 0) {
      const [sx, sy] = P(cx + SUN[0] * h, cy + SUN[1] * h, z);
      shadows.push(svg('ellipse', { cx: sx, cy: sy, rx: r * S, ry: r * S * 0.5 }));
    }

    // Тень коробки (x, y, w, d) высотой h: выпуклая оболочка основания и его копии, сдвинутой по солнцу
    function castShadow(x, y, w, d, h, z = 0) {
      const dx = SUN[0] * h, dy = SUN[1] * h;
      const corners = [[x, y], [x + w, y], [x + w, y + d], [x, y + d]];
      const hull = convexHull([...corners, ...corners.map(([cx, cy]) => [cx + dx, cy + dy])]);
      shadows.push(svg('polygon', { points: pts(hull.map(([hx, hy]) => [hx, hy, z])) }));
      contact(x, y, w, d, z);
    }

    // Контактная тень: тёмная кромка прямо под основанием — объект стоит на земле, а не висит
    function contact(x, y, w, d, z = 0) {
      const e = 0.04;
      contacts.push(svg('polygon', { points: pts([[x - e, y - e, z], [x + w + e, y - e, z], [x + w + e, y + d + e, z], [x - e, y + d + e, z]]) }));
    }

    // ---------- Таблички: постоянные (короткие счётчики) видны всегда, остальные — при наведении ----------

    /**
     * Табличка над точкой мира (x, y, z). lines — строки сверху вниз (первая — жирная); color — точка слева
     * (цвет потока или машины); bar — полоска прогресса внутри { fraction, color }.
     * permanent — видна всегда («3 / 5», «✓ 17»); иначе — только при наведении на объект, к которому её привязали hover()
     */
    function label(x, y, z, lines, { color, bar, permanent = false } = {}) {
      const [ax, ay] = P(x, y, z);
      const dot = color && color !== C.text ? color : null;
      const textW = Math.max(...lines.map((l, i) => l.length * LABEL.char * (i === 0 ? 1 : LABEL.small / LABEL.font)));
      const w = Math.round(textW + 2 * LABEL.padX + (dot ? LABEL.dot * 2 + 5 : 0));
      const h = lines.length * LABEL.lineH + 2 * LABEL.padY + (bar ? 8 : 0);
      const l = { id: `${uid}-l${++labelCount}`, ax, ay, w, h, lines, dot, bar, permanent, rect: { x: ax - w / 2, y: ay - LABEL.lift - h, w, h } };
      if (permanent) { track(l.rect.x, l.rect.y); track(l.rect.x + w, l.rect.y + h); }
      labels.push(l);
      return l;
    }

    // Объект показывает табличку при наведении: на узел вешается ссылка, обработчик — один на сцену (wireHover)
    function hover(node, l) {
      node.setAttribute('data-label', l.id);
      node.setAttribute('class', 'hoverable');
      return node;
    }

    // Заголовок диорамы в углу — вместо табличек, плавающих над сценой
    const title = lines => { hud = lines; };

    // Табличка целиком внутри viewBox: у края сцены всплывающая не уезжает за рамку
    function clamp(l, vb) {
      const r = l.rect, m = 4;
      r.x = Math.min(Math.max(r.x, vb.x + m), vb.x + vb.w - r.w - m);
      r.y = Math.max(r.y, vb.y + m);
    }

    function labelNode(l) {
      const { x, y, w, h } = l.rect, L = C.label;
      const g = svg('g', { id: l.id, class: l.permanent ? 'dlabel permanent' : 'dlabel', style: `pointer-events: none${l.permanent ? '' : '; display: none'}` });
      // Хвостик к якорю — если табличку не пришлось сдвигать у края
      if (Math.abs(l.ax - (x + w / 2)) < w / 2 - 6) {
        g.append(svg('polygon', { points: `${l.ax - 5},${y + h - 1} ${l.ax + 5},${y + h - 1} ${l.ax},${y + h + 6}`, style: `fill: ${L.bg}` }));
      }
      g.append(svg('rect', { x, y: y + 2, width: w, height: h, rx: L.rx, style: 'fill: #000; opacity: .12' }));
      g.append(svg('rect', { x, y, width: w, height: h, rx: L.rx, style: `fill: ${L.bg}; stroke: ${L.border}; stroke-width: 1` }));
      let tx = x + LABEL.padX;
      if (l.dot) {
        g.append(svg('circle', { cx: tx + LABEL.dot, cy: y + LABEL.padY + LABEL.lineH / 2 + 0.5, r: LABEL.dot, style: `fill: ${l.dot}` }));
        tx += LABEL.dot * 2 + 5;
      }
      l.lines.forEach((text, i) => {
        g.append(svg('text', { x: tx, y: y + LABEL.padY + 10 + i * LABEL.lineH,
          style: `font-size: ${i ? LABEL.small : LABEL.font}px; font-weight: ${i ? 'normal' : 'bold'}; fill: ${i ? L.dim : L.text}` }, text));
      });
      if (l.bar) {
        const by = y + h - LABEL.padY - 5, bw = w - 2 * LABEL.padX;
        g.append(svg('rect', { x: x + LABEL.padX, y: by, width: bw, height: 5, rx: 2.5, style: `fill: ${L.track}` }),
                 svg('rect', { x: x + LABEL.padX, y: by, width: Math.max(bw * l.bar.fraction, 5), height: 5, rx: 2.5, style: `fill: ${l.bar.color}` }));
      }
      return g;
    }

    // Шапка — в первом углу, где не налезает на постоянные таблички (обычно там вода)
    function hudNode(vb) {
      const L = C.label, g = svg('g', { style: 'pointer-events: none' });
      const w = Math.max(...hud.map((t, i) => t.length * LABEL.char * (i ? LABEL.small / LABEL.font : 1))) + 2 * 10;
      const h = hud.length * 14 + 10, m = 12;
      const corners = [[vb.x + m, vb.y + m], [vb.x + m, vb.y + vb.h - h - m], [vb.x + vb.w - w - m, vb.y + m], [vb.x + vb.w - w - m, vb.y + vb.h - h - m]];
      const free = ([cx, cy]) => !labels.some(({ permanent, rect: r }) => permanent && r.x < cx + w && cx < r.x + r.w && r.y < cy + h && cy < r.y + r.h);
      const [x, y] = corners.find(free) ?? corners[0];
      g.append(svg('rect', { x, y, width: w, height: h, rx: L.rx, style: `fill: ${L.bg}; opacity: .92; stroke: ${L.border}` }));
      hud.forEach((t, i) => g.append(svg('text', { x: x + 10, y: y + 17 + i * 14,
        style: `font-size: ${i ? LABEL.small : 12}px; font-weight: ${i ? 'normal' : 'bold'}; fill: ${i ? L.dim : L.text}` }, t)));
      return g;
    }

    /**
     * Наведение: над объектом с data-label — показать его табличку и подсветить сам объект.
     * Один обработчик на всю диораму (делегирование), а не по обработчику на объект
     */
    function wireHover(root) {
      let current = null;
      const show = target => {
        if (current === target) return;
        if (current) {
          current.style.filter = '';
          const old = root.querySelector(`#${current.getAttribute('data-label')}`);
          if (old) old.style.display = 'none';
        }
        current = target;
        if (!target) return;
        target.style.filter = 'brightness(1.12) drop-shadow(0 0 3px #ffffff)';
        const l = root.querySelector(`#${target.getAttribute('data-label')}`);
        if (l) l.style.display = '';
      };
      root.addEventListener('mouseover', e => show(e.target.closest('[data-label]')));
      root.addEventListener('mouseleave', () => show(null));
    }

    // ---------- Сборка ----------

    const add = (depth, node) => objects.push({ depth, node });
    const setLand = polygon => { land = polygon; };
    const onLand = (x, y) => !land || inside(land, x, y);

    function defs() {
      const d = svg('defs');
      // Вода светлее у острова и темнее к краям — остров «в центре внимания»
      const water = svg('radialGradient', { id: `${uid}-water`, cx: '50%', cy: '48%', r: '70%' });
      water.append(svg('stop', { offset: '0%', 'stop-color': C.water }), svg('stop', { offset: '100%', 'stop-color': C.deep }));
      const blur = (id, sd) => {
        const f = svg('filter', { id, x: '-20%', y: '-20%', width: '140%', height: '140%' });
        f.append(svg('feGaussianBlur', { stdDeviation: sd }));
        return f;
      };
      const fg = svg('linearGradient', { id: `${uid}-fg`, x1: 0, y1: 0, x2: 0, y2: 1 });
      fg.append(svg('stop', { offset: '0%', 'stop-color': '#000', 'stop-opacity': 0 }), svg('stop', { offset: '100%', 'stop-color': '#000', 'stop-opacity': C.faceGradient }));
      d.append(water, blur(`${uid}-soft`, C.shadowBlur), blur(`${uid}-contact`, C.shadowBlur / 2), fg);
      return d;
    }

    // Слой теней: общая прозрачность на всю группу — там, где тени пересекаются, нет двойного затемнения
    function shadowLayer(nodes, opacity, filter) {
      const g = svg('g', { filter: `url(#${filter})`, style: `fill: ${C.shadowColor}; opacity: ${opacity}; pointer-events: none` });
      g.append(...nodes);
      return g;
    }

    function render() {
      const pad = 18;
      const vb = { x: bounds.minX - pad, y: bounds.minY - pad, w: bounds.maxX - bounds.minX + 2 * pad, h: bounds.maxY - bounds.minY + 2 * pad };
      const root = svg('svg', { viewBox: `${vb.x} ${vb.y} ${vb.w} ${vb.h}`, width: '100%', class: 'diorama' });
      root.append(defs(), svg('rect', { x: vb.x, y: vb.y, width: vb.w, height: vb.h, rx: 6, style: `fill: url(#${uid}-water)` }));
      root.append(...ground);
      root.append(shadowLayer(shadows, C.shadow, `${uid}-soft`), shadowLayer(contacts, Math.min(C.shadow * 1.8, 0.5), `${uid}-contact`));
      root.append(...objects.sort((a, b) => a.depth - b.depth).map(o => o.node));
      // Таблички — поверх всего; всплывающие не выходят за рамку
      for (const l of labels) clamp(l, vb);
      root.append(...[...labels].sort((a, b) => a.ay - b.ay).map(labelNode));
      if (hud) root.append(hudNode(vb));
      wireHover(root);
      return root;
    }

    return {
      P, S, pts, faceStyle, ground, add, setLand, onLand, render,
      box, prism, disc, panel, gableRoof, flat, line,
      shadow, castShadow, contact,
      label, hover, title,
      shore: null, shoreCenter: null, // контур берега и центр острова — их задаёт island() в iso-objects.js
    };
  }

  return { svg, shade, mix, hsl, threadColor, PALETTE, createScene, inside, blob, scaled, roundedRect, rng };
})();
