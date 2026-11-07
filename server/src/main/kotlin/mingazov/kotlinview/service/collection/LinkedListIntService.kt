package mingazov.kotlinview.service.collection

import mingazov.kotlinview.instrumented.collection.registry.InstrumentedLinkedListIntRegistry
import org.springframework.stereotype.Service

@Service
class LinkedListIntService(private val registry: InstrumentedLinkedListIntRegistry) {

    fun create() = registry.create()
    fun get(id: Long) = registry.get(id)
    fun remove(id: Long) = registry.remove(id)
    fun all() = registry.all()
}