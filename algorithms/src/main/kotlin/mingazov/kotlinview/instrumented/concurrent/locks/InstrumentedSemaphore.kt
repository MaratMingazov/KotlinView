package mingazov.kotlinview.instrumented.concurrent.locks

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ObjectType
import mingazov.kotlinview.instrumented.Instrumented
import mingazov.kotlinview.instrumented.MethodEvents
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit

/**
 * Semaphore: счётчик разрешений и очередь ждущих потоков (внутри — AQS: state + очередь Node).
 * Владельца у разрешения нет: release может вызвать любой поток, даже тот, что ничего не брал, —
 * тогда availablePermits станет больше initialPermits. В этом главное отличие от мьютекса.
 *
 * Наследование, а не делегирование: интерфейса у Semaphore нет, а очередь ждущих видна только
 * через protected getQueuedThreads() — из обёртки до неё не дотянуться.
 * Методы, которые здесь не переопределены (acquireUninterruptibly, drainPermits, reducePermits), идут без событий.
 *
 * Перегрузки без permits зовут наши версии с permits = 1: в событиях это один и тот же метод.
 * Двойных событий нет: в JDK каждая перегрузка сразу идёт в sync, а не в соседнюю перегрузку.
 */
class InstrumentedSemaphore(
    override val id: Long,
    sink: EventSink,
    private val initialPermits: Int, // геттера у Semaphore нет; JDK разрешает и отрицательное — сначала нужны release
    fair: Boolean,
) : Semaphore(initialPermits, fair), Instrumented {

    /**
     * События вызовов. Снимок state и отправка — под одним замком (lock): acquire и release идут параллельно, и без
     * замка более старый снимок мог бы уйти последним. Сами операции семафора — вне замка: ждущий в acquire никого
     * не держит. METHOD_OUT_FAILED: InterruptedException — прервали, пока ждал; IllegalArgumentException — permits < 0
     */
    private val events = MethodEvents(TYPE, id, sink, ::state, lock = Any())

    // Блокирующий: ждёт в очереди AQS, пока не наберётся permits разрешений
    override fun acquire() = acquire(1)
    override fun acquire(permits: Int) = events.call("acquire", mapOf("permits" to permits)) {
        super.acquire(permits)
    }

    // Неблокирующий: true — забрал, false — не хватило. Обгоняет очередь даже при fair = true (так в Javadoc)
    override fun tryAcquire() = tryAcquire(1)
    override fun tryAcquire(permits: Int) = events.call("tryAcquire", mapOf("permits" to permits)) {
        super.tryAcquire(permits)
    }

    // Ждёт не дольше timeout, false — не дождался. В отличие от tryAcquire() без таймаута, честность соблюдает
    override fun tryAcquire(timeout: Long, unit: TimeUnit) = tryAcquire(1, timeout, unit)
    override fun tryAcquire(permits: Int, timeout: Long, unit: TimeUnit) =
        events.call("tryAcquire", mapOf("permits" to permits, "timeoutMs" to unit.toMillis(timeout))) {
            super.tryAcquire(permits, timeout, unit)
        }

    // Неблокирующий: вернуть разрешения и разбудить ждущих. Брал ли их этот поток — семафор не проверяет
    override fun release() = release(1)
    override fun release(permits: Int) = events.call("release", mapOf("permits" to permits)) {
        super.release(permits)
    }

    /**
     * Состояние для событий. queuedThreads — снимок best-effort: AQS обходит очередь без замка,
     * поток мог уже проснуться, но ещё не уйти из списка. И в METHOD_IN acquire поток в очередь ещё не встал,
     * а уснув — событий не шлёт. Поэтому кто ждёт, точно видно по парам METHOD_IN / METHOD_OUT,
     * а queuedThreads — подсказка о порядке в AQS, обновляется при чужих событиях.
     */
    override fun state(): Map<String, Any?> = mapOf(
        "initialPermits" to initialPermits,
        "availablePermits" to availablePermits(),
        "fair" to isFair,
        // AQS отдаёт от tail к head — разворачиваем: первый в очереди — первый в списке
        "queuedThreads" to queuedThreads.map { it.name }.reversed(),
    )

    private companion object {
        val TYPE = ObjectType.SEMAPHORE
    }
}