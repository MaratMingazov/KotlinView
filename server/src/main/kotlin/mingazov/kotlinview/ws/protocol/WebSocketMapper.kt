package mingazov.kotlinview.ws.protocol

import mingazov.kotlinview.event.Event
import mingazov.kotlinview.event.MethodIn
import mingazov.kotlinview.event.MethodOut
import mingazov.kotlinview.event.MethodOutFailed
import mingazov.kotlinview.event.ObjectCreated
import mingazov.kotlinview.event.ObjectRemoved

/** Переводит доменные события в payload'ы протокола. Строки type здесь нет — они на классах payload'ов. */
object WebSocketMapper {

    /** null — событие пока не входит в протокол, клиенту не отправляется. */
    fun toPayload(event: Event): Payload? = when (event) {
        is ObjectCreated -> ObjectCreatedData(event.objectType.name, event.objectId, event.thread)
        is ObjectRemoved -> ObjectRemovedData(event.objectType.name, event.objectId, event.thread)
        is MethodIn -> MethodInData(event.objectType.name, event.objectId, event.thread, event.method, event.args, event.state)
        is MethodOut -> MethodOutData(event.objectType.name, event.objectId, event.thread, event.method, event.args, event.result, event.state)
        is MethodOutFailed -> MethodOutFailedData(event.objectType.name, event.objectId, event.thread, event.method, event.args, event.error, event.state)
        else -> null // TODO: очередь, пул, фабрика потоков ещё не переведены на payload'ы
    }
}