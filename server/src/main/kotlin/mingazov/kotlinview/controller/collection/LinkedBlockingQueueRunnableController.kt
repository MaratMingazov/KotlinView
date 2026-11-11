package mingazov.kotlinview.controller.collection

import mingazov.kotlinview.service.collection.LinkedBlockingQueueRunnableService
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

    // Не ждёт места: put() идёт в отдельном потоке, когда задача ляжет в очередь — событие METHOD_OUT put
    @PostMapping("/{queueId}/put")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun put(@PathVariable queueId: Long, @RequestBody request: TaskIdRequest): ThreadResponse =
        ThreadResponse(queueService.put(queueId, request.taskId))

    // Как take, но ждёт не дольше timeoutMs: в отдельном потоке; METHOD_OUT poll — taskId или null (не дождался)
    @PostMapping("/{queueId}/poll")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun poll(@PathVariable queueId: Long, @RequestBody request: TimeoutRequest): ThreadResponse =
        ThreadResponse(queueService.poll(queueId, request.timeoutMs))

    @DeleteMapping("/{queueId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun remove(@PathVariable queueId: Long) = queueService.remove(queueId)
}