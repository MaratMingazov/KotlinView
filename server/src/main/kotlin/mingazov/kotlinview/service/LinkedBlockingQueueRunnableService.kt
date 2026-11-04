package mingazov.kotlinview.service

import mingazov.kotlinview.instrumented.InstrumentedLinkedBlockingQueueRunnable
import mingazov.kotlinview.instrumented.InstrumentedLinkedBlockingQueueRunnableRegistry
import mingazov.kotlinview.instrumented.InstrumentedRunnableTaskRegistry
import org.springframework.stereotype.Service
import java.util.concurrent.atomic.AtomicLong

@Service
class LinkedBlockingQueueRunnableService(
    private val registry: InstrumentedLinkedBlockingQueueRunnableRegistry,
    private val taskRegistry: InstrumentedRunnableTaskRegistry,
) {

    private val takerIds = AtomicLong()

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
        val thread = Thread({ queue.take() }, "taker-${takerIds.incrementAndGet()}")
        thread.isDaemon = true // поток, ждущий на пустой очереди, не должен мешать остановке приложения
        thread.start()
        return thread.name
    }
}