package mingazov.kotlinview.event

sealed interface ArrayListIntEvent: Event {
    val arrayListId: Long
}


data class ArrayListIntAddIn(override val arrayListId: Long, override val thread: String, val element: Int, val elements: List<Int>) : ArrayListIntEvent
data class ArrayListIntAddOut(override val arrayListId: Long, override val thread: String, val element: Int, val elements: List<Int>) : ArrayListIntEvent
data class ArrayListIntAddOutFailed(override val arrayListId: Long, override val thread: String, val element: Int, val error: String, val elements: List<Int>) : ArrayListIntEvent

data class ArrayListIntAddAtIn(override val arrayListId: Long, override val thread: String, val index: Int, val element: Int, val elements: List<Int>) : ArrayListIntEvent
data class ArrayListIntAddAtOut(override val arrayListId: Long, override val thread: String, val index: Int, val element: Int, val elements: List<Int>) : ArrayListIntEvent
data class ArrayListIntAddAtOutFailed(override val arrayListId: Long, override val thread: String, val index: Int, val element: Int, val error: String, val elements: List<Int>) : ArrayListIntEvent
