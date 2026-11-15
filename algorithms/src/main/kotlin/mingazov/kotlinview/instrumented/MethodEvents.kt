package mingazov.kotlinview.instrumented

import mingazov.kotlinview.event.Event
import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.MethodIn
import mingazov.kotlinview.event.MethodOut
import mingazov.kotlinview.event.MethodOutFailed
import mingazov.kotlinview.event.ObjectType

/**
 * События вызовов одного объекта: METHOD_IN → вызов → METHOD_OUT (result; Unit — null) или METHOD_OUT_FAILED
 * с тем же исключением. Состав, а не базовый класс: Instrumented-классы уже наследуются от JDK (Semaphore,
 * ThreadPoolExecutor), второго родителя-класса в Kotlin не бывает.
 * lock — снимок state и отправка под одним замком: если методы идут параллельно, более старый снимок не уйдёт
 * последним (как у InstrumentedLinkedBlockingQueueRunnable); null — без замка. Сам вызов (block) — вне замка:
 * ждущий в нём поток никого не держит.
 * Пока на нём InstrumentedSemaphore и InstrumentedLockSupport; остальные шлют события вручную — переводить по одному.
 */
class MethodEvents(
    private val type: ObjectType,
    private val id: Long,
    private val sink: EventSink,
    private val state: () -> Any?,
    private val lock: Any? = null,
) {
    fun <R> call(method: String, args: Map<String, Any?>, block: () -> R): R {
        val thread = Thread.currentThread().name
        emit {state -> MethodIn(type, id, thread, method, args, state) }
        try {
            val result = block()
            val reported = if (result == Unit) null else result
            emit {state -> MethodOut(type, id, thread, method, args, reported, state) }
            return result
        } catch (e: Exception) {
            emit {state -> MethodOutFailed(type, id, thread, method, args, e.toString(), state) }
            throw e
        }
    }

    private fun emit(event: (state: Any?) -> Event) {
        if (lock == null) sink.emit(event(state())) else synchronized(lock) { sink.emit(event(state())) }
    }
}