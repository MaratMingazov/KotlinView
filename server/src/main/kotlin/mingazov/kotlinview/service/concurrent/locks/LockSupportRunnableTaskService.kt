package mingazov.kotlinview.service.concurrent.locks

import mingazov.kotlinview.instrumented.concurrent.locks.InstrumentedLockSupportRunnableTask
import mingazov.kotlinview.instrumented.concurrent.locks.ParkMode
import mingazov.kotlinview.instrumented.concurrent.locks.registry.InstrumentedLockSupportRegistry
import mingazov.kotlinview.instrumented.concurrent.locks.registry.InstrumentedLockSupportRunnableTaskRegistry
import mingazov.kotlinview.instrumented.executor.registry.InstrumentedRunnableTaskRegistry
import org.springframework.stereotype.Service
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/**
 * Фасад задачи с парковкой: собирает её из частей (LockSupport, задача) и удаляет их вместе с ней.
 * Реестры в algorithms остаются независимыми — правило владения живёт только здесь, как у SemaphoreRunnableTaskService.
 * Потоки parker-N создаёт сам (run) и держит по имени, пока поток внутри run: unpark приходит по REST именем.
 * Закончил run — поток убирается из списка: ссылки на завершившиеся не копятся.
 */
@Service
class LockSupportRunnableTaskService(
    private val registry: InstrumentedLockSupportRunnableTaskRegistry,
    private val lockSupportRegistry: InstrumentedLockSupportRegistry,
    private val taskRegistry: InstrumentedRunnableTaskRegistry,
) {

    private val parkerIds = AtomicLong()

    // Имя потока → поток и id объекта, в чьём run он идёт (unpark — только своим потокам)
    private class Parker(val thread: Thread, val ownerId: Long)

    private val parkers = ConcurrentHashMap<String, Parker>()

    fun create(durationMs: Long, mode: ParkMode, timeoutMs: Long): InstrumentedLockSupportRunnableTask {
        // Проверяем до создания частей: иначе клиент получил бы OBJECT_CREATED частей без хозяина
        require(durationMs >= 0) { "durationMs must be >= 0" }
        require(timeoutMs >= 0) { "timeoutMs must be >= 0" }
        // Сначала части, потом целое — ссылки lockSupportId / taskId всегда на уже известные клиенту объекты
        val lockSupport = lockSupportRegistry.create()
        val task = taskRegistry.create(durationMs)
        return registry.create(lockSupport, task, mode, timeoutMs)
    }

    fun get(id: Long): InstrumentedLockSupportRunnableTask = registry.get(id)
    fun all() = registry.all()

    /**
     * Новый daemon-поток parker-N: работает durationMs, потом паркуется. HTTP отвечает сразу его именем.
     * Имя уникально на весь сервер: клиент склеивает события по имени потока
     */
    fun run(id: Long): String {
        val parking = registry.get(id)
        val name = "parker-${parkerIds.incrementAndGet()}"
        val thread = Thread({
            try {
                parking.run()
            } finally {
                parkers.remove(name)
            }
        }, name)
        thread.isDaemon = true             // спящий в park не должен мешать остановке приложения
        parkers[name] = Parker(thread, id) // до start: unpark во время работы задачи найдёт поток
        thread.start()
        return name
    }

    /** unpark из HTTP-потока. Потока нет или он не этого объекта — NoSuchElementException (контроллер: 404). */
    fun unpark(id: Long, threadName: String) {
        val parking = registry.get(id)
        val parker = parkers[threadName]?.takeIf { it.ownerId == id }
            ?: throw NoSuchElementException("Thread $threadName is not running in LockSupportRunnableTask $id")
        lockSupportRegistry.get(parking.lockSupportId).unpark(parker.thread)
    }

    // TODO: LockSupport и задачу можно удалить в обход фасада через DELETE /api/tasks/{id}
    fun remove(id: Long) {
        val parking = registry.get(id)
        // Кто-то внутри (работает или спит в park) — его поток остался бы с удалёнными частями
        check(parking.activeCount() == 0) { "LockSupportRunnableTask $id has threads inside run" }
        // Сначала целое: на части больше никто не ссылается
        registry.remove(id)
        lockSupportRegistry.remove(parking.lockSupportId)
        taskRegistry.remove(parking.taskId)
    }
}