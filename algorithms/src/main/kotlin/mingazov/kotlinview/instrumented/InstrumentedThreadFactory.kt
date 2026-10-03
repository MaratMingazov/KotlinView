package mingazov.kotlinview.instrumented

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ThreadFactoryThreadCreated
import mingazov.kotlinview.event.ThreadFactoryThreadStarted
import mingazov.kotlinview.event.ThreadFactoryThreadTerminated
import java.util.concurrent.ThreadFactory
import java.util.concurrent.atomic.AtomicInteger

class InstrumentedThreadFactory (
    private val id: String,
    private val sink: EventSink,
    private val sleepMillis: Long = 0,
) : ThreadFactory {

    private val counter = AtomicInteger()

    override fun newThread(r: Runnable): Thread {
        val newThreadName = "worker-${counter.incrementAndGet()}"

        val thread = Thread({
            sink.emit(ThreadFactoryThreadStarted(id, newThreadName))
            Thread.sleep(sleepMillis)
            var error: Throwable? = null
            try {
                r.run() // главный цикл воркера
            } catch (e: Throwable) {
                error = e
                throw e // пробрасываем: поведение потока не меняем
            } finally {
                sink.emit(ThreadFactoryThreadTerminated(id, newThreadName, error?.toString()))
                Thread.sleep(sleepMillis)
            }
        }, newThreadName)

        sink.emit(ThreadFactoryThreadCreated(id, newThreadName, Thread.currentThread().name))
        Thread.sleep(sleepMillis)
        return thread
    }
}