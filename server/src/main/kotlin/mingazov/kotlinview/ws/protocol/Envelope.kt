package mingazov.kotlinview.ws.protocol

import com.fasterxml.jackson.annotation.JsonTypeInfo

/**
 * seq
 * Монотонно возрастающий порядковый номер события.
 * Позволяет решить сразу несколько проблемы:
 * 1. Обнаружение пропуска. Клиент получил 5 потом 7? Значит что то потеряно и нужно запросить весь снимок заново
 * 2. Отбрасывание дублей.  Клиент получил 7 потом 5? Мы уже должны были обработать 5, значит это дубль
 * 3. Связь со снимком. Если пришел Snapshot с номером 5, значит следующее событие должно быть 6.
 *
 * ts - Время на сервере, когда произошло событие
 * type - что за данные пришли в data и как это обработать.
 *   Отдельного поля нет: Jackson сам пишет "type" рядом с data, беря его из @JsonTypeName класса payload'а.
 *   Поэтому type и data не могут разойтись.
 *
 */
data class Envelope(
    val seq: Long,
    val ts: Long,
    @JsonTypeInfo(use = JsonTypeInfo.Id.NAME, include = JsonTypeInfo.As.EXTERNAL_PROPERTY, property = "type")
    val data: Payload,
)

/**
 * Это номер версии договора между сервером и клиентом о формате сообщений: какие есть события, какие у них поля и что они значат.
 * Клиент смотрит на него и понимает, умеет ли он разговаривать с этим сервером
 */
const val PROTOCOL_VERSION = 1

/** Всё, что может лежать в Envelope.data. У каждого наследника @JsonTypeName — это и есть type в протоколе. */
sealed interface Payload