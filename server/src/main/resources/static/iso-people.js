/*
 * Реквизит диорам — люди: пешеход (жилец, выходит из двери) и курьер на самокате с термокоробом за спиной.
 * Фигурки «игрушечные», коренастые: при S = 30 человек — около 20 px, цвет потока должен читаться — поэтому
 * одежда (у курьера ещё и короб) — его цветом. Актёры — через общий vehicleActor (iso-vehicles.js): четыре
 * направления, позиция — центр, cargoPoint() — где груз (у пешехода — в руках, у курьера — на коробе).
 * Подключение: после iso-vehicles.js. Дописывает в IsoObjects.
 */
(() => {
  const { svg, shade, PALETTE: C } = Iso;
  const O = IsoObjects;

  const PERSON = { skin: '#f2c9a0', hair: '#6b4a3a', legs: '#5b5f6e', eye: '#3d3a3a', r: 0.12 };
  const SCOOTER = { deck: '#5b5f66', stem: '#8a8f96', grip: '#3d3f44' };

  // Многоугольник-круг — основание цилиндра (туловище, голова)
  const circle = (cx, cy, r, n = 12) => Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });

  /**
   * Локальные оси модели: u — вперёд по направлению dir ('x', 'x-', 'y+', 'y-'), v — поперёк (+v — ближний к зрителю
   * бок). Части собираются в списке с глубиной и рисуются от дальних к ближним — фигурка из мелких частей
   */
  function axes(s, dir) {
    const along = dir[0], sign = dir.endsWith('-') ? -1 : 1;
    const at = (u, v) => along === 'x' ? [sign * u, v] : [v, sign * u];
    const parts = [];
    const put = (u, v, node) => { const [x, y] = at(u, v); parts.push({ depth: x + y, node }); };
    return {
      // Коробка: u, v — ближний к началу угол в локальных осях; du, dv — размеры
      box(u, v, z, du, dv, h, col) {
        const a = sign > 0 ? u : -u - du;
        put(u + du / 2, v + dv / 2, along === 'x' ? s.box(a, v, z, du, dv, h, col) : s.box(v, a, z, dv, du, h, col));
      },
      cyl(u, v, z, r, h, col) { const [x, y] = at(u, v); put(u, v, s.prism(circle(x, y, r), z, h, col)); },
      // Колесо на ближнем боку
      wheel(u, z, r, col) {
        put(u, 0.2, along === 'x' ? s.disc(sign * u, 0.1, z, r, 'y', col) : s.disc(0.1, sign * u, z, r, 'x', col));
      },
      // Глаза на лице — только если лицо к зрителю (+x или +y); сзади видны волосы
      eyes(u, r, z) {
        if (sign < 0) return;
        const plane = along === 'x' ? 'x' : 'y', face = u + r + 0.002;
        for (const v of [-0.04, 0.02]) put(u + r, v + 0.3, s.panel(plane, face, v, v + 0.022, z, z + 0.03, PERSON.eye));
      },
      node() {
        const g = svg('g');
        for (const p of parts.sort((a, b) => a.depth - b.depth)) g.append(p.node);
        return g;
      },
    };
  }

  /**
   * Фигурка в осях ax: центр на u, ноги от высоты z0. reach — руки вперёд на эту длину (держит руль), иначе вдоль тела
   */
  function figure(ax, u, z0, color, { reach = 0 } = {}) {
    const { r, skin, hair, legs } = PERSON;
    for (const v of [-0.075, 0.015]) ax.box(u - 0.035, v, z0, 0.07, 0.06, 0.16, legs);         // ноги
    ax.cyl(u, 0, z0 + 0.14, r, 0.24, color);                                                    // туловище
    for (const v of [-r - 0.05, r - 0.01]) {                                                    // руки
      if (reach) ax.box(u, v, z0 + 0.3, reach, 0.06, 0.06, shade(color, -0.12));
      else ax.box(u - 0.03, v, z0 + 0.17, 0.06, 0.06, 0.19, shade(color, -0.12));
    }
    ax.cyl(u, 0, z0 + 0.39, 0.1, 0.15, skin);                                                   // голова
    ax.cyl(u, 0, z0 + 0.52, 0.105, 0.04, hair);                                                 // волосы
    ax.eyes(u, 0.1, z0 + 0.45);
  }

  /** Пешеход вокруг начала координат, лицом по dir. Одежда — цветом потока. label — табличка при наведении */
  function personModel(s, color, dir, { label } = {}) {
    const ax = axes(s, dir);
    figure(ax, 0, 0, color);
    const g = ax.node();
    s.shadow(0, 0, 0.16, 0.5);
    if (label) s.hover(g, s.label(0, 0, 0.85, label.lines, label));
    s.add(0.3, g);
  }

  /** Жилец-актёр: груз — в руках, чуть впереди. */
  const personActor = (s, key, color, options = {}) =>
    O.vehicleActor(s, key, (sc, dir) => personModel(sc, color, dir, options), { z: 0.2, ahead: 0.2 });

  /**
   * Курьер на самокате вокруг начала координат, по ходу dir: дека, колёса, руль; курьер стоит на деке, держит руль,
   * за спиной — термокороб. Короб и куртка — цветом потока (короб — крупное пятно, по нему цвет читается издалека)
   */
  function courierModel(s, color, dir, { label } = {}) {
    const ax = axes(s, dir), { deck, stem, grip } = SCOOTER;
    ax.box(-0.34, -0.09, 0.06, 0.66, 0.18, 0.05, deck);           // дека
    for (const u of [-0.27, 0.27]) ax.wheel(u, 0.07, 0.07, C.wheel);
    ax.box(0.27, -0.02, 0.1, 0.04, 0.04, 0.55, stem);             // стойка руля
    ax.box(0.26, -0.15, 0.63, 0.06, 0.3, 0.03, grip);             // руль
    figure(ax, -0.04, 0.11, shade(color, -0.1), { reach: 0.28 });
    ax.box(-0.42, -0.15, 0.3, 0.22, 0.3, 0.32, color);            // термокороб за спиной
    ax.box(-0.425, -0.155, 0.56, 0.23, 0.31, 0.03, shade(color, 0.35)); // светлая полоса
    const g = ax.node();
    const along = dir[0];
    if (along === 'x') s.castShadow(-0.36, -0.12, 0.72, 0.24, 0.5); else s.castShadow(-0.12, -0.36, 0.24, 0.72, 0.5);
    if (label) s.hover(g, s.label(0, 0, 1.0, label.lines, label));
    // Мельче пакета на коробе: едет к зрителю — короб сзади, пакет на нём глубже центра всего на −0.2
    s.add(dir.endsWith('-') ? 0.3 : -0.3, g);
  }

  /** Курьер-актёр: груз — на крышке термокороба, позади. */
  const courierActor = (s, key, color, options = {}) =>
    O.vehicleActor(s, key, (sc, dir) => courierModel(sc, color, dir, options), { z: 0.63, ahead: -0.31 });

  // ---------- Груз: пакет с едой ----------

  const BAG = { w: 0.22, d: 0.16, h: 0.22, paper: '#dcb684' };

  // Бумажный пакет: тело, загнутый верх темнее, ручка-скоба
  function bagNode(s, x, y, z) {
    const g = svg('g'), { w, d, h, paper } = BAG;
    g.append(s.box(x, y, z, w, d, h, paper));
    g.append(s.box(x - 0.005, y - 0.005, z + h - 0.05, w + 0.01, d + 0.01, 0.05, shade(paper, -0.18)));
    g.append(s.line([x + 0.06, y + d / 2, z + h], [x + 0.06, y + d / 2, z + h + 0.06], shade(paper, -0.4)),
             s.line([x + 0.06, y + d / 2, z + h + 0.06], [x + w - 0.06, y + d / 2, z + h + 0.06], shade(paper, -0.4)),
             s.line([x + w - 0.06, y + d / 2, z + h + 0.06], [x + w - 0.06, y + d / 2, z + h], shade(paper, -0.4)));
    return g;
  }

  /** Пакет-актёр: центр основания — в (x, y), низ — на высоте z. Без тени, как ящик: его несут. */
  function bagActor(s, key, { label } = {}) {
    const a = s.actor(key, sc => {
      const node = bagNode(sc, -BAG.w / 2, -BAG.d / 2, 0);
      if (label) sc.hover(node, sc.label(0, 0, BAG.h + 0.3, label.lines, label));
      sc.add(0.1, node);
    });
    return { key, moveTo: (x, y, z = 0) => a.moveTo(x, y, z), remove: () => a.remove() };
  }

  Object.assign(IsoObjects, { PERSON, personActor, courierActor, BAG, bagActor });
})();
