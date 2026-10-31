package mingazov.kotlinview.ws

import mingazov.kotlinview.event.Event
import mingazov.kotlinview.event.EventSink
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
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
class Broadcaster(
    private val jsonMapper: JsonMapper,
    @Value("\${kotlinview.events.sleep-millis:1000}") private val sleepMillis: Long,
) : EventSink {

    private val log = LoggerFactory.getLogger(javaClass)
    private val sessions = ConcurrentHashMap<String, WebSocketSession>()
    private var seq = 0L

    override fun emit(event: Event) {
        log.info("event: {}", event)
        Thread.sleep(sleepMillis)
        val message = toMessage(++seq, event::class.simpleName!!, event)
        sessions.values.forEach { send(it, message) }
    }


    fun register(session: WebSocketSession) {
        sessions[session.id] = ConcurrentWebSocketSessionDecorator(session, SEND_TIME_LIMIT_MS, BUFFER_SIZE_LIMIT)
    }

    fun unregister(session: WebSocketSession) {
        sessions.remove(session.id)
    }

    private fun toMessage(seq: Long, type: String, data: Any) : TextMessage {
        val message = jsonMapper.writeValueAsString(Envelope(seq, System.currentTimeMillis(), type, data))
        return TextMessage(message)
    }


    private fun send(session: WebSocketSession, message: TextMessage) {
        try {
            session.sendMessage(message)
        } catch (e: Exception) {
            log.warn("WebSocket send failed: {}", session.id, e)
        }
    }

    private companion object {
        const val SEND_TIME_LIMIT_MS = 5_000 // если текущая отправка в эту сессию длится дольше 5 секунд, то клиент считается нерабочим
        const val BUFFER_SIZE_LIMIT = 512 * 1024 // если в очереди накопилось больше 512 KB неотправленных данных, то клиент считается нерабочим
    }
}