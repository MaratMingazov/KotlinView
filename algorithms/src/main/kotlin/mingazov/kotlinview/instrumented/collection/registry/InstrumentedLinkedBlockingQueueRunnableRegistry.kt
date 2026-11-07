package mingazov.kotlinview.instrumented

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ObjectType

class InstrumentedLinkedBlockingQueueRunnableRegistry(sink: EventSink, idGenerator: IdGenerator = IdGenerator()) :
    InstrumentedRegistry<InstrumentedLinkedBlockingQueueRunnable>(ObjectType.LINKED_BLOCKING_QUEUE_RUNNABLE, sink, idGenerator) {

    fun create(capacity: Int): InstrumentedLinkedBlockingQueueRunnable =
        register { id -> InstrumentedLinkedBlockingQueueRunnable(id, capacity, sink) }
}
