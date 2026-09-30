package com.y99.browser;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

public class MainActivity extends Activity {
    private static final String TARGET = "https://y99.in/web/desktop/discover";
    private static final String TAG = "Y99Browser";
    private static final int BG = Color.parseColor("#0B0B10");
    private static final long RETRY_MS = 3000;
    private static final String DESKTOP_UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    + "(KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

    private final Handler ui = new Handler(Looper.getMainLooper());
    private FrameLayout root;
    private WebView web;
    private ProgressBar bar;
    private LinearLayout overlay;
    private TextView overlayText;
    private ConnectivityManager cm;
    private ConnectivityManager.NetworkCallback netCb;

    private String watcherJs = "";
    private boolean failed, reached, netLost;
    private int autoTries;
    private String lastState;

    private final Runnable retry = () -> web.loadUrl(TARGET);

    private synchronized void emit(String state) {
        if (state.equals(lastState)) return;
        lastState = state;
        Log.i(TAG, "Stranger " + state);
    }

    private synchronized void drop() {
        if ("connected".equals(lastState)) emit("disconnected");
    }

    private class Bridge {
        @JavascriptInterface
        public void state(String s) {
            if ("connected".equals(s) || "disconnected".equals(s)) emit(s);
        }

        @JavascriptInterface
        public void event(String json) {
            Log.i(TAG, "INSPECTOR " + json);
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        watcherJs = readAsset("y99_watcher.js");

        root = new FrameLayout(this);
        root.setBackgroundColor(BG);

        web = new WebView(this);
        web.setBackgroundColor(BG);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));

        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        root.addView(bar, new FrameLayout.LayoutParams(-1, (int) (3 * getResources().getDisplayMetrics().density)));

        overlay = new LinearLayout(this);
        overlay.setOrientation(LinearLayout.VERTICAL);
        overlay.setGravity(Gravity.CENTER);
        overlay.setBackgroundColor(BG);
        overlay.setClickable(true);
        overlay.addView(new ProgressBar(this));
        overlayText = new TextView(this);
        overlayText.setTextColor(Color.LTGRAY);
        overlayText.setPadding(0, 32, 0, 0);
        overlayText.setText("Loading Y99…");
        overlay.addView(overlayText);
        root.addView(overlay, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setUserAgentString(DESKTOP_UA);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(web, true);

        web.addJavascriptInterface(new Bridge(), "Y99Native");
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView v, int p) {
                bar.setProgress(p);
                bar.setVisibility(p >= 100 ? ViewGroup.GONE : ViewGroup.VISIBLE);
            }
            @Override public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d(TAG, "CONSOLE " + m.message() + " @" + m.sourceId() + ":" + m.lineNumber());
                return true;
            }
        });

        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                if (!r.isForMainFrame()) return false;
                Uri u = r.getUrl();
                String scheme = u.getScheme();
                if (scheme == null) return false;
                if (scheme.equals("http") || scheme.equals("https")) {
                    String h = u.getHost();
                    if (h != null && (h.equals("y99.in") || h.endsWith(".y99.in"))) return false;
                } else if (scheme.equals("about") || scheme.equals("data") || scheme.equals("blob")) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) {}
                return true;
            }

            @Override public void onPageStarted(WebView v, String url, android.graphics.Bitmap icon) {
                failed = false;
                ui.removeCallbacks(retry);
                drop();
                Log.i(TAG, "PAGE_STARTED " + url);
            }

            @Override public void onPageFinished(WebView v, String url) {
                if (failed) return;
                v.evaluateJavascript(watcherJs, value -> Log.i(TAG, "WATCHER_INJECTED url=" + url));
                if (!reached) {
                    if (url != null && url.contains("/discover")) reached = true;
                    else if (autoTries++ < 2) { v.loadUrl(TARGET); return; }
                }
                hideOverlay();
            }

            @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) {
                    Log.e(TAG, "MAIN_FRAME_ERROR " + e.getErrorCode() + " " + e.getDescription() + " " + r.getUrl());
                    fail();
                }
            }

            @Override public void onReceivedHttpError(WebView v, WebResourceRequest r, WebResourceResponse e) {
                if (r.isForMainFrame()) {
                    Log.e(TAG, "MAIN_FRAME_HTTP_ERROR " + e.getStatusCode() + " " + r.getUrl());
                    if (e.getStatusCode() >= 500) fail();
                }
            }

            @Override public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail d) {
                Log.e(TAG, "RENDER_PROCESS_GONE didCrash=" + d.didCrash());
                drop();
                ui.post(MainActivity.this::recreate);
                return true;
            }
        });

        cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        netCb = new ConnectivityManager.NetworkCallback() {
            @Override public void onLost(Network n) {
                ui.post(() -> { netLost = true; Log.w(TAG, "NETWORK_LOST"); });
            }
            @Override public void onAvailable(Network n) {
                ui.post(() -> {
                    Log.i(TAG, "NETWORK_AVAILABLE");
                    if (!netLost) return;
                    netLost = false;
                    showOverlay("Reconnecting…");
                    drop();
                    ui.removeCallbacks(retry);
                    web.loadUrl(TARGET);
                });
            }
        };
        cm.registerDefaultNetworkCallback(netCb);
        web.loadUrl(TARGET);
    }

    private void fail() {
        failed = true;
        showOverlay("Reconnecting…");
        ui.removeCallbacks(retry);
        ui.postDelayed(retry, RETRY_MS);
    }

    private void showOverlay(String text) {
        overlayText.setText(text);
        overlay.animate().cancel();
        overlay.setAlpha(1f);
        overlay.setVisibility(ViewGroup.VISIBLE);
    }

    private void hideOverlay() {
        if (overlay.getVisibility() != ViewGroup.VISIBLE) return;
        overlay.animate().alpha(0f).setDuration(250)
                .withEndAction(() -> overlay.setVisibility(ViewGroup.GONE)).start();
    }

    private String readAsset(String name) {
        try (InputStream in = getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString("UTF-8");
        } catch (Exception e) {
            Log.e(TAG, "ASSET_READ_FAILED " + name, e);
            return "";
        }
    }

    @SuppressWarnings("deprecation")
    @Override public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }

    @Override protected void onDestroy() {
        ui.removeCallbacksAndMessages(null);
        try { cm.unregisterNetworkCallback(netCb); } catch (Exception ignored) {}
        if (root != null && web != null) root.removeView(web);
        if (web != null) web.destroy();
        super.onDestroy();
    }
}