package mingazov.kotlinview.instrumented

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ObjectCreated
import mingazov.kotlinview.event.ObjectRemoved
import mingazov.kotlinview.event.ObjectType
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

class InstrumentedRunnableTaskRegistry(private val sink: EventSink) {

    private val tasks = ConcurrentHashMap<Long, InstrumentedRunnableTask>()
    private val ids = AtomicLong()

    fun create(durationMs: Long): InstrumentedRunnableTask {
        val task = InstrumentedRunnableTask(ids.incrementAndGet(), durationMs, sink)
        tasks[task.id] = task
        sink.emit(ObjectCreated(ObjectType.RUNNABLE_TASK, task.id, Thread.currentThread().name, task.state()))
        return task
    }

    fun get(id: Long): InstrumentedRunnableTask =
        tasks[id] ?: throw RunnableTaskNotFoundException(id)

    fun remove(id: Long) {
        tasks.remove(id) ?: throw RunnableTaskNotFoundException(id)
        sink.emit(ObjectRemoved(ObjectType.RUNNABLE_TASK, id, Thread.currentThread().name))
    }

    fun all(): Collection<InstrumentedRunnableTask> = tasks.values
}

class RunnableTaskNotFoundException(id: Long) : NoSuchElementException("Task $id not found")