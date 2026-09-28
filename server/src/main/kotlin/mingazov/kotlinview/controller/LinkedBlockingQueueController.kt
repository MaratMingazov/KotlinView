package mingazov.kotlinview.controller

import mingazov.kotlinview.service.LinkedBlockingQueueService
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController

data class CreateQueueRequest(val capacity: Int)
data class CreateQueueResponse(val queueId: String)
data class OfferResponse(val accepted: Boolean)
data class PollResponse(val elementId: Long?)

@RestController
@RequestMapping("/api/queues")
class LinkedBlockingQueueController(
    private val service: LinkedBlockingQueueService,
) {

    @PostMapping
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun create(@RequestBody request: CreateQueueRequest) = CreateQueueResponse(service.create(request.capacity))

    @PostMapping("/{queueId}/offer")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun offer(@PathVariable queueId: String) = OfferResponse(service.offer(queueId))

    @PostMapping("/{queueId}/poll")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun poll(@PathVariable queueId: String) = PollResponse(service.poll(queueId)?.id)

    @DeleteMapping("/{queueId}")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun remove(@PathVariable queueId: String) = service.remove(queueId)
}