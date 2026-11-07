package mingazov.kotlinview.controller

import mingazov.kotlinview.controller.collection.CreatedResponse
import mingazov.kotlinview.controller.collection.ResultResponse
import mingazov.kotlinview.controller.collection.ThreadResponse
import mingazov.kotlinview.service.SynchronousQueueRunnableService
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/api/synchronousqueuerunnable")
class SynchronousQueueRunnableController(
    private val queueService: SynchronousQueueRunnableService,
) {

    // Параметров нет: у SynchronousQueue нет ёмкости
    @PostMapping
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun create(): CreatedResponse = CreatedResponse(queueService.create().id)

    // Неблокирующий: true — задачу забрал ждущий в take, false — никто не ждал
    @PostMapping("/{queueId}/offer")
    fun offer(@PathVariable queueId: Long, @RequestBody request: TaskIdRequest): ResultResponse<Boolean> =
        ResultResponse(queueService.offer(queueId, request.taskId))

    // Не ждёт передачи: put() идёт в отдельном потоке, когда задачу заберут — событие METHOD_OUT put
    @PostMapping("/{queueId}/put")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun put(@PathVariable queueId: Long, @RequestBody request: TaskIdRequest): ThreadResponse =
        ThreadResponse(queueService.put(queueId, request.taskId))

    // Не ждёт задачу: take() идёт в отдельном потоке, взятый taskId — в событии METHOD_OUT take
    @PostMapping("/{queueId}/take")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun take(@PathVariable queueId: Long): ThreadResponse = ThreadResponse(queueService.take(queueId))

    @DeleteMapping("/{queueId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun remove(@PathVariable queueId: Long) = queueService.remove(queueId)
}