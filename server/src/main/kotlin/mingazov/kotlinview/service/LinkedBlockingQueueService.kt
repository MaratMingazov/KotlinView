package mingazov.kotlinview.service

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.instrumented.InstrumentedRunnableBlockingQueue
import mingazov.kotlinview.instrumented.InstrumentedRunnableTask
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.web.bind.annotation.ResponseStatus
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

@ResponseStatus(HttpStatus.NOT_FOUND)
class QueueNotFoundException(queueId: String) : RuntimeException("Queue $queueId not found")

@Service
class LinkedBlockingQueueService(private val sink: EventSink) {

    private val queues = ConcurrentHashMap<String, InstrumentedRunnableBlockingQueue>()
    private val queueIds = AtomicLong()
    private val taskIds = AtomicLong()


    fun create(capacity: Int): String {
        val queueId = "queue-${queueIds.incrementAndGet()}"
        queues[queueId] = InstrumentedRunnableBlockingQueue(queueId, capacity, sink, sleepMillis = 1000)
        return queueId
    }

    fun remove(queueId: String) { queues.remove(queueId) ?: throw QueueNotFoundException(queueId) }

    fun offer(queueId: String): Boolean = getQueue(queueId).offer(InstrumentedRunnableTask(taskIds.incrementAndGet(), durationMs = 1000, sink))

    private fun getQueue(queueId: String) = queues[queueId] ?: throw QueueNotFoundException(queueId)
}