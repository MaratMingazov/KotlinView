package mingazov.kotlinview.instrumented

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ThreadCreated
import mingazov.kotlinview.event.ThreadTerminated
import mingazov.kotlinview.event.ThreadStarted
import java.util.concurrent.ThreadFactory
import java.util.concurrent.atomic.AtomicInteger

class InstrumentedThreadFactory (
    private val namePrefix: String, // например "pool-1"
    private val sink: EventSink,
) : ThreadFactory {

    private val counter = AtomicInteger()

    override fun newThread(r: Runnable): Thread {
        val name = "$namePrefix/worker-${counter.incrementAndGet()}"

        val thread = Thread({
            sink.emit(ThreadStarted(name))
            var error: Throwable? = null
            try {
                r.run() // главный цикл воркера
            } catch (e: Throwable) {
                error = e
                throw e // пробрасываем: поведение потока не меняем
            } finally {
                sink.emit(ThreadTerminated(name, error?.toString()))
            }
        }, name)

        sink.emit(ThreadCreated(name, Thread.currentThread().name))
        return thread
    }
}