package mingazov.kotlinview.instrumented.executor

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.MethodIn
import mingazov.kotlinview.event.MethodOut
import mingazov.kotlinview.event.MethodOutFailed
import mingazov.kotlinview.event.ObjectType
import mingazov.kotlinview.instrumented.Instrumented
import java.util.concurrent.BlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/**
 *   Почему мы делаем через наследование, а не через композицию
 *
 *   execute → addWorker → new Worker → runWorker → getTask → beforeExecute → run → afterExecute → processWorkerExit → tryTerminate → terminated
 *             └──────────────────────── всё это внутри ThreadPoolExecutor, мимо декоратора ────────────────────────┘
 *
 *   Пул — составной объект: очередь, фабрика и её потоки — отдельные объекты со своими событиями.
 *   Пул в своём state только ссылается на них (queueId, threadFactoryId), клиент собирает картинку сам.
 *   Что делает воркер, видно по событиям задачи (METHOD_IN run с именем потока) и очереди (take/poll) —
 *   поэтому beforeExecute/afterExecute не переопределяем.
 *
 *   Очередь — любая наша инструментированная: LinkedBlockingQueue (fixed / single) или SynchronousQueue (cached).
 *   Отдельный интерфейс не нужен: требуем сразу оба — BlockingQueue<Runnable> для ThreadPoolExecutor и Instrumented ради id
 */
class InstrumentedThreadPoolExecutor<Q>(
    override val id: Long,
    private val sink: EventSink,
    corePoolSize: Int,
    maximumPoolSize: Int,
    private val keepAliveMs: Long,
    private val queue: Q,
    private val threadFactory: InstrumentedThreadFactory,
) : ThreadPoolExecutor(corePoolSize, maximumPoolSize, keepAliveMs, TimeUnit.MILLISECONDS, queue, threadFactory), Instrumented
        where Q : BlockingQueue<Runnable>, Q : Instrumented {

    // Чьи части — фасаду, чтобы удалить их вместе с пулом. Сами части наружу не отдаём
    val queueId: Long get() = queue.id
    val threadFactoryId: Long get() = threadFactory.id

    // Только execute, не submit: submit оборачивает задачу в FutureTask, и taskIdOf упадёт
    override fun execute(command: Runnable) {
        val args = mapOf("taskId" to InstrumentedRunnableTask.taskIdOf(command))
        sink.emit(MethodIn(ObjectType.THREAD_POOL_EXECUTOR, id, threadName(), "execute", args, state()))
        try {
            super.execute(command) // внутри: newThread фабрики и/или offer очереди — их события придут между IN и OUT
            sink.emit(MethodOut(ObjectType.THREAD_POOL_EXECUTOR, id, threadName(), "execute", args, null, state()))
        } catch (e: Exception) {
            // RejectedExecutionException: очередь полна и потоков уже maximumPoolSize, или пул остановлен
            sink.emit(MethodOutFailed(ObjectType.THREAD_POOL_EXECUTOR, id, threadName(), "execute", args, e.toString(), state()))
            throw e
        }
    }

    /**
     * Мягкая остановка: новые задачи не принимаем, уже принятые (и в очереди) доделываем.
     */
    override fun shutdown() {
        val args = emptyMap<String, Any?>()
        sink.emit(MethodIn(ObjectType.THREAD_POOL_EXECUTOR, id, threadName(), "shutdown", args, state()))
        try {
            // Внутри: прерванные простаивающие воркеры (METHOD_OUT_FAILED take), а если воркеров нет — сразу terminated
            super.shutdown()
            sink.emit(MethodOut(ObjectType.THREAD_POOL_EXECUTOR, id, threadName(), "shutdown", args, null, state()))
        } catch (e: Exception) {
            sink.emit(MethodOutFailed(ObjectType.THREAD_POOL_EXECUTOR, id, threadName(), "shutdown", args, e.toString(), state()))
            throw e
        }
    }

    /**
     * Жёсткая остановка: прерываем всех воркеров, задачи из очереди возвращаем. result — их taskIds.
     */
    override fun shutdownNow(): MutableList<Runnable> {
        val args = emptyMap<String, Any?>()
        sink.emit(MethodIn(ObjectType.THREAD_POOL_EXECUTOR, id, threadName(), "shutdownNow", args, state()))
        try {
            // Внутри: drainTo очереди и прерывание всех воркеров — и простаивающих, и занятых задачей
            val drained = super.shutdownNow()
            val taskIds = drained.map(InstrumentedRunnableTask::taskIdOf)
            sink.emit(MethodOut(ObjectType.THREAD_POOL_EXECUTOR, id, threadName(), "shutdownNow", args, taskIds, state()))
            return drained
        } catch (e: Exception) {
            sink.emit(MethodOutFailed(ObjectType.THREAD_POOL_EXECUTOR, id, threadName(), "shutdownNow", args, e.toString(), state()))
            throw e
        }
    }

    // Хук вызывается из tryTerminate, когда пул в TIDYING. TERMINATED пул выставит сразу после выхода из хука,
    // и события после этого уже не будет — поэтому METHOD_OUT показывает TERMINATED чуть раньше, чем на самом деле.
    // thread — кто довёл пул до конца: вызвавший shutdown или последний умирающий воркер
    override fun terminated() {
        val args = emptyMap<String, Any?>()
        sink.emit(MethodIn(ObjectType.THREAD_POOL_EXECUTOR, id, threadName(), "terminated", args, stateWith("TIDYING")))
        try {
            super.terminated()
            sink.emit(MethodOut(ObjectType.THREAD_POOL_EXECUTOR, id, threadName(), "terminated", args, null, stateWith("TERMINATED")))
        } catch (e: Exception) {
            sink.emit(MethodOutFailed(ObjectType.THREAD_POOL_EXECUTOR, id, threadName(), "terminated", args, e.toString(), stateWith("TIDYING")))
            throw e
        }
    }

    /**
     * Состояние пула для событий. poolSize / activeCount / completedTaskCount берут mainLock пула:
     * внутри execute он не держится, а в хуках вроде terminated() — реентерабельный, дедлока нет.
     */
    override fun state(): Map<String, Any?> = stateWith(runState())

    // runState передаёт только terminated(): снаружи TIDYING не отличить от SHUTDOWN
    private fun stateWith(runState: String): Map<String, Any?> = mapOf(
        "corePoolSize" to corePoolSize,
        "maximumPoolSize" to maximumPoolSize,
        "keepAliveMs" to keepAliveMs,
        "queueId" to queue.id,
        "threadFactoryId" to threadFactory.id,
        "runState" to runState,
        "poolSize" to poolSize,
        "activeCount" to activeCount,
        "completedTaskCount" to completedTaskCount,
    )

    private fun runState() = when {
        isTerminated -> "TERMINATED"
        isShutdown -> "SHUTDOWN"
        else -> "RUNNING"
    }

    private fun threadName() = Thread.currentThread().name
}