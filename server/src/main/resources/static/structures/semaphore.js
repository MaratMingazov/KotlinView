/*
 * Semaphore — модель по событиям WebSocket: кто ждёт, кто только что вышел, последний снимок.
 * Отрисовки своей нет: модель читают плитка задачи под семафором (semaphoretask.js) и её диорама.
 * Подключение: после base.js и components.js. Всё лежит в объекте SemaphoreModel.
 * Кто держит разрешения — модель не знает: у разрешения нет владельца, семафор этого не проверяет.
 */
const SemaphoreModel = (() => {
  const SEMAPHORE = 'SEMAPHORE';
  const METHODS = ['acquire', 'tryAcquire', 'release'];
  const LEAVING_MS = 1500; // сколько помним вышедшего (отказ, получил разрешение) — столько его показывают

  // ---------- Модель ----------

  /**
   * store.items — objectId → { id, methods, state, waiting, leaving }; store.apply(env) — учесть событие.
   * state — последний снимок с сервера: { initialPermits, availablePermits, fair, queuedThreads }.
   * waiting — thread → { method, permits, timeoutMs, since }: кто сейчас ждёт, по парам METHOD_IN / METHOD_OUT;
   *   since — когда начал ждать (performance.now()): по нему обратный отсчёт таймаута.
   *   Порядок Map — порядок METHOD_IN: точный источник «кто ждёт»; state.queuedThreads — только подсказка (best-effort).
   * leaving — кто только что вышел (последние LEAVING_MS): { thread, kind: 'got' | 'none' | 'failed' | 'released', permits,
   *   blocking, start }; blocking — метод мог ждать (acquire, tryAcquire с таймаутом): поток был среди waiting.
   */
  function createStore(render) {
    const items = new Map();

    function semaphoreOf(id) {
      if (!items.has(id)) {
        items.set(id, { id, methods: KV.methodsState(METHODS), state: null, waiting: new Map(), leaving: [] });
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

    // Поток вышел из метода: запомнить, чем кончилось, на LEAVING_MS — и перерисовать, когда забудем
    function leave(sem, d, phase, blocking) {
      const permits = d.args.permits;
      let kind;
      if (phase === 'OUT_FAILED') kind = 'failed';
      else if (d.method === 'release') kind = 'released';
      else if (d.method === 'acquire' || d.result === true) kind = 'got';
      else kind = 'none'; // tryAcquire вернул false: не хватило или не дождался

      const now = performance.now();
      sem.leaving = sem.leaving.filter(l => now - l.start < LEAVING_MS);
      sem.leaving.push({ thread: d.thread, kind, permits, blocking, start: now });
      setTimeout(render, LEAVING_MS);
    }

    return { items, apply };
  }

  return { createStore };
})();
