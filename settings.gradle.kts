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
 *   curl -i -X POST localhost:8080/api/queues/queue-1/poll
 *   curl -i -X DELETE localhost:8080/api/queues/queue-1
 *
 *
 *   curl -X POST localhost:8080/api/executors -H "Content-Type: application/json" -d '{"corePoolSize":1,"maximumPoolSize":1,"keepAliveMs":2000,"queueType":"LINKED","queueCapacity":2}'
 *   curl -X POST localhost:8080/api/executors/pool-1/tasks -H "Content-Type: application/json" -d '{"count":2,"durationMs":5000}'

 *   curl -X DELETE localhost:8080/api/executors/pool-1
 *   curl -X POST localhost:8080/api/executors/pool-1/shutdown
 *   curl -X POST localhost:8080/api/executors/pool-1/execute -H "Content-Type: application/json" -d '{"count":1,"durationMs":1000}'
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