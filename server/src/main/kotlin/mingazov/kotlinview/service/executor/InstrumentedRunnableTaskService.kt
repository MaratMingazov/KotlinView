package mingazov.kotlinview.service.executor

import mingazov.kotlinview.instrumented.executor.InstrumentedRunnableTask
import mingazov.kotlinview.instrumented.executor.registry.InstrumentedRunnableTaskRegistry
import org.springframework.stereotype.Service
import java.util.concurrent.atomic.AtomicLong

@Service
class InstrumentedRunnableTaskService(private val registry: InstrumentedRunnableTaskRegistry) {

    private val runnerIds = AtomicLong()

    fun create(durationMs: Long): InstrumentedRunnableTask = registry.create(durationMs)
    fun get(taskId: Long): InstrumentedRunnableTask = registry.get(taskId)
    fun remove(taskId: Long) = registry.remove(taskId)
    fun all() = registry.all()

    /**
     * Запускает run() задачи в новом потоке и сразу возвращает его имя.
     * Каждый вызов — новый поток: два вызова подряд — два потока внутри одной задачи.
     */
    fun run(taskId: Long): String {
        val task = registry.get(taskId)
        val thread = Thread(task, "runner-${runnerIds.incrementAndGet()}")
        thread.start()
        return thread.name
    }
}