package mingazov.kotlinview.instrumented

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.ObjectCreated
import mingazov.kotlinview.event.ObjectRemoved
import mingazov.kotlinview.event.ObjectType
import java.util.concurrent.ConcurrentHashMap

/**
 * Жизненный цикл объектов одного типа: выдать id, хранить, найти, удалить — и сообщить об этом OBJECT_CREATED / OBJECT_REMOVED.
 * Наследник добавляет только свой create(...) поверх register: как построить объект, знает он, а не реестр.
 * Объекта нет — ObjectNotFoundException: в server он один на все реестры превращается в 404 (ErrorHandlers).
 * idGenerator — общий на все реестры (бин в server), чтобы id не совпадали у объектов разных типов.
 * По умолчанию свой: одиночному реестру (тесты, playground) ничего передавать не нужно.
 */
open class InstrumentedRegistry<T : Instrumented>(
    private val objectType: ObjectType,
    protected val sink: EventSink,
    private val idGenerator: IdGenerator = IdGenerator(),
) {
    private val items = ConcurrentHashMap<Long, T>()

    /** Выдать id, построить объект, запомнить и сообщить OBJECT_CREATED с его начальным состоянием. */
    protected fun register(create: (id: Long) -> T): T {
        val item = create(idGenerator.nextId())
        items[item.id] = item
        sink.emit(ObjectCreated(objectType, item.id, Thread.currentThread().name, item.state()))
        return item
    }

    fun get(id: Long): T = items[id] ?: throw ObjectNotFoundException(objectType, id)

    fun remove(id: Long) {
        items.remove(id) ?: throw ObjectNotFoundException(objectType, id)
        sink.emit(ObjectRemoved(objectType, id, Thread.currentThread().name))
    }

    fun all(): Collection<T> = items.values
}

class ObjectNotFoundException(val objectType: ObjectType, val id: Long) : NoSuchElementException("$objectType $id not found")