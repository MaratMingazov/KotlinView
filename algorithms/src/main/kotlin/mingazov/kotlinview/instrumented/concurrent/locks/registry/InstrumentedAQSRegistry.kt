package mingazov.kotlinview.instrumented.concurrent.locks.registry

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ObjectType
import mingazov.kotlinview.instrumented.IdGenerator
import mingazov.kotlinview.instrumented.InstrumentedRegistry
import mingazov.kotlinview.instrumented.concurrent.locks.InstrumentedAQS

class InstrumentedAQSRegistry(sink: EventSink, idGenerator: IdGenerator = IdGenerator()) :
    InstrumentedRegistry<InstrumentedAQS>(ObjectType.AQS, sink, idGenerator) {

    // limit < 0 запрещён в самом InstrumentedAQS: исключение летит из фабрики, до регистрации и OBJECT_CREATED
    fun create(limit: Int): InstrumentedAQS = register { id -> InstrumentedAQS(id, sink, limit) }
}