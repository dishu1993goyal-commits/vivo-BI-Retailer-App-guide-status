package com.vivo.bidashboard;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
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
                try {
                    startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST);
                } catch (ActivityNotFoundException e) {
                    filePathCallback = null;
                    return false;
                }
                return true;
            }
        });

        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            if (url.startsWith("blob:") || url.startsWith("data:")) {
                Toast.makeText(this, "This download type isn't supported in the app", Toast.LENGTH_SHORT).show();
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
            filePathCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            filePathCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
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
