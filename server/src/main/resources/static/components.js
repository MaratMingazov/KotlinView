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

  function renderBadges(state) {
    const badges = el('div', 'badges');
    for (const [method, threads] of Object.entries(state.inside)) {
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

  // ---------- Цепочка узлов ----------

  // Узел цепочки: метка (head/tail), значение, позиция
  function node(value, label, index) {
    const n = el('div', 'node');
    n.append(el('div', 'label', label), el('div', 'box', String(value)), el('div', 'idx', String(index)));
    return n;
  }

  const linkArrow = () => el('span', 'link-arrow', '⇄');

  // Анимация, продолженная с того места, где она была до пересоздания элемента
  const glow = (name, elapsed) => `${name} ${NODE_FADE_MS}ms ease-out ${-elapsed}ms forwards`;

  /**
   * Запомнить эффект и перерисовать, когда он догорит.
   * effect: { new: index } — подсветить узел;
   *         { ghost, kind: 'removed' | 'null' | 'failed', side?: 'head' | 'tail', title? } — призрак с текстом;
   *         { value, kind, side?, title? } — призрак элемента: рисуется тем же options.node, что и живые узлы
   */
  function setEffect(holder, effect, render) {
    holder.nodeEffect = { ...effect, start: performance.now() };
    setTimeout(render, NODE_FADE_MS);
  }

  // Подсветить новый узел: у обычного узла — фон кружка, у конверта — его контур
  function markNew(n, elapsed) {
    const box = n.querySelector('.box');
    if (box) { box.style.animation = glow('node-new', elapsed); return; }
    const envelope = n.querySelector('.envelope');
    if (envelope) {
      envelope.classList.add('new');
      envelope.style.setProperty('--glow', `${NODE_FADE_MS}ms`);
      envelope.style.setProperty('--glow-delay', `${-elapsed}ms`);
    }
  }

  // Призрак тает слева от головы (side: 'head', по умолчанию) или справа от хвоста (side: 'tail')
  function ghostParts(effect, elapsed, hasElements, makeNode) {
    const ghost = effect.value !== undefined ? makeNode(effect.value, '', '') : node(effect.ghost, '', '');
    ghost.classList.add('ghost', effect.kind);
    ghost.style.animation = glow('fade-out', elapsed);
    if (effect.title) ghost.title = effect.title;
    if (!hasElements) return [ghost];
    const arrow = linkArrow();
    arrow.style.animation = glow('fade-out', elapsed);
    return effect.side === 'tail' ? [arrow, ghost] : [ghost, arrow];
  }

  // Свободное место ограниченной очереди: пунктирная рамка без значения
  function slot(index) {
    const n = el('div', 'node slot');
    n.append(el('div', 'label'), el('div', 'box'), el('div', 'idx', String(index)));
    return n;
  }

  /**
   * options.node(value, label, index) — как нарисовать узел (и призрак элемента); по умолчанию просто значение.
   * options.capacity — ёмкость: после элементов дорисовать свободные ячейки (options.slot(index)), без стрелок —
   * это не узлы списка, а место под них. Вместо «head = tail = null» тогда видны пустые ячейки
   */
  function renderChain(elements, effect, options = {}) {
    const makeNode = options.node ?? node;
    const chain = el('div', 'chain');
    const elapsed = effect ? performance.now() - effect.start : Infinity;
    const active = elapsed < NODE_FADE_MS;
    const hasGhost = active && (effect.ghost !== undefined || effect.value !== undefined);
    const hasElements = elements.length > 0;

    if (hasGhost && effect.side !== 'tail') chain.append(...ghostParts(effect, elapsed, hasElements, makeNode));

    const last = elements.length - 1;
    elements.forEach((value, i) => {
      if (i > 0) chain.append(linkArrow());
      const label = i === 0 && i === last ? 'head·tail' : i === 0 ? 'head' : i === last ? 'tail' : '';
      const n = makeNode(value, label, i);
      if (active && effect.new === i) markNew(n, elapsed);
      chain.append(n);
    });

    const capacity = options.capacity;
    if (!hasElements && !hasGhost && !capacity) chain.append(el('span', 'empty', 'head = tail = null'));

    if (hasGhost && effect.side === 'tail') chain.append(...ghostParts(effect, elapsed, hasElements, makeNode));

    if (capacity) {
      const makeSlot = options.slot ?? slot;
      for (let i = elements.length; i < capacity; i++) chain.append(makeSlot(i));
    }
    return chain;
  }

  // ---------- Задача RUNNABLE_TASK: модель ----------
  // Конверт выглядит одинаково везде, где появляется задача: на своей странице, в очереди, у воркера пула.
  // Его вид берётся из событий самой задачи, а не из того, где он нарисован

  const RUN_DONE_FADE_MS = 1500;   // сколько тает полоска потока после METHOD_OUT
  const RUN_FAILED_FADE_MS = 4000; // после ошибки — дольше, чтобы успеть прочитать
  const FAILED_FLASH_MS = 2000;    // сколько затухает красная вспышка конверта

  // taskId → { id, durationMs, failedAt, runs: Map<thread, { startedAt, elapsedMs, phase: 'RUN' | 'DONE' | 'FAILED', error, endedAt }> }
  // failedAt — когда последний раз упал run(): по нему конверт вспыхивает красным
  function taskOf(tasks, id) {
    if (!tasks.has(id)) tasks.set(id, { id, durationMs: null, failedAt: null, runs: new Map() });
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
        task.failedAt = now;
        setTimeout(render, FAILED_FLASH_MS);
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

  /** Потоки, которые сейчас внутри run() задачи. */
  const runningThreads = task => [...task.runs].filter(([, run]) => run.phase === 'RUN').map(([thread]) => thread);

  // ---------- Задача RUNNABLE_TASK: конверт и полоски потоков ----------

  const SVG = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs, text) {
    const e = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // full — на странице задачи: внутри только длительность, task#id в заголовке карточки.
  // mini — в очереди и у воркеров: внутри #id и длительность. Над конвертом место под открытый клапан
  const ENVELOPE = {
    full: { viewBox: '-2 -26 100 92', width: 100, height: 92, w: 96, h: 62, rx: 4,
            flapOpen: 'M0 0 L48 -22 L96 0 Z', flapClosed: 'M0 0 L48 30 L96 0', lines: [['dur', 52]] },
    mini: { viewBox: '-2 -12 52 56', width: 52, height: 56, w: 48, h: 40, rx: 3,
            flapOpen: 'M0 0 L24 -10 L48 0 Z', flapClosed: 'M0 0 L24 14 L48 0', lines: [['id', 27], ['dur', 37]] },
  };

  function renderEnvelope(task, { size = 'full' } = {}) {
    const g = ENVELOPE[size];
    const inside = runningThreads(task);
    const now = performance.now();
    const flashing = task.failedAt !== null && inside.length === 0 && now - task.failedAt < FAILED_FLASH_MS;
    const className = ['envelope', size, inside.length > 0 && 'running', inside.length > 1 && 'multi', flashing && 'failed']
      .filter(Boolean).join(' ');

    const envelope = svg('svg', { class: className, viewBox: g.viewBox, width: g.width, height: g.height });
    envelope.style.setProperty('--flash', `${FAILED_FLASH_MS}ms`);
    if (flashing) envelope.style.setProperty('--flash-delay', `${-(now - task.failedAt)}ms`);
    envelope.append(
      svg('path', { class: 'flap-open', d: g.flapOpen }),
      svg('rect', { x: 0, y: 0, width: g.w, height: g.h, rx: g.rx }),
      svg('path', { class: 'flap-closed', d: g.flapClosed }),
    );
    const texts = { id: `#${task.id}`, dur: seconds(task.durationMs) };
    for (const [kind, y] of g.lines) envelope.append(svg('text', { class: kind, x: g.w / 2, y, 'text-anchor': 'middle' }, texts[kind]));

    const title = `task#${task.id}, ${seconds(task.durationMs)}` + (inside.length ? `\nвнутри run(): ${inside.join(', ')}` : '');
    envelope.append(svg('title', {}, title));
    return envelope;
  }

  /**
   * Узел цепочки с задачей: метка, мини-конверт, позиция. Конверт тот же, что на странице задачи:
   * если задача сейчас выполняется, клапан открыт и в очереди. Неизвестная задача — конверт с «?».
   */
  function taskNode(tasks, taskId, label, index) {
    const task = tasks.get(taskId) ?? { id: taskId, durationMs: null, failedAt: null, runs: new Map() };
    const n = el('div', 'node');
    n.append(el('div', 'label', label), renderEnvelope(task, { size: 'mini' }), el('div', 'idx', String(index)));
    return n;
  }

  // Свободная ячейка очереди задач — по размеру мини-конверта, чтобы ряд не прыгал при offer / take
  function taskSlot(index) {
    const n = el('div', 'node slot');
    n.append(el('div', 'label'), el('div', 'envelope-slot'), el('div', 'idx', String(index)));
    return n;
  }

  /**
   * Полоска на каждый поток внутри run(): заливка — прогресс, поверх — имя потока; цифры — в подсказке.
   * options.thread — только полоска этого потока; options.names: false — без имени поверх (имя уже есть рядом)
   */
  function renderRuns(task, options = {}) {
    const box = el('div', 'runs');
    const now = performance.now();
    const total = task.durationMs;
    for (const [thread, run] of task.runs) {
      if (options.thread !== undefined && thread !== options.thread) continue;
      const row = el('div', 'run-row' + (run.phase === 'DONE' ? ' done' : run.phase === 'FAILED' ? ' failed' : ''));
      row.style.setProperty('--thread', threadColor(thread));
      const bar = el('div', 'bar');
      if (run.phase === 'RUN' && total) {
        // Едет сама до конца задачи; METHOD_PROGRESS только подравнивает startedAt
        const elapsed = Math.min(now - run.startedAt, total);
        bar.style.animation = `fill-up ${total}ms linear ${-elapsed}ms forwards`;
        row.title = `${thread}: ${seconds(elapsed)} / ${seconds(total)} · осталось ${seconds(total - elapsed)}`;
      } else {
        bar.style.width = total ? `${Math.min(run.elapsedMs / total, 1) * 100}%` : '0';
      }
      if (run.phase !== 'RUN') {
        const fadeMs = run.phase === 'FAILED' ? RUN_FAILED_FADE_MS : RUN_DONE_FADE_MS;
        row.style.animation = `fade-out ${fadeMs}ms ease-in ${-(now - run.endedAt)}ms forwards`;
        row.title = run.phase === 'DONE' ? `${thread}: готово за ${seconds(total)}` : `${thread}: ✗ ${run.error}`;
      }
      row.append(bar);
      if (options.names !== false) row.append(el('span', 'thread', thread));
      box.append(row);
    }
    return box;
  }

  /**
   * Задача целиком: конверт, под ним полоски потоков внутри run(). Так задача выглядит везде, где её видно целиком:
   * на своей странице (все потоки) и у воркера пула (options.thread — только этот воркер)
   */
  function renderTask(task, options = {}) {
    const view = el('div', 'task-view');
    view.append(renderEnvelope(task, { size: options.size }), renderRuns(task, { thread: options.thread, names: options.names }));
    return view;
  }

  // ---------- Мелочи ----------

  // Стабильный цвет для имени потока
  function threadColor(name) {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return `hsl(${h}, 60%, 65%)`;
  }

  const seconds = ms => ms == null ? '?' : (ms / 1000).toFixed(1) + 's';

  return {
    el, methodsState, trackMethod, renderBadges, node, setEffect, renderChain,
    trackTask, runningThreads, renderEnvelope, renderRuns, renderTask, taskNode, taskSlot,
    threadColor, seconds,
  };
})();