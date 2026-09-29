package mingazov.kotlinview.controller

import mingazov.kotlinview.service.QueueType
import mingazov.kotlinview.service.ExecuteResult
import mingazov.kotlinview.service.ThreadPoolService
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController

data class CreatePoolRequest(
    val corePoolSize: Int,
    val maximumPoolSize: Int,
    val keepAliveMs: Long,
    val queueType: QueueType,
    val queueCapacity: Int? = null,
)
data class CreatePoolResponse(val poolId: String)
data class SubmitTasksRequest(val count: Int, val durationMs: Long)
data class ShutdownNowResponse(val drainedTaskIds: List<Long>)

@RestController
@RequestMapping("/api/executors")
class ThreadPoolController(
    private val service: ThreadPoolService,
) {

    @PostMapping
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun create(@RequestBody r: CreatePoolRequest) =
        CreatePoolResponse(service.create(r.corePoolSize, r.maximumPoolSize, r.keepAliveMs, r.queueType, r.queueCapacity))

    @PostMapping("/{poolId}/tasks")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun submit(@PathVariable poolId: String, @RequestBody r: SubmitTasksRequest): ExecuteResult =
        service.execute(poolId, r.count, r.durationMs)

    @PostMapping("/{poolId}/shutdown")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun shutdown(@PathVariable poolId: String) = service.shutdown(poolId)

    @PostMapping("/{poolId}/shutdown-now")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun shutdownNow(@PathVariable poolId: String) = ShutdownNowResponse(service.shutdownNow(poolId))

    @DeleteMapping("/{poolId}")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun remove(@PathVariable poolId: String) = service.remove(poolId)
}