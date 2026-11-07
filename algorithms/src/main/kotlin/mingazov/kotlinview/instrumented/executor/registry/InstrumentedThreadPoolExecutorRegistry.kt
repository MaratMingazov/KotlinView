package mingazov.kotlinview.instrumented

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ObjectType

class InstrumentedThreadPoolExecutorRegistry(sink: EventSink, idGenerator: IdGenerator = IdGenerator()) :
    InstrumentedRegistry<InstrumentedThreadPoolExecutor>(ObjectType.THREAD_POOL_EXECUTOR, sink, idGenerator) {

    // Части приходят готовыми: кто их создаёт и удаляет — решает фасад в server
    fun create(
        corePoolSize: Int,
        maximumPoolSize: Int,
        keepAliveMs: Long,
        queue: InstrumentedLinkedBlockingQueueRunnable,
        threadFactory: InstrumentedThreadFactory,
    ): InstrumentedThreadPoolExecutor = register { id ->
        InstrumentedThreadPoolExecutor(id, sink, corePoolSize, maximumPoolSize, keepAliveMs, queue, threadFactory)
    }
}
