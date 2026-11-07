package mingazov.kotlinview.service

import mingazov.kotlinview.instrumented.InstrumentedLinkedBlockingQueueRunnableRegistry
import mingazov.kotlinview.instrumented.InstrumentedRunnableTask
import mingazov.kotlinview.instrumented.InstrumentedRunnableTaskRegistry
import mingazov.kotlinview.instrumented.InstrumentedSynchronousQueueRunnableRegistry
import mingazov.kotlinview.instrumented.InstrumentedThreadFactoryRegistry
import mingazov.kotlinview.instrumented.InstrumentedThreadPoolExecutor
import mingazov.kotlinview.instrumented.InstrumentedThreadPoolExecutorRegistry
import org.springframework.stereotype.Service

/**
 * Фасад пула: собирает пул из частей (очередь, фабрика) и удаляет их вместе с ним.
 * Реестры в algorithms остаются независимыми — правило владения живёт только здесь.
 */
@Service
class ThreadPoolExecutorService(
    private val poolRegistry: InstrumentedThreadPoolExecutorRegistry,
    private val linkedBlockingQueueRegistry: InstrumentedLinkedBlockingQueueRunnableRegistry,
    private val synchronousQueueRegistry: InstrumentedSynchronousQueueRunnableRegistry,
    private val threadFactoryRegistry: InstrumentedThreadFactoryRegistry,
    private val taskRegistry: InstrumentedRunnableTaskRegistry,
) {

    /** Пул владеет своими частями: создаёт их сам и удаляет вместе с собой. queueCapacity == null — неограниченная очередь. */
    fun create(corePoolSize: Int, maximumPoolSize: Int, keepAliveMs: Long, queueCapacity: Int?): InstrumentedThreadPoolExecutor<*> {
        // Проверяем до создания частей: иначе клиент получил бы OBJECT_CREATED очереди и фабрики пула, которого не будет.
        // Те же условия, что в конструкторе ThreadPoolExecutor и LinkedBlockingQueue
        requirePoolParams(corePoolSize, maximumPoolSize, keepAliveMs)
        require(queueCapacity == null || queueCapacity > 0) { "queueCapacity must be > 0" }

        // Порядок событий: сначала части, потом пул — ссылки queueId / threadFactoryId всегда на уже известные клиенту объекты
        val queue = linkedBlockingQueueRegistry.create(queueCapacity ?: Int.MAX_VALUE)
        val threadFactory = threadFactoryRegistry.create()
        return poolRegistry.create(corePoolSize, maximumPoolSize, keepAliveMs, queue, threadFactory)
    }

    // ---------- Готовые конфигурации, как в java.util.concurrent.Executors ----------
    // Это не отдельные виды пулов: Executors — фабрика наборов параметров для того же ThreadPoolExecutor.
    // Отличие от JDK: очередь ограничена PRESET_QUEUE_CAPACITY, а не бесконечна — чтобы на странице было видно,
    // что происходит, когда она заполняется: при core = max новых потоков не будет, следующий execute получит отказ

    private fun requirePoolParams(corePoolSize: Int, maximumPoolSize: Int, keepAliveMs: Long) {
        require(corePoolSize >= 0) { "corePoolSize must be >= 0" }
        require(maximumPoolSize > 0 && maximumPoolSize >= corePoolSize) { "maximumPoolSize must be > 0 and >= corePoolSize" }
        require(keepAliveMs >= 0) { "keepAliveMs must be >= 0" }
    }

    /** Как Executors.newFixedThreadPool(n): ровно n потоков навсегда, лишние задачи ждут в очереди. */
    fun newFixedThreadPool(nThreads: Int): InstrumentedThreadPoolExecutor<*> {
        require(nThreads > 0) { "nThreads must be > 0" }
        return create(corePoolSize = nThreads, maximumPoolSize = nThreads, keepAliveMs = 0, queueCapacity = PRESET_QUEUE_CAPACITY)
    }

    /**
     * Как Executors.newSingleThreadExecutor(): один поток, задачи выполняются строго по очереди.
     * В JDK пул ещё обёрнут, чтобы его нельзя было перенастроить (setCorePoolSize); у нас таких методов в API нет — это просто fixed(1).
     */
    fun newSingleThreadExecutor(): InstrumentedThreadPoolExecutor<*> = newFixedThreadPool(1)

    /**
     * Как Executors.newCachedThreadPool(): core = 0, очередь — SynchronousQueue (ничего не хранит).
     * execute отдаёт задачу воркеру, который ждёт в poll(keepAlive); если такого нет — пул создаёт новый поток.
     * Простаивающие воркеры умирают по keepAlive — пул сжимается до нуля.
     * Отличие от JDK: потоков не больше CACHED_MAX_THREADS (в JDK — Integer.MAX_VALUE), чтобы был виден отказ,
     * и keepAlive CACHED_KEEP_ALIVE_MS (в JDK — 60 с), чтобы смерть потоков можно было дождаться
     */
    fun newCachedThreadPool(): InstrumentedThreadPoolExecutor<*> {
        requirePoolParams(0, CACHED_MAX_THREADS, CACHED_KEEP_ALIVE_MS)
        val queue = synchronousQueueRegistry.create()
        val threadFactory = threadFactoryRegistry.create()
        return poolRegistry.create(0, CACHED_MAX_THREADS, CACHED_KEEP_ALIVE_MS, queue, threadFactory)
    }

    private companion object {
        /** В JDK у fixed и single очередь неограниченная (LinkedBlockingQueue()). У нас — 5, чтобы заполнение было видно. */
        const val PRESET_QUEUE_CAPACITY = 5

        /** В JDK у cached потоков до Integer.MAX_VALUE и keepAlive 60 с. У нас — 5 потоков и 10 с. */
        const val CACHED_MAX_THREADS = 5
        const val CACHED_KEEP_ALIVE_MS = 10_000L
    }

    fun get(poolId: Long): InstrumentedThreadPoolExecutor<*> = poolRegistry.get(poolId)
    fun all() = poolRegistry.all()

    fun execute(poolId: Long, taskId: Long) = poolRegistry.get(poolId).execute(taskRegistry.get(taskId))
    fun shutdown(poolId: Long) = poolRegistry.get(poolId).shutdown()
    fun shutdownNow(poolId: Long): List<Long> =
        poolRegistry.get(poolId).shutdownNow().map(InstrumentedRunnableTask::taskIdOf)

    // TODO: очередь пула можно удалить в обход фасада через DELETE /api/linkedblockingqueuerunnable/{id} (или synchronousqueuerunnable)
    fun remove(poolId: Long) {
        val pool = poolRegistry.get(poolId)
        // После TERMINATED очередь пуста и воркеров нет — части удалять безопасно
        check(pool.isTerminated) { "Pool $poolId must be terminated before removal" }
        // Сначала пул: на части больше никто не ссылается
        poolRegistry.remove(poolId)
        // Очередь — в одном из двух реестров: id общие на все реестры, поэтому по id однозначно видно, в каком
        if (synchronousQueueRegistry.contains(pool.queueId)) synchronousQueueRegistry.remove(pool.queueId)
        else linkedBlockingQueueRegistry.remove(pool.queueId)
        threadFactoryRegistry.remove(pool.threadFactoryId)
    }
}