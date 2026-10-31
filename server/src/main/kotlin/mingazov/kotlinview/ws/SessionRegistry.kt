package mingazov.kotlinview.ws

import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import org.springframework.web.socket.TextMessage
import org.springframework.web.socket.WebSocketSession
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator
import java.util.concurrent.ConcurrentHashMap

@Component
class SessionRegistry {

    private val log = LoggerFactory.getLogger(javaClass)
    private val sessions = ConcurrentHashMap<String, WebSocketSession>()

    fun register(session: WebSocketSession) {
        sessions[session.id] = ConcurrentWebSocketSessionDecorator(session, SEND_TIME_LIMIT_MS, BUFFER_SIZE_LIMIT)
    }

    fun unregister(session: WebSocketSession) {
        sessions.remove(session.id)
    }

    private fun send(session: WebSocketSession, message: TextMessage) {
        try {
            session.sendMessage(message)
        } catch (e: Exception) {
            log.warn("WebSocket send failed: {}", session.id, e)
        }
    }

    fun sendToAll(message: TextMessage) {
        sessions.values.forEach { send(it, message) }
    }

    private companion object {
        const val SEND_TIME_LIMIT_MS = 5_000 // если текущая отправка в эту сессию длится дольше 5 секунд, то клиент считается нерабочим
        const val BUFFER_SIZE_LIMIT = 512 * 1024 // если в очереди накопилось больше 512 KB неотправленных данных, то клиент считается нерабочим
    }
}