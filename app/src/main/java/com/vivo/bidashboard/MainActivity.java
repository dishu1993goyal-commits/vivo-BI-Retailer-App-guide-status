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
import android.os.Handler;
import android.os.Looper;
import android.text.InputFilter;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

public class MainActivity extends Activity {

    private static final String START_URL = "https://vivo-business-innovation-dashboard-22.netlify.app/";
    private static final String APP_HOST = "vivo-business-innovation-dashboard-22.netlify.app";
    private static final int FILE_CHOOSER_REQUEST = 1001;

    // SHA-256 of the app password, set per app version in app/build.gradle (the password itself is not stored)
    private static final String PASSWORD_SHA256 = BuildConfig.PASSWORD_SHA256;
    private static final boolean STATE_APP = BuildConfig.STATE_APP;
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
        startAuth();
    }

    // Mobile must be verified by OTP once on this phone; the password is asked every time.
    private void startAuth() {
        if (verifiedPhone() == null) showOtpLogin();
        else showLogin();
    }

    private String verifiedPhone() {
        return getSharedPreferences("auth", MODE_PRIVATE).getString("verified_phone", null);
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
            startAuth();
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

    // ---------- Mobile number + OTP (once per phone) ----------
    private static final String OTP_URL = START_URL + "api/otp";
    private static final int RESEND_SECONDS = 30;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private Runnable resendTick;

    private interface ApiResult { void done(boolean ok, String error); }

    // POSTs to the OTP service on the same Netlify site, off the main thread.
    private void callOtpApi(JSONObject body, ApiResult cb) {
        new Thread(() -> {
            boolean ok = false;
            String err = "No internet connection. Please try again.";
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(OTP_URL).openConnection();
                c.setRequestMethod("POST");
                c.setConnectTimeout(15000);
                c.setReadTimeout(25000);
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json");
                c.setRequestProperty("X-BI-App", "1");
                try (OutputStream os = c.getOutputStream()) {
                    os.write(body.toString().getBytes(StandardCharsets.UTF_8));
                }
                int code = c.getResponseCode();
                InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream();
                StringBuilder sb = new StringBuilder();
                if (in != null) {
                    try (BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
                        String line;
                        while ((line = r.readLine()) != null) sb.append(line);
                    }
                }
                JSONObject res = new JSONObject(sb.length() > 0 ? sb.toString() : "{}");
                ok = res.optBoolean("ok", false);
                err = res.optString("error", ok ? "" : "Something went wrong (" + code + "). Please try again.");
            } catch (Exception e) {
                // keep the "No internet" message
            } finally {
                if (c != null) c.disconnect();
            }
            final boolean fOk = ok;
            final String fErr = err;
            ui.post(() -> cb.done(fOk, fErr));
        }).start();
    }

    private LinearLayout authHeader(String subtitle) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER_HORIZONTAL);
        box.setPadding(dp(28), dp(64), dp(28), dp(28));
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
        sub.setText(subtitle);
        sub.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        sub.setTextColor(Color.parseColor("#666666"));
        sub.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(-1, -2);
        sp.topMargin = dp(6);
        sp.bottomMargin = dp(24);
        box.addView(sub, sp);
        return box;
    }

    private EditText authField(String hint, int inputType, int maxLen) {
        EditText f = new EditText(this);
        f.setHint(hint);
        f.setSingleLine(true);
        f.setInputType(inputType);
        f.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        f.setPadding(dp(16), dp(14), dp(16), dp(14));
        f.setFilters(new InputFilter[]{new InputFilter.LengthFilter(maxLen)});
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.parseColor("#F5F6FA"));
        bg.setCornerRadius(dp(10));
        bg.setStroke(dp(1), Color.parseColor("#D8DAE5"));
        f.setBackground(bg);
        return f;
    }

    private Button authButton(String text) {
        Button b = new Button(this);
        b.setText(text);
        b.setAllCaps(false);
        b.setTextColor(Color.WHITE);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        GradientDrawable bg = new GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
                new int[]{Color.parseColor("#4D5BF9"), Color.parseColor("#9152E0")});
        bg.setCornerRadius(dp(10));
        b.setBackground(bg);
        return b;
    }

    private TextView authMsg(LinearLayout box) {
        TextView m = new TextView(this);
        m.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        m.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.topMargin = dp(8);
        box.addView(m, lp);
        return m;
    }

    private void showScreen(LinearLayout box, View focus) {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.WHITE);
        scroll.addView(box);
        setContentView(scroll);
        if (focus != null) focus.requestFocus();
    }

    private void hideKeyboard(View v) {
        ((InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE))
                .hideSoftInputFromWindow(v.getWindowToken(), 0);
    }

    private void showOtpLogin() {
        unlocked = false;
        if (resendTick != null) ui.removeCallbacks(resendTick);
        LinearLayout box = authHeader("Enter your mobile number to get an OTP");

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        TextView cc = new TextView(this);
        cc.setText("+91");
        cc.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        cc.setTextColor(Color.parseColor("#111111"));
        cc.setPadding(dp(4), 0, dp(12), 0);
        row.addView(cc);
        EditText phone = authField("10-digit mobile number", InputType.TYPE_CLASS_PHONE, 10);
        row.addView(phone, new LinearLayout.LayoutParams(0, -2, 1f));
        box.addView(row, new LinearLayout.LayoutParams(-1, -2));

        TextView msg = authMsg(box);
        Button send = authButton("Send OTP");
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(-1, dp(52));
        bp.topMargin = dp(12);
        box.addView(send, bp);

        Runnable doSend = () -> {
            String digits = phone.getText().toString().replaceAll("\\D", "");
            if (!digits.matches("[6-9]\\d{9}")) {
                msg.setTextColor(Color.parseColor("#C62828"));
                msg.setText("Enter a valid 10-digit mobile number.");
                return;
            }
            hideKeyboard(phone);
            send.setEnabled(false);
            send.setText("Sending OTP…");
            msg.setText("");
            try {
                callOtpApi(new JSONObject().put("action", "send").put("phone", digits), (ok, error) -> {
                    send.setEnabled(true);
                    send.setText("Send OTP");
                    if (ok) {
                        showOtpEntry(digits);
                    } else {
                        msg.setTextColor(Color.parseColor("#C62828"));
                        msg.setText(error);
                    }
                });
            } catch (Exception ignored) { }
        };
        send.setOnClickListener(v -> doSend.run());
        phone.setImeOptions(EditorInfo.IME_ACTION_DONE);
        phone.setOnEditorActionListener((v, a, e) -> { doSend.run(); return true; });
        showScreen(box, phone);
    }

    private void showOtpEntry(String digits) {
        LinearLayout box = authHeader("Enter the 6-digit OTP sent to +91 " + digits);

        EditText otp = authField("OTP", InputType.TYPE_CLASS_NUMBER, 6);
        otp.setGravity(Gravity.CENTER);
        otp.setLetterSpacing(0.3f);
        box.addView(otp, new LinearLayout.LayoutParams(-1, -2));

        TextView msg = authMsg(box);
        Button verify = authButton("Verify OTP");
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(-1, dp(52));
        bp.topMargin = dp(12);
        box.addView(verify, bp);

        TextView resend = new TextView(this);
        resend.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        resend.setGravity(Gravity.CENTER);
        resend.setPadding(0, dp(16), 0, dp(8));
        box.addView(resend, new LinearLayout.LayoutParams(-1, -2));

        TextView change = new TextView(this);
        change.setText("Change number");
        change.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        change.setTextColor(Color.parseColor("#4D5BF9"));
        change.setGravity(Gravity.CENTER);
        change.setPadding(0, dp(8), 0, dp(8));
        change.setOnClickListener(v -> showOtpLogin());
        box.addView(change, new LinearLayout.LayoutParams(-1, -2));

        final int[] left = {RESEND_SECONDS};
        resendTick = new Runnable() {
            @Override public void run() {
                if (left[0] > 0) {
                    resend.setText("Resend OTP in " + left[0] + "s");
                    resend.setTextColor(Color.parseColor("#888888"));
                    resend.setEnabled(false);
                    left[0]--;
                    ui.postDelayed(this, 1000);
                } else {
                    resend.setText("Resend OTP");
                    resend.setTextColor(Color.parseColor("#4D5BF9"));
                    resend.setEnabled(true);
                }
            }
        };
        ui.post(resendTick);
        resend.setOnClickListener(v -> {
            if (left[0] > 0) return;
            resend.setEnabled(false);
            resend.setText("Sending…");
            try {
                callOtpApi(new JSONObject().put("action", "send").put("phone", digits), (ok, error) -> {
                    msg.setTextColor(Color.parseColor(ok ? "#2E7D32" : "#C62828"));
                    msg.setText(ok ? "A new OTP has been sent." : error);
                    left[0] = ok ? RESEND_SECONDS : 0;
                    ui.removeCallbacks(resendTick);
                    ui.post(resendTick);
                });
            } catch (Exception ignored) { }
        });

        Runnable doVerify = () -> {
            String code = otp.getText().toString().trim();
            if (!code.matches("\\d{6}")) {
                msg.setTextColor(Color.parseColor("#C62828"));
                msg.setText("Enter the 6-digit OTP.");
                return;
            }
            hideKeyboard(otp);
            verify.setEnabled(false);
            verify.setText("Verifying…");
            try {
                callOtpApi(new JSONObject().put("action", "verify").put("phone", digits).put("otp", code), (ok, error) -> {
                    verify.setEnabled(true);
                    verify.setText("Verify OTP");
                    if (ok) {
                        ui.removeCallbacks(resendTick);
                        getSharedPreferences("auth", MODE_PRIVATE).edit()
                                .putString("verified_phone", "+91" + digits).apply();
                        Toast.makeText(this, "Mobile number verified", Toast.LENGTH_SHORT).show();
                        showLogin();
                    } else {
                        otp.setText("");
                        msg.setTextColor(Color.parseColor("#C62828"));
                        msg.setText(error);
                    }
                });
            } catch (Exception ignored) { }
        };
        verify.setOnClickListener(v -> doVerify.run());
        otp.setImeOptions(EditorInfo.IME_ACTION_DONE);
        otp.setOnEditorActionListener((v, a, e) -> { doVerify.run(); return true; });
        showScreen(box, otp);
    }

    // ---------- Password (every time the app opens) ----------
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
                view.evaluateJavascript(STATE_APP ? STATE_LOCK_JS : DOWNLOAD_HOOK_JS, null);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                view.evaluateJavascript(STATE_APP ? STATE_LOCK_JS : DOWNLOAD_HOOK_JS, null);
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
                if (STATE_APP) { // no imports in the state app
                    callback.onReceiveValue(null);
                    Toast.makeText(MainActivity.this, "Import is not available in this app", Toast.LENGTH_SHORT).show();
                    return true;
                }
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
        if (!STATE_APP) webView.addJavascriptInterface(new DownloadBridge(), "AndroidDL");

        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            if (STATE_APP) { // no exports/downloads in the state app
                Toast.makeText(this, "Download is not available in this app", Toast.LENGTH_SHORT).show();
                return;
            }
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

    // State app only: hides admin tools (import, edit leaders, export & share), the Active
    // retailers tab and every link to retailer IDs, and sends any retailers page back to overview.
    private static final String STATE_LOCK_JS =
            "(function(){if(window.__bist)return;window.__bist=1;" +
            "var css='#data-tools,#unlock-b,#exmenu,#imodal,#umodal,#lmodal,#cmodal,#tmodal,[data-t=\"ret\"],[data-t=\"retv\"],[data-go=\"ret\"],[data-go=\"retv\"],a[href*=\"retailers=\"],input[type=file]{display:none!important}';" +
            "function addCss(){if(document.getElementById('bist-css'))return;var s=document.createElement('style');s.id='bist-css';s.textContent=css;(document.head||document.documentElement).appendChild(s)}" +
            "var bad=/(import data|export|edit leaders|save updated file|shareable copy|blank template|common all-states|common file|active retailers|unlock my state|retailer ids|save png|excel)/i;" +
            "function scrub(){addCss();var els=document.querySelectorAll('button,a');for(var i=0;i<els.length;i++){var e=els[i];if(e.__bis)continue;" +
            "if(bad.test((e.textContent||'')+' '+(e.title||''))){e.style.setProperty('display','none','important');e.__bis=1}}}" +
            "function guard(){var h='';try{h=decodeURIComponent(location.hash.slice(1))}catch(x){}if(/^(retailers|retv|ret)\\b/i.test(h)){location.hash=''}}" +
            "var q=0;function tick(){if(q)return;q=1;setTimeout(function(){q=0;scrub();guard()},60)}" +
            "addCss();tick();document.addEventListener('DOMContentLoaded',tick);" +
            "new MutationObserver(tick).observe(document.documentElement,{childList:true,subtree:true});" +
            "window.addEventListener('hashchange',guard);" +
            "document.addEventListener('click',function(e){var t=e.target&&e.target.closest?e.target.closest('[data-t=\"ret\"],[data-t=\"retv\"],[data-go=\"ret\"],[data-go=\"retv\"],a[href*=\"retailers=\"]'):null;" +
            "if(t){e.preventDefault();e.stopImmediatePropagation()}},true);" +
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
