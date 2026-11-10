/*
 * Semaphore: модель по событиям WebSocket, отрисовка разрешений и ждущих потоков, REST-вызовы.
 * Плитка на tiles.html; модель (createStore) переиспользует semaphoretask.js — плитка Semaphore.
 * Подключение: после base.js и components.js. Стили — semaphore.css. Всё лежит в объекте SemaphoreView.
 *
 * Что рисуем сверху вниз:
 *   бейджи методов → кто ждёт (acquire / tryAcquire с таймаутом) → жетоны разрешений → кто только что вышел → очередь AQS
 * Кто держит разрешения — не рисуем: семафор этого не знает, владельца у разрешения нет. В этом и урок.
 */
const SemaphoreView = (() => {
  const base = '/api/semaphore';
  const SEMAPHORE = 'SEMAPHORE';
  const METHODS = ['acquire', 'tryAcquire', 'release'];
  const FLASH_MS = 1500;  // сколько тают плашки вышедших и подсветка жетонов
  const MAX_TOKENS = 20;  // больше — сворачиваем в «+N», чтобы ряд не разъезжался

  // ---------- REST ----------
  // Запросы и лог HTTP — UI.call из base.js. Объект появится по событию OBJECT_CREATED

  const create = (permits, fair) => UI.call('POST', base, { permits, fair });
  const remove = (store, id) => UI.call('DELETE', `${base}/${id}`);

  const operations = [
    { name: 'acquire', fields: [['permits', 1]],
      title: id => `POST ${base}/${id}/acquire {permits} — acquire() in a new thread, waits until enough permits`,
      run: (id, v) => UI.call('POST', `${base}/${id}/acquire`, { permits: v.permits }) },
    { name: 'tryAcquire', fields: [['permits', 1]],
      title: id => `POST ${base}/${id}/tryAcquire {permits} — non-blocking, in the HTTP thread; barges even when fair`,
      run: (id, v) => UI.call('POST', `${base}/${id}/tryAcquire`, { permits: v.permits }) },
    { name: 'tryAcquire(t)', fields: [['permits', 1], ['timeoutMs', 3000]],
      title: id => `POST ${base}/${id}/tryAcquireTimeout {permits, timeoutMs} — in a new thread, waits at most timeoutMs`,
      run: (id, v) => UI.call('POST', `${base}/${id}/tryAcquireTimeout`, { permits: v.permits, timeoutMs: v.timeoutMs }) },
    { name: 'release', fields: [['permits', 1]],
      title: id => `POST ${base}/${id}/release {permits} — in the HTTP thread: anyone may release, even without acquire`,
      run: (id, v) => UI.call('POST', `${base}/${id}/release`, { permits: v.permits }) },
  ];

  // ---------- Модель ----------

  /**
   * store.items — objectId → { id, methods, state, waiting, leaving, tokenEffect }; store.apply(env) — учесть событие.
   * state — последний снимок с сервера: { initialPermits, availablePermits, fair, queuedThreads }.
   * waiting — thread → { method, permits, timeoutMs, since }: кто сейчас ждёт, по парам METHOD_IN / METHOD_OUT;
   *   since — когда начал ждать (performance.now()): по нему обратный отсчёт таймаута.
   *   Порядок Map — порядок METHOD_IN: точный источник «кто ждёт»; state.queuedThreads — только подсказка (best-effort).
   * leaving — кто только что вышел: { thread, kind: 'got' | 'none' | 'failed' | 'released', permits, barged, blocking, start };
   *   blocking — метод мог ждать (acquire, tryAcquire с таймаутом): поток был среди waiting.
   * tokenEffect — { kind: 'gain' | 'take', count, start }: подсветить появившиеся / ушедшие жетоны
   */
  function createStore(render) {
    const items = new Map();

    function semaphoreOf(id) {
      if (!items.has(id)) {
        items.set(id, { id, methods: KV.methodsState(METHODS), state: null, waiting: new Map(), leaving: [], tokenEffect: null });
      }
      return items.get(id);
    }

    function apply(env) {
      const d = env.data;
      if (d?.objectType !== SEMAPHORE) return;
      if (env.type === 'OBJECT_REMOVED') { items.delete(d.objectId); return; }
      // Объект создаётся и по OBJECT_CREATED, и по любому METHOD_*: страницу могли открыть уже после создания
      const sem = semaphoreOf(d.objectId);
      if (d.state) sem.state = d.state;
      const phase = KV.trackMethod(sem.methods, env);
      if (!phase) return;

      // Ждут только блокирующие: acquire и tryAcquire с таймаутом. tryAcquire без таймаута выходит сразу
      const blocking = d.method === 'acquire' || (d.method === 'tryAcquire' && d.args.timeoutMs !== undefined);
      if (phase === 'IN') {
        if (blocking) sem.waiting.set(d.thread, { method: d.method, permits: d.args.permits, timeoutMs: d.args.timeoutMs, since: performance.now() });
        return;
      }
      sem.waiting.delete(d.thread);
      leave(sem, d, phase, blocking);
    }

    // Поток вышел из метода: его плашка тает, а жетоны подсвечиваются — сколько пришло или ушло
    function leave(sem, d, phase, blocking) {
      const permits = d.args.permits;
      let kind;
      if (phase === 'OUT_FAILED') kind = 'failed';
      else if (d.method === 'release') kind = 'released';
      else if (d.method === 'acquire' || d.result === true) kind = 'got';
      else kind = 'none'; // tryAcquire вернул false: не хватило или не дождался

      // Обгон очереди: неблокирующий tryAcquire получил разрешения, хотя кто-то уже ждёт. Так бывает даже при fair = true
      const barged = kind === 'got' && !blocking && sem.waiting.size > 0;

      const now = performance.now();
      sem.leaving = sem.leaving.filter(l => now - l.start < FLASH_MS);
      sem.leaving.push({ thread: d.thread, kind, permits, barged, blocking, start: now });
      if (kind === 'got') sem.tokenEffect = { kind: 'take', count: permits, start: now };
      if (kind === 'released') sem.tokenEffect = { kind: 'gain', count: permits, start: now };
      setTimeout(render, FLASH_MS);
    }

    return { items, apply };
  }

  // ---------- Отрисовка ----------

  /** Состояние семафора — элементы подряд: бейджи, ждущие, жетоны, вышедшие, очередь AQS. */
  function renderState(store, sem) {
    return [KV.renderBadges(sem.methods), renderWaiting(sem), renderTokens(sem), renderLeaving(sem), renderAqs(sem)];
  }

  function row(label, title) {
    const r = KV.el('div', 'sem-row');
    const l = KV.el('span', 'sem-label', label);
    if (title) l.title = title;
    r.append(l);
    return r;
  }

  // Кто ждёт — в порядке METHOD_IN: сколько разрешений просит и, если с таймаутом, сколько готов ждать
  function renderWaiting(sem) {
    const r = row('waiting', 'threads inside acquire() / tryAcquire(timeout), in the order they entered');
    if (sem.waiting.size === 0) { r.append(KV.el('span', 'empty', 'nobody')); return r; }
    for (const [thread, w] of sem.waiting) {
      const text = thread + (w.permits !== 1 ? ` ×${w.permits}` : '') + (w.timeoutMs !== undefined ? ` ⏱${KV.seconds(w.timeoutMs)}` : '');
      const title = `${thread} is inside ${w.method}(${w.permits}${w.timeoutMs !== undefined ? `, ${w.timeoutMs} ms` : ''}): waits for permits`;
      r.append(chip(thread, text, title));
    }
    return r;
  }

  /**
   * Жетоны: ● свободное, ○ взятое (до initialPermits), ◆ сверх initialPermits — release без acquire «напечатал» лишнее,
   * пунктирный ✕ — долг: счётчик ниже нуля (семафор создан с отрицательными permits).
   * Порядок: сначала свободные, потом взятые — подсвечиваем край между ними: release добавил справа от свободных,
   * acquire забрал ближайшие к ним.
   */
  function renderTokens(sem) {
    const r = row('permits');
    const s = sem.state;
    if (!s) { r.append(KV.el('span', 'empty', '?')); return r; }

    const initial = Math.max(s.initialPermits, 0);
    const available = s.availablePermits;
    const free = Math.max(available, 0);
    const kinds = [];
    for (let i = 0; i < free; i++) kinds.push(i < initial ? 'free' : 'extra');
    for (let i = free; i < initial; i++) kinds.push('taken');
    for (let i = 0; i < -available; i++) kinds.push('debt');

    const effect = sem.tokenEffect;
    const elapsed = effect ? performance.now() - effect.start : Infinity;
    const active = elapsed < FLASH_MS;
    const highlighted = i => active && (effect.kind === 'gain'
      ? i >= free - effect.count && i < free  // только что появились — последние свободные
      : i >= free && i < free + effect.count); // только что забрали — первые взятые

    const tokens = KV.el('span', 'tokens');
    kinds.slice(0, MAX_TOKENS).forEach((kind, i) => {
      const t = KV.el('span', `token ${kind}`);
      t.title = { free: 'free permit', extra: 'free permit above initialPermits: release() without acquire()',
                  taken: 'taken permit', debt: 'debt: availablePermits < 0, release() is needed first' }[kind];
      if (highlighted(i)) t.style.animation = `${effect.kind === 'gain' ? 'token-gain' : 'token-take'} ${FLASH_MS}ms ease-out ${-elapsed}ms forwards`;
      tokens.append(t);
    });
    if (kinds.length > MAX_TOKENS) tokens.append(KV.el('span', 'empty', `+${kinds.length - MAX_TOKENS}`));

    const count = KV.el('span', 'sem-count', `${available} / ${s.initialPermits} · ${s.fair ? 'fair' : 'nonfair'}`);
    count.title = 'availablePermits / initialPermits';
    r.append(tokens, count);
    return r;
  }

  // Только что вышедшие тают: ✓ получил, ✗ не получил (tryAcquire → false, таймаут), красный — упал, ↑ — отдал
  function renderLeaving(sem) {
    const r = row('left');
    const now = performance.now();
    const recent = sem.leaving.filter(l => now - l.start < FLASH_MS);
    if (recent.length === 0) { r.append(KV.el('span', 'empty', '—')); return r; }
    for (const l of recent) {
      const mark = { got: `✓${l.permits}`, none: '✗', failed: '✗', released: `↑${l.permits}` }[l.kind];
      const title = {
        got: `${l.thread} got ${l.permits} permit(s)`,
        none: `${l.thread}: tryAcquire returned false — not enough permits (or timed out)`,
        failed: `${l.thread}: failed (e.g. interrupted or permits < 0)`,
        released: `${l.thread} released ${l.permits} permit(s) — it did not have to acquire them`,
      }[l.kind] + (l.barged ? '\nbarged: got permits while others were waiting' : '');
      const c = chip(l.thread, `${l.thread} ${mark}${l.barged ? ' ⤴ barged' : ''}`, title);
      c.classList.add('leaving', l.kind);
      if (l.barged) c.classList.add('barged');
      c.style.animation = `fade-out ${FLASH_MS}ms ease-in ${-(now - l.start)}ms forwards`;
      r.append(c);
    }
    return r;
  }

  // Очередь AQS из последнего снимка: подсказка о настоящем порядке, может отставать (поток, уснув, событий не шлёт)
  function renderAqs(sem) {
    const queued = sem.state?.queuedThreads ?? [];
    const line = KV.el('div', 'sem-aqs', `AQS queue: ${queued.length ? queued.join(', ') : 'empty'}`);
    line.title = 'getQueuedThreads() from the last snapshot, first in line first. Best-effort: ' +
      'a thread that went to sleep sends no events, so this updates only on the next event of the semaphore';
    return line;
  }

  function chip(thread, text, title) {
    const c = KV.el('span', 'thread-chip', text.replace(thread, KV.THREAD_LABEL)); // имя — в подсказке (title)
    c.style.setProperty('--thread', KV.threadColor(thread));
    c.title = title;
    return c;
  }

  // createStore — отдельно: его модель (waiting, state) переиспользует semaphoretask.js со своей отрисовкой
  return { types: [SEMAPHORE], createStore, create, remove, operations, renderState };
})();