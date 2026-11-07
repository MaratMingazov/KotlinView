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
`SYNCHRONOUS_QUEUE_RUNNABLE`, `THREAD_FACTORY`, `THREAD`, `THREAD_POOL_EXECUTOR`.
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

Пул создаётся вместе со своей очередью и фабрикой (клиент получит три `OBJECT_CREATED`: очередь, фабрика, пул)
и удаляется вместе с ними — только после `TERMINATED`. Отказ `execute` (`RejectedExecutionException`) — `409`.

Пресеты отличаются от JDK, чтобы граничное поведение было видно на экране:
у `fixed` / `single` очередь на 5 задач вместо неограниченной, у `cached` не больше 5 потоков
и `keepAlive` 10 с вместо 60.

## Структура репозитория

Gradle multi-module:

```
KotlinView/
├── settings.gradle.kts              ← список модулей
├── build.gradle.kts
├── gradle/libs.versions.toml        ← версии всех зависимостей в одном месте
├── gradlew, gradlew.bat, gradle/    ← Gradle wrapper
│
├── algorithms/                      ← без Spring
│   └── src/main/kotlin/mingazov/kotlinview/
│       ├── event/                   ← Event (sealed), EventSink, ObjectType
│       └── instrumented/            ← Instrumented, InstrumentedRegistry, IdGenerator
│           ├── collection/          ← ArrayList, LinkedList, LinkedBlockingQueue, SynchronousQueue
│           │   └── registry/
│           └── executor/            ← RunnableTask, ThreadFactory, ThreadPoolExecutor, playground'ы
│               └── registry/
└── server/                          ← Spring Boot
    └── src/main/
        ├── kotlin/mingazov/kotlinview/
        │   ├── config/              ← реестры из algorithms как бины, общий IdGenerator
        │   ├── controller/          ← REST: collection/, executor/, ErrorHandlers
        │   ├── service/             ← фасады: collection/, executor/ (правила владения частями пула)
        │   └── ws/                  ← WebSocket, Broadcaster (EventSink), protocol/ (конверт и payload'ы)
        └── resources/static/        ← фронт: по странице на структуру + общие base.js / components.js
```

У каждого инструментированного типа одна и та же связка: класс в `algorithms` → реестр → сервис → контроллер
→ страница в `static/`.

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

## План работ

Сделано:

1. **Каркас.** Gradle multi-module, wrapper, version catalog.
2. **Модель событий.** Универсальные `OBJECT_*` / `METHOD_*`, `Instrumented`, реестры с общим `IdGenerator`.
3. **Сервер.** REST-команды, WebSocket `/ws/events`, `seq` и рассылка.
4. **Коллекции.** `ArrayList<Int>`, `LinkedList<Int>` — страницы с визуализацией.
5. **Очереди.** `LinkedBlockingQueue<Runnable>`, `SynchronousQueue<Runnable>` — отдельно и как очередь пула.
6. **Executors.** `ThreadPoolExecutor` с произвольными параметрами и пресеты `fixed` / `single` / `cached`,
   `shutdown` / `shutdownNow`, отказ по `ABORT`.

Дальше:

1. **Тесты.** `EventSink`, собирающий события в список, и проверки последовательностей:
   «execute на cached-пуле без ждущих воркеров → newThread → поток стартовал → poll».
2. **Снимок при подключении.** Сейчас клиент видит только события после подключения.
   Нужен `SNAPSHOT` первым сообщением в сокете с `seq`, от которого продолжается поток.
3. **Остальное по Executors.** Политики отказа кроме `ABORT`; `submit` (сейчас `FutureTask` ломает `taskIdOf`);
   задача, бросающая исключение (смерть и замена воркера).
4. **Блокировки.** `ReentrantLock` (владелец, `holdCount`, очередь ждущих) и `Condition` как отдельный объект —
   чтобы было видно, что `await` отпускает замок; producer/consumer на двух условиях.
5. **Следующие темы.** `ForkJoinPool`, `HashMap`, сортировки.

## Известные ограничения

- В замедленном режиме события одной `LinkedBlockingQueue` отправляются строго по одному: пауза `Broadcaster`
  попадает внутрь `emitLock` очереди.
- Поток, который пул создал, но не запустил (shutdown во время `addWorker`), останется у клиента без `OBJECT_REMOVED`.
- Очередь пула можно удалить в обход фасада через `DELETE /api/linkedblockingqueuerunnable/{id}`
  (или `synchronousqueuerunnable`).

## Открытые вопросы

1. **Алгоритмы, которые работают мгновенно** (сортировки): нужен ли пошаговый режим с паузой и перемоткой,
   и как он ложится на модель «объект + вызовы методов».
2. **Фронт на React**, когда логика экранов станет сложной: бэкенд при этом не меняется.