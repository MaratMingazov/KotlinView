package mingazov.kotlinview.instrumented.collection

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
        val args = mapOf("element" to element)
        sink.emit(MethodIn(ObjectType.ARRAY_LIST_INT, id, threadName(), "add", args, snapshot()))
        try {
            val result = delegate.add(element)
            sink.emit(MethodOut(ObjectType.ARRAY_LIST_INT, id, threadName(), "add", args, result, snapshot()))
            return result
        } catch (e: Exception) {
            sink.emit(MethodOutFailed(ObjectType.ARRAY_LIST_INT, id, threadName(), "add", args, e.toString(), snapshot()))
            throw e
        }
    }

    // В протоколе "addAt", а не "add": клиенту нужно отличать перегрузки
    fun add(index: Int, element: Int) {
        val args = mapOf("index" to index, "element" to element)
        sink.emit(MethodIn(ObjectType.ARRAY_LIST_INT, id, threadName(), "addAt", args, snapshot()))
        try {
            delegate.add(index, element)
            sink.emit(MethodOut(ObjectType.ARRAY_LIST_INT, id, threadName(), "addAt", args, null, snapshot()))
        } catch (e: Exception) {
            sink.emit(MethodOutFailed(ObjectType.ARRAY_LIST_INT, id, threadName(), "addAt", args, e.toString(), snapshot()))
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

    // Снимок читает delegate, пока другие потоки могут его менять, или уже испорченный гонкой.
    // Исключение отсюда не должно ронять метод пользователя: null — «состояние прочитать не удалось»
    private fun snapshot(): List<Int>? =
        try {
            delegate.toList()
        } catch (e: Exception) {
            null
        }

    private fun threadName() = Thread.currentThread().name
}