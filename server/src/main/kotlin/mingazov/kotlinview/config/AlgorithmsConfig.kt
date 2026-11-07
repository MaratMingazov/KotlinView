package mingazov.kotlinview.config

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.instrumented.collection.InstrumentedArrayListIntRegistry
import mingazov.kotlinview.instrumented.IdGenerator
import mingazov.kotlinview.instrumented.InstrumentedLinkedBlockingQueueRunnableRegistry
import mingazov.kotlinview.instrumented.InstrumentedRunnableTaskRegistry
import mingazov.kotlinview.instrumented.InstrumentedSynchronousQueueRunnableRegistry
import mingazov.kotlinview.instrumented.InstrumentedThreadFactoryRegistry
import mingazov.kotlinview.instrumented.InstrumentedThreadPoolExecutorRegistry
import mingazov.kotlinview.instrumented.collection.InstrumentedLinkedListIntRegistry
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration

@Configuration
class AlgorithmsConfig {

    // Один счётчик id на все реестры: id уникален среди всех объектов, а не только своего типа
    @Bean
    fun idGenerator() = IdGenerator()

    @Bean
    fun arrayListIntRegistry(sink: EventSink, ids: IdGenerator) = InstrumentedArrayListIntRegistry(sink, ids)

    @Bean
    fun linkedListIntRegistry(sink: EventSink, ids: IdGenerator) = InstrumentedLinkedListIntRegistry(sink, ids)

    @Bean
    fun runnableTaskRegistry(sink: EventSink, ids: IdGenerator) = InstrumentedRunnableTaskRegistry(sink, ids)

    @Bean
    fun linkedBlockingQueueRunnableRegistry(sink: EventSink, ids: IdGenerator) = InstrumentedLinkedBlockingQueueRunnableRegistry(sink, ids)

    @Bean
    fun synchronousQueueRunnableRegistry(sink: EventSink, ids: IdGenerator) = InstrumentedSynchronousQueueRunnableRegistry(sink, ids)

    @Bean
    fun threadFactoryRegistry(sink: EventSink, ids: IdGenerator) = InstrumentedThreadFactoryRegistry(sink, ids)

    @Bean
    fun threadPoolExecutorRegistry(sink: EventSink, ids: IdGenerator) = InstrumentedThreadPoolExecutorRegistry(sink, ids)
}