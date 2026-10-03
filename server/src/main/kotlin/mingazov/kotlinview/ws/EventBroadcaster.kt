package mingazov.kotlinview.ws

import mingazov.kotlinview.core.PROTOCOL_VERSION
import mingazov.kotlinview.event.Event
import mingazov.kotlinview.event.EventSink
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import org.springframework.web.socket.TextMessage
import org.springframework.web.socket.WebSocketSession
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator
import tools.jackson.databind.json.JsonMapper
import java.util.concurrent.ConcurrentHashMap

/**
 * EventSink, который рассылает каждое событие всем подключённым WebSocket-клиентам.
 *
 * emit вызывают разные потоки (Tomcat, потоки пула), поэтому:
 *  - emit synchronized: seq выдаётся и сообщение уходит в одном порядке для всех клиентов;
 *  - сессия обёрнута в ConcurrentWebSocketSessionDecorator: обычный sendMessage не потокобезопасен.
 */
@Component
class EventBroadcaster(
    private val jsonMapper: JsonMapper,
) : EventSink {

    private val log = LoggerFactory.getLogger(javaClass)
    private val sessions = ConcurrentHashMap<String, WebSocketSession>()
    private var seq = 0L

    @Synchronized
    override fun emit(event: Event) {
        log.info("event: {}", event)
        val message = toMessage(++seq, event::class.simpleName!!, event)
        sessions.values.forEach { send(it, message) }
    }

    /** Под тем же монитором, что и emit: клиент получает снимок, а следом — все события после него, без пропусков. */
    @Synchronized
    fun register(session: WebSocketSession) {
        val safe = ConcurrentWebSocketSessionDecorator(session, SEND_TIME_LIMIT_MS, BUFFER_SIZE_LIMIT)
        send(safe, toMessage(seq, "SNAPSHOT", SnapshotData(PROTOCOL_VERSION, executors = emptyList())))
        sessions[session.id] = safe
    }

    fun unregister(session: WebSocketSession) {
        sessions.remove(session.id)
    }

    private fun toMessage(seq: Long, type: String, data: Any) =
        TextMessage(jsonMapper.writeValueAsString(Envelope(seq, System.currentTimeMillis(), type, data)))

    private fun send(session: WebSocketSession, message: TextMessage) {
        try {
            session.sendMessage(message)
        } catch (e: Exception) {
            log.warn("WebSocket send failed: {}", session.id, e)
        }
    }

    private companion object {
        const val SEND_TIME_LIMIT_MS = 5_000
        const val BUFFER_SIZE_LIMIT = 512 * 1024
    }
}