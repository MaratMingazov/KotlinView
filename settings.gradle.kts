/**
 *  ./gradlew --version - узнать версию gradle
 *  ./gradlew :server:bootRun  - запускаем сервер
 *  curl -i localhost:8080  - в другом окне выполняем.  Ответ 404 — это правильно: сервер жив, просто эндпоинтов ещё нет. Сервер останавливается через Ctrl+C
 *  curl -i localhost:8080/api/snapshot
 *
 *  Проверка веб-сокета
 *   - Открой http://localhost:8080 (будет страница с ошибкой 404, это нормально).
 *    - Открой DevTools → Console и выполни
 *    const ws = new WebSocket("ws://localhost:8080/ws/events");
 *    ws.onmessage = e => console.log(e.data);
 *    ws.close()
 *
 *   curl -i -X POST localhost:8080/api/queues -H 'Content-Type: application/json' -d '{"capacity":2}'
 *   curl -X POST localhost:8080/api/queues -H 'Content-Type: application/json' -d '{"capacity":2}'
 *   curl -i -X POST localhost:8080/api/queues/queue-1/offer
 *   curl -i -X POST localhost:8080/api/queues/queue-1/offer
 *   curl -i -X POST localhost:8080/api/queues/queue-1/offer      # не влезет → accepted: false
 *   curl -i -X POST localhost:8080/api/queues/queue-1/poll
 *   curl -i -X POST localhost:8080/api/queues/queue-2/poll       # нет такой → 404
 *
 */

rootProject.name = "kotlin-view" // IntelliJ: под этим именем проект виден в окне Gradle и в дереве модулей.


include("server") // gradle знает что у нас есть модуль server
include("algorithms") // gradle знает что у нас есть модуль algorithms

// откуда качать библиотеки
dependencyResolutionManagement {
    repositories {
        mavenCentral()
    }
}