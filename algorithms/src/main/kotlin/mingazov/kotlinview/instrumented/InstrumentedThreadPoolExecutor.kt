package mingazov.kotlinview.instrumented

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.PoolCreated
import mingazov.kotlinview.event.PoolShutdown
import mingazov.kotlinview.event.PoolShutdownNow
import mingazov.kotlinview.event.PoolTerminated
import mingazov.kotlinview.event.TaskCompleted
import mingazov.kotlinview.event.TaskFailed
import mingazov.kotlinview.event.TaskStarted
import mingazov.kotlinview.event.TasksDrained
import java.util.concurrent.BlockingQueue
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
    val poolId: String,
    corePoolSize: Int,
    maximumPoolSize: Int,
    keepAliveMs: Long,
    workQueue: BlockingQueue<Runnable>,
    private val sink: EventSink,
) : ThreadPoolExecutor(
    corePoolSize,
    maximumPoolSize,
    keepAliveMs, TimeUnit.MILLISECONDS,
    InstrumentedBlockingQueue("$poolId/main", workQueue, sink),
    InstrumentedThreadFactory(poolId, sink),
) {

    init {
        sink.emit(
            PoolCreated(
                poolId, corePoolSize, maximumPoolSize, keepAliveMs,
                queueType = workQueue.javaClass.simpleName,
                queueCapacity = workQueue.remainingCapacity(),
                thread = Thread.currentThread().name,
            )
        )
    }

    override fun beforeExecute(t: Thread, r: Runnable) {
        sink.emit(TaskStarted(poolId, taskId(r), t.name))
    }

    override fun afterExecute(r: Runnable, t: Throwable?) {
        val thread = Thread.currentThread().name
        if (t == null) sink.emit(TaskCompleted(poolId, taskId(r), thread))
        else sink.emit(TaskFailed(poolId, taskId(r), thread, t.toString()))
    }

    override fun shutdown() {
        sink.emit(PoolShutdown(poolId, Thread.currentThread().name))
        super.shutdown()
    }

    override fun shutdownNow(): MutableList<Runnable> {
        sink.emit(PoolShutdownNow(poolId, Thread.currentThread().name))
        val drained = super.shutdownNow()
        sink.emit(TasksDrained(poolId, drained.mapNotNull { taskId(it) }, Thread.currentThread().name))
        return drained
    }

    override fun terminated() {
        sink.emit(PoolTerminated(poolId, Thread.currentThread().name))
    }

    private fun taskId(r: Runnable): Long? = (r as? InstrumentedRunnable)?.id
}