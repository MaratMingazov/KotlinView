/*
 * ArrayList<Int>: модель по событиям WebSocket, отрисовка ячеек и REST-вызовы.
 * Плитка на tiles.html.
 * Подключение: после base.js и components.js. Стили — arraylist.css. Всё лежит в объекте ArrayListView.
 */
const ArrayListView = (() => {
  const base = '/api/arraylistint';
  const TYPE = 'ARRAY_LIST_INT';
  const METHODS = ['add', 'addAt', 'get'];
  const CELL_FADE_MS = 1500; // сколько затухает подсветка ячеек — дольше, чтобы успеть рассмотреть

  // ---------- REST ----------
  // Запросы и лог HTTP — UI.call из base.js

  // Объект появится по событию OBJECT_CREATED; ответ ({ objectId }) нужен, чтобы знать, чей это список
  const create = () => UI.call('POST', base);
  const remove = (store, id) => UI.call('DELETE', `${base}/${id}`);

  // Операции пульта: имя, поля (имя + значение по умолчанию) и что вызвать
  const operations = [
    { name: 'add', fields: [['element', 10]], title: id => `POST ${base}/${id}/add {element}`,
      run: (id, v) => UI.call('POST', `${base}/${id}/add`, { element: v.element }) },
    { name: 'addAt', fields: [['index', 0], ['element', 7]], title: id => `POST ${base}/${id}/addAt {index, element}`,
      run: (id, v) => UI.call('POST', `${base}/${id}/addAt`, { index: v.index, element: v.element }) },
    { name: 'get', fields: [['index', 0]], title: id => `POST ${base}/${id}/get {index}`,
      run: (id, v) => UI.call('POST', `${base}/${id}/get`, { index: v.index }) },
  ];

  // ---------- Модель ----------

  /** store.items — objectId → { id, elements, unreadable, methods, cellEffect }; store.apply(env) — учесть событие. */
  function createStore(render) {
    const items = new Map();

    // Список создаётся и по OBJECT_CREATED, и по любому другому событию: страницу могли открыть уже после создания
    function listOf(id) {
      if (!items.has(id)) items.set(id, { id, elements: [], unreadable: false, methods: KV.methodsState(METHODS), cellEffect: null });
      return items.get(id);
    }

    function apply(env) {
      const d = env.data;
      if (d?.objectType !== TYPE) return;
      if (env.type === 'OBJECT_REMOVED') { items.delete(d.objectId); return; }
      const list = listOf(d.objectId);
      if (env.type === 'OBJECT_CREATED') {
        if (Array.isArray(d.state)) list.elements = d.state; // начальное состояние
        return;
      }
      const phase = KV.trackMethod(list.methods, env);
      if (!phase) return;
      // state == null — сервер не смог прочитать список (гонка): оставляем прошлые элементы и помечаем
      list.unreadable = !Array.isArray(d.state);
      if (!list.unreadable) list.elements = d.state;

      const cells = cellEffectOf(d.method, phase, d);
      if (cells) {
        list.cellEffect = { ...cells, start: performance.now() };
        setTimeout(render, CELL_FADE_MS); // убрать «призрачную» ячейку, когда она догорит
      }
    }

    return { items, apply };
  }

  // Какие ячейки подсветить после этого события (null — ничего)
  function cellEffectOf(method, phase, data) {
    if (!Array.isArray(data.state)) return null; // без состояния подсвечивать нечего
    if (phase === 'OUT_FAILED') {
      // Индекс за концом массива — «призрачная» ячейка
      const index = data.args.index;
      return index !== undefined && index >= data.state.length ? { ghost: index } : null;
    }
    if (phase !== 'OUT') return null;
    // При гонке «последняя ячейка» для add — допущение, а не наблюдение
    if (method === 'add') return { new: data.state.length - 1 };
    if (method === 'addAt') return { new: data.args.index, shiftedFrom: data.args.index + 1 };
    if (method === 'get') return { read: data.args.index };
    return null;
  }

  // ---------- Отрисовка ----------
  // Ячейки массива — свои, не цепочка: у них свои эффекты (сдвиг, чтение)

  /** Состояние списка — элементы подряд: бейджи методов и ячейки. */
  function renderState(store, list) {
    return [KV.renderBadges(list.methods), renderCells(list)];
  }

  // Ячейка массива: значение и индекс под ним
  function cell(value, index) {
    const c = KV.el('div', 'cell');
    c.append(KV.el('div', 'box', String(value)), KV.el('div', 'idx', String(index)));
    return c;
  }

  // Анимация, продолженная с того места, где она была до пересоздания элемента
  const glow = (name, elapsed) => `${name} ${CELL_FADE_MS}ms ease-out ${-elapsed}ms forwards`;

  function renderCells(list) {
    const cells = KV.el('div', 'cells');
    const effect = list.cellEffect;
    const elapsed = effect ? performance.now() - effect.start : Infinity;
    const active = elapsed < CELL_FADE_MS;

    list.elements.forEach((value, i) => {
      const c = cell(value, i);
      if (active) {
        const box = c.querySelector('.box');
        if (effect.new === i) box.style.animation = glow('cell-new', elapsed);
        if (effect.read === i) box.style.animation = glow('cell-read', elapsed);
        if (effect.shiftedFrom !== undefined && i >= effect.shiftedFrom) {
          const arrow = KV.el('span', 'arrow', '→');
          arrow.style.animation = glow('fade-out', elapsed);
          box.append(arrow);
        }
      }
      cells.append(c);
    });

    if (active && effect.ghost !== undefined) {
      const ghost = cell('✗', effect.ghost);
      ghost.classList.add('ghost');
      ghost.style.animation = glow('fade-out', elapsed);
      cells.append(ghost);
    }
    if (list.unreadable) {
      cells.append(KV.el('span', 'error', '⚠ state unreadable — the structure is corrupted by a race (showing the last snapshot)'));
    }
    return cells;
  }

  return { title: 'ArrayList', params: [], types: [TYPE], createStore, create, remove, operations, renderState };
})();