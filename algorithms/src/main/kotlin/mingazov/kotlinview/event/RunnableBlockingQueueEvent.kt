package mingazov.kotlinview.event

sealed interface RunnableBlockingQueueEvent : Event {
    val queueId: String
}

data class RunnableBlockingQueueOfferInEvent(override val queueId: String, val queueSize: Int, override val thread: String) : RunnableBlockingQueueEvent
data class RunnableBlockingQueueOfferOutEvent(override val queueId: String, val accepted: Boolean, val queueSize: Int, override val thread: String) : RunnableBlockingQueueEvent

data class RunnableBlockingQueueTakeInEvent(override val queueId: String, val queueSize: Int, override val thread: String) : RunnableBlockingQueueEvent
data class RunnableBlockingQueueTakeOutEvent(override val queueId: String, val queueSize: Int, override val thread: String) : RunnableBlockingQueueEvent