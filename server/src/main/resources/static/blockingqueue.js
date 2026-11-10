/*
 * LinkedBlockingQueue<Runnable>: модель по событиям WebSocket, отрисовка очереди и REST-вызовы.
 * Плитки на index.html и tiles.html.
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
  const VISIT_MS = 1200;         // сколько помнится законченный offer / take (для диорамы: машина успевает приехать)

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
   * store.items — objectId → { id, capacity, elements, methods, nodeEffect, visits }; store.apply(env) — учесть событие.
   * elements — taskIds от головы к хвосту. methods.inside.take — заодно и «ждут в take»: поток внутри take() висит, пока очередь пуста.
   * visits — недавние offer / take: { id, method, thread, taskId, accepted, failed, at } (at — performance.now();
   * id — порядковый номер визита: один HTTP-поток может сделать несколько offer подряд, а машина у каждого своя),
   * законченные старше VISIT_MS удаляются. offer длится микросекунды: без визита диорама не узнала бы, что машина
   * вообще приезжала; у take визит говорит, кто какую задачу получил. Визит offer заводится уже на METHOD_IN
   * (accepted = null — ещё неизвестно): METHOD_OUT take той же задачи может прийти раньше METHOD_OUT offer,
   * и диорама должна знать, на чьей машине ящик приехал. Плитки tiles.html визиты не читают
   */
  function createStore(render) {
    const items = new Map();
    // taskId → задача из KV.trackTask: узлы очереди рисуются её конвертом
    const tasks = new Map();
    let visitSeq = 0;

    // Очередь создаётся и по OBJECT_CREATED, и по любому другому событию: страницу могли открыть уже после создания
    function queueOf(id) {
      if (!items.has(id)) items.set(id, { id, capacity: null, elements: [], methods: KV.methodsState(METHODS), nodeEffect: null, visits: [] });
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
      trackVisit(queue, d, phase);
      const effect = nodeEffectOf(d.method, phase, d);
      if (effect) KV.setEffect(queue, effect, render); // перерисовать, когда подсветка догорит
    }

    /**
     * Визиты: offer — с METHOD_IN (результат ещё неизвестен), на METHOD_OUT дополняется; take — на METHOD_OUT.
     * Законченные старше VISIT_MS — долой; когда визит устареет, перерисовать: диорама увидит, что его нет
     */
    function trackVisit(queue, d, phase) {
      const now = performance.now(), failed = phase === 'OUT_FAILED';
      queue.visits = queue.visits.filter(v => v.accepted === null || now - v.at < VISIT_MS);
      if (d.method === 'offer') {
        if (phase === 'IN') {
          queue.visits.push({ id: ++visitSeq, method: 'offer', thread: d.thread, taskId: d.args?.taskId, accepted: null, failed: false, at: now });
          return;
        }
        // Тот же поток не может быть внутри offer дважды: открытый визит — последний с accepted = null
        const open = queue.visits.findLast(v => v.method === 'offer' && v.thread === d.thread && v.accepted === null);
        const visit = open ?? { id: ++visitSeq, method: 'offer', thread: d.thread, taskId: d.args?.taskId };
        Object.assign(visit, { accepted: !failed && d.result === true, failed, at: now });
        if (!open) queue.visits.push(visit);
      } else if (phase !== 'IN') {
        queue.visits.push({ id: ++visitSeq, method: d.method, thread: d.thread, taskId: failed ? null : d.result, accepted: !failed, failed, at: now });
      } else {
        return;
      }
      setTimeout(render, VISIT_MS);
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
      const chip = KV.el('span', 'thread-chip', KV.THREAD_LABEL);
      chip.style.setProperty('--thread', KV.threadColor(thread));
      chip.title = `${thread} is inside take(): waits until a task appears in the queue`;
      row.append(chip);
    }
    return row;
  }

  // Визиты, которые ещё не устарели (store удаляет старые только при новом вызове); незаконченные — всегда
  const recentVisits = queue => queue.visits.filter(v => v.accepted === null || performance.now() - v.at < VISIT_MS);

  return { title: 'LinkedBlockingQueue', params: [['capacity', 3]], types: [QUEUE, TASK], createStore, create, remove, operations, renderState, recentVisits };
})();