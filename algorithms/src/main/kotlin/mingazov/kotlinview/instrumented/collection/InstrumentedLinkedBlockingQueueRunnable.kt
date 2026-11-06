package mingazov.kotlinview.instrumented

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.MethodIn
import mingazov.kotlinview.event.MethodOut
import mingazov.kotlinview.event.MethodOutFailed
import mingazov.kotlinview.event.ObjectType
import java.util.concurrent.BlockingQueue
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * BlockingQueue<Runnable>, а не свой класс: ThreadPoolExecutor принимает только этот интерфейс.
 * Элементы — всегда InstrumentedRunnableTask: в событиях вместо Runnable их id.
 * Методы, которые здесь не переопределены, уходят в delegate без событий.
 */
class InstrumentedLinkedBlockingQueueRunnable private constructor(
    override val id: Long,
    private val sink: EventSink,
    private val capacity: Int, // у LinkedBlockingQueue нет геттера ёмкости, а size + remainingCapacity() под гонкой не атомарно
    private val delegate: LinkedBlockingQueue<Runnable>,
) : BlockingQueue<Runnable> by delegate, Instrumented {

    // delegate снаружи не передаётся: иначе кто-то мог бы менять очередь в обход событий
    constructor(id: Long, capacity: Int, sink: EventSink) : this(id, sink, capacity, LinkedBlockingQueue(capacity))

    // taskIdOf — до METHOD_IN: taskId нужен для args. Не InstrumentedRunnableTask — ошибка программиста, без событий
    override fun offer(runnable: Runnable): Boolean {
        val args = mapOf("taskId" to InstrumentedRunnableTask.taskIdOf(runnable))
        sink.emit(MethodIn(ObjectType.LINKED_BLOCKING_QUEUE_RUNNABLE, id, threadName(), "offer", args, state()))
        try {
            val result = delegate.offer(runnable) // неблокирующий: false, если очередь полна
            sink.emit(MethodOut(ObjectType.LINKED_BLOCKING_QUEUE_RUNNABLE, id, threadName(), "offer", args, result, state()))
            return result
        } catch (e: Exception) {
            sink.emit(MethodOutFailed(ObjectType.LINKED_BLOCKING_QUEUE_RUNNABLE, id, threadName(), "offer", args, e.toString(), state()))
            throw e
        }
    }

    // TODO: без общего монитора METHOD_OUT take может прийти раньше METHOD_OUT offer — state при этом всё равно верный
    override fun take(): Runnable {
        val args = emptyMap<String, Any?>()
        sink.emit(MethodIn(ObjectType.LINKED_BLOCKING_QUEUE_RUNNABLE, id, threadName(), "take", args, state()))
        try {
            val element = delegate.take() // блокирующий: на пустой очереди поток уснёт
            val taskId = InstrumentedRunnableTask.taskIdOf(element)
            sink.emit(MethodOut(ObjectType.LINKED_BLOCKING_QUEUE_RUNNABLE, id, threadName(), "take", args, taskId, state()))
            return element
        } catch (e: Exception) {
            // Например, InterruptedException от shutdownNow() пула
            sink.emit(MethodOutFailed(ObjectType.LINKED_BLOCKING_QUEUE_RUNNABLE, id, threadName(), "take", args, e.toString(), state()))
            throw e
        }
    }

    // Зовут воркеры сверх corePoolSize: ждут не дольше keepAlive, null — задачи не дождались, поток пула умрёт
    override fun poll(timeout: Long, unit: TimeUnit): Runnable? {
        val args = mapOf("timeoutMs" to unit.toMillis(timeout)) // пул передаёт keepAlive в наносекундах
        sink.emit(MethodIn(ObjectType.LINKED_BLOCKING_QUEUE_RUNNABLE, id, threadName(), "poll", args, state()))
        try {
            val element = delegate.poll(timeout, unit) // блокирующий, но с таймаутом
            val taskId = element?.let(InstrumentedRunnableTask::taskIdOf) // null — таймаут
            sink.emit(MethodOut(ObjectType.LINKED_BLOCKING_QUEUE_RUNNABLE, id, threadName(), "poll", args, taskId, state()))
            return element
        } catch (e: Exception) {
            sink.emit(MethodOutFailed(ObjectType.LINKED_BLOCKING_QUEUE_RUNNABLE, id, threadName(), "poll", args, e.toString(), state()))
            throw e
        }
    }

    // Зовёт shutdownNow() пула: забрать все задачи разом
    override fun drainTo(c: MutableCollection<in Runnable>): Int {
        val args = emptyMap<String, Any?>()
        sink.emit(MethodIn(ObjectType.LINKED_BLOCKING_QUEUE_RUNNABLE, id, threadName(), "drainTo", args, state()))
        try {
            // Сначала в свой список: так точно знаем, какие задачи забрали, что бы ни было в c до вызова
            val drained = ArrayList<Runnable>()
            val result = delegate.drainTo(drained)
            c.addAll(drained) // контракт drainTo: если add в c упал, элементы могут потеряться — так и у LinkedBlockingQueue
            // result — taskIds забранных задач, а не их число: так клиент увидит, что именно ушло
            val taskIds = drained.map(InstrumentedRunnableTask::taskIdOf)
            sink.emit(MethodOut(ObjectType.LINKED_BLOCKING_QUEUE_RUNNABLE, id, threadName(), "drainTo", args, taskIds, state()))
            return result
        } catch (e: Exception) {
            sink.emit(MethodOutFailed(ObjectType.LINKED_BLOCKING_QUEUE_RUNNABLE, id, threadName(), "drainTo", args, e.toString(), state()))
            throw e
        }
    }

    /** Состояние очереди для событий. Итератор LinkedBlockingQueue потокобезопасен и не бросает исключений — замок не нужен. */
    override fun state(): Map<String, Any?> =
        mapOf("capacity" to capacity, "taskIds" to delegate.map(InstrumentedRunnableTask::taskIdOf))

    private fun threadName() = Thread.currentThread().name
}