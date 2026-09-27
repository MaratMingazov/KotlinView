/**
 *  ./gradlew --version - узнать версию gradle
 */

rootProject.name = "kotlin-view" // IntelliJ: под этим именем проект виден в окне Gradle и в дереве модулей.


include("server") // gradle знает что у нас есть модуль server

// откуда качать библиотеки
dependencyResolutionManagement {
    repositories {
        mavenCentral()
    }
}