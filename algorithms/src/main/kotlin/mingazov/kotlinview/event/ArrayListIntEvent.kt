package mingazov.kotlinview.event

sealed interface ArrayListIntEvent: Event {
    val arrayListId: Long
}

data class ArrayListIntCreated(override val arrayListId: Long, override val thread: String) : ArrayListIntEvent
data class ArrayListIntRemoved(override val arrayListId: Long, override val thread: String) : ArrayListIntEvent

data class ArrayListIntAddIn(override val arrayListId: Long, override val thread: String, val element: Int, val elements: List<Int>) : ArrayListIntEvent
data class ArrayListIntAddOut(override val arrayListId: Long, override val thread: String, val element: Int, val elements: List<Int>) : ArrayListIntEvent
data class ArrayListIntAddOutFailed(override val arrayListId: Long, override val thread: String, val element: Int, val error: String, val elements: List<Int>) : ArrayListIntEvent

data class ArrayListIntGetIn(override val arrayListId: Long, override val thread: String, val index: Int, val elements: List<Int>) : ArrayListIntEvent
data class ArrayListIntGetOut(override val arrayListId: Long, override val thread: String, val index: Int, val element: Int, val elements: List<Int>) : ArrayListIntEvent
data class ArrayListIntGetOutFailed(override val arrayListId: Long, override val thread: String, val index: Int, val error: String, val elements: List<Int>) : ArrayListIntEvent
