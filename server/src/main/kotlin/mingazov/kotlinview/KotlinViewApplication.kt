package mingazov.kotlinview

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication

/**
 * @SpringBootApplication говорит Spring: «здесь корень приложения; ищи компоненты в этом пакете и ниже и настрой всё автоматически по библиотекам в classpath». Если в classpath
 *   есть webmvc, Spring поднимет Tomcat.
 */
@SpringBootApplication
class KotlinViewApplication

fun main(args: Array<String>) {
    runApplication<KotlinViewApplication>(*args)
}