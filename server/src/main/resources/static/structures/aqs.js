/*
 * AQSRunnableTask — группа «один AQS и задачи над ним»: модель по событиям WebSocket, отрисовка и REST-вызовы.
 * Плитка AQS на index.html.
 * Подключение: после base.js и components.js. Стили — aqs.css (общее для «комнаты» — .room* в components.css).
 * Всё лежит в объекте AQSView.
 *
 * Группа приходит тремя типами объектов: AQS (id группы = его id), задачи AQS_RUNNABLE_TASK (ссылаются на него
 * через state.aqsId, у каждой свой режим: shared или exclusive) и их RUNNABLE_TASK (прогресс работы). Item плитки —
 * группа. Потоки aqs-worker-N склеиваются по имени: run — в задаче, вход и выход — в AQS.
 * Хуки (tryAcquire* / tryRelease*) вложены в публичные методы того же потока; пары IN / OUT разбираются по имени
 * метода: у хуков свои имена, а поток одновременно — не больше чем в одном публичном методе и одном хуке.
 * Сам park событий не шлёт: пробуждение видно только как новая попытка tryAcquire* после отказа.
 *
 * Картинка — то, что есть у самого AQS (state и очередь), и отдельно задача: AQS сам не следит, кто захватил
 * (exclusiveOwnerThread из AbstractOwnableSynchronizer ставят наследники — наши хуки его не ставят), — это знает
 * только наша задача:
 *
 *   acquire  acquireShared  release  releaseShared
 *   state 1/2                                 ← поле AQS (за дробью — limit, правило хуков); вспыхивает при изменении
 *   [thread S] [thread E]                     ← очередь CLH, порядок — снимок JDK; за ней бледные — в acquire*, ещё
 *   ┌ task ───────────┐                         не получили отказа (в очередь не вставали)
 *   │ [▓▓▓░ thread E] │                       ← прошли acquire*: работают (заливка — прогресс), бледные — уже
 *   └─────────────────┘                         взяли (acquire* не вернулся) или отдают (release*)
 *
 * Метка в углу плашки — режим узла и arg (E2 — exclusive на 2, S1 — shared на 1). Попытка tryAcquire* — вспышка плашки (отказ — красная,
 * успех — зелёная), release* будит первого в очереди — его плашка вспыхивает рамкой. Клик по живой плашке — interrupt.
 */
const AQSView = (() => {
  const base = '/api/aqsrunnabletask';
  const GROUP_TASK = 'AQS_RUNNABLE_TASK';
  const AQS = 'AQS';
  const TASK = 'RUNNABLE_TASK';
  const PUBLIC = ['acquire', 'acquireShared', 'release', 'releaseShared']; // бейджи — только публичные методы
  const PHASE = { METHOD_IN: 'IN', METHOD_OUT: 'OUT', METHOD_OUT_FAILED: 'OUT_FAILED' };
  // Плашка вышедшего тает, как бейдж метода: одно событие, один ритм (KV.FADE_MS). Упавший — дольше: успеть прочитать
  const DONE_MS = KV.FADE_MS;
  const FAILED_MS = 4000;
  const fadeMsOf = w => w.result === 'failed' ? FAILED_MS : DONE_MS;
  const SIGNAL_KEEP_MS = 2500; // сколько store помнит release (кого он будил): диораме — успеть показать

  // Режим — по имени метода: *Shared — shared, остальное — exclusive
  const isShared = method => method.endsWith('Shared');

  // ---------- Задачи групп ----------
  // Операции плитки получают только id объекта (aqsId), а run нужен id задачи: aqsId → { 'E1': id, 'S2': id, … } —
  // задача по режиму и arg (id AQS_RUNNABLE_TASK). Заполняет store по событиям задач; одна на все stores — id задач
  // уникальны на весь сервер
  const taskIdsByGroup = new Map();
  const specKey = (shared, arg) => `${shared ? 'S' : 'E'}${arg}`;
  const taskIdOf = (aqsId, shared, arg) => taskIdsByGroup.get(aqsId)?.[specKey(shared, arg)] ?? null;

  // ---------- REST ----------
  // Запросы и лог HTTP — UI.call из base.js. Группа появится по событиям OBJECT_CREATED (AQS, потом задачи).
  // Тело пустое — limit и задачи по умолчанию задаёт сервер (CreateAQSRunnableTaskRequest)
  const create = () => UI.call('POST', base, {});

  // Отказ (409 — кто-то внутри) событий не порождает: пишем его в строку-уведомление
  async function remove(store, id) {
    const res = await UI.request('DELETE', `${base}/${id}`);
    const group = store.items.get(id);
    if (!res.ok && group) store.notify(group, `remove ✗ ${KV.errorMessage(res.body?.error)}`);
  }

  // interrupt — клик по плашке потока (отрисовка). 404 — поток уже вышел из run
  async function interruptOf(store, id, thread) {
    const group = store.items.get(id), taskId = group?.workers.get(thread)?.taskId;
    if (!group || taskId == null) return;
    const res = await UI.request('POST', `${base}/task/${taskId}/interrupt`, { thread });
    if (!res.ok) store.notify(group, `interrupt(${thread}) ✗ ${KV.errorMessage(res.body?.error)}`);
  }

  // Задачи ещё не пришли (страницу открыли после создания и событий задач не было) — запускать нечего
  const runOf = (shared, arg) => id => {
    const taskId = taskIdOf(id, shared, arg);
    return taskId == null ? null : UI.call('POST', `${base}/task/${taskId}/run`);
  };

  // Задачи группы — по умолчанию сервера (CreateAQSRunnableTaskRequest): оба режима, arg 1 и 2.
  // Задачи с таким режимом и arg в группе нет — кнопка ничего не делает
  const operation = (shared, arg) => {
    const [acq, rel] = shared ? ['acquireShared', 'releaseShared'] : ['acquire', 'release'];
    return { name: `run ${shared ? 'shared' : 'exclusive'} (${arg} slot${arg > 1 ? 's' : ''})`, fields: [],
      title: () => `POST ${base}/task/{id}/run — a new thread: ${acq}(${arg}) → task.run → ${rel}(${arg})`,
      run: runOf(shared, arg) };
  };
  const operations = [operation(false, 1), operation(false, 2), operation(true, 1), operation(true, 2)];

  // ---------- Модель ----------

  /**
   * store.items — aqsId → группа { id, snapshot, stateAt, methods, tasks, workers, signals, notice }:
   * snapshot — последний state AQS { state, limit, hasContended, queue: [{ thread, shared }] } (queue — head первым,
   *   best-effort: в METHOD_IN acquire поток в очередь ещё не встал); null — событий AQS ещё не было;
   * stateAt — когда state последний раз изменился (вспышка цифры);
   * methods — бейджи публичных методов (KV.methodsState);
   * tasks — id AQS_RUNNABLE_TASK → { id, taskId, shared, mode, arg } (taskId — её RUNNABLE_TASK, mode — AQSAcquireMode);
   * workers — поток → { taskId, shared, arg, stage, tries, lastTry, since, result, error, leftAt } по этапам:
   *   arriving — вошёл в run, ещё не в acquire*; acquiring — внутри acquire*, ещё ни одной неудачной попытки;
   *   queued — последняя попытка tryAcquire* — отказ: ждёт в очереди (или вот-вот встанет);
   *   working — acquire* вернулся, идёт задача (прогресс — store.tasks); releasing — внутри release*;
   *   done / failed — вышел из run (failed — с ошибкой, error), leftAt — плашка тает и пропадает;
   *   tries — попыток tryAcquire* за этот acquire, lastTry — { ok, at } последней; since — когда начался этап;
   *   taskId — id AQS_RUNNABLE_TASK (interrupt), null — run потока не видели (страницу открыли позже);
   * signals — недавние release* (SIGNAL_KEEP_MS) { by, woke, at }: woke — первый в очереди на входе в release*,
   *   его и будит signalNext(head) (null — очередь пуста, будить некого). На входе, а не на выходе: разбуженный
   *   может захватить и уйти из очереди раньше, чем придёт METHOD_OUT release (их шлют разные потоки);
   * notice — строка об отказе run / interrupt / remove.
   * store.tasks — RUNNABLE_TASK (KV.trackTask)
   */
  function createStore(render) {
    const items = new Map();
    const tasks = new Map();

    function apply(env) {
      const d = env.data;
      switch (d?.objectType) {
        case AQS: applyAQS(env, d); break;
        case GROUP_TASK: applyGroupTask(env, d); break;
        case TASK: KV.trackTask(tasks, env, render); break;
      }
    }

    // Группа создаётся по любому событию AQS или задачи: страницу могли открыть уже после создания
    function groupOf(id) {
      if (!items.has(id)) {
        items.set(id, { id, snapshot: null, stateAt: null, methods: KV.methodsState(PUBLIC), tasks: new Map(), workers: new Map(), signals: [], notice: null });
      }
      return items.get(id);
    }

    const freshWorker = (taskId, shared, arg, stage, now) =>
      ({ taskId, shared, arg, stage, tries: 0, lastTry: null, since: now, result: null, error: null, leftAt: null });

    // Поток группы; не видели его run (страницу открыли позже) — заводим по первому событию AQS, режим — по методу
    function workerOf(group, thread, method, now) {
      if (!group.workers.has(thread)) group.workers.set(thread, freshWorker(null, isShared(method), null, 'acquiring', now));
      return group.workers.get(thread);
    }

    function applyAQS(env, d) {
      if (env.type === 'OBJECT_REMOVED') { items.delete(d.objectId); taskIdsByGroup.delete(d.objectId); return; }
      const group = groupOf(d.objectId);
      if (d.state) {
        // state изменился — вспышка цифры (первый снимок — не изменение)
        if (group.snapshot && group.snapshot.state !== d.state.state) group.stateAt = performance.now();
        group.snapshot = d.state;
      }
      KV.trackMethod(group.methods, env); // бейджи: хуков среди них нет — вернёт null, это нормально
      const phase = PHASE[env.type];
      if (!phase || !d.method) return;
      const now = performance.now(), w = workerOf(group, d.thread, d.method, now);
      if (d.args?.arg != null && PUBLIC.includes(d.method)) w.arg ??= d.args.arg; // не видели run — arg из вызова
      const stage = s => { if (w.stage !== s) Object.assign(w, { stage: s, since: now }); };

      switch (d.method) {
        case 'acquire': case 'acquireShared':
          if (phase === 'IN') Object.assign(w, { stage: 'acquiring', since: now, tries: 0, lastTry: null });
          else if (phase === 'OUT') stage('working');
          // OUT_FAILED (ACQUIRE не бросает; бросит interruptibly) — итог придёт в run задачи
          break;
        case 'tryAcquire': case 'tryAcquireShared': {
          if (phase !== 'OUT') break;
          // tryAcquire — Boolean; tryAcquireShared — Int: >= 0 взяли, < 0 — в очередь
          const ok = d.method === 'tryAcquire' ? d.result === true : d.result >= 0;
          w.tries += 1;
          w.lastTry = { ok, at: now };
          if (!ok) stage('queued');
          break;
        }
        case 'release': case 'releaseShared':
          if (phase === 'IN') {
            stage('releasing');
            group.signals = group.signals.filter(s => now - s.at < SIGNAL_KEEP_MS);
            group.signals.push({ by: d.thread, woke: d.state?.queue?.[0]?.thread ?? null, at: now });
            setTimeout(render, SIGNAL_KEEP_MS);
          }
          break;
        // tryRelease* — всегда true (наш хук), этап не меняет
      }
    }

    function applyGroupTask(env, d) {
      if (env.type === 'OBJECT_REMOVED') {
        for (const group of items.values()) group.tasks.delete(d.objectId);
        return;
      }
      if (!d.state) return;
      const { aqsId, taskId, shared, mode, arg } = d.state;
      const group = groupOf(aqsId);
      group.tasks.set(d.objectId, { id: d.objectId, taskId, shared, mode, arg });
      taskIdsByGroup.set(aqsId, { ...taskIdsByGroup.get(aqsId), [specKey(shared, arg)]: d.objectId });
      if (d.method !== 'run') return;

      const now = performance.now();
      if (env.type === 'METHOD_IN') {
        group.workers.set(d.thread, freshWorker(d.objectId, shared, arg, 'arriving', now));
      } else if (env.type === 'METHOD_OUT' || env.type === 'METHOD_OUT_FAILED') {
        // Вышел из run: плашка тает, потом пропадает (leftAt — та же запись: её не заменили)
        const w = group.workers.get(d.thread) ?? freshWorker(d.objectId, shared, arg, 'done', now);
        const failed = env.type === 'METHOD_OUT_FAILED';
        Object.assign(w, { taskId: d.objectId, stage: failed ? 'failed' : 'done', since: now,
          result: failed ? 'failed' : d.result, error: failed ? d.error : null, leftAt: now });
        group.workers.set(d.thread, w);
        setTimeout(() => {
          if (group.workers.get(d.thread)?.leftAt === now) { group.workers.delete(d.thread); render(); }
        }, fadeMsOf(w));
      }
    }

    const notify = (group, text) => KV.notify(group, text, render);

    return { items, tasks, apply, notify };
  }

  // Недавние release* группы (store удаляет старые только при новом release)
  const recentSignals = (group, ms = SIGNAL_KEEP_MS) => group.signals.filter(s => performance.now() - s.at < ms);

  // ---------- Отрисовка ----------

  const FLASH_MS = KV.FADE_MS; // вспышка попытки и сигнала гаснет, как бейдж метода
  const QUEUE_SIDE = new Set(['arriving', 'acquiring', 'queued']);

  /** Бейджи, под ними state, очередь и задача; ниже — уведомление об отказе run / interrupt / remove */
  function renderState(store, group) {
    const now = performance.now();
    const out = [KV.renderBadges(group.methods), renderStateLine(group, now), renderQueue(store, group, now)];
    const row = KV.el('div', 'room-row');
    row.append(renderTask(store, group, now));
    out.push(row);
    const notice = KV.renderNotice(group);
    if (notice) out.push(notice);
    return out;
  }

  // Взял (последняя попытка удачная), но acquire* ещё не вернулся: state уже вырос, в задачу ещё не вошёл
  const entered = w => w.stage === 'acquiring' && w.lastTry?.ok;
  const inQueueLine = w => QUEUE_SIDE.has(w.stage) && !entered(w);

  /**
   * state — крупно, вспыхивает при изменении; limit — мелко: это правило наших хуков, а не поле AQS.
   * Снимка ещё нет (страницу открыли позже) — «?»
   */
  function renderStateLine(group, now) {
    const s = group.snapshot;
    // Одной строкой: state 0/2 — значение state (вспыхивает при изменении), за дробью limit
    const line = KV.el('div', 'aqs-line');
    const value = KV.el('span', 'aqs-state', s ? String(s.state) : '?');
    if (group.stateAt != null && now - group.stateAt < FLASH_MS) {
      value.style.animation = `aqs-state ${FLASH_MS}ms ease-out ${-(now - group.stateAt)}ms forwards`;
    }
    const fraction = KV.el('span', 'aqs-fraction');
    fraction.append(value, KV.el('span', 'aqs-limit', s ? `/${s.limit}` : ''));
    line.append(KV.el('span', 'aqs-key', 'state'), fraction);
    line.title = 'AQS state — an int with no meaning of its own: our hooks give it one. '
      + 'acquire(arg) adds arg, release(arg) subtracts arg, tryAcquire refuses when state + arg > limit (after the slash)';
    return line;
  }

  /**
   * Очередь CLH от head (без подписи): порядок — снимок JDK (snapshot.queue); получил отказ, но в снимке ещё нет — в хвост.
   * За ней бледные — внутри acquire*, отказа ещё не было: в очередь не вставали (могут и не встать — barging)
   */
  function renderQueue(store, group, now) {
    const line = KV.el('div', 'aqs-line');
    line.title = 'AQS wait queue (CLH), first after head — first to be woken by release';
    const waiting = [...group.workers].filter(([, w]) => inQueueLine(w));
    const order = (group.snapshot?.queue ?? []).map(q => q.thread);
    const rank = ([thread, w]) => {
      const i = order.indexOf(thread);
      return i >= 0 ? i : w.stage === 'queued' ? order.length : order.length + 1;
    };
    waiting.sort((a, b) => rank(a) - rank(b)); // sort устойчивый: вне снимка — в порядке прихода
    for (const [thread, w] of waiting) line.append(renderChip(store, group, thread, w, now));
    return line;
  }

  /**
   * Задача — не часть AQS: потоки, прошедшие acquire*. Работают — заливка прогресса; взяли, но acquire* ещё
   * не вернулся, или отдают (release*) — бледные; вышедшие тают там, где были
   */
  function renderTask(store, group, now) {
    const frame = KV.el('div', 'room aqs-room');
    frame.append(KV.el('span', 'room-label', 'task'));
    frame.title = 'not part of AQS: threads that passed acquire run the task, then release';
    for (const [thread, w] of group.workers) {
      if (!inQueueLine(w)) frame.append(renderChip(store, group, thread, w, now));
    }
    return frame;
  }

  /**
   * Плашка потока: буква режима в углу, у работающего — заливка прогресса; бледная — вне задачи (вход, release*);
   * вышедший тает (упавший — пунктиром и дольше). Вспышки: попытка tryAcquire* (красная — отказ, зелёная — успех)
   * и сигнал release* (рамкой — его разбудили). Живая — кнопка: клик — interrupt
   */
  function renderChip(store, group, thread, w, now) {
    const task = group.tasks.get(w.taskId);
    const acq = w.shared ? 'acquireShared' : 'acquire', rel = w.shared ? 'releaseShared' : 'release';
    const signal = recentSignals(group, FLASH_MS).findLast(s => s.woke === thread);
    const active = w.stage !== 'done' && w.stage !== 'failed' && w.taskId != null;

    const lines = [`${thread} · ${w.shared ? 'shared' : 'exclusive'}`, stageLine(w, acq, rel, now)];
    if (w.tries > 0 && w.stage !== 'done' && w.stage !== 'failed') {
      lines.push(`tries ×${w.tries}, last: ${w.lastTry.ok ? 'got it' : 'refused'}`);
    }
    if (signal) lines.push(`woken by the release of ${signal.by}`);
    if (active) lines.push(`click: interrupt — ${interruptLine(w, task)}`);

    const pale = w.stage === 'arriving' || w.stage === 'releasing' || entered(w) || (w.stage === 'acquiring' && !w.lastTry);
    const cls = ['aqs-chip', pale && 'entering', w.stage === 'failed' && 'rejected', active && 'clickable'].filter(Boolean).join(' ');
    const chip = KV.roomChip(thread, lines.join('\n'), cls);
    chip.append(KV.el('span', 'aqs-mode', `${w.shared ? 'S' : 'E'}${w.arg ?? ''}`));

    const tr = store.tasks.get(task?.taskId), run = tr?.runs.get(thread);
    if (w.stage === 'working' && run?.phase === 'RUN' && tr.durationMs) {
      const fill = KV.el('div', 'fill');
      fill.style.animation = `fill-up ${tr.durationMs}ms linear ${-Math.min(now - run.startedAt, tr.durationMs)}ms forwards`;
      chip.prepend(fill); // подпись — поверх заливки
    }

    const anims = [];
    if (w.leftAt != null) anims.push(`fade-out ${fadeMsOf(w)}ms ease-in ${-(now - w.leftAt)}ms forwards`);
    if (w.lastTry && now - w.lastTry.at < FLASH_MS) {
      anims.push(`${w.lastTry.ok ? 'aqs-try-ok' : 'aqs-try-fail'} ${FLASH_MS}ms ease-out ${-(now - w.lastTry.at)}ms forwards`);
    }
    if (signal) anims.push(`aqs-signal ${FLASH_MS}ms ease-out ${-(now - signal.at)}ms forwards`);
    // forwards: погасшая вспышка так и остаётся погасшей — перерисовывать ради её конца не нужно
    if (anims.length) chip.style.animation = anims.join(', ');
    if (active) chip.onclick = () => interruptOf(store, group.id, thread);
    return chip;
  }

  function stageLine(w, acq0, rel0, now) {
    const s = KV.seconds(now - w.since), a = w.arg ?? '?', acq = `${acq0}(${a})`, rel = `${rel0}(${a})`;
    switch (w.stage) {
      case 'arriving': return `entered run(), about to call ${acq}`;
      case 'acquiring': return w.lastTry?.ok ? `${acq}: the hook said yes — state is already +${a}, the task is next` : `inside ${acq}`;
      case 'queued': return `waits in the queue of ${acq} for ${s}`;
      case 'working': return 'runs the task';
      case 'releasing': return `inside ${rel}: wakes the first in the queue`;
      case 'done': return `left: ${acq} → task → ${rel}`;
      default: return `run failed: ${w.error ?? 'error'}`;
    }
  }

  // Что сделает interrupt — по этапу и способу входа (ACQUIRE прерывание в очереди не замечает)
  function interruptLine(w, task) {
    if (w.stage === 'working') return 'the task fails, release still happens';
    if (w.stage === 'releasing') return 'too late: it is already leaving';
    return task?.mode === 'ACQUIRE' || !task
      ? 'acquire ignores it: stays in the queue, the task fails after entering'
      : 'leaves the queue with InterruptedException';
  }

  // ---------- Описание для плитки (tiles.js) ----------

  const types = [AQS, GROUP_TASK, TASK];

  return {
    title: 'AQS',
    // Параметров нет: limit и задачи — по умолчанию на сервере (CreateAQSRunnableTaskRequest)
    params: [],
    types, createStore, create, remove, operations, renderState,
    recentSignals, // диорама — позже
  };
})();
