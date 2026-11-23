package mingazov.kotlinview.service.collection

import mingazov.kotlinview.instrumented.collection.InstrumentedSynchronousQueueRunnable
import mingazov.kotlinview.instrumented.collection.registry.InstrumentedSynchronousQueueRunnableRegistry
import mingazov.kotlinview.instrumented.executor.registry.InstrumentedRunnableTaskRegistry
import mingazov.kotlinview.service.concurrent.WorkerThreads
import org.springframework.stereotype.Service
import java.util.concurrent.TimeUnit

@Service
class SynchronousQueueRunnableService(
    private val registry: InstrumentedSynchronousQueueRunnableRegistry,
    private val taskRegistry: InstrumentedRunnableTaskRegistry,
) {

    // Потоки блокирующих вызовов; владелец — id очереди. Префикс sync- — имена уникальны на весь сервер: у другой
    // очереди тоже есть taker / putter / poller, а клиент склеивает события по имени потока
    private val takers = WorkerThreads("sync-taker")
    private val putters = WorkerThreads("sync-putter")
    private val pollers = WorkerThreads("sync-poller")

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
        return putters.start(queueId) { queue.put(task) }
    }

    /** take() блокирующий: в новом потоке, как у LinkedBlockingQueue. Взятый taskId — в событии METHOD_OUT take. */
    fun take(queueId: Long): String {
        val queue = registry.get(queueId)
        return takers.start(queueId) { queue.take() }
    }

    /**
     * poll(timeout): как take, но ждёт не дольше timeoutMs (так ждут задачу воркеры CachedThreadPool — keepAlive).
     * В новом потоке; METHOD_OUT poll — taskId или null, если никто не отдал. Утечки, как у take, нет: поток сам выйдет по таймауту
     */
    fun poll(queueId: Long, timeoutMs: Long): String {
        val queue = registry.get(queueId)
        return pollers.start(queueId) { queue.poll(timeoutMs, TimeUnit.MILLISECONDS) }
    }
}