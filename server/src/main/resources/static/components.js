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
   * effect: { new: index } — подсветить узел; { ghost, kind: 'removed' | 'null' | 'failed', side?: 'head' | 'tail', title? } — призрак
   */
  function setEffect(holder, effect, render) {
    holder.nodeEffect = { ...effect, start: performance.now() };
    setTimeout(render, NODE_FADE_MS);
  }

  // Призрак тает слева от головы (side: 'head', по умолчанию) или справа от хвоста (side: 'tail')
  function ghostParts(effect, elapsed, hasElements) {
    const ghost = node(effect.ghost, '', '');
    ghost.classList.add(effect.kind);
    ghost.style.animation = glow('fade-out', elapsed);
    if (effect.title) ghost.title = effect.title;
    if (!hasElements) return [ghost];
    const arrow = linkArrow();
    arrow.style.animation = glow('fade-out', elapsed);
    return effect.side === 'tail' ? [arrow, ghost] : [ghost, arrow];
  }

  /** options.node(value, label, index) — как нарисовать узел; по умолчанию просто значение. */
  function renderChain(elements, effect, options = {}) {
    const makeNode = options.node ?? node;
    const chain = el('div', 'chain');
    const elapsed = effect ? performance.now() - effect.start : Infinity;
    const active = elapsed < NODE_FADE_MS;
    const hasGhost = active && effect.ghost !== undefined;
    const hasElements = elements.length > 0;

    if (hasGhost && effect.side !== 'tail') chain.append(...ghostParts(effect, elapsed, hasElements));

    const last = elements.length - 1;
    elements.forEach((value, i) => {
      if (i > 0) chain.append(linkArrow());
      const label = i === 0 && i === last ? 'head·tail' : i === 0 ? 'head' : i === last ? 'tail' : '';
      const n = makeNode(value, label, i);
      if (active && effect.new === i) n.querySelector('.box').style.animation = glow('node-new', elapsed);
      chain.append(n);
    });

    if (!hasElements && !hasGhost) chain.append(el('span', 'empty', 'head = tail = null'));

    if (hasGhost && effect.side === 'tail') chain.append(...ghostParts(effect, elapsed, hasElements));
    return chain;
  }

  // ---------- Мелочи ----------

  // Стабильный цвет для имени потока
  function threadColor(name) {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return `hsl(${h}, 60%, 65%)`;
  }

  const seconds = ms => ms == null ? '?' : (ms / 1000).toFixed(1) + 's';

  return { el, methodsState, trackMethod, renderBadges, node, setEffect, renderChain, threadColor, seconds };
})();