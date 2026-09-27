package mingazov.kotlinview.ws

import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.web.socket.config.annotation.EnableWebSocket
import org.springframework.web.socket.config.annotation.WebSocketConfigurer
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry
import tools.jackson.databind.json.JsonMapper

@Configuration
@EnableWebSocket // включаем поддержку веб сокетоы
class WebSocketConfig(
    private val jsonMapper: JsonMapper,
) : WebSocketConfigurer {

    @Bean
    fun eventsHandler(): EventsWebSocketHandler = EventsWebSocketHandler(jsonMapper)

    override fun registerWebSocketHandlers(registry: WebSocketHandlerRegistry) {
        registry.addHandler(eventsHandler(), "/ws/events") // связываем адрес /ws/events с нашим обработчиком
    }
}