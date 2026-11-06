package mingazov.kotlinview.instrumented

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ObjectType

class InstrumentedLinkedBlockingQueueRunnableRegistry(sink: EventSink) :
    InstrumentedRegistry<InstrumentedLinkedBlockingQueueRunnable>(ObjectType.LINKED_BLOCKING_QUEUE_RUNNABLE, sink) {

    fun create(capacity: Int): InstrumentedLinkedBlockingQueueRunnable =
        register { id -> InstrumentedLinkedBlockingQueueRunnable(id, capacity, sink) }
}
