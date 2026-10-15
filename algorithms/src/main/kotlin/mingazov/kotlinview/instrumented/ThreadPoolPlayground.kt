package mingazov.kotlinview.instrumented

import mingazov.kotlinview.event.EventSink
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.TimeUnit

class ThreadPoolPlayground {
}

fun main() {
    println("${Thread.currentThread().name} - MAIN started")
    val sink = EventSink { event -> println("${java.time.LocalTime.now()} $event") }
    val queue = InstrumentedRunnableBlockingQueue(0, 2, sink)
    val factory = InstrumentedThreadFactory(1, sink)

    val threadPoolExecutor = InstrumentedThreadPoolExecutor(1, sink, 1, 1, 1000, queue, factory, 0)


    for (id in 1L..5L) {
        val task = InstrumentedRunnableTask(id, durationMs = 1000, sink)
        try {
            threadPoolExecutor.execute(task)
        } catch (e: RejectedExecutionException) {
            println("$task REJECTED, ${e.message}")
        }
    }


    threadPoolExecutor.shutdown()
    threadPoolExecutor.awaitTermination(10, TimeUnit.SECONDS)
    Thread.sleep(5000)
    println("${Thread.currentThread().name} - MAIN completed")
}