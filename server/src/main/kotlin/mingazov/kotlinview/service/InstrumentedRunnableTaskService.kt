package mingazov.kotlinview.service

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.instrumented.InstrumentedRunnableTask
import org.springframework.stereotype.Service
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

@Service
class InstrumentedRunnableTaskService(private val sink: EventSink) {

    private val tasks = ConcurrentHashMap<Long, InstrumentedRunnableTask>()
    private val taskIds = AtomicLong()


    fun create(durationMs: Long): InstrumentedRunnableTask {
        val taskId = taskIds.incrementAndGet()
        val task = InstrumentedRunnableTask(taskId, durationMs, sink)
        tasks[taskId] = task
        return task
    }

    fun remove(taskId: Long) { tasks.remove(taskId) ?: throw RuntimeException("Task $taskId not found") }

    fun get(taskId: Long) = tasks[taskId] ?: throw RuntimeException("Task $taskId not found")
}