package mingazov.kotlinview.instrumented.concurrent.locks

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ObjectType
import mingazov.kotlinview.instrumented.Instrumented
import mingazov.kotlinview.instrumented.MethodEvents
import mingazov.kotlinview.instrumented.executor.InstrumentedRunnableTask
import java.util.concurrent.atomic.AtomicInteger

/**
 * Задача, после которой поток паркуется: run = task.run() («работа» durationMs), потом park или parkNanos(timeoutMs).
 * Окно «unpark до park» — время работы задачи: unpark в это время сохранит разрешение, и park вернётся сразу.
 *
 * Составной объект, как InstrumentedSemaphoreRunnableTask: в state ссылки на части (lockSupportId, taskId)
 * и способ парковки, у частей свои события. Одну задачу выполняют сразу несколько потоков — у каждого свой run.
 * Собственные METHOD_IN / METHOD_OUT run — вся жизнь потока одним вызовом (результат — null).
 */
class InstrumentedLockSupportRunnableTask(
    override val id: Long,
    sink: EventSink,
    private val lockSupport: InstrumentedLockSupport,
    private val task: InstrumentedRunnableTask,
    private val mode: ParkMode,
    private val timeoutMs: Long, // только у PARK_NANOS
) : Runnable, Instrumented {

    // Чьи части — фасаду, чтобы удалить их вместе с объектом
    val lockSupportId: Long get() = lockSupport.id
    val taskId: Long get() = task.id

    // Сколько потоков внутри run (работают или спят в park). Нужен фасаду: удалять объект, пока кто-то внутри, нельзя
    private val active = AtomicInteger()
    fun activeCount(): Int = active.get()

    // Состояние неизменяемо — замок на события не нужен
    private val events = MethodEvents(TYPE, id, sink, ::state)

    override fun run() {
        active.incrementAndGet()
        try {
            events.call("run", emptyMap()) {
                task.run()
                when (mode) {
                    ParkMode.PARK -> lockSupport.park()
                    ParkMode.PARK_NANOS -> lockSupport.parkNanos(timeoutMs)
                }
            }
        } finally {
            active.decrementAndGet()
        }
    }

    override fun state(): Map<String, Any?> = mapOf(
        "lockSupportId" to lockSupport.id,
        "taskId" to task.id,
        "mode" to mode.name,
        "timeoutMs" to timeoutMs,
    )

    private companion object {
        val TYPE = ObjectType.LOCK_SUPPORT_RUNNABLE_TASK
    }
}

/** Как поток паркуется после задачи: PARK — спит, пока не дадут разрешение; PARK_NANOS — не дольше timeoutMs. */
enum class ParkMode { PARK, PARK_NANOS }