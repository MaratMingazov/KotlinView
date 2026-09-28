package mingazov.kotlinview.instrumented

class InstrumentedRunnable(val id: Long, val durationMs: Long) : Runnable {

    override fun run() {
        Thread.sleep(durationMs)
    }

    override fun toString() = "task-$id"
}