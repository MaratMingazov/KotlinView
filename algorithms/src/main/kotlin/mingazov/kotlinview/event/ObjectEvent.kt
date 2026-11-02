package mingazov.kotlinview.event

enum class ObjectType { ARRAY_LIST_INT, LINKED_LIST_INT }

data class ObjectCreated(val objectType: ObjectType, val objectId: Long, override val thread: String) : Event
data class ObjectRemoved(val objectType: ObjectType, val objectId: Long, override val thread: String) : Event

data class MethodIn(val objectType: ObjectType, val objectId: Long, override val thread: String, val method: String, val args: Map<String, Any?>, val state: Any?) : Event
data class MethodOut(val objectType: ObjectType, val objectId: Long, override val thread: String, val method: String, val args: Map<String, Any?>, val result: Any?, val state: Any?) : Event
data class MethodOutFailed(val objectType: ObjectType, val objectId: Long, override val thread: String, val method: String, val args: Map<String, Any?>, val error: String, val state: Any?) : Event