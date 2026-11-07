package mingazov.kotlinview.instrumented.collection.registry

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ObjectType
import mingazov.kotlinview.instrumented.IdGenerator
import mingazov.kotlinview.instrumented.InstrumentedRegistry
import mingazov.kotlinview.instrumented.collection.InstrumentedSynchronousQueueRunnable

class InstrumentedSynchronousQueueRunnableRegistry(sink: EventSink, idGenerator: IdGenerator = IdGenerator()) :
    InstrumentedRegistry<InstrumentedSynchronousQueueRunnable>(ObjectType.SYNCHRONOUS_QUEUE_RUNNABLE, sink, idGenerator) {

    fun create(): InstrumentedSynchronousQueueRunnable =
        register { id -> InstrumentedSynchronousQueueRunnable(id, sink) }
}