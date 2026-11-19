package mingazov.kotlinview.instrumented.concurrent.locks.registry

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ObjectType
import mingazov.kotlinview.instrumented.IdGenerator
import mingazov.kotlinview.instrumented.InstrumentedRegistry
import mingazov.kotlinview.instrumented.concurrent.locks.AQSAcquireMode
import mingazov.kotlinview.instrumented.concurrent.locks.InstrumentedAQS
import mingazov.kotlinview.instrumented.concurrent.locks.InstrumentedAQSRunnableTask
import mingazov.kotlinview.instrumented.executor.InstrumentedRunnableTask

class InstrumentedAQSRunnableTaskRegistry(sink: EventSink, idGenerator: IdGenerator = IdGenerator()) :
    InstrumentedRegistry<InstrumentedAQSRunnableTask>(ObjectType.AQS_RUNNABLE_TASK, sink, idGenerator) {

    // Части приходят готовыми, как у задачи под семафором: кто их создаёт и удаляет, а также проверки arg / timeoutMs —
    // забота фасада в server
    fun create(
        aqs: InstrumentedAQS,
        task: InstrumentedRunnableTask,
        shared: Boolean,
        mode: AQSAcquireMode,
        arg: Int,
        timeoutMs: Long,
    ): InstrumentedAQSRunnableTask =
        register { id -> InstrumentedAQSRunnableTask(id, sink, aqs, task, shared, mode, arg, timeoutMs) }
}