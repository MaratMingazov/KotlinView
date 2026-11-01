package mingazov.kotlinview.instrumented.collection

import mingazov.kotlinview.event.ArrayListIntCreated
import mingazov.kotlinview.event.ArrayListIntRemoved
import mingazov.kotlinview.event.EventSink
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

class InstrumentedArrayListIntRegistry(private val sink: EventSink) {

    private val lists = ConcurrentHashMap<Long, InstrumentedArrayListInt>()
    private val ids = AtomicLong()

    fun create(): InstrumentedArrayListInt {
        val list = InstrumentedArrayListInt(ids.incrementAndGet(), sink)
        lists[list.id] = list
        sink.emit(ArrayListIntCreated(list.id, Thread.currentThread().name))
        return list
    }

    fun get(id: Long): InstrumentedArrayListInt =
        lists[id] ?: throw ArrayListIntNotFoundException(id)

    fun remove(id: Long) {
        lists.remove(id) ?: throw ArrayListIntNotFoundException(id)
        sink.emit(ArrayListIntRemoved(id, Thread.currentThread().name))
    }

    fun all(): Collection<InstrumentedArrayListInt> = lists.values
}

class ArrayListIntNotFoundException(id: Long) : NoSuchElementException("ArrayList $id not found")