package mingazov.kotlinview.instrumented.collection

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.MethodIn
import mingazov.kotlinview.event.MethodOut
import mingazov.kotlinview.event.MethodOutFailed
import mingazov.kotlinview.event.ObjectType
import mingazov.kotlinview.instrumented.Instrumented
import mingazov.kotlinview.instrumented.executor.InstrumentedRunnableTask
import java.util.concurrent.BlockingQueue
import java.util.concurrent.SynchronousQueue
import java.util.concurrent.TimeUnit

/**
 * SynchronousQueue<Runnable>: очередь без ёмкости — элемент не хранится, а передаётся из рук в руки.
 * offer вернёт true, только если кто-то уже ждёт в take / poll; put ждёт, пока такой придёт.
 * BlockingQueue<Runnable>, а не свой класс: ThreadPoolExecutor принимает только этот интерфейс (так устроен CachedThreadPool).
 * Элементы — всегда InstrumentedRunnableTask: в событиях вместо Runnable их id.
 * Методы, которые здесь не переопределены, уходят в delegate без событий.
 *
 * Замок на события, как у InstrumentedLinkedBlockingQueueRunnable, не нужен: элементов нет, state всегда одинаковый —
 * устаревшего снимка не бывает. Кто ждёт в put / take / poll, клиент видит по парам METHOD_IN / METHOD_OUT.
 */
class InstrumentedSynchronousQueueRunnable private constructor(
    override val id: Long,
    private val sink: EventSink,
    private val delegate: SynchronousQueue<Runnable>,
) : BlockingQueue<Runnable> by delegate, Instrumented {

    // Нечестная (fair = false), как в Executors.newCachedThreadPool: из ждущих получит последний пришедший (стек).
    // delegate снаружи не передаётся: иначе кто-то мог бы менять очередь в обход событий
    constructor(id: Long, sink: EventSink) : this(id, sink, SynchronousQueue())

    // Неблокирующий: true — задачу забрал ждущий в take / poll, false — никто не ждал
    override fun offer(runnable: Runnable): Boolean {
        val args = mapOf("taskId" to InstrumentedRunnableTask.taskIdOf(runnable))
        sink.emit(MethodIn(TYPE, id, threadName(), "offer", args, state()))
        try {
            val result = delegate.offer(runnable)
            sink.emit(MethodOut(TYPE, id, threadName(), "offer", args, result, state()))
            return result
        } catch (e: Exception) {
            sink.emit(MethodOutFailed(TYPE, id, threadName(), "offer", args, e.toString(), state()))
            throw e
        }
    }

    // Блокирующий: поток ждёт, пока задачу не заберёт кто-то в take / poll
    override fun put(runnable: Runnable) {
        val args = mapOf("taskId" to InstrumentedRunnableTask.taskIdOf(runnable))
        sink.emit(MethodIn(TYPE, id, threadName(), "put", args, state()))
        try {
            delegate.put(runnable)
            sink.emit(MethodOut(TYPE, id, threadName(), "put", args, null, state()))
        } catch (e: Exception) {
            // Например, InterruptedException
            sink.emit(MethodOutFailed(TYPE, id, threadName(), "put", args, e.toString(), state()))
            throw e
        }
    }

    // Блокирующий: поток ждёт, пока кто-то не отдаст задачу через offer / put
    override fun take(): Runnable {
        val args = emptyMap<String, Any?>()
        sink.emit(MethodIn(TYPE, id, threadName(), "take", args, state()))
        try {
            val element = delegate.take()
            val taskId = InstrumentedRunnableTask.taskIdOf(element)
            sink.emit(MethodOut(TYPE, id, threadName(), "take", args, taskId, state()))
            return element
        } catch (e: Exception) {
            // Например, InterruptedException от shutdownNow() пула
            sink.emit(MethodOutFailed(TYPE, id, threadName(), "take", args, e.toString(), state()))
            throw e
        }
    }

    // Зовут воркеры CachedThreadPool (core = 0, значит все): ждут не дольше keepAlive, null — не дождались, поток умрёт
    override fun poll(timeout: Long, unit: TimeUnit): Runnable? {
        val args = mapOf("timeoutMs" to unit.toMillis(timeout)) // пул передаёт keepAlive в наносекундах
        sink.emit(MethodIn(TYPE, id, threadName(), "poll", args, state()))
        try {
            val element = delegate.poll(timeout, unit)
            val taskId = element?.let(InstrumentedRunnableTask::taskIdOf) // null — таймаут
            sink.emit(MethodOut(TYPE, id, threadName(), "poll", args, taskId, state()))
            return element
        } catch (e: Exception) {
            sink.emit(MethodOutFailed(TYPE, id, threadName(), "poll", args, e.toString(), state()))
            throw e
        }
    }

    // Зовёт shutdownNow() пула. У SynchronousQueue забирать нечего — result всегда пустой; событие оставляем для единообразия с LBQ
    override fun drainTo(c: MutableCollection<in Runnable>): Int {
        val args = emptyMap<String, Any?>()
        sink.emit(MethodIn(TYPE, id, threadName(), "drainTo", args, state()))
        try {
            val drained = ArrayList<Runnable>()
            val result = delegate.drainTo(drained)
            c.addAll(drained)
            val taskIds = drained.map(InstrumentedRunnableTask::taskIdOf)
            sink.emit(MethodOut(TYPE, id, threadName(), "drainTo", args, taskIds, state()))
            return result
        } catch (e: Exception) {
            sink.emit(MethodOutFailed(TYPE, id, threadName(), "drainTo", args, e.toString(), state()))
            throw e
        }
    }

    /** Состояние очереди для событий: ёмкость всегда 0, элементов нет. */
    override fun state(): Map<String, Any?> = mapOf("capacity" to 0)

    private fun threadName() = Thread.currentThread().name

    private companion object {
        val TYPE = ObjectType.SYNCHRONOUS_QUEUE_RUNNABLE
    }
}