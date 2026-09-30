package mingazov.kotlinview.instrumented

import mingazov.kotlinview.event.AfterOffer
import mingazov.kotlinview.event.AfterPoll
import mingazov.kotlinview.event.AfterTake
import mingazov.kotlinview.event.BeforeOffer
import mingazov.kotlinview.event.BeforePoll
import mingazov.kotlinview.event.BeforeTake
import mingazov.kotlinview.event.EventSink
import java.util.concurrent.BlockingQueue
import java.util.concurrent.TimeUnit


/**
 * <E> в Kotlin означает <E : Any?>: тип элемента может быть nullable. С таким объявлением можно было бы написать InstrumentedBlockingQueue<String?>. А <E : Any> разрешает
 *   только ненулевые типы, и E? тогда пишется явно там, где null действительно возможен.
 */
class InstrumentedBlockingQueue<E : Any>(
    private val queueId: String,
    private val delegate: BlockingQueue<E>,
    private val sink: EventSink,
    private val sleepMillis: Long = 0,
) : BlockingQueue<E> by delegate {

    override fun offer(e: E): Boolean {
        sink.emit(BeforeOffer(queueId, delegate.size, Thread.currentThread().name))
        Thread.sleep(sleepMillis)
        val accepted = delegate.offer(e) // неблокирующий вызов. Говорит смог ли положить элемент в очередь
        sink.emit(AfterOffer(queueId, accepted, delegate.size, Thread.currentThread().name))
        Thread.sleep(sleepMillis)
        return accepted
    }

    // TODO: без общего монитора событие onTaken может прийти раньше onOffered
    // Вернуть publishLock перед подключением к серверу.
    override fun take(): E {
        sink.emit(BeforeTake(queueId, delegate.size, Thread.currentThread().name))
        Thread.sleep(sleepMillis)
        val element = delegate.take() // это блокирующий вызов. Если очередь пустая, то поток уснет
        sink.emit(AfterTake(queueId, delegate.size, Thread.currentThread().name))
        Thread.sleep(sleepMillis)
        return element
    }

    override fun poll(): E? {
        sink.emit(BeforePoll(queueId, delegate.size, Thread.currentThread().name))
        Thread.sleep(sleepMillis)
        val element = delegate.poll() // неблокирующий вызов, вернет NULL если очередь пуста
        sink.emit(AfterPoll(queueId, delegate.size, Thread.currentThread().name))
        Thread.sleep(sleepMillis)
        return element
    }

    override fun poll(timeout: Long, unit: TimeUnit): E? {
        sink.emit(BeforePoll(queueId, delegate.size, Thread.currentThread().name))
        Thread.sleep(sleepMillis)
        val element = delegate.poll(timeout, unit) // блокирующий: ждёт не дольше timeout, потом вернёт null
        sink.emit(AfterPoll(queueId, delegate.size, Thread.currentThread().name))
        Thread.sleep(sleepMillis)
        return element
    }

}