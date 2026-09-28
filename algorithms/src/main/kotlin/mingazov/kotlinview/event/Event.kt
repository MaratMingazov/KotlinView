package mingazov.kotlinview.event

/** Любое событие, которое алгоритм сообщает наружу. */
interface Event

/** Куда алгоритм отдаёт события: в консоль, в WebSocket, в тест. */
fun interface EventSink {
    fun emit(event: Event)
}