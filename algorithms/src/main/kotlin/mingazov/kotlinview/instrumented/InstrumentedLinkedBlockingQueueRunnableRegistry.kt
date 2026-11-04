package mingazov.kotlinview.instrumented

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ObjectCreated
import mingazov.kotlinview.event.ObjectRemoved
import mingazov.kotlinview.event.ObjectType
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

class InstrumentedLinkedBlockingQueueRunnableRegistry(private val sink: EventSink) {

    private val queues = ConcurrentHashMap<Long, InstrumentedLinkedBlockingQueueRunnable>()
    private val ids = AtomicLong()

    fun create(capacity: Int): InstrumentedLinkedBlockingQueueRunnable {
        val queue = InstrumentedLinkedBlockingQueueRunnable(ids.incrementAndGet(), capacity, sink)
        queues[queue.id] = queue
        sink.emit(ObjectCreated(ObjectType.LINKED_BLOCKING_QUEUE_RUNNABLE, queue.id, Thread.currentThread().name, queue.state()))
        return queue
    }

    fun get(id: Long): InstrumentedLinkedBlockingQueueRunnable =
        queues[id] ?: throw LinkedBlockingQueueRunnableNotFoundException(id)

    fun remove(id: Long) {
        queues.remove(id) ?: throw LinkedBlockingQueueRunnableNotFoundException(id)
        sink.emit(ObjectRemoved(ObjectType.LINKED_BLOCKING_QUEUE_RUNNABLE, id, Thread.currentThread().name))
    }

    fun all(): Collection<InstrumentedLinkedBlockingQueueRunnable> = queues.values
}

class LinkedBlockingQueueRunnableNotFoundException(id: Long) : NoSuchElementException("LinkedBlockingQueue $id not found")