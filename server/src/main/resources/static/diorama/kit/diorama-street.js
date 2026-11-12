/*
 * Каркас «остров с дорогой» — общий для описаний структур: остров, дорога вдоль x или y (одна или кусками), места
 * на полосе со связями по цепочке, въезд и выезд за мостами, линия ожидания с «+N», растительность вне занятых зон.
 * Описанию остаётся смысл: какой реквизит, где его места, что обновлять.
 *
 * Подключение: после diorama-kit.js, до описаний структур (diorama-*.js). Добавляет в Kit функцию street.
 */
(() => {
  const O = IsoObjects, R = O.ROAD;
  /**
   * Остров и дорога; дальше — места и зоны, в конце layout(...) — растительность и готовый Layout.
   * options: island — [x0, y0, x1, y1], seed — берег; axis — вдоль чего дорога ('x' по умолчанию или 'y'),
   * at — где её полоса поперёк (начало полосы шириной 1.2: y у дороги вдоль x, x у дороги вдоль y), ends — концы
   * вдоль хода (по умолчанию R.ends); roads — куски дороги [[от, до], …] (по умолчанию — вся), skip — [от, до] без
   * пунктира (только для дороги целиком); entry / exit — имена въезда и выезда (по умолчанию 'entry' / 'exit':
   * в начале и в конце дороги, за мостами). Места на полосе задаются по ходу дороги: lanePlace(name, u).
   * ground — основание: 'island' (остров в воде) или 'slab' (парящая плита: на ней же поместится то, что на острове;
   * дорога — от края до края плиты, без мостов; въезд и выезд — у краёв)
   */
  function street(s, { island, seed, axis = 'x', at = 0, ends = R.ends, roads = null, skip = null, entry = 'entry', exit = 'exit', ground = 'island' }) {
    if (ground === 'slab') {
      // Плита — по размеру острова (у острова берег шире прямоугольника); дорога — до краёв плиты
      const [x0, y0, x1, y1] = [island[0] - 0.4, island[1] - 0.6, island[2] + 0.4, island[3] + 0.6];
      O.slab(s, x0, y0, x1, y1);
      ends = axis === 'y' ? [y0 + 0.35, y1 - 0.35] : [x0 + 0.35, x1 - 0.35];
      // Куски дороги — тоже не дальше краёв плиты (иначе за краем построились бы мосты)
      if (roads) roads = roads.map(([u0, u1]) => [Math.max(u0, ends[0]), Math.min(u1, ends[1])]);
    } else {
      O.island(s, ...island, seed);
    }
    const band = { axis, v0: at, v1: at + 1.2 };
    if (roads) for (const [u0, u1] of roads) O.road(s, u0, u1, band);
    else O.road(s, ...ends, { ...band, skip });

    // Точка на полосе по ходу дороги u; зона дороги с бордюрами — растительности там не место
    const onLane = axis === 'y' ? u => [at + R.lane, u] : u => [u, at + R.lane];
    const roadZone = axis === 'y' ? [at - 0.3, ends[0] - 2, at + 1.5, ends[1] + 2] : [ends[0] - 2, at - 0.3, ends[1] + 2, at + 1.5];
    const places = { [entry]: onLane(ends[0] - 0.3), [exit]: onLane(ends[1] + 0.3) };
    const lane = [entry, exit]; // места на полосе: связываются по цепочке сами
    const zones = [roadZone];

    function lanePlace(name, u) {
      places[name] = onLane(u);
      lane.push(name);
      return places[name];
    }

    // Место вне полосы (бокс, колонка): связи с ним — свои, в layout({ links })
    function place(name, at) {
      places[name] = at;
      return at;
    }

    /**
     * Линия ожидания на полосе: места prefix0 … prefix{n−1} (uOf(i) — центр машины по ходу) и «+N» над хвостом —
     * ждущих больше, чем мест. update(count) — показать или спрятать «+N»
     */
    function waitLine(prefix, n, uOf) {
      for (let i = 0; i < n; i++) lanePlace(`${prefix}${i}`, uOf(i));
      const more = s.label(...onLane(uOf(n - 1)), 0.62, ['+0'], { permanent: true });
      return {
        update(count) {
          const extra = count - n;
          if (extra > 0) s.relabel(more, [`+${extra}`]);
          s.showLabel(more, extra > 0);
        },
      };
    }

    // Зоны [x0, y0, x1, y1] без растительности: реквизит, площадки, места машин
    const keepOut = (...rects) => { zones.push(...rects); };

    /** Растительность (decorSeed — у каждой сцены свой пейзаж) и Layout: связи по полосе + links описания. */
    function layout(decorSeed, { links = [], ...rest } = {}) {
      O.decorate(s, decorSeed, zones);
      return { places, links: [...Kit.lane(places, lane, axis), ...links], entry, exit, ...rest };
    }

    return { onLane, places, lanePlace, place, waitLine, keepOut, layout };
  }

  Object.assign(Kit, { street });
})();
