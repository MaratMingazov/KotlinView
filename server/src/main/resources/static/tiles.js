/*
 * Плитки: одна плитка — один живой объект. Пока его нет, плитка спит: только название, параметры создания и start;
 * по start объект создаётся, плитка запоминает его id и показывает только его. remove — DELETE; плитка засыпает
 * по OBJECT_REMOVED (пул сервер удалит только TERMINATED — отказ видно в плитке).
 * Перезагрузка страницы: объект остаётся на сервере, плитка снова спит (пока так).
 *
 * Плитка ничего не знает о конкретной структуре — всё берёт из её описания (view):
 * title, params, types, createStore(render), create(values), remove(store, id), operations, renderState(store, item),
 * renderTitleExtra?(store, item) — что показать сразу после названия.
 * params — [имя, значение по умолчанию, { min, max }?]: булево значение — чекбокс, число — поле с ограничениями.
 *
 * Подключение: после base.js, components.js и скриптов структур. Стили — tiles.css. Всё лежит в объекте Tiles.
 */
const Tiles = (() => {
  const isBoolean = value => typeof value === 'boolean';

  // Числовой параметр — в своих пределах: так в поле не пройдёт 100500, даже если вписать руками
  const clamp = (value, { min = 1, max = Infinity } = {}) => Math.min(Math.max(value, min), max);

  /**
   * Состояние плитки: id — её объект (null — спит); seen — объект уже приходил в событиях; starting — ждём ответ на create.
   * Заголовок и поля параметров создаются один раз: спящая и живая плитка просто ставят их к себе, введённое не теряется
   */
  function createTile(view, render) {
    const tile = { view, store: view.createStore(render), id: null, seen: false, starting: false, mode: null, render };
    tile.el = KV.el('div', 'tile');
    tile.title = KV.el('div', 'tile-title', view.title);
    tile.titleExtra = KV.el('span', 'tile-title-extra');
    tile.inputs = {};
    tile.limits = {};
    tile.params = KV.el('div', 'tile-params');
    // Каждый параметр — своей строкой: имя и поле
    for (const [name, value, limits = {}] of view.params) {
      const input = isBoolean(value)
        ? Object.assign(document.createElement('input'), { type: 'checkbox', checked: value })
        : Object.assign(document.createElement('input'), { type: 'number', value, min: limits.min ?? 1, ...(limits.max != null && { max: limits.max }) });
      input.setAttribute('aria-label', name);
      if (limits.max != null) input.title = `${limits.min ?? 1}…${limits.max}`;
      input.addEventListener('keydown', e => { if (e.key === 'Enter') start(tile); });
      tile.inputs[name] = input;
      tile.limits[name] = limits;
      const row = KV.el('label', 'param');
      row.append(KV.el('span', 'name', name), input);
      tile.params.append(row);
    }
    tile.controls = KV.el('div', 'tile-controls');
    tile.body = KV.el('div', 'tile-body');
    tile.main = KV.el('div', 'tile-main');
    tile.main.append(tile.controls, tile.body);
    return tile;
  }

  async function start(tile) {
    if (tile.starting || tile.id != null) return; // Enter в поле, пока ждём ответ, — не второй объект
    tile.starting = true;
    tile.render();
    const values = {};
    for (const [name, input] of Object.entries(tile.inputs)) {
      if (input.type === 'checkbox') { values[name] = input.checked; continue; }
      const value = clamp(Number(input.value) || 0, tile.limits[name]);
      input.value = value; // видно, с каким значением на самом деле создали
      values[name] = value;
    }
    const created = await tile.view.create(values);
    tile.starting = false;
    // Объект появится в store по OBJECT_CREATED — может и раньше ответа, это не важно
    if (created) Object.assign(tile, { id: created.objectId, seen: false });
    tile.render();
  }

  // Спящая плитка: название, параметры создания (если есть) и start — по центру, больше ничего
  function renderSleeping(tile) {
    const startButton = KV.el('button', 'primary', tile.starting ? 'starting…' : '▶ start');
    startButton.title = `create ${tile.view.title}`;
    startButton.disabled = tile.starting;
    startButton.onclick = () => start(tile);
    tile.el.replaceChildren(tile.title, ...(tile.view.params.length ? [tile.params] : []), startButton);
  }

  // Живая плитка: название сверху, под ним слева пульт (сетка «метод | поля | ▶»), справа объект
  function renderLive(tile) {
    const id = tile.id;
    // remove — красный ✕ в правом верхнем углу, в одной строке с названием
    const remove = KV.el('button', 'close', '✕');
    remove.title = `remove ${tile.view.title} #${id} (DELETE)`;
    remove.setAttribute('aria-label', 'remove');
    remove.onclick = async () => { await tile.view.remove(tile.store, id); tile.render(); };
    // Шапка: название, сразу за ним то, что структура хочет показать рядом (у пула — runState), справа ✕
    const head = KV.el('div', 'tile-head');
    const left = KV.el('div', 'tile-head-left');
    left.append(tile.title, tile.titleExtra);
    head.append(left, remove);
    tile.controls.replaceChildren(KV.renderOps(tile.view.operations, id));
    tile.body.replaceChildren();
    tile.el.replaceChildren(head, tile.main);
  }

  /** Объект плитки (или null — спит): то, что видит она сама, а заодно и всё, что рисуется рядом (диорама). */
  const itemOf = tile => tile.id != null ? tile.store.items.get(tile.id) ?? null : null;

  function renderTile(tile) {
    const item = itemOf(tile);
    if (item) tile.seen = true;
    // Объект пропал после того, как мы его видели, — удалён (нами или извне): плитка засыпает
    if (tile.id != null && !item && tile.seen) Object.assign(tile, { id: null, seen: false });

    const live = tile.id != null;
    tile.el.classList.toggle('live', live);
    tile.el.classList.toggle('sleeping', !live);
    for (const input of Object.values(tile.inputs)) input.disabled = tile.starting;

    // Пульт пересоздаём, только когда меняется режим плитки: render идёт на каждое событие,
    // и кнопка, пересозданная между mousedown и mouseup, теряет клик (а поля — введённое)
    const mode = live ? `live:${tile.id}` : `sleep:${tile.starting}`;
    if (tile.mode !== mode) {
      tile.mode = mode;
      if (live) renderLive(tile); else renderSleeping(tile);
    }
    // Состояние живого объекта — на каждое событие
    if (live) {
      tile.body.replaceChildren(...(item ? tile.view.renderState(tile.store, item) : []));
      tile.titleExtra.replaceChildren(...(item && tile.view.renderTitleExtra ? tile.view.renderTitleExtra(tile.store, item) : []));
    }
  }

  /**
   * Плитки для views: place(tile) — куда положить плитку на странице; onRender(tiles) — что ещё перерисовать
   * после плиток (на каждое событие и по таймерам структур). Подключается к WebSocket — один раз на страницу
   */
  function mount(views, { place, onRender } = {}) {
    let tiles = [];
    const render = () => {
      for (const tile of tiles) renderTile(tile);
      onRender?.(tiles);
    };
    tiles = views.map(view => createTile(view, render));
    for (const tile of tiles) place(tile);
    render();
    // Лог WebSocket — по событиям всех структур на странице
    const types = [...new Set(views.flatMap(view => view.types))];
    UI.connect({ onEnvelope: env => { for (const tile of tiles) tile.store.apply(env); render(); }, types });
    return { tiles, render };
  }

  return { mount, itemOf };
})();
