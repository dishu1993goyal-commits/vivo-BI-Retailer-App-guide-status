package com.vivo.bidashboard;

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
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.graphics.Outline;
import android.media.ExifInterface;
import android.text.TextUtils;
import android.view.ViewOutlineProvider;
import android.view.WindowManager;
import android.widget.ArrayAdapter;
import android.widget.FrameLayout;
import android.widget.Spinner;
import android.widget.Switch;
import com.truecaller.android.sdk.oAuth.CodeVerifierUtil;
import java.io.ByteArrayOutputStream;
import java.security.SecureRandom;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.fragment.app.FragmentActivity;
import android.Manifest;
import android.content.pm.PackageManager;
import android.widget.ProgressBar;
import com.truecaller.android.sdk.common.TrueException;
import com.truecaller.android.sdk.common.VerificationCallback;
import com.truecaller.android.sdk.common.VerificationDataBundle;
import com.truecaller.android.sdk.common.models.TrueProfile;
import com.truecaller.android.sdk.oAuth.TcOAuthCallback;
import com.truecaller.android.sdk.oAuth.TcOAuthData;
import com.truecaller.android.sdk.oAuth.TcOAuthError;
import com.truecaller.android.sdk.oAuth.TcSdk;
import com.truecaller.android.sdk.oAuth.TcSdkOptions;
import java.util.ArrayList;
import java.util.List;
import android.os.Handler;
import android.os.Looper;
import android.text.InputFilter;

public class MainActivity extends FragmentActivity {

    private static final String START_URL = "https://vivo-business-innovation-dashboard-22.netlify.app/";
    private static final String APP_HOST = "vivo-business-innovation-dashboard-22.netlify.app";
    private static final int FILE_CHOOSER_REQUEST = 1001;

    private static final boolean STATE_APP = BuildConfig.STATE_APP;
    private static final String APP_ID = STATE_APP ? "state" : "admin";
    // Accounts live on the same Netlify site as the dashboard, so every app and phone shares them.
    private static final String AUTH_URL = START_URL + "api/auth";
    private static final String DOWNLOAD_URL = "https://github.com/dishu1993goyal-commits/vivo-BI-Retailer-App-guide-status/releases/latest/download/"
            + (STATE_APP ? "vivo-BI-States.apk" : "vivo-BI-Dashboard.apk");
    private static final int PHOTO_REQUEST = 1002;
    private static final int[] TEXT_ZOOMS = {85, 100, 115, 130};
    private static final String[] TEXT_ZOOM_KEYS = {"size_small", "size_normal", "size_large", "size_xlarge"};

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private boolean unlocked = false;      // dashboard (not a login/profile screen) is showing
    private boolean inProfile = false;     // a profile screen is showing over the dashboard
    private LinearLayout dashboardRoot;
    private ProgressBar loadBar;
    private boolean pageLoading = true;
    private FrameLayout topAvatar;

    private String tr(String key) { return L.t(this, key); }
    private String trf(String key, Object... a) { return L.f(this, key, a); }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        initTruecaller();
        // Stay logged in until the user taps Log out.
        if (sessionToken() != null) {
            openDashboard();
            refreshProfile();
        } else {
            showLoginScreen(null);
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        try { TcSdk.clear(); } catch (Throwable ignored) { }
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    // ---------- Session and profile cache (on this phone) ----------
    private SharedPreferences authPrefs() { return getSharedPreferences("auth", MODE_PRIVATE); }
    private SharedPreferences settings() { return getSharedPreferences("settings", MODE_PRIVATE); }

    private String sessionUser() { return authPrefs().getString("session_user", null); }
    private String sessionToken() { return authPrefs().getString("session_token", null); }
    private String lastUsername() { return authPrefs().getString("last_username", ""); }

    private JSONObject profile() {
        try { return new JSONObject(authPrefs().getString("profile", "{}")); } catch (Exception e) { return new JSONObject(); }
    }

    private void saveProfile(JSONObject p) {
        if (p != null) authPrefs().edit().putString("profile", p.toString()).apply();
    }

    private void saveSession(JSONObject res) {
        String u = res.optString("username", "");
        authPrefs().edit()
                .putString("session_user", u)
                .putString("session_token", res.optString("token", ""))
                .putString("last_username", u)
                .apply();
        saveProfile(res.optJSONObject("profile"));
    }

    private void clearSession() {
        authPrefs().edit().remove("session_user").remove("session_token").remove("profile").remove("photo").remove("photo_version").apply();
    }

    private Bitmap cachedPhoto() {
        String b64 = authPrefs().getString("photo", null);
        if (b64 == null || b64.isEmpty()) return null;
        try {
            byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        } catch (Throwable e) {
            return null;
        }
    }

    private JSONObject sessionBody(Object... kv) {
        JSONObject o = obj(kv);
        try {
            o.put("username", sessionUser());
            o.put("token", sessionToken());
        } catch (Exception ignored) { }
        return o;
    }

    // Updates the profile from the server (another phone may have changed it) and checks the session.
    private void refreshProfile() {
        callAuth(sessionBody("action", "me"), (ok, res, err) -> {
            if (ok) {
                JSONObject p = res.optJSONObject("profile");
                saveProfile(p);
                syncPhoto(p == null ? 0 : p.optLong("photoVersion", 0));
                updateTopAvatar();
            } else if (res.optBoolean("loggedOut", false)) {
                clearSession();
                showLoginScreen(tr("logged_out_elsewhere"));
            }
        });
    }

    private void syncPhoto(long version) {
        long have = authPrefs().getLong("photo_version", 0);
        if (version == have) return;
        if (version == 0) {
            authPrefs().edit().remove("photo").putLong("photo_version", 0).apply();
            updateTopAvatar();
            return;
        }
        callAuth(sessionBody("action", "get-photo"), (ok, res, err) -> {
            if (!ok) return;
            authPrefs().edit().putString("photo", res.optString("photo", ""))
                    .putLong("photo_version", res.optLong("photoVersion", 0)).apply();
            updateTopAvatar();
        });
    }

    // ---------- Accounts service (POST /api/auth) ----------
    private final Handler ui = new Handler(Looper.getMainLooper());

    private interface AuthResult { void done(boolean ok, JSONObject res, String error); }

    private void callAuth(JSONObject body, AuthResult cb) {
        final String noNet = tr("no_internet");
        new Thread(() -> {
            boolean ok = false;
            JSONObject res = new JSONObject();
            String err = noNet;
            HttpURLConnection c = null;
            try {
                body.put("app", APP_ID);
                c = (HttpURLConnection) new URL(AUTH_URL).openConnection();
                c.setRequestMethod("POST");
                c.setConnectTimeout(15000);
                c.setReadTimeout(30000);
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
                try {
                    res = new JSONObject(sb.length() > 0 ? sb.toString() : "{}");
                    ok = res.optBoolean("ok", false);
                    err = res.optString("error", ok ? "" : "Something went wrong (" + code + "). Please try again.");
                } catch (Exception parse) {
                    err = "Service not available right now (" + code + "). Please try again later.";
                }
            } catch (Exception e) {
                // keep the "No internet" message
            } finally {
                if (c != null) c.disconnect();
            }
            final boolean fOk = ok;
            final JSONObject fRes = res;
            final String fErr = err;
            ui.post(() -> cb.done(fOk, fRes, fErr));
        }).start();
    }

    private static JSONObject obj(Object... kv) {
        JSONObject o = new JSONObject();
        try {
            for (int i = 0; i + 1 < kv.length; i += 2) o.put((String) kv[i], kv[i + 1]);
        } catch (Exception ignored) { }
        return o;
    }

    // ---------- Truecaller mobile verification (sign up and forgot password) ----------
    private boolean tcReady = false;
    private TextView tcStatus;
    private String pendingPhone, pendingName;
    private Runnable onPhoneVerified, onVerifyBack;
    private static final int PERM_REQUEST = 2001;
    private ActivityResultLauncher<Intent> tcLauncher;
    private String tcState, tcVerifier;
    private Runnable verifyTimeout;
    private static final long VERIFY_TIMEOUT_MS = 25000;

    private void initTruecaller() {
        tcLauncher = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), r -> {
            try {
                TcSdk.getInstance().onActivityResultObtained(this, r.getResultCode(), r.getData());
            } catch (Throwable e) {
                manualVerification(tr("tc_failed"));
            }
        });
        try {
            TcSdkOptions options = new TcSdkOptions.Builder(this, tcOAuthCallback)
                    .sdkOptions(TcSdkOptions.OPTION_VERIFY_ALL_USERS)
                    .consentHeadingOption(TcSdkOptions.SDK_CONSENT_HEADING_LOG_IN_TO)
                    .footerType(TcSdkOptions.FOOTER_TYPE_ANOTHER_MOBILE_NO)
                    .ctaText(TcSdkOptions.CTA_TEXT_PROCEED)
                    .consentMode(TcSdkOptions.CONSENT_MODE_BOTTOMSHEET)
                    .build();
            TcSdk.init(options);
            tcReady = true;
        } catch (Throwable e) {
            tcReady = false;
        }
    }

    private final TcOAuthCallback tcOAuthCallback = new TcOAuthCallback() {
        @Override
        public void onSuccess(TcOAuthData data) {
            if (tcState != null && data.getState() != null && !tcState.equals(data.getState())) {
                setStatus(tr("verify_failed"), true);
                return;
            }
            setStatus(tr("confirming_tc"), false);
            callAuth(obj("action", "tc-exchange", "code", data.getAuthorizationCode(), "codeVerifier", tcVerifier),
                    (ok, res, err) -> {
                        if (!ok) { setStatus(err, true); return; }
                        String tcPhone = res.optString("phone", "");
                        if (!tcPhone.equals(pendingPhone)) {
                            setStatus(trf("tc_mismatch", tcPhone, pendingPhone, tcPhone), true);
                            return;
                        }
                        phoneVerified();
                    });
        }

        @Override
        public void onFailure(TcOAuthError error) {
            manualVerification(tr("tc_failed"));
        }

        @Override
        public void onVerificationRequired(TcOAuthError error) {
            manualVerification(null);
        }
    };

    private void setStatus(String text, boolean error) {
        if (tcStatus == null) return;
        tcStatus.setTextColor(Color.parseColor(error ? "#C62828" : "#2E7D32"));
        tcStatus.setText(text);
    }

    // Verifies that the user owns `phone` (10 digits), then runs onVerified. `back` returns to the form.
    private void startPhoneVerification(String name, String phone, Runnable onVerified, Runnable back) {
        if (!tcReady) { setStatus(tr("tc_unavailable"), true); return; }
        pendingName = name;
        pendingPhone = phone;
        onPhoneVerified = onVerified;
        onVerifyBack = back;
        boolean oauth = false;
        try { oauth = TcSdk.getInstance().isOAuthFlowUsable(); } catch (Throwable ignored) { }
        if (oauth) {
            setStatus(tr("opening_tc"), false);
            try {
                tcState = Long.toHexString(new SecureRandom().nextLong());
                tcVerifier = CodeVerifierUtil.Companion.generateRandomCodeVerifier();
                TcSdk.getInstance().setOAuthState(tcState);
                TcSdk.getInstance().setOAuthScopes(new String[]{"openid", "profile", "phone"});
                String challenge = CodeVerifierUtil.Companion.getCodeChallenge(tcVerifier);
                if (challenge != null) TcSdk.getInstance().setCodeChallenge(challenge);
                TcSdk.getInstance().getAuthorizationCode(this, tcLauncher);
                return;
            } catch (Throwable e) {
                // fall through to missed call / OTP
            }
        }
        manualVerification(null);
    }

    // Missed call / OTP from Truecaller, for people without the Truecaller app.
    private void manualVerification(String note) {
        setStatus(note != null ? note : tr("perm_missed_call"), false);
        List<String> need = new ArrayList<>();
        need.add(Manifest.permission.READ_PHONE_STATE);
        need.add(Manifest.permission.READ_CALL_LOG);
        if (Build.VERSION.SDK_INT >= 26) need.add(Manifest.permission.ANSWER_PHONE_CALLS);
        else need.add(Manifest.permission.CALL_PHONE);
        List<String> missing = new ArrayList<>();
        for (String p : need) {
            if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) missing.add(p);
        }
        if (missing.isEmpty()) doRequestVerification();
        else requestPermissions(missing.toArray(new String[0]), PERM_REQUEST);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == PERM_REQUEST) doRequestVerification(); // if refused, Truecaller uses OTP instead
    }

    private void doRequestVerification() {
        setStatus(tr("contacting_tc"), false);
        startVerifyTimeout();
        try {
            TcSdk.getInstance().requestVerification("IN", pendingPhone, tcVerifyCallback, this);
        } catch (Throwable e) {
            stopVerifyTimeout();
            setStatus(tr("verify_failed") + " " + e.getMessage(), true);
        }
    }

    private void startVerifyTimeout() {
        stopVerifyTimeout();
        verifyTimeout = () -> setStatus(tr("tc_no_reply"), true);
        ui.postDelayed(verifyTimeout, VERIFY_TIMEOUT_MS);
    }

    private void stopVerifyTimeout() {
        if (verifyTimeout != null) ui.removeCallbacks(verifyTimeout);
        verifyTimeout = null;
    }

    private void phoneVerified() {
        Runnable r = onPhoneVerified;
        onPhoneVerified = null;
        if (r != null) r.run();
    }

    private final VerificationCallback tcVerifyCallback = new VerificationCallback() {
        @Override
        public void onRequestSuccess(int type, VerificationDataBundle bundle) {
            stopVerifyTimeout();
            TrueProfile tp = new TrueProfile.Builder(pendingName, "").build();
            switch (type) {
                case VerificationCallback.TYPE_MISSED_CALL_INITIATED:
                    showWaiting(trf("missed_call_wait", pendingPhone));
                    break;
                case VerificationCallback.TYPE_MISSED_CALL_RECEIVED:
                    setStatus(tr("missed_call_got"), false);
                    TcSdk.getInstance().verifyMissedCall(tp, tcVerifyCallback);
                    break;
                case VerificationCallback.TYPE_OTP_INITIATED:
                case VerificationCallback.TYPE_IM_OTP_INITIATED:
                    showTcOtpEntry(type == VerificationCallback.TYPE_IM_OTP_INITIATED);
                    break;
                case VerificationCallback.TYPE_OTP_RECEIVED:
                case VerificationCallback.TYPE_IM_OTP_RECEIVED: {
                    String otp = bundle == null ? null : bundle.getString(VerificationDataBundle.KEY_OTP);
                    if (otp != null && !otp.isEmpty()) {
                        setStatus(tr("otp_got"), false);
                        TcSdk.getInstance().verifyOtp(tp, otp, tcVerifyCallback);
                    }
                    break;
                }
                default: // verification complete, or number verified before on this phone
                    phoneVerified();
                    break;
            }
        }

        @Override
        public void onRequestFailure(int type, TrueException e) {
            stopVerifyTimeout();
            String m = e == null ? null : e.getExceptionMessage();
            setStatus((m == null || m.isEmpty()) ? tr("verify_failed") : m, true);
        }
    };

    private void showWaiting(String text) {
        LinearLayout box = authHeader(text);
        box.addView(new ProgressBar(this), new LinearLayout.LayoutParams(-2, -2));
        tcStatus = authMsg(box);
        box.addView(linkText(tr("cancel"), v -> { if (onVerifyBack != null) onVerifyBack.run(); }));
        showScreen(box, null);
    }

    private void showTcOtpEntry(boolean inTruecaller) {
        LinearLayout box = authHeader(trf(inTruecaller ? "otp_sent_tc" : "otp_sent", pendingPhone));
        EditText otp = authField(tr("otp"), InputType.TYPE_CLASS_NUMBER, 6);
        otp.setGravity(Gravity.CENTER);
        otp.setLetterSpacing(0.3f);
        box.addView(otp, new LinearLayout.LayoutParams(-1, -2));
        tcStatus = authMsg(box);
        Button verify = authButton(tr("verify_otp"));
        box.addView(verify, buttonParams());
        box.addView(linkText(tr("cancel"), v -> { if (onVerifyBack != null) onVerifyBack.run(); }));
        Runnable doVerify = () -> {
            String code = otp.getText().toString().trim();
            if (code.length() < 4) { setStatus(tr("enter_otp"), true); return; }
            hideKeyboard(otp);
            setStatus(tr("verifying"), false);
            TcSdk.getInstance().verifyOtp(new TrueProfile.Builder(pendingName, "").build(), code, tcVerifyCallback);
        };
        verify.setOnClickListener(v -> doVerify.run());
        otp.setImeOptions(EditorInfo.IME_ACTION_DONE);
        otp.setOnEditorActionListener((v, a, e) -> { doVerify.run(); return true; });
        showScreen(box, otp);
    }

    // ---------- Screen building helpers ----------
    private static final int BRAND = Color.parseColor("#4D5BF9");
    private static final int BRAND2 = Color.parseColor("#9152E0");

    private LinearLayout authHeader(String subtitle) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER_HORIZONTAL);
        box.setPadding(dp(28), dp(40), dp(28), dp(28));
        box.setBackgroundColor(Color.WHITE);

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.mipmap.ic_launcher);
        box.addView(logo, new LinearLayout.LayoutParams(dp(80), dp(80)));

        TextView title = new TextView(this);
        title.setText(R.string.app_name);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setTextColor(Color.parseColor("#111111"));
        title.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(-1, -2);
        tp.topMargin = dp(10);
        box.addView(title, tp);

        TextView sub = new TextView(this);
        sub.setText(subtitle);
        sub.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        sub.setTextColor(Color.parseColor("#666666"));
        sub.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(-1, -2);
        sp.topMargin = dp(6);
        sp.bottomMargin = dp(18);
        box.addView(sub, sp);
        return box;
    }

    private EditText authField(String hint, int inputType, int maxLen) {
        EditText f = new EditText(this);
        f.setHint(hint);
        f.setSingleLine(true);
        f.setInputType(inputType);
        f.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        f.setPadding(dp(16), dp(13), dp(16), dp(13));
        f.setFilters(new InputFilter[]{new InputFilter.LengthFilter(maxLen)});
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.parseColor("#F5F6FA"));
        bg.setCornerRadius(dp(10));
        bg.setStroke(dp(1), Color.parseColor("#D8DAE5"));
        f.setBackground(bg);
        return f;
    }

    private static final int TEXT_NAME = InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_WORDS;
    private static final int TEXT_PLAIN = InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS;
    private static final int TEXT_PASSWORD = InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD;

    private void addField(LinearLayout box, View field) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.bottomMargin = dp(10);
        box.addView(field, lp);
    }

    private TextView fieldLabel(String text) {
        TextView l = new TextView(this);
        l.setText(text);
        l.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        l.setTextColor(Color.parseColor("#666666"));
        l.setPadding(dp(4), dp(4), 0, dp(4));
        return l;
    }

    private View phoneRow(EditText phone) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        TextView cc = new TextView(this);
        cc.setText("+91");
        cc.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        cc.setTextColor(Color.parseColor("#111111"));
        cc.setPadding(dp(4), 0, dp(12), 0);
        row.addView(cc);
        row.addView(phone, new LinearLayout.LayoutParams(0, -2, 1f));
        return row;
    }

    private CheckBox showPasswordBox(EditText... fields) {
        CheckBox show = new CheckBox(this);
        show.setText(tr("show_password"));
        show.setTextColor(Color.parseColor("#555555"));
        show.setOnCheckedChangeListener((b, checked) -> {
            for (EditText f : fields) {
                f.setInputType(InputType.TYPE_CLASS_TEXT | (checked
                        ? InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
                        : InputType.TYPE_TEXT_VARIATION_PASSWORD));
                f.setSelection(f.getText().length());
            }
        });
        return show;
    }

    private Button authButton(String text) {
        Button b = new Button(this);
        b.setText(text);
        b.setAllCaps(false);
        b.setTextColor(Color.WHITE);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        GradientDrawable bg = new GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, new int[]{BRAND, BRAND2});
        bg.setCornerRadius(dp(10));
        b.setBackground(bg);
        return b;
    }

    private LinearLayout.LayoutParams buttonParams() {
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(-1, dp(52));
        bp.topMargin = dp(10);
        return bp;
    }

    private TextView linkText(String text, View.OnClickListener l) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        t.setTextColor(BRAND);
        t.setGravity(Gravity.CENTER);
        t.setPadding(0, dp(14), 0, dp(6));
        t.setLayoutParams(new LinearLayout.LayoutParams(-1, -2));
        t.setOnClickListener(l);
        return t;
    }

    private TextView authMsg(LinearLayout box) {
        TextView m = new TextView(this);
        m.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        m.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.topMargin = dp(4);
        box.addView(m, lp);
        return m;
    }

    private void showScreen(View box, View focus) {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.WHITE);
        scroll.addView(box);
        detachWebView();
        setContentView(scroll);
        if (focus != null) focus.requestFocus();
    }

    private void hideKeyboard(View v) {
        ((InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE))
                .hideSoftInputFromWindow(v.getWindowToken(), 0);
    }

    private void busy(Button b, String text) {
        b.setEnabled(text == null);
        if (text != null) { b.setTag(b.getText()); b.setText(text); }
        else if (b.getTag() != null) b.setText((CharSequence) b.getTag());
    }

    private TextView languageLink(Runnable redraw) {
        return linkText("🌐 " + tr("language") + ": " + L.langName(this), v -> chooseLanguage(redraw));
    }

    private void chooseLanguage(Runnable redraw) {
        int cur = "hi".equals(L.lang(this)) ? 1 : 0;
        new AlertDialog.Builder(this)
                .setTitle(tr("language"))
                .setSingleChoiceItems(L.LANG_NAMES, cur, (d, which) -> {
                    L.setLang(this, L.LANG_CODES[which]);
                    d.dismiss();
                    redraw.run();
                })
                .setNegativeButton(tr("cancel"), null)
                .show();
    }

    // ---------- Login: user name + password (only after logout or on a new phone) ----------
    private void showLoginScreen(String info) {
        unlocked = false;
        inProfile = false;
        LinearLayout box = authHeader(tr("login_sub"));
        EditText user = authField(tr("username"), TEXT_PLAIN, 30);
        user.setText(lastUsername());
        addField(box, user);
        EditText pass = authField(tr("password"), TEXT_PASSWORD, 64);
        addField(box, pass);
        box.addView(showPasswordBox(pass));
        tcStatus = authMsg(box);
        if (info != null) setStatus(info, false);
        Button login = authButton(tr("login"));
        box.addView(login, buttonParams());
        box.addView(linkText(tr("forgot"), v -> showForgot()));
        box.addView(linkText(tr("new_user"), v -> showSignup()));
        box.addView(languageLink(() -> showLoginScreen(info)));

        Runnable doLogin = () -> {
            String u = user.getText().toString().trim();
            String p = pass.getText().toString();
            if (u.isEmpty() || p.isEmpty()) { setStatus(tr("enter_user_pass"), true); return; }
            hideKeyboard(pass);
            busy(login, tr("logging_in"));
            callAuth(obj("action", "login", "username", u, "password", p), (ok, res, err) -> {
                busy(login, null);
                if (ok) {
                    saveSession(res);
                    openDashboard();
                    syncPhoto(profile().optLong("photoVersion", 0));
                } else {
                    pass.setText("");
                    setStatus(err, true);
                }
            });
        };
        login.setOnClickListener(v -> doLogin.run());
        pass.setImeOptions(EditorInfo.IME_ACTION_DONE);
        pass.setOnEditorActionListener((v, a, e) -> { doLogin.run(); return true; });
        showScreen(box, user.getText().length() > 0 ? pass : user);
    }

    // ---------- Sign up: profile + password, mobile verified once with Truecaller ----------
    private String[] signupDraft = new String[6];

    private void showSignup() {
        unlocked = false;
        LinearLayout box = authHeader(tr("signup_sub"));
        EditText full = authField(tr("full_name"), TEXT_NAME, 40);
        EditText user = authField(tr("choose_username"), TEXT_PLAIN, 30);
        EditText phone = authField(tr("mobile"), InputType.TYPE_CLASS_PHONE, 10);
        EditText pass = authField(tr("create_password"), TEXT_PASSWORD, 64);
        EditText pass2 = authField(tr("confirm_password"), TEXT_PASSWORD, 64);
        EditText code = authField(tr("access_code"), TEXT_PASSWORD, 64);
        EditText[] all = {full, user, phone, pass, pass2, code};
        for (int i = 0; i < all.length; i++) if (signupDraft[i] != null) all[i].setText(signupDraft[i]);
        addField(box, full);
        addField(box, user);
        addField(box, phoneRow(phone));
        addField(box, pass);
        addField(box, pass2);
        box.addView(showPasswordBox(pass, pass2));
        addField(box, code);
        tcStatus = authMsg(box);
        Button go = authButton(tr("verify_create"));
        box.addView(go, buttonParams());
        box.addView(linkText(tr("have_account"), v -> {
            signupDraft = new String[6];
            showLoginScreen(null);
        }));

        go.setOnClickListener(v -> {
            for (int i = 0; i < all.length; i++) signupDraft[i] = all[i].getText().toString();
            String fn = full.getText().toString().trim();
            String un = user.getText().toString().trim();
            String ph = phone.getText().toString().replaceAll("\\D", "");
            String pw = pass.getText().toString();
            String ac = code.getText().toString().trim();
            if (fn.length() < 2) { setStatus(tr("err_name"), true); return; }
            if (un.length() < 3) { setStatus(tr("err_username"), true); return; }
            if (!ph.matches("[6-9]\\d{9}")) { setStatus(tr("err_mobile"), true); return; }
            if (pw.length() < 6) { setStatus(tr("err_pw_short"), true); return; }
            if (!pw.equals(pass2.getText().toString())) { setStatus(tr("err_pw_match"), true); return; }
            if (ac.isEmpty()) { setStatus(tr("err_code"), true); return; }
            hideKeyboard(code);
            busy(go, tr("checking"));
            JSONObject details = obj("fullName", fn, "username", un, "phone", ph, "password", pw, "accessCode", ac);
            callAuth(obj("action", "signup-check", "fullName", fn, "username", un, "phone", ph,
                    "password", pw, "accessCode", ac), (ok, res, err) -> {
                busy(go, null);
                if (!ok) { setStatus(err, true); return; }
                startPhoneVerification(fn, ph, () -> finishSignup(details), this::showSignup);
            });
        });
        showScreen(box, full);
    }

    private void finishSignup(JSONObject d) {
        LinearLayout box = authHeader(tr("creating"));
        box.addView(new ProgressBar(this), new LinearLayout.LayoutParams(-2, -2));
        tcStatus = authMsg(box);
        showScreen(box, null);
        try {
            d.put("action", "signup");
            d.put("phoneVerified", true);
        } catch (Exception ignored) { }
        callAuth(d, (ok, res, err) -> {
            if (ok) {
                signupDraft = new String[6];
                saveSession(res);
                Toast.makeText(this, trf("welcome", res.optString("fullName", "")), Toast.LENGTH_LONG).show();
                openDashboard();
            } else {
                setStatus(err, true);
                box.addView(linkText(tr("back_signup"), v -> showSignup()));
            }
        });
    }

    // ---------- Forgot password: re-verify mobile with Truecaller, then set a new password ----------
    private void showForgot() {
        unlocked = false;
        LinearLayout box = authHeader(tr("forgot_sub"));
        EditText phone = authField(tr("mobile"), InputType.TYPE_CLASS_PHONE, 10);
        addField(box, phoneRow(phone));
        tcStatus = authMsg(box);
        Button go = authButton(tr("verify_mobile"));
        box.addView(go, buttonParams());
        box.addView(linkText(tr("back_login"), v -> showLoginScreen(null)));
        go.setOnClickListener(v -> {
            String ph = phone.getText().toString().replaceAll("\\D", "");
            if (!ph.matches("[6-9]\\d{9}")) { setStatus(tr("err_mobile"), true); return; }
            hideKeyboard(phone);
            busy(go, tr("checking"));
            callAuth(obj("action", "reset-check", "phone", ph), (ok, res, err) -> {
                busy(go, null);
                if (!ok) { setStatus(err, true); return; }
                startPhoneVerification("vivo BI user", ph, () -> showNewPassword(ph), this::showForgot);
            });
        });
        showScreen(box, phone);
    }

    private void showNewPassword(String ph) {
        LinearLayout box = authHeader(tr("new_pw_sub"));
        EditText pass = authField(tr("new_password"), TEXT_PASSWORD, 64);
        EditText pass2 = authField(tr("confirm_new_password"), TEXT_PASSWORD, 64);
        addField(box, pass);
        addField(box, pass2);
        box.addView(showPasswordBox(pass, pass2));
        tcStatus = authMsg(box);
        Button save = authButton(tr("save_new_password"));
        box.addView(save, buttonParams());
        box.addView(linkText(tr("cancel"), v -> showLoginScreen(null)));
        save.setOnClickListener(v -> {
            String pw = pass.getText().toString();
            if (pw.length() < 6) { setStatus(tr("err_pw_short"), true); return; }
            if (!pw.equals(pass2.getText().toString())) { setStatus(tr("err_pw_match"), true); return; }
            hideKeyboard(pass2);
            busy(save, tr("saving"));
            callAuth(obj("action", "reset", "phone", ph, "newPassword", pw, "phoneVerified", true), (ok, res, err) -> {
                busy(save, null);
                if (ok) {
                    String u = res.optString("username", "");
                    if (!u.isEmpty()) authPrefs().edit().putString("last_username", u).apply();
                    showLoginScreen(trf("pw_changed_login", u));
                } else {
                    setStatus(err, true);
                }
            });
        });
        showScreen(box, pass);
    }

    // ---------- Dashboard with a slim top bar (logo, name, profile photo) ----------
    private void detachWebView() {
        if (webView != null && webView.getParent() != null) ((ViewGroup) webView.getParent()).removeView(webView);
    }

    private void openDashboard() {
        unlocked = true;
        inProfile = false;
        if (webView == null) setupWebView();
        applySettings();
        detachWebView();

        dashboardRoot = new LinearLayout(this);
        dashboardRoot.setOrientation(LinearLayout.VERTICAL);
        dashboardRoot.setBackgroundColor(Color.WHITE);

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(12), dp(6), dp(10), dp(6));
        bar.setBackgroundColor(Color.WHITE);
        bar.setElevation(dp(2));
        ImageView logo = new ImageView(this);
        logo.setImageResource(R.mipmap.ic_launcher);
        bar.addView(logo, new LinearLayout.LayoutParams(dp(30), dp(30)));
        TextView name = new TextView(this);
        name.setText(R.string.app_name);
        name.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        name.setTypeface(Typeface.DEFAULT_BOLD);
        name.setTextColor(Color.parseColor("#111111"));
        name.setPadding(dp(10), 0, 0, 0);
        bar.addView(name, new LinearLayout.LayoutParams(0, -2, 1f));
        bar.addView(barButton("🔍", tr("search"), "openSearch"));
        bar.addView(barButton("💬", tr("assistant"), "openChat"));
        topAvatar = new FrameLayout(this);
        topAvatar.setContentDescription(tr("profile"));
        topAvatar.setOnClickListener(v -> showProfile());
        bar.addView(topAvatar, new LinearLayout.LayoutParams(dp(36), dp(36)));
        updateTopAvatar();

        dashboardRoot.addView(bar, new LinearLayout.LayoutParams(-1, dp(48)));
        if (loadBar == null) {
            loadBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
            loadBar.setMax(100);
            loadBar.setProgressTintList(android.content.res.ColorStateList.valueOf(BRAND));
        }
        if (loadBar.getParent() != null) ((ViewGroup) loadBar.getParent()).removeView(loadBar);
        dashboardRoot.addView(loadBar, new LinearLayout.LayoutParams(-1, dp(3)));
        loadBar.setVisibility(pageLoading ? View.VISIBLE : View.GONE);
        dashboardRoot.addView(webView, new LinearLayout.LayoutParams(-1, 0, 1f));
        setContentView(dashboardRoot);
    }

    // Search and chatbot come from assistant.js on the dashboard site (loaded into the page).
    private TextView barButton(String icon, String label, String fn) {
        TextView b = new TextView(this);
        b.setText(icon);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        b.setGravity(Gravity.CENTER);
        b.setContentDescription(label);
        b.setLayoutParams(new LinearLayout.LayoutParams(dp(42), dp(40)));
        b.setBackgroundResource(android.R.drawable.list_selector_background);
        b.setOnClickListener(v -> openAssistant(fn));
        return b;
    }

    // Loads assistant.js only when 🔍 / 💬 is tapped, then opens it (polls up to ~6 s while it loads).
    private void openAssistant(String fn) {
        if (webView == null) return;
        webView.evaluateJavascript(ASSIST_LOADER_JS, null);
        tryOpenAssistant(fn, 0);
    }

    private void tryOpenAssistant(String fn, int attempt) {
        if (webView == null) return;
        webView.evaluateJavascript("(function(){if(window.BIAssist){BIAssist." + fn + "();return 'ok';}return 'wait';})()", r -> {
            if (r == null || !r.contains("wait")) return;
            if (attempt < 20) ui.postDelayed(() -> tryOpenAssistant(fn, attempt + 1), 300);
            else Toast.makeText(this, tr("assistant_loading"), Toast.LENGTH_SHORT).show();
        });
    }

    private void applySettings() {
        if (webView != null) webView.getSettings().setTextZoom(settings().getInt("text_zoom", 100));
        if (settings().getBoolean("keep_screen_on", false)) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    // Round profile photo, or initials when there is no photo.
    private void fillAvatar(FrameLayout holder, int sizeDp, int textSp) {
        holder.removeAllViews();
        GradientDrawable circle = new GradientDrawable(GradientDrawable.Orientation.TL_BR, new int[]{BRAND, BRAND2});
        circle.setShape(GradientDrawable.OVAL);
        holder.setBackground(circle);
        holder.setClipToOutline(true);
        holder.setOutlineProvider(new ViewOutlineProvider() {
            @Override public void getOutline(View view, Outline outline) {
                outline.setOval(0, 0, view.getWidth(), view.getHeight());
            }
        });
        Bitmap photo = cachedPhoto();
        if (photo != null) {
            ImageView iv = new ImageView(this);
            iv.setScaleType(ImageView.ScaleType.CENTER_CROP);
            iv.setImageBitmap(photo);
            holder.addView(iv, new FrameLayout.LayoutParams(-1, -1));
        } else {
            TextView ini = new TextView(this);
            ini.setText(initials(profile().optString("fullName", sessionUser() == null ? "" : sessionUser())));
            ini.setTextColor(Color.WHITE);
            ini.setTypeface(Typeface.DEFAULT_BOLD);
            ini.setTextSize(TypedValue.COMPLEX_UNIT_SP, textSp);
            ini.setGravity(Gravity.CENTER);
            holder.addView(ini, new FrameLayout.LayoutParams(-1, -1));
        }
    }

    private static String initials(String name) {
        String[] parts = name.trim().split("\\s+");
        StringBuilder sb = new StringBuilder();
        for (String p : parts) {
            if (!p.isEmpty() && sb.length() < 2) sb.append(Character.toUpperCase(p.charAt(0)));
        }
        return sb.length() == 0 ? "?" : sb.toString();
    }

    private void updateTopAvatar() {
        if (topAvatar != null) fillAvatar(topAvatar, 36, 14);
    }

    // ---------- Profile section ----------
    private LinearLayout profileHeaderBar(String title, Runnable back) {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(6), dp(4), dp(12), dp(4));
        TextView arrow = new TextView(this);
        arrow.setText("←");
        arrow.setTextSize(TypedValue.COMPLEX_UNIT_SP, 24);
        arrow.setTextColor(Color.parseColor("#111111"));
        arrow.setPadding(dp(10), dp(4), dp(14), dp(4));
        arrow.setOnClickListener(v -> back.run());
        bar.addView(arrow);
        TextView t = new TextView(this);
        t.setText(title);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 19);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setTextColor(Color.parseColor("#111111"));
        bar.addView(t);
        return bar;
    }

    private LinearLayout card(LinearLayout parent, String sectionTitle) {
        TextView h = new TextView(this);
        h.setText(sectionTitle.toUpperCase());
        h.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        h.setTypeface(Typeface.DEFAULT_BOLD);
        h.setTextColor(Color.parseColor("#7A7F99"));
        h.setLetterSpacing(0.06f);
        h.setPadding(dp(20), dp(18), dp(20), dp(6));
        parent.addView(h);
        LinearLayout c = new LinearLayout(this);
        c.setOrientation(LinearLayout.VERTICAL);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.WHITE);
        bg.setCornerRadius(dp(14));
        bg.setStroke(dp(1), Color.parseColor("#E6E8F0"));
        c.setBackground(bg);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.leftMargin = dp(14);
        lp.rightMargin = dp(14);
        parent.addView(c, lp);
        return c;
    }

    // A tappable row: icon, label, value on the right, and a chevron.
    private TextView row(LinearLayout card, String icon, String label, String value, View.OnClickListener l) {
        if (card.getChildCount() > 0) {
            View div = new View(this);
            div.setBackgroundColor(Color.parseColor("#EEF0F5"));
            LinearLayout.LayoutParams dl = new LinearLayout.LayoutParams(-1, dp(1));
            dl.leftMargin = dp(52);
            card.addView(div, dl);
        }
        LinearLayout r = new LinearLayout(this);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setGravity(Gravity.CENTER_VERTICAL);
        r.setPadding(dp(16), dp(14), dp(14), dp(14));
        TextView ic = new TextView(this);
        ic.setText(icon);
        ic.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        ic.setWidth(dp(36));
        r.addView(ic);
        TextView lab = new TextView(this);
        lab.setText(label);
        lab.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        lab.setTextColor(Color.parseColor("#1A1A2E"));
        r.addView(lab, new LinearLayout.LayoutParams(0, -2, 1f));
        TextView val = new TextView(this);
        val.setText(value == null ? "" : value);
        val.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        val.setTextColor(Color.parseColor("#7A7F99"));
        val.setPadding(dp(8), 0, dp(4), 0);
        val.setMaxWidth(dp(170));
        val.setSingleLine(true);
        val.setEllipsize(TextUtils.TruncateAt.END);
        r.addView(val);
        if (l != null) {
            TextView chev = new TextView(this);
            chev.setText("›");
            chev.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22);
            chev.setTextColor(Color.parseColor("#B0B4C8"));
            r.addView(chev);
            r.setOnClickListener(l);
            r.setBackgroundResource(android.R.drawable.list_selector_background);
        }
        card.addView(r);
        return val;
    }

    private String versionText() {
        try {
            PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
            return pi.versionName + " (" + (Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode) + ")";
        } catch (Exception e) {
            return "";
        }
    }

    private void showProfile() {
        unlocked = false;
        inProfile = true;
        JSONObject p = profile();
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackgroundColor(Color.parseColor("#F4F5FA"));
        page.setPadding(0, 0, 0, dp(32));
        page.addView(profileHeaderBar(tr("profile"), this::openDashboard));

        // Header card: photo, name, user name, mobile, app type
        LinearLayout head = new LinearLayout(this);
        head.setOrientation(LinearLayout.VERTICAL);
        head.setGravity(Gravity.CENTER_HORIZONTAL);
        head.setPadding(dp(16), dp(22), dp(16), dp(20));
        GradientDrawable hb = new GradientDrawable(GradientDrawable.Orientation.TL_BR, new int[]{BRAND, BRAND2});
        hb.setCornerRadius(dp(18));
        head.setBackground(hb);
        LinearLayout.LayoutParams hlp = new LinearLayout.LayoutParams(-1, -2);
        hlp.leftMargin = dp(14);
        hlp.rightMargin = dp(14);
        hlp.topMargin = dp(4);
        FrameLayout av = new FrameLayout(this);
        fillAvatar(av, 92, 32);
        av.setOnClickListener(v -> photoOptions());
        LinearLayout.LayoutParams alp = new LinearLayout.LayoutParams(dp(92), dp(92));
        head.addView(av, alp);
        TextView change = new TextView(this);
        change.setText("📷 " + tr("change_photo"));
        change.setTextColor(Color.WHITE);
        change.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        change.setPadding(dp(10), dp(8), dp(10), dp(4));
        change.setOnClickListener(v -> photoOptions());
        head.addView(change);
        TextView nm = new TextView(this);
        nm.setText(p.optString("fullName", sessionUser()));
        nm.setTextColor(Color.WHITE);
        nm.setTextSize(TypedValue.COMPLEX_UNIT_SP, 21);
        nm.setTypeface(Typeface.DEFAULT_BOLD);
        nm.setGravity(Gravity.CENTER);
        head.addView(nm);
        TextView un = new TextView(this);
        String phone = p.optString("phone", "");
        un.setText("@" + sessionUser() + (phone.isEmpty() ? "" : "  ·  " + phone));
        un.setTextColor(Color.parseColor("#E8E6FF"));
        un.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        un.setGravity(Gravity.CENTER);
        head.addView(un);
        TextView badge = new TextView(this);
        String sub = tr(STATE_APP ? "state_app" : "admin_app");
        if (!p.optString("designation").isEmpty()) sub = p.optString("designation") + "  ·  " + sub;
        if (!p.optString("state").isEmpty()) sub = sub + "  ·  " + p.optString("state");
        badge.setText(sub);
        badge.setTextColor(Color.WHITE);
        badge.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        badge.setPadding(dp(12), dp(5), dp(12), dp(5));
        GradientDrawable bb = new GradientDrawable();
        bb.setColor(Color.parseColor("#33FFFFFF"));
        bb.setCornerRadius(dp(99));
        badge.setBackground(bb);
        LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(-2, -2);
        blp.topMargin = dp(10);
        head.addView(badge, blp);
        page.addView(head, hlp);

        LinearLayout acc = card(page, tr("sec_account"));
        row(acc, "👤", tr("edit_profile"), p.optString("email", ""), v -> showEditProfile());
        row(acc, "🔒", tr("change_password"), "", v -> showChangePassword());

        LinearLayout set = card(page, tr("sec_settings"));
        row(set, "🌐", tr("language"), L.langName(this), v -> chooseLanguage(this::showProfile));
        int zi = zoomIndex();
        row(set, "🔠", tr("text_size"), tr(TEXT_ZOOM_KEYS[zi]), v -> chooseTextSize());
        TextView keepVal = row(set, "💡", tr("keep_screen_on"), "", null);
        Switch keep = new Switch(this);
        keep.setChecked(settings().getBoolean("keep_screen_on", false));
        keep.setOnCheckedChangeListener((b, on) -> {
            settings().edit().putBoolean("keep_screen_on", on).apply();
            applySettings();
        });
        ((LinearLayout) keepVal.getParent()).addView(keep);

        LinearLayout data = card(page, tr("sec_data"));
        row(data, "🔄", tr("refresh"), "", v -> { openDashboard(); webView.reload(); });
        row(data, "🧹", tr("clear_cache"), "", v -> {
            webView.clearCache(true);
            Toast.makeText(this, tr("cache_cleared"), Toast.LENGTH_SHORT).show();
            openDashboard();
            webView.loadUrl(START_URL);
        });
        TextView live = new TextView(this);
        live.setText(tr("live_data"));
        live.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        live.setTextColor(Color.parseColor("#7A7F99"));
        live.setPadding(dp(20), dp(6), dp(20), 0);
        page.addView(live);

        LinearLayout sup = card(page, tr("sec_support"));
        row(sup, "📤", tr("share_app"), "", v -> {
            Intent s = new Intent(Intent.ACTION_SEND);
            s.setType("text/plain");
            s.putExtra(Intent.EXTRA_TEXT, trf("share_text", getString(R.string.app_name), DOWNLOAD_URL));
            startActivity(Intent.createChooser(s, tr("share_app")));
        });
        row(sup, "🛡️", tr("privacy"), "", v -> openExternally(Uri.parse(START_URL + "privacy.html")));
        row(sup, "📄", tr("terms"), "", v -> openExternally(Uri.parse(START_URL + "terms.html")));

        LinearLayout about = card(page, tr("sec_about"));
        row(about, "ℹ️", tr("app_version"), versionText(), null);
        long since = p.optLong("createdAt", 0);
        if (since > 0) {
            row(about, "📅", tr("member_since"),
                    new java.text.SimpleDateFormat("d MMM yyyy", java.util.Locale.ENGLISH).format(new java.util.Date(since)), null);
        }

        Button out = new Button(this);
        out.setText(tr("logout"));
        out.setAllCaps(false);
        out.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        out.setTextColor(Color.parseColor("#C62828"));
        GradientDrawable ob = new GradientDrawable();
        ob.setColor(Color.WHITE);
        ob.setCornerRadius(dp(12));
        ob.setStroke(dp(1), Color.parseColor("#F1C4C4"));
        out.setBackground(ob);
        LinearLayout.LayoutParams olp = new LinearLayout.LayoutParams(-1, dp(52));
        olp.setMargins(dp(14), dp(24), dp(14), 0);
        out.setOnClickListener(v -> confirmLogout());
        page.addView(out, olp);
        TextView del = linkText(tr("delete_account"), v -> confirmDelete());
        del.setTextColor(Color.parseColor("#9E9E9E"));
        del.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        page.addView(del);

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.parseColor("#F4F5FA"));
        scroll.addView(page);
        detachWebView();
        setContentView(scroll);
    }

    private int zoomIndex() {
        int z = settings().getInt("text_zoom", 100);
        for (int i = 0; i < TEXT_ZOOMS.length; i++) if (TEXT_ZOOMS[i] == z) return i;
        return 1;
    }

    private void chooseTextSize() {
        String[] names = new String[TEXT_ZOOM_KEYS.length];
        for (int i = 0; i < names.length; i++) names[i] = tr(TEXT_ZOOM_KEYS[i]);
        new AlertDialog.Builder(this)
                .setTitle(tr("text_size"))
                .setSingleChoiceItems(names, zoomIndex(), (d, which) -> {
                    settings().edit().putInt("text_zoom", TEXT_ZOOMS[which]).apply();
                    applySettings();
                    d.dismiss();
                    showProfile();
                })
                .setNegativeButton(tr("cancel"), null)
                .show();
    }

    private static final String[] STATES = {"", "Andaman & Nicobar", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar",
            "Chandigarh", "Chhattisgarh", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu & Kashmir",
            "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram",
            "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
            "Uttar Pradesh", "Uttarakhand", "West Bengal", "PAN India / HO"};

    private void showEditProfile() {
        inProfile = true;
        JSONObject p = profile();
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackgroundColor(Color.WHITE);
        page.addView(profileHeaderBar(tr("edit_profile"), this::showProfile));
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(22), dp(10), dp(22), dp(28));
        page.addView(box);

        box.addView(fieldLabel(tr("full_name")));
        EditText full = authField(tr("full_name"), TEXT_NAME, 40);
        full.setText(p.optString("fullName", ""));
        addField(box, full);
        box.addView(fieldLabel(tr("email_optional")));
        EditText email = authField("name@example.com", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS, 80);
        email.setText(p.optString("email", ""));
        addField(box, email);
        box.addView(fieldLabel(tr("state_optional")));
        Spinner state = new Spinner(this);
        ArrayAdapter<String> ad = new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, STATES);
        state.setAdapter(ad);
        String cur = p.optString("state", "");
        for (int i = 0; i < STATES.length; i++) if (STATES[i].equals(cur)) state.setSelection(i);
        GradientDrawable sbg = new GradientDrawable();
        sbg.setColor(Color.parseColor("#F5F6FA"));
        sbg.setCornerRadius(dp(10));
        sbg.setStroke(dp(1), Color.parseColor("#D8DAE5"));
        state.setBackground(sbg);
        state.setPadding(dp(8), dp(12), dp(8), dp(12));
        addField(box, state);
        box.addView(fieldLabel(tr("designation_optional")));
        EditText desig = authField(tr("designation_optional"), TEXT_NAME, 50);
        desig.setText(p.optString("designation", ""));
        addField(box, desig);

        TextView ro = new TextView(this);
        ro.setText("@" + sessionUser() + "  ·  " + p.optString("phone", "") + "\n" + tr("readonly_note"));
        ro.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        ro.setTextColor(Color.parseColor("#7A7F99"));
        ro.setPadding(dp(4), dp(6), 0, dp(6));
        box.addView(ro);
        tcStatus = authMsg(box);
        Button save = authButton(tr("save"));
        box.addView(save, buttonParams());
        save.setOnClickListener(v -> {
            hideKeyboard(desig);
            busy(save, tr("saving"));
            JSONObject prof = obj("fullName", full.getText().toString().trim(), "email", email.getText().toString().trim(),
                    "state", (String) state.getSelectedItem(), "designation", desig.getText().toString().trim());
            callAuth(sessionBody("action", "update-profile", "profile", prof), (ok, res, err) -> {
                busy(save, null);
                if (ok) {
                    saveProfile(res.optJSONObject("profile"));
                    Toast.makeText(this, tr("saved"), Toast.LENGTH_SHORT).show();
                    showProfile();
                } else {
                    handleSessionError(res, err);
                }
            });
        });
        showScreen(page, null);
    }

    private void showChangePassword() {
        inProfile = true;
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackgroundColor(Color.WHITE);
        page.addView(profileHeaderBar(tr("change_password"), this::showProfile));
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(22), dp(10), dp(22), dp(28));
        page.addView(box);
        EditText curp = authField(tr("current_password"), TEXT_PASSWORD, 64);
        EditText np = authField(tr("new_password"), TEXT_PASSWORD, 64);
        EditText np2 = authField(tr("confirm_new_password"), TEXT_PASSWORD, 64);
        addField(box, curp);
        addField(box, np);
        addField(box, np2);
        box.addView(showPasswordBox(curp, np, np2));
        tcStatus = authMsg(box);
        Button save = authButton(tr("change_password"));
        box.addView(save, buttonParams());
        save.setOnClickListener(v -> {
            String a = np.getText().toString();
            if (a.length() < 6) { setStatus(tr("err_pw_short"), true); return; }
            if (!a.equals(np2.getText().toString())) { setStatus(tr("err_pw_match"), true); return; }
            hideKeyboard(np2);
            busy(save, tr("saving"));
            callAuth(sessionBody("action", "change-password", "currentPassword", curp.getText().toString(), "newPassword", a),
                    (ok, res, err) -> {
                        busy(save, null);
                        if (ok) {
                            Toast.makeText(this, tr("pw_changed"), Toast.LENGTH_LONG).show();
                            showProfile();
                        } else {
                            handleSessionError(res, err);
                        }
                    });
        });
        showScreen(page, curp);
    }

    private void handleSessionError(JSONObject res, String err) {
        if (res.optBoolean("loggedOut", false)) {
            clearSession();
            showLoginScreen(tr("logged_out_elsewhere"));
        } else {
            setStatus(err, true);
        }
    }

    private void photoOptions() {
        if (cachedPhoto() == null) { pickPhoto(); return; }
        new AlertDialog.Builder(this)
                .setTitle(tr("profile_photo"))
                .setItems(new String[]{tr("change_photo"), tr("remove_photo")}, (d, which) -> {
                    if (which == 0) pickPhoto();
                    else callAuth(sessionBody("action", "remove-photo"), (ok, res, err) -> {
                        if (ok) {
                            saveProfile(res.optJSONObject("profile"));
                            authPrefs().edit().remove("photo").putLong("photo_version", 0).apply();
                            showProfile();
                        } else {
                            Toast.makeText(this, err, Toast.LENGTH_LONG).show();
                        }
                    });
                })
                .show();
    }

    private void pickPhoto() {
        Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
        pick.setType("image/*");
        pick.addCategory(Intent.CATEGORY_OPENABLE);
        try {
            startActivityForResult(Intent.createChooser(pick, tr("change_photo")), PHOTO_REQUEST);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, tr("photo_failed"), Toast.LENGTH_SHORT).show();
        }
    }

    // Square-crops the chosen image to 320 px JPEG and uploads it.
    private void uploadPhoto(Uri uri) {
        Toast.makeText(this, tr("uploading_photo"), Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            String b64 = null;
            try {
                BitmapFactory.Options bounds = new BitmapFactory.Options();
                bounds.inJustDecodeBounds = true;
                try (InputStream in = getContentResolver().openInputStream(uri)) { BitmapFactory.decodeStream(in, null, bounds); }
                int sample = 1;
                while (Math.min(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 320) sample *= 2;
                BitmapFactory.Options o = new BitmapFactory.Options();
                o.inSampleSize = sample;
                Bitmap src;
                try (InputStream in = getContentResolver().openInputStream(uri)) { src = BitmapFactory.decodeStream(in, null, o); }
                if (src != null) {
                    src = rotateIfNeeded(uri, src);
                    int s = Math.min(src.getWidth(), src.getHeight());
                    Bitmap sq = Bitmap.createBitmap(src, (src.getWidth() - s) / 2, (src.getHeight() - s) / 2, s, s);
                    Bitmap out = Bitmap.createScaledBitmap(sq, 320, 320, true);
                    ByteArrayOutputStream bos = new ByteArrayOutputStream();
                    out.compress(Bitmap.CompressFormat.JPEG, 82, bos);
                    b64 = Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP);
                }
            } catch (Throwable ignored) { }
            final String data = b64;
            ui.post(() -> {
                if (data == null) { Toast.makeText(this, tr("photo_failed"), Toast.LENGTH_LONG).show(); return; }
                callAuth(sessionBody("action", "upload-photo", "photo", data), (ok, res, err) -> {
                    if (ok) {
                        JSONObject p = res.optJSONObject("profile");
                        saveProfile(p);
                        authPrefs().edit().putString("photo", data)
                                .putLong("photo_version", p == null ? 0 : p.optLong("photoVersion", 0)).apply();
                        Toast.makeText(this, tr("photo_updated"), Toast.LENGTH_SHORT).show();
                        showProfile();
                    } else if (res.optBoolean("loggedOut", false)) {
                        clearSession();
                        showLoginScreen(tr("logged_out_elsewhere"));
                    } else {
                        Toast.makeText(this, err, Toast.LENGTH_LONG).show();
                    }
                });
            });
        }).start();
    }

    private Bitmap rotateIfNeeded(Uri uri, Bitmap b) {
        try (InputStream in = getContentResolver().openInputStream(uri)) {
            ExifInterface exif = new ExifInterface(in);
            int o = exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
            int deg = o == ExifInterface.ORIENTATION_ROTATE_90 ? 90 : o == ExifInterface.ORIENTATION_ROTATE_180 ? 180
                    : o == ExifInterface.ORIENTATION_ROTATE_270 ? 270 : 0;
            if (deg == 0) return b;
            Matrix m = new Matrix();
            m.postRotate(deg);
            return Bitmap.createBitmap(b, 0, 0, b.getWidth(), b.getHeight(), m, true);
        } catch (Throwable e) {
            return b;
        }
    }

    private void confirmLogout() {
        new AlertDialog.Builder(this)
                .setTitle(tr("logout"))
                .setMessage(tr("logout_confirm"))
                .setPositiveButton(tr("logout"), (d, w) -> {
                    callAuth(sessionBody("action", "logout"), (ok, res, err) -> { });
                    clearSession();
                    if (webView != null) webView.clearHistory();
                    showLoginScreen(null);
                })
                .setNegativeButton(tr("cancel"), null)
                .show();
    }

    private void confirmDelete() {
        EditText pw = authField(tr("password"), TEXT_PASSWORD, 64);
        FrameLayout wrap = new FrameLayout(this);
        wrap.setPadding(dp(20), dp(8), dp(20), 0);
        wrap.addView(pw);
        new AlertDialog.Builder(this)
                .setTitle(tr("delete_account"))
                .setMessage(tr("delete_confirm"))
                .setView(wrap)
                .setPositiveButton(tr("delete"), (d, w) ->
                        callAuth(sessionBody("action", "delete-account", "password", pw.getText().toString()), (ok, res, err) -> {
                            if (ok) {
                                clearSession();
                                authPrefs().edit().remove("last_username").apply();
                                showLoginScreen(tr("account_deleted"));
                            } else {
                                Toast.makeText(this, err, Toast.LENGTH_LONG).show();
                            }
                        }))
                .setNegativeButton(tr("cancel"), null)
                .show();
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
            public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                // The page used too much memory and Android stopped it: rebuild the view and reload.
                if (webView == view) {
                    detachWebView();
                    webView.destroy();
                    webView = null;
                    if (unlocked) openDashboard();
                }
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
            public void onProgressChanged(WebView view, int progress) {
                pageLoading = progress < 100;
                if (loadBar != null) {
                    loadBar.setProgress(progress);
                    loadBar.setVisibility(pageLoading ? View.VISIBLE : View.GONE);
                }
            }

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
        if (requestCode == PHOTO_REQUEST) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null) uploadPhoto(data.getData());
            return;
        }
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
            "function check(e){if(e.__bis)return;if(bad.test((e.textContent||'')+' '+(e.title||''))){e.style.setProperty('display','none','important');e.__bis=1}}" +
            "function scan(root){if(!root||root.nodeType!==1)return;if(root.matches('button,a'))check(root);var els=root.querySelectorAll('button,a');for(var i=0;i<els.length;i++)check(els[i])}" +
            "var pend=[],full=1;function scrub(){addCss();if(full){full=0;pend=[];scan(document.documentElement);return}var p=pend;pend=[];" +
            "for(var i=0;i<p.length;i++){var n=p[i];if(n.isConnected)scan(n)}}" +
            "function guard(){var h='';try{h=decodeURIComponent(location.hash.slice(1))}catch(x){}if(/^(retailers|retv|ret)\\b/i.test(h)){location.hash=''}}" +
            "var q=0;function tick(){if(q)return;q=1;setTimeout(function(){q=0;scrub();guard()},80)}" +
            "addCss();tick();document.addEventListener('DOMContentLoaded',function(){full=1;tick()});" +
            "new MutationObserver(function(ms){for(var i=0;i<ms.length;i++){var m=ms[i],t=m.target;" +
            "if(t.nodeType===1){var b=t.closest&&t.closest('button,a');if(b)pend.push(b)}" +
            "for(var j=0;j<m.addedNodes.length;j++){if(m.addedNodes[j].nodeType===1)pend.push(m.addedNodes[j])}}" +
            "if(pend.length>400){pend=[];full=1}tick()}).observe(document.documentElement,{childList:true,subtree:true});" +
            "window.addEventListener('hashchange',guard);" +
            "document.addEventListener('click',function(e){var t=e.target&&e.target.closest?e.target.closest('[data-t=\"ret\"],[data-t=\"retv\"],[data-go=\"ret\"],[data-go=\"retv\"],a[href*=\"retailers=\"]'):null;" +
            "if(t){e.preventDefault();e.stopImmediatePropagation()}},true);" +
            "})();";

    // Loads the BI Assistant (search + chatbot) from the dashboard site. A daily version keeps it fresh.
    private static final String ASSIST_LOADER_JS =
            "(function(){if(window.BIAssist||document.getElementById('bia-loader'))return;" +
            "window.BI_APP='" + (BuildConfig.STATE_APP ? "state" : "admin") + "';" +
            "var s=document.createElement('script');s.id='bia-loader';" +
            "s.src='/assistant.js?v='+new Date().toISOString().slice(0,10);" +
            "(document.head||document.documentElement).appendChild(s);})();";

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
        if (inProfile) {
            openDashboard();
            return;
        }
        if (unlocked && webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
