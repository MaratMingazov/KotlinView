package mingazov.kotlinview.config

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.instrumented.collection.InstrumentedArrayListIntRegistry
import mingazov.kotlinview.instrumented.InstrumentedLinkedBlockingQueueRunnableRegistry
import mingazov.kotlinview.instrumented.InstrumentedRunnableTaskRegistry
import mingazov.kotlinview.instrumented.InstrumentedThreadFactoryRegistry
import mingazov.kotlinview.instrumented.InstrumentedThreadPoolExecutorRegistry
import mingazov.kotlinview.instrumented.collection.InstrumentedLinkedListIntRegistry
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration

@Configuration
class AlgorithmsConfig {

    @Bean
    fun arrayListIntRegistry(sink: EventSink) = InstrumentedArrayListIntRegistry(sink)

    @Bean
    fun linkedListIntRegistry(sink: EventSink) = InstrumentedLinkedListIntRegistry(sink)

    @Bean
    fun runnableTaskRegistry(sink: EventSink) = InstrumentedRunnableTaskRegistry(sink)

    @Bean
    fun linkedBlockingQueueRunnableRegistry(sink: EventSink) = InstrumentedLinkedBlockingQueueRunnableRegistry(sink)

    @Bean
    fun threadFactoryRegistry(sink: EventSink) = InstrumentedThreadFactoryRegistry(sink)

    @Bean
    fun threadPoolExecutorRegistry(sink: EventSink) = InstrumentedThreadPoolExecutorRegistry(sink)
}