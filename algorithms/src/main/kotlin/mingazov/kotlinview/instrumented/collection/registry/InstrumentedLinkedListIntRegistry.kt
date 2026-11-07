package mingazov.kotlinview.instrumented.collection.registry

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ObjectType
import mingazov.kotlinview.instrumented.IdGenerator
import mingazov.kotlinview.instrumented.InstrumentedRegistry
import mingazov.kotlinview.instrumented.collection.InstrumentedLinkedListInt

class InstrumentedLinkedListIntRegistry(sink: EventSink, idGenerator: IdGenerator = IdGenerator()) :
    InstrumentedRegistry<InstrumentedLinkedListInt>(ObjectType.LINKED_LIST_INT, sink, idGenerator) {

    fun create(): InstrumentedLinkedListInt = register { id -> InstrumentedLinkedListInt(id, sink) }
}
