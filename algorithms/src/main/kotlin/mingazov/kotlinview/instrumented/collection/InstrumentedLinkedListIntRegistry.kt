package mingazov.kotlinview.instrumented.collection

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ObjectCreated
import mingazov.kotlinview.event.ObjectRemoved
import mingazov.kotlinview.event.ObjectType
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

class InstrumentedLinkedListIntRegistry(private val sink: EventSink) {

    private val lists = ConcurrentHashMap<Long, InstrumentedLinkedListInt>()
    private val ids = AtomicLong()

    fun create(): InstrumentedLinkedListInt {
        val list = InstrumentedLinkedListInt(ids.incrementAndGet(), sink)
        lists[list.id] = list
        sink.emit(ObjectCreated(ObjectType.LINKED_LIST_INT, list.id, Thread.currentThread().name))
        return list
    }

    fun get(id: Long): InstrumentedLinkedListInt =
        lists[id] ?: throw LinkedListIntNotFoundException(id)

    fun remove(id: Long) {
        lists.remove(id) ?: throw LinkedListIntNotFoundException(id)
        sink.emit(ObjectRemoved(ObjectType.LINKED_LIST_INT, id, Thread.currentThread().name))
    }

    fun all(): Collection<InstrumentedLinkedListInt> = lists.values
}

class LinkedListIntNotFoundException(id: Long) : NoSuchElementException("LinkedList $id not found")