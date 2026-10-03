package mingazov.kotlinview.instrumented

import mingazov.kotlinview.event.EventSink
import mingazov.kotlinview.event.RunnableTaskRunInEvent
import mingazov.kotlinview.event.RunnableTaskRunOutEvent

class InstrumentedRunnableTask(
    val id: Long,
    private val durationMs: Long,
    private val sink: EventSink,
    ) : Runnable {

    override fun run() {
        sink.emit(RunnableTaskRunInEvent(id, Thread.currentThread().name))
        Thread.sleep(durationMs)
        sink.emit(RunnableTaskRunOutEvent(id, Thread.currentThread().name))
    }

    override fun toString() = "runnableTask-$id"
}