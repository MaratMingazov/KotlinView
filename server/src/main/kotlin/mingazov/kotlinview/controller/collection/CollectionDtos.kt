package mingazov.kotlinview.controller.collection

// Общие DTO для REST коллекций. Имена полей совпадают с WebSocket-протоколом:
// тело запроса — это args события METHOD_IN, ответ — result события METHOD_OUT.

data class CreatedResponse(val objectId: Long)
data class ElementRequest(val element: Int)
data class IndexRequest(val index: Int)
data class IndexElementRequest(val index: Int, val element: Int)
data class ResultResponse<T>(val result: T)
data class ErrorResponse(val error: String)