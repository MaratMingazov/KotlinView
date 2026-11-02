package mingazov.kotlinview.instrumented.collection

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.LinkedListIntAddIn
import mingazov.kotlinview.event.LinkedListIntAddOut
import mingazov.kotlinview.event.LinkedListIntAddOutFailed
import mingazov.kotlinview.event.LinkedListIntOfferIn
import mingazov.kotlinview.event.LinkedListIntOfferOut
import mingazov.kotlinview.event.LinkedListIntOfferOutFailed
import java.util.LinkedList

class InstrumentedLinkedListInt (
    val id: Long,
    private val sink: EventSink,
) {

    private val delegate = LinkedList<Int>()
    val size: Int get() = delegate.size

    fun add(element: Int): Boolean {
        sink.emit(LinkedListIntAddIn(id, threadName(), element, snapshot()))
        try {
            val result = delegate.add(element)
            sink.emit(LinkedListIntAddOut(id, threadName(), element, snapshot()))
            return result
        } catch (e: Exception) {
            sink.emit(LinkedListIntAddOutFailed(id, threadName(), element, e.toString(), snapshot()))
            throw e
        }
    }

    // Пока напрямую через delegate.offer — без вызова нашего add, поэтому вложенных ADD_* событий нет
    fun offer(element: Int): Boolean {
        sink.emit(LinkedListIntOfferIn(id, threadName(), element, snapshot()))
        try {
            val result = delegate.offer(element)
            sink.emit(LinkedListIntOfferOut(id, threadName(), element, snapshot()))
            return result
        } catch (e: Exception) {
            sink.emit(LinkedListIntOfferOutFailed(id, threadName(), element, e.toString(), snapshot()))
            throw e
        }
    }

    // При гонке toList() может бросить исключение (узлов больше, чем size) — принимаем это осознанно
    private fun snapshot(): List<Int> = delegate.toList()

    private fun threadName() = Thread.currentThread().name
}