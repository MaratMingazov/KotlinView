package mingazov.kotlinview.instrumented.collection

import mingazov.kotlinview.event.ArrayListIntAddIn
import mingazov.kotlinview.event.ArrayListIntAddOut
import mingazov.kotlinview.event.ArrayListIntAddOutFailed
import mingazov.kotlinview.event.ArrayListIntGetIn
import mingazov.kotlinview.event.ArrayListIntGetOut
import mingazov.kotlinview.event.ArrayListIntGetOutFailed
import mingazov.kotlinview.event.EventSink

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

    fun get(index: Int): Int {
        sink.emit(ArrayListIntGetIn(id, threadName(), index, snapshot()))
        try {
            val value = delegate[index]
            sink.emit(ArrayListIntGetOut(id, threadName(), index, value, snapshot()))
            return value
        } catch (e: Exception) {
            sink.emit(ArrayListIntGetOutFailed(id, threadName(), index, e.toString(), snapshot()))
            throw e
        }
    }

    private fun snapshot(): List<Int> = delegate.toList()

    private fun threadName() = Thread.currentThread().name
}