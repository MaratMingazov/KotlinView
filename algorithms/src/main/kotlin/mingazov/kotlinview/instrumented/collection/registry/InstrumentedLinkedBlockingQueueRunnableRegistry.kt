package mingazov.kotlinview.instrumented.collection.registry

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ObjectType
import mingazov.kotlinview.instrumented.IdGenerator
import mingazov.kotlinview.instrumented.InstrumentedRegistry
import mingazov.kotlinview.instrumented.collection.InstrumentedLinkedBlockingQueueRunnable

class InstrumentedLinkedBlockingQueueRunnableRegistry(sink: EventSink, idGenerator: IdGenerator = IdGenerator()) :
    InstrumentedRegistry<InstrumentedLinkedBlockingQueueRunnable>(ObjectType.LINKED_BLOCKING_QUEUE_RUNNABLE, sink, idGenerator) {

    fun create(capacity: Int): InstrumentedLinkedBlockingQueueRunnable =
        register { id -> InstrumentedLinkedBlockingQueueRunnable(id, capacity, sink) }
}
