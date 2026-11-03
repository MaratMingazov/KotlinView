package mingazov.kotlinview.controller

import mingazov.kotlinview.controller.collection.CreatedResponse
import mingazov.kotlinview.controller.collection.ErrorResponse
import mingazov.kotlinview.instrumented.RunnableTaskNotFoundException
import mingazov.kotlinview.service.InstrumentedRunnableTaskService
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController

data class CreateTaskRequest(val durationMs: Long)
data class RunTaskResponse(val thread: String)

@RestController
@RequestMapping("/api/tasks")
class TaskController(
    private val taskService: InstrumentedRunnableTaskService,
) {

    @PostMapping
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun create(@RequestBody request: CreateTaskRequest): CreatedResponse {
        val task = taskService.create(request.durationMs)
        val response = CreatedResponse(task.id)
        return response
    }

    // Не ждёт окончания: run() идёт в отдельном потоке, ход выполнения — в событиях METHOD_*
    @PostMapping("/{taskId}/run")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun run(@PathVariable taskId: Long): RunTaskResponse {
        val thread = taskService.run(taskId)
        val response = RunTaskResponse(thread)
        return response
    }

    @DeleteMapping("/{taskId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun remove(@PathVariable taskId: Long) = taskService.remove(taskId)

    @ExceptionHandler(RunnableTaskNotFoundException::class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    fun handleNotFound(e: RunnableTaskNotFoundException) = ErrorResponse(e.toString())
}