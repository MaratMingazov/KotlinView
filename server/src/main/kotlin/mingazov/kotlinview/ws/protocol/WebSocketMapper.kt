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

object WebSocketMapper {

    fun type(event: Event): String = when (event) {
        is ArrayListIntEvent -> arrayListIntType(event)
        else -> event::class.simpleName!! // TODO: очередь, пул, фабрика потоков ещё не переведены на явные type
    }

    private fun arrayListIntType(event: ArrayListIntEvent): String = when (event) {
        is ArrayListIntCreated -> "ARRAY_LIST_INT_CREATED"
        is ArrayListIntAddIn -> "ARRAY_LIST_INT_ADD_IN"
        is ArrayListIntAddOut -> "ARRAY_LIST_INT_ADD_OUT"
        is ArrayListIntAddOutFailed -> "ARRAY_LIST_INT_ADD_OUT_FAILED"
        is ArrayListIntGetIn -> "ARRAY_LIST_INT_GET_IN"
        is ArrayListIntGetOut -> "ARRAY_LIST_INT_GET_OUT"
        is ArrayListIntGetOutFailed -> "ARRAY_LIST_INT_GET_OUT_FAILED"
        is ArrayListIntRemoved -> "ARRAY_LIST_INT_REMOVED"
    }
}