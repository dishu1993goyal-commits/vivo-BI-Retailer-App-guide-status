package com.vivo.bidashboard;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import org.json.JSONObject;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

public class MainActivity extends Activity {

    private static final String START_URL = "https://vivo-business-innovation-dashboard-22.netlify.app/";
    private static final String APP_HOST = "vivo-business-innovation-dashboard-22.netlify.app";
    private static final int FILE_CHOOSER_REQUEST = 1001;

    // SHA-256 of the app password (the password itself is not stored in the app)
    private static final String PASSWORD_SHA256 = "e90006efb1935ad651efa74b10b58270650d34be833a320228eef0437dad2403";
    private static final long RELOCK_AFTER_MS = 5 * 60 * 1000; // re-ask after 5 min in background
    private static final int MAX_ATTEMPTS = 5;
    private static final long LOCKOUT_MS = 30 * 1000;

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private boolean unlocked = false;
    private long backgroundedAt = 0;
    private int failedAttempts = 0;
    private long lockedUntil = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        showLogin();
    }

    @Override
    protected void onStop() {
        super.onStop();
        backgroundedAt = System.currentTimeMillis();
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (unlocked && backgroundedAt > 0 && System.currentTimeMillis() - backgroundedAt > RELOCK_AFTER_MS) {
            showLogin();
        }
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private static String sha256(String s) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] h = md.digest(s.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : h) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    private void showLogin() {
        unlocked = false;

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER_HORIZONTAL);
        box.setPadding(dp(28), dp(72), dp(28), dp(28));
        box.setBackgroundColor(Color.WHITE);

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.mipmap.ic_launcher);
        box.addView(logo, new LinearLayout.LayoutParams(dp(96), dp(96)));

        TextView title = new TextView(this);
        title.setText(R.string.app_name);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setTextColor(Color.parseColor("#111111"));
        title.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(-1, -2);
        tp.topMargin = dp(16);
        box.addView(title, tp);

        TextView sub = new TextView(this);
        sub.setText("Enter password to continue");
        sub.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        sub.setTextColor(Color.parseColor("#666666"));
        sub.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(-1, -2);
        sp.topMargin = dp(6);
        sp.bottomMargin = dp(28);
        box.addView(sub, sp);

        EditText pass = new EditText(this);
        pass.setHint("Password");
        pass.setSingleLine(true);
        pass.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        pass.setImeOptions(EditorInfo.IME_ACTION_DONE);
        pass.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        pass.setPadding(dp(16), dp(14), dp(16), dp(14));
        GradientDrawable field = new GradientDrawable();
        field.setColor(Color.parseColor("#F5F6FA"));
        field.setCornerRadius(dp(10));
        field.setStroke(dp(1), Color.parseColor("#D8DAE5"));
        pass.setBackground(field);
        box.addView(pass, new LinearLayout.LayoutParams(-1, -2));

        CheckBox show = new CheckBox(this);
        show.setText("Show password");
        show.setTextColor(Color.parseColor("#555555"));
        show.setOnCheckedChangeListener((b, checked) -> {
            pass.setInputType(InputType.TYPE_CLASS_TEXT | (checked
                    ? InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
                    : InputType.TYPE_TEXT_VARIATION_PASSWORD));
            pass.setSelection(pass.getText().length());
        });
        LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(-1, -2);
        cp.topMargin = dp(6);
        box.addView(show, cp);

        TextView err = new TextView(this);
        err.setTextColor(Color.parseColor("#C62828"));
        err.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        err.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams ep = new LinearLayout.LayoutParams(-1, -2);
        ep.topMargin = dp(6);
        box.addView(err, ep);

        Button login = new Button(this);
        login.setText("Login");
        login.setAllCaps(false);
        login.setTextColor(Color.WHITE);
        login.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        GradientDrawable btn = new GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
                new int[]{Color.parseColor("#4D5BF9"), Color.parseColor("#9152E0")});
        btn.setCornerRadius(dp(10));
        login.setBackground(btn);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, dp(52));
        lp.topMargin = dp(14);
        box.addView(login, lp);

        Runnable attempt = () -> {
            long now = System.currentTimeMillis();
            if (now < lockedUntil) {
                err.setText("Too many attempts. Try again in " + ((lockedUntil - now) / 1000 + 1) + " seconds.");
                return;
            }
            if (PASSWORD_SHA256.equals(sha256(pass.getText().toString()))) {
                failedAttempts = 0;
                ((InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE))
                        .hideSoftInputFromWindow(pass.getWindowToken(), 0);
                unlock();
            } else {
                failedAttempts++;
                pass.setText("");
                if (failedAttempts >= MAX_ATTEMPTS) {
                    failedAttempts = 0;
                    lockedUntil = now + LOCKOUT_MS;
                    err.setText("Too many attempts. Try again in 30 seconds.");
                } else {
                    err.setText("Incorrect password. " + (MAX_ATTEMPTS - failedAttempts) + " attempts left.");
                }
            }
        };
        login.setOnClickListener(v -> attempt.run());
        pass.setOnEditorActionListener((v, actionId, event) -> {
            attempt.run();
            return true;
        });

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.WHITE);
        scroll.addView(box);
        setContentView(scroll);
        pass.requestFocus();
    }

    private void unlock() {
        unlocked = true;
        backgroundedAt = 0;
        if (webView == null) {
            setupWebView();
        }
        if (webView.getParent() != null) {
            ((ViewGroup) webView.getParent()).removeView(webView);
        }
        setContentView(webView);
    }

    private void setupWebView() {
        webView = new WebView(this);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setSupportZoom(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                if (("https".equals(scheme) || "http".equals(scheme))) {
                    String host = uri.getHost();
                    if (host != null && host.endsWith(APP_HOST)) {
                        return false; // stay inside the app
                    }
                }
                openExternally(uri);
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                view.evaluateJavascript(DOWNLOAD_HOOK_JS, null);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                view.evaluateJavascript(DOWNLOAD_HOOK_JS, null);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    String html = "<html><body style='font-family:sans-serif;text-align:center;padding-top:40%;color:#333'>"
                            + "<h2>No internet connection</h2><p>Please check your connection and try again.</p>"
                            + "<button style='background:#4F5BFA;color:#fff;border:0;border-radius:8px;padding:12px 28px;font-size:16px' "
                            + "onclick=\"location.href='" + START_URL + "'\">Retry</button></body></html>";
                    view.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                // The page asks for ".xlsx" etc. — Android's picker only understands MIME types,
                // so open the picker for all files and let the page validate the choice.
                Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
                pick.addCategory(Intent.CATEGORY_OPENABLE);
                pick.setType("*/*");
                if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                    pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                }
                try {
                    startActivityForResult(Intent.createChooser(pick, "Choose file"), FILE_CHOOSER_REQUEST);
                } catch (ActivityNotFoundException e) {
                    filePathCallback = null;
                    return false;
                }
                return true;
            }
        });

        // Bridge that receives files created inside the page (blob:/data: downloads) and saves them
        webView.addJavascriptInterface(new DownloadBridge(), "AndroidDL");

        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            if (url.startsWith("blob:") || url.startsWith("data:")) {
                String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
                webView.evaluateJavascript("window.__bidlSend && window.__bidlSend("
                        + JSONObject.quote(url) + "," + JSONObject.quote(name) + ")", null);
                return;
            }
            try {
                String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
                DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
                req.setMimeType(mimeType);
                req.addRequestHeader("cookie", CookieManager.getInstance().getCookie(url));
                req.addRequestHeader("User-Agent", userAgent);
                req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                ((DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(req);
                Toast.makeText(this, "Downloading " + name, Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                openExternally(Uri.parse(url));
            }
        });

        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);

        webView.loadUrl(START_URL);
    }

    private void openExternally(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No app found to open this link", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST && filePathCallback != null) {
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int n = data.getClipData().getItemCount();
                    result = new Uri[n];
                    for (int i = 0; i < n; i++) result[i] = data.getClipData().getItemAt(i).getUri();
                } else if (data.getData() != null) {
                    result = new Uri[]{data.getData()};
                }
            }
            filePathCallback.onReceiveValue(result);
            filePathCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    // Catches downloads the page creates itself (<a download href="blob:..."> and data: links),
    // reads the file contents and hands them to AndroidDL.save(). Revokes are delayed so the
    // page's own cleanup can't delete the file before it has been read.
    private static final String DOWNLOAD_HOOK_JS =
            "(function(){if(window.__bidl)return;window.__bidl=1;" +
            "var rv=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=function(u){setTimeout(function(){rv(u)},120000)};" +
            "window.__bidlSend=function(href,name){fetch(href).then(function(r){return r.blob()}).then(function(b){" +
            "var fr=new FileReader();fr.onloadend=function(){var s=String(fr.result);var i=s.indexOf(',');" +
            "AndroidDL.save(s.substring(i+1),name||'download',b.type||'')};fr.onerror=function(){AndroidDL.fail('read')};" +
            "fr.readAsDataURL(b)})['catch'](function(e){AndroidDL.fail(String(e))})};" +
            "function grab(a){var h=a.href||'';if(a.hasAttribute('download')&&(h.indexOf('blob:')===0||h.indexOf('data:')===0)){" +
            "window.__bidlSend(h,a.getAttribute('download')||a.download||'');return true}return false}" +
            "document.addEventListener('click',function(e){var t=e.target;var a=t&&t.closest?t.closest('a'):null;" +
            "if(a&&grab(a)){e.preventDefault();e.stopImmediatePropagation()}},true);" +
            "var oc=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){" +
            "if(!this.isConnected&&grab(this))return;return oc.apply(this,arguments)};" +
            "})();";

    private static String mimeFor(String name, String given) {
        if (given != null && !given.isEmpty() && !given.equals("application/octet-stream")) return given;
        String ext = name.contains(".") ? name.substring(name.lastIndexOf('.') + 1).toLowerCase() : "";
        switch (ext) {
            case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
            case "xls": return "application/vnd.ms-excel";
            case "csv": return "text/csv";
            case "zip": return "application/zip";
            case "png": return "image/png";
            case "jpg": case "jpeg": return "image/jpeg";
            case "pdf": return "application/pdf";
            case "html": case "htm": return "text/html";
            case "json": return "application/json";
            case "txt": return "text/plain";
            default: return "application/octet-stream";
        }
    }

    private class DownloadBridge {
        @JavascriptInterface
        public void save(String base64, String rawName, String mime) {
            String name = rawName == null ? "" : rawName.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
            if (name.isEmpty()) name = "download";
            String type = mimeFor(name, mime);
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                Uri saved = null;
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                    cv.put(MediaStore.MediaColumns.MIME_TYPE, type);
                    cv.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                    ContentResolver cr = getContentResolver();
                    saved = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                    if (saved == null) throw new Exception("Could not create file");
                    try (OutputStream os = cr.openOutputStream(saved)) {
                        os.write(bytes);
                    }
                } else {
                    File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                    if (dir != null && !dir.exists()) dir.mkdirs();
                    File f = new File(dir, name);
                    try (FileOutputStream os = new FileOutputStream(f)) {
                        os.write(bytes);
                    }
                }
                final Uri uri = saved;
                final String fname = name;
                runOnUiThread(() -> afterSave(uri, fname, type));
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this,
                        "Couldn't save file: " + e.getMessage(), Toast.LENGTH_LONG).show());
            }
        }

        @JavascriptInterface
        public void fail(String reason) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this,
                    "Download failed, please try again", Toast.LENGTH_LONG).show());
        }
    }

    private void afterSave(Uri uri, String name, String type) {
        if (uri == null) {
            Toast.makeText(this, "Saved " + name, Toast.LENGTH_LONG).show();
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle("Saved to Downloads")
                .setMessage(name)
                .setPositiveButton("Share", (d, w) -> {
                    Intent s = new Intent(Intent.ACTION_SEND);
                    s.setType(type);
                    s.putExtra(Intent.EXTRA_STREAM, uri);
                    s.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivity(Intent.createChooser(s, "Share " + name));
                })
                .setNeutralButton("Open", (d, w) -> {
                    Intent o = new Intent(Intent.ACTION_VIEW);
                    o.setDataAndType(uri, type);
                    o.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    try {
                        startActivity(o);
                    } catch (ActivityNotFoundException e) {
                        Toast.makeText(this, "No app found to open this file", Toast.LENGTH_SHORT).show();
                    }
                })
                .setNegativeButton("OK", null)
                .show();
    }

    @Override
    public void onBackPressed() {
        if (unlocked && webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
