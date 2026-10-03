package mingazov.kotlinview.instrumented

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.RunnableBlockingQueueOfferInEvent
import mingazov.kotlinview.event.RunnableBlockingQueueOfferOutEvent
import mingazov.kotlinview.event.RunnableBlockingQueueTakeInEvent
import mingazov.kotlinview.event.RunnableBlockingQueueTakeOutEvent
import java.util.concurrent.BlockingQueue
import java.util.concurrent.LinkedBlockingQueue


class InstrumentedRunnableBlockingQueue private constructor(
    val queueId: String,
    private val delegate: BlockingQueue<Runnable>,
    private val sink: EventSink,
    private val sleepMillis: Long,
) : BlockingQueue<Runnable> by delegate {

    constructor(queueId: String, capacity: Int, sink: EventSink, sleepMillis: Long = 0) : this(queueId, LinkedBlockingQueue(capacity), sink, sleepMillis)

    override fun offer(runnable: Runnable): Boolean {
        sink.emit(RunnableBlockingQueueOfferInEvent(queueId, delegate.size, Thread.currentThread().name))
        Thread.sleep(sleepMillis)
        val accepted = delegate.offer(runnable) // неблокирующий вызов. Говорит смог ли положить элемент в очередь
        sink.emit(RunnableBlockingQueueOfferOutEvent(queueId, accepted, delegate.size, Thread.currentThread().name))
        return accepted
    }

    // TODO: без общего монитора событие onTaken может прийти раньше onOffered
    override fun take(): Runnable {
        sink.emit(RunnableBlockingQueueTakeInEvent(queueId, delegate.size, Thread.currentThread().name))
        Thread.sleep(sleepMillis)
        val element = delegate.take() // это блокирующий вызов. Если очередь пустая, то поток уснет
        sink.emit(RunnableBlockingQueueTakeOutEvent(queueId, delegate.size, Thread.currentThread().name))
        Thread.sleep(sleepMillis)
        return element
    }

}