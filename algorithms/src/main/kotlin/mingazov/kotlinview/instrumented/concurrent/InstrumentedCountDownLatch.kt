package mingazov.kotlinview.instrumented.concurrent

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ObjectType
import mingazov.kotlinview.instrumented.Instrumented
import mingazov.kotlinview.instrumented.MethodEvents
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * CountDownLatch: одноразовые ворота со счётчиком (внутри — AQS в shared-режиме: state = count). await ждёт, пока
 * count не станет 0; countDown уменьшает его на 1 и сам не ждёт никогда. На переходе в 0 просыпаются все ждущие —
 * цепочкой: первый будит следующего. Сбросить нельзя: при 0 countDown ничего не делает, await возвращается сразу.
 * Владельца нет: countDown может вызвать любой поток, latch считает вызовы, а не потоки.
 *
 * Наследование, а не делегирование: интерфейса у CountDownLatch нет, а класс и методы не final — как
 * InstrumentedSemaphore. Очередь ждущих latch не отдаёт (ни public, ни protected): кто ждёт, клиент видит по парам
 * METHOD_IN / METHOD_OUT у await.
 *
 * Обе перегрузки await — одно имя в событиях (у ждущего с таймаутом — timeoutMs в args). Двойных событий нет:
 * в JDK каждая перегрузка сразу идёт в sync, а не в соседнюю.
 * Результата у countDown нет (null): открыл ли он ворота, видно по count в снимках — на IN 1, на OUT 0;
 * лишний countDown — 0 и 0.
 */
class InstrumentedCountDownLatch(
    override val id: Long,
    sink: EventSink,
    private val initialCount: Int, // геттера у CountDownLatch нет; < 0 JDK запрещает сам (IllegalArgumentException)
) : CountDownLatch(initialCount), Instrumented {

    /**
     * События вызовов. Снимок state и отправка — под одним замком (lock): countDown и проснувшиеся await идут
     * параллельно, и без замка более старый снимок мог бы уйти последним. Сами операции — вне замка: ждущий в await
     * никого не держит. METHOD_OUT_FAILED у await — InterruptedException: прервали, пока ждал
     */
    private val events = MethodEvents(TYPE, id, sink, ::state, lock = Any())

    // Блокирующий: ждёт, пока count не станет 0; при 0 — сразу
    override fun await() = events.call("await", emptyMap()) { super.await() }

    // То же, но не дольше timeout: false — не дождался
    override fun await(timeout: Long, unit: TimeUnit) =
        events.call("await", mapOf("timeoutMs" to unit.toMillis(timeout))) { super.await(timeout, unit) }

    // Неблокирующий: count − 1, на переходе в 0 — разбудить ждущих. При 0 — ничего
    override fun countDown() = events.call("countDown", emptyMap()) { super.countDown() }

    /** Состояние для событий. count — точно (это volatile state AQS) */
    override fun state(): Map<String, Any?> = mapOf(
        "initialCount" to initialCount,
        "count" to count,
    )

    private companion object {
        val TYPE = ObjectType.COUNT_DOWN_LATCH
    }
}
