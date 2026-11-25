package com.hospitalbooking.assisted.ui

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import com.hospitalbooking.assisted.net.Transport
import com.hospitalbooking.assisted.session.SessionStore
import org.json.JSONObject

class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private val backend by lazy { Backend(this) }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        setContentView(web)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true   // localStorage persistence
        web.settings.useWideViewPort = true
        web.settings.loadWithOverviewMode = true
        web.webViewClient = WebViewClient()
        web.addJavascriptInterface(WebBridge(backend), "nativeApi")

        // The packaged React assets. For a real build, copy ui/dist into assets/.
        web.loadUrl("file:///android_asset/app/index.html")
    }

    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }
}

/** Mirrors the Electron preload's window.api.call(op, params). */
class WebBridge(private val backend: Backend) {
    @JavascriptInterface
    fun call(op: String, paramsJson: String): String {
        val params = try { JSONObject(paramsJson) } catch (_: Exception) { JSONObject() }
        return backend.execute(op, params).toString()
    }
}
