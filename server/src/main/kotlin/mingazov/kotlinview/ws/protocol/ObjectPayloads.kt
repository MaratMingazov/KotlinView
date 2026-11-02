package mingazov.kotlinview.ws.protocol

import com.fasterxml.jackson.annotation.JsonTypeName

@JsonTypeName("OBJECT_CREATED")
data class ObjectCreatedData(val objectType: String, val objectId: Long, val thread: String) : Payload

@JsonTypeName("OBJECT_REMOVED")
data class ObjectRemovedData(val objectType: String, val objectId: Long, val thread: String) : Payload