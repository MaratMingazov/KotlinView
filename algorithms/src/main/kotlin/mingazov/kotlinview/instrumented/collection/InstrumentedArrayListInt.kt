package mingazov.kotlinview.instrumented.collection

import mingazov.kotlinview.event.ArrayListIntAddAtIn
import mingazov.kotlinview.event.ArrayListIntAddAtOut
import mingazov.kotlinview.event.ArrayListIntAddAtOutFailed
import mingazov.kotlinview.event.ArrayListIntAddIn
import mingazov.kotlinview.event.ArrayListIntAddOut
import mingazov.kotlinview.event.ArrayListIntAddOutFailed
import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.MethodIn
import mingazov.kotlinview.event.MethodOut
import mingazov.kotlinview.event.MethodOutFailed
import mingazov.kotlinview.event.ObjectType

class InstrumentedArrayListInt(
    val id: Long,
    private val sink: EventSink,
) {
    private val delegate = ArrayList<Int>()
    val size: Int get() = delegate.size

    fun add(element: Int): Boolean {
        sink.emit(ArrayListIntAddIn(id, threadName(), element, snapshot()))
        try {
            val result = delegate.add(element)
            sink.emit(ArrayListIntAddOut(id, threadName(), element, snapshot()))
            return result
        } catch (e: Exception) {
            sink.emit(ArrayListIntAddOutFailed(id, threadName(), element, e.toString(), snapshot()))
            throw e
        }
    }

    fun add(index: Int, element: Int) {
        sink.emit(ArrayListIntAddAtIn(id, threadName(), index, element, snapshot()))
        try {
            delegate.add(index, element)
            sink.emit(ArrayListIntAddAtOut(id, threadName(), index, element, snapshot()))
        } catch (e: Exception) {
            sink.emit(ArrayListIntAddAtOutFailed(id, threadName(), index, element, e.toString(), snapshot()))
            throw e
        }
    }

    fun get(index: Int): Int {
        val args = mapOf("index" to index)
        sink.emit(MethodIn(ObjectType.ARRAY_LIST_INT, id, threadName(), "get", args, snapshot()))
        try {
            val value = delegate[index]
            sink.emit(MethodOut(ObjectType.ARRAY_LIST_INT, id, threadName(), "get", args, value, snapshot()))
            return value
        } catch (e: Exception) {
            sink.emit(MethodOutFailed(ObjectType.ARRAY_LIST_INT, id, threadName(), "get", args, e.toString(), snapshot()))
            throw e
        }
    }

    private fun snapshot(): List<Int> = delegate.toList()

    private fun threadName() = Thread.currentThread().name
}