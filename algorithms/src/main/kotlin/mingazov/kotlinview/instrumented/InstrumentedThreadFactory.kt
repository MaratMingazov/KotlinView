package mingazov.kotlinview.instrumented

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ThreadCreated
import mingazov.kotlinview.event.ThreadTerminated
import mingazov.kotlinview.event.ThreadStarted
import java.util.concurrent.ThreadFactory
import java.util.concurrent.atomic.AtomicInteger

class InstrumentedThreadFactory (
    private val namePrefix: String, // id фабрики, например "pool-1/threadFactory"
    private val sink: EventSink,
    private val sleepMillis: Long = 0,
) : ThreadFactory {

    private val counter = AtomicInteger()

    override fun newThread(r: Runnable): Thread {
        val name = "$namePrefix/worker-${counter.incrementAndGet()}"

        val thread = Thread({
            sink.emit(ThreadStarted(namePrefix, name))
            Thread.sleep(sleepMillis)
            var error: Throwable? = null
            try {
                r.run() // главный цикл воркера
            } catch (e: Throwable) {
                error = e
                throw e // пробрасываем: поведение потока не меняем
            } finally {
                sink.emit(ThreadTerminated(namePrefix, name, error?.toString()))
                Thread.sleep(sleepMillis)
            }
        }, name)

        sink.emit(ThreadCreated(namePrefix, name, Thread.currentThread().name))
        Thread.sleep(sleepMillis)
        return thread
    }
}