package mingazov.kotlinview.instrumented

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.RunnableBlockingQueueOfferInEvent
import mingazov.kotlinview.event.RunnableBlockingQueueOfferOutEvent
import mingazov.kotlinview.event.RunnableBlockingQueueTakeInEvent
import mingazov.kotlinview.event.RunnableBlockingQueueTakeOutEvent
import java.util.concurrent.BlockingQueue
import java.util.concurrent.LinkedBlockingQueue


class InstrumentedRunnableBlockingQueue private constructor(
    val id: String,
    private val delegate: BlockingQueue<Runnable>,
    private val sink: EventSink,
    private val sleepMillis: Long,
) : BlockingQueue<Runnable> by delegate {

    constructor(id: String, capacity: Int, sink: EventSink, sleepMillis: Long) : this(id, LinkedBlockingQueue(capacity), sink, sleepMillis)

    override fun offer(runnable: Runnable): Boolean {
        sink.emit(RunnableBlockingQueueOfferInEvent(id, delegate.size, Thread.currentThread().name))
        Thread.sleep(sleepMillis)
        val accepted = delegate.offer(runnable) // неблокирующий вызов. Говорит смог ли положить элемент в очередь
        sink.emit(RunnableBlockingQueueOfferOutEvent(id, accepted, delegate.size, Thread.currentThread().name))
        return accepted
    }

    // TODO: без общего монитора событие onTaken может прийти раньше onOffered
    override fun take(): Runnable {
        sink.emit(RunnableBlockingQueueTakeInEvent(id, delegate.size, Thread.currentThread().name))
        Thread.sleep(sleepMillis)
        val element = delegate.take() // это блокирующий вызов. Если очередь пустая, то поток уснет
        sink.emit(RunnableBlockingQueueTakeOutEvent(id, delegate.size, Thread.currentThread().name))
        Thread.sleep(sleepMillis)
        return element
    }

}