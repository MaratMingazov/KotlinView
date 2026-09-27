/**
 *  ./gradlew --version - узнать версию gradle
 *  ./gradlew :server:bootRun  - запускаем сервер
 *  curl -i localhost:8080  - в другом окне выполняем.  Ответ 404 — это правильно: сервер жив, просто эндпоинтов ещё нет. Сервер останавливается через Ctrl+C
 */

rootProject.name = "kotlin-view" // IntelliJ: под этим именем проект виден в окне Gradle и в дереве модулей.


include("server") // gradle знает что у нас есть модуль server

// откуда качать библиотеки
dependencyResolutionManagement {
    repositories {
        mavenCentral()
    }
}