package mingazov.kotlinview.instrumented.collection

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ObjectType
import mingazov.kotlinview.instrumented.InstrumentedRegistry

class InstrumentedLinkedListIntRegistry(sink: EventSink) :
    InstrumentedRegistry<InstrumentedLinkedListInt>(ObjectType.LINKED_LIST_INT, sink) {

    fun create(): InstrumentedLinkedListInt = register { id -> InstrumentedLinkedListInt(id, sink) }
}
