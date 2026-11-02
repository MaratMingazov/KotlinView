package mingazov.kotlinview.controller.collection

import mingazov.kotlinview.instrumented.collection.LinkedListIntNotFoundException
import mingazov.kotlinview.service.collection.LinkedListIntService
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController

data class CreateLinkedListIntResponse(val linkedListId: Long)
data class LinkedListIntAddRequest(val element: Int)

@RestController
@RequestMapping("/api/linkedlistint")
class LinkedListIntController(
    private val linkedListIntService: LinkedListIntService,
) {

    @PostMapping
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun create(): CreateLinkedListIntResponse {
        val linkedListInt = linkedListIntService.create()
        val response = CreateLinkedListIntResponse(linkedListInt.id)
        return response
    }

    @PostMapping("/{linkedListId}/add")
    fun add(@PathVariable linkedListId: Long, @RequestBody request: LinkedListIntAddRequest): AddResponse {
        val result = linkedListIntService.get(linkedListId).add(request.element)
        val response = AddResponse(result)
        return response
    }

    @DeleteMapping("/{linkedListId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun remove(@PathVariable linkedListId: Long) = linkedListIntService.remove(linkedListId)

    @ExceptionHandler(LinkedListIntNotFoundException::class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    fun handleNotFound(e: LinkedListIntNotFoundException) = ErrorResponse(e.toString())
}