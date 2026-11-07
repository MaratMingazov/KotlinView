package mingazov.kotlinview.instrumented

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ObjectType

class InstrumentedSynchronousQueueRunnableRegistry(sink: EventSink, idGenerator: IdGenerator = IdGenerator()) :
    InstrumentedRegistry<InstrumentedSynchronousQueueRunnable>(ObjectType.SYNCHRONOUS_QUEUE_RUNNABLE, sink, idGenerator) {

    fun create(): InstrumentedSynchronousQueueRunnable =
        register { id -> InstrumentedSynchronousQueueRunnable(id, sink) }
}