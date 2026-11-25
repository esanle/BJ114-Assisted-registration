package com.hospitalbooking.assisted.js

import org.mozilla.javascript.Context
import org.mozilla.javascript.ScriptableObject

/**
 * Abstraction of the jsdom-based anti-bot sandbox from runtime/query_runtime.cjs.
 *
 * The desktop runtime executes the site's own JS in jsdom to compute dynamic
 * tokens, with a set of helpers patching V8-specific quirks. Rhino is not V8, so
 * helpers that depend on V8 private intrinsics (%GetUndetectable etc.) cannot be
 * reproduced verbatim. This interface keeps that boundary explicit so each
 * helper can be ported or marked unsupported individually.
 */
interface JsSandbox {
    fun installDocument(html: String, baseUrl: String)
    fun evaluate(script: String): String
    fun close()

    /** Names of desktop helpers that could not be faithfully reproduced. */
    fun unsupportedHelpers(): List<String>
}

class RhinoSandbox : JsSandbox {
    private var ctx: Context? = null
    private var scope: ScriptableObject? = null

    override fun installDocument(html: String, baseUrl: String) {
        val c = Context.enter()
        val s = c.initStandardObjects()
        // Minimal DOM shims. Real port needs: document.querySelectorAll('script[src]'),
        // XMLHttpRequest bridging to Transport, cookie jar, location, navigator, screen.
        ScriptableObject.putProperty(s, "__documentHtml", html)
        ScriptableObject.putProperty(s, "__baseUrl", baseUrl)
        c.evaluateString(s, DOM_SHIM, "dom-shim.js", 1, null)
        ctx = c; scope = s
    }

    override fun evaluate(script: String): String {
        val c = ctx ?: error("sandbox not initialized")
        val s = scope ?: error("sandbox not initialized")
        return c.evaluateString(s, script, "site.js", 1, null)?.toString() ?: ""
    }

    override fun close() { Context.exit(); ctx = null; scope = null }

    override fun unsupportedHelpers(): List<String> = listOf(
        "document_all_runtime_20261109_checked_lazy",   // requires V8 exotic ownKeys
        "deprecated_storage_quota_runtime_...realm_...", // requires V8 native realm identity
        "script_text_audit/apply_script_innertext"      // requires %GetUndetectable intrinsic
    )

    companion object {
        // Placeholder: a faithful DOM needs a real DOM implementation (e.g. jsoup
        // bridged into Rhino). Kept minimal so the project compiles and the
        // unsupported surface is visible rather than silently wrong.
        const val DOM_SHIM = """
            var document = { querySelectorAll: function(){ return []; }, cookie: '' };
            var navigator = { userAgent: '', platform: 'Linux armv8l', language: 'zh-CN' };
            var screen = { width: 412, height: 915, colorDepth: 24 };
            var location = { href: __baseUrl };
            function XMLHttpRequest(){ this.open=function(){}; this.send=function(){}; }
        """
    }
}
