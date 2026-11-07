package mingazov.kotlinview.instrumented.executor.registry

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ObjectType
import mingazov.kotlinview.instrumented.IdGenerator
import mingazov.kotlinview.instrumented.InstrumentedRegistry
import mingazov.kotlinview.instrumented.executor.InstrumentedThreadFactory

class InstrumentedThreadFactoryRegistry(sink: EventSink, idGenerator: IdGenerator = IdGenerator()) :
    InstrumentedRegistry<InstrumentedThreadFactory>(ObjectType.THREAD_FACTORY, sink, idGenerator) {

    fun create(): InstrumentedThreadFactory = register { id -> InstrumentedThreadFactory(id, sink) }
}
