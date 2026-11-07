package mingazov.kotlinview.service

import mingazov.kotlinview.instrumented.InstrumentedRunnableTaskRegistry
import mingazov.kotlinview.instrumented.InstrumentedSynchronousQueueRunnable
import mingazov.kotlinview.instrumented.InstrumentedSynchronousQueueRunnableRegistry
import org.springframework.stereotype.Service
import java.util.concurrent.atomic.AtomicLong

@Service
class SynchronousQueueRunnableService(
    private val registry: InstrumentedSynchronousQueueRunnableRegistry,
    private val taskRegistry: InstrumentedRunnableTaskRegistry,
) {

    private val takerIds = AtomicLong()
    private val putterIds = AtomicLong()

    fun create(): InstrumentedSynchronousQueueRunnable = registry.create()
    fun get(queueId: Long): InstrumentedSynchronousQueueRunnable = registry.get(queueId)
    fun remove(queueId: Long) = registry.remove(queueId)
    fun all() = registry.all()

    /** Неблокирующий: true — задачу забрал ждущий в take, false — никто не ждал. */
    fun offer(queueId: Long, taskId: Long): Boolean =
        registry.get(queueId).offer(taskRegistry.get(taskId))

    /**
     * put() блокирующий: запускаем в новом потоке и сразу возвращаем его имя. Когда задачу заберут — METHOD_OUT put.
     * Известная утечка, как у take: если удалить очередь, пока поток ждёт в put(), он так и останется висеть.
     */
    fun put(queueId: Long, taskId: Long): String {
        val queue = registry.get(queueId)
        val task = taskRegistry.get(taskId)
        return startDaemon("putter-${putterIds.incrementAndGet()}") { queue.put(task) }
    }

    /** take() блокирующий: в новом потоке, как у LinkedBlockingQueue. Взятый taskId — в событии METHOD_OUT take. */
    fun take(queueId: Long): String {
        val queue = registry.get(queueId)
        return startDaemon("taker-${takerIds.incrementAndGet()}") { queue.take() }
    }

    // Поток, ждущий в очереди, не должен мешать остановке приложения
    private fun startDaemon(name: String, body: () -> Unit): String {
        val thread = Thread(body, name)
        thread.isDaemon = true
        thread.start()
        return thread.name
    }
}