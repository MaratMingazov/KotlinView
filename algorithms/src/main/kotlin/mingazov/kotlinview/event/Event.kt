package mingazov.kotlinview.event

/** Любое событие, которое алгоритм сообщает наружу. */
interface Event{
    val thread: String
}

/** Куда алгоритм отдаёт события: в консоль, в WebSocket, в тест. */
fun interface EventSink {
    fun emit(event: Event)
}