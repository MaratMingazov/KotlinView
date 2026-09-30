package mingazov.kotlinview.instrumented

import mingazov.kotlinview.event.EventSink
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.TimeUnit

class ThreadPoolPlayground {
}

fun main() {
    println("${Thread.currentThread().name} - MAIN started")
    val sink = EventSink { event -> println(event) }

    val queue = InstrumentedBlockingQueue<Runnable>("LinkedBlockingQueue", LinkedBlockingQueue(2), sink, 1000)
    val factory = InstrumentedThreadFactory("ThreadFactory", sink, 1000)

    val threadPoolExecutor = InstrumentedThreadPoolExecutor("ThreadPoolExecutor", sink, 1, 1, 1000, queue, factory)


    for (id in 1L..5L) {
        val task = InstrumentedRunnable(id, durationMs = 1000)
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