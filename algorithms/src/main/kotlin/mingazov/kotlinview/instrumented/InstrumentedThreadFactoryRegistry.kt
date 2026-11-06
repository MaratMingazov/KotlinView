package mingazov.kotlinview.instrumented

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ObjectCreated
import mingazov.kotlinview.event.ObjectRemoved
import mingazov.kotlinview.event.ObjectType
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

class InstrumentedThreadFactoryRegistry(private val sink: EventSink) {

    private val factories = ConcurrentHashMap<Long, InstrumentedThreadFactory>()
    private val ids = AtomicLong()

    fun create(): InstrumentedThreadFactory {
        val factory = InstrumentedThreadFactory(ids.incrementAndGet(), sink)
        factories[factory.id] = factory
        sink.emit(ObjectCreated(ObjectType.THREAD_FACTORY, factory.id, Thread.currentThread().name, factory.state()))
        return factory
    }

    fun get(id: Long): InstrumentedThreadFactory =
        factories[id] ?: throw ThreadFactoryNotFoundException(id)

    fun remove(id: Long) {
        factories.remove(id) ?: throw ThreadFactoryNotFoundException(id)
        sink.emit(ObjectRemoved(ObjectType.THREAD_FACTORY, id, Thread.currentThread().name))
    }

    fun all(): Collection<InstrumentedThreadFactory> = factories.values
}

class ThreadFactoryNotFoundException(id: Long) : NoSuchElementException("ThreadFactory $id not found")