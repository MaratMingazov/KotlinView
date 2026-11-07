/*
 * LinkedBlockingQueue<Runnable>: модель по событиям WebSocket, отрисовка очереди и REST-вызовы.
 * Общий для linkedblockingqueue.html и плиток index.html.
 * Подключение: после base.js и components.js. Стили — blockingqueue.css. Всё лежит в объекте BlockingQueueView.
 *
 * Вид — как у очереди внутри пула (pool.js): мини-конверты задач, пустые ячейки до capacity; общий вид цепочки — KV.renderChain
 */
const BlockingQueueView = (() => {
  const base = '/api/linkedblockingqueuerunnable';
  const tasksBase = '/api/tasks';
  const QUEUE = 'LINKED_BLOCKING_QUEUE_RUNNABLE';
  const TASK = 'RUNNABLE_TASK';
  const METHODS = ['offer', 'take'];
  const INT_MAX = 2147483647; // ёмкость LinkedBlockingQueue() без аргумента
  const TASK_DURATION_MS = 5000; // все задачи пока одной длины — как в пуле

  // ---------- REST ----------
  // Запросы и лог HTTP — UI.call из base.js

  // Объект появится по событию OBJECT_CREATED; ответ ({ objectId }) нужен, чтобы знать, чья это очередь
  const create = values => UI.call('POST', base, { capacity: values.capacity });
  const remove = (store, id) => UI.call('DELETE', `${base}/${id}`);

  // offer новой задачи — два обычных запроса подряд: offer на сервере принимает только taskId.
  // Поэтому в логе честно видно: сначала OBJECT_CREATED задачи, потом offer
  async function offerNew(queueId, durationMs) {
    const created = await UI.call('POST', tasksBase, { durationMs });
    if (created) await UI.call('POST', `${base}/${queueId}/offer`, { taskId: created.objectId });
  }

  const operations = [
    { name: 'offer', fields: [], title: id => `POST ${tasksBase} {durationMs: ${TASK_DURATION_MS}}, then POST ${base}/${id}/offer {taskId}`,
      run: id => offerNew(id, TASK_DURATION_MS) },
    { name: 'take', fields: [], title: id => `POST ${base}/${id}/take — take() in a new thread`,
      run: id => UI.call('POST', `${base}/${id}/take`) },
  ];

  // ---------- Модель ----------

  /**
   * store.items — objectId → { id, capacity, elements, methods, nodeEffect }; store.apply(env) — учесть событие.
   * elements — taskIds от головы к хвосту. methods.inside.take — заодно и «ждут в take»: поток внутри take() висит, пока очередь пуста
   */
  function createStore(render) {
    const items = new Map();
    // taskId → задача из KV.trackTask: узлы очереди рисуются её конвертом — тем же, что на странице задачи
    const tasks = new Map();

    // Очередь создаётся и по OBJECT_CREATED, и по любому другому событию: страницу могли открыть уже после создания
    function queueOf(id) {
      if (!items.has(id)) items.set(id, { id, capacity: null, elements: [], methods: KV.methodsState(METHODS), nodeEffect: null });
      return items.get(id);
    }

    function apply(env) {
      const d = env.data;
      if (d?.objectType === TASK) { KV.trackTask(tasks, env, render); return; }
      if (d?.objectType !== QUEUE) return;
      if (env.type === 'OBJECT_REMOVED') { items.delete(d.objectId); return; }
      const queue = queueOf(d.objectId);
      // state в каждом событии полный и согласованный (снимок и отправка под одним замком) — просто берём последний
      if (d.state) {
        queue.capacity = d.state.capacity;
        queue.elements = d.state.taskIds;
      }
      const phase = KV.trackMethod(queue.methods, env);
      if (!phase) return;
      const effect = nodeEffectOf(d.method, phase, d);
      if (effect) KV.setEffect(queue, effect, render); // перерисовать, когда подсветка догорит
    }

    return { items, tasks, apply };
  }

  // Что подсветить после этого события (null — ничего). Только offer: новый узел или отклонённая задача справа
  function nodeEffectOf(method, phase, d) {
    if (phase !== 'OUT' || method !== 'offer') return null;
    // При гонке «последний узел» — допущение, а не наблюдение
    if (d.result === true) return { new: d.state.taskIds.length - 1 };
    return { value: d.args.taskId, kind: 'failed', title: 'queue is full: offer returned false' };
  }

  // ---------- Отрисовка ----------

  /** Состояние очереди — элементы подряд: бейджи методов, очередь, потоки, ждущие в take. */
  function renderState(store, queue) {
    // Свободные ячейки — только для ограниченной очереди: ∞ (INT_MAX) и «ещё не знаем» не рисуем
    const capacity = queue.capacity != null && queue.capacity !== INT_MAX ? queue.capacity : undefined;
    const node = (taskId, label, index) => KV.taskNode(store.tasks, taskId, label, index);
    return [
      KV.renderBadges(queue.methods),
      KV.renderChain(queue.elements, queue.nodeEffect, { node, slot: KV.taskSlot, capacity }),
      renderWaiting(queue),
    ];
  }

  // Есть только у блокирующей очереди: потоки, которые висят внутри take(). Без подписи — минималистично:
  // что это за потоки, сказано в подсказке к каждому; пока никто не ждёт, строка пустая
  function renderWaiting(queue) {
    const row = KV.el('div', 'waiting');
    const threads = queue.methods.inside.take;
    for (const thread of threads) {
      const chip = KV.el('span', 'thread-chip', thread);
      chip.style.setProperty('--thread', KV.threadColor(thread));
      chip.title = `${thread} is inside take(): waits until a task appears in the queue`;
      row.append(chip);
    }
    return row;
  }

  return { title: 'LinkedBlockingQueue', params: [['capacity', 3]], types: [QUEUE, TASK], createStore, create, remove, operations, renderState };
})();