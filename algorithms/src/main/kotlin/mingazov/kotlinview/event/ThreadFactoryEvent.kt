package mingazov.kotlinview.event

sealed interface ThreadFactoryEvent : Event {
    val threadFactoryId: String // какая фабрика создала поток — по нему клиент находит пул
}

data class ThreadFactoryThreadCreated(override val threadFactoryId: String, override val thread: String, val parentThread: String) : ThreadFactoryEvent
data class ThreadFactoryThreadStarted(override val threadFactoryId: String, override val thread: String) : ThreadFactoryEvent
data class ThreadFactoryThreadTerminated(override val threadFactoryId: String, override val thread: String, val error: String?) : ThreadFactoryEvent
