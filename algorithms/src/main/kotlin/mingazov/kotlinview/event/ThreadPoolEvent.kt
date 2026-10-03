package mingazov.kotlinview.event

sealed interface ThreadPoolEvent : Event {
    val threadPoolId: String
}

data class PoolShutdownIn(override val threadPoolId: String, override val thread: String) : ThreadPoolEvent
data class PoolShutdownOut(override val threadPoolId: String, override val thread: String) : ThreadPoolEvent

data class PoolShutdownNow(override val threadPoolId: String, override val thread: String) : ThreadPoolEvent
data class TasksDrained(override val threadPoolId: String, override val thread: String, val taskIds: List<Long>) : ThreadPoolEvent
data class PoolRemoved(override val threadPoolId: String, override val thread: String) : ThreadPoolEvent

data class TaskStarted(override val threadPoolId: String, override val thread: String, val taskId: Long?) : ThreadPoolEvent
data class TaskCompleted(override val threadPoolId: String, override val thread: String, val taskId: Long?) : ThreadPoolEvent
data class TaskFailed(override val threadPoolId: String, override val thread: String, val taskId: Long?, val error: String) : ThreadPoolEvent
data class PoolTerminated(override val threadPoolId: String, override val thread: String) : ThreadPoolEvent