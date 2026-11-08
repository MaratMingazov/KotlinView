package mingazov.kotlinview.instrumented.concurrent.locks

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.MethodIn
import mingazov.kotlinview.event.MethodOut
import mingazov.kotlinview.event.MethodOutFailed
import mingazov.kotlinview.event.ObjectType
import mingazov.kotlinview.instrumented.Instrumented
import mingazov.kotlinview.instrumented.executor.InstrumentedRunnableTask
import java.util.concurrent.atomic.AtomicInteger

/**
 * Задача, обёрнутая в семафор: в run одновременно не больше permits потоков, остальные ждут в acquire.
 * Паттерн «ограничить параллельность» (bulkhead). Сама задача замков не имеет — её run могут выполнять
 * несколько потоков сразу, семафор лишь ограничивает, сколько.
 *
 * Составной объект, как пул: в state только ссылки на части (semaphoreId, taskId), у частей свои события.
 * Собственные METHOD_IN / METHOD_OUT run — для единообразия: почти всё видно и по событиям частей
 * (acquire → task.run → release одного потока), так что клиент может их не учитывать.
 *
 * Части доступны и напрямую (/api/semaphore, /api/tasks): лишний release на семафоре впустит в задачу
 * ещё один поток. Семафор от неправильного использования не защищает — и это видно.
 */
class InstrumentedSemaphoreRunnableTask(
    override val id: Long,
    private val sink: EventSink,
    private val semaphore: InstrumentedSemaphore,
    private val task: InstrumentedRunnableTask,
) : Runnable, Instrumented {

    // Чьи части — фасаду, чтобы удалить их вместе с объектом
    val semaphoreId: Long get() = semaphore.id
    val taskId: Long get() = task.id

    // Сколько потоков внутри run, включая ждущих в acquire. Клиенту не нужен (видно по IN / OUT) — нужен фасаду:
    // удалять объект, пока кто-то внутри, нельзя
    private val active = AtomicInteger()
    fun activeCount(): Int = active.get()

    override fun run() {
        val args = emptyMap<String, Any?>()
        active.incrementAndGet()
        sink.emit(MethodIn(TYPE, id, threadName(), "run", args, state()))
        try {
            // acquire — вне try / finally: если поток прервали, пока он ждал, разрешение не взято и отдавать нечего.
            // Внутри try прерванный поток всё равно сделал бы release — и «напечатал» бы лишнее разрешение
            semaphore.acquire()
            try {
                task.run()
            } finally {
                // Даже если задача упала: иначе разрешение утекло бы навсегда
                semaphore.release()
            }
            sink.emit(MethodOut(TYPE, id, threadName(), "run", args, null, state()))
        } catch (e: Exception) {
            // InterruptedException — прервали в acquire или внутри задачи
            sink.emit(MethodOutFailed(TYPE, id, threadName(), "run", args, e.toString(), state()))
            throw e
        } finally {
            active.decrementAndGet()
        }
    }

    /** Состояние неизменяемо — только ссылки на части. Поэтому замок на события, как у семафора, не нужен. */
    override fun state(): Map<String, Any?> = mapOf("semaphoreId" to semaphore.id, "taskId" to task.id)

    private fun threadName() = Thread.currentThread().name

    private companion object {
        val TYPE = ObjectType.SEMAPHORE_RUNNABLE_TASK
    }
}