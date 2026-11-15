package mingazov.kotlinview.instrumented.concurrent.locks.registry

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ObjectType
import mingazov.kotlinview.instrumented.IdGenerator
import mingazov.kotlinview.instrumented.InstrumentedRegistry
import mingazov.kotlinview.instrumented.concurrent.locks.InstrumentedLockSupport

class InstrumentedLockSupportRegistry(sink: EventSink, idGenerator: IdGenerator = IdGenerator()) :
    InstrumentedRegistry<InstrumentedLockSupport>(ObjectType.LOCK_SUPPORT, sink, idGenerator) {

    // Параметров нет: у LockSupport нет настроек — разрешение у каждого потока одно
    fun create(): InstrumentedLockSupport = register { id -> InstrumentedLockSupport(id, sink) }
}