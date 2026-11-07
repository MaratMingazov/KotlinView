package mingazov.kotlinview.instrumented.executor

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.MethodIn
import mingazov.kotlinview.event.MethodOut
import mingazov.kotlinview.event.MethodOutFailed
import mingazov.kotlinview.event.ObjectCreated
import mingazov.kotlinview.event.ObjectRemoved
import mingazov.kotlinview.event.ObjectType
import mingazov.kotlinview.instrumented.Instrumented
import java.util.concurrent.ThreadFactory
import java.util.concurrent.atomic.AtomicInteger

/**
 * Каждый созданный поток — отдельный объект THREAD (objectId = threadId()).
 * Жизнь потока = его run: METHOD_IN — стартовал, METHOD_OUT — вышел, затем OBJECT_REMOVED — больше событий не будет.
 */
class InstrumentedThreadFactory (
    override val id: Long,
    private val sink: EventSink,
) : ThreadFactory, Instrumented {

    private val counter = AtomicInteger()

    // thread в событиях — кто попросил поток: обычно поток, вызвавший execute,
    // а при замене упавшего воркера — сам умирающий воркер (processWorkerExit)
    // TODO: поток, который пул создал, но не запустил (shutdown во время addWorker), останется у клиента без OBJECT_REMOVED
    override fun newThread(r: Runnable): Thread {
        val args = emptyMap<String, Any?>()
        sink.emit(MethodIn(ObjectType.THREAD_FACTORY, id, threadName(), "newThread", args, state()))
        try {
            // Имя уникально на весь сервер: клиент склеивает воркера с задачами и очередью по имени потока
            val newThreadName = "factory-$id-worker-${counter.incrementAndGet()}"
            val thread = Thread({ runInstrumented(r) }, newThreadName)
            sink.emit(ObjectCreated(ObjectType.THREAD, thread.threadId(), threadName(), threadState(newThreadName)))
            sink.emit(MethodOut(ObjectType.THREAD_FACTORY, id, threadName(), "newThread", args, newThreadName, state()))
            return thread
        } catch (e: Exception) {
            sink.emit(MethodOutFailed(ObjectType.THREAD_FACTORY, id, threadName(), "newThread", args, e.toString(), state()))
            throw e
        }
    }

    private fun runInstrumented(r: Runnable) {
        val me = Thread.currentThread()
        val args = emptyMap<String, Any?>()
        val state = threadState(me.name)
        sink.emit(MethodIn(ObjectType.THREAD, me.threadId(), me.name, "run", args, state))
        try {
            r.run() // для пула это главный цикл воркера
            sink.emit(MethodOut(ObjectType.THREAD, me.threadId(), me.name, "run", args, null, state))
        } catch (e: Throwable) {
            // Throwable, а не Exception: поток убивает и Error. Пробрасываем — поведение потока не меняем
            sink.emit(MethodOutFailed(ObjectType.THREAD, me.threadId(), me.name, "run", args, e.toString(), state))
            throw e
        } finally {
            sink.emit(ObjectRemoved(ObjectType.THREAD, me.threadId(), me.name))
        }
    }

    /** Состояние фабрики: сколько потоков она создала. */
    override fun state(): Map<String, Any?> = mapOf("createdCount" to counter.get())

    /** Состояние потока неизменяемо: имя и чья фабрика. */
    private fun threadState(name: String): Map<String, Any?> = mapOf("name" to name, "threadFactoryId" to id)

    private fun threadName() = Thread.currentThread().name
}