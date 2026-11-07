package mingazov.kotlinview.instrumented.concurrent.locks.registry

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ObjectType
import mingazov.kotlinview.instrumented.IdGenerator
import mingazov.kotlinview.instrumented.InstrumentedRegistry
import mingazov.kotlinview.instrumented.concurrent.locks.InstrumentedSemaphore

class InstrumentedSemaphoreRegistry(sink: EventSink, idGenerator: IdGenerator = IdGenerator()) :
    InstrumentedRegistry<InstrumentedSemaphore>(ObjectType.SEMAPHORE, sink, idGenerator) {

    // permits < 0 разрешено, как в JDK: семафор стартует «в долг», первые acquire ждут release
    fun create(permits: Int, fair: Boolean): InstrumentedSemaphore =
        register { id -> InstrumentedSemaphore(id, sink, permits, fair) }
}