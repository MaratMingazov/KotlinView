package mingazov.kotlinview.service

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.PoolCreated
import mingazov.kotlinview.event.PoolRemoved
import mingazov.kotlinview.instrumented.InstrumentedBlockingQueue
import mingazov.kotlinview.instrumented.InstrumentedRunnable
import mingazov.kotlinview.instrumented.InstrumentedThreadFactory
import mingazov.kotlinview.instrumented.InstrumentedThreadPoolExecutor
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.web.bind.annotation.ResponseStatus
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.BlockingQueue
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.SynchronousQueue
import java.util.concurrent.ThreadFactory
import java.util.concurrent.atomic.AtomicLong

enum class QueueType { LINKED, ARRAY, SYNCHRONOUS }

@ResponseStatus(HttpStatus.NOT_FOUND)
class PoolNotFoundException(poolId: String) : RuntimeException("Pool $poolId not found")

@ResponseStatus(HttpStatus.CONFLICT)
class InvalidPoolStateException(message: String) : RuntimeException(message)

@ResponseStatus(HttpStatus.BAD_REQUEST)
class InvalidRequestException(message: String) : RuntimeException(message)

@Service
class ThreadPoolService(private val sink: EventSink) {

    private val pools = ConcurrentHashMap<String, InstrumentedThreadPoolExecutor>()
    private val poolIds = AtomicLong()
    private val taskIds = AtomicLong()

    fun create(
        corePoolSize: Int,
        maximumPoolSize: Int,
        keepAliveMs: Long,
        queueType: QueueType,
        queueCapacity: Int?,
    ): String {
        val sleepMillis = 2000L
        val poolId = "pool-${poolIds.incrementAndGet()}"
        val queue: BlockingQueue<Runnable> = when (queueType) {
            QueueType.LINKED ->
                if (queueCapacity == null) LinkedBlockingQueue()
                else InstrumentedBlockingQueue("$poolId/main", LinkedBlockingQueue(queueCapacity), sink, sleepMillis)
            QueueType.ARRAY -> ArrayBlockingQueue(queueCapacity ?: throw InvalidRequestException("ARRAY queue requires queueCapacity"))
            QueueType.SYNCHRONOUS -> SynchronousQueue()
        }
        val threadFactory = InstrumentedThreadFactory(poolId, sink)
        pools[poolId] = InstrumentedThreadPoolExecutor(poolId, sink, corePoolSize, maximumPoolSize, keepAliveMs, queue, threadFactory, sleepMillis)
        sink.emit(PoolCreated(poolId, corePoolSize, maximumPoolSize, keepAliveMs, queueCapacity = queue.remainingCapacity(), queueId = (queue as? InstrumentedBlockingQueue<*>)?.queueId, thread = Thread.currentThread().name))
        Thread.sleep(sleepMillis)
        return poolId
    }

    fun execute(poolId: String, durationMs: Long) {
        val task = InstrumentedRunnable(taskIds.incrementAndGet(), durationMs)
        val pool = getPool(poolId)
        pool.execute(task)
    }

    fun shutdown(poolId: String) = getPool(poolId).shutdown()

    fun shutdownNow(poolId: String): List<Long> =
        getPool(poolId).shutdownNow().mapNotNull { (it as? InstrumentedRunnable)?.id }

    fun remove(poolId: String) {
        val pool = getPool(poolId)
        if (!pool.isTerminated) throw InvalidPoolStateException("Pool $poolId must be terminated before removal")
        if (!pools.remove(poolId, pool)) throw PoolNotFoundException(poolId)
        sink.emit(PoolRemoved(poolId, Thread.currentThread().name))
    }

    private fun getPool(poolId: String) = pools[poolId] ?: throw PoolNotFoundException(poolId)


}