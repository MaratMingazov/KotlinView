package mingazov.kotlinview.instrumented.collection.registry

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ObjectType
import mingazov.kotlinview.instrumented.IdGenerator
import mingazov.kotlinview.instrumented.InstrumentedRegistry
import mingazov.kotlinview.instrumented.collection.InstrumentedArrayListInt

class InstrumentedArrayListIntRegistry(sink: EventSink, idGenerator: IdGenerator = IdGenerator()) :
    InstrumentedRegistry<InstrumentedArrayListInt>(ObjectType.ARRAY_LIST_INT, sink, idGenerator) {

    fun create(): InstrumentedArrayListInt = register { id -> InstrumentedArrayListInt(id, sink) }
}
