package mingazov.kotlinview.instrumented.concurrent.locks

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ObjectType
import mingazov.kotlinview.instrumented.Instrumented
import mingazov.kotlinview.instrumented.MethodEvents
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.AbstractQueuedSynchronizer

/**
 * AQS сам по себе: очередь ждущих потоков, парковка, прерывания и таймауты. Смысла у state нет — его задают хуки
 * наследника (try*). Здесь смысл минимальный, лишь бы AQS было что показать: acquire прибавляет arg к state,
 * release вычитает, а лимит — единственная причина ждать. Без отказа в хуке очередь не понадобилась бы никогда.
 *
 * Оба режима над одним state, в одной очереди (режим — тип узла). release и releaseShared будят одинаково — одного,
 * первого в очереди; разница только в том, какой хук они зовут. Каскад — от проснувшихся: shared, захватив, будит
 * следующего, если тот тоже shared, — и так до exclusive-узла или того, кому не хватило места (он снова уснёт).
 * Exclusive здесь ничего не исключает: хук смотрит только на limit. Владельца нет, нижней границы нет: release может вызвать кто угодно,
 * и state уйдёт в минус — как у Semaphore. arg тоже не проверяем: с отрицательным acquire уменьшает state —
 * AQS смысла не задаёт.
 *
 * Композиция, а не наследование: публичные методы AQS final, а protected-хуки и setState наружу торчать не должны.
 * Поэтому Sync приватный, а здесь — те же публичные методы, что у AQS, с теми же именами.
 */
class InstrumentedAQS(
    override val id: Long,
    sink: EventSink,
    private val limit: Int,
) : Instrumented {

    init {
        // При limit < 0 любой acquire с arg > 0 ждал бы вечно
        require(limit >= 0) { "limit must be >= 0, got $limit" }
    }

    /** События вызовов. Снимок state и отправка — под одним замком: acquire и release идут параллельно. */
    private val events = MethodEvents(TYPE, id, sink, ::state, lock = Any())

    private val sync = Sync()

    // ---- exclusive ----

    // Блокирующий: ждёт в очереди, пока state + arg не влезет в limit. Прерывания игнорирует (флаг ставится обратно)
    fun acquire(arg: Int) = events.call("acquire", mapOf("arg" to arg)) { sync.acquire(arg) }

    // То же, но прерывание — InterruptedException (METHOD_OUT_FAILED)
    fun acquireInterruptibly(arg: Int) = events.call("acquireInterruptibly", mapOf("arg" to arg)) {
        sync.acquireInterruptibly(arg)
    }

    // Ждёт не дольше timeoutMs, false — не дождался
    fun tryAcquireNanos(arg: Int, timeoutMs: Long) =
        events.call("tryAcquireNanos", mapOf("arg" to arg, "timeoutMs" to timeoutMs)) {
            sync.tryAcquireNanos(arg, TimeUnit.MILLISECONDS.toNanos(timeoutMs))
        }

    // Неблокирующий: вычесть arg и разбудить одного первого в очереди. true всегда — так решает наш tryRelease
    fun release(arg: Int) = events.call("release", mapOf("arg" to arg)) { sync.release(arg) }

    // ---- shared ----

    fun acquireShared(arg: Int) = events.call("acquireShared", mapOf("arg" to arg)) { sync.acquireShared(arg) }

    fun acquireSharedInterruptibly(arg: Int) = events.call("acquireSharedInterruptibly", mapOf("arg" to arg)) {
        sync.acquireSharedInterruptibly(arg)
    }

    fun tryAcquireSharedNanos(arg: Int, timeoutMs: Long) =
        events.call("tryAcquireSharedNanos", mapOf("arg" to arg, "timeoutMs" to timeoutMs)) {
            sync.tryAcquireSharedNanos(arg, TimeUnit.MILLISECONDS.toNanos(timeoutMs))
        }

    // Неблокирующий: вычесть arg и, как release, разбудить одного первого в очереди. Каскад идёт не отсюда,
    // а от проснувшихся shared
    fun releaseShared(arg: Int) = events.call("releaseShared", mapOf("arg" to arg)) { sync.releaseShared(arg) }

    /**
     * Состояние для событий. state — точно (volatile). queue — одна очередь, head первым, у каждого потока режим узла:
     * снимок best-effort, как у InstrumentedSemaphore: AQS обходит её без замка, и в METHOD_IN acquire поток в очередь
     * ещё не встал.
     */
    override fun state(): Map<String, Any?> {
        // Режим узла AQS наружу не отдаёт — только отдельным обходом. Сначала очередь, потом shared: вставший между
        // обходами попадёт лишь в shared-множество и ничего не испортит (в обратном порядке новый shared вышел бы
        // exclusive). Расхождение остаётся у ушедшего между обходами shared: в этом снимке он — exclusive
        // (клиент знает режим потока и по его задаче)
        val queued = sync.queuedThreads
        val shared = sync.sharedQueuedThreads.toSet()
        return mapOf(
            "state" to sync.currentState(),
            "limit" to limit,
            "hasContended" to sync.hasContended(),
            // AQS отдаёт от tail к head — разворачиваем: первый в очереди — первый в списке
            "queue" to queued.reversed().map { mapOf("thread" to it.name, "shared" to (it in shared)) },
        )
    }

    /**
     * Хуки: AQS зовёт их сам — изнутри наших acquire / release, поэтому их события вложены в события публичного
     * метода того же потока. tryAcquire приходит несколько раз за один acquire: при входе, ещё раз перед тем,
     * как встать в очередь и уснуть, и после каждого пробуждения. Так видно, что поток проснулся внутри AQS,
     * хотя сам park событий не шлёт. Единственное «нет» — state + arg > limit.
     * inner — чтобы видеть events и limit внешнего класса.
     */
    private inner class Sync : AbstractQueuedSynchronizer() {

        fun currentState(): Int = state

        override fun tryAcquire(arg: Int): Boolean = hook("tryAcquire", arg) { tryIncrease(arg) }

        // true — будить первого в очереди
        override fun tryRelease(arg: Int): Boolean = hook("tryRelease", arg) { decrease(arg); true }

        // >= 0 — взяли; если поток проснулся первым в очереди, AQS разбудит следующего shared. < 0 — в очередь.
        // 0 и > 0 («места больше нет» / «ещё есть») различает javadoc, но JDK 25 смотрит только на >= 0 —
        // limit - state отдаём, чтобы в событии хука было видно, сколько места осталось (оценка: state читаем после CAS)
        override fun tryAcquireShared(arg: Int): Int =
            hook("tryAcquireShared", arg) { if (tryIncrease(arg)) limit - state else -1 }

        override fun tryReleaseShared(arg: Int): Boolean = hook("tryReleaseShared", arg) { decrease(arg); true }

        private fun <R> hook(method: String, arg: Int, block: () -> R): R =
            events.call(method, mapOf("arg" to arg), block)

        // Цикл с CAS: state меняют параллельно, простое state += arg потеряло бы обновления
        private fun tryIncrease(arg: Int): Boolean {
            while (true) {
                val current = state
                if (current + arg > limit) return false
                if (compareAndSetState(current, current + arg)) return true
            }
        }

        private fun decrease(arg: Int) {
            while (true) {
                val current = state
                if (compareAndSetState(current, current - arg)) return
            }
        }
    }

    private companion object {
        val TYPE = ObjectType.AQS
    }
}