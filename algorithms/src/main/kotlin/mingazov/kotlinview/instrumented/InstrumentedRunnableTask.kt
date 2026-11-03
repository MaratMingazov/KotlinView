package mingazov.kotlinview.instrumented

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.MethodIn
import mingazov.kotlinview.event.MethodOut
import mingazov.kotlinview.event.MethodOutFailed
import mingazov.kotlinview.event.MethodProgress
import mingazov.kotlinview.event.ObjectType

/**
 * Задача, которая «работает» durationMs: спит отрезками по секунде и после каждой сообщает прогресс.
 * Замков намеренно нет: несколько потоков могут одновременно выполнять run() одной и той же задачи.
 * Общего изменяемого состояния тоже нет — прогресс в локальных переменных, у каждого потока свой.
 */
class InstrumentedRunnableTask(
    val id: Long,
    private val durationMs: Long,
    private val sink: EventSink,
    ) : Runnable {

    override fun run() {
        val args = emptyMap<String, Any?>()
        sink.emit(MethodIn(ObjectType.RUNNABLE_TASK, id, threadName(), "run", args, state()))
        try {
            var elapsedMs = 0L
            while (elapsedMs < durationMs) {
                val stepMs = minOf(TICK_MS, durationMs - elapsedMs) // последний отрезок — остаток
                Thread.sleep(stepMs)
                elapsedMs += stepMs
                // Последний отрезок не сообщаем: конец покажет METHOD_OUT
                if (elapsedMs < durationMs) {
                    sink.emit(MethodProgress(ObjectType.RUNNABLE_TASK, id, threadName(), "run", progress(elapsedMs), state()))
                }
            }
            sink.emit(MethodOut(ObjectType.RUNNABLE_TASK, id, threadName(), "run", args, null, state()))
        } catch (e: Exception) {
            // Например, InterruptedException от shutdownNow() пула
            sink.emit(MethodOutFailed(ObjectType.RUNNABLE_TASK, id, threadName(), "run", args, e.toString(), state()))
            throw e
        }
    }

    private fun progress(elapsedMs: Long) =
        mapOf("elapsedMs" to elapsedMs, "remainingMs" to durationMs - elapsedMs, "durationMs" to durationMs)

    /** Состояние задачи для событий. Неизменяемое: durationMs — val. */
    fun state(): Map<String, Any?> = mapOf("durationMs" to durationMs)

    private fun threadName() = Thread.currentThread().name

    override fun toString() = "$id"

    companion object {
        private const val TICK_MS = 1000L

        fun taskIdOf(runnable: Runnable): Long {
            require(runnable is InstrumentedRunnableTask) { "Expected InstrumentedRunnableTask, got ${runnable::class.qualifiedName}" }
            return runnable.id
        }
    }
}