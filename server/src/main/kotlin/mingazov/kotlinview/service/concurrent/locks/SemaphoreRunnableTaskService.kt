package mingazov.kotlinview.service.concurrent.locks

import mingazov.kotlinview.instrumented.concurrent.locks.InstrumentedSemaphoreRunnableTask
import mingazov.kotlinview.instrumented.concurrent.locks.registry.InstrumentedSemaphoreRegistry
import mingazov.kotlinview.instrumented.concurrent.locks.registry.InstrumentedSemaphoreRunnableTaskRegistry
import mingazov.kotlinview.instrumented.executor.registry.InstrumentedRunnableTaskRegistry
import org.springframework.stereotype.Service
import java.util.concurrent.atomic.AtomicLong

/**
 * Фасад задачи под семафором: собирает её из частей (семафор, задача) и удаляет их вместе с ней.
 * Реестры в algorithms остаются независимыми — правило владения живёт только здесь, как у ThreadPoolExecutorService.
 */
@Service
class SemaphoreRunnableTaskService(
    private val registry: InstrumentedSemaphoreRunnableTaskRegistry,
    private val semaphoreRegistry: InstrumentedSemaphoreRegistry,
    private val taskRegistry: InstrumentedRunnableTaskRegistry,
) {

    private val runnerIds = AtomicLong()

    /** Объект владеет своими частями: создаёт их сам и удаляет вместе с собой. */
    fun create(permits: Int, fair: Boolean, durationMs: Long): InstrumentedSemaphoreRunnableTask {
        // Проверяем до создания частей: иначе клиент получил бы OBJECT_CREATED семафора, у которого не будет хозяина.
        // permits < 0 разрешено, как у семафора: первые run ждут, пока кто-то не сделает release напрямую
        require(durationMs >= 0) { "durationMs must be >= 0" }

        // Порядок событий: сначала части, потом целое — ссылки semaphoreId / taskId всегда на уже известные клиенту объекты
        val semaphore = semaphoreRegistry.create(permits, fair)
        val task = taskRegistry.create(durationMs)
        return registry.create(semaphore, task)
    }

    fun get(id: Long): InstrumentedSemaphoreRunnableTask = registry.get(id)
    fun all() = registry.all()

    /**
     * run() блокирующий: в новом daemon-потоке, сразу возвращаем его имя. Каждый вызов — новый поток.
     * Имя sem-runner-N, а не runner-N: так уже зовёт свои потоки InstrumentedRunnableTaskService,
     * а клиент склеивает события по имени потока — имена должны быть уникальны на весь сервер.
     */
    fun run(id: Long): String {
        val guarded = registry.get(id)
        val thread = Thread(guarded, "sem-runner-${runnerIds.incrementAndGet()}")
        thread.isDaemon = true // поток, ждущий в acquire, не должен мешать остановке приложения
        thread.start()
        return thread.name
    }

    // TODO: семафор и задачу можно удалить в обход фасада через DELETE /api/semaphore/{id} и /api/tasks/{id}
    fun remove(id: Long) {
        val guarded = registry.get(id)
        // Кто-то внутри (ждёт в acquire или выполняет задачу) — его поток остался бы работать с удалёнными частями
        check(guarded.activeCount() == 0) { "SemaphoreRunnableTask $id has threads inside run" }
        // Сначала целое: на части больше никто не ссылается
        registry.remove(id)
        semaphoreRegistry.remove(guarded.semaphoreId)
        taskRegistry.remove(guarded.taskId)
    }
}