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

@RestController
@RequestMapping("/api/linkedlistint")
class LinkedListIntController(
    private val linkedListIntService: LinkedListIntService,
) {

    @PostMapping
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun create(): CreatedResponse {
        val linkedListInt = linkedListIntService.create()
        val response = CreatedResponse(linkedListInt.id)
        return response
    }

    @PostMapping("/{linkedListId}/add")
    fun add(@PathVariable linkedListId: Long, @RequestBody request: ElementRequest): ResultResponse<Boolean> {
        val result = linkedListIntService.get(linkedListId).add(request.element)
        val response = ResultResponse(result)
        return response
    }

    @PostMapping("/{linkedListId}/offer")
    fun offer(@PathVariable linkedListId: Long, @RequestBody request: ElementRequest): ResultResponse<Boolean> {
        val result = linkedListIntService.get(linkedListId).offer(request.element)
        val response = ResultResponse(result)
        return response
    }

    @PostMapping("/{linkedListId}/offerFirst")
    fun offerFirst(@PathVariable linkedListId: Long, @RequestBody request: ElementRequest): ResultResponse<Boolean> {
        val result = linkedListIntService.get(linkedListId).offerFirst(request.element)
        val response = ResultResponse(result)
        return response
    }

    @PostMapping("/{linkedListId}/offerLast")
    fun offerLast(@PathVariable linkedListId: Long, @RequestBody request: ElementRequest): ResultResponse<Boolean> {
        val result = linkedListIntService.get(linkedListId).offerLast(request.element)
        val response = ResultResponse(result)
        return response
    }

    /** result == null — список был пуст. */
    @PostMapping("/{linkedListId}/poll")
    fun poll(@PathVariable linkedListId: Long): ResultResponse<Int?> {
        val result = linkedListIntService.get(linkedListId).poll()
        val response = ResultResponse(result)
        return response
    }

    @PostMapping("/{linkedListId}/pop")
    fun pop(@PathVariable linkedListId: Long): ResultResponse<Int> {
        val result = linkedListIntService.get(linkedListId).pop()
        val response = ResultResponse(result)
        return response
    }

    @DeleteMapping("/{linkedListId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun remove(@PathVariable linkedListId: Long) = linkedListIntService.remove(linkedListId)

    @ExceptionHandler(LinkedListIntNotFoundException::class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    fun handleNotFound(e: LinkedListIntNotFoundException) = ErrorResponse(e.toString())

    // pop() на пустом списке. LinkedListIntNotFoundException — тоже NoSuchElementException,
    // но Spring выбирает самый точный обработчик, поэтому «списка нет» по-прежнему уходит в 404 выше
    @ExceptionHandler(NoSuchElementException::class)
    @ResponseStatus(HttpStatus.CONFLICT)
    fun handleEmpty(e: NoSuchElementException) = ErrorResponse(e.toString())
}