package com.hospitalbooking.assisted.net

import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

data class Response(val status: Int, val body: String, val headers: Map<String, String>)

/** Android transport replacing libcurl in native_backend.cpp. */
class Transport {
    private val client = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .callTimeout(20, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .build()

    private val allowlist = setOf(
        "/jtjk/mobile-service/hospital/detail", "/jtjk/mobile-service/department/list",
        "/jtjk/mobile-service/product/calendar", "/jtjk/mobile-service/product/doctor/detail",
        "/jtjk/mobile-service/captcha", "/jtjk/mobile-service/phoneCode",
        "/jtjk/mobile-service/auth/phoneLogin", "/jtjk/mobile-service/user/get",
        "/jtjk/mobile-service/auth/user/get", "/jtjk/mobile-service/auth/patient/list",
        "/jtjk/mobile-service/product/confirmV2", "/jtjk/mobile-service/product/confirmRegistration",
        "/jtjk/mobile-service/auth/logout", "/jtjk/mobile-service/user/collect/newHospital"
    )

    fun request(method: String, path: String, body: String? = null, headers: Map<String, String> = emptyMap()): Response {
        require(allowlist.any { path.startsWith(it) }) { "public operation not allowed" }
        val url = "https://$HOST$path"
        val builder = Request.Builder()
            .url(url)
            .header("User-Agent", UA)
            .header("Accept", "application/json, text/plain, */*")
        // Never allow caller-supplied Cookie/Authorization/Host (mirrors desktop guard).
        headers.forEach { (k, v) ->
            require(k.lowercase() !in setOf("cookie", "authorization", "host")) { "header rejected" }
            builder.header(k, v)
        }
        val media = "application/json; charset=utf-8".toMediaType()
        builder.method(method, body?.toRequestBody(media) ?: RequestBody.create(null, ByteArray(0)))
        client.newCall(builder.build()).execute().use { r ->
            val map = r.headers.toMap().toMutableMap()
            return Response(r.code, r.body?.string().orEmpty(), map)
        }
    }

    companion object {
        const val HOST = "www.114yygh.com"
        const val UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36"
    }
}
