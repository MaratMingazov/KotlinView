package mingazov.kotlinview.instrumented.collection

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.MethodIn
import mingazov.kotlinview.event.MethodOut
import mingazov.kotlinview.event.MethodOutFailed
import mingazov.kotlinview.event.ObjectType
import java.util.LinkedList

class InstrumentedLinkedListInt (
    val id: Long,
    private val sink: EventSink,
) {

    private val delegate = LinkedList<Int>()
    val size: Int get() = delegate.size

    fun add(element: Int): Boolean {
        val args = mapOf("element" to element)
        sink.emit(MethodIn(ObjectType.LINKED_LIST_INT, id, threadName(), "add", args, snapshot()))
        try {
            val result = delegate.add(element)
            sink.emit(MethodOut(ObjectType.LINKED_LIST_INT, id, threadName(), "add", args, result, snapshot()))
            return result
        } catch (e: Exception) {
            sink.emit(MethodOutFailed(ObjectType.LINKED_LIST_INT, id, threadName(), "add", args, e.toString(), snapshot()))
            throw e
        }
    }

    // Пока напрямую через delegate.offer — без вызова нашего add, поэтому вложенных событий add нет
    fun offer(element: Int): Boolean {
        val args = mapOf("element" to element)
        sink.emit(MethodIn(ObjectType.LINKED_LIST_INT, id, threadName(), "offer", args, snapshot()))
        try {
            val result = delegate.offer(element)
            sink.emit(MethodOut(ObjectType.LINKED_LIST_INT, id, threadName(), "offer", args, result, snapshot()))
            return result
        } catch (e: Exception) {
            sink.emit(MethodOutFailed(ObjectType.LINKED_LIST_INT, id, threadName(), "offer", args, e.toString(), snapshot()))
            throw e
        }
    }

    fun offerFirst(element: Int): Boolean {
        val args = mapOf("element" to element)
        sink.emit(MethodIn(ObjectType.LINKED_LIST_INT, id, threadName(), "offerFirst", args, snapshot()))
        try {
            val result = delegate.offerFirst(element)
            sink.emit(MethodOut(ObjectType.LINKED_LIST_INT, id, threadName(), "offerFirst", args, result, snapshot()))
            return result
        } catch (e: Exception) {
            sink.emit(MethodOutFailed(ObjectType.LINKED_LIST_INT, id, threadName(), "offerFirst", args, e.toString(), snapshot()))
            throw e
        }
    }

    fun offerLast(element: Int): Boolean {
        val args = mapOf("element" to element)
        sink.emit(MethodIn(ObjectType.LINKED_LIST_INT, id, threadName(), "offerLast", args, snapshot()))
        try {
            val result = delegate.offerLast(element)
            sink.emit(MethodOut(ObjectType.LINKED_LIST_INT, id, threadName(), "offerLast", args, result, snapshot()))
            return result
        } catch (e: Exception) {
            sink.emit(MethodOutFailed(ObjectType.LINKED_LIST_INT, id, threadName(), "offerLast", args, e.toString(), snapshot()))
            throw e
        }
    }

    /** Забирает голову. Пустой список — null: для poll это нормальный результат, а не ошибка. */
    fun poll(): Int? {
        val args = emptyMap<String, Any?>()
        sink.emit(MethodIn(ObjectType.LINKED_LIST_INT, id, threadName(), "poll", args, snapshot()))
        try {
            val result: Int? = delegate.poll()
            sink.emit(MethodOut(ObjectType.LINKED_LIST_INT, id, threadName(), "poll", args, result, snapshot()))
            return result
        } catch (e: Exception) {
            sink.emit(MethodOutFailed(ObjectType.LINKED_LIST_INT, id, threadName(), "poll", args, e.toString(), snapshot()))
            throw e
        }
    }

    /** Забирает голову. Пустой список — NoSuchElementException. */
    fun pop(): Int {
        val args = emptyMap<String, Any?>()
        sink.emit(MethodIn(ObjectType.LINKED_LIST_INT, id, threadName(), "pop", args, snapshot()))
        try {
            val result = delegate.pop()
            sink.emit(MethodOut(ObjectType.LINKED_LIST_INT, id, threadName(), "pop", args, result, snapshot()))
            return result
        } catch (e: Exception) {
            sink.emit(MethodOutFailed(ObjectType.LINKED_LIST_INT, id, threadName(), "pop", args, e.toString(), snapshot()))
            throw e
        }
    }

    // При гонке toList() может бросить исключение (узлов больше, чем size) — принимаем это осознанно
    private fun snapshot(): List<Int> = delegate.toList()

    private fun threadName() = Thread.currentThread().name
}