package mingazov.kotlinview.service

import mingazov.kotlinview.instrumented.InstrumentedLinkedBlockingQueueRunnableRegistry
import mingazov.kotlinview.instrumented.InstrumentedRunnableTask
import mingazov.kotlinview.instrumented.InstrumentedRunnableTaskRegistry
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
    private val queueRegistry: InstrumentedLinkedBlockingQueueRunnableRegistry,
    private val threadFactoryRegistry: InstrumentedThreadFactoryRegistry,
    private val taskRegistry: InstrumentedRunnableTaskRegistry,
) {

    /** Пул владеет своими частями: создаёт их сам и удаляет вместе с собой. queueCapacity == null — неограниченная очередь. */
    fun create(corePoolSize: Int, maximumPoolSize: Int, keepAliveMs: Long, queueCapacity: Int?): InstrumentedThreadPoolExecutor {
        // Проверяем до создания частей: иначе клиент получил бы OBJECT_CREATED очереди и фабрики пула, которого не будет.
        // Те же условия, что в конструкторе ThreadPoolExecutor и LinkedBlockingQueue
        require(corePoolSize >= 0) { "corePoolSize must be >= 0" }
        require(maximumPoolSize > 0 && maximumPoolSize >= corePoolSize) { "maximumPoolSize must be > 0 and >= corePoolSize" }
        require(keepAliveMs >= 0) { "keepAliveMs must be >= 0" }
        require(queueCapacity == null || queueCapacity > 0) { "queueCapacity must be > 0" }

        // Порядок событий: сначала части, потом пул — ссылки queueId / threadFactoryId всегда на уже известные клиенту объекты
        val queue = queueRegistry.create(queueCapacity ?: Int.MAX_VALUE)
        val threadFactory = threadFactoryRegistry.create()
        return poolRegistry.create(corePoolSize, maximumPoolSize, keepAliveMs, queue, threadFactory)
    }

    // ---------- Готовые конфигурации, как в java.util.concurrent.Executors ----------
    // Это не отдельные виды пулов: Executors — фабрика наборов параметров для того же ThreadPoolExecutor.
    // Отличие от JDK: очередь ограничена PRESET_QUEUE_CAPACITY, а не бесконечна — чтобы на странице было видно,
    // что происходит, когда она заполняется: при core = max новых потоков не будет, следующий execute получит отказ

    /** Как Executors.newFixedThreadPool(n): ровно n потоков навсегда, лишние задачи ждут в очереди. */
    fun newFixedThreadPool(nThreads: Int): InstrumentedThreadPoolExecutor {
        require(nThreads > 0) { "nThreads must be > 0" }
        return create(corePoolSize = nThreads, maximumPoolSize = nThreads, keepAliveMs = 0, queueCapacity = PRESET_QUEUE_CAPACITY)
    }

    /**
     * Как Executors.newSingleThreadExecutor(): один поток, задачи выполняются строго по очереди.
     * В JDK пул ещё обёрнут, чтобы его нельзя было перенастроить (setCorePoolSize); у нас таких методов в API нет — это просто fixed(1).
     */
    fun newSingleThreadExecutor(): InstrumentedThreadPoolExecutor = newFixedThreadPool(1)

    private companion object {
        /** В JDK у fixed и single очередь неограниченная (LinkedBlockingQueue()). У нас — 5, чтобы заполнение было видно. */
        const val PRESET_QUEUE_CAPACITY = 5
    }

    fun get(poolId: Long): InstrumentedThreadPoolExecutor = poolRegistry.get(poolId)
    fun all() = poolRegistry.all()

    fun execute(poolId: Long, taskId: Long) = poolRegistry.get(poolId).execute(taskRegistry.get(taskId))
    fun shutdown(poolId: Long) = poolRegistry.get(poolId).shutdown()
    fun shutdownNow(poolId: Long): List<Long> =
        poolRegistry.get(poolId).shutdownNow().map(InstrumentedRunnableTask::taskIdOf)

    // TODO: очередь пула можно удалить в обход фасада через DELETE /api/linkedblockingqueuerunnable/{id}
    fun remove(poolId: Long) {
        val pool = poolRegistry.get(poolId)
        // После TERMINATED очередь пуста и воркеров нет — части удалять безопасно
        check(pool.isTerminated) { "Pool $poolId must be terminated before removal" }
        // Сначала пул: на части больше никто не ссылается
        poolRegistry.remove(poolId)
        queueRegistry.remove(pool.queueId)
        threadFactoryRegistry.remove(pool.threadFactoryId)
    }
}