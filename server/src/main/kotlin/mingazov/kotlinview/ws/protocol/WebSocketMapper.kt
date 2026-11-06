package mingazov.kotlinview.ws.protocol

import mingazov.kotlinview.event.Event
import mingazov.kotlinview.event.MethodIn
import mingazov.kotlinview.event.MethodOut
import mingazov.kotlinview.event.MethodOutFailed
import mingazov.kotlinview.event.MethodProgress
import mingazov.kotlinview.event.ObjectCreated
import mingazov.kotlinview.event.ObjectRemoved

/** Переводит доменные события в payload'ы протокола. Строки type здесь нет — они на классах payload'ов. */
object WebSocketMapper {

    /** Каждое событие входит в протокол: Event — sealed, новый вид не скомпилируется, пока его здесь не добавят. */
    fun toPayload(event: Event): Payload = when (event) {
        is ObjectCreated -> ObjectCreatedData(event.objectType.name, event.objectId, event.thread, event.state)
        is ObjectRemoved -> ObjectRemovedData(event.objectType.name, event.objectId, event.thread)
        is MethodIn -> MethodInData(event.objectType.name, event.objectId, event.thread, event.method, event.args, event.state)
        is MethodOut -> MethodOutData(event.objectType.name, event.objectId, event.thread, event.method, event.args, event.result, event.state)
        is MethodOutFailed -> MethodOutFailedData(event.objectType.name, event.objectId, event.thread, event.method, event.args, event.error, event.state)
        is MethodProgress -> MethodProgressData(event.objectType.name, event.objectId, event.thread, event.method, event.progress, event.state)
    }
}