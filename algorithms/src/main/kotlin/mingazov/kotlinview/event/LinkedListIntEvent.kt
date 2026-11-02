package mingazov.kotlinview.event

sealed interface LinkedListIntEvent : Event {
    val linkedListId: Long
}

data class LinkedListIntCreated(override val linkedListId: Long, override val thread: String) : LinkedListIntEvent
data class LinkedListIntRemoved(override val linkedListId: Long, override val thread: String) : LinkedListIntEvent

data class LinkedListIntAddIn(override val linkedListId: Long, override val thread: String, val element: Int, val elements: List<Int>) : LinkedListIntEvent
data class LinkedListIntAddOut(override val linkedListId: Long, override val thread: String, val element: Int, val elements: List<Int>) : LinkedListIntEvent
data class LinkedListIntAddOutFailed(override val linkedListId: Long, override val thread: String, val element: Int, val error: String, val elements: List<Int>) : LinkedListIntEvent

data class LinkedListIntOfferIn(override val linkedListId: Long, override val thread: String, val element: Int, val elements: List<Int>) : LinkedListIntEvent
data class LinkedListIntOfferOut(override val linkedListId: Long, override val thread: String, val element: Int, val elements: List<Int>) : LinkedListIntEvent
data class LinkedListIntOfferOutFailed(override val linkedListId: Long, override val thread: String, val element: Int, val error: String, val elements: List<Int>) : LinkedListIntEvent

data class LinkedListIntOfferFirstIn(override val linkedListId: Long, override val thread: String, val element: Int, val elements: List<Int>) : LinkedListIntEvent
data class LinkedListIntOfferFirstOut(override val linkedListId: Long, override val thread: String, val element: Int, val elements: List<Int>) : LinkedListIntEvent
data class LinkedListIntOfferFirstOutFailed(override val linkedListId: Long, override val thread: String, val element: Int, val error: String, val elements: List<Int>) : LinkedListIntEvent

data class LinkedListIntOfferLastIn(override val linkedListId: Long, override val thread: String, val element: Int, val elements: List<Int>) : LinkedListIntEvent
data class LinkedListIntOfferLastOut(override val linkedListId: Long, override val thread: String, val element: Int, val elements: List<Int>) : LinkedListIntEvent
data class LinkedListIntOfferLastOutFailed(override val linkedListId: Long, override val thread: String, val element: Int, val error: String, val elements: List<Int>) : LinkedListIntEvent