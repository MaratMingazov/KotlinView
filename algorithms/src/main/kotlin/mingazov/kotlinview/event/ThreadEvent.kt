package mingazov.kotlinview.event

sealed interface ThreadEvent : Event {
    val threadFactoryId: String // какая фабрика создала поток — по нему клиент находит пул
    val threadName: String
}

data class ThreadCreated(override val threadFactoryId: String, override val threadName: String, val parentThreadName: String) : ThreadEvent
data class ThreadStarted(override val threadFactoryId: String, override val threadName: String) : ThreadEvent
data class ThreadTerminated(override val threadFactoryId: String, override val threadName: String, val error: String?) : ThreadEvent
