package mingazov.kotlinview.event

sealed interface RunnableBlockingQueueEvent : Event {
    val queueId: Long
}

data class RunnableBlockingQueueOfferInEvent(override val queueId: Long, val queueSize: Int, override val thread: String, val taskId: Long) : RunnableBlockingQueueEvent
data class RunnableBlockingQueueOfferOutEvent(override val queueId: Long, val accepted: Boolean, val queueSize: Int, override val thread: String, val taskId: Long) : RunnableBlockingQueueEvent

data class RunnableBlockingQueueTakeInEvent(override val queueId: Long, val queueSize: Int, override val thread: String) : RunnableBlockingQueueEvent
data class RunnableBlockingQueueTakeOutEvent(override val queueId: Long, val queueSize: Int, override val thread: String, val taskId: Long) : RunnableBlockingQueueEvent