package mingazov.kotlinview.instrumented

import mingazov.kotlinview.event.AfterOffer
import mingazov.kotlinview.event.AfterTake
import mingazov.kotlinview.event.BeforeOffer
import mingazov.kotlinview.event.BeforeTake
import mingazov.kotlinview.event.EventSink
import java.util.concurrent.BlockingQueue


/**
 * <E> в Kotlin означает <E : Any?>: тип элемента может быть nullable. С таким объявлением можно было бы написать InstrumentedBlockingQueue<String?>. А <E : Any> разрешает
 *   только ненулевые типы, и E? тогда пишется явно там, где null действительно возможен.
 */
class InstrumentedBlockingQueue<E : Any>(
    private val queueId: String,
    private val delegate: BlockingQueue<E>,
    private val sink: EventSink,
) : BlockingQueue<E> by delegate {

    override fun offer(e: E): Boolean {
        sink.emit(BeforeOffer(queueId, delegate.size))
        val accepted = delegate.offer(e) // неблокирующий вызов. Говорит смог ли положить элемент в очередь
        sink.emit(AfterOffer(queueId, accepted, delegate.size))
        return accepted
    }

    // TODO: без общего монитора событие onTaken может прийти раньше onOffered
    // Вернуть publishLock перед подключением к серверу.
    override fun take(): E {
        sink.emit(BeforeTake(queueId, delegate.size))
        val element = delegate.take() // это блокирующий вызов. Если очередь пустая, то поток уснет
        sink.emit(AfterTake(queueId, delegate.size))
        return element
    }

}