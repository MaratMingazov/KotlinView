package mingazov.kotlinview.ws

import mingazov.kotlinview.event.Event
import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.ws.protocol.Envelope
import mingazov.kotlinview.ws.protocol.Payload
import mingazov.kotlinview.ws.protocol.WebSocketMapper
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component
import org.springframework.web.socket.TextMessage
import tools.jackson.databind.json.JsonMapper


@Component
class Broadcaster(
    private val jsonMapper: JsonMapper,
    private val sessionRegistry: SessionRegistry,
    @Value("\${kotlinview.events.sleep-millis:0}") private val sleepMillis: Long,
) : EventSink {

    private val log = LoggerFactory.getLogger(javaClass)
    private val sendLock = Any()
    private var seq = 0L // меняется только под sendLock

    // emit зовут разные потоки: HTTP, воркеры пула, потоки задач
    override fun emit(event: Event) {
        log.info("event: {}", event)
        val time = System.currentTimeMillis() // время события, а не отправки
        val payload = WebSocketMapper.toPayload(event)
        // Пауза — вне замка: в замедленном режиме потоки спят параллельно, а не по очереди на весь сервер
        Thread.sleep(sleepMillis)
        // Номер и отправка — один шаг: клиент получает события строго по возрастанию seq, без повторов
        synchronized(sendLock) {
            sessionRegistry.sendToAll(toMessage(++seq, payload, time))
        }
    }

    private fun toMessage(seq: Long, data: Payload, time: Long) : TextMessage {
        val message = jsonMapper.writeValueAsString(Envelope(seq, time, data))
        return TextMessage(message)
    }
}