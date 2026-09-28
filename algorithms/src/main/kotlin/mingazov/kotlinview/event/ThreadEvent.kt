package mingazov.kotlinview.event

sealed interface ThreadEvent : Event { val threadName: String }

data class ThreadCreated(override val threadName: String, val parentThreadName: String) : ThreadEvent
data class ThreadStarted(override val threadName: String) : ThreadEvent
data class ThreadTerminated(override val threadName: String, val error: String?) : ThreadEvent