package mingazov.kotlinview.controller.concurrent.locks

import mingazov.kotlinview.controller.collection.CreatedResponse
import mingazov.kotlinview.controller.collection.ErrorResponse
import mingazov.kotlinview.controller.collection.ThreadResponse
import mingazov.kotlinview.service.concurrent.locks.SemaphoreRunnableTaskService
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController

/** permits — сколько потоков одновременно внутри задачи; durationMs — сколько «работает» задача. */
data class CreateSemaphoreRunnableTaskRequest(val permits: Int, val durationMs: Long = 5000, val fair: Boolean = false)

@RestController
@RequestMapping("/api/semaphorerunnabletask")
class SemaphoreRunnableTaskController(
    private val service: SemaphoreRunnableTaskService,
) {

    // Вместе с объектом создаются его семафор и задача — клиент получит три OBJECT_CREATED: семафор, задача, объект
    @PostMapping
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun create(@RequestBody request: CreateSemaphoreRunnableTaskRequest): CreatedResponse =
        CreatedResponse(service.create(request.permits, request.fair, request.durationMs).id)

    // Не ждёт окончания: run() идёт в отдельном потоке — acquire, задача и release видны в событиях частей
    @PostMapping("/{id}/run")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun run(@PathVariable id: Long): ThreadResponse = ThreadResponse(service.run(id))

    // Вместе с объектом удаляются его семафор и задача
    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun remove(@PathVariable id: Long) = service.remove(id)

    // require в create: durationMs < 0
    @ExceptionHandler(IllegalArgumentException::class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    fun handleBadRequest(e: IllegalArgumentException) = ErrorResponse(e.toString())

    // Удаляем, пока кто-то внутри run
    @ExceptionHandler(IllegalStateException::class)
    @ResponseStatus(HttpStatus.CONFLICT)
    fun handleBusy(e: IllegalStateException) = ErrorResponse(e.toString())
}