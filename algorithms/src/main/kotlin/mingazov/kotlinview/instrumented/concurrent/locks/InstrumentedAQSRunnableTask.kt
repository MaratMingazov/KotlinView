package mingazov.kotlinview.instrumented.concurrent.locks

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ObjectType
import mingazov.kotlinview.instrumented.Instrumented
import mingazov.kotlinview.instrumented.MethodEvents
import mingazov.kotlinview.instrumented.executor.InstrumentedRunnableTask
import java.util.concurrent.atomic.AtomicInteger

/**
 * Задача, обёрнутая в AQS: войти (shared или exclusive, по mode, взять arg), «работать» durationMs, выйти тем же
 * режимом (acquire → release, acquireShared → releaseShared). Режим входа — это тип узла в очереди, а от него
 * зависит каскад: проснувшийся shared будит следующего shared, exclusive — никого.
 *
 * Составной объект, как InstrumentedSemaphoreRunnableTask: в state ссылки на части (aqsId, taskId) и способ входа,
 * у частей свои события. Одну задачу выполняют сразу несколько потоков — у каждого свой run.
 * Результат run — "done" или "rejected" (не дождался в TRY_ACQUIRE_NANOS: задача не запускалась, release не было).
 * METHOD_OUT_FAILED — InterruptedException в ACQUIRE_INTERRUPTIBLY / TRY_ACQUIRE_NANOS или ошибка задачи.
 */
class InstrumentedAQSRunnableTask(
    override val id: Long,
    sink: EventSink,
    private val aqs: InstrumentedAQS,
    private val task: InstrumentedRunnableTask,
    private val shared: Boolean,
    private val mode: AQSAcquireMode,
    private val arg: Int,
    private val timeoutMs: Long, // только у TRY_ACQUIRE_NANOS
) : Runnable, Instrumented {

    // Чьи части — фасаду, чтобы удалить их вместе с объектом
    val aqsId: Long get() = aqs.id
    val taskId: Long get() = task.id

    // Сколько потоков внутри run, включая ждущих. Нужен фасаду: удалять объект, пока кто-то внутри, нельзя
    private val active = AtomicInteger()
    fun activeCount(): Int = active.get()

    // Состояние неизменяемо — замок на события не нужен
    private val events = MethodEvents(TYPE, id, sink, ::state)

    override fun run() {
        active.incrementAndGet()
        try {
            events.call("run", emptyMap()) {
                // Вход — вне try / finally: не вошли (отказ или прервали, пока ждал) — отдавать нечего,
                // иначе release уменьшил бы чужой state
                if (!enter()) return@call REJECTED
                try {
                    task.run()
                } finally {
                    exit() // даже если задача упала: иначе место в limit утекло бы навсегда
                }
                DONE
            }
        } finally {
            active.decrementAndGet()
        }
    }

    /** Войти по mode и режиму: true — вошли, false — отказ (только у TRY_ACQUIRE_NANOS). */
    private fun enter(): Boolean = when (mode) {
        AQSAcquireMode.ACQUIRE -> {
            if (shared) aqs.acquireShared(arg) else aqs.acquire(arg)
            true
        }
        AQSAcquireMode.ACQUIRE_INTERRUPTIBLY -> {
            if (shared) aqs.acquireSharedInterruptibly(arg) else aqs.acquireInterruptibly(arg)
            true
        }
        AQSAcquireMode.TRY_ACQUIRE_NANOS ->
            if (shared) aqs.tryAcquireSharedNanos(arg, timeoutMs) else aqs.tryAcquireNanos(arg, timeoutMs)
    }

    private fun exit() {
        if (shared) aqs.releaseShared(arg) else aqs.release(arg)
    }

    override fun state(): Map<String, Any?> = mapOf(
        "aqsId" to aqs.id,
        "taskId" to task.id,
        "shared" to shared,
        "mode" to mode.name,
        "arg" to arg,
        "timeoutMs" to timeoutMs,
    )

    private companion object {
        val TYPE = ObjectType.AQS_RUNNABLE_TASK
        const val DONE = "done"
        const val REJECTED = "rejected"
    }
}

/**
 * Как поток входит в AQS. ACQUIRE — ждёт, прерывание игнорирует (флаг ставится обратно);
 * ACQUIRE_INTERRUPTIBLY — ждёт, прерывание — InterruptedException; TRY_ACQUIRE_NANOS — ждёт не дольше timeoutMs.
 * «Без ожидания» в публичном API AQS нет (tryAcquire — protected-хук): это TRY_ACQUIRE_NANOS с timeoutMs = 0.
 */
enum class AQSAcquireMode { ACQUIRE, ACQUIRE_INTERRUPTIBLY, TRY_ACQUIRE_NANOS }