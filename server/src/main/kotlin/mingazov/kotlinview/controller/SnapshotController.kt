package mingazov.kotlinview.controller

import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

data class SnapshotResponse(
    val seq: Long,
    val protocolVersion: Int,
    val executors: List<Any>,
)

@RestController
@RequestMapping("/api")
class SnapshotController {

    @GetMapping("/snapshot")
    fun snapshot(): SnapshotResponse =
        SnapshotResponse(seq = 0, protocolVersion = 1, executors = emptyList())
}