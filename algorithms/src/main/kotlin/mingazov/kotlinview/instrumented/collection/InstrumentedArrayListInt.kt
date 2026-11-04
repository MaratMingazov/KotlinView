package mingazov.kotlinview.instrumented.collection

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.MethodIn
import mingazov.kotlinview.event.MethodOut
import mingazov.kotlinview.event.MethodOutFailed
import mingazov.kotlinview.event.ObjectType
import java.util.concurrent.locks.ReentrantReadWriteLock
import kotlin.concurrent.read
import kotlin.concurrent.write

class InstrumentedArrayListInt private constructor(
    val id: Long,
    private val sink: EventSink,
    private val delegate: ArrayList<Int>,
) : MutableList<Int> by delegate {

    // delegate снаружи не передаётся: иначе кто-то мог бы менять список в обход событий
    constructor(id: Long, sink: EventSink) : this(id, sink, ArrayList())

    // Перевёрнутый RW-lock: операции над delegate берут read lock — несколько потоков могут быть внутри одновременно,
    // поэтому гонки ArrayList сохраняются. Снимок берёт write lock — читает, только когда внутри delegate никого нет,
    // поэтому в снимке только то, что реально было, а не артефакт чтения посреди записи.
    // Правило: snapshot() нельзя вызывать под read lock — read lock нельзя повысить до write, будет deadlock.
    private val lock = ReentrantReadWriteLock()

    override fun add(element: Int): Boolean {
        val args = mapOf("element" to element)
        sink.emit(MethodIn(ObjectType.ARRAY_LIST_INT, id, threadName(), "add", args, snapshot()))
        try {
            val result = lock.read { delegate.add(element) }
            sink.emit(MethodOut(ObjectType.ARRAY_LIST_INT, id, threadName(), "add", args, result, snapshot()))
            return result
        } catch (e: Exception) {
            sink.emit(MethodOutFailed(ObjectType.ARRAY_LIST_INT, id, threadName(), "add", args, e.toString(), snapshot()))
            throw e
        }
    }

    // В протоколе "addAt", а не "add": клиенту нужно отличать перегрузки
    override fun add(index: Int, element: Int) {
        val args = mapOf("index" to index, "element" to element)
        sink.emit(MethodIn(ObjectType.ARRAY_LIST_INT, id, threadName(), "addAt", args, snapshot()))
        try {
            lock.read { delegate.add(index, element) }
            sink.emit(MethodOut(ObjectType.ARRAY_LIST_INT, id, threadName(), "addAt", args, null, snapshot()))
        } catch (e: Exception) {
            sink.emit(MethodOutFailed(ObjectType.ARRAY_LIST_INT, id, threadName(), "addAt", args, e.toString(), snapshot()))
            throw e
        }
    }

    override fun get(index: Int): Int {
        val args = mapOf("index" to index)
        sink.emit(MethodIn(ObjectType.ARRAY_LIST_INT, id, threadName(), "get", args, snapshot()))
        try {
            val value = lock.read { delegate[index] }
            sink.emit(MethodOut(ObjectType.ARRAY_LIST_INT, id, threadName(), "get", args, value, snapshot()))
            return value
        } catch (e: Exception) {
            sink.emit(MethodOutFailed(ObjectType.ARRAY_LIST_INT, id, threadName(), "get", args, e.toString(), snapshot()))
            throw e
        }
    }

    // Под write lock внутри delegate никого нет, но прошлая гонка могла оставить его испорченным.
    // Исключение отсюда не должно ронять метод пользователя: null — «состояние прочитать не удалось»
    private fun snapshot(): List<Int>? = lock.write {
        try {
            delegate.toList()
        } catch (e: Exception) {
            null
        }
    }

    private fun threadName() = Thread.currentThread().name
}