package mingazov.kotlinview.controller.concurrent.locks

import mingazov.kotlinview.controller.collection.CreatedResponse
import mingazov.kotlinview.controller.collection.ErrorResponse
import mingazov.kotlinview.controller.collection.ThreadResponse
import mingazov.kotlinview.instrumented.concurrent.locks.AQSAcquireMode
import mingazov.kotlinview.service.concurrent.locks.AQSRunnableTaskService
import mingazov.kotlinview.service.concurrent.locks.AQSTaskSpec
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController

/**
 * limit — сколько места в AQS; tasks — задачи над ним. По умолчанию все занимают по 1 (arg) из 2: очередь — с третьего
 * потока. Один exclusive и один shared — в очереди узлы обоих типов
 */
data class CreateAQSRunnableTaskRequest(
    val limit: Int = 2,
    val tasks: List<AQSTaskSpec> = listOf(
        AQSTaskSpec(shared = false, mode = AQSAcquireMode.ACQUIRE),
        AQSTaskSpec(shared = true, mode = AQSAcquireMode.ACQUIRE),
    ),
)

data class InterruptRequest(val thread: String)

@RestController
@RequestMapping("/api/aqsrunnabletask")
class AQSRunnableTaskController(
    private val service: AQSRunnableTaskService,
) {

    // Группа: OBJECT_CREATED AQS, потом по паре на задачу (её RunnableTask, сама задача). Ответ — id AQS = id группы
    @PostMapping
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun create(@RequestBody request: CreateAQSRunnableTaskRequest): CreatedResponse =
        CreatedResponse(service.create(request.limit, request.tasks))

    // Не ждёт: run идёт в новом потоке aqs-worker-N — вход, работа и выход видны в событиях частей
    @PostMapping("/task/{taskId}/run")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun run(@PathVariable taskId: Long): ThreadResponse = ThreadResponse(service.run(taskId))

    // В HTTP-потоке: прервать поток этой задачи (что будет — зависит от mode и того, ждёт он или уже работает)
    @PostMapping("/task/{taskId}/interrupt")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun interrupt(@PathVariable taskId: Long, @RequestBody request: InterruptRequest) =
        service.interrupt(taskId, request.thread)

    // Вся группа: задачи, их RunnableTask и AQS
    @DeleteMapping("/{aqsId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun remove(@PathVariable aqsId: Long) = service.remove(aqsId)

    // require в create: limit, arg, durationMs, timeoutMs, пустой tasks
    @ExceptionHandler(IllegalArgumentException::class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    fun handleBadRequest(e: IllegalArgumentException) = ErrorResponse(e.toString())

    // interrupt: потока нет (уже закончил run) или он не этой задачи; объекта нет — тоже сюда (ObjectNotFoundException — наследник)
    @ExceptionHandler(NoSuchElementException::class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    fun handleNotFound(e: NoSuchElementException) = ErrorResponse(e.toString())

    // Удаляем, пока кто-то внутри run
    @ExceptionHandler(IllegalStateException::class)
    @ResponseStatus(HttpStatus.CONFLICT)
    fun handleBusy(e: IllegalStateException) = ErrorResponse(e.toString())
}
