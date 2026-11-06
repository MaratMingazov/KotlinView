package mingazov.kotlinview.instrumented

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ObjectType

class InstrumentedThreadFactoryRegistry(sink: EventSink) :
    InstrumentedRegistry<InstrumentedThreadFactory>(ObjectType.THREAD_FACTORY, sink) {

    fun create(): InstrumentedThreadFactory = register { id -> InstrumentedThreadFactory(id, sink) }
}
