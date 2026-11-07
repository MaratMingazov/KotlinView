package mingazov.kotlinview.instrumented

import java.util.concurrent.atomic.AtomicLong

/**
 * Один счётчик id на все реестры: id уникален среди всех объектов, а не только своего типа.
 * Тогда ссылка вроде queueId в состоянии пула однозначна, какого бы типа ни была очередь.
 * Исключение — потоки (THREAD): их objectId — threadId() самой JVM, мимо этого счётчика.
 */
class IdGenerator {
    private val ids = AtomicLong()

    fun nextId(): Long = ids.incrementAndGet()
}