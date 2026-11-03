package mingazov.kotlinview.ws.protocol

import com.fasterxml.jackson.annotation.JsonTypeName

@JsonTypeName("OBJECT_CREATED")
data class ObjectCreatedData(val objectType: String, val objectId: Long, val thread: String, val state: Any?) : Payload

@JsonTypeName("OBJECT_REMOVED")
data class ObjectRemovedData(val objectType: String, val objectId: Long, val thread: String) : Payload

@JsonTypeName("METHOD_IN")
data class MethodInData(val objectType: String, val objectId: Long, val thread: String, val method: String, val args: Map<String, Any?>, val state: Any?) : Payload

@JsonTypeName("METHOD_OUT")
data class MethodOutData(val objectType: String, val objectId: Long, val thread: String, val method: String, val args: Map<String, Any?>, val result: Any?, val state: Any?) : Payload

@JsonTypeName("METHOD_OUT_FAILED")
data class MethodOutFailedData(val objectType: String, val objectId: Long, val thread: String, val method: String, val args: Map<String, Any?>, val error: String, val state: Any?) : Payload

@JsonTypeName("METHOD_PROGRESS")
data class MethodProgressData(val objectType: String, val objectId: Long, val thread: String, val method: String, val progress: Map<String, Any?>, val state: Any?) : Payload