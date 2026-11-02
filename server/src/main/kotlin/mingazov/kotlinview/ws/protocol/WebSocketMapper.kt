package mingazov.kotlinview.ws.protocol

import mingazov.kotlinview.event.Event
import mingazov.kotlinview.event.LinkedListIntAddIn
import mingazov.kotlinview.event.LinkedListIntAddOut
import mingazov.kotlinview.event.LinkedListIntAddOutFailed
import mingazov.kotlinview.event.LinkedListIntEvent
import mingazov.kotlinview.event.LinkedListIntOfferFirstIn
import mingazov.kotlinview.event.LinkedListIntOfferFirstOut
import mingazov.kotlinview.event.LinkedListIntOfferFirstOutFailed
import mingazov.kotlinview.event.LinkedListIntOfferIn
import mingazov.kotlinview.event.LinkedListIntOfferLastIn
import mingazov.kotlinview.event.LinkedListIntOfferLastOut
import mingazov.kotlinview.event.LinkedListIntOfferLastOutFailed
import mingazov.kotlinview.event.LinkedListIntPollIn
import mingazov.kotlinview.event.LinkedListIntPollOut
import mingazov.kotlinview.event.LinkedListIntPollOutFailed
import mingazov.kotlinview.event.LinkedListIntPopIn
import mingazov.kotlinview.event.LinkedListIntPopOut
import mingazov.kotlinview.event.LinkedListIntPopOutFailed
import mingazov.kotlinview.event.LinkedListIntOfferOut
import mingazov.kotlinview.event.LinkedListIntOfferOutFailed
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
        is LinkedListIntEvent -> linkedListInt(event)
        else -> null // TODO: очередь, пул, фабрика потоков ещё не переведены на payload'ы
    }


    private fun linkedListInt(e: LinkedListIntEvent): Payload = when (e) {
        is LinkedListIntAddIn -> LinkedListIntAddInData(e.linkedListId, e.thread, e.element, e.elements)
        is LinkedListIntAddOut -> LinkedListIntAddOutData(e.linkedListId, e.thread, e.element, e.elements)
        is LinkedListIntAddOutFailed -> LinkedListIntAddOutFailedData(e.linkedListId, e.thread, e.element, e.error, e.elements)
        is LinkedListIntOfferIn -> LinkedListIntOfferInData(e.linkedListId, e.thread, e.element, e.elements)
        is LinkedListIntOfferOut -> LinkedListIntOfferOutData(e.linkedListId, e.thread, e.element, e.elements)
        is LinkedListIntOfferOutFailed -> LinkedListIntOfferOutFailedData(e.linkedListId, e.thread, e.element, e.error, e.elements)
        is LinkedListIntOfferFirstIn -> LinkedListIntOfferFirstInData(e.linkedListId, e.thread, e.element, e.elements)
        is LinkedListIntOfferFirstOut -> LinkedListIntOfferFirstOutData(e.linkedListId, e.thread, e.element, e.elements)
        is LinkedListIntOfferFirstOutFailed -> LinkedListIntOfferFirstOutFailedData(e.linkedListId, e.thread, e.element, e.error, e.elements)
        is LinkedListIntOfferLastIn -> LinkedListIntOfferLastInData(e.linkedListId, e.thread, e.element, e.elements)
        is LinkedListIntOfferLastOut -> LinkedListIntOfferLastOutData(e.linkedListId, e.thread, e.element, e.elements)
        is LinkedListIntOfferLastOutFailed -> LinkedListIntOfferLastOutFailedData(e.linkedListId, e.thread, e.element, e.error, e.elements)
        is LinkedListIntPollIn -> LinkedListIntPollInData(e.linkedListId, e.thread, e.elements)
        is LinkedListIntPollOut -> LinkedListIntPollOutData(e.linkedListId, e.thread, e.element, e.elements)
        is LinkedListIntPollOutFailed -> LinkedListIntPollOutFailedData(e.linkedListId, e.thread, e.error, e.elements)
        is LinkedListIntPopIn -> LinkedListIntPopInData(e.linkedListId, e.thread, e.elements)
        is LinkedListIntPopOut -> LinkedListIntPopOutData(e.linkedListId, e.thread, e.element, e.elements)
        is LinkedListIntPopOutFailed -> LinkedListIntPopOutFailedData(e.linkedListId, e.thread, e.error, e.elements)
    }
}