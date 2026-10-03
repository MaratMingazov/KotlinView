package mingazov.kotlinview.ws

import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.web.socket.config.annotation.EnableWebSocket
import org.springframework.web.socket.config.annotation.WebSocketConfigurer
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry

@Configuration
@EnableWebSocket // включаем поддержку веб сокетоы
class WebSocketConfig(
    private val broadcaster: EventBroadcaster,
) : WebSocketConfigurer {

    @Bean
    fun eventsHandler(): EventsWebSocketHandler = EventsWebSocketHandler(broadcaster)

    override fun registerWebSocketHandlers(registry: WebSocketHandlerRegistry) {
        registry.addHandler(eventsHandler(), "/ws/events") // связываем адрес /ws/events с нашим обработчиком
    }
}