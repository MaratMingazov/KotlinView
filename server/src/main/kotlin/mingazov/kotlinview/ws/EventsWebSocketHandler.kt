package mingazov.kotlinview.ws

import org.slf4j.LoggerFactory
import org.springframework.web.socket.CloseStatus
import org.springframework.web.socket.WebSocketSession
import org.springframework.web.socket.handler.TextWebSocketHandler

data class Envelope(
    val seq: Long,
    val ts: Long,
    val type: String,
    val data: Any,
)

data class SnapshotData(
    val protocolVersion: Int,
    val executors: List<Any>,
)

/**
 * TextWebSocketHandler — базовый класс Spring для WebSocket с текстовыми сообщениями. Переопределяем то, что нужно:
 *  - afterConnectionEstablished — клиент подключился: broadcaster шлёт ему снимок и дальше все события;
 *  - afterConnectionClosed — клиент отключился.
 */
class EventsWebSocketHandler(
    private val broadcaster: EventBroadcaster,
) : TextWebSocketHandler() {

    private val log = LoggerFactory.getLogger(javaClass)

    override fun afterConnectionEstablished(session: WebSocketSession) {
        log.info("WebSocket connected: {}", session.id)
        broadcaster.register(session)
    }

    override fun afterConnectionClosed(session: WebSocketSession, status: CloseStatus) {
        log.info("WebSocket closed: {} {}", session.id, status)
        broadcaster.unregister(session)
    }
}