package mingazov.kotlinview.event

sealed interface QueueEvent : Event {
    val queueId: String
}

data class BeforeOffer(
    override val queueId: String,
    val queueSize: Int, // сколько элементов в очереди после добавления
) : QueueEvent

data class AfterOffer(
    override val queueId: String,
    val accepted: Boolean,
    val queueSize: Int, // сколько элементов в очереди после добавления
) : QueueEvent

data class BeforeTake(
    override val queueId: String,
    val queueSize: Int, // сколько элементов в очереди после извлечения
) : QueueEvent

data class AfterTake(
    override val queueId: String,
    val queueSize: Int, // сколько элементов в очереди после извлечения
) : QueueEvent