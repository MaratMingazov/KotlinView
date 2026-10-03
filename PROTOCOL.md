# Протокол Executor Visualizer

Версия протокола: **1**

Документ описывает, как бэкенд сообщает клиенту о том, что происходит внутри executor'ов
(очереди, воркеры, задачи), и как клиент управляет executor'ами.

---

## 1. Назначение и границы

- Бэкенд держит один или несколько инструментированных executor'ов и транслирует всё,
  что в них происходит, в виде **событий**.
- Клиент **не знает** ничего про `java.util.concurrent`: он получает модель
  «executor → очереди → воркеры → задачи» и сам решает, как её нарисовать.
- В версии 1 поддерживается только `ThreadPoolExecutor`. Модель спроектирована так, чтобы
  позже добавить `ScheduledThreadPoolExecutor` и `ForkJoinPool` без поломки протокола
  (см. раздел 12).

## 2. Принципы

1. **События — это факты, а не инструкции для UI.** `TASK_QUEUED`, а не `MOVE_CARD`.
   Сервер не знает про карточки, цвета и анимации.
2. **Снимок + поток событий.** При подключении клиент получает полный снимок состояния
   (`SNAPSHOT`), дальше только изменения. Поздно открытая вкладка видит правильную картину.
3. **Строгий порядок.** У каждого события есть глобальный возрастающий номер `seq`.
   Клиент применяет события строго по `seq`, пропуск — повод пересинхронизироваться.
4. **Один источник правды.** Результат команды (REST) клиент узнаёт только из потока
   событий. HTTP-ответ лишь подтверждает, что команда принята.
5. **Одинаковый reducer.** Сервер и клиент применяют события к состоянию по одним и тем же
   правилам (раздел 7). Снимок — это просто текущее состояние серверного reducer'а.

## 3. Транспорт

| Канал | Направление | Назначение |
|---|---|---|
| WebSocket `GET /ws/events` | сервер → клиент | снимок и поток событий |
| REST `/api/...` | клиент → сервер | команды: создать executor, отправить задачи, shutdown и т.д. |

- WebSocket односторонний: клиент ничего не отправляет. Любые входящие сообщения сервер игнорирует.
- Формат сообщений — JSON, кодировка UTF-8, одно сообщение = один WebSocket-фрейм.
- В режиме разработки Vite проксирует `/api` и `/ws` на бэкенд, в production всё отдаёт
  один процесс. На протокол это не влияет.

## 4. Идентификаторы

| Сущность | Поле | Тип | Формат / пример | Уникальность |
|---|---|---|---|---|
| Executor | `executorId` | string | `pool-1` | в рамках процесса сервера |
| Очередь | `queueId` | string | `pool-1/main` | в рамках процесса сервера |
| Воркер | `workerId` | string | `pool-1/worker-3` | в рамках процесса, не переиспользуется |
| Задача | `taskId` | number | `17` | в рамках процесса, не переиспользуется |

- `workerId` совпадает с именем потока (его задаёт наша `ThreadFactory`).
- Номера воркеров растут монотонно: если `worker-2` умер и пул создал замену,
  это будет `worker-3`, а не снова `worker-2`.
- Все идентификаторы непрозрачные: клиент не должен разбирать их на части.

## 5. Модель состояния

### 5.1. Executor

```ts
Executor {
  id: string
  config: ExecutorConfig
  state: 'RUNNING' | 'SHUTDOWN' | 'STOP' | 'TERMINATED'
  queues: Queue[]          // в v1 ровно одна: `${id}/main`
  workers: Worker[]        // включая EXITED (для истории), клиент может их скрывать
  tasks: Task[]            // все задачи, включая завершённые
  stats: ExecutorStats
}

ExecutorConfig {
  kind: 'THREAD_POOL'
  corePoolSize: number
  maximumPoolSize: number
  keepAliveMs: number
  allowCoreThreadTimeOut: boolean
  queue: { type: 'LINKED' | 'ARRAY' | 'SYNCHRONOUS', capacity: number | null }  // null = без ограничения
  rejectionPolicy: 'ABORT' | 'CALLER_RUNS' | 'DISCARD' | 'DISCARD_OLDEST'
}

ExecutorStats {
  submitted: number
  completed: number
  failed: number
  rejected: number
  discarded: number
  largestPoolSize: number
}
```

Состояния executor'а повторяют состояния `ThreadPoolExecutor`:

```
RUNNING ──shutdown()──► SHUTDOWN ──очередь пуста, воркеров нет──► TERMINATED
   │                        │
   └──shutdownNow()──► STOP ◄──shutdownNow()
                        └──воркеров нет──► TERMINATED
```

### 5.2. Очередь

```ts
Queue {
  id: string
  ownerId: string          // executorId (в будущем может быть workerId, см. ForkJoinPool)
  capacity: number | null
  taskIds: number[]        // порядок = порядок извлечения (голова — первый элемент)
}
```

### 5.3. Воркер

```ts
Worker {
  id: string
  ordinal: number          // 1, 2, 3... порядковый номер создания
  state: 'CREATED' | 'IDLE' | 'WAITING' | 'BUSY' | 'EXITED'
  currentTaskId: number | null
  waitingTimeoutMs: number | null   // заполнено, если WAITING через poll с таймаутом
  completedTasks: number
  exitReason: 'SHUTDOWN' | 'TIMEOUT' | 'ERROR' | null
}
```

| Состояние | Что значит в терминах `ThreadPoolExecutor` |
|---|---|
| `CREATED` | объект `Worker` и поток созданы, поток ещё не начал `runWorker` |
| `IDLE` | поток в цикле `runWorker`, задачи нет, но в очереди он пока не блокируется (короткое переходное состояние) |
| `WAITING` | поток внутри `queue.take()` или `queue.poll(timeout)` |
| `BUSY` | поток выполняет `task.run()` |
| `EXITED` | цикл `runWorker` завершился, поток закончил работу |

```
CREATED ──WORKER_STARTED──► IDLE ◄──TASK_COMPLETED/FAILED── BUSY
                             │  ▲                           ▲
               WORKER_WAITING│  │TASK_TAKEN                 │TASK_STARTED
                             ▼  │                           │
                            WAITING                  (IDLE/CREATED → BUSY
                                                      для firstTask)
любое состояние ──WORKER_EXITED──► EXITED
```

**Флага «core / не core» у воркера нет** — его нет и в самом `ThreadPoolExecutor`.
«Лишний» воркер определяется только сравнением числа живых воркеров с `corePoolSize`.
Клиент может показать это как «живых воркеров: 2 / core: 1 / max: 2».

### 5.4. Задача

```ts
Task {
  id: number
  label: string
  durationMs: number
  shouldFail: boolean
  state: 'SUBMITTED' | 'QUEUED' | 'TAKEN' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'REJECTED' | 'DISCARDED'
  queueId: string | null           // где лежит, если QUEUED
  workerId: string | null          // кто взял/выполняет/выполнил
  runner: 'WORKER' | 'CALLER' | null   // CALLER — выполнена потоком отправителя (CALLER_RUNS)
  submittedAt: number              // ts
  startedAt: number | null
  finishedAt: number | null
  error: string | null
}
```

```
                 ┌──────────────────────────────── напрямую (firstTask) ─────────┐
                 │                                                               ▼
SUBMITTED ───────┼──► QUEUED ──► TAKEN ──────────────────────────────────► RUNNING ──┬─► COMPLETED
                 │       │                                                           └─► FAILED
                 │       └──► DISCARDED   (вытеснена DISCARD_OLDEST или shutdownNow)
                 └──► REJECTED ──(CALLER_RUNS)──► RUNNING (runner = CALLER)
```

Терминальные состояния: `COMPLETED`, `FAILED`, `REJECTED` (кроме `CALLER_RUNS`), `DISCARDED`.

## 6. Сообщения сервер → клиент

### 6.1. Конверт

Каждое сообщение имеет одинаковую обёртку:

```json
{
  "seq": 42,
  "ts": 1790000000123,
  "type": "TASK_TAKEN",
  "executorId": "pool-1",
  "data": { "taskId": 7, "workerId": "pool-1/worker-1", "queueId": "pool-1/main", "queueSize": 1 }
}
```

| Поле | Тип | Описание |
|---|---|---|
| `seq` | number | глобальный номер события, начинается с 1, растёт на 1 без пропусков |
| `ts` | number | время на сервере, миллисекунды epoch. Только для отображения и замеров, **не для упорядочивания** |
| `type` | string | тип события (раздел 8) |
| `executorId` | string | к какому executor'у относится событие. Есть у всех событий из раздела 8 — каждое из них касается ровно одного executor'а. **Отсутствует** у `SNAPSHOT`: снимок описывает все executor'ы сразу, и `id` каждого лежит внутри `data.executors[]` |
| `data` | object | содержимое, зависит от `type` |

`executorId` вынесен в конверт, а не в `data`, чтобы клиент мог направить событие нужному
executor'у, не разбирая `data`: `state.executors[e.executorId]` → дальше reducer этого executor'а.

### 6.2. Порядок и гарантии

1. `seq` выдаётся под одной блокировкой вместе с применением события к серверному состоянию
   и рассылкой. Порядок `seq` = порядок, в котором сервер применил события.
2. **Причинный порядок по задаче гарантирован.** Для одной задачи события всегда приходят
   в порядке её жизненного цикла: `SUBMITTED` → `QUEUED` → `TAKEN` → `STARTED` → `COMPLETED`.
   Это обеспечивает реализация (раздел 11.2), клиенту не нужно ничего переупорядочивать.
3. **Порядок между разными потоками — это порядок публикации.** Если два воркера
   одновременно закончили задачи, порядок их `TASK_COMPLETED` произвольный.
4. `ts` может не расти монотонно между разными потоками — ориентироваться только на `seq`.

## 7. Жизненный цикл соединения

```
клиент                                   сервер
  │ ── WebSocket connect /ws/events ──►   │
  │                                       │  (под блокировкой: собрать снимок + подписать клиента)
  │ ◄──────────── SNAPSHOT (seq = N) ──── │
  │ ◄──────────── событие seq = N+1 ───── │
  │ ◄──────────── событие seq = N+2 ───── │
  │                 ...                   │
```

1. Сервер собирает снимок и подписывает клиента на рассылку **атомарно** (под той же
   блокировкой, под которой выдаётся `seq`). Поэтому между снимком и первым событием
   ничего не теряется и не дублируется.
2. Клиент хранит `lastSeq`:
   - `SNAPSHOT` → заменить всё состояние, `lastSeq = snapshot.seq`.
   - событие с `seq <= lastSeq` → проигнорировать (дубликат).
   - событие с `seq == lastSeq + 1` → применить, `lastSeq = seq`.
   - событие с `seq > lastSeq + 1` → **пропуск**: закрыть соединение и переподключиться
     (придёт новый снимок).
3. При обрыве соединения клиент переподключается с задержкой (1 с, затем 2 с, 4 с…, максимум 10 с).
4. При перезапуске сервера `seq` начинается заново с 1. Клиент узнаёт об этом по `SNAPSHOT`
   и просто заменяет состояние.
5. Неизвестный `type` клиент **игнорирует** (но продвигает `lastSeq`). Это позволяет
   добавлять новые события без поломки старых клиентов.

### 7.1. SNAPSHOT

```json
{
  "seq": 40,
  "ts": 1790000000000,
  "type": "SNAPSHOT",
  "data": {
    "protocolVersion": 1,
    "executors": [
      {
        "id": "pool-1",
        "config": {
          "kind": "THREAD_POOL",
          "corePoolSize": 1,
          "maximumPoolSize": 2,
          "keepAliveMs": 2000,
          "allowCoreThreadTimeOut": false,
          "queue": { "type": "LINKED", "capacity": 2 },
          "rejectionPolicy": "ABORT"
        },
        "state": "RUNNING",
        "queues": [
          { "id": "pool-1/main", "ownerId": "pool-1", "capacity": 2, "taskIds": [5, 6] }
        ],
        "workers": [
          { "id": "pool-1/worker-1", "ordinal": 1, "state": "BUSY", "currentTaskId": 4,
            "waitingTimeoutMs": null, "completedTasks": 3, "exitReason": null }
        ],
        "tasks": [
          { "id": 4, "label": "task-4", "durationMs": 1000, "shouldFail": false, "state": "RUNNING",
            "queueId": null, "workerId": "pool-1/worker-1", "runner": "WORKER",
            "submittedAt": 1789999999000, "startedAt": 1789999999500, "finishedAt": null, "error": null }
        ],
        "stats": { "submitted": 6, "completed": 3, "failed": 0, "rejected": 0, "discarded": 0, "largestPoolSize": 1 }
      }
    ]
  }
}
```

Сервер может не включать в снимок давно завершённые задачи (раздел 13), поэтому
клиент не должен рассчитывать, что в `tasks` есть вся история.

## 8. Каталог событий

Для каждого события указано: когда оно возникает, в каком потоке сервера (для понимания),
содержимое `data` и как оно меняет состояние (reducer).

### 8.1. События executor'а

#### `EXECUTOR_CREATED`
- **Когда:** executor создан командой `POST /api/executors`.
- **Поток:** поток HTTP-запроса.
- **data:** `{ config: ExecutorConfig, queues: Queue[] }`
- **Reducer:** добавить executor в состоянии `RUNNING` с пустыми `workers`, `tasks` и нулевой `stats`.

#### `EXECUTOR_CONFIG_CHANGED`
- **Когда:** изменены параметры живого пула (`setCorePoolSize`, `setMaximumPoolSize`, `setKeepAliveTime`, `allowCoreThreadTimeOut`).
- **Поток:** поток HTTP-запроса.
- **data:** `{ config: ExecutorConfig }` — полная новая конфигурация.
- **Reducer:** заменить `config`.
- **Примечание:** после уменьшения `corePoolSize`/`maximumPoolSize` лишние воркеры умрут
  не сразу, а при следующем обращении к очереди — клиент увидит это через `WORKER_EXITED`.

#### `EXECUTOR_SHUTDOWN`
- **Когда:** вызван `shutdown()`.
- **Поток:** поток HTTP-запроса.
- **data:** `{}`
- **Reducer:** `state = SHUTDOWN`.

#### `EXECUTOR_STOP`
- **Когда:** вызван `shutdownNow()`. Сразу за ним идут `TASK_DISCARDED` (reason `DRAINED`)
  для всех задач, извлечённых из очереди.
- **Поток:** поток HTTP-запроса.
- **data:** `{ drainedTaskIds: number[] }`
- **Reducer:** `state = STOP`.

#### `EXECUTOR_TERMINATED`
- **Когда:** пул полностью остановился — хук `terminated()`.
- **Поток:** обычно последний завершившийся воркер.
- **data:** `{}`
- **Reducer:** `state = TERMINATED`.

#### `EXECUTOR_REMOVED`
- **Когда:** executor удалён командой `DELETE /api/executors/{id}` (допустимо только в состоянии `TERMINATED`).
- **Поток:** поток HTTP-запроса.
- **data:** `{}`
- **Reducer:** удалить executor из состояния целиком.

### 8.2. События задачи

#### `TASK_SUBMITTED`
- **Когда:** непосредственно **перед** вызовом `executor.execute(task)`.
- **Поток:** поток HTTP-запроса.
- **data:** `{ taskId, label, durationMs, shouldFail }`
- **Reducer:** добавить задачу `state = SUBMITTED`, `submittedAt = ts`; `stats.submitted++`.

#### `TASK_QUEUED`
- **Когда:** `queue.offer(task)` вернул `true`.
- **Поток:** поток HTTP-запроса (тот, кто вызвал `execute`).
- **data:** `{ taskId, queueId, position, queueSize }` — `position` с нуля, `queueSize` после добавления.
- **Reducer:** `task.state = QUEUED`, `task.queueId = queueId`; добавить `taskId` в конец `queue.taskIds`.

#### `TASK_TAKEN`
- **Когда:** `queue.take()` или `queue.poll(timeout)` вернул задачу.
- **Поток:** поток воркера, который её забрал.
- **data:** `{ taskId, workerId, queueId, queueSize, waitedMs }` — `waitedMs` = сколько задача пролежала в очереди.
- **Reducer:** удалить `taskId` из `queue.taskIds`; `task.state = TAKEN`, `task.queueId = null`,
  `task.workerId = workerId`; `worker.state = IDLE`, `worker.waitingTimeoutMs = null`.

#### `TASK_STARTED`
- **Когда:** хук `beforeExecute(thread, task)` — воркер начинает `task.run()`.
  Для `CALLER_RUNS` — перед выполнением задачи в потоке отправителя.
- **Поток:** поток воркера (или поток отправителя для `CALLER_RUNS`).
- **data:** `{ taskId, workerId: string | null, runner: 'WORKER' | 'CALLER', callerThread: string | null, direct: boolean }`
  - `direct = true`, если задача пришла воркеру напрямую как `firstTask` (без `TASK_QUEUED`/`TASK_TAKEN`).
- **Reducer:** `task.state = RUNNING`, `task.startedAt = ts`, `task.runner = runner`, `task.workerId = workerId`;
  если `runner = WORKER`: `worker.state = BUSY`, `worker.currentTaskId = taskId`.

#### `TASK_COMPLETED`
- **Когда:** хук `afterExecute(task, null)` и задача не бросила исключение.
- **Поток:** поток воркера (или отправителя для `CALLER_RUNS`).
- **data:** `{ taskId, workerId: string | null, runMs }`
- **Reducer:** `task.state = COMPLETED`, `task.finishedAt = ts`; `stats.completed++`;
  если был воркер: `worker.state = IDLE`, `worker.currentTaskId = null`, `worker.completedTasks++`.

#### `TASK_FAILED`
- **Когда:** задача бросила исключение (`afterExecute(task, throwable)` с `throwable != null`).
- **Поток:** поток воркера (или отправителя для `CALLER_RUNS`).
- **data:** `{ taskId, workerId: string | null, runMs, error }` — `error` = `"ClassName: message"`.
- **Reducer:** как у `TASK_COMPLETED`, но `task.state = FAILED`, `task.error = error`, `stats.failed++`.
- **Примечание:** при `execute` исключение убивает воркер — следом придёт `WORKER_EXITED`
  (reason `ERROR`) и, скорее всего, `WORKER_CREATED` для замены.

#### `TASK_REJECTED`
- **Когда:** пул отказал в приёме задачи — вызван `RejectedExecutionHandler`. Причины:
  очередь полна и воркеров уже `maximumPoolSize`, либо executor не в состоянии `RUNNING`.
- **Поток:** поток HTTP-запроса.
- **data:** `{ taskId, policy, reason: 'SATURATED' | 'SHUTDOWN' }`
- **Reducer:** если задача лежит в очереди (редкий откат внутри `execute`) — удалить из `queue.taskIds`;
  `stats.rejected++`; дальше по политике:
  - `ABORT`, `DISCARD` → `task.state = REJECTED` (терминально). При `ABORT` отправитель получает исключение,
    при `DISCARD` задача молча теряется — для клиента разницы нет, различие видно по `policy`.
  - `CALLER_RUNS` → `task.state = REJECTED`, затем придут `TASK_STARTED`/`TASK_COMPLETED` с `runner = CALLER`.
  - `DISCARD_OLDEST` → `task.state = REJECTED`, затем придёт `TASK_DISCARDED` для головы очереди
    и новая попытка для этой задачи: `TASK_QUEUED` (или снова `TASK_REJECTED`).

#### `TASK_DISCARDED`
- **Когда:** задача удалена из очереди, так и не начав выполняться.
- **Поток:** поток HTTP-запроса.
- **data:** `{ taskId, queueId, reason: 'EVICTED_BY_NEWER' | 'DRAINED' }`
  - `EVICTED_BY_NEWER` — вытеснена политикой `DISCARD_OLDEST`;
  - `DRAINED` — извлечена `shutdownNow()`.
- **Reducer:** удалить из `queue.taskIds`; `task.state = DISCARDED`, `task.queueId = null`; `stats.discarded++`.

### 8.3. События очереди

#### `QUEUE_FULL`
- **Когда:** `queue.offer(task)` вернул `false`.
- **Поток:** поток HTTP-запроса.
- **data:** `{ taskId, queueId, queueSize }`
- **Reducer:** состояние не меняется. Событие информационное.
- **Важно:** это **ещё не отказ**. После него пул попробует создать воркер сверх `corePoolSize`
  (придёт `WORKER_CREATED` и `TASK_STARTED` с `direct = true`), и только если воркеров уже
  `maximumPoolSize`, придёт `TASK_REJECTED`. Для `SYNCHRONOUS`-очереди `QUEUE_FULL` возникает
  всякий раз, когда нет свободного ждущего воркера.

### 8.4. События воркера

#### `WORKER_CREATED`
- **Когда:** пул вызвал нашу `ThreadFactory` (конструктор `Worker`).
- **Поток:** поток, вызвавший `execute` (обычно поток HTTP-запроса); при замене упавшего воркера —
  поток умирающего воркера.
- **data:** `{ workerId, ordinal, poolSize }` — `poolSize` = число живых воркеров **включая** нового.
- **Reducer:** добавить воркер `state = CREATED`; обновить `stats.largestPoolSize`.

#### `WORKER_STARTED`
- **Когда:** поток воркера начал выполнение (начало `Worker.run()`).
- **Поток:** поток воркера.
- **data:** `{ workerId }`
- **Reducer:** `worker.state = IDLE`, если он ещё `CREATED`.
  (Если `TASK_STARTED` с `direct = true` уже пришёл раньше, воркер остаётся `BUSY`.)

#### `WORKER_WAITING`
- **Когда:** воркер вызвал `queue.take()` или `queue.poll(timeout)` — сейчас он уснёт, если очередь пуста.
- **Поток:** поток воркера.
- **data:** `{ workerId, queueId, timeoutMs: number | null }` — `null` для `take()` (ждёт бесконечно).
- **Reducer:** `worker.state = WAITING`, `worker.waitingTimeoutMs = timeoutMs`.
- **Примечание:** если очередь не пуста, сразу за ним придёт `TASK_TAKEN` — клиент может
  не анимировать ожидание, если следующее событие пришло почти сразу.

#### `WORKER_TIMED_OUT`
- **Когда:** `queue.poll(timeout)` вернул `null` — воркер простоял дольше `keepAliveMs`.
- **Поток:** поток воркера.
- **data:** `{ workerId, idleMs }`
- **Reducer:** `worker.state = IDLE`, `worker.waitingTimeoutMs = null`.
- **Примечание:** обычно следом идёт `WORKER_EXITED` (reason `TIMEOUT`). Но если за это время
  другой воркер уже умер и живых стало `<= corePoolSize`, этот воркер останется жить и снова
  пошлёт `WORKER_WAITING` (уже с `timeoutMs = null`).

#### `WORKER_EXITED`
- **Когда:** цикл `runWorker` завершился (конец `Worker.run()`).
- **Поток:** поток воркера.
- **data:** `{ workerId, reason: 'SHUTDOWN' | 'TIMEOUT' | 'ERROR', error: string | null, completedTasks, poolSize }`
  — `poolSize` = число живых воркеров **после** выхода.
- **Reducer:** `worker.state = EXITED`, `worker.exitReason = reason`, `worker.currentTaskId = null`.

## 9. Команды клиент → сервер (REST)

Все запросы и ответы — JSON. Успешная команда возвращает `202 Accepted` (или `200` для чтения):
команда принята, её результат придёт событиями.

Ошибки:

```json
{ "error": "VALIDATION_FAILED", "message": "maximumPoolSize must be >= corePoolSize" }
```

| HTTP | `error` | Когда |
|---|---|---|
| 400 | `VALIDATION_FAILED` | некорректные параметры |
| 404 | `EXECUTOR_NOT_FOUND` | нет executor'а с таким `id` |
| 409 | `INVALID_STATE` | команда недопустима в текущем состоянии (например, задачи в `SHUTDOWN`-пул) |

### 9.1. `GET /api/snapshot`
Текущий снимок — то же содержимое, что в `SNAPSHOT.data`, плюс `seq`.
Для отладки и для клиентов без WebSocket.

### 9.2. `POST /api/executors`
Создать executor.

```json
{
  "corePoolSize": 1,
  "maximumPoolSize": 2,
  "keepAliveMs": 2000,
  "allowCoreThreadTimeOut": false,
  "queue": { "type": "LINKED", "capacity": 2 },
  "rejectionPolicy": "ABORT",
  "prestartCoreThreads": false
}
```

Ответ `202`: `{ "executorId": "pool-1" }`. События: `EXECUTOR_CREATED`
(и `WORKER_CREATED`/`WORKER_STARTED`/`WORKER_WAITING` для каждого core-воркера, если `prestartCoreThreads = true`).

Валидация:
- `1 <= corePoolSize <= maximumPoolSize <= 16`;
- `keepAliveMs >= 0`; `keepAliveMs > 0`, если `allowCoreThreadTimeOut = true`;
- `queue.type = SYNCHRONOUS` → `capacity` должен быть `null` или `0`; `ARRAY` → `capacity` обязателен и `>= 1`;
  `LINKED` → `capacity` `null` (без ограничения) или `>= 1`.

### 9.3. `POST /api/executors/{id}/tasks`
Отправить пачку задач.

```json
{ "count": 5, "durationMs": 1000, "failRate": 0.1, "intervalMs": 0, "labelPrefix": "task" }
```

| Поле | Описание |
|---|---|
| `count` | 1..100 |
| `durationMs` | 100..60000 — сколько задача «работает» (`Thread.sleep`) |
| `failRate` | 0.0..1.0 — вероятность, что задача бросит исключение в конце работы (`shouldFail` решается при отправке) |
| `intervalMs` | пауза между отправками задач пачки, 0..10000. Если `> 0`, задачи отправляются из фонового потока, а HTTP-ответ приходит сразу |
| `labelPrefix` | необязательно, по умолчанию `task` |

Ответ `202`: `{ "taskIds": [7, 8, 9, 10, 11] }`.
События: `TASK_SUBMITTED` и далее по жизненному циклу каждой задачи.
Отказ пула (`TASK_REJECTED`) — это **не** ошибка HTTP: команда всё равно `202`.

### 9.4. `PATCH /api/executors/{id}`
Изменить параметры живого пула. Все поля необязательные.

```json
{ "corePoolSize": 2, "maximumPoolSize": 4, "keepAliveMs": 1000, "allowCoreThreadTimeOut": true }
```

Ответ `202`. Событие: `EXECUTOR_CONFIG_CHANGED`. Тип очереди и политику отказа поменять нельзя —
нужно создать новый executor.

### 9.5. `POST /api/executors/{id}/shutdown`
Вызывает `shutdown()`. Ответ `202`. События: `EXECUTOR_SHUTDOWN`, затем по мере завершения —
`WORKER_EXITED` и `EXECUTOR_TERMINATED`.

### 9.6. `POST /api/executors/{id}/shutdown-now`
Вызывает `shutdownNow()`. Ответ `202`. События: `EXECUTOR_STOP`, `TASK_DISCARDED` (reason `DRAINED`)
для задач из очереди; выполняющиеся задачи получат прерывание — `Thread.sleep` бросит
`InterruptedException`, придёт `TASK_FAILED`; затем `WORKER_EXITED` и `EXECUTOR_TERMINATED`.
У воркеров, чья задача упала от прерывания, `reason = ERROR` (исключение вылетело из `task.run()`),
у простаивавших — `SHUTDOWN`. Замену упавшим воркерам пул в состоянии `STOP` не создаёт.

### 9.7. `DELETE /api/executors/{id}`
Удалить остановленный executor. Допустимо только в `TERMINATED`, иначе `409`. Событие: `EXECUTOR_REMOVED`.

## 10. Пример: полный сценарий

Конфигурация: `corePoolSize = 1`, `maximumPoolSize = 2`, `keepAliveMs = 2000`,
очередь `LINKED` ёмкостью 2, политика `ABORT`. Отправлено 5 задач по 1000 мс, через 5 с — `shutdown`.

Показаны только `seq`, `type` и `data`. Порядок событий из разных потоков может отличаться.

```
 1 EXECUTOR_CREATED   { config: {...}, queues: [{ id: "pool-1/main", capacity: 2, taskIds: [] }] }

 2 TASK_SUBMITTED     { taskId: 1, label: "task-1", durationMs: 1000, shouldFail: false }
 3 WORKER_CREATED     { workerId: "pool-1/worker-1", ordinal: 1, poolSize: 1 }      ← воркеров 0 < core
 4 WORKER_STARTED     { workerId: "pool-1/worker-1" }
 5 TASK_STARTED       { taskId: 1, workerId: "pool-1/worker-1", runner: "WORKER", direct: true }

 6 TASK_SUBMITTED     { taskId: 2, ... }
 7 TASK_QUEUED        { taskId: 2, queueId: "pool-1/main", position: 0, queueSize: 1 }
 8 TASK_SUBMITTED     { taskId: 3, ... }
 9 TASK_QUEUED        { taskId: 3, queueId: "pool-1/main", position: 1, queueSize: 2 }

10 TASK_SUBMITTED     { taskId: 4, ... }
11 QUEUE_FULL         { taskId: 4, queueId: "pool-1/main", queueSize: 2 }           ← ещё не отказ
12 WORKER_CREATED     { workerId: "pool-1/worker-2", ordinal: 2, poolSize: 2 }      ← сверх core
13 WORKER_STARTED     { workerId: "pool-1/worker-2" }
14 TASK_STARTED       { taskId: 4, workerId: "pool-1/worker-2", runner: "WORKER", direct: true }

15 TASK_SUBMITTED     { taskId: 5, ... }
16 QUEUE_FULL         { taskId: 5, queueId: "pool-1/main", queueSize: 2 }
17 TASK_REJECTED      { taskId: 5, policy: "ABORT", reason: "SATURATED" }           ← воркеров уже max

18 TASK_COMPLETED     { taskId: 1, workerId: "pool-1/worker-1", runMs: 1001 }
19 WORKER_WAITING     { workerId: "pool-1/worker-1", queueId: "pool-1/main", timeoutMs: 2000 }  ← 2 > core → poll
20 TASK_TAKEN         { taskId: 2, workerId: "pool-1/worker-1", queueSize: 1, waitedMs: 1000 }
21 TASK_STARTED       { taskId: 2, workerId: "pool-1/worker-1", runner: "WORKER", direct: false }
22 TASK_COMPLETED     { taskId: 4, workerId: "pool-1/worker-2", runMs: 1000 }
23 WORKER_WAITING     { workerId: "pool-1/worker-2", queueId: "pool-1/main", timeoutMs: 2000 }
24 TASK_TAKEN         { taskId: 3, workerId: "pool-1/worker-2", queueSize: 0, waitedMs: 1000 }
25 TASK_STARTED       { taskId: 3, workerId: "pool-1/worker-2", runner: "WORKER", direct: false }
26 TASK_COMPLETED     { taskId: 2, ... }
27 WORKER_WAITING     { workerId: "pool-1/worker-1", timeoutMs: 2000 }
28 TASK_COMPLETED     { taskId: 3, ... }
29 WORKER_WAITING     { workerId: "pool-1/worker-2", timeoutMs: 2000 }

30 WORKER_TIMED_OUT   { workerId: "pool-1/worker-1", idleMs: 2000 }                 ← кто первым простоял
31 WORKER_EXITED      { workerId: "pool-1/worker-1", reason: "TIMEOUT", completedTasks: 2, poolSize: 1 }
32 WORKER_TIMED_OUT   { workerId: "pool-1/worker-2", idleMs: 2000 }
33 WORKER_WAITING     { workerId: "pool-1/worker-2", timeoutMs: null }             ← остался 1 = core → take()

34 EXECUTOR_SHUTDOWN  {}
35 WORKER_EXITED      { workerId: "pool-1/worker-2", reason: "SHUTDOWN", completedTasks: 2, poolSize: 0 }
36 EXECUTOR_TERMINATED {}
```

## 11. Заметки для реализации на сервере

### 11.1. Откуда брать каждое событие

| Событие | Точка в `ThreadPoolExecutor` / нашем коде |
|---|---|
| `EXECUTOR_*` | наш сервис вокруг пула; `EXECUTOR_TERMINATED` — переопределённый `terminated()` |
| `TASK_SUBMITTED` | наш сервис, перед `execute(task)` |
| `TASK_QUEUED`, `QUEUE_FULL` | переопределённый `offer(e)` у очереди |
| `WORKER_WAITING`, `TASK_TAKEN`, `WORKER_TIMED_OUT` | переопределённые `take()` / `poll(timeout, unit)` у очереди |
| `TASK_STARTED` | `beforeExecute(t, r)` |
| `TASK_COMPLETED`, `TASK_FAILED` | `afterExecute(r, t)` |
| `TASK_REJECTED`, `TASK_DISCARDED (EVICTED_BY_NEWER)` | своя обёртка над `RejectedExecutionHandler` |
| `TASK_DISCARDED (DRAINED)` | результат `shutdownNow()` |
| `WORKER_CREATED` | своя `ThreadFactory` |
| `WORKER_STARTED`, `WORKER_EXITED` | обёртка над `Runnable` (объектом `Worker`) внутри `ThreadFactory`: до и после `worker.run()` |

Прочее:
- Задачи отправляются через **`execute`**, а не `submit`: иначе в очередь и хуки попадёт
  `FutureTask`, а не наша задача с `taskId`, и исключения не будут доходить до `afterExecute`.
- `direct` в `TASK_STARTED`: задача считается прямой, если для неё не было `TASK_TAKEN`
  (сервер знает это из своего состояния: к `beforeExecute` задача всё ещё в `SUBMITTED`).
- Причина `WORKER_EXITED`: `ERROR`, если `worker.run()` вылетел с исключением;
  `TIMEOUT`, если последним событием воркера был `WORKER_TIMED_OUT`; иначе `SHUTDOWN`.
  (Уменьшение `maximumPoolSize` тоже даёт выход без таймаута — в v1 это тоже `SHUTDOWN`.)
- `timeout` в `poll(timeout, unit)` пул передаёт в наносекундах — переводить через `unit.toMillis(timeout)`.
- `CALLER_RUNS`: задача выполняется прямо в потоке отправителя, хуки `beforeExecute`/`afterExecute`
  **не вызываются** — события `TASK_STARTED`/`TASK_COMPLETED` шлёт обёртка над обработчиком отказа.

### 11.2. Гарантия причинного порядка

Опасная гонка: поток отправителя положил задачу в очередь, но ещё не успел опубликовать
`TASK_QUEUED`, а воркер уже забрал её и опубликовал `TASK_TAKEN`. Клиент увидел бы `TAKEN` раньше `QUEUED`.

Решение — общий монитор `publishLock`, под которым выполняется **и изменение очереди, и публикация**
для `offer`, и **только публикация** для `take`/`poll`:

```kotlin
override fun offer(e: Runnable): Boolean = synchronized(publishLock) {
    val ok = super.offer(e)
    emit(if (ok) TaskQueued(...) else QueueFull(...))
    ok
}

override fun take(): Runnable {
    emit(WorkerWaiting(...))
    val task = super.take()                       // блокировка — ВНЕ монитора
    synchronized(publishLock) { emit(TaskTaken(...)) }
    return task
}
```

Воркер может достать задачу только после того, как `super.offer` её положил, а опубликовать
`TASK_TAKEN` — только после того, как отправитель вышел из монитора, то есть уже опубликовал
`TASK_QUEUED`. Ждать внутри монитора (`super.take()` под `synchronized`) нельзя — это заблокирует всех отправителей.

Для остальных пар порядок обеспечивается естественно: `TASK_SUBMITTED` публикуется до `execute`,
`WORKER_CREATED` — до `thread.start()`, а `TASK_TAKEN` → `TASK_STARTED` → `TASK_COMPLETED` идут из одного потока.

### 11.3. Публикация

```kotlin
fun interface EventSink { fun emit(event: PoolEvent) }
```

- Модуль `core` зависит только от `EventSink`. Для отладки — реализация с `println`,
  в `server` — реализация, которая под одной блокировкой: выдаёт `seq`, применяет событие
  к серверному состоянию (reducer), рассылает его подписчикам.
- Рассылка не должна блокировать потоки пула: у каждого WebSocket-клиента своя исходящая очередь,
  медленный клиент не тормозит executor. Если исходящая очередь клиента переполнилась —
  закрыть его соединение (он переподключится и получит снимок).
- Никакой долгой работы и исключений внутри `emit`: он вызывается из хуков и методов очереди,
  исключение там убьёт воркер.

## 12. Расширяемость

- **Новые типы событий** можно добавлять в любой момент: клиент игнорирует неизвестные.
- **Новые поля** в `data` можно добавлять: клиент игнорирует неизвестные поля.
- **Удаление или изменение смысла** поля или события — только с увеличением `protocolVersion`.
- Будущие executor'ы:
  - `ScheduledThreadPoolExecutor`: `config.kind = 'SCHEDULED'`, очередь с задержками —
    добавится `TASK_SCHEDULED { taskId, runAt }` и `periodMs` у периодических задач.
  - `ForkJoinPool`: `config.kind = 'FORK_JOIN'`, у каждого воркера своя очередь
    (`Queue.ownerId = workerId`), добавится `TASK_STOLEN { taskId, fromQueueId, toWorkerId }`.
    Поэтому очередь с самого начала — отдельная сущность со своим `ownerId`.

## 13. Ограничения v1

| Параметр | Значение | Зачем |
|---|---|---|
| executor'ов одновременно | до 4 | в UI помещаются рядом для сравнения |
| `maximumPoolSize` | до 16 | влезает на экран |
| задач в одной команде | до 100 | |
| `durationMs` | от 100 мс | иначе события летят быстрее, чем их можно увидеть |
| завершённых задач в снимке | последние 200 на executor | снимок не растёт бесконечно; более старые из `tasks` удаляются (счётчики `stats` сохраняются) |

Если поток событий окажется слишком плотным, в следующей версии можно отправлять их пачками:
`{ type: "BATCH", data: { events: [...] } }` раз в 50 мс, с сохранением `seq` каждого события внутри.

## 14. Открытые вопросы

1. Нужен ли heartbeat по WebSocket (например, `PING` без `seq` раз в 15 с), чтобы быстрее
   замечать «тихо умершее» соединение?
2. Отправлять ли `EXECUTOR_REMOVED` автоматически через N минут после `TERMINATED`, или только по команде?
3. Показывать ли в модели поток HTTP-запроса как отдельного «отправителя» (актуально для
   `CALLER_RUNS` и для наглядности того, что `execute` не блокирует отправителя)?