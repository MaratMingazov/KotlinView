package mingazov.kotlinview.service.concurrent

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/**
 * Потоки фасада: daemon-поток prefix-N на каждый запуск; держим его по имени, пока он внутри body.
 * ownerId — чей поток (id объекта): interrupt / unpark приходят по REST именем и находят только свои потоки.
 * Не бин, а поле фасада: префикс у каждого свой (latch-waiter, aqs-worker, …)
 */
class WorkerThreads(private val prefix: String) {

    private val ids = AtomicLong()

    private class Worker(val thread: Thread, val ownerId: Long)

    private val workers = ConcurrentHashMap<String, Worker>()

    /**
     * Новый daemon-поток: имя уникально на весь сервер (клиент склеивает события по нему), HTTP отвечает им сразу.
     * Запись — до start, убирает её сам поток в finally (body вернулся, бросил или поток прервали): короткий body
     * не успеет закончиться раньше записи. Не запустился (start бросил) — убираем сами, иначе запись осталась бы навсегда
     */
    fun start(ownerId: Long, body: () -> Unit): String {
        val name = "$prefix-${ids.incrementAndGet()}"
        val thread = Thread({
            try {
                body()
            } finally {
                workers.remove(name)
            }
        }, name)
        thread.isDaemon = true                  // ждущий не должен мешать остановке приложения
        workers[name] = Worker(thread, ownerId) // до start: interrupt сразу после ответа найдёт поток
        try {
            thread.start()
        } catch (e: Throwable) {
            workers.remove(name)
            throw e
        }
        return name
    }

    /** Свой поток по имени; null — уже вышел или чужой. Текст ошибки (404) — у фасада: он знает, что поток там делает */
    fun threadOf(ownerId: Long, name: String): Thread? = workers[name]?.takeIf { it.ownerId == ownerId }?.thread

    /** Есть ли у объекта потоки внутри — для remove (409) */
    fun anyOf(ownerId: Long): Boolean = workers.values.any { it.ownerId == ownerId }
}
