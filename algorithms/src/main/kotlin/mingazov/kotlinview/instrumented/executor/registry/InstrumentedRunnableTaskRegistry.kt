package mingazov.kotlinview.instrumented

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ObjectType

class InstrumentedRunnableTaskRegistry(sink: EventSink, idGenerator: IdGenerator = IdGenerator()) :
    InstrumentedRegistry<InstrumentedRunnableTask>(ObjectType.RUNNABLE_TASK, sink, idGenerator) {

    fun create(durationMs: Long): InstrumentedRunnableTask = register { id -> InstrumentedRunnableTask(id, durationMs, sink) }
}
