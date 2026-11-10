# KotlinView

> Учебный проект: бэкенд запускает настоящие алгоритмы и структуры данных,
> транслирует всё, что происходит у них внутри, а фронт это визуализирует.

## Идея

Многие вещи в Java/Kotlin трудно понять по документации и логам: что происходит внутри
пула потоков, почему создался ещё один воркер, кто и когда забрал задачу из очереди,
почему задачу отклонили. Хочется **увидеть** это вживую.

Проект — это бэкенд на Spring Boot, который:

1. запускает **настоящие** реализации (не имитацию): `ThreadPoolExecutor` из JDK, реальные потоки, реальные очереди;
2. инструментирует их (наследование, делегирование, своя `ThreadFactory`) и превращает всё, что происходит внутри,
   в поток **событий**;
3. отдаёт события клиенту по **WebSocket**, а команды («создай пул», «отправь задачу», «shutdown»)
   принимает по **REST**.

Фронт получает события и рисует, как задачи едут в очередь, как воркеры их забирают,
выполняют, простаивают и умирают. Пользователь меняет параметры и сразу видит, как меняется поведение.

## С чего начинаем: Executors

Первая тема — `ThreadPoolExecutor` и фабрики `Executors.*`. На визуализации должно быть видно:

- как задача проходит путь `execute → очередь → воркер → выполнение`;
- что первая задача воркера (`firstTask`) идёт ему **напрямую, мимо очереди**;
- алгоритм `execute`: **core → очередь → воркеры сверх core до max → reject**;
- что у `newFixedThreadPool` с неограниченной очередью параметр `max` фактически ни на что не влияет;
- как воркеры сверх core умирают по `keepAlive`, и что флага «core» у воркера нет;
- политики отказа: `ABORT`, `CALLER_RUNS`, `DISCARD`, `DISCARD_OLDEST`;
- разницу `shutdown()` и `shutdownNow()`, `execute` и `submit` (исключение убивает воркер или нет);
- `newCachedThreadPool` с `SynchronousQueue`: очередь всегда пуста, задача передаётся из рук в руки.

Что из этого уже работает — в разделе [План работ](#план-работ).

## Что может быть дальше

Список не окончательный — это направления, в которых проект может расти:

- **Конкурентность:** `ScheduledThreadPoolExecutor`, `ForkJoinPool` (у каждого воркера своя очередь, work stealing),
  `CompletableFuture`-цепочки, блокировки (`ReentrantLock`, `ReadWriteLock`, `synchronized`), `Semaphore`,
  `CountDownLatch`, `CyclicBarrier`, producer/consumer на разных `BlockingQueue`, корутины Kotlin.
- **Структуры данных:** `HashMap` (бакеты, коллизии, resize, treeify), `ConcurrentHashMap`, кучи, деревья.
- **Классические алгоритмы:** сортировки, обходы графов, кратчайшие пути.

Для каждой новой темы действует один и тот же принцип: реальная реализация → инструментирование →
события → визуализация.

## Архитектура

```
┌──────────────────────────── Браузер ────────────────────────────┐
│  Визуализация (HTML/JS/CSS)                                     │
│     ▲ события (WebSocket)                 │ команды (REST)      │
└─────┼─────────────────────────────────────┼─────────────────────┘
      │                                     ▼
┌─────┴──────────────────── server (Spring Boot) ─────────────────┐
│  /ws/events — поток событий             /api/... — команды      │
│  Broadcaster: seq, ts, JSON, рассылка   сервисы-фасады          │
└─────▲─────────────────────────────────────┬─────────────────────┘
      │ EventSink.emit(event)               │ вызовы
┌─────┴──────────────────── algorithms (без Spring) ──────────────┐
│  Instrumented-объекты + реестры: коллекции, очереди,            │
│  задачи, ThreadFactory, ThreadPoolExecutor                      │
└─────────────────────────────────────────────────────────────────┘
```

Ключевые решения:

- **Одна модель событий на все темы.** Нет событий вроде `TASK_QUEUED` — есть объекты и вызовы их методов:
  «объект создан», «поток вошёл в метод», «вышел с результатом», «упал с ошибкой». Новая структура данных
  не требует новых типов событий, а визуализацию можно переделывать, не трогая бэкенд.
- **Составные объекты ссылаются на части по id.** Пул не вкладывает в себя очередь и фабрику, а хранит
  в `state` их `queueId` и `threadFactoryId`. У каждой части свои события, картинку собирает клиент.
  Id выдаёт один `IdGenerator` на все реестры, поэтому ссылка однозначна, какого бы типа ни был объект.
- **Имя потока связывает события разных объектов.** Воркер `factory-3-worker-1` виден в событиях
  своего потока (`THREAD.run`), очереди (`take` / `poll`) и задачи (`run`) — так клиент понимает, что делает воркер.
- **Команды — через REST.** Их удобно отлаживать `curl`'ом. Что команда сделала внутри, видно по событиям.
- **Алгоритмы не знают про Spring.** Модуль `algorithms` зависит только от интерфейса `EventSink`.
  Его можно запускать из `main` (см. `*Playground.kt`) и тестировать без поднятия сервера.

### Как инструментируем

- **Делегирование** — для коллекций и очередей: `BlockingQueue<Runnable> by delegate`, переопределены только
  интересные методы (`offer`, `put`, `take`, `poll`, `drainTo`). Остальные уходят в настоящую реализацию без событий.
  Delegate создаётся внутри, чтобы никто не мог менять структуру в обход событий.
- **Наследование** — для `ThreadPoolExecutor`: путь `addWorker → runWorker → getTask` целиком внутри пула,
  декоратор его не увидит. Переопределены `execute`, `shutdown`, `shutdownNow` и хук `terminated`.
- **Своя `ThreadFactory`** — каждый созданный поток становится объектом `THREAD`, его жизнь — это метод `run`.

## Протокол

Сервер шлёт по WebSocket `/ws/events` сообщения-конверты:

```json
{ "seq": 42, "ts": 1762543431743, "type": "METHOD_OUT", "data": { ... } }
```

- `seq` — монотонный номер события: по нему клиент видит пропуски и дубли. Номер выдаётся и сообщение
  отправляется под одним замком, поэтому события приходят строго по возрастанию `seq`.
- `ts` — серверное время события (не отправки).
- `type` — что лежит в `data`. Jackson берёт его из `@JsonTypeName` класса payload'а, так что `type` и `data` не расходятся.

Типы событий (`data`):

| type | Когда | Поля, кроме общих |
|---|---|---|
| `OBJECT_CREATED` | реестр создал объект | `state` — начальное состояние |
| `OBJECT_REMOVED` | объект удалён, событий от него больше не будет | — |
| `METHOD_IN` | поток вошёл в метод | `method`, `args`, `state` |
| `METHOD_OUT` | метод вернул результат | `method`, `args`, `result`, `state` |
| `METHOD_OUT_FAILED` | метод бросил исключение | `method`, `args`, `error`, `state` |
| `METHOD_PROGRESS` | поток всё ещё внутри метода | `method`, `progress`, `state` |

Общие поля всех событий: `objectType`, `objectId`, `thread` — имя потока, в котором произошло событие.

`objectType`: `ARRAY_LIST_INT`, `LINKED_LIST_INT`, `RUNNABLE_TASK`, `LINKED_BLOCKING_QUEUE_RUNNABLE`,
`SYNCHRONOUS_QUEUE_RUNNABLE`, `THREAD_FACTORY`, `THREAD`, `THREAD_POOL_EXECUTOR`, `SEMAPHORE`, `SEMAPHORE_RUNNABLE_TASK`.
У `THREAD` `objectId` — это `threadId()` JVM, а не id из общего генератора.

`state` — снимок состояния объекта в момент события, клиент рисует объект по последнему полученному снимку.
Если снимок и отправку нужно делать атомарно (как в `LinkedBlockingQueue`, где `offer` и `take` идут параллельно),
объект берёт свой замок на время снятия `state` и `emit`.

Список событий закрыт: `Event` — sealed-интерфейс, и `WebSocketMapper` не скомпилируется,
пока новое событие не получит свой payload. Версия протокола — `PROTOCOL_VERSION` в `Envelope.kt`.

### REST

Создание возвращает `{"objectId": …}`, остальные команды — результат метода, если он есть; подробности приходят событиями.
Обращение к несуществующему объекту — `404`.

| Ресурс | Команды |
|---|---|
| `/api/arraylistint` | `POST` создать, `/{id}/add`, `/{id}/addAt`, `/{id}/get`, `DELETE /{id}` |
| `/api/linkedlistint` | `POST` создать, `/{id}/add`, `/offer`, `/offerFirst`, `/offerLast`, `/poll`, `/pop`, `DELETE /{id}` |
| `/api/linkedblockingqueuerunnable` | `POST` создать, `/{id}/offer`, `/{id}/take`, `DELETE /{id}` |
| `/api/synchronousqueuerunnable` | `POST` создать, `/{id}/offer`, `/{id}/put`, `/{id}/take`, `DELETE /{id}` |
| `/api/tasks` | `POST` создать задачу на `durationMs`, `/{id}/run`, `DELETE /{id}` |
| `/api/threadpoolexecutor` | `POST` создать с параметрами, `/fixed`, `/single`, `/cached`, `/{id}/execute`, `/{id}/shutdown`, `/{id}/shutdownNow`, `DELETE /{id}` |
| `/api/semaphore` | `POST` создать, `/{id}/acquire`, `/{id}/tryAcquire`, `/{id}/tryAcquireTimeout`, `/{id}/release`, `DELETE /{id}` |
| `/api/semaphorerunnabletask` | `POST` создать (`permits`, `durationMs`, `fair`, `mode`: `ACQUIRE` / `TRY_ACQUIRE` / `TRY_ACQUIRE_TIMEOUT`, `timeoutMs`), `/{id}/run`, `DELETE /{id}` |

Задача под семафором создаётся вместе со своим семафором и задачей. `mode` — как поток входит: ждёт (`acquire`),
сразу получает отказ (`tryAcquire`) или ждёт не дольше `timeoutMs`. Итог `run` — `result` в `METHOD_OUT`:
`"done"` или `"rejected"` (разрешение не взяли, задача не запускалась).

Пул создаётся вместе со своей очередью и фабрикой (клиент получит три `OBJECT_CREATED`: очередь, фабрика, пул)
и удаляется вместе с ними — только после `TERMINATED`. Отказ `execute` (`RejectedExecutionException`) — `409`.

Пресеты отличаются от JDK, чтобы граничное поведение было видно на экране:
у `fixed` / `single` очередь на 5 задач вместо неограниченной, у `cached` не больше 5 потоков
и `keepAlive` 10 с вместо 60.

## Структура репозитория

Gradle multi-module. Здесь — только слои и правила, где что лежит; конкретные файлы не перечисляем.

```
KotlinView/
├── algorithms/      ← модуль без Spring: реальные реализации и их инструментирование
│   ├── event/       ← модель событий (Event, EventSink, ObjectType)
│   └── instrumented/← Instrumented-объекты и их реестры, по пакету на тему (collection/, executor/, concurrent/…)
├── server/          ← Spring Boot: собирает всё вместе
│   ├── config/      ← реестры из algorithms как бины
│   ├── controller/  ← REST, по пакету на тему
│   ├── service/     ← фасады: составные объекты и правила владения частями
│   ├── ws/          ← WebSocket и протокол (конверт, payload'ы)
│   └── static/      ← фронт: страницы, общие компоненты, диорамы
└── docs/            ← рабочие документы по отдельным направлениям
```

Правила:

- Пакеты совпадают с папками; тема — отдельный пакет в каждом слое (`collection`, `executor`, `concurrent.locks`…).
- У каждого инструментированного типа одна и та же связка: класс в `algorithms` → реестр → сервис → контроллер
  → вид на клиенте в `static/`.
- Фронт — обычные скрипты без сборки: у вида структуры свой `*.js` (модель по событиям, отрисовка, REST) и `*.css`;
  общее — `base.js` (REST, WebSocket), `components.js` (бейджи, цепочки, задачи), `tiles.js` (плитки).
  Как устроены диорамы — в [docs/DIORAMAS.md](docs/DIORAMAS.md).

## Стек

| Часть | Выбор | Почему |
|---|---|---|
| Язык бэкенда | Kotlin 2.3 (JVM) | основной язык проекта; всё, что визуализируем, есть только на JVM |
| Сборка | Gradle, Kotlin DSL, version catalog | стандарт для Kotlin; версии в одном месте |
| JDK | 25 (`jvmToolchain(25)`) | `Thread.threadId()`, свежая JVM |
| Бэкенд | Spring Boot 4.1: `spring-boot-starter-webmvc` + `spring-boot-starter-websocket` | стандарт индустрии; модуль `algorithms` от этого выбора не зависит |
| Сериализация | Jackson 3 (`tools.jackson`) + `jackson-module-kotlin` | sealed-payload'ы → JSON с полем `type` |
| Фронт | чистые HTML + JS + CSS | без Node и сборки; все силы — на алгоритмы |

## Как запустить

Фронт лежит статикой внутри `server` (`src/main/resources/static`). Один процесс:

```bash
./gradlew :server:bootRun
# открыть http://localhost:8080
```

Замедленный режим: `kotlinview.events.sleep-millis` в `application.yml` — пауза перед отправкой каждого события,
чтобы быстрые процессы можно было разглядеть.

Пример из консоли:

```bash
curl -X POST localhost:8080/api/threadpoolexecutor/cached              # {"objectId":3}
curl -X POST localhost:8080/api/tasks -H 'Content-Type: application/json' -d '{"durationMs":3000}'   # {"objectId":4}
curl -X POST localhost:8080/api/threadpoolexecutor/3/execute -H 'Content-Type: application/json' -d '{"taskId":4}'
```

Посмотреть сырые события — в консоли браузера:

```js
const ws = new WebSocket("ws://localhost:8080/ws/events");
ws.onmessage = e => console.log(JSON.parse(e.data));
```



## Открытые вопросы

1. **Алгоритмы, которые работают мгновенно** (сортировки): нужен ли пошаговый режим с паузой и перемоткой,
   и как он ложится на модель «объект + вызовы методов».
2. **Фронт на React**, когда логика экранов станет сложной: бэкенд при этом не меняется.

## Документы

- [docs/DIORAMAS.md](docs/DIORAMAS.md) — диорамы: структуры как «уютный остров» в изометрии (`prototype.html`,
  `index.html`), как это устроено и следующие шаги.