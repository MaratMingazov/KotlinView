package mingazov.kotlinview.controller

import mingazov.kotlinview.controller.collection.CreatedResponse
import mingazov.kotlinview.controller.collection.ErrorResponse
import mingazov.kotlinview.controller.collection.ResultResponse
import mingazov.kotlinview.instrumented.RunnableTaskNotFoundException
import mingazov.kotlinview.instrumented.ThreadPoolExecutorNotFoundException
import mingazov.kotlinview.service.ThreadPoolExecutorService
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.util.concurrent.RejectedExecutionException

/** queueCapacity == null — неограниченная очередь: потоки сверх corePoolSize тогда не создаются никогда. */
data class CreatePoolRequest(
    val corePoolSize: Int,
    val maximumPoolSize: Int,
    val keepAliveMs: Long,
    val queueCapacity: Int? = null,
)

@RestController
@RequestMapping("/api/threadpoolexecutor")
class ThreadPoolController(
    private val poolService: ThreadPoolExecutorService,
) {

    // Вместе с пулом создаются его очередь и фабрика — клиент получит три OBJECT_CREATED: очередь, фабрика, пул
    @PostMapping
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun create(@RequestBody request: CreatePoolRequest): CreatedResponse {
        val pool = poolService.create(request.corePoolSize, request.maximumPoolSize, request.keepAliveMs, request.queueCapacity)
        val response = CreatedResponse(pool.id)
        return response
    }

    // Что пул сделал с задачей (новый поток, очередь, отказ) — в событиях между METHOD_IN и METHOD_OUT execute
    @PostMapping("/{poolId}/execute")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun execute(@PathVariable poolId: Long, @RequestBody request: TaskIdRequest) {
        poolService.execute(poolId, request.taskId)
    }

    @PostMapping("/{poolId}/shutdown")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun shutdown(@PathVariable poolId: Long) = poolService.shutdown(poolId)

    /** result — taskIds задач, которые так и не начали выполняться. */
    @PostMapping("/{poolId}/shutdownNow")
    fun shutdownNow(@PathVariable poolId: Long): ResultResponse<List<Long>> {
        val result = poolService.shutdownNow(poolId)
        val response = ResultResponse(result)
        return response
    }

    // Вместе с пулом удаляются его очередь и фабрика
    @DeleteMapping("/{poolId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun remove(@PathVariable poolId: Long) = poolService.remove(poolId)

    @ExceptionHandler(ThreadPoolExecutorNotFoundException::class, RunnableTaskNotFoundException::class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    fun handleNotFound(e: NoSuchElementException) = ErrorResponse(e.toString())

    // require в create: например, corePoolSize > maximumPoolSize
    @ExceptionHandler(IllegalArgumentException::class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    fun handleBadRequest(e: IllegalArgumentException) = ErrorResponse(e.toString())

    // Удаляем пул, который ещё не TERMINATED
    @ExceptionHandler(IllegalStateException::class)
    @ResponseStatus(HttpStatus.CONFLICT)
    fun handleNotTerminated(e: IllegalStateException) = ErrorResponse(e.toString())

    // Отказ — нормальный результат, который мы и хотим показать: очередь полна и потоков уже max, или пул остановлен
    @ExceptionHandler(RejectedExecutionException::class)
    @ResponseStatus(HttpStatus.CONFLICT)
    fun handleRejected(e: RejectedExecutionException) = ErrorResponse(e.toString())
}