package mingazov.kotlinview.event

sealed interface QueueEvent : Event {
    val queueId: String
}

data class QueueCreated(override val queueId: String, val capacity: Int) : QueueEvent
data class QueueRemoved(override val queueId: String) : QueueEvent

data class BeforeOffer(override val queueId: String, val queueSize: Int) : QueueEvent
data class AfterOffer(override val queueId: String, val accepted: Boolean, val queueSize: Int) : QueueEvent

data class BeforeTake(override val queueId: String, val queueSize: Int) : QueueEvent
data class AfterTake(override val queueId: String, val queueSize: Int) : QueueEvent

data class BeforePoll(override val queueId: String, val queueSize: Int) : QueueEvent
data class AfterPoll(override val queueId: String, val queueSize: Int) : QueueEvent