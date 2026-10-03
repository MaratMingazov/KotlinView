package mingazov.kotlinview.event



sealed interface RunnableTaskEvent : Event { val taskId: Long }

data class RunnableTaskRunInEvent(override val taskId: Long, override val thread: String) : RunnableTaskEvent
data class RunnableTaskRunOutEvent(override val taskId: Long, override val thread: String) : RunnableTaskEvent