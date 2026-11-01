package mingazov.kotlinview.ws.protocol

import mingazov.kotlinview.event.ArrayListIntAddIn
import mingazov.kotlinview.event.ArrayListIntAddOut
import mingazov.kotlinview.event.ArrayListIntAddOutFailed
import mingazov.kotlinview.event.ArrayListIntCreated
import mingazov.kotlinview.event.ArrayListIntEvent
import mingazov.kotlinview.event.ArrayListIntGetIn
import mingazov.kotlinview.event.ArrayListIntGetOut
import mingazov.kotlinview.event.ArrayListIntGetOutFailed
import mingazov.kotlinview.event.ArrayListIntRemoved
import mingazov.kotlinview.event.Event

/** Переводит доменные события в payload'ы протокола. Строки type здесь нет — они на классах payload'ов. */
object WebSocketMapper {

    /** null — событие пока не входит в протокол, клиенту не отправляется. */
    fun toPayload(event: Event): Payload? = when (event) {
        is ArrayListIntEvent -> arrayListInt(event)
        else -> null // TODO: очередь, пул, фабрика потоков ещё не переведены на payload'ы
    }


    private fun arrayListInt(e: ArrayListIntEvent): Payload = when (e) {
        is ArrayListIntCreated -> ArrayListIntCreatedData(e.arrayListId, e.thread)
        is ArrayListIntRemoved -> ArrayListIntRemovedData(e.arrayListId, e.thread)
        is ArrayListIntAddIn -> ArrayListIntAddInData(e.arrayListId, e.thread, e.value, e.elements)
        is ArrayListIntAddOut -> ArrayListIntAddOutData(e.arrayListId, e.thread, e.value, e.elements)
        is ArrayListIntAddOutFailed -> ArrayListIntAddOutFailedData(e.arrayListId, e.thread, e.value, e.error, e.elements)
        is ArrayListIntGetIn -> ArrayListIntGetInData(e.arrayListId, e.thread, e.index, e.elements)
        is ArrayListIntGetOut -> ArrayListIntGetOutData(e.arrayListId, e.thread, e.index, e.value, e.elements)
        is ArrayListIntGetOutFailed -> ArrayListIntGetOutFailedData(e.arrayListId, e.thread, e.index, e.error, e.elements)
    }
}