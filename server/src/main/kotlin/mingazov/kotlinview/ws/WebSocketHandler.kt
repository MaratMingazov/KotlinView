package mingazov.kotlinview.ws

import org.slf4j.LoggerFactory
import org.springframework.web.socket.CloseStatus
import org.springframework.web.socket.TextMessage
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


class WebSocketHandler(
    private val sessionRegistry: SessionRegistry,
) : TextWebSocketHandler() {

    private val log = LoggerFactory.getLogger(javaClass)

    override fun afterConnectionEstablished(session: WebSocketSession) {
        log.info("WebSocket connected: {}", session.id)
        sessionRegistry.register(session)
    }

    override fun afterConnectionClosed(session: WebSocketSession, status: CloseStatus) {
        log.info("WebSocket closed: {} {}", session.id, status)
        sessionRegistry.unregister(session)
    }

    override fun handleTextMessage(session: WebSocketSession, message: TextMessage) {
        // Это когда клиент по веб сокету прислал сообщение
        // У нас такого пока нет.
        log.info("from {}: {}", session.id, message.payload)
    }
}