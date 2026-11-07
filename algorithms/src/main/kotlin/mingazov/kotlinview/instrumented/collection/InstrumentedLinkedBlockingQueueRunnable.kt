package mingazov.kotlinview.instrumented

import mingazov.kotlinview.event.Event
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

    /**
     * Снимок state и отправка события — под одним замком. Без него снимок, снятый раньше, мог уйти позже:
     * offer положил задачу и снял [5], воркер в take её забрал и отправил [] первым, а за ним приходил offer OUT
     * со старым [5] — и клиент, который берёт state из последнего события, показывал задачу в очереди.
     * Под замком последнее отправленное событие всегда несёт самый свежий снимок.
     * Сами операции delegate — вне замка: блокирующий take никого не держит.
     */
    private val emitLock = Any()

    // event - это функция, которая принимает state и возвращает Event
    // state мы читаем прямо тут
    private inline fun emit(event: (state: Map<String, Any?>) -> Event) {
        synchronized(emitLock) { sink.emit(event(state())) }
    }

    // taskIdOf — до METHOD_IN: taskId нужен для args. Не InstrumentedRunnableTask — ошибка программиста, без событий
    override fun offer(runnable: Runnable): Boolean {
        val args = mapOf("taskId" to InstrumentedRunnableTask.taskIdOf(runnable))
        emit { state -> MethodIn(ObjectType.LINKED_BLOCKING_QUEUE_RUNNABLE, id, threadName(), "offer", args, state) }
        try {
            val result = delegate.offer(runnable) // неблокирующий: false, если очередь полна
            emit { state -> MethodOut(ObjectType.LINKED_BLOCKING_QUEUE_RUNNABLE, id, threadName(), "offer", args, result, state) }
            return result
        } catch (e: Exception) {
            emit { MethodOutFailed(ObjectType.LINKED_BLOCKING_QUEUE_RUNNABLE, id, threadName(), "offer", args, e.toString(), it) }
            throw e
        }
    }

    // METHOD_OUT take может прийти раньше METHOD_OUT offer той же задачи — это честная гонка потоков,
    // но state в них согласован (см. emitLock): последнее событие показывает актуальную очередь
    override fun take(): Runnable {
        val args = emptyMap<String, Any?>()
        emit { MethodIn(ObjectType.LINKED_BLOCKING_QUEUE_RUNNABLE, id, threadName(), "take", args, it) }
        try {
            val element = delegate.take() // блокирующий: на пустой очереди поток уснёт
            val taskId = InstrumentedRunnableTask.taskIdOf(element)
            emit { MethodOut(ObjectType.LINKED_BLOCKING_QUEUE_RUNNABLE, id, threadName(), "take", args, taskId, it) }
            return element
        } catch (e: Exception) {
            // Например, InterruptedException от shutdownNow() пула
            emit { MethodOutFailed(ObjectType.LINKED_BLOCKING_QUEUE_RUNNABLE, id, threadName(), "take", args, e.toString(), it) }
            throw e
        }
    }

    // Зовут воркеры сверх corePoolSize: ждут не дольше keepAlive, null — задачи не дождались, поток пула умрёт
    override fun poll(timeout: Long, unit: TimeUnit): Runnable? {
        val args = mapOf("timeoutMs" to unit.toMillis(timeout)) // пул передаёт keepAlive в наносекундах
        emit { MethodIn(ObjectType.LINKED_BLOCKING_QUEUE_RUNNABLE, id, threadName(), "poll", args, it) }
        try {
            val element = delegate.poll(timeout, unit) // блокирующий, но с таймаутом
            val taskId = element?.let(InstrumentedRunnableTask::taskIdOf) // null — таймаут
            emit { MethodOut(ObjectType.LINKED_BLOCKING_QUEUE_RUNNABLE, id, threadName(), "poll", args, taskId, it) }
            return element
        } catch (e: Exception) {
            emit { MethodOutFailed(ObjectType.LINKED_BLOCKING_QUEUE_RUNNABLE, id, threadName(), "poll", args, e.toString(), it) }
            throw e
        }
    }

    // Зовёт shutdownNow() пула: забрать все задачи разом
    override fun drainTo(c: MutableCollection<in Runnable>): Int {
        val args = emptyMap<String, Any?>()
        emit { MethodIn(ObjectType.LINKED_BLOCKING_QUEUE_RUNNABLE, id, threadName(), "drainTo", args, it) }
        try {
            // Сначала в свой список: так точно знаем, какие задачи забрали, что бы ни было в c до вызова
            val drained = ArrayList<Runnable>()
            val result = delegate.drainTo(drained)
            c.addAll(drained) // контракт drainTo: если add в c упал, элементы могут потеряться — так и у LinkedBlockingQueue
            // result — taskIds забранных задач, а не их число: так клиент увидит, что именно ушло
            val taskIds = drained.map(InstrumentedRunnableTask::taskIdOf)
            emit { MethodOut(ObjectType.LINKED_BLOCKING_QUEUE_RUNNABLE, id, threadName(), "drainTo", args, taskIds, it) }
            return result
        } catch (e: Exception) {
            emit { MethodOutFailed(ObjectType.LINKED_BLOCKING_QUEUE_RUNNABLE, id, threadName(), "drainTo", args, e.toString(), it) }
            throw e
        }
    }

    /**
     * Состояние очереди для событий. toArray() берёт полный замок LinkedBlockingQueue — снимок атомарный,
     * а не «примерно согласованный», как у итератора, идущего параллельно с offer / take.
     */
    override fun state(): Map<String, Any?> =
        mapOf("capacity" to capacity, "taskIds" to delegate.toArray().map { InstrumentedRunnableTask.taskIdOf(it as Runnable) })

    private fun threadName() = Thread.currentThread().name
}