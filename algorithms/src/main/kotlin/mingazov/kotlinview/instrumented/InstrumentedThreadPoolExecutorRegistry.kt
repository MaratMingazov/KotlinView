package mingazov.kotlinview.instrumented

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ObjectCreated
import mingazov.kotlinview.event.ObjectRemoved
import mingazov.kotlinview.event.ObjectType
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

class InstrumentedThreadPoolExecutorRegistry(private val sink: EventSink) {

    private val pools = ConcurrentHashMap<Long, InstrumentedThreadPoolExecutor>()
    private val ids = AtomicLong()

    // Части приходят готовыми: кто их создаёт и удаляет — решает фасад в server
    fun create(
        corePoolSize: Int,
        maximumPoolSize: Int,
        keepAliveMs: Long,
        queue: InstrumentedLinkedBlockingQueueRunnable,
        threadFactory: InstrumentedThreadFactory,
    ): InstrumentedThreadPoolExecutor {
        val pool = InstrumentedThreadPoolExecutor(ids.incrementAndGet(), sink, corePoolSize, maximumPoolSize, keepAliveMs, queue, threadFactory)
        pools[pool.id] = pool
        sink.emit(ObjectCreated(ObjectType.THREAD_POOL_EXECUTOR, pool.id, Thread.currentThread().name, pool.state()))
        return pool
    }

    fun get(id: Long): InstrumentedThreadPoolExecutor =
        pools[id] ?: throw ThreadPoolExecutorNotFoundException(id)

    fun remove(id: Long) {
        pools.remove(id) ?: throw ThreadPoolExecutorNotFoundException(id)
        sink.emit(ObjectRemoved(ObjectType.THREAD_POOL_EXECUTOR, id, Thread.currentThread().name))
    }

    fun all(): Collection<InstrumentedThreadPoolExecutor> = pools.values
}

class ThreadPoolExecutorNotFoundException(id: Long) : NoSuchElementException("ThreadPoolExecutor $id not found")