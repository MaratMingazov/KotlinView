/*
 * SynchronousQueue<Runnable>: модель по событиям WebSocket, отрисовка и REST-вызовы.
 * Плитка на index.html — вид «комната» (renderState): ждущие отдать и получить по бокам от стенки «handoff».
 * Очередь CachedThreadPool (pool.js) — прежним видом renderHandoff: «отдают → место передачи → получают».
 * Подключение: после base.js и components.js. Стили — synchronousqueue.css. Всё лежит в объекте SynchronousQueueView.
 *
 * Ячеек нет: элементы в SynchronousQueue не хранятся, задача передаётся из рук в руки.
 */
const SynchronousQueueView = (() => {
  const base = '/api/synchronousqueuerunnable';
  const tasksBase = '/api/tasks';
  const QUEUE = 'SYNCHRONOUS_QUEUE_RUNNABLE';
  const TASK = 'RUNNABLE_TASK';
  const METHODS = ['offer', 'put', 'take', 'poll'];
  const TASK_DURATION_MS = 5000; // все задачи пока одной длины — как в пуле
  const FLASH_MS = 1500;         // сколько видна передача / отказ посередине
  const VISIT_MS = 1200;         // сколько помнится законченный визит (для диорамы: курьер успевает подъехать и отдать)
  const POLL_TIMEOUT_MS = 2000;  // poll(timeout) с пульта — фиксированный, без поля ввода (как timeout 2s у семафора)

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
    { name: 'poll', fields: [], title: id => `POST ${base}/${id}/poll {timeoutMs: ${POLL_TIMEOUT_MS}} — poll() in a new thread, waits for a giver at most ${KV.seconds(POLL_TIMEOUT_MS)}`,
      run: id => UI.call('POST', `${base}/${id}/poll`, { timeoutMs: POLL_TIMEOUT_MS }) },
  ];

  // ---------- Модель ----------

  /**
   * store.items — objectId → { id, methods, putting, takers, flash, leaving }; store.apply(env) — учесть событие.
   * putting — thread → taskId: кто висит в put и с какой задачей. takers — thread → { method, timeoutMs, since }: кто ждёт
   * получить (take / poll; у poll — таймаут и когда вошёл: плашка показывает, сколько осталось).
   * Обе Map — в порядке прихода (вид «комната» ставит у рамки последнего: нечестная очередь — стек).
   * flash — что показать посередине: { taskId, ok: true, to } — передача, { taskId, ok: false } — offer вернул false.
   * leaving — кто только что вышел из offer / put (side: 'give') или take / poll (side: 'take'): его плашка тает,
   * как бейдж метода, — иначе при мгновенной передаче (put, когда taker уже ждёт) отдающего не было бы видно вовсе.
   * visits — для диорамы: по визиту на каждый вызов offer / put / take / poll { id, method, thread, taskId, state, at, pair }.
   * id — порядковый номер (ключ актёра: один HTTP-поток может сделать несколько offer подряд); taskId — у отдающего
   * из аргументов, у получающего — из результата (до выхода null); state — 'inside' (ещё в методе), 'done' (отдал /
   * получил), 'rejected' (offer → false, poll не дождался), 'failed' (упал, например прерван); at — когда сменилось
   * состояние; pair — id визита с другой стороны. Открывается на METHOD_IN (offer длится микросекунды — без визита
   * курьер не появился бы), законченные старше VISIT_MS удаляются. Пара — когда получающий вышел с задачей: отдающий
   * с тем же taskId уже открыт (вошёл раньше, чем задача кому-то досталась), а METHOD_OUT сторон приходят в любом порядке.
   * putting / takers / leaving / flash и visits дублируют друг друга: первые читает плитка, visits — диорама
   */
  function createStore(render) {
    const items = new Map();
    // taskId → задача из KV.trackTask: передаваемая задача рисуется её конвертом
    const tasks = new Map();
    let visitSeq = 0;

    function queueOf(id) {
      if (!items.has(id)) items.set(id, { id, methods: KV.methodsState(METHODS), putting: new Map(), takers: new Map(), flash: null, leaving: [], visits: [] });
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
      if (d.method === 'take' || d.method === 'poll') {
        if (phase === 'IN') queue.takers.set(d.thread, { method: d.method, timeoutMs: d.args?.timeoutMs, since: performance.now() });
        else queue.takers.delete(d.thread);
      }
      // Передачу видно со стороны получателя: take / poll вернули задачу — неважно, отдали её через offer или put
      if ((d.method === 'take' || d.method === 'poll') && phase === 'OUT' && d.result != null) {
        flash(queue, { taskId: d.result, ok: true, to: d.thread });
      }
      if (d.method === 'offer' && phase === 'OUT' && d.result === false) {
        flash(queue, { taskId: d.args.taskId, ok: false });
      }
      if (phase !== 'IN') leave(queue, d, phase);
      trackVisit(queue, d, phase);
    }

    const isGive = method => method === 'offer' || method === 'put';

    function trackVisit(queue, d, phase) {
      if (!isGive(d.method) && d.method !== 'take' && d.method !== 'poll') return; // drainTo — не визит
      const now = performance.now(), give = isGive(d.method);
      queue.visits = queue.visits.filter(v => v.state === 'inside' || now - v.at < VISIT_MS);
      const open = () => ({ id: ++visitSeq, method: d.method, thread: d.thread, taskId: give ? d.args?.taskId ?? null : null,
        timeoutMs: d.args?.timeoutMs ?? null, state: 'inside', at: now, pair: null }); // timeoutMs — только у poll
      if (phase === 'IN') { queue.visits.push(open()); return; }

      // Тот же поток не может быть внутри метода дважды: открытый визит — последний 'inside' этого потока и метода.
      // Нет такого — страницу открыли, когда поток уже был внутри
      let v = queue.visits.findLast(v => v.thread === d.thread && v.method === d.method && v.state === 'inside');
      if (!v) queue.visits.push(v = open());
      if (phase === 'OUT_FAILED') v.state = 'failed';
      else if (give) v.state = d.method === 'offer' && d.result !== true ? 'rejected' : 'done';
      else Object.assign(v, { taskId: d.result ?? null, state: d.result != null ? 'done' : 'rejected' });
      v.at = now;

      // Получающий вышел с задачей — найти, кто её отдал
      if (!give && v.state === 'done') {
        const giver = queue.visits.findLast(g => isGive(g.method) && g.taskId === v.taskId && g.pair == null && (g.state === 'inside' || g.state === 'done'));
        if (giver) { giver.pair = v.id; v.pair = giver.id; }
      }
      setTimeout(render, VISIT_MS); // визит устарел — диорама увидит, что его нет
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

  // ---------- Отрисовка: место передачи для очереди CachedThreadPool (pool.js) ----------
  // Когда дойдём до cached-пула — перевести его очередь на вид «комната» ниже и удалить этот раздел

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
    const c = KV.el('span', 'thread-chip', KV.THREAD_LABEL); // имя — в подсказке (title)
    c.style.setProperty('--thread', KV.threadColor(thread));
    c.title = title;
    return c;
  }

  // ---------- Отрисовка: вид «комната» (плитка) ----------
  // В общем стиле LBQ и семафора (.room* — components.css):
  //
  //                 handoff
  //   [give][give]     ┃     [take][take]     мест нет — стенка, а не рамка; передаваемая задача
  //                 ─#12→┃→                   проезжает поверх неё слева направо и тает
  // Ждут либо слева (put), либо справа (take / poll) — обе стороны сразу не ждут. Очередь нечестная (стек):
  // у рамки — последний пришедший, он получит пару следующим

  const UNFAIR = 'unfair: the last one who came is matched first';

  /** Состояние очереди — бейджи методов, под ними «комната» без мест. */
  function renderState(store, queue) {
    const row = KV.el('div', 'room-row');
    row.append(renderRoomGivers(queue), renderRoomFrame(store, queue), renderRoomTakers(queue));
    return [KV.renderBadges(queue.methods), row];
  }

  function roomChip(thread, title, cls = '') {
    const chip = KV.el('div', `room-chip ${cls}`.trim());
    chip.style.setProperty('--thread', KV.threadColor(thread));
    chip.title = title;
    chip.append(KV.el('span', 'name', KV.THREAD_LABEL));
    return chip;
  }

  // Только что вышедший — у рамки (он только что был там): отдал / получил — тает; offer → false — отскакивает
  // от рамки, как у полной LBQ; прерван или poll не дождался — пунктир и тает
  function roomLeaving(queue, side) {
    const now = performance.now();
    return queue.leaving.filter(l => l.side === side && now - l.start < FLASH_MS).reverse().map(l => {
      const age = now - l.start;
      if (side === 'give' && !l.ok && !l.failed) {
        const chip = roomChip(l.thread, `${l.thread}: offer() returned false — nobody waits in take`, 'rejected');
        chip.style.animation = `room-bounce ${FLASH_MS}ms ease-in-out ${-age}ms forwards`;
        return chip;
      }
      const title = l.failed ? `${l.thread}: interrupted` : side === 'give'
        ? `${l.thread} gave a task` : l.ok ? `${l.thread} got a task` : `${l.thread}: poll() timed out, left without a task`;
      const chip = roomChip(l.thread, title, l.ok ? '' : 'rejected');
      chip.style.animation = `fade-out ${FLASH_MS}ms ease-in ${-age}ms forwards`;
      return chip;
    });
  }

  // У входа (.room-queue.entry: первый в DOM — у рамки): вышедшие, за ними ждущие в put — от последнего к первому
  function renderRoomGivers(queue) {
    const side = KV.el('div', 'room-queue entry');
    side.append(...roomLeaving(queue, 'give'));
    for (const [thread, taskId] of [...queue.putting].reverse()) {
      side.append(roomChip(thread, `${thread} is inside put(task #${taskId}): waits for a taker · ${UNFAIR}`));
    }
    return side;
  }

  // У выхода — так же: вышедшие, за ними ждущие в take / poll — от последнего к первому. У poll внизу убывает
  // полоска — сколько осталось до таймаута (как у семафора при tryAcquire(timeout))
  function renderRoomTakers(queue) {
    const side = KV.el('div', 'room-queue exit');
    side.append(...roomLeaving(queue, 'take'));
    const now = performance.now();
    for (const [thread, w] of [...queue.takers].reverse()) {
      const timed = w.timeoutMs != null;
      const call = timed ? `${w.method}(${KV.seconds(w.timeoutMs)})` : `${w.method}()`;
      const chip = roomChip(thread, `${thread} is inside ${call}: waits for a giver${timed ? ', gives up after the timeout' : ''} · ${UNFAIR}`);
      if (timed) {
        const bar = KV.el('div', 'countdown');
        bar.style.animation = `room-count ${w.timeoutMs}ms linear ${-(now - w.since)}ms forwards`;
        chip.prepend(bar);
      }
      side.append(chip);
    }
    return side;
  }

  // Не рамка, а стенка: мест нет даже визуально — задачу положить некуда. Передача — ячейка задачи проезжает
  // поверх стенки слева направо (от отдающего к получающему) и тает: прошла насквозь, нигде не остановилась
  function renderRoomFrame(store, queue) {
    const wall = KV.el('div', 'room-wall');
    wall.append(KV.el('span', 'room-wall-label', 'handoff'));
    wall.title = 'capacity 0: nothing is stored — a task goes straight from a giver to a taker';
    const f = queue.flash, elapsed = f ? performance.now() - f.start : Infinity;
    if (f?.ok && elapsed < FLASH_MS) {
      const cell = KV.el('div', 'room-task crossing', `#${f.taskId}`);
      cell.title = `task #${f.taskId}, ${KV.seconds(store.tasks.get(f.taskId)?.durationMs)} · handed over to ${f.to}`;
      cell.style.animation = `room-new ${FLASH_MS}ms ease-out ${-elapsed}ms forwards, handoff-cross ${FLASH_MS}ms ease-in-out ${-elapsed}ms forwards`;
      wall.append(cell);
    }
    return wall;
  }

  // Визиты, которые ещё не устарели (store удаляет старые только при новом событии); незаконченные — всегда
  const recentVisits = queue => queue.visits.filter(v => v.state === 'inside' || performance.now() - v.at < VISIT_MS);

  // renderHandoff — отдельно: им рисует очередь CachedThreadPool (pool.js), без своих бейджей; recentVisits — для диорамы
  return { title: 'SynchronousQueue', params: [], types: [QUEUE, TASK], createStore, create, remove, operations, renderState, renderHandoff, recentVisits };
})();