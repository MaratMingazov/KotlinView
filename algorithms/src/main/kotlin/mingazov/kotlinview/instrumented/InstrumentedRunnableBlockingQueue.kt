package mingazov.kotlinview.instrumented

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.RunnableBlockingQueueOfferInEvent
import mingazov.kotlinview.event.RunnableBlockingQueueOfferOutEvent
import mingazov.kotlinview.event.RunnableBlockingQueueTakeInEvent
import mingazov.kotlinview.event.RunnableBlockingQueueTakeOutEvent
import java.util.concurrent.BlockingQueue
import java.util.concurrent.LinkedBlockingQueue


class InstrumentedRunnableBlockingQueue private constructor(
    val id: Long,
    private val delegate: BlockingQueue<Runnable>,
    private val sink: EventSink,
) : BlockingQueue<Runnable> by delegate {

    constructor(id: Long, capacity: Int, sink: EventSink) : this(id, LinkedBlockingQueue(capacity), sink)

    override fun offer(runnable: Runnable): Boolean {
        sink.emit(RunnableBlockingQueueOfferInEvent(id, delegate.size, Thread.currentThread().name))
        val accepted = delegate.offer(runnable) // неблокирующий вызов. Говорит смог ли положить элемент в очередь
        sink.emit(RunnableBlockingQueueOfferOutEvent(id, accepted, delegate.size, Thread.currentThread().name))
        return accepted
    }

    // TODO: без общего монитора событие onTaken может прийти раньше onOffered
    override fun take(): Runnable {
        sink.emit(RunnableBlockingQueueTakeInEvent(id, delegate.size, Thread.currentThread().name))
        val element = delegate.take() // это блокирующий вызов. Если очередь пустая, то поток уснет
        sink.emit(RunnableBlockingQueueTakeOutEvent(id, delegate.size, Thread.currentThread().name))
        return element
    }

}