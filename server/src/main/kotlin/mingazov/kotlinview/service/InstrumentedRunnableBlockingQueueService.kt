package mingazov.kotlinview.service

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.instrumented.InstrumentedRunnableBlockingQueue
import mingazov.kotlinview.instrumented.InstrumentedRunnableTask
import org.springframework.stereotype.Service
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

@Service
class InstrumentedRunnableBlockingQueueService(private val sink: EventSink) {

    private val queues = ConcurrentHashMap<Long, InstrumentedRunnableBlockingQueue>()
    private val queueIds = AtomicLong()
    private val taskIds = AtomicLong()


    fun create(capacity: Int): InstrumentedRunnableBlockingQueue {
        val queueId = queueIds.incrementAndGet()
        val queue = InstrumentedRunnableBlockingQueue(queueId, capacity, sink)
        queues[queueId] = queue
        return queue
    }

    fun remove(queueId: Long) { queues.remove(queueId) ?: throw RuntimeException("Queue $queueId not found")}

    fun offer(queueId: Long): Boolean = getQueue(queueId).offer(InstrumentedRunnableTask(taskIds.incrementAndGet(), durationMs = 1000, sink))

    private fun getQueue(queueId: Long) = queues[queueId] ?: throw RuntimeException("Queue $queueId not found")
}