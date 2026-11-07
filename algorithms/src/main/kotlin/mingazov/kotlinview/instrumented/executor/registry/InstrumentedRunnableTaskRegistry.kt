package mingazov.kotlinview.instrumented.executor.registry

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ObjectType
import mingazov.kotlinview.instrumented.IdGenerator
import mingazov.kotlinview.instrumented.InstrumentedRegistry
import mingazov.kotlinview.instrumented.executor.InstrumentedRunnableTask

class InstrumentedRunnableTaskRegistry(sink: EventSink, idGenerator: IdGenerator = IdGenerator()) :
    InstrumentedRegistry<InstrumentedRunnableTask>(ObjectType.RUNNABLE_TASK, sink, idGenerator) {

    fun create(durationMs: Long): InstrumentedRunnableTask = register { id -> InstrumentedRunnableTask(id, durationMs, sink) }
}
