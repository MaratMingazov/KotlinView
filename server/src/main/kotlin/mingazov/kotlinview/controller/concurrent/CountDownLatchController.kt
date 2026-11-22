package mingazov.kotlinview.controller.concurrent

import mingazov.kotlinview.controller.collection.CreatedResponse
import mingazov.kotlinview.controller.collection.ErrorResponse
import mingazov.kotlinview.controller.collection.ThreadResponse
import mingazov.kotlinview.service.concurrent.CountDownLatchService
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController

/** count — сколько countDown нужно, чтобы ворота открылись (0 — открыты сразу) */
data class CreateCountDownLatchRequest(val count: Int = 3)

/** timeoutMs — ждать не дольше (await(timeout)); null — до открытия (await()) */
data class AwaitRequest(val timeoutMs: Long? = null)

data class LatchInterruptRequest(val thread: String)

@RestController
@RequestMapping("/api/countdownlatch")
class CountDownLatchController(
    private val service: CountDownLatchService,
) {

    @PostMapping
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun create(@RequestBody request: CreateCountDownLatchRequest): CreatedResponse =
        CreatedResponse(service.create(request.count).id)

    // Не ждёт: await идёт в новом потоке latch-waiter-N — ожидание и выход видны в событиях latch.
    // Тело можно не слать — тогда await() без таймаута
    @PostMapping("/{id}/await")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun await(@PathVariable id: Long, @RequestBody(required = false) request: AwaitRequest?): ThreadResponse =
        ThreadResponse(service.await(id, request?.timeoutMs))

    // В HTTP-потоке: count − 1, на переходе в 0 просыпаются все ждущие
    @PostMapping("/{id}/countDown")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun countDown(@PathVariable id: Long) = service.countDown(id)

    // В HTTP-потоке: прервать ждущего — уйдёт из await с InterruptedException
    @PostMapping("/{id}/interrupt")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun interrupt(@PathVariable id: Long, @RequestBody request: LatchInterruptRequest) =
        service.interrupt(id, request.thread)

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun remove(@PathVariable id: Long) = service.remove(id)

    // count < 0 (CountDownLatch), timeoutMs < 0
    @ExceptionHandler(IllegalArgumentException::class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    fun handleBadRequest(e: IllegalArgumentException) = ErrorResponse(e.toString())

    // interrupt: потока нет (уже вышел из await) или он ждёт не на этом latch; latch нет — тоже сюда
    // (ObjectNotFoundException — наследник)
    @ExceptionHandler(NoSuchElementException::class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    fun handleNotFound(e: NoSuchElementException) = ErrorResponse(e.toString())

    // Удаляем, пока кто-то ждёт
    @ExceptionHandler(IllegalStateException::class)
    @ResponseStatus(HttpStatus.CONFLICT)
    fun handleBusy(e: IllegalStateException) = ErrorResponse(e.toString())
}
