package mingazov.kotlinview.instrumented.concurrent.locks.registry

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ObjectType
import mingazov.kotlinview.instrumented.IdGenerator
import mingazov.kotlinview.instrumented.InstrumentedRegistry
import mingazov.kotlinview.instrumented.concurrent.locks.InstrumentedSemaphore
import mingazov.kotlinview.instrumented.concurrent.locks.InstrumentedSemaphoreRunnableTask
import mingazov.kotlinview.instrumented.executor.InstrumentedRunnableTask

class InstrumentedSemaphoreRunnableTaskRegistry(sink: EventSink, idGenerator: IdGenerator = IdGenerator()) :
    InstrumentedRegistry<InstrumentedSemaphoreRunnableTask>(ObjectType.SEMAPHORE_RUNNABLE_TASK, sink, idGenerator) {

    // Части приходят готовыми, как у пула: кто их создаёт и удаляет — решает фасад в server
    fun create(semaphore: InstrumentedSemaphore, task: InstrumentedRunnableTask): InstrumentedSemaphoreRunnableTask =
        register { id -> InstrumentedSemaphoreRunnableTask(id, sink, semaphore, task) }
}