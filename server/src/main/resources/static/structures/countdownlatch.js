/*
 * CountDownLatch — одноразовые ворота со счётчиком: модель по событиям WebSocket, отрисовка и REST-вызовы.
 * Плитка CountDownLatch на index.html.
 * Подключение: после base.js и components.js. Стили — countdownlatch.css (общее для «комнаты» — .room* в components.css).
 * Всё лежит в объекте CountDownLatchView.
 *
 * Задачи нет: жизнь потока latch-waiter-N — один вызов await (IN — встал на старт, OUT — уехал). countDown зовёт
 * HTTP-поток («судья»). Очередь ждущих latch не отдаёт: кто ждёт — по парам METHOD_IN / METHOD_OUT, в порядке прихода.
 *
 * Картинка — «комната»:
 *
 *   await  countDown
 *   count 2/3  [thread]                          count — вспыхивает при изменении, /3 — initialCount; рядом — судья
 *   [thread] [thread] [thread] ┃ [thread]        слева — ждут (первый пришедший — у ворот; у await(timeout) —
 *                              ворота            полоска таймаута); ворота закрыты (count > 0) или открыты (0);
 *                                                справа — выехавшие, тают
 *
 * Не дождался (таймаут) или прервали — тает на своём месте пунктиром. Клик по ждущему — interrupt.
 */
const CountDownLatchView = (() => {
  const base = '/api/countdownlatch';
  const LATCH = 'COUNT_DOWN_LATCH';
  // Вышедший тает, как бейдж метода: одно событие, один ритм (KV.FADE_MS). Прерванный — дольше: успеть прочитать
  const LEAVE_MS = KV.FADE_MS;
  const FAILED_MS = 4000;
  const leaveMsOf = l => l.kind === 'interrupted' ? FAILED_MS : LEAVE_MS;
  const SHOT_MS = KV.FADE_MS;      // плашка судьи тает
  const SHOT_KEEP_MS = 2500;       // сколько store помнит countDown: диораме — успеть показать судью
  const LEAVE_KEEP_MS = 2500;      // сколько store помнит вышедших: диораме — успеть проехать (плитка тает раньше)
  const DEPART_STEP_MS = 250;      // диорама: выпущенные трогаются по одной — с таким шагом, в порядке выхода из await
  const FLASH_MS = KV.FADE_MS;     // вспышка count

  // ---------- REST ----------
  // Запросы и лог HTTP — UI.call из base.js. Latch появится по событию OBJECT_CREATED

  const create = count => UI.call('POST', base, { count });

  // Отказ (409 — кто-то ждёт) событий не порождает: пишем его в строку-уведомление
  async function remove(store, id) {
    const res = await UI.request('DELETE', `${base}/${id}`);
    const latch = store.items.get(id);
    if (!res.ok && latch) store.notify(latch, `remove ✗ ${KV.errorMessage(res.body?.error)}`);
  }

  // interrupt — клик по плашке ждущего. 404 — поток уже вышел из await
  async function interruptOf(store, id, thread) {
    const res = await UI.request('POST', `${base}/${id}/interrupt`, { thread });
    const latch = store.items.get(id);
    if (!res.ok && latch) store.notify(latch, `interrupt(${thread}) ✗ ${KV.errorMessage(res.body?.error)}`);
  }

  // await(timeout) сервер умеет ({ timeoutMs }), модель и отрисовка его понимают — кнопки пока нет
  const operations = [
    { name: 'await', fields: [],
      title: id => `POST ${base}/${id}/await — a new thread waits until count is 0, then leaves`,
      run: id => UI.call('POST', `${base}/${id}/await`) },
    { name: 'countDown', fields: [],
      title: id => `POST ${base}/${id}/countDown — the judge: count − 1 (in the HTTP thread); at 0 — nothing`,
      run: id => UI.call('POST', `${base}/${id}/countDown`) },
  ];

  // ---------- Модель ----------

  /**
   * store.items — latchId → { id, snapshot, countAt, methods, waiting, leaving, shots, shooting, notice }:
   * snapshot — последний state { initialCount, count }; null — событий ещё не было;
   * countAt — когда count последний раз изменился (вспышка);
   * methods — бейджи await, countDown (KV.methodsState);
   * waiting — поток → { since, timeoutMs, countAtIn }: кто в await, порядок Map — порядок METHOD_IN;
   *   countAtIn — count в снимке METHOD_IN: 0 — ворота уже открыты, проедет сразу;
   * leaving — недавно вышедшие { thread, kind, since, at }: since — когда вошёл в await; kind — released (дождался открытия), through (при входе было 0),
   *   timeout (await(timeout) вернул false), interrupted (InterruptedException). Вид — по countAtIn и результату,
   *   а не по порядку событий: разбуженный может выйти раньше, чем придёт METHOD_OUT countDown (шлют разные потоки).
   *   Помним LEAVE_KEEP_MS (плитка показывает меньше — сама смотрит на возраст). У released ещё departAt — когда
   *   диорама трогает машину: по одной, шагом DEPART_STEP_MS в порядке METHOD_OUT, а это порядок каскада JDK
   *   (первый проснувшийся будит следующего); lastDepart — departAt последнего выпущенного;
   * shots — недавние countDown (SHOT_KEEP_MS) { by, from, to, kind, at }: kind — open (to = 0, from > 0: открыл он),
   *   tick (минус один), idle (было 0 — ничего). from — count на METHOD_IN этого потока (shooting), to — на METHOD_OUT;
   *   два судьи сразу — from / to best-effort, open при этом верный;
   * notice — строка об отказе interrupt / remove
   */
  function createStore(render) {
    const items = new Map();

    // Latch создаётся и по OBJECT_CREATED, и по любому METHOD_*: страницу могли открыть уже после создания
    function latchOf(id) {
      if (!items.has(id)) {
        items.set(id, { id, snapshot: null, countAt: null, methods: KV.methodsState(['await', 'countDown']),
          waiting: new Map(), leaving: [], lastDepart: -Infinity, shots: [], shooting: new Map(), notice: null });
      }
      return items.get(id);
    }

    function apply(env) {
      const d = env.data;
      if (d?.objectType !== LATCH) return;
      if (env.type === 'OBJECT_REMOVED') { items.delete(d.objectId); return; }
      const latch = latchOf(d.objectId), now = performance.now();
      if (d.state) {
        // count изменился — вспышка (первый снимок — не изменение)
        if (latch.snapshot && latch.snapshot.count !== d.state.count) latch.countAt = now;
        latch.snapshot = d.state;
      }
      const phase = KV.trackMethod(latch.methods, env);
      if (!phase) return;
      if (d.method === 'await') applyAwait(latch, d, phase, now);
      else if (d.method === 'countDown') applyCountDown(latch, d, phase, now);
    }

    function applyAwait(latch, d, phase, now) {
      if (phase === 'IN') {
        latch.waiting.set(d.thread, { since: now, timeoutMs: d.args?.timeoutMs ?? null, countAtIn: d.state?.count ?? null });
        return;
      }
      const w = latch.waiting.get(d.thread);
      latch.waiting.delete(d.thread);
      const kind = phase === 'OUT_FAILED' ? 'interrupted'
        : d.result === false ? 'timeout'
        : w?.countAtIn === 0 ? 'through'
        : 'released';
      const l = { thread: d.thread, kind, timeoutMs: w?.timeoutMs ?? null, since: w?.since ?? now, at: now, departAt: null };
      if (kind === 'released') {
        l.departAt = Math.max(now, latch.lastDepart + DEPART_STEP_MS);
        latch.lastDepart = l.departAt;
        setTimeout(render, l.departAt - now + 1); // диорама: эта машина трогается
      }
      latch.leaving = latch.leaving.filter(x => now - x.at < Math.max(leaveMsOf(x), LEAVE_KEEP_MS) || x.departAt > now);
      latch.leaving.push(l);
      setTimeout(render, leaveMsOf(l));
      setTimeout(render, LEAVE_KEEP_MS);
    }

    function applyCountDown(latch, d, phase, now) {
      if (phase === 'IN') { latch.shooting.set(d.thread, d.state?.count ?? null); return; }
      const from = latch.shooting.get(d.thread) ?? null, to = d.state?.count ?? null;
      latch.shooting.delete(d.thread);
      if (phase === 'OUT_FAILED') return; // countDown не бросает; на всякий случай — без выстрела
      const kind = from === 0 ? 'idle' : to === 0 ? 'open' : 'tick';
      latch.shots = latch.shots.filter(s => now - s.at < SHOT_KEEP_MS);
      latch.shots.push({ by: d.thread, from, to, kind, at: now });
      setTimeout(render, SHOT_MS);      // плашка судьи в плитке растаяла
      setTimeout(render, SHOT_KEEP_MS); // диорама: судья ушёл
    }

    const notify = (latch, text) => KV.notify(latch, text, render);

    return { items, apply, notify };
  }

  // Недавние countDown (store удаляет старые только при новом countDown): плитке — за SHOT_MS, диораме — за SHOT_KEEP_MS
  const recentShots = (latch, ms = SHOT_MS) => latch.shots.filter(s => performance.now() - s.at < ms);

  // ---------- Отрисовка ----------

  const SHOTS_SHOWN = 2; // плашек судей — не больше: место постоянное, строка не прыгает

  /** Бейджи, строка count с судьями, под ней старт: ждущие, ворота, выехавшие; ниже — уведомление об отказе */
  function renderState(store, latch) {
    const now = performance.now();
    const out = [KV.renderBadges(latch.methods), renderCountLine(latch, now)];
    const row = KV.el('div', 'room-row');
    row.append(renderWaiting(store, latch, now), renderGate(latch), renderGone(latch, now));
    out.push(row);
    const notice = KV.renderNotice(latch);
    if (notice) out.push(notice);
    return out;
  }

  /** count 2/3 — count крупно (вспыхивает), /initialCount — приглушённо; справа — кто только что позвал countDown */
  function renderCountLine(latch, now) {
    const s = latch.snapshot;
    const line = KV.el('div', 'cdl-line');
    const value = KV.el('span', 'cdl-count', s ? String(s.count) : '?');
    if (latch.countAt != null && now - latch.countAt < FLASH_MS) {
      value.style.animation = `cdl-count ${FLASH_MS}ms ease-out ${-(now - latch.countAt)}ms forwards`;
    }
    const fraction = KV.el('span', 'cdl-fraction');
    fraction.append(value, KV.el('span', 'cdl-initial', s ? `/${s.initialCount}` : ''));
    line.append(KV.el('span', 'cdl-key', 'count'), fraction, renderJudges(latch, now));
    line.title = 'count — how many countDown() are still needed to open the gate (after the slash — the initial count). '
      + 'It only goes down: the latch cannot be reset';
    return line;
  }

  // Судьи — HTTP-потоки, позвавшие countDown: появляются и тают тем же ритмом, что бейдж countDown
  function renderJudges(latch, now) {
    const judges = KV.el('div', 'cdl-judges');
    for (const s of recentShots(latch).slice(-SHOTS_SHOWN)) {
      const what = s.kind === 'idle' ? 'count was already 0 — nothing happens'
        : s.kind === 'open' ? `${s.from ?? '?'} → 0: the gate opens, all waiting threads wake up`
        : `${s.from ?? '?'} → ${s.to ?? '?'}: nobody wakes up yet`;
      const chip = KV.roomChip(s.by, `${s.by}: countDown() — ${what}`, s.kind === 'idle' ? 'rejected' : '');
      chip.style.animation = `fade-out ${SHOT_MS}ms ease-in ${-(now - s.at)}ms forwards`;
      judges.append(chip);
    }
    return judges;
  }

  /**
   * Старт: ждущие в порядке прихода (первый — у ворот: room-queue row-reverse); у await(timeout) внизу убывает
   * полоска. Не дождался или прервали — тает на своём месте пунктиром (прерванный — красным). Клик — interrupt
   */
  function renderWaiting(store, latch, now) {
    const queue = KV.el('div', 'room-queue cdl-start');
    for (const [thread, w] of latch.waiting) {
      const chip = KV.roomChip(thread, `${thread} waits in ${w.timeoutMs != null ? `await(${KV.seconds(w.timeoutMs)})` : 'await()'}`
        + ` for ${KV.seconds(now - w.since)} · click: interrupt`, 'clickable');
      if (w.timeoutMs != null) {
        const bar = KV.el('div', 'countdown');
        bar.style.animation = `room-count ${w.timeoutMs}ms linear ${-(now - w.since)}ms forwards`;
        chip.prepend(bar); // подпись — поверх полоски
      }
      chip.onclick = () => interruptOf(store, latch.id, thread);
      queue.append(chip);
    }
    for (const l of latch.leaving) {
      if (l.kind !== 'timeout' && l.kind !== 'interrupted') continue;
      const age = now - l.at;
      if (age >= leaveMsOf(l)) continue;
      const title = l.kind === 'timeout'
        ? `${l.thread}: await(${KV.seconds(l.timeoutMs)}) returned false — the gate did not open in time`
        : `${l.thread}: interrupted while waiting — InterruptedException`;
      const chip = KV.roomChip(l.thread, title, `rejected ${l.kind === 'interrupted' ? 'cdl-failed' : ''}`.trim());
      chip.style.animation = `fade-out ${leaveMsOf(l)}ms ease-in ${-age}ms forwards`;
      queue.append(chip);
    }
    return queue;
  }

  // Ворота: закрыты, пока count > 0; открыты навсегда с 0. Снимка ещё нет — закрыты, подсказка «неизвестно»
  function renderGate(latch) {
    const s = latch.snapshot, open = s?.count === 0;
    const gate = KV.el('div', `cdl-gate ${open ? 'open' : ''}`.trim());
    gate.title = !s ? 'latch state unknown'
      : open ? 'open: await() returns at once — for good, the latch cannot be closed again'
      : `closed: ${s.count} more countDown() to open`;
    return gate;
  }

  // За воротами — выехавшие: дождались открытия или проехали сразу (при входе было 0). Тают
  function renderGone(latch, now) {
    const gone = KV.el('div', 'room-queue exit cdl-gone');
    for (const l of latch.leaving) {
      if (l.kind !== 'released' && l.kind !== 'through') continue;
      const age = now - l.at;
      if (age >= leaveMsOf(l)) continue;
      const chip = KV.roomChip(l.thread, l.kind === 'through'
        ? `${l.thread}: await() returned at once — the gate was already open`
        : `${l.thread}: the gate opened — await() returned`);
      chip.style.animation = `fade-out ${leaveMsOf(l)}ms ease-in ${-age}ms forwards`;
      gone.append(chip);
    }
    return gone;
  }

  // ---------- Описание для плитки (tiles.js) ----------

  return {
    title: 'CountDownLatch',
    params: [['count', 3, { min: 0 }]],
    types: [LATCH], createStore, remove, operations, renderState,
    recentShots: latch => recentShots(latch, SHOT_KEEP_MS), // диорама (diorama-latch.js): судья у трибуны
    SHOT_MS, // диорама: сколько видна вспышка выстрела — как плашка судьи в плитке
    // Поле может не прийти (на index.html параметров может не быть) — значение по умолчанию
    create: values => create(values.count ?? 3),
  };
})();
