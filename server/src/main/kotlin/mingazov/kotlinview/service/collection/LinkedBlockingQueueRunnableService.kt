package mingazov.kotlinview.service.collection

import mingazov.kotlinview.instrumented.collection.InstrumentedLinkedBlockingQueueRunnable
import mingazov.kotlinview.instrumented.collection.registry.InstrumentedLinkedBlockingQueueRunnableRegistry
import mingazov.kotlinview.instrumented.executor.registry.InstrumentedRunnableTaskRegistry
import org.springframework.stereotype.Service
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

@Service
class LinkedBlockingQueueRunnableService(
    private val registry: InstrumentedLinkedBlockingQueueRunnableRegistry,
    private val taskRegistry: InstrumentedRunnableTaskRegistry,
) {

    private val takerIds = AtomicLong()
    private val putterIds = AtomicLong()
    private val pollerIds = AtomicLong()

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
        return startDaemon("taker-${takerIds.incrementAndGet()}") { queue.take() }
    }

    /**
     * put() блокирующий: на полной очереди ждёт места. В новом потоке, как take; задача легла — METHOD_OUT put.
     * Та же утечка, что у take: если удалить очередь, пока поток ждёт в put(), он останется висеть.
     */
    fun put(queueId: Long, taskId: Long): String {
        val queue = registry.get(queueId)
        val task = taskRegistry.get(taskId)
        return startDaemon("putter-${putterIds.incrementAndGet()}") { queue.put(task) }
    }

    /** poll(timeout): как take, но ждёт не дольше timeoutMs; METHOD_OUT poll — taskId или null (не дождался). */
    fun poll(queueId: Long, timeoutMs: Long): String {
        val queue = registry.get(queueId)
        return startDaemon("poller-${pollerIds.incrementAndGet()}") { queue.poll(timeoutMs, TimeUnit.MILLISECONDS) }
    }

    // Поток, ждущий в очереди, не должен мешать остановке приложения
    private fun startDaemon(name: String, body: () -> Unit): String {
        val thread = Thread(body, name)
        thread.isDaemon = true
        thread.start()
        return thread.name
    }
}