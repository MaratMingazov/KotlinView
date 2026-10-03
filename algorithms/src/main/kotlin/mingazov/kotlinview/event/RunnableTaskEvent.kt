package mingazov.kotlinview.event



sealed interface RunnableTaskEvent : Event {
    val id: Long
}

data class RunnableTaskRunInEvent(override val id: Long, val thread: String) : RunnableTaskEvent
data class RunnableTaskRunOutEvent(override val id: Long, val thread: String) : RunnableTaskEvent