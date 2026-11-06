package mingazov.kotlinview.controller

import mingazov.kotlinview.controller.collection.CreatedResponse
import mingazov.kotlinview.controller.collection.ResultResponse
import mingazov.kotlinview.controller.collection.ThreadResponse
import mingazov.kotlinview.service.LinkedBlockingQueueRunnableService
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController

data class CreateQueueRequest(val capacity: Int)
data class TaskIdRequest(val taskId: Long)

@RestController
@RequestMapping("/api/linkedblockingqueuerunnable")
class LinkedBlockingQueueRunnableController(
    private val queueService: LinkedBlockingQueueRunnableService,
) {

    @PostMapping
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun create(@RequestBody request: CreateQueueRequest): CreatedResponse {
        val queue = queueService.create(request.capacity)
        val response = CreatedResponse(queue.id)
        return response
    }

    @PostMapping("/{queueId}/offer")
    fun offer(@PathVariable queueId: Long, @RequestBody request: TaskIdRequest): ResultResponse<Boolean> {
        val result = queueService.offer(queueId, request.taskId)
        val response = ResultResponse(result)
        return response
    }

    // Не ждёт задачу: take() идёт в отдельном потоке, взятый taskId — в событии METHOD_OUT take
    @PostMapping("/{queueId}/take")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun take(@PathVariable queueId: Long): ThreadResponse {
        val thread = queueService.take(queueId)
        val response = ThreadResponse(thread)
        return response
    }

    @DeleteMapping("/{queueId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun remove(@PathVariable queueId: Long) = queueService.remove(queueId)
}