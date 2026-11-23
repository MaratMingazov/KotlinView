/*
 * Общие компоненты визуализации объектов: бейджи методов и цепочка узлов.
 * Подключение: <link rel="stylesheet" href="components.css"> и <script src="components.js"></script> до скрипта страницы.
 * Всё лежит в одном объекте KV, чтобы не конфликтовать с функциями страницы.
 */
const KV = (() => {
  const FADE_MS = 800;       // сколько затухает бейдж после выхода последнего потока — подбирается на глаз
  const NODE_FADE_MS = 1500; // сколько затухает подсветка узлов — дольше, чтобы успеть рассмотреть
  const PHASE_BY_TYPE = { METHOD_IN: 'IN', METHOD_OUT: 'OUT', METHOD_OUT_FAILED: 'OUT_FAILED' };

  const el = (tag, className, textContent) =>
    Object.assign(document.createElement(tag), { className: className ?? '', textContent: textContent ?? '' });

  // ---------- Методы: кто внутри и затухание бейджа ----------

  // { inside: { method: Set<thread> }, fade: { method: { start, failed } } }
  // fade.start — когда вышел последний поток (null — не затухает); fade.failed — гаснуть красным
  function methodsState(methods) {
    return {
      inside: Object.fromEntries(methods.map(m => [m, new Set()])),
      fade: Object.fromEntries(methods.map(m => [m, { start: null, failed: false }])),
    };
  }

  /** Учесть событие METHOD_*. Возвращает фазу 'IN' | 'OUT' | 'OUT_FAILED' или null, если событие не про эти методы. */
  function trackMethod(state, env) {
    const phase = PHASE_BY_TYPE[env.type];
    const { method, thread } = env.data;
    if (!phase || !(method in state.inside)) return null;

    // Внутри метода может быть несколько потоков сразу: горит, пока не вышел последний, потом затухает
    const inside = state.inside[method];
    if (phase === 'IN') {
      if (inside.size === 0) state.fade[method] = { start: null, failed: false }; // зажгли заново
      inside.add(thread);
    } else {
      inside.delete(thread);
      const fade = state.fade[method];
      fade.failed ||= phase === 'OUT_FAILED'; // ошибку запоминаем, даже если внутри ещё есть потоки
      if (inside.size === 0) fade.start = performance.now();
    }
    return phase;
  }

  /** Бейджи методов. only — какие и в каком порядке (по умолчанию — все, в порядке methodsState) */
  function renderBadges(state, only = Object.keys(state.inside)) {
    const badges = el('div', 'badges');
    for (const method of only) {
      const threads = state.inside[method];
      const badge = el('span', 'method' + (threads.size > 0 ? ' active' : ''), method + (threads.size > 1 ? ` ×${threads.size}` : ''));
      // Бейдж пересоздаётся на каждый render. Отрицательная задержка продолжает затухание
      // с того места, где оно было, — без неё анимация начиналась бы заново и бейдж дёргался
      const { start, failed } = state.fade[method];
      const elapsed = start === null ? Infinity : performance.now() - start;
      if (threads.size === 0 && elapsed < FADE_MS) {
        badge.style.animation = `${failed ? 'afterglow-failed' : 'afterglow'} ${FADE_MS}ms ease-out ${-elapsed}ms forwards`;
      }
      badge.title = threads.size > 0 ? [...threads].join('\n') : '';
      badges.append(badge);
    }
    return badges;
  }

  // ---------- Подсветка нового элемента ----------

  /**
   * Запомнить эффект и перерисовать, когда он догорит. effect: { new: index } — подсветить узел
   * (у очереди пула — ячейку только что принятой задачи)
   */
  function setEffect(holder, effect, render) {
    holder.nodeEffect = { ...effect, start: performance.now() };
    setTimeout(render, NODE_FADE_MS);
  }

  // ---------- Задача RUNNABLE_TASK: модель ----------
  // Кто внутри run() и сколько прошло — из событий самой задачи: по ним прогресс у воркера пула и в задаче семафора

  // Подпись потока в интерфейсе — пока одна на всех: потоки различаются цветом (по полному имени), имя — в подсказке
  const THREAD_LABEL = 'thread';

  const RUN_DONE_FADE_MS = FADE_MS; // сколько тает полоска потока после METHOD_OUT — как бейдж: одно событие, один ритм
  const RUN_FAILED_FADE_MS = 4000; // после ошибки — дольше, чтобы успеть прочитать

  // taskId → { id, durationMs, runs: Map<thread, { startedAt, elapsedMs, phase: 'RUN' | 'DONE' | 'FAILED', error, endedAt }> }
  function taskOf(tasks, id) {
    if (!tasks.has(id)) tasks.set(id, { id, durationMs: null, runs: new Map() });
    return tasks.get(id);
  }

  /** Учесть событие RUNNABLE_TASK (остальные пропускает). render — перерисовать, когда что-то догорит. */
  function trackTask(tasks, env, render) {
    const d = env.data;
    if (d?.objectType !== 'RUNNABLE_TASK') return null;
    if (env.type === 'OBJECT_REMOVED') { tasks.delete(d.objectId); return null; }

    // Задача создаётся и по OBJECT_CREATED, и по любому METHOD_*: страницу могли открыть уже после создания
    const task = taskOf(tasks, d.objectId);
    if (d.state?.durationMs !== undefined) task.durationMs = d.state.durationMs;
    if (d.method !== 'run') return task;

    // Строки различаем по потоку: один поток не может быть внутри run() дважды одновременно
    const now = performance.now();
    switch (env.type) {
      case 'METHOD_IN':
        task.runs.set(d.thread, { startedAt: now, elapsedMs: 0, phase: 'RUN', error: null, endedAt: null });
        break;
      case 'METHOD_PROGRESS': {
        const run = task.runs.get(d.thread);
        if (run) run.startedAt = now - d.progress.elapsedMs; // подровнять по серверу
        break;
      }
      case 'METHOD_OUT':
        finishRun(task, d.thread, 'DONE', null, render);
        break;
      case 'METHOD_OUT_FAILED':
        finishRun(task, d.thread, 'FAILED', d.error, render);
        break;
    }
    return task;
  }

  // Полоска не исчезает сразу: затухает, потом удаляется — если за это время тот же поток не зашёл снова
  function finishRun(task, thread, phase, error, render) {
    const now = performance.now();
    const run = task.runs.get(thread) ?? { startedAt: now };
    // DONE — до конца; ошибка — остановить там, где была
    run.elapsedMs = phase === 'DONE' ? (task.durationMs ?? 0) : Math.min(now - run.startedAt, task.durationMs ?? Infinity);
    Object.assign(run, { phase, error, endedAt: now });
    task.runs.set(thread, run);
    setTimeout(() => {
      if (task.runs.get(thread)?.endedAt === now) task.runs.delete(thread);
      render();
    }, phase === 'FAILED' ? RUN_FAILED_FADE_MS : RUN_DONE_FADE_MS);
  }

  // ---------- Плашка потока в «комнате» ----------

  /**
   * Плашка потока (.room-chip — components.css): цвет — по имени потока, подпись — «thread», полное имя — в подсказке.
   * cls — 'rejected', 'entering'…; заливку прогресса и полоску отсчёта класть в начало (prepend): подпись — поверх них
   */
  function roomChip(thread, title, cls = '') {
    const chip = el('div', `room-chip ${cls}`.trim());
    chip.style.setProperty('--thread', threadColor(thread));
    chip.title = title;
    chip.append(el('span', 'name', THREAD_LABEL));
    return chip;
  }

  // ---------- Мелочи ----------

  /**
   * Стабильный цвет для имени потока. Хеш FNV-1a, разнесённый «золотым углом»: имена, различающиеся одним
   * последним символом (factory-3-worker-1 и -2), получают далёкие оттенки. Прежний (h * 31 + c) % 360 давал им
   * разницу в 1° — воркеры одного пула были почти одного цвета.
   * Оттенок тот же, что у Iso.threadColor (iso-scene.js): поток в диораме того же цвета, что в плитке
   */
  function threadHue(name) {
    let h = 2166136261;
    for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return ((h >>> 0) * 137.508) % 360;
  }
  const threadColor = name => `hsl(${threadHue(name).toFixed(1)}, 60%, 65%)`;

  const seconds = ms => ms == null ? '?' : (ms / 1000).toFixed(1) + 's';

  // ---------- Пульт операций ----------

  /**
   * Сетка «метод | поля | ▶» для объекта id. operations: [{ name, fields: [[имя, значение по умолчанию]], title?(id), run(id, values) }],
   * values — имя поля → число. Создавать один раз на объект: поля не пересоздаются, введённое и фокус не теряются.
   */
  function renderOps(operations, id) {
    const ops = el('div', 'ops');
    for (const op of operations) {
      const args = el('span', 'args');
      const inputs = {};
      for (const [field, defaultValue] of op.fields ?? []) {
        const input = Object.assign(document.createElement('input'), { type: 'number', value: defaultValue, placeholder: field, title: field });
        input.setAttribute('aria-label', field);
        inputs[field] = input;
        args.append(input);
      }
      const run = el('button', 'run', '▶');
      run.title = op.title ? op.title(id) : `${op.name} #${id}`;
      run.onclick = () => op.run(id, Object.fromEntries(Object.entries(inputs).map(([f, input]) => [f, Number(input.value)])));
      // Enter в любом поле строки — то же, что ▶
      for (const input of Object.values(inputs)) input.addEventListener('keydown', e => { if (e.key === 'Enter') run.click(); });
      ops.append(el('span', 'name', op.name), args, run);
    }
    return ops;
  }

  // ---------- Строка «подпись дробь»: state 1/2, count 2/3 ----------

  /**
   * Строка «подпись дробь». value — крупно, цветом числа; вспыхивает, если менялось недавно (changedAt не старше
   * FADE_MS: одно событие, один ритм); total — за дробью, приглушённо (null — без дроби); value null — «?».
   * title — подсказка. Возвращает строку: в неё можно дописать своё (у latch — судьи)
   */
  function fraction(key, value, total, { changedAt = null, title = '' } = {}) {
    const line = el('div', 'fraction-line');
    const number = el('span', 'fraction-value', value == null ? '?' : String(value));
    const elapsed = changedAt == null ? Infinity : performance.now() - changedAt;
    if (elapsed < FADE_MS) number.style.animation = `fraction-changed ${FADE_MS}ms ease-out ${-elapsed}ms forwards`;
    const both = el('span', 'fraction');
    both.append(number, el('span', 'fraction-total', total == null ? '' : `/${total}`));
    line.append(el('span', 'fraction-key', key), both);
    line.title = title;
    return line;
  }

  // ---------- Строка-уведомление под плиткой: отказ REST и прочее ----------

  const NOTICE_MS = 4000; // сколько видна строка — успеть прочитать; тает к концу

  /** Текст ошибки из ответа сервера: "java.lang.IllegalStateException: AQS 7 has …" → "AQS 7 has …" */
  const errorMessage = error => error ? error.split(': ').slice(1).join(': ') || error : 'request failed';

  /**
   * Запомнить уведомление на объекте плитки (item.notice) и перерисовать — сейчас и когда погаснет.
   * kind — 'error' (отказ) или 'info' (сообщение: у пула — задачи, возвращённые shutdownNow)
   */
  function notify(item, text, render, kind = 'error') {
    item.notice = { text, kind, start: performance.now() };
    setTimeout(render, NOTICE_MS);
    render();
  }

  /**
   * Строка уведомления объекта: тает к концу NOTICE_MS (отрицательная задержка — продолжить с того места, где была).
   * Нет или погасла — null; с reserve — пустая строка той же высоты: место постоянное, плитка не прыгает
   */
  function renderNotice(item, { reserve = false } = {}) {
    const n = item.notice, elapsed = n ? performance.now() - n.start : Infinity;
    if (elapsed >= NOTICE_MS) return reserve ? el('div', 'notice reserve') : null;
    const row = el('div', `notice ${n.kind}${reserve ? ' reserve' : ''}`, n.text);
    row.style.animation = `fade-out ${NOTICE_MS}ms ease-in ${-elapsed}ms forwards`;
    return row;
  }

  return {
    el, methodsState, trackMethod, renderBadges, setEffect, renderOps,
    errorMessage, notify, renderNotice, fraction,
    trackTask,
    threadColor, seconds, THREAD_LABEL, roomChip,
    // Ритм затухания бейджа — для всего, что гаснет вместе с ним (одно событие, один ритм)
    FADE_MS,
  };
})();