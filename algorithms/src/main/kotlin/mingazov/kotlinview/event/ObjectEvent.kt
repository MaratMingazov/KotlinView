package mingazov.kotlinview.event

enum class ObjectType { ARRAY_LIST_INT, LINKED_LIST_INT }

data class ObjectCreated(val objectType: ObjectType, val objectId: Long, override val thread: String) : Event
data class ObjectRemoved(val objectType: ObjectType, val objectId: Long, override val thread: String) : Event