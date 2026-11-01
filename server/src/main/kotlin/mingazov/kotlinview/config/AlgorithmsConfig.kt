package mingazov.kotlinview.config

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.instrumented.collection.InstrumentedArrayListIntRegistry
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration

@Configuration
class AlgorithmsConfig {

    @Bean
    fun arrayListIntRegistry(sink: EventSink) = InstrumentedArrayListIntRegistry(sink)
}