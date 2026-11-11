/*
 * LinkedBlockingQueue<Runnable>: модель по событиям WebSocket, отрисовка очереди и REST-вызовы.
 * Плитки на index.html и tiles.html.
 * Подключение: после base.js и components.js. Всё лежит в объекте BlockingQueueView.
 *
 * Вид — «труба» (общие стили .room* — components.css): рамка с ячейками до capacity, голова справа, хвост слева —
 * как конвейер на диораме; у входа — кто делает offer и ждёт в put, у выхода — кто ждёт в take / poll
 */
const BlockingQueueView = (() => {
  const base = '/api/linkedblockingqueuerunnable';
  const tasksBase = '/api/tasks';
  const QUEUE = 'LINKED_BLOCKING_QUEUE_RUNNABLE';
  const TASK = 'RUNNABLE_TASK';
  const METHODS = ['offer', 'put', 'take', 'poll'];
  const INT_MAX = 2147483647; // ёмкость LinkedBlockingQueue() без аргумента
  const TASK_DURATION_MS = 5000; // все задачи пока одной длины — как в пуле
  const VISIT_MS = 1200;         // сколько помнится законченный offer / take (для диорамы: машина успевает приехать)
  const NEW_MS = 1500;           // сколько подсвечена задача, только что попавшая в очередь
  const MIN_VISIBLE_MS = 800;    // меньше задачу в ячейке не показываем: offer при ждущем take — она в очереди микросекунды
  const POLL_TIMEOUT_MS = 2000;  // poll(timeout) с пульта — фиксированный, без поля ввода (как у SynchronousQueue)

  // ---------- REST ----------
  // Запросы и лог HTTP — UI.call из base.js

  // Объект появится по событию OBJECT_CREATED; ответ ({ objectId }) нужен, чтобы знать, чья это очередь
  const create = values => UI.call('POST', base, { capacity: values.capacity });
  const remove = (store, id) => UI.call('DELETE', `${base}/${id}`);

  // offer / put новой задачи — два обычных запроса подряд: очередь на сервере принимает только taskId.
  // Поэтому в логе честно видно: сначала OBJECT_CREATED задачи, потом offer / put
  async function withNewTask(queueId, method) {
    const created = await UI.call('POST', tasksBase, { durationMs: TASK_DURATION_MS });
    if (created) await UI.call('POST', `${base}/${queueId}/${method}`, { taskId: created.objectId });
  }

  const operations = [
    { name: 'offer', fields: [], title: id => `POST ${tasksBase} {durationMs: ${TASK_DURATION_MS}}, then POST ${base}/${id}/offer {taskId} — false if the queue is full`,
      run: id => withNewTask(id, 'offer') },
    { name: 'put', fields: [], title: id => `POST ${tasksBase} {durationMs: ${TASK_DURATION_MS}}, then POST ${base}/${id}/put {taskId} — put() in a new thread, waits for space if the queue is full`,
      run: id => withNewTask(id, 'put') },
    { name: 'take', fields: [], title: id => `POST ${base}/${id}/take — take() in a new thread`,
      run: id => UI.call('POST', `${base}/${id}/take`) },
    { name: 'poll', fields: [], title: id => `POST ${base}/${id}/poll {timeoutMs: ${POLL_TIMEOUT_MS}} — poll() in a new thread, waits for a task at most ${KV.seconds(POLL_TIMEOUT_MS)}`,
      run: id => UI.call('POST', `${base}/${id}/poll`, { timeoutMs: POLL_TIMEOUT_MS }) },
  ];

  // ---------- Модель ----------

  /**
   * store.items — objectId → { id, capacity, elements, seen, methods, putters, takers, visits, addedAt, lingering };
   * store.apply(env) — учесть событие. elements — taskIds от головы к хвосту.
   * putters — thread → taskId: кто внутри put (ждёт места, пока очередь полна); takers — thread → { method, timeoutMs, since }:
   * кто внутри take / poll (ждёт задачу, пока очередь пуста; у poll — таймаут и когда вошёл). Обе Map — в порядке прихода.
   * addedAt — taskId → когда задача появилась в очереди (первый снимок с ней; -Infinity — была ещё до открытия страницы):
   * по нему подсветка новой; seen — снимок уже был. lingering — уже ушедшие задачи, которые плитка ещё держит у головы: { taskId, addedAt, until } —
   * пробыла меньше MIN_VISIBLE_MS (положили и тут же забрали), иначе её никто не увидел бы.
   * visits — недавние offer / put / take / poll: { id, method, thread, taskId, accepted, failed, at } (at — performance.now();
   * id — порядковый номер визита: один HTTP-поток может сделать несколько offer подряд, а машина у каждого своя),
   * законченные старше VISIT_MS удаляются. offer длится микросекунды: без визита диорама не узнала бы, что машина
   * вообще приезжала; у take / poll визит говорит, кто какую задачу получил (у poll accepted = false — не дождался).
   * Визит offer / put заводится уже на METHOD_IN (accepted = null — ещё неизвестно / put ещё ждёт места): METHOD_OUT take
   * той же задачи может прийти раньше METHOD_OUT offer, и диорама должна знать, на чьей машине ящик приехал
   */
  function createStore(render) {
    const items = new Map();
    // taskId → задача из KV.trackTask: узлы очереди рисуются её конвертом
    const tasks = new Map();
    let visitSeq = 0;

    // Очередь создаётся и по OBJECT_CREATED, и по любому другому событию: страницу могли открыть уже после создания
    function queueOf(id) {
      if (!items.has(id)) items.set(id, { id, capacity: null, elements: [], seen: false, methods: KV.methodsState(METHODS),
        putters: new Map(), takers: new Map(), visits: [], addedAt: new Map(), lingering: [] });
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
        trackElements(queue, d.state.taskIds);
      }
      const phase = KV.trackMethod(queue.methods, env);
      if (!phase) return;
      trackWaiting(queue, d, phase);
      trackVisit(queue, d, phase);
    }

    // Кто сейчас внутри put / take / poll — в порядке прихода; у poll — ещё таймаут и когда вошёл (полоска на плашке)
    function trackWaiting(queue, d, phase) {
      if (d.method === 'put') {
        if (phase === 'IN') queue.putters.set(d.thread, d.args?.taskId);
        else queue.putters.delete(d.thread);
      }
      if (d.method === 'take' || d.method === 'poll') {
        if (phase === 'IN') queue.takers.set(d.thread, { method: d.method, timeoutMs: d.args?.timeoutMs, since: performance.now() });
        else queue.takers.delete(d.thread);
      }
    }

    /**
     * Новый снимок очереди: появившиеся задачи запомнить (когда), ушедшие — забыть; ушедшую раньше MIN_VISIBLE_MS
     * плитка ещё подержит у головы (lingering). Первый снимок (страницу открыли позже) — задачи уже были, без подсветки
     */
    function trackElements(queue, next) {
      const now = performance.now(), prev = queue.seen ? queue.elements : null;
      for (const id of next) {
        if (queue.addedAt.has(id)) continue;
        queue.addedAt.set(id, prev === null ? -Infinity : now);
        if (prev !== null) setTimeout(render, NEW_MS); // подсветка догорела
      }
      for (const id of prev ?? []) {
        if (next.includes(id)) continue;
        const addedAt = queue.addedAt.get(id);
        queue.addedAt.delete(id);
        if (now - addedAt < MIN_VISIBLE_MS) {
          const until = addedAt + MIN_VISIBLE_MS;
          queue.lingering.push({ taskId: id, addedAt, until });
          setTimeout(render, until - now);
        }
      }
      queue.lingering = queue.lingering.filter(l => l.until > now && !next.includes(l.taskId));
      queue.elements = next;
      queue.seen = true;
    }

    /**
     * Визиты: offer / put — с METHOD_IN (результат ещё неизвестен, put ещё может ждать места), на METHOD_OUT дополняются;
     * take / poll — на METHOD_OUT (poll с null — не дождался: accepted = false). drainTo — не визит.
     * Законченные старше VISIT_MS — долой; когда визит устареет, перерисовать: диорама увидит, что его нет
     */
    function trackVisit(queue, d, phase) {
      const now = performance.now(), failed = phase === 'OUT_FAILED';
      queue.visits = queue.visits.filter(v => v.accepted === null || now - v.at < VISIT_MS);
      if (d.method === 'offer' || d.method === 'put') {
        if (phase === 'IN') {
          queue.visits.push({ id: ++visitSeq, method: d.method, thread: d.thread, taskId: d.args?.taskId, accepted: null, failed: false, at: now });
          return;
        }
        // Тот же поток не может быть внутри метода дважды: открытый визит — последний с accepted = null
        const open = queue.visits.findLast(v => v.method === d.method && v.thread === d.thread && v.accepted === null);
        const visit = open ?? { id: ++visitSeq, method: d.method, thread: d.thread, taskId: d.args?.taskId };
        // put, если не упал, задачу всегда кладёт (дождавшись места); offer — только если было место
        Object.assign(visit, { accepted: !failed && (d.method === 'put' || d.result === true), failed, at: now });
        if (!open) queue.visits.push(visit);
      } else if ((d.method === 'take' || d.method === 'poll') && phase !== 'IN') {
        const taskId = failed ? null : d.result ?? null;
        queue.visits.push({ id: ++visitSeq, method: d.method, thread: d.thread, taskId, accepted: taskId != null, failed, at: now });
      } else {
        return;
      }
      setTimeout(render, VISIT_MS);
    }

    return { items, tasks, apply };
  }

  // ---------- Отрисовка ----------

  /** Состояние очереди: бейджи методов, под ними «труба». */
  function renderState(store, queue) {
    return [KV.renderBadges(queue.methods), renderPipe(store, queue)];
  }

  const PIPE_MAX = 8; // ячеек в рамке у неограниченной очереди; остальное — «+N» у хвоста

  /**
   * Очередь — рамка (общие стили .room* — components.css), голова справа, хвост слева — как конвейер на диораме.
   * Ячейки до capacity: задача — плашка с номером, свободная — пунктир; полна — рамка красноватая.
   * Слева, у входа, — кто только что сделал offer: принят — плашка тает, очередь полна — отскакивает от рамки.
   * Справа, у выхода, — кто ждёт в take (в порядке входа; takeLock несправедливый — получит не обязательно первый)
   * и кто только что получил задачу — плашка тает
   */
  function renderPipe(store, queue) {
    const row = KV.el('div', 'room-row');
    row.append(renderOffers(queue), renderPipeFrame(store, queue), renderTakers(queue));
    return row;
  }

  function pipeChip(thread, title, cls = '') {
    const chip = KV.el('div', `room-chip ${cls}`.trim());
    chip.style.setProperty('--thread', KV.threadColor(thread));
    chip.title = title;
    chip.append(KV.el('span', 'name', KV.THREAD_LABEL));
    return chip;
  }

  /**
   * У входа (.room-queue.entry: первый в DOM — у рамки): кто ждёт в put (очередь полна) — в порядке прихода, первый
   * у рамки; за ними — кто только что сделал offer / put: новые ближе. Только что сделавших — не больше OFFERS_SHOWN:
   * место у входа постоянное, чтобы рамка не прыгала, когда плашки появляются и тают
   */
  const OFFERS_SHOWN = 2;
  function renderOffers(queue) {
    const side = KV.el('div', 'room-queue entry');
    const now = performance.now();
    for (const [thread, taskId] of queue.putters) {
      side.append(pipeChip(thread, `${thread} is inside put(task #${taskId}): the queue is full, waits for space`));
    }
    // offer ещё внутри (микросекунды) — просто плашка; put внутри уже нарисован выше — ждущим
    const recent = recentVisits(queue).filter(v => !v.failed && (v.method === 'offer' || (v.method === 'put' && v.accepted !== null)));
    for (const v of recent.slice(-OFFERS_SHOWN).reverse()) {
      const age = now - v.at, call = `${v.method}(task #${v.taskId})`;
      if (v.accepted === false) {
        const chip = pipeChip(v.thread, `${v.thread}: ${call} returned false — the queue is full`, 'rejected');
        chip.style.animation = `room-bounce ${VISIT_MS}ms ease-in-out ${-age}ms forwards`;
        side.append(chip);
      } else {
        const chip = pipeChip(v.thread, `${v.thread}: ${call}`);
        if (v.accepted) chip.style.animation = `fade-out ${VISIT_MS}ms ease-in ${-age}ms forwards`;
        side.append(chip);
      }
    }
    return side;
  }

  function renderPipeFrame(store, queue) {
    const bounded = queue.capacity != null && queue.capacity !== INT_MAX;
    const frame = KV.el('div', 'room horizontal');
    frame.append(KV.el('span', 'room-label', `queue(${queue.capacity == null ? '?' : bounded ? queue.capacity : '∞'})`));
    const now = performance.now();
    const elements = queue.elements;
    const shown = bounded ? elements : elements.slice(0, PIPE_MAX);
    // Ушедшие, но ещё видимые — у головы, правее всех; пока видны, занимают свою ячейку
    const lingering = queue.lingering.filter(l => l.until > now);
    // Слева направо: свободные ячейки (к хвосту) → «+N» → задачи от хвоста к голове → ушедшие
    if (bounded) for (let i = elements.length + lingering.length; i < queue.capacity; i++) frame.append(Object.assign(KV.el('div', 'room-slot'), { title: 'free place' }));
    if (shown.length < elements.length) frame.append(KV.el('span', 'room-more', `+${elements.length - shown.length}`));
    for (let i = shown.length - 1; i >= 0; i--) {
      const id = shown[i];
      const cell = taskCell(store, id, queue.addedAt.get(id), now);
      if (i === 0) cell.title += ' · head: take() gets it next';
      frame.append(cell);
    }
    // Ушедшие — в порядке ухода справа налево: первый ушедший — крайний справа
    for (const l of [...lingering].reverse()) {
      const cell = taskCell(store, l.taskId, l.addedAt, now);
      cell.title += ' · already taken: shown a moment longer to be seen';
      // Подсветка новой идёт дальше, а в конце — тает
      const fade = Math.min(300, l.until - l.addedAt);
      cell.style.animation = [cell.style.animation, `fade-out ${fade}ms ease-in ${l.until - fade - now}ms forwards`].filter(Boolean).join(', ');
      frame.append(cell);
    }
    if (bounded && elements.length >= queue.capacity) frame.classList.add('full');
    frame.title = `${elements.length} / ${bounded ? queue.capacity : '∞'} · head on the right, tail on the left`;
    return frame;
  }

  // Ячейка задачи: номер; только что попала в очередь — подсвечена (продолжая с того места, где была)
  function taskCell(store, id, addedAt, now) {
    const cell = KV.el('div', 'room-task', `#${id}`);
    cell.title = `task #${id}, ${KV.seconds(store.tasks.get(id)?.durationMs)}`;
    const age = now - (addedAt ?? -Infinity);
    if (age < NEW_MS) cell.style.animation = `room-new ${NEW_MS}ms ease-out ${-age}ms forwards`;
    return cell;
  }

  /**
   * У выхода: кто получил задачу (тает) и чей poll не дождался (пунктир, тает) — ближе к рамке; за ними — кто ждёт
   * в take / poll, в порядке прихода. У poll внизу убывает полоска — сколько осталось до таймаута
   */
  function renderTakers(queue) {
    const side = KV.el('div', 'room-queue exit');
    const now = performance.now();
    for (const v of recentVisits(queue)) {
      if ((v.method !== 'take' && v.method !== 'poll') || v.failed) continue;
      const chip = v.accepted
        ? pipeChip(v.thread, `${v.thread}: ${v.method}() got task #${v.taskId}`)
        : pipeChip(v.thread, `${v.thread}: poll() timed out — no task appeared`, 'rejected');
      chip.style.animation = `fade-out ${VISIT_MS}ms ease-in ${-(now - v.at)}ms forwards`;
      side.append(chip);
    }
    for (const [thread, w] of queue.takers) {
      const timed = w.timeoutMs != null, call = timed ? `${w.method}(${KV.seconds(w.timeoutMs)})` : `${w.method}()`;
      const chip = pipeChip(thread, `${thread} is inside ${call}: waits until a task appears${timed ? ', gives up after the timeout' : ''}. ` +
        'The order is the order they entered; takeLock is not fair, so the next task may go to any of them');
      if (timed) {
        const bar = KV.el('div', 'countdown');
        bar.style.animation = `room-count ${w.timeoutMs}ms linear ${-(now - w.since)}ms forwards`;
        chip.prepend(bar);
      }
      side.append(chip);
    }
    return side;
  }

  // Визиты, которые ещё не устарели (store удаляет старые только при новом вызове); незаконченные — всегда
  const recentVisits = queue => queue.visits.filter(v => v.accepted === null || performance.now() - v.at < VISIT_MS);

  return { title: 'LinkedBlockingQueue', params: [['capacity', 3]], types: [QUEUE, TASK], createStore, create, remove, operations, renderState, recentVisits };
})();