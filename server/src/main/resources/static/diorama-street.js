/*
 * Каркас «остров с дорогой» — общий для описаний структур: остров, дорога вдоль x (одна или кусками), места
 * на полосе со связями по цепочке, въезд и выезд за мостами, линия ожидания с «+N», растительность вне занятых зон.
 * Описанию остаётся смысл: какой реквизит, где его места, что обновлять.
 *
 * Подключение: после diorama-kit.js, до описаний структур (diorama-*.js). Добавляет в Kit функцию street.
 */
(() => {
  const O = IsoObjects, R = O.ROAD;
  const ROAD_ZONE = [-8, -0.3, 18, 1.5]; // дорога с бордюрами — растительности там не место

  /**
   * Остров и дорога; дальше — места и зоны, в конце layout(...) — растительность и готовый Layout.
   * options: island — [x0, y0, x1, y1], seed — берег; roads — куски дороги [[x0, x1], …] (по умолчанию — вся,
   * R.ends), skip — [от, до] по x без пунктира (только для дороги целиком); entry / exit — имена въезда и выезда
   * (по умолчанию 'entry' / 'exit': слева и справа за мостами)
   */
  function street(s, { island, seed, roads = null, skip = null, entry = 'entry', exit = 'exit' }) {
    O.island(s, ...island, seed);
    if (roads) for (const [x0, x1] of roads) O.road(s, x0, x1);
    else O.road(s, ...R.ends, skip ? { skip } : undefined);

    const onLane = x => [x, R.lane];
    const places = { [entry]: onLane(R.ends[0] - 0.3), [exit]: onLane(R.ends[1] + 0.3) };
    const lane = [entry, exit]; // места на полосе: связываются по цепочке сами
    const zones = [ROAD_ZONE];

    function lanePlace(name, x) {
      places[name] = onLane(x);
      lane.push(name);
      return places[name];
    }

    // Место вне полосы (бокс, колонка): связи с ним — свои, в layout({ links })
    function place(name, at) {
      places[name] = at;
      return at;
    }

    /**
     * Линия ожидания на полосе: места prefix0 … prefix{n−1} (xOf(i) — центр машины) и «+N» над хвостом —
     * ждущих больше, чем мест. update(count) — показать или спрятать «+N»
     */
    function waitLine(prefix, n, xOf) {
      for (let i = 0; i < n; i++) lanePlace(`${prefix}${i}`, xOf(i));
      const more = s.label(xOf(n - 1), R.lane, 0.62, ['+0'], { permanent: true });
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
      return { places, links: [...Kit.lane(places, lane), ...links], entry, exit, ...rest };
    }

    return { onLane, places, lanePlace, place, waitLine, keepOut, layout };
  }

  Object.assign(Kit, { street });
})();
