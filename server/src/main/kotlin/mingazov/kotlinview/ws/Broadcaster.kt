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
    private var seq = 0L

    override fun emit(event: Event) {
        log.info("event: {}", event)
        val time = System.currentTimeMillis()
        val payload = WebSocketMapper.toPayload(event) ?: return // событие не входит в протокол
        val message = toMessage(++seq, payload, time)
        Thread.sleep(sleepMillis)
        sessionRegistry.sendToAll(message)
    }

    private fun toMessage(seq: Long, data: Payload, time: Long) : TextMessage {
        val message = jsonMapper.writeValueAsString(Envelope(seq, time, data))
        return TextMessage(message)
    }
}