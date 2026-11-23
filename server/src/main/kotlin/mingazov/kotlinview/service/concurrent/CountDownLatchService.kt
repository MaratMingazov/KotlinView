package mingazov.kotlinview.service.concurrent

import mingazov.kotlinview.instrumented.concurrent.InstrumentedCountDownLatch
import mingazov.kotlinview.instrumented.concurrent.registry.InstrumentedCountDownLatchRegistry
import org.springframework.stereotype.Service
import java.util.concurrent.TimeUnit

/**
 * Фасад CountDownLatch без задачи: жизнь потока — один вызов await. Поток latch-waiter-N ждёт, пока count не станет 0
 * (или не выйдет таймаут), и заканчивается — после await ему делать нечего. countDown — в HTTP-потоке («судья»).
 * Потоки — WorkerThreads: держит их по имени, пока поток внутри await, — interrupt приходит по REST именем,
 * а удалять latch, пока кто-то ждёт, нельзя.
 */
@Service
class CountDownLatchService(
    private val registry: InstrumentedCountDownLatchRegistry,
) {

    // Владелец потока — id latch, на котором он ждёт
    private val threads = WorkerThreads("latch-waiter")

    // count < 0 запрещает сам CountDownLatch (IllegalArgumentException — контроллер: 400)
    fun create(count: Int): InstrumentedCountDownLatch = registry.create(count)

    /**
     * Новый daemon-поток latch-waiter-N: await() или, если timeoutMs задан, await(timeoutMs) — и всё.
     * HTTP отвечает сразу его именем. Имя уникально на весь сервер: клиент склеивает события по имени потока
     */
    fun await(id: Long, timeoutMs: Long?): String {
        require(timeoutMs == null || timeoutMs >= 0) { "timeoutMs must be >= 0" }
        val latch = registry.get(id)
        return threads.start(id) {
            try {
                if (timeoutMs == null) latch.await() else latch.await(timeoutMs, TimeUnit.MILLISECONDS)
            } catch (_: InterruptedException) {
                // Прервали, пока ждал: в событиях уже METHOD_OUT_FAILED, потоку остаётся закончиться
            }
        }
    }

    // Судья: в HTTP-потоке, сразу возвращается. При count = 0 ничего не делает — так в JDK
    fun countDown(id: Long) = registry.get(id).countDown()

    /**
     * interrupt из HTTP-потока: ждущий уйдёт из await с InterruptedException.
     * Потока нет (уже вышел из await) или он ждёт не на этом latch — NoSuchElementException (контроллер: 404)
     */
    fun interrupt(id: Long, threadName: String) {
        registry.get(id)
        val thread = threads.threadOf(id, threadName)
            ?: throw NoSuchElementException("Thread $threadName is not waiting on CountDownLatch $id")
        thread.interrupt()
    }

    // Кто-то ждёт — его поток остался бы с удалённым latch
    fun remove(id: Long) {
        registry.get(id)
        check(!threads.anyOf(id)) { "CountDownLatch $id has waiting threads" }
        registry.remove(id)
    }
}
