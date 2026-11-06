package mingazov.kotlinview.controller

import mingazov.kotlinview.controller.collection.ErrorResponse
import mingazov.kotlinview.instrumented.ObjectNotFoundException
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestControllerAdvice

/**
 * Общие ответы на ошибки для всех контроллеров. Spring сначала ищет @ExceptionHandler в самом контроллере,
 * и только если там не нашлось — здесь. Поэтому контроллер может переопределить ответ на своё исключение.
 */
@RestControllerAdvice
class ErrorHandlers {

    // Любой реестр: объекта с таким id нет
    @ExceptionHandler(ObjectNotFoundException::class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    fun handleNotFound(e: ObjectNotFoundException) = ErrorResponse(e.toString())
}
