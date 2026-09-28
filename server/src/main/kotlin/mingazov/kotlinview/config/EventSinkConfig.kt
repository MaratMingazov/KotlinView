package mingazov.kotlinview.config

import mingazov.kotlinview.event.EventSink
import org.slf4j.LoggerFactory
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration

@Configuration
class EventSinkConfig {

    private val log = LoggerFactory.getLogger(javaClass)

    @Bean
    fun eventSink(): EventSink = EventSink { event -> log.info("event: {}", event) }
}