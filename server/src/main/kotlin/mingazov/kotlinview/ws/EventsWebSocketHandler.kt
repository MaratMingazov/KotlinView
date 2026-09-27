package mingazov.kotlinview.ws

import org.slf4j.LoggerFactory
import org.springframework.web.socket.CloseStatus
import org.springframework.web.socket.TextMessage
import org.springframework.web.socket.WebSocketSession
import org.springframework.web.socket.handler.TextWebSocketHandler
import tools.jackson.databind.json.JsonMapper

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
 *  - afterConnectionEstablished — клиент подключился, первым сообщением шлём снимок;
 *  - afterConnectionClosed — клиент отключился.
 */
class EventsWebSocketHandler(
    private val jsonMapper: JsonMapper,
) : TextWebSocketHandler() {

    private val log = LoggerFactory.getLogger(javaClass)

    override fun afterConnectionEstablished(session: WebSocketSession) {
        log.info("WebSocket connected: {}", session.id)
        val snapshot = Envelope(
            seq = 0,
            ts = System.currentTimeMillis(),
            type = "SNAPSHOT",
            data = SnapshotData(protocolVersion = 1, executors = emptyList()),
        )
        session.sendMessage(TextMessage(jsonMapper.writeValueAsString(snapshot)))
    }

    override fun afterConnectionClosed(session: WebSocketSession, status: CloseStatus) {
        log.info("WebSocket closed: {} {}", session.id, status)
    }
}