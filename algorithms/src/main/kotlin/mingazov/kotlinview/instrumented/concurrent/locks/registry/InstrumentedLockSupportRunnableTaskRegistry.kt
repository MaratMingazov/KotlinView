package mingazov.kotlinview.instrumented.concurrent.locks.registry

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ObjectType
import mingazov.kotlinview.instrumented.IdGenerator
import mingazov.kotlinview.instrumented.InstrumentedRegistry
import mingazov.kotlinview.instrumented.concurrent.locks.InstrumentedLockSupport
import mingazov.kotlinview.instrumented.concurrent.locks.InstrumentedLockSupportRunnableTask
import mingazov.kotlinview.instrumented.concurrent.locks.ParkMode
import mingazov.kotlinview.instrumented.executor.InstrumentedRunnableTask

class InstrumentedLockSupportRunnableTaskRegistry(sink: EventSink, idGenerator: IdGenerator = IdGenerator()) :
    InstrumentedRegistry<InstrumentedLockSupportRunnableTask>(ObjectType.LOCK_SUPPORT_RUNNABLE_TASK, sink, idGenerator) {

    // Части приходят готовыми, как у задачи под семафором: кто их создаёт и удаляет — решает фасад в server
    fun create(
        lockSupport: InstrumentedLockSupport,
        task: InstrumentedRunnableTask,
        mode: ParkMode,
        timeoutMs: Long,
    ): InstrumentedLockSupportRunnableTask =
        register { id -> InstrumentedLockSupportRunnableTask(id, sink, lockSupport, task, mode, timeoutMs) }
}