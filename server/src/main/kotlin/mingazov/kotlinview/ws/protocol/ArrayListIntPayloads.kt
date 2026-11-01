package mingazov.kotlinview.ws.protocol

import com.fasterxml.jackson.annotation.JsonTypeName

@JsonTypeName("ARRAY_LIST_INT_CREATED")
data class ArrayListIntCreatedData(val arrayListId: Long, val thread: String) : Payload

@JsonTypeName("ARRAY_LIST_INT_REMOVED")
data class ArrayListIntRemovedData(val arrayListId: Long, val thread: String) : Payload

@JsonTypeName("ARRAY_LIST_INT_ADD_IN")
data class ArrayListIntAddInData(val arrayListId: Long, val thread: String, val element: Int, val elements: List<Int>) : Payload

@JsonTypeName("ARRAY_LIST_INT_ADD_OUT")
data class ArrayListIntAddOutData(val arrayListId: Long, val thread: String, val element: Int, val elements: List<Int>) : Payload

@JsonTypeName("ARRAY_LIST_INT_ADD_OUT_FAILED")
data class ArrayListIntAddOutFailedData(val arrayListId: Long, val thread: String, val element: Int, val error: String, val elements: List<Int>) : Payload

@JsonTypeName("ARRAY_LIST_INT_ADD_AT_IN")
data class ArrayListIntAddAtInData(val arrayListId: Long, val thread: String, val index: Int, val element: Int, val elements: List<Int>) : Payload

@JsonTypeName("ARRAY_LIST_INT_ADD_AT_OUT")
data class ArrayListIntAddAtOutData(val arrayListId: Long, val thread: String, val index: Int, val element: Int, val elements: List<Int>) : Payload

@JsonTypeName("ARRAY_LIST_INT_ADD_AT_OUT_FAILED")
data class ArrayListIntAddAtOutFailedData(val arrayListId: Long, val thread: String, val index: Int, val element: Int, val error: String, val elements: List<Int>) : Payload

@JsonTypeName("ARRAY_LIST_INT_GET_IN")
data class ArrayListIntGetInData(val arrayListId: Long, val thread: String, val index: Int, val elements: List<Int>) : Payload

@JsonTypeName("ARRAY_LIST_INT_GET_OUT")
data class ArrayListIntGetOutData(val arrayListId: Long, val thread: String, val index: Int, val element: Int, val elements: List<Int>) : Payload

@JsonTypeName("ARRAY_LIST_INT_GET_OUT_FAILED")
data class ArrayListIntGetOutFailedData(val arrayListId: Long, val thread: String, val index: Int, val error: String, val elements: List<Int>) : Payload