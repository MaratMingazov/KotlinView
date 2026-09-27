
plugins {
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
    alias(libs.plugins.kotlin.jvm) // Теперь gradle знает как работать с kotlin

    alias(libs.plugins.kotlin.spring) // для Spring важно открытые классы, чтобы создавать proxy. Kotlin по умолачнию делает классы final. Этот плагин при компиляции делает open все классы со Spring-аннотациями
    alias(libs.plugins.spring.boot) // добавляет задачи bootRun и bootJar для запуска приложения
    alias(libs.plugins.spring.dependency.management) // Плагин позволяет автоматически подтягивать нужную версию библиотеки из BOM
}


kotlin {
    /**
     * Здесь мы говорим какой JDK использовать при сборке проекта
     * Toolchain — это JDK, которым Gradle компилирует код, запускает тесты и приложение. 25 означает Java 25.
     */
    jvmToolchain(25)

    compilerOptions {
        freeCompilerArgs.addAll("-Xjsr305=strict") //  аннотации @Nullable/@NonNull из Java-кода Spring Kotlin будет понимать как String? и String
    }

    dependencies {
        implementation(libs.spring.boot.starter.webmvc)
        implementation(libs.jackson.module.kotlin)
        implementation(libs.kotlin.reflect)
    }
}