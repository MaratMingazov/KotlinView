package mingazov.kotlinview.event

enum class ObjectType {
    ARRAY_LIST_INT,
    LINKED_LIST_INT,
    RUNNABLE_TASK,
    LINKED_BLOCKING_QUEUE_RUNNABLE,
    SYNCHRONOUS_QUEUE_RUNNABLE,
    THREAD_FACTORY,
    THREAD,
    THREAD_POOL_EXECUTOR
}

/** state — начальное состояние объекта: клиент может нарисовать его сразу, не дожидаясь первого вызова метода. */
data class ObjectCreated(val objectType: ObjectType, val objectId: Long, override val thread: String, val state: Any?) : Event
data class ObjectRemoved(val objectType: ObjectType, val objectId: Long, override val thread: String) : Event

data class MethodIn(val objectType: ObjectType, val objectId: Long, override val thread: String, val method: String, val args: Map<String, Any?>, val state: Any?) : Event
data class MethodOut(val objectType: ObjectType, val objectId: Long, override val thread: String, val method: String, val args: Map<String, Any?>, val result: Any?, val state: Any?) : Event
data class MethodOutFailed(val objectType: ObjectType, val objectId: Long, override val thread: String, val method: String, val args: Map<String, Any?>, val error: String, val state: Any?) : Event
/** Поток всё ещё внутри метода. progress — данные этого вызова (например, сколько прошло), state — состояние объекта. */
data class MethodProgress(val objectType: ObjectType, val objectId: Long, override val thread: String, val method: String, val progress: Map<String, Any?>, val state: Any?) : Event