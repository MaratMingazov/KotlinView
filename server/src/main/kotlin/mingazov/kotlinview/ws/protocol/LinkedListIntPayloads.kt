package mingazov.kotlinview.ws.protocol

import com.fasterxml.jackson.annotation.JsonTypeName

@JsonTypeName("LINKED_LIST_INT_CREATED")
data class LinkedListIntCreatedData(val linkedListId: Long, val thread: String) : Payload

@JsonTypeName("LINKED_LIST_INT_REMOVED")
data class LinkedListIntRemovedData(val linkedListId: Long, val thread: String) : Payload

@JsonTypeName("LINKED_LIST_INT_ADD_IN")
data class LinkedListIntAddInData(val linkedListId: Long, val thread: String, val element: Int, val elements: List<Int>) : Payload

@JsonTypeName("LINKED_LIST_INT_ADD_OUT")
data class LinkedListIntAddOutData(val linkedListId: Long, val thread: String, val element: Int, val elements: List<Int>) : Payload

@JsonTypeName("LINKED_LIST_INT_ADD_OUT_FAILED")
data class LinkedListIntAddOutFailedData(val linkedListId: Long, val thread: String, val element: Int, val error: String, val elements: List<Int>) : Payload

@JsonTypeName("LINKED_LIST_INT_OFFER_IN")
data class LinkedListIntOfferInData(val linkedListId: Long, val thread: String, val element: Int, val elements: List<Int>) : Payload

@JsonTypeName("LINKED_LIST_INT_OFFER_OUT")
data class LinkedListIntOfferOutData(val linkedListId: Long, val thread: String, val element: Int, val elements: List<Int>) : Payload

@JsonTypeName("LINKED_LIST_INT_OFFER_OUT_FAILED")
data class LinkedListIntOfferOutFailedData(val linkedListId: Long, val thread: String, val element: Int, val error: String, val elements: List<Int>) : Payload

@JsonTypeName("LINKED_LIST_INT_OFFER_FIRST_IN")
data class LinkedListIntOfferFirstInData(val linkedListId: Long, val thread: String, val element: Int, val elements: List<Int>) : Payload

@JsonTypeName("LINKED_LIST_INT_OFFER_FIRST_OUT")
data class LinkedListIntOfferFirstOutData(val linkedListId: Long, val thread: String, val element: Int, val elements: List<Int>) : Payload

@JsonTypeName("LINKED_LIST_INT_OFFER_FIRST_OUT_FAILED")
data class LinkedListIntOfferFirstOutFailedData(val linkedListId: Long, val thread: String, val element: Int, val error: String, val elements: List<Int>) : Payload

@JsonTypeName("LINKED_LIST_INT_OFFER_LAST_IN")
data class LinkedListIntOfferLastInData(val linkedListId: Long, val thread: String, val element: Int, val elements: List<Int>) : Payload

@JsonTypeName("LINKED_LIST_INT_OFFER_LAST_OUT")
data class LinkedListIntOfferLastOutData(val linkedListId: Long, val thread: String, val element: Int, val elements: List<Int>) : Payload

@JsonTypeName("LINKED_LIST_INT_OFFER_LAST_OUT_FAILED")
data class LinkedListIntOfferLastOutFailedData(val linkedListId: Long, val thread: String, val element: Int, val error: String, val elements: List<Int>) : Payload