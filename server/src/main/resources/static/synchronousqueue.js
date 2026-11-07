/*
 * SynchronousQueue<Runnable>: модель по событиям WebSocket, отрисовка «места передачи» и REST-вызовы.
 * Общий для synchronousqueue.html и плиток index.html (и очереди CachedThreadPool — позже).
 * Подключение: после base.js и components.js. Стили — synchronousqueue.css. Всё лежит в объекте SynchronousQueueView.
 *
 * Ячеек нет: элементы в SynchronousQueue не хранятся. Рисуем место передачи:
 *   слева — кто ждёт отдать (put, с задачей в руках) → посередине — передача → справа — кто ждёт получить (take / poll)
 */
const SynchronousQueueView = (() => {
  const base = '/api/synchronousqueuerunnable';
  const tasksBase = '/api/tasks';
  const QUEUE = 'SYNCHRONOUS_QUEUE_RUNNABLE';
  const TASK = 'RUNNABLE_TASK';
  const METHODS = ['offer', 'put', 'take', 'poll'];
  const TASK_DURATION_MS = 5000; // все задачи пока одной длины — как в пуле
  const FLASH_MS = 1500;         // сколько видна передача / отказ посередине

  // ---------- REST ----------
  // Запросы и лог HTTP — UI.call из base.js

  // Объект появится по событию OBJECT_CREATED; ответ ({ objectId }) нужен, чтобы знать, чья это очередь. Параметров нет — ёмкости нет
  const create = () => UI.call('POST', base);
  const remove = (store, id) => UI.call('DELETE', `${base}/${id}`);

  // offer / put новой задачи — два обычных запроса подряд: очередь принимает только taskId
  async function withNewTask(queueId, method) {
    const created = await UI.call('POST', tasksBase, { durationMs: TASK_DURATION_MS });
    if (created) await UI.call('POST', `${base}/${queueId}/${method}`, { taskId: created.objectId });
  }

  const operations = [
    { name: 'offer', fields: [], title: id => `POST ${tasksBase}, then POST ${base}/${id}/offer {taskId} — true only if someone waits in take`,
      run: id => withNewTask(id, 'offer') },
    { name: 'put', fields: [], title: id => `POST ${tasksBase}, then POST ${base}/${id}/put {taskId} — put() in a new thread, waits for a taker`,
      run: id => withNewTask(id, 'put') },
    { name: 'take', fields: [], title: id => `POST ${base}/${id}/take — take() in a new thread, waits for a giver`,
      run: id => UI.call('POST', `${base}/${id}/take`) },
  ];

  // ---------- Модель ----------

  /**
   * store.items — objectId → { id, methods, putting, flash, leaving }; store.apply(env) — учесть событие.
   * putting — thread → taskId: кто висит в put и с какой задачей. Кто ждёт получить — methods.inside.take / .poll.
   * flash — что показать посередине: { taskId, ok: true, to } — передача, { taskId, ok: false } — offer вернул false.
   * leaving — кто только что вышел из offer / put (side: 'give') или take / poll (side: 'take'): его плашка тает,
   * как бейдж метода, — иначе при мгновенной передаче (put, когда taker уже ждёт) отдающего не было бы видно вовсе
   */
  function createStore(render) {
    const items = new Map();
    // taskId → задача из KV.trackTask: передаваемая задача рисуется её конвертом
    const tasks = new Map();

    function queueOf(id) {
      if (!items.has(id)) items.set(id, { id, methods: KV.methodsState(METHODS), putting: new Map(), flash: null, leaving: [] });
      return items.get(id);
    }

    function apply(env) {
      const d = env.data;
      if (d?.objectType === TASK) { KV.trackTask(tasks, env, render); return; }
      if (d?.objectType !== QUEUE) return;
      if (env.type === 'OBJECT_REMOVED') { items.delete(d.objectId); return; }
      const queue = queueOf(d.objectId);
      const phase = KV.trackMethod(queue.methods, env);
      if (!phase) return;

      if (d.method === 'put') {
        if (phase === 'IN') queue.putting.set(d.thread, d.args.taskId);
        else queue.putting.delete(d.thread);
      }
      // Передачу видно со стороны получателя: take / poll вернули задачу — неважно, отдали её через offer или put
      if ((d.method === 'take' || d.method === 'poll') && phase === 'OUT' && d.result != null) {
        flash(queue, { taskId: d.result, ok: true, to: d.thread });
      }
      if (d.method === 'offer' && phase === 'OUT' && d.result === false) {
        flash(queue, { taskId: d.args.taskId, ok: false });
      }
      if (phase !== 'IN') leave(queue, d, phase);
    }

    // Поток вышел из метода — его плашка тает. ok: отдал / получил задачу; иначе — offer вернул false,
    // poll не дождался (null) или метод упал (например, прерван)
    function leave(queue, d, phase) {
      const side = d.method === 'offer' || d.method === 'put' ? 'give' : 'take';
      const ok = phase === 'OUT' && (d.method === 'put' || (d.method === 'offer' ? d.result === true : d.result != null));
      const now = performance.now();
      queue.leaving = queue.leaving.filter(l => now - l.start < FLASH_MS);
      queue.leaving.push({ thread: d.thread, side, ok, failed: phase === 'OUT_FAILED', start: now });
      setTimeout(render, FLASH_MS);
    }

    function flash(queue, what) {
      queue.flash = { ...what, start: performance.now() };
      setTimeout(render, FLASH_MS);
    }

    return { items, tasks, apply };
  }

  // ---------- Отрисовка ----------

  /** Состояние очереди — элементы подряд: бейджи методов и место передачи. */
  function renderState(store, queue) {
    return [KV.renderBadges(queue.methods), renderHandoff(store, queue)];
  }

  // Ряд «отдают → передача → получают». Стрелки — направление передачи, это суть SynchronousQueue.
  // options.neutralReject — offer → false не красным: в CachedThreadPool это не ошибка, а сигнал пулу создать поток
  function renderHandoff(store, queue, options = {}) {
    const row = KV.el('div', 'handoff');

    // Ждущие — плашки как есть, только что вышедшие — тают (ближе к середине: они только что были там)
    const now = performance.now();
    const leaving = side => queue.leaving.filter(l => l.side === side && now - l.start < FLASH_MS).map(l => leavingChip(l, now));

    const givers = KV.el('div', 'side givers');
    for (const [thread, taskId] of queue.putting) {
      givers.append(chip(thread, `${thread} is inside put(task#${taskId}): waits until someone takes the task`));
    }
    givers.append(...leaving('give'));

    const takers = KV.el('div', 'side takers');
    takers.append(...leaving('take'));
    for (const method of ['take', 'poll']) {
      for (const thread of queue.methods.inside[method]) {
        takers.append(chip(thread, `${thread} is inside ${method}(): waits until someone gives a task`));
      }
    }

    row.append(givers, KV.el('span', 'flow', '→'), renderMiddle(store, queue, options), KV.el('span', 'flow', '→'), takers);
    return row;
  }

  // Посередине: передаваемая задача (вспыхивает), отклонённая offer (тает красным) или пустое место — ёмкость 0
  function renderMiddle(store, queue, options) {
    const f = queue.flash;
    const elapsed = f ? performance.now() - f.start : Infinity;
    if (elapsed >= FLASH_MS) {
      const empty = KV.taskSlot('');
      empty.title = 'capacity 0: nothing is stored, a task is handed over directly';
      return empty;
    }
    const n = KV.taskNode(store.tasks, f.taskId, '', '');
    const envelope = n.querySelector('.envelope');
    if (f.ok) {
      envelope.classList.add('new');
      envelope.style.setProperty('--glow', `${FLASH_MS}ms`);
      envelope.style.setProperty('--glow-delay', `${-elapsed}ms`);
      n.title = `task#${f.taskId} handed over to ${f.to}`;
    } else {
      // Пунктирный конверт тает; красный — только на отдельной странице очереди, где false значит «никто не взял»
      n.classList.add('ghost');
      if (!options.neutralReject) n.classList.add('failed');
      n.style.animation = `fade-out ${FLASH_MS}ms ease-out ${-elapsed}ms forwards`;
      n.title = options.neutralReject
        ? `offer(task#${f.taskId}) returned false: no idle worker — the pool starts a new thread`
        : `offer(task#${f.taskId}) returned false: nobody waits in take`;
    }
    return n;
  }

  // Плашка вышедшего потока тает, как бейдж метода: зелёная — отдал / получил, красная — упал, бледная — ни с чем
  function leavingChip(l, now) {
    const c = chip(l.thread, l.side === 'give'
      ? (l.ok ? `${l.thread} gave a task` : `${l.thread}: nobody took the task`)
      : (l.ok ? `${l.thread} got a task` : `${l.thread}: left without a task`));
    c.classList.add('leaving', l.failed ? 'failed' : l.ok ? 'ok' : 'empty-handed');
    c.style.animation = `fade-out ${FLASH_MS}ms ease-in ${-(now - l.start)}ms forwards`;
    return c;
  }

  function chip(thread, title) {
    const c = KV.el('span', 'thread-chip', thread);
    c.style.setProperty('--thread', KV.threadColor(thread));
    c.title = title;
    return c;
  }

  // renderHandoff — отдельно: им рисует очередь CachedThreadPool (pool.js), без своих бейджей
  return { title: 'SynchronousQueue', params: [], types: [QUEUE, TASK], createStore, create, remove, operations, renderState, renderHandoff };
})();