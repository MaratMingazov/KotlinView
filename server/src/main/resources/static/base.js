/*
 * JS-каркас всех playground-страниц: REST с логом HTTP, WebSocket с логом событий и статусом, карточки объектов.
 * Подключение: <script src="base.js"></script> первым, затем components.js, затем скрипт страницы. Всё лежит в объекте UI.
 * Ожидает на странице элементы #status, #http, #ws, #clearHttp, #clearWs (их даёт общая разметка страниц).
 */
const UI = (() => {
  const $ = id => document.getElementById(id);

  // Новые записи сверху
  function prepend(logId, text, isError) {
    const row = document.createElement('div');
    row.textContent = text;
    if (isError) row.className = 'error';
    $(logId).prepend(row);
  }

  // ---------- REST ----------

  /** Запрос с записью в лог HTTP. Возвращает тело ответа (JSON) или null — при ошибке и у 204. */
  async function call(method, url, body) {
    const options = { method, headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) options.body = JSON.stringify(body);
    const request = `${method} ${url}${body !== undefined ? ' ' + JSON.stringify(body) : ''}`;
    try {
      const res = await fetch(url, options);
      const text = await res.text(); // у 204 тела нет
      prepend('http', `${request} → ${res.status} ${text}`, !res.ok);
      return res.ok && text ? JSON.parse(text) : null;
    } catch (e) {
      prepend('http', `${request} → ${e}`, true);
      return null;
    }
  }

  // ---------- WebSocket ----------

  function showEnvelope(env, types) {
    if (types && !types.includes(env.data?.objectType)) return; // чужие события (списки и т.п.) не засоряют лог
    const row = document.createElement('div');
    const type = Object.assign(document.createElement('span'), { className: 'type', textContent: env.type });
    const time = new Date(env.ts).toISOString().slice(11, 23); // HH:MM:SS.mmm, UTC
    row.append(`#${env.seq}  ${time}  `, type, `  ${JSON.stringify(env.data)}`);
    if (env.type.endsWith('_FAILED')) row.className = 'error';
    $('ws').prepend(row);
  }

  /**
   * Подключиться к /ws/events и переподключаться при обрыве; заодно оживить кнопки «clear» у логов.
   * onEnvelope(env) — на каждое событие. types — какие objectType показывать в логе WebSocket (по умолчанию все).
   */
  function connect({ onEnvelope, types }) {
    $('clearHttp').onclick = () => { $('http').innerHTML = ''; };
    $('clearWs').onclick = () => { $('ws').innerHTML = ''; };

    const open = () => {
      const ws = new WebSocket(`ws://${location.host}/ws/events`);
      ws.onopen = () => {
        $('status').textContent = '● ws connected';
        $('status').className = 'on';
      };
      ws.onclose = () => {
        $('status').textContent = '● ws disconnected';
        $('status').className = 'off';
        setTimeout(open, 1000);
      };
      ws.onmessage = msg => {
        let env;
        try {
          env = JSON.parse(msg.data);
        } catch (e) {
          prepend('ws', `не JSON: ${msg.data}`, true);
          return;
        }
        showEnvelope(env, types);
        onEnvelope(env);
      };
    };
    open();
  }

  // ---------- Карточки объектов ----------

  /**
   * Карточка на каждый объект в контейнере rootId, по порядку id.
   * create(item) → { card, … } — один раз: пульт карточки не пересоздаётся, поэтому введённые значения и фокус не теряются.
   * update(item, view) — на каждый sync: перерисовать состояние. empty — текст, когда объектов нет.
   */
  function cardList(rootId, { create, update, empty }) {
    const views = new Map(); // id → то, что вернул create

    function sync(items) {
      const root = $(rootId);

      // Удалить карточки исчезнувших объектов
      for (const [id, view] of views) {
        if (!items.has(id)) { view.card.remove(); views.delete(id); }
      }

      // Создать карточки новых объектов — по порядку id
      for (const item of [...items.values()].sort((a, b) => a.id - b.id)) {
        if (!views.has(item.id)) {
          const view = create(item);
          view.card.dataset.id = item.id;
          views.set(item.id, view);
          const next = [...root.children].find(c => c.dataset.id !== undefined && Number(c.dataset.id) > item.id);
          root.insertBefore(view.card, next ?? null);
        }
        update(item, views.get(item.id));
      }

      const placeholder = root.querySelector(':scope > .empty-cards');
      if (items.size === 0 && !placeholder) {
        root.append(Object.assign(document.createElement('div'), { className: 'empty empty-cards', textContent: empty }));
      } else if (items.size > 0 && placeholder) {
        placeholder.remove();
      }
    }

    return { sync };
  }

  return { $, call, prepend, connect, cardList };
})();