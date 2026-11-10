package mingazov.kotlinview.instrumented.concurrent.locks

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.MethodIn
import mingazov.kotlinview.event.MethodOut
import mingazov.kotlinview.event.MethodOutFailed
import mingazov.kotlinview.event.ObjectType
import mingazov.kotlinview.instrumented.Instrumented
import mingazov.kotlinview.instrumented.executor.InstrumentedRunnableTask
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * Задача, обёрнутая в семафор: в run одновременно не больше permits потоков. Как поток входит — решает mode:
 * ждёт в acquire, сразу получает отказ (tryAcquire) или ждёт не дольше timeoutMs (tryAcquire с таймаутом).
 * Паттерн «ограничить параллельность» (bulkhead): с ожиданием или со сбросом лишней нагрузки. Сама задача замков
 * не имеет — её run могут выполнять несколько потоков сразу, семафор лишь ограничивает, сколько.
 *
 * Составной объект, как пул: в state ссылки на части (semaphoreId, taskId) и способ входа, у частей свои события.
 * Собственные METHOD_IN / METHOD_OUT run — для единообразия: почти всё видно и по событиям частей
 * (acquire / tryAcquire → task.run → release одного потока). Результат run — "done" или "rejected"
 * (разрешение не взяли: задача не запускалась, release не было), чтобы клиенту не выводить его из событий семафора.
 *
 * Части доступны и напрямую (/api/semaphore, /api/tasks): лишний release на семафоре впустит в задачу
 * ещё один поток. Семафор от неправильного использования не защищает — и это видно.
 */
class InstrumentedSemaphoreRunnableTask(
    override val id: Long,
    private val sink: EventSink,
    private val semaphore: InstrumentedSemaphore,
    private val task: InstrumentedRunnableTask,
    private val mode: AcquireMode,
    private val timeoutMs: Long,
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
            // Вход — вне try / finally: если разрешение не взято (отказ или поток прервали, пока ждал), отдавать нечего.
            // Внутри try такой поток всё равно сделал бы release — и «напечатал» бы лишнее разрешение
            if (!enter()) {
                sink.emit(MethodOut(TYPE, id, threadName(), "run", args, REJECTED, state()))
                return
            }
            try {
                task.run()
            } finally {
                // Даже если задача упала: иначе разрешение утекло бы навсегда
                semaphore.release()
            }
            sink.emit(MethodOut(TYPE, id, threadName(), "run", args, DONE, state()))
        } catch (e: Exception) {
            // InterruptedException — прервали в acquire / tryAcquire с таймаутом или внутри задачи
            sink.emit(MethodOutFailed(TYPE, id, threadName(), "run", args, e.toString(), state()))
            throw e
        } finally {
            active.decrementAndGet()
        }
    }

    /** Взять разрешение по mode: true — взято, false — отказ (только у tryAcquire). */
    private fun enter(): Boolean = when (mode) {
        AcquireMode.ACQUIRE -> { semaphore.acquire(); true }
        AcquireMode.TRY_ACQUIRE -> semaphore.tryAcquire()
        AcquireMode.TRY_ACQUIRE_TIMEOUT -> semaphore.tryAcquire(timeoutMs, TimeUnit.MILLISECONDS)
    }

    /** Состояние неизменяемо — ссылки на части и способ входа. Поэтому замок на события, как у семафора, не нужен. */
    override fun state(): Map<String, Any?> = mapOf(
        "semaphoreId" to semaphore.id,
        "taskId" to task.id,
        "mode" to mode.name,
        "timeoutMs" to timeoutMs,
    )

    private fun threadName() = Thread.currentThread().name

    private companion object {
        val TYPE = ObjectType.SEMAPHORE_RUNNABLE_TASK
        const val DONE = "done"
        const val REJECTED = "rejected"
    }
}

/**
 * Как поток входит в задачу под семафором.
 * ACQUIRE — ждёт, пока не освободится разрешение (блокирующий);
 * TRY_ACQUIRE — сразу отказ, если разрешений нет; обгоняет ждущих даже у честного семафора (так в Javadoc);
 * TRY_ACQUIRE_TIMEOUT — ждёт не дольше timeoutMs, потом отказ; честность соблюдает.
 */
enum class AcquireMode { ACQUIRE, TRY_ACQUIRE, TRY_ACQUIRE_TIMEOUT }
