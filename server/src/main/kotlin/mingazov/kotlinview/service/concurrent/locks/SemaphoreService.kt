package mingazov.kotlinview.service.concurrent.locks

import mingazov.kotlinview.instrumented.concurrent.locks.InstrumentedSemaphore
import mingazov.kotlinview.instrumented.concurrent.locks.registry.InstrumentedSemaphoreRegistry
import org.springframework.stereotype.Service
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/**
 * Блокирующие acquire / tryAcquire с таймаутом — в новом daemon-потоке, как take у очередей: HTTP отвечает сразу
 * именем потока, а получил ли он разрешение — видно по METHOD_OUT.
 * Неблокирующие tryAcquire / release — прямо в HTTP-потоке. Для release это и есть демонстрация:
 * разрешение отдаёт совсем не тот поток, что его брал, — у семафора нет владельца.
 */
@Service
class SemaphoreService(
    private val registry: InstrumentedSemaphoreRegistry,
) {

    private val acquirerIds = AtomicLong()

    fun create(permits: Int, fair: Boolean): InstrumentedSemaphore = registry.create(permits, fair)
    fun get(semaphoreId: Long): InstrumentedSemaphore = registry.get(semaphoreId)
    fun all() = registry.all()

    /** Поток acquirer-N ждёт разрешения; после acquire он завершится, а разрешение останется взятым — владельца нет. */
    fun acquire(semaphoreId: Long, permits: Int): String {
        val semaphore = registry.get(semaphoreId)
        // Проверяем здесь, а не в потоке: иначе ошибка ушла бы только в METHOD_OUT_FAILED, а HTTP ответил бы 202
        require(permits >= 0) { "permits must be >= 0" }
        return startDaemon { semaphore.acquire(permits) }
    }

    /** Неблокирующий: true — забрал, false — не хватило. Обгоняет очередь даже у честного семафора. */
    fun tryAcquire(semaphoreId: Long, permits: Int): Boolean = registry.get(semaphoreId).tryAcquire(permits)

    /** Как acquire, но ждёт не дольше timeoutMs: результат (true / false) — в METHOD_OUT. */
    fun tryAcquireTimeout(semaphoreId: Long, permits: Int, timeoutMs: Long): String {
        val semaphore = registry.get(semaphoreId)
        require(permits >= 0) { "permits must be >= 0" }
        return startDaemon { semaphore.tryAcquire(permits, timeoutMs, TimeUnit.MILLISECONDS) }
    }

    fun release(semaphoreId: Long, permits: Int) = registry.get(semaphoreId).release(permits)

    /** Удалить, пока кто-то ждёт, нельзя: его поток так и остался бы висеть в acquire. */
    fun remove(semaphoreId: Long) {
        val semaphore = registry.get(semaphoreId)
        check(!semaphore.hasQueuedThreads()) { "Semaphore $semaphoreId has waiting threads" }
        registry.remove(semaphoreId)
    }

    // Ждущий поток не должен мешать остановке приложения
    private fun startDaemon(body: () -> Unit): String {
        val thread = Thread(body, "acquirer-${acquirerIds.incrementAndGet()}")
        thread.isDaemon = true
        thread.start()
        return thread.name
    }
}