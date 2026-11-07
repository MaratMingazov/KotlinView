/*
 * LinkedList<Int>: модель по событиям WebSocket, отрисовка цепочки узлов и REST-вызовы.
 * Общий для linkedlist.html и плиток index.html.
 * Подключение: после base.js и components.js. Цепочка узлов — общий компонент KV.renderChain. Всё лежит в объекте LinkedListView.
 */
const LinkedListView = (() => {
  const base = '/api/linkedlistint';
  const TYPE = 'LINKED_LIST_INT';
  const METHODS = ['add', 'offer', 'offerFirst', 'offerLast', 'poll', 'pop'];

  // ---------- REST ----------
  // Запросы и лог HTTP — UI.call из base.js

  // Объект появится по событию OBJECT_CREATED; ответ ({ objectId }) нужен, чтобы знать, чей это список
  const create = () => UI.call('POST', base);
  const remove = (store, id) => UI.call('DELETE', `${base}/${id}`);

  // Операции пульта. У всех с аргументом тело {element}
  const withElement = (name, defaultValue) => ({
    name, fields: [['element', defaultValue]], title: id => `POST ${base}/${id}/${name} {element}`,
    run: (id, v) => UI.call('POST', `${base}/${id}/${name}`, { element: v.element }),
  });
  const noArgs = name => ({ name, fields: [], title: id => `POST ${base}/${id}/${name}`, run: id => UI.call('POST', `${base}/${id}/${name}`) });
  const operations = [
    withElement('add', 10), withElement('offer', 20), withElement('offerFirst', 5), withElement('offerLast', 30),
    noArgs('poll'), noArgs('pop'),
  ];

  // ---------- Модель ----------

  /** store.items — objectId → { id, elements, methods, nodeEffect }; store.apply(env) — учесть событие. */
  function createStore(render) {
    const items = new Map();

    // Список создаётся и по OBJECT_CREATED, и по любому другому событию: страницу могли открыть уже после создания
    function listOf(id) {
      if (!items.has(id)) items.set(id, { id, elements: [], methods: KV.methodsState(METHODS), nodeEffect: null });
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
      list.elements = d.state;

      const effect = nodeEffectOf(d.method, phase, d);
      if (effect) KV.setEffect(list, effect, render); // перерисовать, когда подсветка догорит
    }

    return { items, apply };
  }

  // Что подсветить после этого события (null — ничего): только новый узел.
  // Снятые poll / pop узлы не рисуем призраком в голове — общий вид цепочек (см. KV.renderChain)
  function nodeEffectOf(method, phase, data) {
    if (phase !== 'OUT') return null;
    // При гонке «последний узел» для add/offer — допущение, а не наблюдение
    if (method === 'add' || method === 'offer' || method === 'offerLast') return { new: data.state.length - 1 };
    // В отличие от ArrayList.add(0, e) здесь нет сдвига: offerFirst просто прицепляет новый узел к голове
    if (method === 'offerFirst') return { new: 0 };
    return null;
  }

  // ---------- Отрисовка ----------

  /** Состояние списка — элементы подряд: бейджи методов и цепочка узлов (общий вид — KV.renderChain) */
  function renderState(store, list) {
    return [KV.renderBadges(list.methods), KV.renderChain(list.elements, list.nodeEffect)];
  }

  return { title: 'LinkedList', params: [], types: [TYPE], createStore, create, remove, operations, renderState };
})();