package mingazov.kotlinview.instrumented

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ObjectType

class InstrumentedThreadFactoryRegistry(sink: EventSink, idGenerator: IdGenerator = IdGenerator()) :
    InstrumentedRegistry<InstrumentedThreadFactory>(ObjectType.THREAD_FACTORY, sink, idGenerator) {

    fun create(): InstrumentedThreadFactory = register { id -> InstrumentedThreadFactory(id, sink) }
}
