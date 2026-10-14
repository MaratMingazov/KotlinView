package mingazov.kotlinview.service

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.PoolRemoved
import mingazov.kotlinview.instrumented.InstrumentedRunnableBlockingQueue
import mingazov.kotlinview.instrumented.InstrumentedRunnableTask
import mingazov.kotlinview.instrumented.InstrumentedThreadFactory
import mingazov.kotlinview.instrumented.InstrumentedThreadPoolExecutor
import org.springframework.stereotype.Service
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong


@Service
class InstrumentedThreadPoolExecutorService(
    private val sink: EventSink,
) {

    private val pools = ConcurrentHashMap<Long, InstrumentedThreadPoolExecutor>()
    private val poolIds = AtomicLong()

    fun create(
        corePoolSize: Int,
        maximumPoolSize: Int,
        keepAliveMs: Long,
        queue: InstrumentedRunnableBlockingQueue,
        threadFactory: InstrumentedThreadFactory,
    ): InstrumentedThreadPoolExecutor {
        val poolId = poolIds.incrementAndGet()
        val threadPoolExecutor = InstrumentedThreadPoolExecutor(poolId, sink, corePoolSize, maximumPoolSize, keepAliveMs, queue, threadFactory)
        pools[poolId] = threadPoolExecutor

        return threadPoolExecutor
    }

    fun execute(poolId: Long, task: InstrumentedRunnableTask) {
        val pool = getPool(poolId)
        pool.execute(task)
    }

    fun shutdown(poolId: Long) = getPool(poolId).shutdown()

    fun shutdownNow(poolId: Long): List<Long> =
        getPool(poolId).shutdownNow().mapNotNull { (it as? InstrumentedRunnableTask)?.id }

    fun remove(poolId: Long) {
        val pool = getPool(poolId)
        if (!pool.isTerminated) throw RuntimeException("Pool $poolId must be terminated before removal")
        if (!pools.remove(poolId, pool)) throw RuntimeException("Pool $poolId not found")
        sink.emit(PoolRemoved(poolId, Thread.currentThread().name))
    }

    private fun getPool(poolId: Long) = pools[poolId] ?: throw RuntimeException("Pool $poolId not found")

}