package mingazov.kotlinview.instrumented.concurrent.registry

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ObjectType
import mingazov.kotlinview.instrumented.IdGenerator
import mingazov.kotlinview.instrumented.InstrumentedRegistry
import mingazov.kotlinview.instrumented.concurrent.InstrumentedCountDownLatch

class InstrumentedCountDownLatchRegistry(sink: EventSink, idGenerator: IdGenerator = IdGenerator()) :
    InstrumentedRegistry<InstrumentedCountDownLatch>(ObjectType.COUNT_DOWN_LATCH, sink, idGenerator) {

    // count = 0 — ворота открыты сразу; count < 0 запрещает сам CountDownLatch: исключение летит из фабрики,
    // до регистрации и OBJECT_CREATED
    fun create(count: Int): InstrumentedCountDownLatch = register { id -> InstrumentedCountDownLatch(id, sink, count) }
}
