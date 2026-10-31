package mingazov.kotlinview.ws

import mingazov.kotlinview.event.Event
import mingazov.kotlinview.event.EventSink
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component
import org.springframework.web.socket.TextMessage
import tools.jackson.databind.json.JsonMapper


@Component
class Broadcaster(
    private val jsonMapper: JsonMapper,
    private val sessionRegistry: SessionRegistry,
    @Value("\${kotlinview.events.sleep-millis:1000}") private val sleepMillis: Long,
) : EventSink {

    private val log = LoggerFactory.getLogger(javaClass)
    private var seq = 0L

    override fun emit(event: Event) {
        log.info("event: {}", event)
        Thread.sleep(sleepMillis)
        val message = toMessage(++seq, event::class.simpleName!!, event)
        sessionRegistry.sendToAll(message)
    }

    private fun toMessage(seq: Long, type: String, data: Any) : TextMessage {
        val message = jsonMapper.writeValueAsString(Envelope(seq, System.currentTimeMillis(), type, data))
        return TextMessage(message)
    }
}