package mingazov.kotlinview.service

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.QueueCreated
import mingazov.kotlinview.instrumented.InstrumentedBlockingQueue
import mingazov.kotlinview.instrumented.InstrumentedRunnable
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.web.bind.annotation.ResponseStatus
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.atomic.AtomicLong

@ResponseStatus(HttpStatus.NOT_FOUND)
class QueueNotFoundException(queueId: String) : RuntimeException("Queue $queueId not found")

@Service
class LinkedBlockingQueueService(private val sink: EventSink) {

    private val queues = ConcurrentHashMap<String, InstrumentedBlockingQueue<InstrumentedRunnable>>()
    private val queueIds = AtomicLong()
    private val taskIds = AtomicLong()


    fun create(capacity: Int): String {
        val queueId = "queue-${queueIds.incrementAndGet()}"
        queues[queueId] = InstrumentedBlockingQueue(queueId, LinkedBlockingQueue(capacity), sink)
        sink.emit(QueueCreated(queueId, capacity, Thread.currentThread().name))
        return queueId
    }

    fun offer(queueId: String): Boolean = getQueue(queueId).offer(InstrumentedRunnable(taskIds.incrementAndGet(), durationMs = 1000))

    fun poll(queueId: String): InstrumentedRunnable? = getQueue(queueId).poll()

    private fun getQueue(queueId: String) = queues[queueId] ?: throw QueueNotFoundException(queueId)
}