package mingazov.kotlinview.service.collection

import mingazov.kotlinview.instrumented.collection.InstrumentedLinkedBlockingQueueRunnable
import mingazov.kotlinview.instrumented.collection.registry.InstrumentedLinkedBlockingQueueRunnableRegistry
import mingazov.kotlinview.instrumented.executor.registry.InstrumentedRunnableTaskRegistry
import mingazov.kotlinview.service.concurrent.WorkerThreads
import org.springframework.stereotype.Service
import java.util.concurrent.TimeUnit

@Service
class LinkedBlockingQueueRunnableService(
    private val registry: InstrumentedLinkedBlockingQueueRunnableRegistry,
    private val taskRegistry: InstrumentedRunnableTaskRegistry,
) {

    // Потоки блокирующих вызовов; владелец — id очереди. Префикс lbq- — имена уникальны на весь сервер: у другой
    // очереди тоже есть taker / putter / poller, а клиент склеивает события по имени потока
    private val takers = WorkerThreads("lbq-taker")
    private val putters = WorkerThreads("lbq-putter")
    private val pollers = WorkerThreads("lbq-poller")

    fun create(capacity: Int): InstrumentedLinkedBlockingQueueRunnable = registry.create(capacity)
    fun get(queueId: Long): InstrumentedLinkedBlockingQueueRunnable = registry.get(queueId)
    fun remove(queueId: Long) = registry.remove(queueId)
    fun all() = registry.all()

    fun offer(queueId: Long, taskId: Long): Boolean =
        registry.get(queueId).offer(taskRegistry.get(taskId))

    /**
     * take() блокирующий: запускаем в новом потоке и сразу возвращаем его имя, как TaskService.run().
     * Результат (taskId) клиент узнает из METHOD_OUT take.
     * Известная утечка: если удалить очередь, пока поток ждёт в take(), он так и останется висеть.
     */
    fun take(queueId: Long): String {
        val queue = registry.get(queueId)
        return takers.start(queueId) { queue.take() }
    }

    /**
     * put() блокирующий: на полной очереди ждёт места. В новом потоке, как take; задача легла — METHOD_OUT put.
     * Та же утечка, что у take: если удалить очередь, пока поток ждёт в put(), он останется висеть.
     */
    fun put(queueId: Long, taskId: Long): String {
        val queue = registry.get(queueId)
        val task = taskRegistry.get(taskId)
        return putters.start(queueId) { queue.put(task) }
    }

    /** poll(timeout): как take, но ждёт не дольше timeoutMs; METHOD_OUT poll — taskId или null (не дождался). */
    fun poll(queueId: Long, timeoutMs: Long): String {
        val queue = registry.get(queueId)
        return pollers.start(queueId) { queue.poll(timeoutMs, TimeUnit.MILLISECONDS) }
    }
}