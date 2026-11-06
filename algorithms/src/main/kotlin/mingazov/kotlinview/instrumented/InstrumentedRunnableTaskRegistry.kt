package mingazov.kotlinview.instrumented

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ObjectType

class InstrumentedRunnableTaskRegistry(sink: EventSink) :
    InstrumentedRegistry<InstrumentedRunnableTask>(ObjectType.RUNNABLE_TASK, sink) {

    fun create(durationMs: Long): InstrumentedRunnableTask = register { id -> InstrumentedRunnableTask(id, durationMs, sink) }
}
