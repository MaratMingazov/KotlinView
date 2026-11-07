package mingazov.kotlinview.controller.concurrent.locks

import mingazov.kotlinview.controller.collection.CreatedResponse
import mingazov.kotlinview.controller.collection.ErrorResponse
import mingazov.kotlinview.controller.collection.ResultResponse
import mingazov.kotlinview.controller.collection.ThreadResponse
import mingazov.kotlinview.service.concurrent.locks.SemaphoreService
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController

/** permits < 0 разрешено, как в JDK: семафор стартует «в долг». */
data class CreateSemaphoreRequest(val permits: Int, val fair: Boolean = false)

/** Тело можно не передавать — тогда 1 разрешение, как у acquire() / release() без аргументов. */
data class PermitsRequest(val permits: Int = 1)

data class TryAcquireTimeoutRequest(val permits: Int = 1, val timeoutMs: Long)

@RestController
@RequestMapping("/api/semaphore")
class SemaphoreController(
    private val semaphoreService: SemaphoreService,
) {

    @PostMapping
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun create(@RequestBody request: CreateSemaphoreRequest): CreatedResponse =
        CreatedResponse(semaphoreService.create(request.permits, request.fair).id)

    // Не ждёт разрешения: acquire() идёт в отдельном потоке, когда получит — событие METHOD_OUT acquire
    @PostMapping("/{semaphoreId}/acquire")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun acquire(@PathVariable semaphoreId: Long, @RequestBody(required = false) request: PermitsRequest?): ThreadResponse =
        ThreadResponse(semaphoreService.acquire(semaphoreId, request.permits()))

    // Неблокирующий, в HTTP-потоке: true — забрал, false — не хватило
    @PostMapping("/{semaphoreId}/tryAcquire")
    fun tryAcquire(@PathVariable semaphoreId: Long, @RequestBody(required = false) request: PermitsRequest?): ResultResponse<Boolean> =
        ResultResponse(semaphoreService.tryAcquire(semaphoreId, request.permits()))

    // Как acquire, но с таймаутом: true / false — в METHOD_OUT tryAcquire
    @PostMapping("/{semaphoreId}/tryAcquireTimeout")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun tryAcquireTimeout(@PathVariable semaphoreId: Long, @RequestBody request: TryAcquireTimeoutRequest): ThreadResponse =
        ThreadResponse(semaphoreService.tryAcquireTimeout(semaphoreId, request.permits, request.timeoutMs))

    // В HTTP-потоке, а не в том, что брал: у семафора нет владельца
    @PostMapping("/{semaphoreId}/release")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun release(@PathVariable semaphoreId: Long, @RequestBody(required = false) request: PermitsRequest?) =
        semaphoreService.release(semaphoreId, request.permits())

    @DeleteMapping("/{semaphoreId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun remove(@PathVariable semaphoreId: Long) = semaphoreService.remove(semaphoreId)

    private fun PermitsRequest?.permits() = this?.permits ?: 1

    // permits < 0 в acquire / tryAcquire / release
    @ExceptionHandler(IllegalArgumentException::class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    fun handleBadRequest(e: IllegalArgumentException) = ErrorResponse(e.toString())

    // Удаляем семафор, у которого есть ждущие
    @ExceptionHandler(IllegalStateException::class)
    @ResponseStatus(HttpStatus.CONFLICT)
    fun handleHasWaiters(e: IllegalStateException) = ErrorResponse(e.toString())
}