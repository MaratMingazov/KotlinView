package mingazov.kotlinview.instrumented.collection

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.LinkedListIntCreated
import mingazov.kotlinview.event.LinkedListIntRemoved
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

class InstrumentedLinkedListIntRegistry(private val sink: EventSink) {

    private val lists = ConcurrentHashMap<Long, InstrumentedLinkedListInt>()
    private val ids = AtomicLong()

    fun create(): InstrumentedLinkedListInt {
        val list = InstrumentedLinkedListInt(ids.incrementAndGet(), sink)
        lists[list.id] = list
        sink.emit(LinkedListIntCreated(list.id, Thread.currentThread().name))
        return list
    }

    fun get(id: Long): InstrumentedLinkedListInt =
        lists[id] ?: throw LinkedListIntNotFoundException(id)

    fun remove(id: Long) {
        lists.remove(id) ?: throw LinkedListIntNotFoundException(id)
        sink.emit(LinkedListIntRemoved(id, Thread.currentThread().name))
    }

    fun all(): Collection<InstrumentedLinkedListInt> = lists.values
}

class LinkedListIntNotFoundException(id: Long) : NoSuchElementException("LinkedList $id not found")