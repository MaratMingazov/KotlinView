/*
 * SynchronousQueue<Runnable>: модель по событиям WebSocket, отрисовка и REST-вызовы.
 * Плитка на index.html — вид «комната» (renderState): ждущие отдать и получить по бокам от стенки «handoff».
 * Store нужен и pool.js (очередь CachedThreadPool — стенка handoff в его плитке).
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
  const VISIT_MS = 1200;         // сколько помнится законченный визит: плашка тает, задача пролетает стенку; курьер диорамы успевает подъехать
  const POLL_TIMEOUT_MS = 2000;  // poll(timeout) с пульта — фиксированный, без поля ввода (как timeout 2s у семафора)

  const isGive = method => method === 'offer' || method === 'put'; // отдающая сторона; take / poll — получающая

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
   * store.items — objectId → { id, methods, visits }; store.apply(env) — учесть событие.
   * visits — и для плитки, и для диорамы: по визиту на каждый вызов offer / put / take / poll
   * { id, method, thread, taskId, timeoutMs, state, at, pair }, в порядке прихода (вид «комната» ставит у стенки
   * последнего: нечестная очередь — стек).
   * id — порядковый номер (ключ актёра: один HTTP-поток может сделать несколько offer подряд); taskId — у отдающего
   * из аргументов, у получающего — из результата (до выхода null); state — 'inside' (ещё в методе), 'done' (отдал /
   * получил), 'rejected' (offer → false, poll не дождался), 'failed' (упал, например прерван); at — когда сменилось
   * состояние; pair — id визита с другой стороны. Открывается на METHOD_IN (offer длится микросекунды — без визита
   * курьер не появился бы), законченные старше VISIT_MS удаляются. Пара — когда получающий вышел с задачей: отдающий
   * с тем же taskId уже открыт (вошёл раньше, чем задача кому-то досталась), а METHOD_OUT сторон приходят в любом порядке.
   * Пока визит 'inside', at — когда поток вошёл (по нему убывает полоска poll); timeoutMs — только у poll.
   * Законченный визит нужен и плитке: без него при мгновенной передаче (put, когда taker уже ждёт) отдающего
   * не было бы видно вовсе
   */
  function createStore(render) {
    const items = new Map();
    // taskId → задача из KV.trackTask: длительность передаваемой задачи — в подсказке
    const tasks = new Map();
    let visitSeq = 0;

    function queueOf(id) {
      if (!items.has(id)) items.set(id, { id, methods: KV.methodsState(METHODS), visits: [] });
      return items.get(id);
    }

    function apply(env) {
      const d = env.data;
      if (d?.objectType === TASK) { KV.trackTask(tasks, env, render); return; }
      if (d?.objectType !== QUEUE) return;
      if (env.type === 'OBJECT_REMOVED') { items.delete(d.objectId); return; }
      const queue = queueOf(d.objectId);
      const phase = KV.trackMethod(queue.methods, env);
      if (phase) trackVisit(queue, d, phase);
    }

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

    return { items, tasks, apply };
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
    const visits = recentVisits(queue);
    row.append(renderRoomGivers(visits), renderRoomFrame(store, visits), renderRoomTakers(visits));
    return [KV.renderBadges(queue.methods), row];
  }

  // Только что вышедший — у стенки (он только что был там): отдал / получил — тает; offer → false — отскакивает
  // от стенки, как у полной LBQ; прерван или poll не дождался — пунктир и тает
  function roomLeaving(visits, give) {
    const now = performance.now();
    return visits.filter(v => v.state !== 'inside' && isGive(v.method) === give).reverse().map(v => {
      const age = now - v.at;
      if (give && v.state === 'rejected') {
        const chip = KV.roomChip(v.thread, `${v.thread}: offer() returned false — nobody waits in take`, 'rejected');
        chip.style.animation = `room-bounce ${VISIT_MS}ms ease-in-out ${-age}ms forwards`;
        return chip;
      }
      const title = v.state === 'failed' ? `${v.thread}: interrupted` : give
        ? `${v.thread} gave task #${v.taskId}` : v.state === 'done' ? `${v.thread} got task #${v.taskId}` : `${v.thread}: poll() timed out, left without a task`;
      const chip = KV.roomChip(v.thread, title, v.state === 'done' ? '' : 'rejected');
      chip.style.animation = `fade-out ${VISIT_MS}ms ease-in ${-age}ms forwards`;
      return chip;
    });
  }

  // У входа (.room-queue.entry: первый в DOM — у стенки): вышедшие, за ними ждущие в put — от последнего к первому.
  // offer внутри (микросекунды) не рисуем — его видно, когда он вышел
  function renderRoomGivers(visits) {
    const side = KV.el('div', 'room-queue entry');
    side.append(...roomLeaving(visits, true));
    for (const v of visits.filter(v => v.state === 'inside' && v.method === 'put').reverse()) {
      side.append(KV.roomChip(v.thread, `${v.thread} is inside put(task #${v.taskId}): waits for a taker · ${UNFAIR}`));
    }
    return side;
  }

  // У выхода — так же: вышедшие, за ними ждущие в take / poll — от последнего к первому. У poll внизу убывает
  // полоска — сколько осталось до таймаута (как у семафора при tryAcquire(timeout))
  function renderRoomTakers(visits) {
    const side = KV.el('div', 'room-queue exit');
    side.append(...roomLeaving(visits, false));
    const now = performance.now();
    for (const v of visits.filter(v => v.state === 'inside' && !isGive(v.method)).reverse()) {
      const timed = v.timeoutMs != null;
      const call = timed ? `${v.method}(${KV.seconds(v.timeoutMs)})` : `${v.method}()`;
      const chip = KV.roomChip(v.thread, `${v.thread} is inside ${call}: waits for a giver${timed ? ', gives up after the timeout' : ''} · ${UNFAIR}`);
      if (timed) {
        const bar = KV.el('div', 'countdown');
        bar.style.animation = `room-count ${v.timeoutMs}ms linear ${-(now - v.at)}ms forwards`;
        chip.prepend(bar);
      }
      side.append(chip);
    }
    return side;
  }

  // Не рамка, а стенка: мест нет даже визуально — задачу положить некуда. Передача — ячейка задачи проезжает
  // поверх стенки слева направо (от отдающего к получающему) и тает: прошла насквозь, нигде не остановилась
  // Передачу видно со стороны получателя: take / poll вышли с задачей — неважно, отдали её через offer или put
  function renderRoomFrame(store, visits) {
    const wall = KV.el('div', 'room-wall');
    wall.append(KV.el('span', 'room-wall-label', 'handoff'));
    wall.title = 'capacity 0: nothing is stored — a task goes straight from a giver to a taker';
    const got = visits.findLast(v => !isGive(v.method) && v.state === 'done');
    if (got) {
      const elapsed = performance.now() - got.at;
      const cell = KV.el('div', 'room-task crossing', `#${got.taskId}`);
      cell.title = `task #${got.taskId}, ${KV.seconds(store.tasks.get(got.taskId)?.durationMs)} · handed over to ${got.thread}`;
      cell.style.animation = `room-new ${VISIT_MS}ms ease-out ${-elapsed}ms forwards, handoff-cross ${VISIT_MS}ms ease-in-out ${-elapsed}ms forwards`;
      wall.append(cell);
    }
    return wall;
  }

  // Визиты, которые ещё не устарели (store удаляет старые только при новом событии); незаконченные — всегда
  const recentVisits = queue => queue.visits.filter(v => v.state === 'inside' || performance.now() - v.at < VISIT_MS);

  // recentVisits — и для диорамы
  return { title: 'SynchronousQueue', params: [], types: [QUEUE, TASK], createStore, create, remove, operations, renderState, recentVisits };
})();