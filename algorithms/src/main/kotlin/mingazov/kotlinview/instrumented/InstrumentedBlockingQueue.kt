package mingazov.kotlinview.instrumented

import java.util.concurrent.BlockingQueue
import java.util.concurrent.TimeUnit

/**
 * Что происходит с очередью. Методы вызываются в потоке, который работает с очередью:
 * onOffered — в потоке отправителя, остальные — в потоке получателя.
 */
interface BlockingQueueListener<E> {
    fun onOffered(element: E, accepted: Boolean, sizeAfter: Int) {}
    fun onWaiting() {}
    fun onTaken(element: E, sizeAfter: Int) {}
    fun onTimedOut() {}
}

/**
 * <E> в Kotlin означает <E : Any?>: тип элемента может быть nullable. С таким объявлением можно было бы написать InstrumentedBlockingQueue<String?>. А <E : Any> разрешает
 *   только ненулевые типы, и E? тогда пишется явно там, где null действительно возможен.
 */
class InstrumentedBlockingQueue<E : Any>(
    private val delegate: BlockingQueue<E>,
    private val listener: BlockingQueueListener<E>,
) : BlockingQueue<E> by delegate {

    override fun offer(e: E): Boolean {
        val accepted = delegate.offer(e) // неблокирующий вызов. Говорит смог ли положить элемент в очередь
        listener.onOffered(e, accepted, delegate.size)
        return accepted
    }

    // TODO: без общего монитора событие onTaken может прийти раньше onOffered
    // Вернуть publishLock перед подключением к серверу.
    override fun take(): E {
        listener.onWaiting()
        val element = delegate.take() // это блокирующий вызов. Если очередь пустая, то поток уснет
        listener.onTaken(element, delegate.size)
        return element
    }

    override fun poll(timeout: Long, unit: TimeUnit): E? {
        listener.onWaiting()
        val element = delegate.poll(timeout, unit) // это блокирующий вызов. Если очередь пустая, то поток уснет и будет ждать отведенное время
        if (element == null)
            listener.onTimedOut()
        else
            listener.onTaken(element, delegate.size)
        return element
    }

}