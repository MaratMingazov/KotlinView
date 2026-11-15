package mingazov.kotlinview.instrumented.concurrent.locks

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ObjectType
import mingazov.kotlinview.instrumented.Instrumented
import mingazov.kotlinview.instrumented.MethodEvents
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.LockSupport

/**
 * LockSupport: у каждого потока одно разрешение (permit), и оно не копится — два unpark подряд дают одно.
 * park — забрать разрешение и сразу вернуться или уснуть, пока его не дадут; unpark(thread) — дать разрешение
 * потоку: спит — проснётся, не спит — его следующий park вернётся сразу. На этом построены AQS и все замки JDK.
 *
 * Обёртка, а не наследование или делегирование: LockSupport — final-класс со статическими методами. Видны только
 * вызовы через неё (наши сценарии); park внутри JDK (AQS, очереди, семафор) идёт мимо и событий не шлёт.
 *
 * Разрешения в state нет: JDK его не отдаёт, а своя копия была бы оценкой (park может вернуться и без разрешения —
 * ложное пробуждение). Разрешение видно по поведению: park, у которого оно было, возвращается сразу.
 * Формы park с blocker не нужны: что поток ждёт именно здесь, видно и так — по METHOD_IN / METHOD_OUT.
 *
 * Держим только тех, кто сейчас спит в нашем park, — как очередь AQS: проснувшийся сам убирается из списка.
 * Ссылок на чужие потоки не храним: список не растёт и не держит завершившиеся потоки.
 */
class InstrumentedLockSupport(
    override val id: Long,
    sink: EventSink,
) : Instrumented {

    /** События вызовов. Снимок state и отправка — под одним замком (lock): park и unpark идут параллельно. */
    private val events = MethodEvents(TYPE, id, sink, ::state, lock = Any())

    // Кто сейчас внутри нашего park / parkNanos
    private val parked = ConcurrentHashMap.newKeySet<String>()

    // Блокирующий: разрешение есть — забирает и сразу возвращается, нет — спит, пока не дадут (или не прервут).
    // Как в JDK, ничего не возвращает: причина выхода — только в result события METHOD_OUT (см. parking)
    fun park() = parking("park", timeoutMs = null) { LockSupport.park() }

    // То же, но спит не дольше timeoutMs
    fun parkNanos(timeoutMs: Long) = parking("parkNanos", timeoutMs) { LockSupport.parkNanos(TimeUnit.MILLISECONDS.toNanos(timeoutMs)) }

    /**
     * Неблокирующий: дать разрешение потоку thread. Как в JDK — сам поток, а не имя: найти его по имени — забота сервиса.
     * threadState в args — состояние цели в момент вызова, точно (ссылка на поток есть), а не оценка:
     * WAITING / TIMED_WAITING — спит и проснётся; NEW — ещё не запущен, разрешение может потеряться (так в Javadoc);
     * TERMINATED — вызов ни на что не влияет; иначе — работает, разрешение сохранится до его следующего park
     */
    fun unpark(thread: Thread) {
        events.call("unpark", mapOf("thread" to thread.name, "threadState" to thread.state.name)) { LockSupport.unpark(thread) }
    }

    /**
     * Общее у park и parkNanos: поток — «внутри park» уже в METHOD_IN, убирается из списка при выходе (finally).
     * timeoutMs — у parkNanos (он же в args), у park — null. Итог (result в METHOD_OUT) — почему вернулся, только то,
     * что известно точно: interrupted — стоит флаг прерывания (park при этом исключения не бросает, флаг не сбрасывает);
     * timeout — у parkNanos прошло не меньше таймаута; иначе returned — unpark, разрешение, данное раньше,
     * или ложное пробуждение (без разрешения в state их не различить)
     */
    private fun parking(method: String, timeoutMs: Long?, park: () -> Unit) {
        val me = Thread.currentThread()
        val args = if (timeoutMs == null) emptyMap() else mapOf("timeoutMs" to timeoutMs)
        parked += me.name
        events.call(method, args) {
            val start = System.nanoTime()
            try {
                park()
            } finally {
                parked -= me.name
            }
            val elapsed = System.nanoTime() - start
            when {
                me.isInterrupted -> "interrupted"
                timeoutMs != null && elapsed >= TimeUnit.MILLISECONDS.toNanos(timeoutMs) -> "timeout"
                else -> "returned"
            }
        }
    }

    /** Состояние для событий: кто сейчас внутри нашего park / parkNanos (точно, по обёртке), по имени. */
    override fun state(): Map<String, Any?> = mapOf("parked" to parked.sorted())

    private companion object {
        val TYPE = ObjectType.LOCK_SUPPORT
    }
}