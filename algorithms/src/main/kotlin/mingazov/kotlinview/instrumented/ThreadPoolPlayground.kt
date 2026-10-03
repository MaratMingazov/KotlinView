package mingazov.kotlinview.instrumented

import mingazov.kotlinview.event.EventSink
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.TimeUnit

class ThreadPoolPlayground {
}

fun main() {
    println("${Thread.currentThread().name} - MAIN started")
    val sleepMillis = 1000L
    val sink = EventSink { event -> println(event) }
    val queue = InstrumentedRunnableBlockingQueue("LinkedBlockingQueue", 2, sink, sleepMillis)
    val factory = InstrumentedThreadFactory("ThreadFactory", sink, sleepMillis)

    val threadPoolExecutor = InstrumentedThreadPoolExecutor("ThreadPoolExecutor", sink, 1, 1, 1000, queue, factory, 1000)


    for (id in 1L..5L) {
        val task = InstrumentedRunnableTask(id, durationMs = 1000, sink)
        try {
            threadPoolExecutor.execute(task)
        } catch (e: RejectedExecutionException) {
            println("$task REJECTED")
        }
    }


    threadPoolExecutor.shutdown()
    threadPoolExecutor.awaitTermination(10, TimeUnit.SECONDS)
    Thread.sleep(5000)
    println("${Thread.currentThread().name} - MAIN completed")
}