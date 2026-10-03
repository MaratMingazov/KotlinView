package mingazov.kotlinview.event

sealed interface ThreadPoolEvent : Event {
    val poolId: String
}

data class PoolInitIn(override val poolId: String, val thread: String, ) : ThreadPoolEvent
data class PoolInitOut(override val poolId: String, val thread: String, ) : ThreadPoolEvent
data class PoolCreated(override val poolId: String, val corePoolSize: Int, val maximumPoolSize: Int, val keepAliveMs: Long, val queueCapacity: Int, val thread: String) : ThreadPoolEvent

data class PoolShutdown(override val poolId: String, val thread: String) : ThreadPoolEvent
data class PoolShutdownNow(override val poolId: String, val thread: String) : ThreadPoolEvent
data class TasksDrained(override val poolId: String, val taskIds: List<Long>, val thread: String) : ThreadPoolEvent
data class PoolRemoved(override val poolId: String, val thread: String) : ThreadPoolEvent

data class TaskStarted(override val poolId: String, val taskId: Long?, val thread: String) : ThreadPoolEvent
data class TaskCompleted(override val poolId: String, val taskId: Long?, val thread: String) : ThreadPoolEvent
data class TaskFailed(override val poolId: String, val taskId: Long?, val thread: String, val error: String) : ThreadPoolEvent
data class PoolTerminated(override val poolId: String, val thread: String) : ThreadPoolEvent