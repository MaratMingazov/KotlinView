# Queue Sandbox — план работ

> Первая «тема» до executors: одна инструментированная `BlockingQueue`, которой управляют через REST,
> а всё, что с ней происходит, приходит клиенту по WebSocket.

## Зачем

Собрать **всю цепочку** на самом простом алгоритме:

```
REST-команда → InstrumentedBlockingQueue → listener → событие → EventHub (seq, состояние) → WebSocket → клиент
```

Когда цепочка заработает на очереди, executors подключатся к готовой инфраструктуре (`EventHub`, снимок,
рассылка) — поменяются только события и слушатель.

## Что уже есть

- `server`: Spring Boot, `GET /api/snapshot` (заглушка), WebSocket `/ws/events` (при подключении шлёт пустой `SNAPSHOT`).
- `algorithms/core`: `PROTOCOL_VERSION`.
- `algorithms/instrumented`: `InstrumentedBlockingQueue<E>` — декоратор над любой `BlockingQueue`,
  сообщает слушателю `BlockingQueueListener<E>` о `offer`, `take`, `poll(timeout)`.

## Модель

```ts
Queue {
  id: string              // "queue-1"
  type: 'LINKED' | 'ARRAY'
  capacity: number
  elementIds: number[]    // порядок = порядок извлечения, голова — первый
}

Element {
  id: number              // глобальный, растёт, не переиспользуется
  label: string
}
```

`SYNCHRONOUS` в песочнице не поддерживаем: без потребителя `offer` в неё всегда возвращает `false`.
Вернёмся к нему на этапе потребителей.

## REST

| Метод | Тело | Ответ | События |
|---|---|---|---|
| `POST /api/queues` | `{ "type": "LINKED", "capacity": 2 }` | `202 { "queueId": "queue-1" }` | `QUEUE_CREATED` |
| `POST /api/queues/{queueId}/offer` | `{ "label": "a" }` (необязательно) | `202 { "elementId": 7 }` | `ELEMENT_OFFERED` или `QUEUE_FULL` |
| `POST /api/queues/{queueId}/poll` | — | `202` | `ELEMENT_TAKEN` или `QUEUE_EMPTY` |
| `GET /api/snapshot` | — | `200` снимок + `seq` | — |

- `poll` — это неблокирующий `poll()` без таймаута. `take()` из HTTP-запроса вызывать нельзя:
  на пустой очереди поток Tomcat уснёт и запрос повиснет.
- Результат команды клиент узнаёт из событий, HTTP-ответ только подтверждает приём.
  Полная очередь и пустая очередь — **не** ошибки HTTP, команда всё равно `202`.

Ошибки: `400 VALIDATION_FAILED` (`capacity` вне `1..20`, неизвестный `type`), `404 QUEUE_NOT_FOUND`.

## События

Конверт — как в PROTOCOL.md, но без `executorId`: `{ seq, ts, type, data }`, `queueId` лежит в `data`.

| `type` | `data` | Reducer |
|---|---|---|
| `QUEUE_CREATED` | `{ queueId, type, capacity }` | добавить очередь с пустым `elementIds` |
| `ELEMENT_OFFERED` | `{ queueId, elementId, label, position, size }` | добавить `elementId` в конец `elementIds` |
| `QUEUE_FULL` | `{ queueId, elementId, label, size }` | не меняет состояние (информационное) |
| `ELEMENT_TAKEN` | `{ queueId, elementId, size }` | удалить `elementId` из `elementIds` |
| `QUEUE_EMPTY` | `{ queueId }` | не меняет состояние (информационное) |

`SNAPSHOT`:

```json
{ "seq": 5, "ts": 1790000000000, "type": "SNAPSHOT",
  "data": { "protocolVersion": 1,
            "queues": [ { "id": "queue-1", "type": "LINKED", "capacity": 2, "elementIds": [1, 2] } ] } }
```

## Сервер

- **`EventHub`** — бин, реализует `EventSink`. Под одной блокировкой:
  выдаёт `seq`, применяет событие к состоянию (reducer), рассылает конверт всем сессиям.
- **Подписка клиента** — под той же блокировкой: отправить `SNAPSHOT` с текущим `seq` и добавить сессию в рассылку.
  Так между снимком и первым событием ничего не теряется и не дублируется (PROTOCOL.md, раздел 7).
- **Состояние** — `queueId → Queue` с `elementIds`. Снимок строится из него, а не из настоящих очередей:
  атомарно прочитать «содержимое очереди + `seq`» из настоящей очереди нельзя.
- **Реестр очередей** — `queueId → InstrumentedBlockingQueue`, чтобы команды `offer`/`poll` находили нужную.

## Шаги

### 1. `algorithms`: события и слушатель

- [ ] `core/Event.kt` — `interface Event`, `fun interface EventSink { fun emit(event: Event) }`.
- [ ] `queues/QueueEvent.kt` — `sealed interface QueueEvent : Event` и пять событий из таблицы.
- [ ] `queues/QueueElement.kt` — `id`, `label`.
- [ ] `queues/QueueEventsListener.kt` — реализует `BlockingQueueListener<QueueElement>`, переводит вызовы в `RunnableBlockingQueueEvent` и отдаёт в `EventSink`.
- [ ] `InstrumentedRunnableBlockingQueue`: переопределить `poll()` без таймаута, добавить в слушатель `onEmpty()`.

**Проверка:** `main` в `queues/Playground.kt` с `EventSink { println(it) }`: создать очередь на 2,
три `offer`, три `poll` → в консоли `ELEMENT_OFFERED ×2`, `QUEUE_FULL`, `ELEMENT_TAKEN ×2`, `QUEUE_EMPTY`.

### 2. `server`: `EventHub`, состояние, снимок

- [ ] Состояние очередей и reducer: событие → изменение состояния.
- [ ] `EventHub`: `seq`, reducer, рассылка; превращение события в JSON-конверт с полем `type`.
- [ ] `EventsWebSocketHandler`: при подключении — подписка через `EventHub` (снимок + добавление в рассылку), при закрытии — удаление.
- [ ] `GET /api/snapshot` отдаёт то же состояние.

**Проверка:** юнит-тест reducer'а — последовательность событий → ожидаемое состояние.

### 3. `server`: `QueueController`

- [ ] `POST /api/queues`, `POST /api/queues/{id}/offer`, `POST /api/queues/{id}/poll`.
- [ ] Валидация и ошибки `400` / `404`.

**Проверка:**

```bash
curl -i -X POST localhost:8080/api/queues -H 'Content-Type: application/json' -d '{"type":"LINKED","capacity":2}'
curl -i -X POST localhost:8080/api/queues/queue-1/offer -H 'Content-Type: application/json' -d '{"label":"a"}'
curl -i -X POST localhost:8080/api/queues/queue-1/poll
```

Два окна браузера с WebSocket: одно подключено **до** создания очереди, другое **после** нескольких `offer`.
Первое видит события по одному, второе — снимок с тем же содержимым; дальше оба получают одинаковые события.

### 4. Потом: потребители (producer/consumer)

- [ ] `POST /api/queues/{id}/consumers { "processingMs": 1000, "pollTimeoutMs": null }` — фоновый поток,
      который в цикле делает `take()` (или `poll(timeout)`) и «обрабатывает» элемент `processingMs`.
- [ ] События `CONSUMER_STARTED`, `CONSUMER_WAITING { timeoutMs }`, `CONSUMER_TIMED_OUT`, `ELEMENT_PROCESSED`;
      у `ELEMENT_TAKEN` появляется `consumerId`.
- [ ] Вернуть `timeoutMs` в `BlockingQueueListener.onWaiting`.
- [ ] Поддержать `SYNCHRONOUS`.

## Известные упрощения (TODO)

- **Гонка `offer` / `take`.** В `InstrumentedRunnableBlockingQueue` нет общего монитора, поэтому `ELEMENT_TAKEN` может прийти
  раньше `ELEMENT_OFFERED` для того же элемента (PROTOCOL.md, 11.2). На шагах 1–3 не проявится: `poll` вызывается
  вручную из HTTP-запросов. Вернуть `publishLock` до шага 4.
- **`size` приблизительный** — читается отдельно от операции; исправляется тем же монитором.
- **Отправка в WebSocket прямо под блокировкой `EventHub`.** Медленный клиент тормозит всех.
  Позже — своя исходящая очередь на каждого клиента (PROTOCOL.md, 11.3).
- **`WebSocketSession.sendMessage` не потокобезопасен** — сейчас это закрывает общая блокировка `EventHub`;
  при переходе на исходящие очереди помнить об этом.
- **Конверт без `executorId`.** Решить открытый вопрос №2 из README (`sourceId` / `topic`) до того, как
  очереди и executors начнут жить в одном потоке событий.
