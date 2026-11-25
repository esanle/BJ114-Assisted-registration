package com.hospitalbooking.assisted.ui

import android.content.Context
import com.hospitalbooking.assisted.js.JsSandbox
import com.hospitalbooking.assisted.js.RhinoSandbox
import com.hospitalbooking.assisted.net.Transport
import com.hospitalbooking.assisted.session.SessionStore
import org.json.JSONArray
import org.json.JSONObject

/**
 * Kotlin counterpart of src/rpc_service.cpp: one long-lived object holding the
 * login state machine, query session, transport and JS sandbox. Dispatches the
 * same operation names so the React UI needs no changes.
 */
class Backend(context: Context) {
    private val transport = Transport()
    private val sessions = SessionStore(context)
    private val sandbox: JsSandbox = RhinoSandbox()
    private var loggedIn = false
    private var patients: JSONArray = JSONArray()

    fun execute(op: String, params: JSONObject): JSONObject = try {
        when (op) {
            "booking_restore" -> restore()
            "booking_captcha" -> captcha()
            "booking_sms" -> sms(params)
            "booking_login" -> login(params)
            "booking_logout" -> logout()
            "booking_patients" -> patientsOp()
            "departments" -> departments(params)
            "availability", "availability_plan" -> availability(op, params)
            "booking_preview" -> preview(params)
            "booking_direct" -> direct(params)
            else -> fail("unsupported_operation")
        }
    } catch (e: Exception) {
        fail(e.message ?: "operation_failed")
    }

    private fun ok(extra: JSONObject.() -> Unit = {}): JSONObject =
        JSONObject().put("ok", true).put("status", "complete").apply(extra)

    private fun fail(failure: String): JSONObject =
        JSONObject().put("ok", false).put("status", "failed").put("failure", failure)

    // ---- Stubs: each mirrors a BookingService/Service operation. ----
    // Network calls are routed through Transport; the anti-bot challenge is
    // evaluated in the JsSandbox. These bodies are the porting work items.

    private fun restore(): JSONObject {
        val cookies = sessions.loadCookies() ?: return JSONObject()
            .put("ok", false).put("restore_state", "missing")
        return ok { put("restored", true); put("restore_state", "restored") }
    }

    private fun captcha(): JSONObject {
        val r = transport.request("GET", "/jtjk/mobile-service/captcha")
        require(r.status == 200) { "captcha_failed" }
        TODO("decode image + run sandbox challenge; return captcha_b64/captcha_width/captcha_height")
    }

    private fun sms(params: JSONObject): JSONObject = ok { put("retry_after_seconds", 60) }
    private fun login(params: JSONObject): JSONObject {
        loggedIn = true
        return ok { put("logged_in", true); put("authenticated", true); put("session_saved", true) }
    }
    private fun logout(): JSONObject { loggedIn = false; sessions.clear(); return ok { put("logged_in", false) } }
    private fun patientsOp(): JSONObject = ok { put("patients", patients) }
    private fun departments(params: JSONObject): JSONObject = ok { put("departments", JSONArray()); put("rows", JSONArray()) }
    private fun availability(op: String, params: JSONObject): JSONObject = ok { put("rows", JSONArray()); put("result_kind", op) }
    private fun preview(params: JSONObject): JSONObject = ok { put("preview_id", "mobile"); put("preview", JSONObject()) }
    private fun direct(params: JSONObject): JSONObject = ok { put("order_id", "mobile-order") }
}
