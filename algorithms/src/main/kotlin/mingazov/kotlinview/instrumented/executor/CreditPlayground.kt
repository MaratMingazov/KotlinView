package mingazov.kotlinview.instrumented.executor

import java.util.concurrent.Callable
import java.util.concurrent.CompletableFuture.runAsync
import java.util.concurrent.CompletableFuture.supplyAsync
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference
import kotlin.time.Clock


fun main() {
    println("${Thread.currentThread().name} - MAIN started - ${Clock.System.now()}")
    //calculateCreditSynchronous(0)
    //calculateCreditAsynchronous(0)
    calculateCreditWithExecutor(0)
    println("${Thread.currentThread().name} - MAIN completed - ${Clock.System.now()}")
}

data class Credit(val score: Long)
data class Person(val personId: Long, val name: String)
data class Asset(val type: String, val value: Long)
data class Liability(val type: String, val value: Long)

fun calculateCreditSynchronous(personId: Long) : Credit {
    val person = getPerson(personId) // Вызов БД блокирует поток 1 sec
    val asset = getAsset(person) // Вызов API блокирует поток 1 sec
    val liability = getLiability(person) // Вызов БД блокирует поток 1 sec
    importantWork() // 1 sec
    return calculateCredit(asset, liability) // 1 sec
}

fun calculateCreditAsynchronous(personId: Long) : Credit {
    val person = getPerson(personId) // Вызов БД блокирует поток 1 sec

    val assetRef = AtomicReference<Asset>()
    val task1 = Runnable { val asset = getAsset(person); assetRef.set(asset) }  // Вызов API блокирует поток 1 sec

    val liabilityRef = AtomicReference<Liability>()
    val task2 = Runnable { val liability = getLiability(person); liabilityRef.set(liability) } // Вызов БД блокирует поток 1 sec

    val thread1 = Thread(task1)
    val thread2 = Thread(task2)
    val thread3 = Thread{ importantWork() }

    thread1.start()
    thread2.start()
    thread3.start()

    thread1.join()
    thread2.join()

    val credit =  calculateCredit(assetRef.get(), liabilityRef.get()) // 1 sec
    thread3.join()
    return credit
}

fun calculateCreditWithExecutor(personId: Long): Credit {
    val person = getPerson(personId) // Вызов БД блокирует поток 1 sec
    return Executors.newFixedThreadPool(3).use { executor ->
        val assetFuture = executor.submit(Callable { getAsset(person) })         // 1 sec
        val liabilityFuture = executor.submit(Callable { getLiability(person) }) // 1 sec
        executor.submit({ importantWork() })                           // 1 sec
        calculateCredit(assetFuture.get(), liabilityFuture.get()) // 1 sec
    }
}

fun calculateCreditWithCompletableFuture(personId: Long): Credit {

    val personFuture = supplyAsync { getPerson(personId) } // принимает supplier, return CompletableFuture<Person>. Сразу начинается выполнение.
    val importantFuture = runAsync { importantWork() } // принимает Runnable, return CompletableFuture<Void>. Сразу начинается выполнение.
    val assetFuture = personFuture.thenApplyAsync { person -> getAsset(person) } // запустится сразу как завершится personFuture.
    val liabilityFuture = personFuture.thenApplyAsync { person -> getLiability(person) } // запустится сразу как завершится personFuture.
    return assetFuture.thenCombine(liabilityFuture) { asset, liability -> calculateCredit(asset, liability) }
        .thenCombine(importantFuture) { credit, _ -> credit } // здесь мы просто ждем пока завершится credit и importantWork
        .join()
}

fun calculateCreditWithCompletableFuture2(personId: Long): Credit =
    Executors.newFixedThreadPool(3).use { executor ->
        val personFuture = supplyAsync({ getPerson(personId) }, executor)                 // 1 сек
        val importantFuture = runAsync({ importantWork() }, executor)                      // 1 сек, параллельно
        val assetF = personFuture.thenApplyAsync({ getAsset(it) }, executor)               // 1–2 сек
        val liabilityF = personFuture.thenApplyAsync({ getLiability(it) }, executor)       // 1–2 сек, параллельно
        assetF.thenCombine(liabilityF) { asset, liability -> calculateCredit(asset, liability) } // 2–3 сек
            .thenCombine(importantFuture) { credit, _ -> credit }  // как join() у thread3: ждём importantWork
            .join()
    }

fun getPerson(personId: Long): Person { Thread.sleep(1000); return Person(personId, "") }
fun getAsset(person: Person): Asset { Thread.sleep(1000); return Asset(person.name, 0) }
fun getLiability(person: Person): Liability { Thread.sleep(1000); return Liability("", person.personId) }
fun importantWork() { Thread.sleep(1000); }
fun calculateCredit(asset: Asset, liability: Liability): Credit { Thread.sleep(1000); return Credit(asset.value + liability.value) }