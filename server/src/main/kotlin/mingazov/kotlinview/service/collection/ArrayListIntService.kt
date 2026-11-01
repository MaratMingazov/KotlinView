package mingazov.kotlinview.service.collection

import mingazov.kotlinview.instrumented.collection.InstrumentedArrayListIntRegistry
import org.springframework.stereotype.Service

@Service
class ArrayListIntService(private val registry: InstrumentedArrayListIntRegistry) {

    fun create() = registry.create()
    fun get(id: Long) = registry.get(id)
    fun remove(id: Long) = registry.remove(id)
    fun all() = registry.all()
}