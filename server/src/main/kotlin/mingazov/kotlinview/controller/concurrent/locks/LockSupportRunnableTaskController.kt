package mingazov.kotlinview.controller.concurrent.locks

import mingazov.kotlinview.controller.collection.CreatedResponse
import mingazov.kotlinview.controller.collection.ErrorResponse
import mingazov.kotlinview.controller.collection.ThreadResponse
import mingazov.kotlinview.instrumented.concurrent.locks.ParkMode
import mingazov.kotlinview.service.concurrent.locks.LockSupportRunnableTaskService
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
 * durationMs — сколько «работает» задача до park (окно «unpark до park»); mode — PARK (спит, пока не дадут
 * разрешение) или PARK_NANOS (не дольше timeoutMs); timeoutMs — только для PARK_NANOS
 */
data class CreateLockSupportRunnableTaskRequest(
    val durationMs: Long = 5000,
    val mode: ParkMode = ParkMode.PARK,
    val timeoutMs: Long = 2000,
)

data class UnparkRequest(val thread: String)

@RestController
@RequestMapping("/api/locksupportrunnabletask")
class LockSupportRunnableTaskController(
    private val service: LockSupportRunnableTaskService,
) {

    // Вместе с объектом создаются его LockSupport и задача — три OBJECT_CREATED: LockSupport, задача, объект
    @PostMapping
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun create(@RequestBody request: CreateLockSupportRunnableTaskRequest): CreatedResponse =
        CreatedResponse(service.create(request.durationMs, request.mode, request.timeoutMs).id)

    // Не ждёт: run идёт в новом потоке parker-N — работа задачи и park видны в событиях частей
    @PostMapping("/{id}/run")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun run(@PathVariable id: Long): ThreadResponse = ThreadResponse(service.run(id))

    // В HTTP-потоке: дать разрешение потоку этого объекта (спит — проснётся, работает — следующий park вернётся сразу)
    @PostMapping("/{id}/unpark")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun unpark(@PathVariable id: Long, @RequestBody request: UnparkRequest) = service.unpark(id, request.thread)

    // Вместе с объектом удаляются его LockSupport и задача
    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun remove(@PathVariable id: Long) = service.remove(id)

    // require в create: durationMs < 0, timeoutMs < 0
    @ExceptionHandler(IllegalArgumentException::class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    fun handleBadRequest(e: IllegalArgumentException) = ErrorResponse(e.toString())

    // unpark: потока нет (уже закончил run) или он не этого объекта; объекта нет — тоже сюда (ObjectNotFoundException — наследник)
    @ExceptionHandler(NoSuchElementException::class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    fun handleNotFound(e: NoSuchElementException) = ErrorResponse(e.toString())

    // Удаляем, пока кто-то внутри run
    @ExceptionHandler(IllegalStateException::class)
    @ResponseStatus(HttpStatus.CONFLICT)
    fun handleBusy(e: IllegalStateException) = ErrorResponse(e.toString())
}