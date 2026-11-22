package mingazov.kotlinview.service.concurrent

import mingazov.kotlinview.instrumented.concurrent.InstrumentedCountDownLatch
import mingazov.kotlinview.instrumented.concurrent.registry.InstrumentedCountDownLatchRegistry
import org.springframework.stereotype.Service
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/**
 * Фасад CountDownLatch без задачи: жизнь потока — один вызов await. Поток latch-waiter-N ждёт, пока count не станет 0
 * (или не выйдет таймаут), и заканчивается — после await ему делать нечего. countDown — в HTTP-потоке («судья»).
 * Потоки создаёт сам (await) и держит по имени, пока поток внутри await: interrupt приходит по REST именем,
 * а удалять latch, пока кто-то ждёт, нельзя.
 */
@Service
class CountDownLatchService(
    private val registry: InstrumentedCountDownLatchRegistry,
) {

    private val waiterIds = AtomicLong()

    // Имя потока → поток и id latch, на котором он ждёт (interrupt — только своим потокам)
    private class Waiter(val thread: Thread, val latchId: Long)

    private val waiters = ConcurrentHashMap<String, Waiter>()

    // count < 0 запрещает сам CountDownLatch (IllegalArgumentException — контроллер: 400)
    fun create(count: Int): InstrumentedCountDownLatch = registry.create(count)

    /**
     * Новый daemon-поток latch-waiter-N: await() или, если timeoutMs задан, await(timeoutMs) — и всё.
     * HTTP отвечает сразу его именем. Имя уникально на весь сервер: клиент склеивает события по имени потока
     */
    fun await(id: Long, timeoutMs: Long?): String {
        require(timeoutMs == null || timeoutMs >= 0) { "timeoutMs must be >= 0" }
        val latch = registry.get(id)
        val name = "latch-waiter-${waiterIds.incrementAndGet()}"
        val thread = Thread({
            try {
                if (timeoutMs == null) latch.await() else latch.await(timeoutMs, TimeUnit.MILLISECONDS)
            } catch (_: InterruptedException) {
                // Прервали, пока ждал: в событиях уже METHOD_OUT_FAILED, потоку остаётся закончиться
            } finally {
                waiters.remove(name)
            }
        }, name)
        thread.isDaemon = true               // ждущий на latch не должен мешать остановке приложения
        waiters[name] = Waiter(thread, id)   // до start: interrupt сразу после ответа найдёт поток
        thread.start()
        return name
    }

    // Судья: в HTTP-потоке, сразу возвращается. При count = 0 ничего не делает — так в JDK
    fun countDown(id: Long) = registry.get(id).countDown()

    /**
     * interrupt из HTTP-потока: ждущий уйдёт из await с InterruptedException.
     * Потока нет (уже вышел из await) или он ждёт не на этом latch — NoSuchElementException (контроллер: 404)
     */
    fun interrupt(id: Long, threadName: String) {
        registry.get(id)
        val waiter = waiters[threadName]?.takeIf { it.latchId == id }
            ?: throw NoSuchElementException("Thread $threadName is not waiting on CountDownLatch $id")
        waiter.thread.interrupt()
    }

    // Кто-то ждёт — его поток остался бы с удалённым latch
    fun remove(id: Long) {
        registry.get(id)
        check(waiters.values.none { it.latchId == id }) { "CountDownLatch $id has waiting threads" }
        registry.remove(id)
    }
}
