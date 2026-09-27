/**
 * Gradle сам по себе ничего не знает про kotlin
 * Нужно научить его работать с kotlin
 * Поэтому подключаем plugin
 * alias(libs.plugins.kotlin.jvm) подключает плагин org.jetbrains.kotlin.jvm с версией из каталога
 * Этот plugin дает возможность:
 *  - Соглашение о папках: исходники лежат в src/main/kotlin, тесты в src/test/kotlin. Поэтому мы нигде не указываем, где лежит Main.kt, и Gradle всё равно его нашёл.
 *  - Задачи
 *      :server:compileKotlin -> компиляция .kt в .class
 *      :server:jar           -> упаковка в server/build/libs/server.jar
 *      :server:test          -> запуск тестов
 *      :server:build         -> всё вместе
 *  - Без этого плагина  ./gradlew build не знал бы, что делать.
 *  - Блок dependencies { implementation(...) } для подключения библиотек. Его тоже приносит плагин, на следующем шаге он понадобится для Spring.
 */
plugins {
    alias(libs.plugins.kotlin.jvm)
}

/**
 * Здесь мы говорим какой JDK использовать при сборке проекта
 * Toolchain — это JDK, которым Gradle компилирует код, запускает тесты и приложение. 25 означает Java 25.
 */
kotlin {
    jvmToolchain(25)
}