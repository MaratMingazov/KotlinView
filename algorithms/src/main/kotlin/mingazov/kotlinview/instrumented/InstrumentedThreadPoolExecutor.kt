package mingazov.kotlinview.instrumented

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.PoolTerminated
import mingazov.kotlinview.event.TaskCompleted
import mingazov.kotlinview.event.TaskFailed
import mingazov.kotlinview.event.TaskStarted
import java.util.concurrent.BlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

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

    override fun beforeExecute(t: Thread, r: Runnable) {
        sink.emit(TaskStarted(poolId, taskId(r), t.name))
    }

    override fun afterExecute(r: Runnable, t: Throwable?) {
        val thread = Thread.currentThread().name
        if (t == null) sink.emit(TaskCompleted(poolId, taskId(r), thread))
        else sink.emit(TaskFailed(poolId, taskId(r), thread, t.toString()))
    }

    override fun terminated() {
        sink.emit(PoolTerminated(poolId, Thread.currentThread().name))
    }

    private fun taskId(r: Runnable): Long? = (r as? InstrumentedRunnable)?.id
}