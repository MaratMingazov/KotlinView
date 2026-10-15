package mingazov.kotlinview.instrumented

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.PoolShutdownIn
import mingazov.kotlinview.event.PoolShutdownNow
import mingazov.kotlinview.event.PoolShutdownOut
import mingazov.kotlinview.event.PoolTerminated
import mingazov.kotlinview.event.TaskCompleted
import mingazov.kotlinview.event.TaskFailed
import mingazov.kotlinview.event.TaskStarted
import mingazov.kotlinview.event.TasksDrained
import java.util.concurrent.BlockingQueue
import java.util.concurrent.ThreadFactory
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/**
 *   Почему мы делаем через наследование, а не через композицию
 *
 *   execute → addWorker → new Worker → runWorker → getTask → beforeExecute → run → afterExecute → processWorkerExit → tryTerminate → terminated
 *             └──────────────────────── всё это внутри ThreadPoolExecutor, мимо декоратора ────────────────────────┘
 *
 */

class InstrumentedThreadPoolExecutor(
    val poolId: Long,
    private val sink: EventSink,
    corePoolSize: Int,
    maximumPoolSize: Int,
    keepAliveMs: Long,
    queue: BlockingQueue<Runnable>,
    threadFactory: ThreadFactory,
) : ThreadPoolExecutor(corePoolSize, maximumPoolSize, keepAliveMs, TimeUnit.MILLISECONDS, queue, threadFactory) {

    override fun beforeExecute(t: Thread, r: Runnable) {

        sink.emit(TaskStarted(poolId, t.name, InstrumentedRunnableTask.taskIdOf(r)))
    }

    override fun afterExecute(r: Runnable, t: Throwable?) {
        val thread = Thread.currentThread().name
        if (t == null) sink.emit(TaskCompleted(poolId, thread, InstrumentedRunnableTask.taskIdOf(r)))
        else sink.emit(TaskFailed(poolId, thread, InstrumentedRunnableTask.taskIdOf(r), t.toString()))
    }

    /**
     * Мяшкая остановка. Ждем завершения всех задач
     */
    override fun shutdown() {
        sink.emit(PoolShutdownIn(poolId, Thread.currentThread().name))
        super.shutdown()
        sink.emit(PoolShutdownOut(poolId, Thread.currentThread().name))
    }

    /**
     * Жесткая остановка. Незавершенные задачи возвращаем
     */
    override fun shutdownNow(): MutableList<Runnable> {
        val drained = super.shutdownNow()
        sink.emit(PoolShutdownNow(poolId, Thread.currentThread().name))
        sink.emit(TasksDrained(poolId, Thread.currentThread().name, drained.mapNotNull { InstrumentedRunnableTask.taskIdOf(it) }))
        return drained
    }

    override fun terminated() {
        sink.emit(PoolTerminated(poolId, Thread.currentThread().name))
    }
}