package mingazov.kotlinview.instrumented.collection

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ObjectType
import mingazov.kotlinview.instrumented.InstrumentedRegistry

class InstrumentedArrayListIntRegistry(sink: EventSink) :
    InstrumentedRegistry<InstrumentedArrayListInt>(ObjectType.ARRAY_LIST_INT, sink) {

    fun create(): InstrumentedArrayListInt = register { id -> InstrumentedArrayListInt(id, sink) }
}
