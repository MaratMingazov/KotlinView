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

data class LinkedListIntPollIn(override val linkedListId: Long, override val thread: String, val elements: List<Int>) : LinkedListIntEvent
/** element == null — список был пуст: для poll это нормальный результат, а не ошибка. */
data class LinkedListIntPollOut(override val linkedListId: Long, override val thread: String, val element: Int?, val elements: List<Int>) : LinkedListIntEvent
data class LinkedListIntPollOutFailed(override val linkedListId: Long, override val thread: String, val error: String, val elements: List<Int>) : LinkedListIntEvent

data class LinkedListIntPopIn(override val linkedListId: Long, override val thread: String, val elements: List<Int>) : LinkedListIntEvent
data class LinkedListIntPopOut(override val linkedListId: Long, override val thread: String, val element: Int, val elements: List<Int>) : LinkedListIntEvent
/** Пустой список: pop бросает NoSuchElementException. */
data class LinkedListIntPopOutFailed(override val linkedListId: Long, override val thread: String, val error: String, val elements: List<Int>) : LinkedListIntEvent