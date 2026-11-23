package mingazov.kotlinview.service.concurrent.locks

import mingazov.kotlinview.event.ObjectType
import mingazov.kotlinview.instrumented.ObjectNotFoundException
import mingazov.kotlinview.instrumented.concurrent.locks.AQSAcquireMode
import mingazov.kotlinview.instrumented.concurrent.locks.InstrumentedAQSRunnableTask
import mingazov.kotlinview.instrumented.concurrent.locks.registry.InstrumentedAQSRegistry
import mingazov.kotlinview.instrumented.concurrent.locks.registry.InstrumentedAQSRunnableTaskRegistry
import mingazov.kotlinview.instrumented.executor.registry.InstrumentedRunnableTaskRegistry
import mingazov.kotlinview.service.concurrent.WorkerThreads
import org.springframework.stereotype.Service
import java.util.concurrent.ConcurrentHashMap

/**
 * Описание одной задачи группы. durationMs — сколько «работает» поток, уже войдя в AQS;
 * timeoutMs — только у TRY_ACQUIRE_NANOS (0 — «попробовать без ожидания»)
 */
data class AQSTaskSpec(
    val shared: Boolean = false,
    val mode: AQSAcquireMode = AQSAcquireMode.ACQUIRE,
    val arg: Int = 1,
    val durationMs: Long = 5000,
    val timeoutMs: Long = 2000,
)

/**
 * Фасад группы: один AQS и несколько задач над ним — у каждой свой режим входа, а очередь общая. Так в одной
 * очереди оказываются exclusive- и shared-узлы с разным arg. Создаёт и удаляет группу целиком: AQS отдельно не
 * удаляется, поэтому правила «нельзя удалить, пока на него ссылаются» не нужно. Реестры в algorithms независимы —
 * правило владения живёт только здесь, как у SemaphoreRunnableTaskService.
 * id группы — id её AQS. Потоки aqs-worker-N — WorkerThreads: держит их по имени, пока поток внутри run, —
 * interrupt приходит по REST именем.
 */
@Service
class AQSRunnableTaskService(
    private val registry: InstrumentedAQSRunnableTaskRegistry,
    private val aqsRegistry: InstrumentedAQSRegistry,
    private val taskRegistry: InstrumentedRunnableTaskRegistry,
) {

    // id AQS → задачи группы
    private val groups = ConcurrentHashMap<Long, List<InstrumentedAQSRunnableTask>>()

    // Владелец потока — id задачи, в чьём run он идёт (interrupt — только своим потокам)
    private val threads = WorkerThreads("aqs-worker")

    fun create(limit: Int, specs: List<AQSTaskSpec>): Long {
        // Все проверки — до создания частей: иначе клиент получил бы OBJECT_CREATED частей без хозяина
        require(limit >= 0) { "limit must be >= 0" }
        require(specs.isNotEmpty()) { "tasks must not be empty" }
        specs.forEach {
            // arg > limit — ждал бы вечно; arg <= 0 — acquire не занимал бы место (или освобождал)
            require(it.arg in 1..limit) { "arg must be in 1..$limit, got ${it.arg}" }
            require(it.durationMs >= 0) { "durationMs must be >= 0" }
            require(it.timeoutMs >= 0) { "timeoutMs must be >= 0" }
        }
        // Сначала общая часть, потом задачи — ссылки aqsId / taskId всегда на уже известные клиенту объекты
        val aqs = aqsRegistry.create(limit)
        groups[aqs.id] = specs.map { spec ->
            val task = taskRegistry.create(spec.durationMs)
            registry.create(aqs, task, spec.shared, spec.mode, spec.arg, spec.timeoutMs)
        }
        return aqs.id
    }

    /**
     * Новый daemon-поток aqs-worker-N: входит в AQS режимом задачи, работает, выходит. HTTP отвечает сразу его именем.
     * Имя уникально на весь сервер: клиент склеивает события по имени потока
     */
    fun run(taskId: Long): String {
        val task = registry.get(taskId)
        return threads.start(taskId) { task.run() }
    }

    /**
     * interrupt из HTTP-потока. Ждёт в ACQUIRE_INTERRUPTIBLY / TRY_ACQUIRE_NANOS — уйдёт из очереди с
     * InterruptedException; в ACQUIRE — дождётся и выйдет с флагом, а флаг прервёт sleep задачи; уже работает —
     * прервётся sleep задачи (release всё равно будет — он в finally).
     * Потока нет или он не этой задачи — NoSuchElementException (контроллер: 404).
     */
    fun interrupt(taskId: Long, threadName: String) {
        registry.get(taskId)
        val thread = threads.threadOf(taskId, threadName)
            ?: throw NoSuchElementException("Thread $threadName is not running in AQSRunnableTask $taskId")
        thread.interrupt()
    }

    // TODO: AQS и задачи можно удалить в обход фасада через DELETE /api/tasks/{id}
    fun remove(aqsId: Long) {
        val tasks = groups[aqsId] ?: throw ObjectNotFoundException(ObjectType.AQS, aqsId)
        // Кто-то внутри (ждёт в очереди или работает) — его поток остался бы с удалёнными частями
        check(tasks.all { it.activeCount() == 0 }) { "AQS $aqsId has threads inside run" }
        groups.remove(aqsId)
        // Сначала задачи — на AQS ссылаются они; у каждой — её RunnableTask
        tasks.forEach {
            registry.remove(it.id)
            taskRegistry.remove(it.taskId)
        }
        aqsRegistry.remove(aqsId)
    }
}
