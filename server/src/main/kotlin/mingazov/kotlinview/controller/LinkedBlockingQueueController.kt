package mingazov.kotlinview.controller

import mingazov.kotlinview.service.InstrumentedRunnableBlockingQueueService
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController

data class CreateQueueRequest(val capacity: Int)
data class CreateQueueResponse(val queueId: Long)
data class OfferResponse(val accepted: Boolean)
data class PollResponse(val elementId: Long?)

@RestController
@RequestMapping("/api/queues")
class LinkedBlockingQueueController(
    private val service: InstrumentedRunnableBlockingQueueService,
) {

    @PostMapping
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun create(@RequestBody request: CreateQueueRequest): CreateQueueResponse {
        val queue = service.create(request.capacity)
        val response = CreateQueueResponse(queue.id)
        return response
    }

    @PostMapping("/{queueId}/offer")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun offer(@PathVariable queueId: Long) = OfferResponse(service.offer(queueId))

    @DeleteMapping("/{queueId}")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun remove(@PathVariable queueId: Long) = service.remove(queueId)
}