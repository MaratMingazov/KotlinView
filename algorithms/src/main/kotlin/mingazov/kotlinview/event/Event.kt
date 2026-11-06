package mingazov.kotlinview.event

/**
 * Любое событие, которое алгоритм сообщает наружу.
 * sealed: все виды событий известны компилятору — их список в ObjectEvent.kt (тот же пакет).
 * Поэтому WebSocketMapper обязан перевести каждое: новое событие без payload'а не скомпилируется.
 */
sealed interface Event {
    val thread: String
}

/** Куда алгоритм отдаёт события: в консоль, в WebSocket, в тест. */
fun interface EventSink {
    fun emit(event: Event)
}