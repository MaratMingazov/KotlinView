package mingazov.kotlinview.ws.protocol

import mingazov.kotlinview.event.ArrayListIntAddAtIn
import mingazov.kotlinview.event.ArrayListIntAddAtOut
import mingazov.kotlinview.event.ArrayListIntAddAtOutFailed
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
import mingazov.kotlinview.event.LinkedListIntAddIn
import mingazov.kotlinview.event.LinkedListIntAddOut
import mingazov.kotlinview.event.LinkedListIntAddOutFailed
import mingazov.kotlinview.event.LinkedListIntCreated
import mingazov.kotlinview.event.LinkedListIntEvent
import mingazov.kotlinview.event.LinkedListIntRemoved

/** Переводит доменные события в payload'ы протокола. Строки type здесь нет — они на классах payload'ов. */
object WebSocketMapper {

    /** null — событие пока не входит в протокол, клиенту не отправляется. */
    fun toPayload(event: Event): Payload? = when (event) {
        is ArrayListIntEvent -> arrayListInt(event)
        is LinkedListIntEvent -> linkedListInt(event)
        else -> null // TODO: очередь, пул, фабрика потоков ещё не переведены на payload'ы
    }


    private fun arrayListInt(e: ArrayListIntEvent): Payload = when (e) {
        is ArrayListIntCreated -> ArrayListIntCreatedData(e.arrayListId, e.thread)
        is ArrayListIntRemoved -> ArrayListIntRemovedData(e.arrayListId, e.thread)
        is ArrayListIntAddIn -> ArrayListIntAddInData(e.arrayListId, e.thread, e.element, e.elements)
        is ArrayListIntAddOut -> ArrayListIntAddOutData(e.arrayListId, e.thread, e.element, e.elements)
        is ArrayListIntAddOutFailed -> ArrayListIntAddOutFailedData(e.arrayListId, e.thread, e.element, e.error, e.elements)
        is ArrayListIntAddAtIn -> ArrayListIntAddAtInData(e.arrayListId, e.thread, e.index, e.element, e.elements)
        is ArrayListIntAddAtOut -> ArrayListIntAddAtOutData(e.arrayListId, e.thread, e.index, e.element, e.elements)
        is ArrayListIntAddAtOutFailed -> ArrayListIntAddAtOutFailedData(e.arrayListId, e.thread, e.index, e.element, e.error, e.elements)
        is ArrayListIntGetIn -> ArrayListIntGetInData(e.arrayListId, e.thread, e.index, e.elements)
        is ArrayListIntGetOut -> ArrayListIntGetOutData(e.arrayListId, e.thread, e.index, e.element, e.elements)
        is ArrayListIntGetOutFailed -> ArrayListIntGetOutFailedData(e.arrayListId, e.thread, e.index, e.error, e.elements)
    }

    private fun linkedListInt(e: LinkedListIntEvent): Payload = when (e) {
        is LinkedListIntCreated -> LinkedListIntCreatedData(e.linkedListId, e.thread)
        is LinkedListIntRemoved -> LinkedListIntRemovedData(e.linkedListId, e.thread)
        is LinkedListIntAddIn -> LinkedListIntAddInData(e.linkedListId, e.thread, e.element, e.elements)
        is LinkedListIntAddOut -> LinkedListIntAddOutData(e.linkedListId, e.thread, e.element, e.elements)
        is LinkedListIntAddOutFailed -> LinkedListIntAddOutFailedData(e.linkedListId, e.thread, e.element, e.error, e.elements)
    }
}