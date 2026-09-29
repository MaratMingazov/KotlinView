package mingazov.kotlinview.event

sealed interface ThreadPoolEvent : Event {
    val poolId: String
}

data class TaskStarted(override val poolId: String, val taskId: Long?, val thread: String) : ThreadPoolEvent
data class TaskCompleted(override val poolId: String, val taskId: Long?, val thread: String) : ThreadPoolEvent
data class TaskFailed(override val poolId: String, val taskId: Long?, val thread: String, val error: String) : ThreadPoolEvent
data class PoolTerminated(override val poolId: String, val thread: String) : ThreadPoolEvent