package mingazov.kotlinview.instrumented

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ObjectType
import java.util.concurrent.BlockingQueue

class InstrumentedThreadPoolExecutorRegistry(sink: EventSink, idGenerator: IdGenerator = IdGenerator()) :
    InstrumentedRegistry<InstrumentedThreadPoolExecutor<*>>(ObjectType.THREAD_POOL_EXECUTOR, sink, idGenerator) {

    // Части приходят готовыми: кто их создаёт и удаляет — решает фасад в server
    // Очередь — любая наша: LinkedBlockingQueue или SynchronousQueue
    fun <Q> create(
        corePoolSize: Int,
        maximumPoolSize: Int,
        keepAliveMs: Long,
        queue: Q,
        threadFactory: InstrumentedThreadFactory,
    ): InstrumentedThreadPoolExecutor<*> where Q : BlockingQueue<Runnable>, Q : Instrumented = register { id ->
        InstrumentedThreadPoolExecutor(id, sink, corePoolSize, maximumPoolSize, keepAliveMs, queue, threadFactory)
    }
}
