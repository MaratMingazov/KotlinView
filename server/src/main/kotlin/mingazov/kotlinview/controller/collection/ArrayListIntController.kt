package mingazov.kotlinview.controller.collection

import mingazov.kotlinview.instrumented.collection.ArrayListIntNotFoundException
import mingazov.kotlinview.service.collection.ArrayListIntService
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController

data class CreateArrayListIntResponse(val arrayListId: Long)
data class AddRequest(val value: Int)
data class AddResponse(val result: Boolean)
data class AddAtRequest(val index: Int, val element: Int)
data class GetRequest(val index: Int)
data class GetResponse(val value: Int)
data class ErrorResponse(val error: String)

@RestController
@RequestMapping("/api/arraylistint")
class ArrayListIntController(
    private val arrayListIntService: ArrayListIntService,
) {

    @PostMapping
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun create(): CreateArrayListIntResponse {
        val arrayListInt = arrayListIntService.create()
        val response = CreateArrayListIntResponse(arrayListInt.id)
        return response
    }

    @PostMapping("/{arrayListId}/add")
    fun add(@PathVariable arrayListId: Long, @RequestBody request: AddRequest): AddResponse {
        val result = arrayListIntService.get(arrayListId).add(request.value)
        val response = AddResponse(result)
        return response
    }

    @PostMapping("/{arrayListId}/addAt")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun addAt(@PathVariable arrayListId: Long, @RequestBody request: AddAtRequest) {
        arrayListIntService.get(arrayListId).add(request.index, request.element)
    }

    @PostMapping("/{arrayListId}/get")
    fun get(@PathVariable arrayListId: Long, @RequestBody request: GetRequest): GetResponse {
        val value = arrayListIntService.get(arrayListId).get(request.index)
        val response = GetResponse(value)
        return response
    }

    @DeleteMapping("/{arrayListId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun remove(@PathVariable arrayListId: Long) = arrayListIntService.remove(arrayListId)

    @ExceptionHandler(ArrayListIntNotFoundException::class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    fun handleNotFound(e: ArrayListIntNotFoundException) = ErrorResponse(e.toString())

    @ExceptionHandler(IndexOutOfBoundsException::class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    fun handleIndexOutOfBounds(e: IndexOutOfBoundsException) = ErrorResponse(e.toString())
}