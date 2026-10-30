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
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
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
    // Market visits: GPS punch in/out and camera photos inside the shared tool pages.
    private static final int GEO_REQUEST = 2101, CAM_PERM_REQUEST = 2102, MIC_PERM_REQUEST = 2103;
    private String geoOrigin;
    private android.webkit.GeolocationPermissions.Callback geoCallback;
    private Uri cameraPhotoUri;
    private boolean pendingImageChooser;
    private boolean unlocked = false;      // dashboard (not a login/profile screen) is showing
    private boolean inProfile = false;     // a profile screen is showing over the dashboard
    private LinearLayout dashboardRoot;
    private String lockedState = null;   // state baked into the state-app page script
    private ProgressBar loadBar;
    private boolean pageLoading = true;
    private FrameLayout topAvatar;

    private String tr(String key) { return L.t(this, key); }
    private String trf(String key, Object... a) { return L.f(this, key, a); }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        initTruecaller();
        initQr();
        fetchStates();
        NotifyWorker.ensureChannel(this);
        // Stay logged in until the user taps Log out.
        if (sessionToken() != null) {
            if (STATE_APP && profile().optBoolean("linkRequired", false)) showLinkVchat();
            else if (STATE_APP && profile().optString("state", "").isEmpty()) showPickState();
            else openDashboard();
            refreshProfile();
            NotifyWorker.schedule(this);
            ui.postDelayed(() -> checkForUpdate(false), 2500);
        } else {
            showLoginScreen(null);
        }
        handleIntent(getIntent());
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        try { if (speech != null) speech.destroy(); } catch (Throwable ignored) { }
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
        NotifyWorker.schedule(this);
        ui.postDelayed(this::askNotificationPermission, 1500);
    }

    private void clearSession() {
        authPrefs().edit().remove("session_user").remove("session_token").remove("profile").remove("photo").remove("photo_version")
                .remove("survey_badge").remove("support_unread").remove("chat_unread").apply();
        try { NotifyWorker.cancel(this); } catch (Throwable ignored) { }
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
    private long lastPing = 0, backgroundedAt = 0;
    private static final long REOPEN_LOG_MS = 15 * 60 * 1000;

    @Override
    protected void onStop() {
        super.onStop();
        backgroundedAt = System.currentTimeMillis();
    }

    @Override
    protected void onStart() {
        super.onStart();
        // Coming back after a while counts as opening the app again (for the access log).
        if (sessionToken() != null && backgroundedAt > 0 && System.currentTimeMillis() - backgroundedAt > REOPEN_LOG_MS) {
            refreshProfile();
        } else if (sessionToken() != null && backgroundedAt > 0 && System.currentTimeMillis() - lastNotify > 2 * 60 * 1000L) {
            refreshNotify();
        }
        if (sessionToken() != null && backgroundedAt > 0) checkForUpdate(false);
    }

    private void refreshProfile() {
        lastPing = System.currentTimeMillis();
        callAuth(sessionBody("action", "ping"), (ok, res, err) -> {
            if (ok) {
                JSONObject p = res.optJSONObject("profile");
                saveProfile(p);
                if (STATE_APP && p != null) {
                    if (p.optBoolean("linkRequired", false)) { if (!inLink) showLinkVchat(); return; }
                    if (inLink) { inLink = false; openDashboard(); }
                }
                refreshSupportBadge();
                if (STATE_APP && p != null) {
                    String st = p.optString("state", "");
                    if (st.isEmpty()) { showPickState(); return; }
                    if (lockedState != null && !st.equals(lockedState) && webView != null) {
                        // An admin changed this user's state: rebuild the page with the new state lock.
                        detachWebView(); webView.destroy(); webView = null;
                        if (unlocked) openDashboard();
                    }
                }
                syncPhoto(p == null ? 0 : p.optLong("photoVersion", 0));
                updateTopAvatar();
            } else if (res.optBoolean("loggedOut", false)) {
                clearSession();
                if (res.optBoolean("disabled")) { showLoginScreen(null); setStatus(res.optString("error"), true); } else showLoginScreen(tr("logged_out_elsewhere"));
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

    private final String deviceName = (Build.MANUFACTURER + " " + Build.MODEL).trim();
    private String appVer = "";

    private void callAuth(JSONObject body, AuthResult cb) {
        final String noNet = tr("no_internet");
        if (appVer.isEmpty()) { try { appVer = getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception ignored) { } }
        new Thread(() -> {
            boolean ok = false;
            JSONObject res = new JSONObject();
            String err = noNet;
            HttpURLConnection c = null;
            try {
                body.put("app", APP_ID);
                body.put("device", deviceName);
                body.put("ver", appVer);
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
        if (requestCode == GEO_REQUEST && geoCallback != null) {
            boolean ok = false;
            for (int r : results) if (r == PackageManager.PERMISSION_GRANTED) ok = true;
            geoCallback.invoke(geoOrigin, ok, false);
            geoCallback = null;
            if (!ok) Toast.makeText(this, tr("location_needed"), Toast.LENGTH_LONG).show();
        }
        if (requestCode == MIC_PERM_REQUEST && pendingSpeech != null) {
            String[] ps = pendingSpeech; pendingSpeech = null;
            boolean ok = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
            if (ok) startSpeech(ps[0], "1".equals(ps[1])); else { speechJs("error", "not-allowed"); speechJs("end", ""); }
        }
        if (requestCode == CAM_PERM_REQUEST && pendingImageChooser) {
            pendingImageChooser = false;
            if (filePathCallback != null) launchFileChooser(true);
        }
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
        inLink = false;
        LinearLayout box = authHeader(STATE_APP ? tr("login_sub_vchat") : tr("login_sub"));
        // Admin app: Admin | Master admin (same user name + password; master unlocks Studio + Customize)
        final boolean[] asMaster = { !STATE_APP && authPrefs().getBoolean("login_master", false) };
        if (!STATE_APP) {
            LinearLayout seg = new LinearLayout(this);
            seg.setOrientation(LinearLayout.HORIZONTAL);
            TextView a1 = new TextView(this), a2 = new TextView(this);
            a1.setText(tr("login_as_admin")); a2.setText("👑 " + tr("master_admin"));
            Runnable paint = () -> {
                for (int i = 0; i < 2; i++) {
                    TextView t = i == 0 ? a1 : a2; boolean on = (i == 1) == asMaster[0];
                    GradientDrawable g = new GradientDrawable(); g.setCornerRadius(dp(99));
                    g.setColor(on ? BRAND : Color.WHITE); g.setStroke(dp(1), on ? BRAND : Color.parseColor("#D8DAE5"));
                    t.setBackground(g); t.setTextColor(on ? Color.WHITE : Color.parseColor("#333333"));
                }
            };
            for (int i = 0; i < 2; i++) {
                TextView t = i == 0 ? a1 : a2; final boolean m = i == 1;
                t.setGravity(Gravity.CENTER); t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14); t.setTypeface(Typeface.DEFAULT_BOLD);
                t.setPadding(dp(6), dp(10), dp(6), dp(10));
                LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, -2, 1); if (i == 1) lp.leftMargin = dp(8);
                seg.addView(t, lp);
                t.setOnClickListener(v -> { asMaster[0] = m; authPrefs().edit().putBoolean("login_master", m).apply(); paint.run(); });
            }
            paint.run();
            LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(-1, -2); sp.topMargin = dp(6); sp.bottomMargin = dp(4);
            box.addView(seg, sp);
        }
        EditText user = authField(STATE_APP ? tr("vchat_id") : tr("username"), TEXT_PLAIN, 40);
        user.setText(STATE_APP ? authPrefs().getString("last_vchat", "") : lastUsername());
        addField(box, user);
        EditText pass = authField(tr("password"), TEXT_PASSWORD, 64);
        addField(box, pass);
        box.addView(showPasswordBox(pass));
        tcStatus = authMsg(box);
        if (info != null) setStatus(info, false);
        else if (!authPrefs().getString("pwreq_id", "").isEmpty()) setStatus(tr("reset_pending_login"), false);
        refreshAuthConfig(null);
        Button login = authButton(tr("login"));
        box.addView(login, buttonParams());
        box.addView(linkText(tr("forgot"), v -> showForgot()));
        box.addView(linkText(tr("new_user"), v -> showSignup()));
        box.addView(languageLink(() -> showLoginScreen(info)));

        Runnable doLogin = () -> {
            String u = user.getText().toString().trim();
            String p = pass.getText().toString();
            if (u.isEmpty() || p.isEmpty()) { setStatus(STATE_APP ? tr("enter_vchat_pass") : tr("enter_user_pass"), true); return; }
            hideKeyboard(pass);
            busy(login, tr("logging_in"));
            JSONObject lb = STATE_APP ? obj("action", "login", "username", u, "vchatId", u, "password", p) : obj("action", "login", "username", u, "password", p);
            if (asMaster[0]) { try { lb.put("loginAs", "master"); } catch (Exception ignored) { } }
            callAuth(lb, (ok, res, err) -> {
                busy(login, null);
                if (!ok && res.optBoolean("notMaster", false) && res.optBoolean("canClaim", false)) {
                    setStatus(err, true);
                    askMasterClaim(u, p, login);
                    return;
                }
                if (ok) {
                    saveSession(res);
                    authPrefs().edit().remove("pwreq_id").remove("pwreq_user").apply();
                    if (STATE_APP) {
                        String vc = profile().optString("vchatId", "");
                        if (profile().optBoolean("linkRequired", false)) { showLinkVchat(); return; }
                        if (!vc.isEmpty()) authPrefs().edit().putString("last_vchat", vc).apply();
                    }
                    if (STATE_APP && profile().optString("state", "").isEmpty()) { showPickState(); return; }
                    openDashboard();
                    refreshSupportBadge();
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

    // First master admin: one-time setup code (later masters are promoted in Studio → Masters)
    private void askMasterClaim(String u, String p, Button login) {
        EditText code = new EditText(this);
        code.setHint(tr("setup_code"));
        code.setSingleLine(true);
        code.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);
        LinearLayout wrap = new LinearLayout(this); wrap.setPadding(dp(20), dp(4), dp(20), 0); wrap.addView(code, new LinearLayout.LayoutParams(-1, -2));
        new AlertDialog.Builder(this)
                .setTitle("👑 " + tr("master_setup_title"))
                .setMessage(tr("master_setup_msg"))
                .setView(wrap)
                .setNegativeButton(tr("cancel"), null)
                .setPositiveButton(tr("activate"), (d, w) -> {
                    busy(login, tr("logging_in"));
                    callAuth(obj("action", "master-claim", "username", u, "password", p, "code", code.getText().toString().trim()), (ok, res, err) -> {
                        busy(login, null);
                        if (!ok) { setStatus(err, true); return; }
                        saveSession(res);
                        Toast.makeText(this, tr("master_now"), Toast.LENGTH_LONG).show();
                        openDashboard();
                        refreshSupportBadge();
                    });
                })
                .show();
    }

    // ---------- Sign up: profile + password, mobile verified once with Truecaller ----------
    private String[] signupDraft = new String[6];
    private String signupState = "";

    private void showSignup() {
        unlocked = false;
        if (STATE_APP) { showStateSignup(); return; }
        final boolean needTc = tcRequired() && !waRequired();
        refreshAuthConfig(null);
        LinearLayout box = authHeader(needTc ? tr("signup_sub") : tr("signup_sub_plain"));
        EditText full = authField(tr("full_name"), TEXT_NAME, 40);
        EditText user = authField(tr("choose_username"), TEXT_PLAIN, 30);
        EditText phone = authField(tr("mobile"), InputType.TYPE_CLASS_PHONE, 10);
        EditText pass = authField(tr("create_password"), TEXT_PASSWORD, 64);
        EditText pass2 = authField(tr("confirm_password"), TEXT_PASSWORD, 64);
        EditText code = authField(tr("access_code"), TEXT_PASSWORD, 64);
        EditText aEmail = authField(tr("email_required"), InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS, 80);
        EditText aCode = authField(tr("email_code"), InputType.TYPE_CLASS_NUMBER, 6);
        EditText[] all = {full, user, phone, pass, pass2, code};
        for (int i = 0; i < all.length; i++) if (signupDraft[i] != null) all[i].setText(signupDraft[i]);
        addField(box, full);
        addField(box, user);
        addField(box, phoneRow(phone));
        Spinner stateSp = null;
        if (STATE_APP) {
            stateSp = stateSpinner(withBlank(tr("select_state"), dashboardStates(), null), signupState);
            addField(box, stateSp);
        }
        final Spinner stateSel = stateSp;
        addField(box, pass);
        addField(box, pass2);
        box.addView(showPasswordBox(pass, pass2));
        // Email + code (when the admin's email verification is on)
        LinearLayout erow = new LinearLayout(this);
        erow.setOrientation(LinearLayout.VERTICAL);
        addField(erow, aEmail);
        Button aSend = new Button(this);
        aSend.setText(tr("send_code"));
        aSend.setAllCaps(false);
        erow.addView(aSend, new LinearLayout.LayoutParams(-2, -2));
        addField(erow, aCode);
        aCode.setVisibility(View.GONE);
        erow.setVisibility(emailOtpOn() ? View.VISIBLE : View.GONE);
        box.addView(erow);
        final String[] aSent = {""};
        aSend.setOnClickListener(v -> {
            String em = aEmail.getText().toString().trim();
            if (!em.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+")) { setStatus(tr("err_email"), true); return; }
            aSend.setEnabled(false);
            aSend.setText(tr("sending"));
            callAuth(obj("action", "email-otp-send", "email", em, "purpose", "signup"), (ok, res, err) -> {
                aSend.setEnabled(true);
                aSend.setText(tr("resend_code"));
                if (!ok) { setStatus(err, true); return; }
                aSent[0] = em.toLowerCase();
                aCode.setVisibility(View.VISIBLE);
                aCode.requestFocus();
                setStatus(trf("code_sent_to", em), false);
            });
        });
        addField(box, code);
        TextView invite = infoLine(tr("admin_invite_note"), 13, "#5C4300", false);
        invite.setPadding(dp(4), dp(6), dp(4), dp(6));
        box.addView(invite);
        Runnable applyMode = () -> {
            erow.setVisibility(emailOtpOn() ? View.VISIBLE : View.GONE);
            code.setVisibility(adminByEmail() ? View.GONE : View.VISIBLE);
            invite.setVisibility(adminByEmail() ? View.VISIBLE : View.GONE);
        };
        applyMode.run();
        tcStatus = authMsg(box);
        Button go = authButton(needTc && !emailOtpOn() ? tr("verify_create") : tr("create_account"));
        refreshAuthConfig(() -> { applyMode.run(); go.setText(tcRequired() && !emailOtpOn() ? tr("verify_create") : tr("create_account")); });
        box.addView(go, buttonParams());
        box.addView(linkText(tr("have_account"), v -> {
            signupDraft = new String[6];
            showLoginScreen(null);
        }));

        go.setOnClickListener(v -> {
            for (int i = 0; i < all.length; i++) signupDraft[i] = all[i].getText().toString();
            String st = stateSel == null ? "" : (stateSel.getSelectedItemPosition() == 0 ? "" : (String) stateSel.getSelectedItem());
            signupState = st;
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
            if (STATE_APP && st.isEmpty()) { setStatus(tr("err_state"), true); return; }
            if (ac.isEmpty() && !adminByEmail()) { setStatus(tr("err_code"), true); return; }
            final boolean useEmail = emailOtpOn();
            String aem = aEmail.getText().toString().trim();
            if (useEmail) {
                if (!aem.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+")) { setStatus(tr("err_email"), true); return; }
                if (!aem.toLowerCase().equals(aSent[0])) { setStatus(tr("err_send_code"), true); return; }
                if (!aCode.getText().toString().trim().matches("\\d{6}")) { setStatus(tr("err_email_code"), true); return; }
            }
            hideKeyboard(code);
            busy(go, tr("checking"));
            JSONObject details = useEmail
                    ? obj("fullName", fn, "username", un, "phone", ph, "password", pw, "accessCode", ac, "state", st, "email", aem, "emailOtp", aCode.getText().toString().trim())
                    : obj("fullName", fn, "username", un, "phone", ph, "password", pw, "accessCode", ac, "state", st);
            callAuth(obj("action", "signup-check", "fullName", fn, "username", un, "phone", ph,
                    "password", pw, "accessCode", ac, "state", st, "email", useEmail ? aem : ""), (ok, res, err) -> {
                busy(go, null);
                if (!ok) { setStatus(err, true); return; }
                if (useEmail) finishSignup(details, false);
                else if (waRequired()) startWaVerify("signup", obj("phone", ph), (wc, ws) -> {
                    try { details.put("waCode", wc); details.put("waSecret", ws); } catch (Exception ignored) { }
                    finishSignup(details, false);
                }, this::showSignup);
                else if (needTc) startPhoneVerification(fn, ph, () -> finishSignup(details, true), this::showSignup);
                else finishSignup(details, false);
            });
        });
        showScreen(box, full);
    }

    private void finishSignup(JSONObject d, boolean verified) {
        LinearLayout box = authHeader(tr("creating"));
        box.addView(new ProgressBar(this), new LinearLayout.LayoutParams(-2, -2));
        tcStatus = authMsg(box);
        showScreen(box, null);
        try {
            d.put("action", "signup");
            d.put("phoneVerified", verified);
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

    // ---------- State users: vChat ID sign-up (admin's allowed list decides the state) ----------
    private boolean inLink = false;
    private String vchatState = null;

    private TextView stateBox(LinearLayout box) {
        TextView st = authMsg(box);
        st.setText(tr("vchat_state_hint"));
        st.setTextColor(Color.parseColor("#7A7F99"));
        return st;
    }

    // Looks up the vChat ID and shows its state (locked). Runs after typing stops and when leaving the field.
    private void bindVchatLookup(EditText id, TextView stateView) {
        final Runnable[] pending = {null};
        final String[] last = {""};
        Runnable look = () -> {
            String v = id.getText().toString().trim();
            if (v.equals(last[0])) return;
            last[0] = v;
            vchatState = null;
            if (v.isEmpty()) { stateView.setText(tr("vchat_state_hint")); stateView.setTextColor(Color.parseColor("#7A7F99")); return; }
            stateView.setText(tr("checking"));
            callAuth(obj("action", "vchat-lookup", "vchatId", v), (ok, res, err) -> {
                if (!v.equals(id.getText().toString().trim())) return;
                if (ok) {
                    vchatState = res.optString("state");
                    stateView.setText("🔒 " + tr("state") + ": " + vchatState);
                    stateView.setTextColor(Color.parseColor("#1E9E61"));
                } else {
                    stateView.setText(err);
                    stateView.setTextColor(Color.parseColor("#C62828"));
                }
            });
        };
        id.addTextChangedListener(new android.text.TextWatcher() {
            public void beforeTextChanged(CharSequence c, int a, int b, int d) { }
            public void onTextChanged(CharSequence c, int a, int b, int d) { }
            public void afterTextChanged(android.text.Editable e) {
                vchatState = null;
                if (pending[0] != null) ui.removeCallbacks(pending[0]);
                pending[0] = look;
                ui.postDelayed(look, 700);
            }
        });
        id.setOnFocusChangeListener((v, has) -> { if (!has) look.run(); });
    }

    private View accessCodeRow(EditText code) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.addView(code, new LinearLayout.LayoutParams(0, -2, 1f));
        TextView i = new TextView(this);
        i.setText("i");
        i.setTypeface(Typeface.SERIF, Typeface.BOLD);
        i.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        i.setTextColor(Color.parseColor("#8A6A1F"));
        i.setGravity(Gravity.CENTER);
        GradientDrawable g = new GradientDrawable();
        g.setShape(GradientDrawable.OVAL);
        g.setColor(Color.parseColor("#FFF7E0"));
        g.setStroke(dp(1), Color.parseColor("#C9A227"));
        i.setBackground(g);
        i.setContentDescription(tr("access_code_info_title"));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(34), dp(34));
        lp.leftMargin = dp(8);
        row.addView(i, lp);
        i.setOnClickListener(v -> new AlertDialog.Builder(this).setTitle("🔑 " + tr("access_code_info_title"))
                .setMessage(tr("access_code_info")).setPositiveButton("OK", null).show());
        return row;
    }

    private void showStateSignup() {
        unlocked = false;
        vchatState = null;
        refreshAuthConfig(null);
        LinearLayout box = authHeader(tr("signup_sub_vchat"));
        EditText vid = authField(tr("vchat_id"), TEXT_PLAIN, 40);
        addField(box, vid);
        TextView stateView = stateBox(box);
        EditText user = authField(tr("choose_username"), TEXT_PLAIN, 30);
        EditText pass = authField(tr("create_password"), TEXT_PASSWORD, 64);
        EditText pass2 = authField(tr("confirm_password"), TEXT_PASSWORD, 64);
        EditText phone = authField(tr("vchat_mobile"), InputType.TYPE_CLASS_PHONE, 10);
        EditText email = authField(tr("email_required"), InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS, 80);
        EditText code = authField(tr("access_code_vchat"), TEXT_PLAIN, 20);
        addField(box, user);
        addField(box, pass);
        addField(box, pass2);
        box.addView(showPasswordBox(pass, pass2));
        addField(box, phoneRow(phone));
        addField(box, email);
        // Email code (shown when the admin's email verification is on)
        Button sendCode = new Button(this);
        sendCode.setText(tr("send_code"));
        sendCode.setAllCaps(false);
        EditText ecode = authField(tr("email_code"), InputType.TYPE_CLASS_NUMBER, 6);
        LinearLayout erow = new LinearLayout(this);
        erow.setOrientation(LinearLayout.VERTICAL);
        erow.addView(sendCode, new LinearLayout.LayoutParams(-2, -2));
        addField(erow, ecode);
        ecode.setVisibility(View.GONE);
        erow.setVisibility(emailOtpOn() ? View.VISIBLE : View.GONE);
        box.addView(erow);
        final String[] sentTo = {""};
        refreshAuthConfig(() -> erow.setVisibility(emailOtpOn() ? View.VISIBLE : View.GONE));
        sendCode.setOnClickListener(v -> {
            String em = email.getText().toString().trim();
            if (!em.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+")) { setStatus(tr("err_email"), true); return; }
            sendCode.setEnabled(false);
            sendCode.setText(tr("sending"));
            callAuth(obj("action", "email-otp-send", "email", em, "purpose", "signup"), (ok, res, err) -> {
                sendCode.setEnabled(true);
                sendCode.setText(tr("resend_code"));
                if (!ok) { setStatus(err, true); return; }
                sentTo[0] = em.toLowerCase();
                ecode.setVisibility(View.VISIBLE);
                ecode.requestFocus();
                setStatus(trf("code_sent_to", em), false);
            });
        });
        addField(box, accessCodeRow(code));
        tcStatus = authMsg(box);
        Button go = authButton(tr("create_account"));
        box.addView(go, buttonParams());
        box.addView(linkText(tr("have_account"), v -> showLoginScreen(null)));
        bindVchatLookup(vid, stateView);
        go.setOnClickListener(v -> {
            String id = vid.getText().toString().trim(), un = user.getText().toString().trim(), pw = pass.getText().toString();
            String ph = phone.getText().toString().replaceAll("\\D", ""), em = email.getText().toString().trim(), ac = code.getText().toString().trim();
            if (id.isEmpty()) { setStatus(tr("err_vchat"), true); return; }
            if (vchatState == null) { setStatus(tr("err_vchat_lookup"), true); return; }
            if (un.length() < 3) { setStatus(tr("err_username"), true); return; }
            if (pw.length() < 6) { setStatus(tr("err_pw_short"), true); return; }
            if (!pw.equals(pass2.getText().toString())) { setStatus(tr("err_pw_match"), true); return; }
            if (!ph.matches("[6-9]\\d{9}")) { setStatus(tr("err_vchat_mobile"), true); return; }
            if (!em.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+")) { setStatus(tr("err_email"), true); return; }
            if (emailOtpOn()) {
                if (!em.toLowerCase().equals(sentTo[0])) { setStatus(tr("err_send_code"), true); return; }
                if (!ecode.getText().toString().trim().matches("\\d{6}")) { setStatus(tr("err_email_code"), true); return; }
            }
            if (ac.isEmpty()) { setStatus(tr("err_code_vchat"), true); return; }
            hideKeyboard(code);
            JSONObject sd = obj("action", "signup", "vchatId", id, "username", un, "password", pw, "phone", ph, "email", em, "accessCode", ac,
                    "emailOtp", ecode.getText().toString().trim());
            if (waRequired()) {
                busy(go, tr("checking"));
                JSONObject chk = obj("action", "signup-check", "vchatId", id, "username", un, "password", pw, "phone", ph, "email", em, "accessCode", ac);
                callAuth(chk, (ok0, r0, e0) -> {
                    busy(go, null);
                    if (!ok0) { setStatus(e0, true); return; }
                    startWaVerify("signup", obj("vchatId", id, "phone", ph), (wc, ws) -> {
                        try { sd.put("waCode", wc); sd.put("waSecret", ws); } catch (Exception ignored) { }
                        stateSignupFinal(sd, id);
                    }, this::showStateSignup);
                });
                return;
            }
            busy(go, tr("saving"));
            callAuth(sd, (ok, res, err) -> {
                busy(go, null);
                if (!ok) { setStatus(err, true); return; }
                saveSession(res);
                authPrefs().edit().putString("last_vchat", res.optJSONObject("profile") != null ? res.optJSONObject("profile").optString("vchatId", id) : id).apply();
                Toast.makeText(this, trf("welcome", res.optString("fullName", "")), Toast.LENGTH_LONG).show();
                openDashboard();
            });
        });
        showScreen(box, vid);
    }

    private void stateSignupFinal(JSONObject sd, String id) {
        LinearLayout w = authHeader(tr("saving"));
        w.addView(new ProgressBar(this), new LinearLayout.LayoutParams(-2, -2));
        tcStatus = authMsg(w);
        showScreen(w, null);
        callAuth(sd, (ok, res, err) -> {
            if (!ok) { setStatus(err, true); w.addView(linkText(tr("back_signup"), v -> showStateSignup())); return; }
            saveSession(res);
            authPrefs().edit().putString("last_vchat", res.optJSONObject("profile") != null ? res.optJSONObject("profile").optString("vchatId", id) : id).apply();
            Toast.makeText(this, trf("welcome", res.optString("fullName", "")), Toast.LENGTH_LONG).show();
            openDashboard();
        });
    }

    // Older state accounts link their vChat ID once (nothing else works until they do).
    private void showLinkVchat() {
        unlocked = false;
        inProfile = false;
        inLink = true;
        vchatState = null;
        LinearLayout box = authHeader(tr("link_vchat_sub"));
        EditText vid = authField(tr("vchat_id"), TEXT_PLAIN, 40);
        addField(box, vid);
        TextView stateView = stateBox(box);
        EditText phone = authField(tr("vchat_mobile"), InputType.TYPE_CLASS_PHONE, 10);
        EditText code = authField(tr("access_code_vchat"), TEXT_PLAIN, 20);
        addField(box, phoneRow(phone));
        addField(box, accessCodeRow(code));
        tcStatus = authMsg(box);
        Button go = authButton(tr("link_vchat"));
        box.addView(go, buttonParams());
        box.addView(linkText(tr("logout"), v -> {
            callAuth(sessionBody("action", "logout"), (a, b, c) -> { });
            clearSession();
            showLoginScreen(null);
        }));
        bindVchatLookup(vid, stateView);
        go.setOnClickListener(v -> {
            if (vchatState == null) { setStatus(tr("err_vchat_lookup"), true); return; }
            hideKeyboard(code);
            String lid = vid.getText().toString().trim(), lph = phone.getText().toString().replaceAll("\\D", ""), lac = code.getText().toString().trim();
            if (waRequired()) {
                startWaVerify("link", obj("vchatId", lid, "phone", lph), (wc, ws) -> doLink(lid, lph, lac, wc, ws, null), this::showLinkVchat);
                return;
            }
            doLink(lid, lph, lac, null, null, go);
        });
        showScreen(box, vid);
        refreshAuthConfig(null);
    }

    private void doLink(String lid, String lph, String lac, String wc, String ws, Button go) {
        if (go != null) busy(go, tr("saving"));
        else { LinearLayout w = authHeader(tr("saving")); w.addView(new ProgressBar(this), new LinearLayout.LayoutParams(-2, -2)); tcStatus = authMsg(w); showScreen(w, null); }
        {
            callAuth(sessionBody("action", "vchat-link", "vchatId", lid, "phone", lph, "accessCode", lac, "waCode", wc == null ? "" : wc, "waSecret", ws == null ? "" : ws), (ok, res, err) -> {
                if (go != null) busy(go, null);
                if (!ok && go == null) { new AlertDialog.Builder(this).setMessage(err).setPositiveButton("OK", (d, w2) -> showLinkVchat()).setCancelable(false).show(); return; }
                if (!ok) { if (res.optBoolean("loggedOut", false)) handleSessionError(res, err); else setStatus(err, true); return; }
                saveProfile(res.optJSONObject("profile"));
                authPrefs().edit().putString("last_vchat", profile().optString("vchatId")).apply();
                inLink = false;
                Toast.makeText(this, tr("vchat_linked"), Toast.LENGTH_LONG).show();
                if (webView != null) { detachWebView(); webView.destroy(); webView = null; }   // rebuild with the vChat state lock
                openDashboard();
            });
        }
    }

    // ---------- Forgot password: re-verify mobile with Truecaller, then set a new password ----------
    private void showForgot() {
        unlocked = false;
        if (!authPrefs().getString("pwreq_id", "").isEmpty()) { showResetStatus(); return; }
        LinearLayout wait = authHeader(tr("checking"));
        wait.addView(new ProgressBar(this), new LinearLayout.LayoutParams(-2, -2));
        showScreen(wait, null);
        refreshAuthConfig(() -> { if (emailOtpOn()) showForgotEmail(); else if (waRequired()) showForgotWa(); else if (tcRequired()) showForgotTc(); else showResetRequest(); });
    }

    // ---------- Truecaller switch (set by admins, stored on the server) ----------
    private boolean tcRequired() { return settings().getBoolean("tc_required", true); }
    private boolean waRequired() { return settings().getBoolean("wa_required", false); }
    private boolean emailOtpOn() { return settings().getBoolean("email_otp", false); }
    private boolean adminByEmail() { return !STATE_APP && settings().getBoolean("admin_email_signup", false); }

    // Forgot password with an email code (state users).
    private void showForgotEmail() {
        LinearLayout box = authHeader(tr("forgot_email_sub"));
        EditText email = authField(tr("account_email"), InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS, 80);
        EditText otp = authField(tr("email_code"), InputType.TYPE_CLASS_NUMBER, 6);
        EditText pass = authField(tr("new_password"), TEXT_PASSWORD, 64);
        EditText pass2 = authField(tr("confirm_new_password"), TEXT_PASSWORD, 64);
        addField(box, email);
        LinearLayout step2 = new LinearLayout(this);
        step2.setOrientation(LinearLayout.VERTICAL);
        step2.setVisibility(View.GONE);
        box.addView(step2);
        addField(step2, otp);
        addField(step2, pass);
        addField(step2, pass2);
        step2.addView(showPasswordBox(pass, pass2));
        tcStatus = authMsg(box);
        Button go = authButton(tr("send_code"));
        box.addView(go, buttonParams());
        box.addView(linkText(tr("no_email_access"), v -> showResetRequest()));
        box.addView(linkText(tr("back_login"), v -> showLoginScreen(null)));
        final boolean[] sent = {false};
        go.setOnClickListener(v -> {
            String em = email.getText().toString().trim();
            if (!em.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+")) { setStatus(tr("err_email"), true); return; }
            if (!sent[0]) {
                busy(go, tr("sending"));
                callAuth(obj("action", "email-otp-send", "email", em, "purpose", "reset"), (ok, res, err) -> {
                    busy(go, null);
                    if (!ok) { setStatus(err, true); return; }
                    sent[0] = true;
                    step2.setVisibility(View.VISIBLE);
                    go.setText(tr("save_new_password"));
                    setStatus(tr("code_sent_check"), false);
                    otp.requestFocus();
                });
                return;
            }
            String pw = pass.getText().toString();
            if (pw.length() < 6) { setStatus(tr("err_pw_short"), true); return; }
            if (!pw.equals(pass2.getText().toString())) { setStatus(tr("err_pw_match"), true); return; }
            hideKeyboard(pass2);
            busy(go, tr("saving"));
            callAuth(obj("action", "reset-email", "email", em, "otp", otp.getText().toString().trim(), "newPassword", pw), (ok, res, err) -> {
                busy(go, null);
                if (!ok) { setStatus(err, true); return; }
                if (!res.optString("vchatId").isEmpty()) authPrefs().edit().putString("last_vchat", res.optString("vchatId")).apply();
                else authPrefs().edit().putString("last_username", res.optString("username")).apply();
                showLoginScreen(STATE_APP ? tr("pw_changed_email") : trf("pw_changed_login", res.optString("username")));
            });
        });
        showScreen(box, email);
    }

    // ---------- "Verify on WhatsApp": the user sends one message from their own WhatsApp (free) ----------
    private interface WaDone { void ok(String code, String secret); }
    private Runnable waPoll;

    private void startWaVerify(String purpose, JSONObject req, WaDone done, Runnable back) {
        LinearLayout box = authHeader(tr("wa_preparing"));
        box.addView(new ProgressBar(this), new LinearLayout.LayoutParams(-2, -2));
        tcStatus = authMsg(box);
        showScreen(box, null);
        try { req.put("action", "wa-start"); req.put("purpose", purpose); } catch (Exception ignored) { }
        callAuth(req, (ok, res, err) -> {
            if (!ok) {
                new AlertDialog.Builder(this).setMessage(err).setPositiveButton("OK", (d, w) -> back.run()).setCancelable(false).show();
                return;
            }
            String code = res.optString("code"), secret = res.optString("secret"), link = res.optString("waLink"), text = res.optString("text");
            String masked = res.optString("masked", "");
            LinearLayout b2 = authHeader(masked.isEmpty() ? tr("wa_send_from_this") : trf("wa_send_from_masked", masked));
            TextView msgView = infoLine(text, 24, "#111111", true);
            msgView.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
            msgView.setGravity(Gravity.CENTER);
            msgView.setPadding(0, dp(10), 0, dp(10));
            b2.addView(msgView);
            Button open = authButton(tr("wa_open"));
            open.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.parseColor("#25D366")));
            b2.addView(open, buttonParams());
            TextView status = infoLine(tr("wa_waiting"), 14, "#555555", false);
            status.setGravity(Gravity.CENTER);
            status.setPadding(0, dp(12), 0, dp(4));
            b2.addView(status);
            tcStatus = authMsg(b2);
            b2.addView(linkText(tr("cancel"), v -> { stopWaPoll(); back.run(); }));
            open.setOnClickListener(v -> {
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(link))); }
                catch (ActivityNotFoundException e) { Toast.makeText(this, tr("wa_not_installed"), Toast.LENGTH_LONG).show(); }
            });
            showScreen(b2, null);
            stopWaPoll();
            waPoll = new Runnable() {
                @Override
                public void run() {
                    callAuth(obj("action", "wa-status", "code", code, "secret", secret), (ok2, r2, e2) -> {
                        if (waPoll != this) return;
                        String st = r2.optString("status");
                        if ("verified".equals(st)) { stopWaPoll(); Toast.makeText(MainActivity.this, tr("wa_verified"), Toast.LENGTH_SHORT).show(); done.ok(code, secret); return; }
                        if ("mismatch".equals(st)) {
                            stopWaPoll();
                            new AlertDialog.Builder(MainActivity.this).setMessage(trf("wa_mismatch", r2.optString("from", ""))).setPositiveButton("OK", (d, w) -> back.run()).setCancelable(false).show();
                            return;
                        }
                        if ("expired".equals(st) || "missing".equals(st)) {
                            stopWaPoll();
                            new AlertDialog.Builder(MainActivity.this).setMessage(tr("wa_expired")).setPositiveButton("OK", (d, w) -> back.run()).setCancelable(false).show();
                            return;
                        }
                        ui.postDelayed(this, 2500);
                    });
                }
            };
            ui.postDelayed(waPoll, 2500);
            // Open WhatsApp straight away to save a tap.
            open.performClick();
        });
    }

    private void stopWaPoll() { if (waPoll != null) ui.removeCallbacks(waPoll); waPoll = null; }

    // Forgot password with WhatsApp: verify from the registered mobile, then the new password is saved.
    private void showForgotWa() {
        LinearLayout box = authHeader(tr("forgot_wa_sub"));
        EditText user = authField(STATE_APP ? tr("vchat_user_or_mobile") : tr("user_or_mobile"), TEXT_PLAIN, 40);
        user.setText(STATE_APP ? authPrefs().getString("last_vchat", "") : lastUsername());
        EditText pass = authField(tr("new_password"), TEXT_PASSWORD, 64);
        EditText pass2 = authField(tr("confirm_new_password"), TEXT_PASSWORD, 64);
        addField(box, user);
        addField(box, pass);
        addField(box, pass2);
        box.addView(showPasswordBox(pass, pass2));
        tcStatus = authMsg(box);
        Button go = authButton(tr("wa_verify_save"));
        go.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.parseColor("#25D366")));
        box.addView(go, buttonParams());
        box.addView(linkText(tr("wa_no_whatsapp"), v -> showResetRequest()));
        box.addView(linkText(tr("back_login"), v -> showLoginScreen(null)));
        go.setOnClickListener(v -> {
            String u = user.getText().toString().trim(), pw = pass.getText().toString();
            if (u.isEmpty()) { setStatus(tr("err_user_or_mobile"), true); return; }
            if (pw.length() < 6) { setStatus(tr("err_pw_short"), true); return; }
            if (!pw.equals(pass2.getText().toString())) { setStatus(tr("err_pw_match"), true); return; }
            hideKeyboard(pass2);
            startWaVerify("reset", obj("username", u), (code, secret) -> {
                LinearLayout w = authHeader(tr("saving"));
                w.addView(new ProgressBar(this), new LinearLayout.LayoutParams(-2, -2));
                tcStatus = authMsg(w);
                showScreen(w, null);
                callAuth(obj("action", "reset-wa", "username", u, "newPassword", pw, "waCode", code, "waSecret", secret), (ok, res, err) -> {
                    if (!ok) { setStatus(err, true); w.addView(linkText(tr("back_login"), x -> showLoginScreen(null))); return; }
                    if (!res.optString("vchatId").isEmpty()) authPrefs().edit().putString("last_vchat", res.optString("vchatId")).apply();
                    else authPrefs().edit().putString("last_username", res.optString("username")).apply();
                    showLoginScreen(tr("pw_changed_wa"));
                });
            }, this::showForgotWa);
        });
        showScreen(box, user.getText().length() > 0 ? pass : user);
    }

    private void refreshAuthConfig(Runnable then) {
        callAuth(obj("action", "auth-config"), (ok, res, err) -> {
            if (ok) settings().edit().putBoolean("tc_required", res.optBoolean("tcRequired", true)).putBoolean("wa_required", res.optBoolean("waRequired", false))
                    .putBoolean("email_otp", res.optBoolean("emailOtp", false)).putBoolean("admin_email_signup", res.optBoolean("adminEmailSignup", false)).apply();
            if (then != null) then.run();
        });
    }

    // ---------- Forgot password by request (Truecaller switched off): a BI admin approves ----------
    private void showResetRequest() {
        LinearLayout box = authHeader(tr("reset_req_sub"));
        EditText user = authField(STATE_APP ? tr("vchat_user_or_mobile") : tr("user_or_mobile"), TEXT_PLAIN, 40);
        user.setText(lastUsername());
        EditText pass = authField(tr("new_password"), TEXT_PASSWORD, 64);
        EditText pass2 = authField(tr("confirm_new_password"), TEXT_PASSWORD, 64);
        EditText note = authField(tr("reset_note"), TEXT_PLAIN, 200);
        addField(box, user);
        addField(box, pass);
        addField(box, pass2);
        box.addView(showPasswordBox(pass, pass2));
        addField(box, note);
        tcStatus = authMsg(box);
        Button go = authButton(tr("send_reset_request"));
        box.addView(go, buttonParams());
        box.addView(linkText(tr("back_login"), v -> showLoginScreen(null)));
        go.setOnClickListener(v -> {
            String u = user.getText().toString().trim(), pw = pass.getText().toString();
            if (u.isEmpty()) { setStatus(tr("err_user_or_mobile"), true); return; }
            if (pw.length() < 6) { setStatus(tr("err_pw_short"), true); return; }
            if (!pw.equals(pass2.getText().toString())) { setStatus(tr("err_pw_match"), true); return; }
            hideKeyboard(pass2);
            busy(go, tr("saving"));
            callAuth(obj("action", "reset-request", "username", u, "newPassword", pw, "note", note.getText().toString().trim(), "via", "app"), (ok, res, err) -> {
                busy(go, null);
                if (!ok) { setStatus(err, true); return; }
                authPrefs().edit().putString("pwreq_id", res.optString("reqId")).putString("pwreq_user", res.optString("username"))
                        .putLong("pwreq_at", System.currentTimeMillis()).putString("last_username", res.optString("username")).apply();
                showResetStatus();
            });
        });
        showScreen(box, user.getText().length() > 0 ? pass : user);
    }

    private void showResetStatus() {
        String id = authPrefs().getString("pwreq_id", ""), u = authPrefs().getString("pwreq_user", "");
        LinearLayout box = authHeader(tr("reset_req_title"));
        tcStatus = authMsg(box);
        setStatus(tr("checking"), false);
        Button chk = authButton(tr("check_status"));
        box.addView(chk, buttonParams());
        box.addView(linkText(tr("new_reset_request"), v -> { authPrefs().edit().remove("pwreq_id").remove("pwreq_user").apply(); showForgot(); }));
        box.addView(linkText(tr("back_login"), v -> showLoginScreen(null)));
        Runnable check = () -> callAuth(obj("action", "reset-status", "username", u, "reqId", id), (ok, res, err) -> {
            if (!ok) {
                if (res.has("error") && !res.optBoolean("ok")) { authPrefs().edit().remove("pwreq_id").apply(); setStatus(tr("reset_gone"), true); }
                else setStatus(err, true);
                return;
            }
            String st = res.optString("status");
            if ("approved".equals(st)) {
                authPrefs().edit().remove("pwreq_id").remove("pwreq_user").apply();
                showLoginScreen(trf("reset_approved", u));
            } else if ("rejected".equals(st)) {
                authPrefs().edit().remove("pwreq_id").remove("pwreq_user").apply();
                String why = res.optString("reason", "");
                setStatus(tr("reset_rejected") + (why.isEmpty() ? "" : "\n" + why), true);
            } else {
                setStatus(trf("reset_waiting", u, fmtTime(authPrefs().getLong("pwreq_at", System.currentTimeMillis()), "d MMM, h:mm a")), false);
            }
        });
        chk.setOnClickListener(v -> check.run());
        showScreen(box, null);
        check.run();
    }

    private void showForgotTc() {
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
        inPortal = false;
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
        name.setPadding(dp(10), 0, dp(4), 0);
        name.setSingleLine(true);
        name.setEllipsize(TextUtils.TruncateAt.END);
        bar.addView(name, new LinearLayout.LayoutParams(0, -2, 1f));
        bar.addView(barButton("🔍", tr("search"), "openSearch"));
        bar.addView(barButton("💬", tr("assistant"), "openChat"));
        View tools = badgeButton("⊞", tr("all_tools"), false, v -> showHub());
        toolsBadge = chatBadge; chatBadge = null;
        GradientDrawable tg = new GradientDrawable(); tg.setColor(Color.parseColor("#EEF0FF")); tg.setCornerRadius(dp(12));
        tools.setBackground(tg);
        bar.addView(tools);
        setBadge(toolsBadge, authPrefs().getInt("tools_badge", 0));
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
        inAdminPage = false;
        inSurveyPage = false;
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
        if (p.optBoolean("master", false)) sub = "👑 " + tr("master_admin");
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

        LinearLayout help = card(page, tr("sec_tools"));
        row(help, "⊞", tr("all_tools"), tr(STATE_APP ? "all_tools_sub" : "all_tools_sub_admin"), v -> showHub());
        if (p.optBoolean("master", false)) row(help, "🧩", tr("studio"), tr("studio_sub"), v -> showToolPage("studio.html", tr("studio"), "#list"));
        row(help, "🔳", tr("scan_qr"), "", v -> scanWebLogin());

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
        row(about, "⬆️", tr("check_update"), "", v -> checkForUpdate(true));
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

    // ---------- Support desk (state users: own + own-state queries; admins: all queries) ----------
    private static final String[] SUPPORT_TOPICS = {"Overview", "Rankings", "Trends", "Retailer app usage", "Active retailers",
            "Support desk KPI", "Action plan", "KPI framework / calculation", "Sales target", "Customer visit", "Competition",
            "v-Notice", "Schemes & payout", "Data mismatch", "App issue", "Other"};
    private static final String[] SUPPORT_KPIS = {"Overall BI KPI score", "Retailer app usage", "Sales target achievement",
            "Customer visit efficiency", "Competition management", "Support desk", "v-Notice utilization", "Scheme announcement",
            "Scheme payout", "Announcements & notifications", "App visits"};
    private static final int ATTACH_REQUEST = 1003;
    private static final int MAX_ATTACH_BYTES = 4 * 1024 * 1024;
    private TextView supportBadge;
    private final List<JSONObject> pendingAtts = new ArrayList<>();
    private Runnable onAttachChanged;

    private View supportButton() {
        FrameLayout f = new FrameLayout(this);
        f.setLayoutParams(new LinearLayout.LayoutParams(dp(42), dp(40)));
        f.setBackgroundResource(android.R.drawable.list_selector_background);
        f.setContentDescription(tr("support_desk"));
        TextView ic = new TextView(this);
        ic.setText("🎧");
        ic.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        ic.setGravity(Gravity.CENTER);
        f.addView(ic, new FrameLayout.LayoutParams(-1, -1));
        supportBadge = new TextView(this);
        supportBadge.setTextColor(Color.WHITE);
        supportBadge.setTextSize(TypedValue.COMPLEX_UNIT_SP, 10);
        supportBadge.setTypeface(Typeface.DEFAULT_BOLD);
        supportBadge.setGravity(Gravity.CENTER);
        GradientDrawable bb = new GradientDrawable();
        bb.setColor(Color.parseColor("#E53935"));
        bb.setCornerRadius(dp(99));
        supportBadge.setBackground(bb);
        supportBadge.setPadding(dp(4), 0, dp(4), 0);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(-2, dp(16), Gravity.TOP | Gravity.END);
        lp.setMargins(0, dp(2), dp(2), 0);
        supportBadge.setMinWidth(dp(16));
        f.addView(supportBadge, lp);
        int n = authPrefs().getInt("support_unread", 0);
        supportBadge.setText(n > 9 ? "9+" : String.valueOf(n));
        supportBadge.setVisibility(n > 0 ? View.VISIBLE : View.GONE);
        f.setOnClickListener(v -> showSupportList("all"));
        return f;
    }

    private void refreshSupportBadge() {
        if (sessionToken() == null) return;
        refreshNotify();
    }

    private TextView chip(String text, String bg, String fg) {
        TextView c = infoLine(text, 11, fg, true);
        c.setPadding(dp(8), dp(3), dp(8), dp(3));
        GradientDrawable g = new GradientDrawable();
        g.setColor(Color.parseColor(bg));
        g.setCornerRadius(dp(99));
        c.setBackground(g);
        return c;
    }

    private TextView statusChip(String status) {
        if ("answered".equals(status)) return chip(tr("st_answered"), "#E6F4EA", "#2E7D32");
        if ("closed".equals(status)) return chip(tr("st_closed"), "#EEEEEE", "#616161");
        return chip(tr("st_open"), "#FFF4E5", "#B26A00");
    }

    private static String stars(int n) {
        StringBuilder sb = new StringBuilder();
        for (int i = 1; i <= 5; i++) sb.append(i <= n ? "★" : "☆");
        return sb.toString();
    }

    // ---------- Support desk look: hero banner with vivo BI logo, cards, status accents ----------
    private static final int NAVY = Color.parseColor("#1B1F5E");
    private static final String[] TOPIC_ICONS = {"🏠", "🏆", "📈", "📱", "👥", "🎧", "🎯", "🧮", "💹", "🚶", "⚔️", "🔔", "💰", "⚠️", "🛠️", "💬"};

    private String topicIcon(String topic) {
        for (int i = 0; i < SUPPORT_TOPICS.length; i++) if (SUPPORT_TOPICS[i].equals(topic)) return TOPIC_ICONS[i];
        return "💬";
    }

    private static String statusColor(String st) {
        return "answered".equals(st) ? "#1E9E61" : "closed".equals(st) ? "#9E9E9E" : "#E69A00";
    }

    // Gradient banner: back arrow, white logo card, headset badge, title and subtitle.
    private LinearLayout supportHero(String title, String subtitle, Runnable back) {
        LinearLayout hero = new LinearLayout(this);
        hero.setOrientation(LinearLayout.VERTICAL);
        hero.setPadding(dp(14), dp(10), dp(16), dp(20));
        GradientDrawable g = new GradientDrawable(GradientDrawable.Orientation.TL_BR,
                new int[]{NAVY, Color.parseColor("#3A3FB8"), BRAND2});
        hero.setBackground(g);

        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);
        TextView arrow = infoLine("←", 24, "#FFFFFF", false);
        arrow.setPadding(dp(4), 0, dp(12), 0);
        arrow.setOnClickListener(v -> back.run());
        top.addView(arrow);
        FrameLayout logoCard = new FrameLayout(this);
        GradientDrawable lc = new GradientDrawable();
        lc.setColor(Color.WHITE);
        lc.setCornerRadius(dp(10));
        logoCard.setBackground(lc);
        logoCard.setPadding(dp(8), dp(5), dp(8), dp(5));
        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.brand_logo);
        logo.setAdjustViewBounds(true);
        logoCard.addView(logo, new FrameLayout.LayoutParams(-2, dp(28)));
        top.addView(logoCard);
        top.addView(new View(this), new LinearLayout.LayoutParams(0, 1, 1f));
        TextView badge = infoLine("🎧", 22, "#FFFFFF", false);
        badge.setGravity(Gravity.CENTER);
        GradientDrawable bb = new GradientDrawable();
        bb.setShape(GradientDrawable.OVAL);
        bb.setColor(Color.parseColor("#33FFFFFF"));
        badge.setBackground(bb);
        top.addView(badge, new LinearLayout.LayoutParams(dp(44), dp(44)));
        hero.addView(top);

        TextView t = infoLine(title, 21, "#FFFFFF", true);
        t.setPadding(0, dp(14), 0, dp(2));
        hero.addView(t);
        if (subtitle != null && !subtitle.isEmpty()) hero.addView(infoLine(subtitle, 13, "#DCDDFB", false));
        return hero;
    }

    private LinearLayout sectionCard(LinearLayout parent, String title) {
        LinearLayout c = listCard();
        if (title != null) {
            TextView h = infoLine(title, 13, "#3D47C8", true);
            h.setPadding(0, 0, 0, dp(6));
            c.addView(h);
        }
        parent.addView(c, listCardParams());
        return c;
    }

    private TextView miniStat(String value, String label, String color) {
        TextView t = new TextView(this);
        t.setText(value + "\n" + label);
        t.setGravity(Gravity.CENTER);
        t.setTextColor(Color.parseColor(color));
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setPadding(dp(6), dp(10), dp(6), dp(10));
        GradientDrawable g = new GradientDrawable();
        g.setColor(Color.WHITE);
        g.setCornerRadius(dp(12));
        g.setStroke(dp(1), Color.parseColor("#E6E8F0"));
        t.setBackground(g);
        return t;
    }

    private View statusAccentCard(LinearLayout inner, String status) {
        LinearLayout outer = new LinearLayout(this);
        outer.setOrientation(LinearLayout.HORIZONTAL);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.WHITE);
        bg.setCornerRadius(dp(12));
        bg.setStroke(dp(1), Color.parseColor("#E6E8F0"));
        outer.setBackground(bg);
        outer.setClipToOutline(true);
        View strip = new View(this);
        strip.setBackgroundColor(Color.parseColor(statusColor(status)));
        outer.addView(strip, new LinearLayout.LayoutParams(dp(4), -1));
        inner.setPadding(dp(12), dp(12), dp(14), dp(12));
        outer.addView(inner, new LinearLayout.LayoutParams(0, -2, 1f));
        return outer;
    }

    private void showSupportList(String filter) {
        inProfile = true;
        unlocked = false;
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackgroundColor(Color.parseColor("#F3F4F9"));
        page.setPadding(0, 0, 0, dp(24));
        page.addView(supportHero(tr("support_desk"), tr(STATE_APP ? "support_intro_state" : "support_intro_admin"), this::openDashboard));

        LinearLayout stats = new LinearLayout(this);
        stats.setOrientation(LinearLayout.HORIZONTAL);
        stats.setPadding(dp(11), dp(12), dp(11), dp(2));
        page.addView(stats);

        Button raise = authButton("＋  " + tr("raise_query"));
        LinearLayout.LayoutParams rlp = new LinearLayout.LayoutParams(-1, dp(50));
        rlp.setMargins(dp(14), dp(10), dp(14), dp(6));
        raise.setOnClickListener(v -> showNewTicket());
        page.addView(raise, rlp);

        String[] keys = {"all", "mine", "open", "answered", "closed"};
        int sel = Math.max(0, java.util.Arrays.asList(keys).indexOf(filter));
        page.addView(segmented(new String[]{tr("f_all"), tr("f_mine"), tr("st_open"), tr("st_answered"), tr("st_closed")}, sel, i -> showSupportList(keys[i])));
        TextView count = infoLine(tr("loading"), 13, "#7A7F99", false);
        count.setPadding(dp(18), dp(2), dp(18), dp(4));
        page.addView(count);
        LinearLayout list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        page.addView(list);
        showScreen(page, null);

        callAuth(sessionBody("action", "support-list"), (ok, res, err) -> {
            if (!ok) { count.setText(err); if (res.optBoolean("loggedOut", false)) handleSessionError(res, err); return; }
            org.json.JSONArray ts = res.optJSONArray("tickets");
            int shown = 0, unread = 0, nOpen = 0, nAns = 0, nClosed = 0;
            for (int i = 0; ts != null && i < ts.length(); i++) {
                JSONObject tk = ts.optJSONObject(i);
                String st = tk.optString("status");
                if ("open".equals(st)) nOpen++; else if ("answered".equals(st)) nAns++; else nClosed++;
                if (tk.optBoolean("unread")) unread++;
                if ("mine".equals(filter) && !tk.optBoolean("mine")) continue;
                if (("open".equals(filter) || "answered".equals(filter) || "closed".equals(filter)) && !filter.equals(st)) continue;
                shown++;
                LinearLayout c = new LinearLayout(this);
                c.setOrientation(LinearLayout.VERTICAL);
                LinearLayout top = new LinearLayout(this);
                top.setOrientation(LinearLayout.HORIZONTAL);
                top.setGravity(Gravity.CENTER_VERTICAL);
                TextView tic = infoLine(topicIcon(tk.optString("topic")), 16, "#000000", false);
                tic.setGravity(Gravity.CENTER);
                GradientDrawable tg = new GradientDrawable();
                tg.setColor(Color.parseColor("#EEF0FF"));
                tg.setCornerRadius(dp(9));
                tic.setBackground(tg);
                top.addView(tic, new LinearLayout.LayoutParams(dp(32), dp(32)));
                TextView no = infoLine((tk.optBoolean("unread") ? "● " : "") + "#" + tk.optInt("no") + " · " + tk.optString("topic"), 12,
                        tk.optBoolean("unread") ? "#E53935" : "#3D47C8", true);
                no.setPadding(dp(8), 0, 0, 0);
                top.addView(no, new LinearLayout.LayoutParams(0, -2, 1f));
                top.addView(statusChip(st));
                c.addView(top);
                TextView subj = infoLine(tk.optString("subject"), 16, "#141833", true);
                subj.setPadding(0, dp(8), 0, dp(2));
                c.addView(subj);
                JSONObject by = tk.optJSONObject("by");
                c.addView(infoLine(by == null ? "" : by.optString("fullName") + (tk.optString("state").isEmpty() ? "" : "  ·  " + tk.optString("state")), 13, "#4A4F6A", false));
                JSONObject last = tk.optJSONObject("last");
                if (last != null && !last.optString("text").isEmpty()) {
                    JSONObject lb = last.optJSONObject("by");
                    String who = lb == null ? "" : ("admin".equals(lb.optString("app")) ? "🛡 " : "") + lb.optString("fullName") + ": ";
                    TextView prev = infoLine(who + last.optString("text"), 13, "#4A4F6A", false);
                    prev.setMaxLines(2);
                    prev.setEllipsize(TextUtils.TruncateAt.END);
                    prev.setPadding(0, dp(4), 0, 0);
                    c.addView(prev);
                }
                String meta = "💬 " + tk.optInt("count") + "   ·   " + fmtTime(tk.optLong("updatedAt"), "d MMM, h:mm a");
                TextView m = infoLine(meta, 12, "#7A7F99", false);
                m.setPadding(0, dp(6), 0, 0);
                if (tk.optInt("rating") > 0) m.append("   ·   " + stars(tk.optInt("rating")));
                c.addView(m);
                final String id = tk.optString("id");
                View card = statusAccentCard(c, st);
                card.setOnClickListener(v -> showTicket(id));
                list.addView(card, listCardParams());
            }
            stats.removeAllViews();
            String[][] s3 = {{String.valueOf(nOpen), tr("st_open"), "#E69A00"}, {String.valueOf(nAns), tr("st_answered"), "#1E9E61"}, {String.valueOf(nClosed), tr("st_closed"), "#616161"}};
            for (String[] x : s3) {
                LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, -2, 1f);
                lp.setMargins(dp(3), 0, dp(3), 0);
                stats.addView(miniStat(x[0], x[1], x[2]), lp);
            }
            authPrefs().edit().putInt("support_unread", unread).apply();
            if (shown == 0) {
                count.setText("");
                LinearLayout empty = new LinearLayout(this);
                empty.setOrientation(LinearLayout.VERTICAL);
                empty.setGravity(Gravity.CENTER_HORIZONTAL);
                empty.setPadding(dp(20), dp(30), dp(20), dp(20));
                TextView big = infoLine("🎧", 40, "#000000", false);
                big.setGravity(Gravity.CENTER);
                GradientDrawable eg = new GradientDrawable();
                eg.setShape(GradientDrawable.OVAL);
                eg.setColor(Color.parseColor("#EEF0FF"));
                big.setBackground(eg);
                empty.addView(big, new LinearLayout.LayoutParams(dp(84), dp(84)));
                TextView et = infoLine(tr("no_queries"), 15, "#4A4F6A", false);
                et.setPadding(0, dp(12), 0, 0);
                empty.addView(et);
                list.addView(empty);
            } else count.setText(trf("queries_count", shown));
        });
    }

    private void addAttachRow(LinearLayout box, Button attachBtn) {
        LinearLayout attList = new LinearLayout(this);
        attList.setOrientation(LinearLayout.VERTICAL);
        box.addView(attList);
        onAttachChanged = () -> {
            attList.removeAllViews();
            for (int i = 0; i < pendingAtts.size(); i++) {
                JSONObject a = pendingAtts.get(i);
                final int idx = i;
                LinearLayout r = new LinearLayout(this);
                r.setOrientation(LinearLayout.HORIZONTAL);
                r.setGravity(Gravity.CENTER_VERTICAL);
                r.setPadding(dp(10), dp(8), dp(8), dp(8));
                GradientDrawable g = new GradientDrawable();
                g.setColor(Color.parseColor("#F5F6FA"));
                g.setCornerRadius(dp(8));
                r.setBackground(g);
                r.addView(infoLine("📎 " + a.optString("name") + "  (" + Math.max(1, a.optLong("size") / 1024) + " KB)", 13, "#333344", false),
                        new LinearLayout.LayoutParams(0, -2, 1f));
                TextView x = infoLine("✕", 16, "#C62828", true);
                x.setPadding(dp(10), 0, dp(4), 0);
                x.setOnClickListener(v -> { pendingAtts.remove(idx); onAttachChanged.run(); });
                r.addView(x);
                LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
                lp.topMargin = dp(6);
                attList.addView(r, lp);
            }
            attachBtn.setText("📎  " + tr("attach") + (pendingAtts.isEmpty() ? "" : " (" + pendingAtts.size() + "/5)"));
        };
        onAttachChanged.run();
        attachBtn.setOnClickListener(v -> pickAttachment());
    }

    private Button plainButton(String text) {
        Button b = new Button(this);
        b.setText(text);
        b.setAllCaps(false);
        b.setTextColor(BRAND);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.parseColor("#F7F8FF"));
        bg.setCornerRadius(dp(10));
        bg.setStroke(dp(1), Color.parseColor("#9AA1F5"), dp(6), dp(4));
        b.setBackground(bg);
        return b;
    }

    private String selectedTopic = "";

    private void showNewTicket() {
        inProfile = true;
        pendingAtts.clear();
        selectedTopic = "";
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackgroundColor(Color.parseColor("#F3F4F9"));
        page.setPadding(0, 0, 0, dp(28));
        page.addView(supportHero(tr("raise_query"), tr("raise_sub"), () -> showSupportList("all")));

        // 1. Topic chips (2 columns)
        LinearLayout c1 = sectionCard(page, "1  ·  " + tr("q_topic"));
        List<TextView> chips = new ArrayList<>();
        LinearLayout row = null;
        for (int i = 0; i < SUPPORT_TOPICS.length; i++) {
            if (i % 2 == 0) {
                row = new LinearLayout(this);
                row.setOrientation(LinearLayout.HORIZONTAL);
                c1.addView(row);
            }
            final String topic = SUPPORT_TOPICS[i];
            TextView ch = infoLine(TOPIC_ICONS[i] + "  " + topic, 13, "#333344", false);
            ch.setSingleLine(true);
            ch.setEllipsize(TextUtils.TruncateAt.END);
            ch.setPadding(dp(10), dp(10), dp(8), dp(10));
            chips.add(ch);
            ch.setOnClickListener(v -> {
                selectedTopic = topic;
                for (TextView o : chips) styleTopicChip(o, false);
                styleTopicChip(ch, true);
            });
            styleTopicChip(ch, false);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, -2, 1f);
            lp.setMargins(dp(3), dp(3), dp(3), dp(3));
            row.addView(ch, lp);
        }

        // 2. Details
        LinearLayout c2 = sectionCard(page, "2  ·  " + tr("q_details"));
        c2.addView(fieldLabel(tr("q_kpi")));
        Spinner kpi = stateSpinner(withBlank("—", SUPPORT_KPIS, null), "");
        addField(c2, kpi);
        Spinner st = null;
        c2.addView(fieldLabel(tr("q_state")));
        if (STATE_APP) {
            TextView own = infoLine("📍 " + profile().optString("state", "—") + "   🔒", 15, "#141833", true);
            own.setPadding(dp(6), dp(4), 0, dp(10));
            c2.addView(own);
        } else {
            st = stateSpinner(withBlank("PAN India", dashboardStates(), null), "");
            addField(c2, st);
        }
        final Spinner stSel = st;
        c2.addView(fieldLabel(tr("q_subject")));
        EditText subject = authField(tr("q_subject_hint"), TEXT_NAME, 120);
        addField(c2, subject);
        c2.addView(fieldLabel(tr("q_details")));
        EditText details = authField(tr("q_details_hint"), InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES, 4000);
        details.setSingleLine(false);
        details.setMinLines(4);
        details.setGravity(Gravity.TOP | Gravity.START);
        addField(c2, details);

        // 3. Attachments
        LinearLayout c3 = sectionCard(page, "3  ·  " + tr("attachments_opt"));
        Button attach = plainButton("📎  " + tr("attach"));
        c3.addView(attach, new LinearLayout.LayoutParams(-1, dp(48)));
        addAttachRow(c3, attach);
        TextView note = infoLine(tr("attach_note"), 12, "#7A7F99", false);
        note.setPadding(0, dp(6), 0, 0);
        c3.addView(note);

        LinearLayout foot = new LinearLayout(this);
        foot.setOrientation(LinearLayout.VERTICAL);
        foot.setPadding(dp(14), dp(4), dp(14), 0);
        tcStatus = authMsg(foot);
        Button send = authButton(tr("submit_query"));
        foot.addView(send, buttonParams());
        page.addView(foot);
        send.setOnClickListener(v -> {
            String sj = subject.getText().toString().trim(), dt = details.getText().toString().trim();
            if (selectedTopic.isEmpty()) { setStatus(tr("err_topic"), true); return; }
            if (sj.length() < 3) { setStatus(tr("err_subject"), true); return; }
            if (dt.isEmpty()) { setStatus(tr("err_details"), true); return; }
            hideKeyboard(details);
            busy(send, tr("saving"));
            org.json.JSONArray ids = new org.json.JSONArray();
            for (JSONObject a : pendingAtts) ids.put(a.optString("id"));
            String stVal = stSel == null ? profile().optString("state", "") : (String) stSel.getSelectedItem();
            callAuth(sessionBody("action", "support-create", "topic", selectedTopic,
                    "kpi", kpi.getSelectedItemPosition() == 0 ? "" : (String) kpi.getSelectedItem(),
                    "state", stVal, "subject", sj, "text", dt, "atts", ids), (ok, res, err) -> {
                busy(send, null);
                if (ok) {
                    pendingAtts.clear();
                    Toast.makeText(this, tr("query_sent"), Toast.LENGTH_SHORT).show();
                    showTicket(res.optJSONObject("ticket").optString("id"));
                } else handleSessionError(res, err);
            });
        });
        showScreen(page, null);
    }

    private void styleTopicChip(TextView ch, boolean on) {
        GradientDrawable g = new GradientDrawable();
        g.setCornerRadius(dp(10));
        if (on) {
            g.setColor(Color.parseColor("#EEF0FF"));
            g.setStroke(dp(2), BRAND);
            ch.setTextColor(Color.parseColor("#2B33A6"));
            ch.setTypeface(Typeface.DEFAULT_BOLD);
        } else {
            g.setColor(Color.parseColor("#F7F8FC"));
            g.setStroke(dp(1), Color.parseColor("#E1E3EE"));
            ch.setTextColor(Color.parseColor("#333344"));
            ch.setTypeface(Typeface.DEFAULT);
        }
        ch.setBackground(g);
    }

    // Big, evenly spaced stars for the requester to rate an admin reply.
    private LinearLayout ratingCard(String ticketId, String msgId, int given) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(14), dp(12), dp(14), dp(12));
        GradientDrawable g = new GradientDrawable();
        g.setColor(Color.parseColor("#FFFBF0"));
        g.setCornerRadius(dp(14));
        g.setStroke(dp(1), Color.parseColor("#F5D58A"));
        card.setBackground(g);
        TextView q = infoLine(given > 0 ? trf("you_rated", given) : tr("rate_question"), 14, "#5C4300", true);
        q.setGravity(Gravity.CENTER);
        card.addView(q);
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setPadding(0, dp(6), 0, dp(2));
        for (int s = 1; s <= 5; s++) {
            final int sv = s;
            TextView star = infoLine(s <= given ? "★" : "☆", 32, "#F5A623", false);
            star.setGravity(Gravity.CENTER);
            star.setContentDescription(s + " star");
            star.setOnClickListener(v -> callAuth(sessionBody("action", "support-rate", "id", ticketId, "msgId", msgId, "stars", sv), (ok, res, err) -> {
                if (ok) {
                    Toast.makeText(this, res.optBoolean("autoClosed") ? tr("rated_closed") : tr("rated_open"), Toast.LENGTH_LONG).show();
                    showTicket(ticketId);
                } else Toast.makeText(this, err, Toast.LENGTH_LONG).show();
            }));
            row.addView(star, new LinearLayout.LayoutParams(0, dp(48), 1f));
        }
        card.addView(row);
        TextView hint = infoLine(tr("rate_hint"), 11, "#8A6D1F", false);
        hint.setGravity(Gravity.CENTER);
        card.addView(hint);
        return card;
    }

    private void showTicket(String id) {
        inProfile = true;
        pendingAtts.clear();
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackgroundColor(Color.parseColor("#F3F4F9"));
        page.setPadding(0, 0, 0, dp(24));
        LinearLayout heroHolder = new LinearLayout(this);
        heroHolder.setOrientation(LinearLayout.VERTICAL);
        heroHolder.addView(supportHero(tr("query"), "", () -> showSupportList("all")));
        page.addView(heroHolder);
        TextView loading = infoLine(tr("loading"), 13, "#7A7F99", false);
        loading.setPadding(dp(18), dp(10), dp(18), dp(6));
        page.addView(loading);
        showScreen(page, null);

        callAuth(sessionBody("action", "support-get", "id", id), (ok, res, err) -> {
            if (!ok) { loading.setText(err); if (res.optBoolean("loggedOut", false)) handleSessionError(res, err); return; }
            page.removeView(loading);
            refreshSupportBadge();
            JSONObject tk = res.optJSONObject("ticket");
            boolean canRate = res.optBoolean("canRate");
            JSONObject owner = tk.optJSONObject("by");
            heroHolder.removeAllViews();
            heroHolder.addView(supportHero("#" + tk.optInt("no") + "  " + tk.optString("subject"),
                    topicIcon(tk.optString("topic")) + " " + tk.optString("topic") + (tk.optString("kpi").isEmpty() ? "" : " · " + tk.optString("kpi")),
                    () -> showSupportList("all")));

            LinearLayout head = listCard();
            LinearLayout top = new LinearLayout(this);
            top.setOrientation(LinearLayout.HORIZONTAL);
            top.setGravity(Gravity.CENTER_VERTICAL);
            top.addView(infoLine("📍 " + (tk.optString("state").isEmpty() ? "PAN India" : tk.optString("state")), 13, "#3D47C8", true), new LinearLayout.LayoutParams(0, -2, 1f));
            top.addView(statusChip(tk.optString("status")));
            head.addView(top);
            head.addView(infoLine(tr("raised_by") + " " + owner.optString("fullName") + " (@" + owner.optString("username") + ")\n"
                    + fmtTime(tk.optLong("createdAt"), "d MMM yyyy, h:mm a"), 12, "#4A4F6A", false));
            LinearLayout.LayoutParams hlp = listCardParams();
            hlp.topMargin = dp(10);
            page.addView(head, hlp);

            org.json.JSONArray ms = tk.optJSONArray("messages");
            for (int i = 0; ms != null && i < ms.length(); i++) {
                JSONObject m = ms.optJSONObject(i);
                JSONObject by = m.optJSONObject("by");
                boolean admin = by != null && "admin".equals(by.optString("app"));
                LinearLayout bub = new LinearLayout(this);
                bub.setOrientation(LinearLayout.VERTICAL);
                bub.setPadding(dp(14), dp(10), dp(14), dp(10));
                GradientDrawable bg = new GradientDrawable();
                bg.setColor(Color.parseColor(admin ? "#EEF0FF" : "#FFFFFF"));
                bg.setCornerRadii(admin ? new float[]{dp(4), dp(4), dp(14), dp(14), dp(14), dp(14), dp(14), dp(14)}
                        : new float[]{dp(14), dp(14), dp(4), dp(4), dp(14), dp(14), dp(14), dp(14)});
                bg.setStroke(dp(1), Color.parseColor(admin ? "#C9CDF7" : "#E6E8F0"));
                bub.setBackground(bg);
                bub.addView(infoLine((admin ? "🛡 " + tr("bi_admin") + " · " : "👤 ") + by.optString("fullName")
                        + (by.optString("state").isEmpty() || admin ? "" : " · " + by.optString("state")), 13, admin ? "#2B33A6" : "#141833", true));
                if (!m.optString("text").isEmpty()) {
                    TextView tx = infoLine(m.optString("text"), 15, "#141833", false);
                    tx.setTextIsSelectable(true);
                    tx.setPadding(0, dp(4), 0, dp(2));
                    bub.addView(tx);
                }
                org.json.JSONArray atts = m.optJSONArray("atts");
                for (int k = 0; atts != null && k < atts.length(); k++) {
                    JSONObject a = atts.optJSONObject(k);
                    TextView at = infoLine("📎 " + a.optString("name") + "  (" + Math.max(1, a.optLong("size") / 1024) + " KB)  ⬇", 14, "#2B33A6", false);
                    at.setPadding(dp(10), dp(8), dp(10), dp(8));
                    GradientDrawable ag = new GradientDrawable();
                    ag.setColor(Color.WHITE);
                    ag.setCornerRadius(dp(8));
                    ag.setStroke(dp(1), Color.parseColor("#DADCF5"));
                    at.setBackground(ag);
                    final String aid = a.optString("id");
                    at.setOnClickListener(v -> downloadAttachment(aid, id));
                    LinearLayout.LayoutParams alp = new LinearLayout.LayoutParams(-1, -2);
                    alp.topMargin = dp(6);
                    bub.addView(at, alp);
                }
                TextView when = infoLine(fmtTime(m.optLong("ts"), "d MMM, h:mm a"), 11, "#7A7F99", false);
                when.setPadding(0, dp(4), 0, 0);
                bub.addView(when);
                JSONObject rt = admin ? m.optJSONObject("rating") : null;
                int given = rt == null ? 0 : rt.optInt("stars");
                if (admin && !canRate && given > 0) {
                    // Admins (and others) see the requester's rating on the reply.
                    bub.addView(infoLine("⭐ " + tr("rated") + " " + stars(given) + "  (" + given + "/5)", 13, "#B07A00", true));
                }
                LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(-1, -2);
                blp.setMargins(admin ? dp(30) : dp(14), dp(6), admin ? dp(14) : dp(30), dp(4));
                page.addView(bub, blp);
                if (admin && canRate) {
                    LinearLayout.LayoutParams rlp = new LinearLayout.LayoutParams(-1, -2);
                    rlp.setMargins(dp(30), dp(2), dp(14), dp(8));
                    page.addView(ratingCard(id, m.optString("id"), given), rlp);
                }
            }

            // Reply box
            LinearLayout box = listCard();
            box.addView(infoLine(tr(STATE_APP ? "add_comment" : "write_reply"), 13, "#3D47C8", true));
            EditText reply = authField(tr(STATE_APP ? "add_comment" : "write_reply"),
                    InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES, 4000);
            reply.setSingleLine(false);
            reply.setMinLines(2);
            reply.setGravity(Gravity.TOP | Gravity.START);
            LinearLayout.LayoutParams rlp2 = new LinearLayout.LayoutParams(-1, -2);
            rlp2.topMargin = dp(6);
            box.addView(reply, rlp2);
            Button attach = plainButton("📎  " + tr("attach"));
            LinearLayout.LayoutParams alp = new LinearLayout.LayoutParams(-1, dp(46));
            alp.topMargin = dp(8);
            box.addView(attach, alp);
            addAttachRow(box, attach);
            tcStatus = authMsg(box);
            Button send = authButton(tr(STATE_APP ? "send" : "send_reply"));
            box.addView(send, buttonParams());
            send.setOnClickListener(v -> {
                String t = reply.getText().toString().trim();
                if (t.isEmpty() && pendingAtts.isEmpty()) { setStatus(tr("err_reply"), true); return; }
                hideKeyboard(reply);
                busy(send, tr("saving"));
                org.json.JSONArray ids = new org.json.JSONArray();
                for (JSONObject a : pendingAtts) ids.put(a.optString("id"));
                callAuth(sessionBody("action", "support-reply", "id", id, "text", t, "atts", ids), (ok2, r2, e2) -> {
                    busy(send, null);
                    if (ok2) { pendingAtts.clear(); showTicket(id); }
                    else handleSessionError(r2, e2);
                });
            });
            if (!STATE_APP || canRate) {
                boolean closed = "closed".equals(tk.optString("status"));
                box.addView(linkText(closed ? tr("reopen") : tr("mark_closed"), v ->
                        callAuth(sessionBody("action", "support-status", "id", id, "status", closed ? "open" : "closed"), (ok2, r2, e2) -> {
                            if (ok2) showTicket(id); else Toast.makeText(this, e2, Toast.LENGTH_LONG).show();
                        })));
            }
            LinearLayout.LayoutParams blp2 = listCardParams();
            blp2.topMargin = dp(12);
            page.addView(box, blp2);
        });
    }

    private void pickAttachment() {
        if (pendingAtts.size() >= 5) { Toast.makeText(this, tr("max_files"), Toast.LENGTH_SHORT).show(); return; }
        Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
        pick.addCategory(Intent.CATEGORY_OPENABLE);
        pick.setType("*/*");
        pick.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/pdf", "application/vnd.ms-excel",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/csv", "text/plain", "application/msword",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.ms-powerpoint",
                "application/vnd.openxmlformats-officedocument.presentationml.presentation", "image/*"});
        try {
            startActivityForResult(Intent.createChooser(pick, tr("attach")), ATTACH_REQUEST);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, tr("photo_failed"), Toast.LENGTH_SHORT).show();
        }
    }

    private void uploadAttachment(Uri uri) {
        String name = "file";
        try (android.database.Cursor c = getContentResolver().query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int i = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);
                if (i >= 0) name = c.getString(i);
            }
        } catch (Exception ignored) { }
        if (!name.contains(".")) {
            String mime = getContentResolver().getType(uri);
            String ext = mime == null ? null : android.webkit.MimeTypeMap.getSingleton().getExtensionFromMimeType(mime);
            if (ext != null) name = name + "." + ext;
        }
        final String fname = name;
        Toast.makeText(this, tr("uploading") + " " + fname, Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            String b64 = null, problem = null;
            try (InputStream in = getContentResolver().openInputStream(uri)) {
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                byte[] buf = new byte[16384];
                int n;
                while (in != null && (n = in.read(buf)) > 0) {
                    bos.write(buf, 0, n);
                    if (bos.size() > MAX_ATTACH_BYTES) { problem = tr("file_too_big"); break; }
                }
                if (problem == null) b64 = Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP);
            } catch (Exception e) {
                problem = tr("photo_failed");
            }
            final String data = b64, prob = problem;
            ui.post(() -> {
                if (prob != null) { Toast.makeText(this, prob, Toast.LENGTH_LONG).show(); return; }
                callAuth(sessionBody("action", "support-upload", "name", fname, "data", data), (ok, res, err) -> {
                    if (ok) {
                        pendingAtts.add(res.optJSONObject("att"));
                        if (onAttachChanged != null) onAttachChanged.run();
                    } else Toast.makeText(this, err, Toast.LENGTH_LONG).show();
                });
            });
        }).start();
    }

    private void downloadAttachment(String aid, String ticketId) {
        Toast.makeText(this, tr("downloading"), Toast.LENGTH_SHORT).show();
        callAuth(sessionBody("action", "support-att", "id", aid, "ticketId", ticketId), (ok, res, err) -> {
            if (!ok) { Toast.makeText(this, err, Toast.LENGTH_LONG).show(); return; }
            String data = res.optString("data"), name = res.optString("name", "attachment"), mime = res.optString("mime", "");
            new Thread(() -> new DownloadBridge().save(data, name, mime)).start();
        });
    }

    // ---------- Admin app: insights page (access logs + support desk analytics) ----------
    private WebView adminWeb;
    private boolean inAdminPage = false;

    private class AdminBridge {
        @JavascriptInterface
        public String getAuth() {
            if (STATE_APP) return "{}";
            return obj("username", sessionUser(), "token", sessionToken()).toString();
        }
    }

    private void showAdminPage(String tab) {
        if (STATE_APP) return;
        inProfile = true;
        unlocked = false;
        inAdminPage = true;
        if (adminWeb == null) {
            adminWeb = new WebView(this);
            WebSettings ws = adminWeb.getSettings();
            ws.setJavaScriptEnabled(true);
            ws.setDomStorageEnabled(true);
            adminWeb.addJavascriptInterface(new AdminBridge(), "BIApp");
            adminWeb.addJavascriptInterface(new DownloadBridge(), "AndroidDL");
            adminWeb.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    Uri u = request.getUrl();
                    if (u.getHost() != null && u.getHost().endsWith(APP_HOST)) return false;
                    openExternally(u);
                    return true;
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                    super.onPageFinished(view, url);
                    view.evaluateJavascript(DOWNLOAD_HOOK_JS, null);
                }
            });
            adminWeb.setDownloadListener((url, ua, cd, mime, len) -> {
                if (url.startsWith("blob:") || url.startsWith("data:")) {
                    String name = URLUtil.guessFileName(url, cd, mime);
                    adminWeb.evaluateJavascript("window.__bidlSend&&window.__bidlSend(" + JSONObject.quote(url) + "," + JSONObject.quote(name) + ")", null);
                }
            });
        }
        if (adminWeb.getParent() != null) ((ViewGroup) adminWeb.getParent()).removeView(adminWeb);
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackgroundColor(Color.parseColor("#F3F4F9"));
        page.addView(profileHeaderBar(tr("admin_insights"), () -> { inAdminPage = false; showProfile(); }));
        page.addView(adminWeb, new LinearLayout.LayoutParams(-1, 0, 1f));
        detachWebView();
        setContentView(page);
        adminWeb.loadUrl(START_URL + "admin.html?v=" + System.currentTimeMillis() + "#" + tab);
    }

    // ---------- Surveys (survey.html, shared with the web; admins build, state users answer) ----------
    private WebView surveyWeb;
    private boolean inSurveyPage = false;
    private TextView surveyBadge, chatBadge, toolsBadge;
    private String toolFile = null;
    private boolean toolFromHub = false;
    private long lastNotify = 0;

    private class SurveyBridge {
        @JavascriptInterface
        public String getAuth() { return obj("app", APP_ID, "username", sessionUser(), "token", sessionToken()).toString(); }

        @JavascriptInterface
        public void surveysChanged() { ui.post(MainActivity.this::refreshNotify); }

        // The All-tools hub opens other shared pages, or screens that are native in the app.
        @JavascriptInterface
        public void openTool(String file, String title, String hash) {
            if (file == null || !file.matches("[a-z\\-]+\\.html")) return;
            ui.post(() -> showToolPage(file, title == null ? "" : title, hash == null || hash.isEmpty() ? "#list" : hash));
        }

        @JavascriptInterface
        public void nativeAction(String name) { ui.post(() -> doNative(name == null ? "" : name)); }

        // Partner portals (v6.4)
        @JavascriptInterface
        public String portalVersion() { return "1"; }

        @JavascriptInterface
        public void openPortal(String json) {
            try {
                JSONObject c = new JSONObject(json);
                String u = c.optString("url", "");
                if (!u.startsWith("https://") && !u.startsWith("http://")) return;
                ui.post(() -> showPortal(c));
            } catch (Exception ignored) { }
        }

        @JavascriptInterface
        public String saveCred(String id, String user, String pass) {
            if (id == null || !id.matches("[A-Za-z0-9_-]{1,40}") || pass == null || pass.isEmpty()) return "bad";
            return portalSave(id, user == null ? "" : user, pass) ? "ok" : "fail";
        }

        @JavascriptInterface
        public String hasCred(String id) {
            JSONObject c = id == null ? null : portalLoad(id);
            return c == null ? "" : c.optString("u", "");   // only the user name, never the password
        }

        @JavascriptInterface
        public void deleteCred(String id) { if (id != null) portalPrefs().edit().remove(portalPrefKey(id)).apply(); }
    }

    // ---------- Partner portals: partner websites inside the app, signed in automatically ----------
    // The user's partner password is stored only on this phone, encrypted with a key held in the Android Keystore,
    // and filled only into the partner's own web addresses. vivo's servers never see it.
    private WebView portalWeb;
    private boolean inPortal = false;
    private JSONObject portalCfg;
    private int portalAutoLeft = 1;

    private javax.crypto.SecretKey portalKey() throws Exception {
        java.security.KeyStore ks = java.security.KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (!ks.containsAlias("bi_portal_v1")) {
            javax.crypto.KeyGenerator kg = javax.crypto.KeyGenerator.getInstance(android.security.keystore.KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            kg.init(new android.security.keystore.KeyGenParameterSpec.Builder("bi_portal_v1",
                    android.security.keystore.KeyProperties.PURPOSE_ENCRYPT | android.security.keystore.KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256).build());
            kg.generateKey();
        }
        return ((java.security.KeyStore.SecretKeyEntry) ks.getEntry("bi_portal_v1", null)).getSecretKey();
    }
    private SharedPreferences portalPrefs() { return getSharedPreferences("portal_creds", MODE_PRIVATE); }
    private String portalPrefKey(String id) { return String.valueOf(sessionUser()).toLowerCase() + "|" + APP_ID + "|" + id; }
    private boolean portalSave(String id, String user, String pass) {
        try {
            javax.crypto.Cipher c = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding");
            c.init(javax.crypto.Cipher.ENCRYPT_MODE, portalKey());
            byte[] ct = c.doFinal(obj("u", user, "p", pass).toString().getBytes(StandardCharsets.UTF_8));
            portalPrefs().edit().putString(portalPrefKey(id), Base64.encodeToString(c.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP)).apply();
            return true;
        } catch (Throwable e) { return false; }
    }
    private JSONObject portalLoad(String id) {
        try {
            String s = portalPrefs().getString(portalPrefKey(id), null);
            if (s == null || !s.contains(":")) return null;
            String[] p = s.split(":", 2);
            javax.crypto.Cipher c = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding");
            c.init(javax.crypto.Cipher.DECRYPT_MODE, portalKey(), new javax.crypto.spec.GCMParameterSpec(128, Base64.decode(p[0], Base64.NO_WRAP)));
            return new JSONObject(new String(c.doFinal(Base64.decode(p[1], Base64.NO_WRAP)), StandardCharsets.UTF_8));
        } catch (Throwable e) { return null; }
    }
    private boolean portalHostOk(String url) {
        try {
            String h = Uri.parse(url).getHost(); if (h == null || portalCfg == null) return false;
            h = h.toLowerCase();
            org.json.JSONArray hs = portalCfg.optJSONArray("hosts");
            if (hs != null) for (int i = 0; i < hs.length(); i++) { String a = hs.optString(i, "").toLowerCase().replaceAll("^\\*\\.", ""); if (!a.isEmpty() && (h.equals(a) || h.endsWith("." + a))) return true; }
            String base = Uri.parse(portalCfg.optString("url")).getHost();
            return base != null && (h.equals(base.toLowerCase()) || h.endsWith("." + base.toLowerCase()));
        } catch (Throwable e) { return false; }
    }
    private static final String PORTAL_FILL_JS =
            "(function(c){try{" +
            "function vis(e){var r=e.getBoundingClientRect();var s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';}" +
            "function q(s){if(!s)return null;try{return document.querySelector(s);}catch(e){return null;}}" +
            "function set(el,v){var d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value')||Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');el.focus();d.set.call(el,v);" +
            "['input','change','keyup','blur'].forEach(function(t){el.dispatchEvent(new Event(t,{bubbles:true}));});}" +
            "function btn(scope){var b=q(c.ss);if(b)return b;var L=[].filter.call((scope||document).querySelectorAll('button,input[type=submit],a[role=button],[type=button]'),vis);" +
            "return L.filter(function(x){return /log ?in|sign ?in|submit|continue|next|proceed|login/i.test((x.innerText||x.value||'').trim());})[0]||(scope&&scope.querySelector&&scope.querySelector('button[type=submit],input[type=submit]'));}" +
            "var p=q(c.ps)||[].filter.call(document.querySelectorAll('input[type=password]'),vis)[0];" +
            "var ins=[].filter.call(document.querySelectorAll('input'),function(i){return vis(i)&&/^(text|email|tel|number|)$/i.test(i.type||'')&&!i.readOnly&&!i.disabled;});" +
            "var u=q(c.us);if(!u){var k=-1;ins.forEach(function(i,n){if(p&&(i.compareDocumentPosition(p)&4))k=n;});u=p?(k>=0?ins[k]:null):(c.two?ins[0]:null);}" +
            "if(!p&&!(c.two&&u))return 'none';" +
            "if(p&&p.value)return 'already';" +
            "if(u&&c.u&&!u.value)set(u,c.u);if(p)set(p,c.p);" +
            "if(c.auto){setTimeout(function(){var f=(p||u).form,b=btn(f);if(b)b.click();else if(f){if(f.requestSubmit)f.requestSubmit();else f.submit();}},500);return 'submitted';}" +
            "return 'filled';}catch(e){return 'err';}})";

    private void portalFill(boolean force) {
        if (portalWeb == null || portalCfg == null) return;
        String url = portalWeb.getUrl();
        if (url == null || !portalHostOk(url)) return;
        JSONObject cr = portalLoad(portalCfg.optString("id"));
        if (cr == null) return;
        JSONObject f = portalCfg.optJSONObject("fill"); if (f == null) f = new JSONObject();
        boolean auto = f.optBoolean("auto", true) && (portalAutoLeft > 0 || force);
        try {
            JSONObject c = new JSONObject().put("u", cr.optString("u")).put("p", cr.optString("p")).put("us", f.optString("us", "")).put("ps", f.optString("ps", ""))
                    .put("ss", f.optString("ss", "")).put("auto", auto).put("two", f.optBoolean("two", false));
            final WebView w = portalWeb;
            w.evaluateJavascript(PORTAL_FILL_JS + "(" + c + ")", v -> { if (v != null && v.contains("submitted")) portalAutoLeft--; });
        } catch (Exception ignored) { }
    }

    private void showPortal(JSONObject cfg) {
        if (sessionToken() == null) return;
        portalCfg = cfg;
        portalAutoLeft = 1;
        inPortal = true;
        inSurveyPage = false;
        if (portalWeb != null) { try { portalWeb.destroy(); } catch (Throwable ignored) { } }
        portalWeb = new WebView(this);
        WebSettings ws = portalWeb.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setLoadWithOverviewMode(true);
        ws.setUseWideViewPort(true);
        ws.setBuiltInZoomControls(true);
        ws.setDisplayZoomControls(false);
        ws.setSupportMultipleWindows(false);
        ws.setJavaScriptCanOpenWindowsAutomatically(true);
        ws.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        ws.setGeolocationEnabled(true);
        if (cfg.optBoolean("desktop", false)) ws.setUserAgentString(ws.getUserAgentString().replace("; wv", "").replace("Mobile ", ""));
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(portalWeb, true);
        final ProgressBar pb = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        pb.setMax(100);
        portalWeb.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl(); String s = u.getScheme();
                if ("http".equals(s) || "https".equals(s)) return false;   // partner pages, payment and bank pages stay in the app
                try {
                    if ("intent".equals(s)) { Intent it = Intent.parseUri(u.toString(), Intent.URI_INTENT_SCHEME); it.addCategory(Intent.CATEGORY_BROWSABLE); it.setComponent(null); it.setSelector(null); startActivity(it); return true; }
                } catch (Throwable e) { return true; }
                openExternally(u);   // upi:, tel:, mailto:, whatsapp: …
                return true;
            }
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                CookieManager.getInstance().flush();
                ui.postDelayed(() -> portalFill(false), 400);
                ui.postDelayed(() -> portalFill(false), 1800);
                ui.postDelayed(() -> portalFill(false), 4000);
            }
        });
        portalWeb.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int p) { pb.setProgress(p); pb.setVisibility(p >= 100 ? View.GONE : View.VISIBLE); }
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                boolean image = false;
                for (String t : params.getAcceptTypes()) if (t != null && t.startsWith("image")) image = true;
                if (image && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                    pendingImageChooser = true;
                    requestPermissions(new String[]{Manifest.permission.CAMERA}, CAM_PERM_REQUEST);
                    return true;
                }
                return launchFileChooser(image);
            }
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, android.webkit.GeolocationPermissions.Callback cb) {
                if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                        || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) { cb.invoke(origin, true, false); return; }
                geoOrigin = origin; geoCallback = cb;
                requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, GEO_REQUEST);
            }
        });
        portalWeb.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            if (url.startsWith("blob:") || url.startsWith("data:")) { Toast.makeText(this, "This file can't be saved from here — use ⋮ → Open in browser", Toast.LENGTH_LONG).show(); return; }
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
            } catch (Exception e) { openExternally(Uri.parse(url)); }
        });
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackgroundColor(Color.WHITE);
        LinearLayout bar = profileHeaderBar(cfg.optString("name", "Partner"), this::portalBack);
        View sp = new View(this); bar.addView(sp, new LinearLayout.LayoutParams(0, 1, 1f));
        TextView rel = new TextView(this); rel.setText("⟳"); rel.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22); rel.setPadding(dp(10), dp(4), dp(10), dp(4)); rel.setTextColor(Color.parseColor("#111111"));
        rel.setOnClickListener(v -> portalWeb.reload()); bar.addView(rel);
        TextView more = new TextView(this); more.setText("⋮"); more.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22); more.setPadding(dp(10), dp(4), dp(6), dp(4)); more.setTextColor(Color.parseColor("#111111"));
        more.setOnClickListener(v -> {
            String[] items = {"🔑 Sign in again", "🏠 Home page", "🌐 Open in browser", "🚪 Sign out of this site on this phone"};
            new AlertDialog.Builder(this).setItems(items, (d, which) -> {
                if (which == 0) { portalAutoLeft = 1; portalWeb.loadUrl(cfg.optString("url")); }
                else if (which == 1) portalWeb.loadUrl(cfg.optString("home", cfg.optString("url")));
                else if (which == 2) { String u = portalWeb.getUrl(); openExternally(Uri.parse(u == null ? cfg.optString("url") : u)); }
                else portalSignOut();
            }).show();
        });
        bar.addView(more);
        page.addView(bar);
        page.addView(pb, new LinearLayout.LayoutParams(-1, dp(3)));
        page.addView(portalWeb, new LinearLayout.LayoutParams(-1, 0, 1f));
        detachWebView();
        setContentView(page);
        String start = cfg.optString("url");
        if (portalLoad(cfg.optString("id")) == null && cfg.has("home") && !cfg.optString("home").isEmpty() && !cfg.optBoolean("sso", false)) start = cfg.optString("home");
        portalWeb.loadUrl(start);
    }
    private void portalSignOut() {
        try {
            CookieManager cm = CookieManager.getInstance();
            java.util.List<String> hosts = new java.util.ArrayList<>();
            hosts.add(Uri.parse(portalCfg.optString("url")).getHost());
            org.json.JSONArray hs = portalCfg.optJSONArray("hosts");
            if (hs != null) for (int i = 0; i < hs.length(); i++) hosts.add(hs.optString(i).replaceAll("^\\*\\.", ""));
            for (String h : hosts) {
                if (h == null || h.isEmpty()) continue;
                String ck = cm.getCookie("https://" + h);
                if (ck == null) continue;
                for (String part : ck.split(";")) { String n = part.split("=", 2)[0].trim(); if (n.isEmpty()) continue;
                    cm.setCookie("https://" + h, n + "=; Max-Age=0; Path=/"); cm.setCookie("https://" + h, n + "=; Max-Age=0; Path=/; Domain=." + h); }
            }
            cm.flush();
            portalWeb.clearCache(false);
            portalWeb.evaluateJavascript("try{localStorage.clear();sessionStorage.clear();}catch(e){}", null);
            portalAutoLeft = 0;
            portalWeb.loadUrl(portalCfg.optString("url"));
            Toast.makeText(this, "Signed out of this site", Toast.LENGTH_SHORT).show();
        } catch (Throwable ignored) { }
    }
    private void portalBack() {
        if (portalWeb != null && portalWeb.canGoBack()) { portalWeb.goBack(); return; }
        closePortal();
    }
    private void closePortal() {
        inPortal = false;
        CookieManager.getInstance().flush();
        if (portalWeb != null) { try { portalWeb.stopLoading(); portalWeb.destroy(); } catch (Throwable ignored) { } portalWeb = null; }
        showToolPage("portals.html", tr("all_tools"), "#list");
    }

    private void doNative(String name) {
        switch (name) {
            case "support": showSupportList("all"); break;
            case "scanqr": scanWebLogin(); break;
            case "users": if (!STATE_APP) showUsers("state", ""); break;
            case "logs": if (!STATE_APP) showAdminPage("logs"); break;
            case "supportReport": if (!STATE_APP) showAdminPage("support"); break;
            case "calculator": openDashboard(); openAssistant("openCalculator"); break;
            default:
                if (name.startsWith("dash:")) {   // e.g. dash:tool-voice-notes -> dashboard smart tool
                    String h = name.substring(5).replaceAll("[^A-Za-z0-9_=~\\-]", "");
                    toolFromHub = false; toolFile = null; inSurveyPage = false;
                    openDashboard();
                    ui.postDelayed(() -> { if (webView != null) webView.evaluateJavascript("location.hash=" + JSONObject.quote(h), null); }, 250);
                }
                break;
        }
    }

    // Master-admin customizations (renamed / hidden labels) also apply on the dashboard screen
    private String custLoaderJs() {
        String u = sessionUser(), t = sessionToken();
        if (u == null || t == null || t.isEmpty()) return "void 0";
        try {
            JSONObject a = new JSONObject().put("app", APP_ID).put("username", u).put("token", t);
            return "(function(){if(window.CUST||!/^https:/.test(location.protocol))return;window.__BI_AUTH=" + a + ";window.CUST_PAGE='dashboard';var s=document.createElement('script');s.src='/cust.js?v=64';document.head.appendChild(s);})()";
        } catch (Exception e) { return "void 0"; }
    }

    private void showHub() { showToolPage("hub.html", tr("all_tools"), "#list"); }

    private void showSurveyPage(String hash) { showToolPage("survey.html", STATE_APP ? tr("surveys") : tr("survey_manager"), hash); }

    // Opens the picker for a web page file input. For images it also offers the camera (photo saved to the app cache).
    private boolean launchFileChooser(boolean image) {
        Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
        pick.addCategory(Intent.CATEGORY_OPENABLE);
        pick.setType(image ? "image/*" : "*/*");
        Intent chooser = Intent.createChooser(pick, tr(image ? "take_or_choose_photo" : "choose_file"));
        cameraPhotoUri = null;
        if (image && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            try {
                File dir = new File(getCacheDir(), "photos");
                if (!dir.exists()) dir.mkdirs();
                File f = new File(dir, "visit_" + System.currentTimeMillis() + ".jpg");
                cameraPhotoUri = androidx.core.content.FileProvider.getUriForFile(this, getPackageName() + ".files", f);
                Intent cam = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                cam.putExtra(MediaStore.EXTRA_OUTPUT, cameraPhotoUri);
                cam.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{cam});
            } catch (Throwable e) {
                cameraPhotoUri = null;
            }
        }
        try {
            startActivityForResult(chooser, FILE_CHOOSER_REQUEST);
        } catch (ActivityNotFoundException e) {
            if (filePathCallback != null) filePathCallback.onReceiveValue(null);
            filePathCallback = null;
            return false;
        }
        return true;
    }

    // Shared web pages used by both apps and the website: survey.html, chat.html, matrix.html, visits.html, knowledge.html.
    private void showToolPage(String file, String title, String hash) {
        if (sessionToken() == null) return;
        if (inPortal && portalWeb != null) { inPortal = false; try { portalWeb.destroy(); } catch (Throwable ignored) { } portalWeb = null; }
        toolFromHub = inSurveyPage && "hub.html".equals(toolFile) && !"hub.html".equals(file);
        toolFile = file;
        inProfile = true;
        unlocked = false;
        inAdminPage = false;
        inSurveyPage = true;
        if (surveyWeb == null) {
            surveyWeb = new WebView(this);
            WebSettings ws = surveyWeb.getSettings();
            ws.setJavaScriptEnabled(true);
            ws.setDomStorageEnabled(true);
            ws.setGeolocationEnabled(true);
            surveyWeb.addJavascriptInterface(new SurveyBridge(), "BIApp");
            surveyWeb.addJavascriptInterface(new DownloadBridge(), "AndroidDL");
            surveyWeb.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    Uri u = request.getUrl();
                    if (u.getHost() != null && u.getHost().endsWith(APP_HOST)) return false;
                    openExternally(u);
                    return true;
                }
            });
            surveyWeb.setWebChromeClient(new WebChromeClient() {
                // Survey answers can include photos and documents; market visits take photos with the camera.
                @Override
                public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                    if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                    filePathCallback = callback;
                    boolean image = false;
                    for (String t : params.getAcceptTypes()) if (t != null && t.startsWith("image")) image = true;
                    if (image && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                        pendingImageChooser = true;
                        requestPermissions(new String[]{Manifest.permission.CAMERA}, CAM_PERM_REQUEST);
                        return true;
                    }
                    return launchFileChooser(image);
                }

                // Punch in / punch out read the phone's location (only when the user taps the button).
                @Override
                public void onGeolocationPermissionsShowPrompt(String origin, android.webkit.GeolocationPermissions.Callback cb) {
                    if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                            || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                        cb.invoke(origin, true, false);
                        return;
                    }
                    geoOrigin = origin;
                    geoCallback = cb;
                    requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, GEO_REQUEST);
                }
            });
        }
        if (surveyWeb.getParent() != null) ((ViewGroup) surveyWeb.getParent()).removeView(surveyWeb);
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackgroundColor(Color.parseColor("#F3F4F9"));
        page.addView(profileHeaderBar(title, this::surveyBack));
        page.addView(surveyWeb, new LinearLayout.LayoutParams(-1, 0, 1f));
        detachWebView();
        setContentView(page);
        surveyWeb.loadUrl(START_URL + file + "?v=" + System.currentTimeMillis() + (hash == null ? "#list" : hash));
    }

    // Back inside the survey page first (editor → list), then leave it.
    private void surveyBack() {
        if (surveyWeb == null) { closeSurveyPage(); return; }
        surveyWeb.evaluateJavascript("(function(){var f=window.__pageBack||window.__surveyBack;return f&&f()?1:0})()", v -> { if (!"1".equals(v)) closeSurveyPage(); });
    }

    private void closeSurveyPage() {
        if (toolFromHub) { toolFromHub = false; showHub(); return; }
        toolFile = null;
        inSurveyPage = false;
        openDashboard();
        refreshNotify();
    }

    private View badgeButton(String emoji, String desc, boolean survey, View.OnClickListener click) {
        FrameLayout f = new FrameLayout(this);
        f.setLayoutParams(new LinearLayout.LayoutParams(dp(40), dp(40)));
        f.setBackgroundResource(android.R.drawable.list_selector_background);
        f.setContentDescription(desc);
        TextView ic = new TextView(this);
        ic.setText(emoji);
        ic.setTextSize(TypedValue.COMPLEX_UNIT_SP, 19);
        ic.setGravity(Gravity.CENTER);
        f.addView(ic, new FrameLayout.LayoutParams(-1, -1));
        TextView b = new TextView(this);
        b.setTextColor(Color.WHITE);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 10);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setGravity(Gravity.CENTER);
        GradientDrawable bb = new GradientDrawable();
        bb.setColor(Color.parseColor("#E53935"));
        bb.setCornerRadius(dp(99));
        b.setBackground(bb);
        b.setPadding(dp(4), 0, dp(4), 0);
        b.setMinWidth(dp(16));
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(-2, dp(16), Gravity.TOP | Gravity.END);
        lp.setMargins(0, dp(2), dp(1), 0);
        f.addView(b, lp);
        if (survey) surveyBadge = b; else chatBadge = b;
        setBadge(b, authPrefs().getInt(survey ? "survey_badge" : "chat_unread", 0));
        f.setOnClickListener(click);
        return f;
    }

    private void setBadge(TextView b, int n) {
        if (b == null) return;
        b.setText(n > 9 ? "9+" : String.valueOf(n));
        b.setVisibility(n > 0 ? View.VISIBLE : View.GONE);
    }

    // One call for both badges, plus the "new survey" pop-up for state users.
    private void refreshNotify() {
        if (sessionToken() == null) return;
        lastNotify = System.currentTimeMillis();
        callAuth(sessionBody("action", "notify"), (ok, res, err) -> {
            if (!ok) { if (res.optBoolean("loggedOut", false) || res.optBoolean("needsLink", false)) handleSessionError(res, err); return; }
            int su = res.optInt("supportUnread", 0);
            JSONObject sv = res.optJSONObject("surveys");
            if (sv == null) sv = new JSONObject();
            int n = STATE_APP ? sv.optInt("pending", 0) : sv.optInt("newResponses", 0);
            JSONObject chat = res.optJSONObject("chat");
            int cu = chat == null ? 0 : chat.optInt("unread", 0);
            int pr = res.optInt("pwreq", 0);
            if (!STATE_APP && pr > authPrefs().getInt("pwreq_pending", 0) && unlocked)
                Toast.makeText(this, "🛡️ " + trf("n_reset_requests", pr), Toast.LENGTH_LONG).show();
            authPrefs().edit().putInt("support_unread", su).putInt("survey_badge", n).putInt("chat_unread", cu).putInt("pwreq_pending", pr).apply();
            JSONObject dp = res.optJSONObject("disputes");
            int tot = su + n + cu + (dp == null ? 0 : dp.optInt("unread", 0) + dp.optInt("assigned", 0)) + (res.optInt("hygiene", 0) > 0 ? 1 : 0)
                    + res.optInt("quizNew", 0) + res.optInt("pollNew", 0) + res.optInt("autorep", 0);
            JSONObject mx0 = res.optJSONObject("matrix");
            if (mx0 != null && mx0.optBoolean("pending")) tot++;
            authPrefs().edit().putInt("tools_badge", tot).apply();
            setBadge(supportBadge, su);
            setBadge(surveyBadge, n);
            setBadge(chatBadge, cu);
            setBadge(toolsBadge, tot);
            if (STATE_APP && unlocked) {
                surveyPopup(sv.optJSONArray("surveys"), sv.optInt("pending", 0));
                matrixPopup(res.optJSONObject("matrix"));
            }
        });
    }

    private void surveyPopup(org.json.JSONArray list, int pending) {
        if (list == null) return;
        try {
            JSONObject seen = new JSONObject(settings().getString("survey_seen", "{}"));
            for (int i = 0; i < list.length(); i++) {
                JSONObject s = list.getJSONObject(i);
                String id = s.optString("id");
                long at = s.optLong("announcedAt");
                if (!s.optBoolean("isNew") || seen.optLong(id) == at) continue;
                seen.put(id, at);
                settings().edit().putString("survey_seen", seen.toString()).apply();
                long by = s.optLong("closesAt", 0);
                String msg = s.optString("title") + "\n\n" + (by > 0 ? trf("survey_by", fmtTime(by, "d MMM, h:mm a")) : tr("survey_quick"))
                        + (pending > 1 ? "\n" + trf("surveys_waiting", pending) : "");
                new AlertDialog.Builder(this)
                        .setTitle("📋 " + tr("new_survey"))
                        .setMessage(msg)
                        .setPositiveButton(tr("answer_now"), (d, w) -> showSurveyPage("#s=" + id))
                        .setNegativeButton(tr("later"), null)
                        .show();
                return;
            }
        } catch (Exception ignored) { }
    }

    private void matrixPopup(JSONObject mx) {
        if (mx == null || !mx.optBoolean("pending")) return;
        String id = mx.optString("id");
        long at = mx.optLong("announcedAt");
        if (settings().getLong("mx_seen_" + id, 0) == at) return;
        settings().edit().putLong("mx_seen_" + id, at).apply();
        new AlertDialog.Builder(this)
                .setTitle("🧩 " + tr("feature_matrix"))
                .setMessage(mx.optString("title") + "\n\n" + tr("matrix_popup"))
                .setPositiveButton(tr("matrix_update"), (d, w) -> showToolPage("matrix.html", tr("feature_matrix"), "#list"))
                .setNegativeButton(tr("later"), null)
                .show();
    }

    private void askNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                && !settings().getBoolean("asked_notif", false)) {
            settings().edit().putBoolean("asked_notif", true).apply();
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1010);
        }
    }

    // Opens what a phone notification (or a QR link) points to.
    private void handleIntent(Intent intent) {
        if (intent == null) return;
        Uri data = intent.getData();
        if (data != null && APP_HOST.equals(data.getHost()) && "/qr".equals(data.getPath())) {
            intent.setData(null);
            ui.postDelayed(() -> handleQrText(data.toString()), 400);
            return;
        }
        String open = intent.getStringExtra("open");
        if (open == null) return;
        intent.removeExtra("open");
        if (sessionToken() == null) return;
        if (open.startsWith("survey:")) showSurveyPage("#s=" + open.substring(7));
        else if (open.equals("surveys")) showSurveyPage("#list");
        else if (open.equals("support")) showSupportList("all");
        else if (open.startsWith("chat:")) showToolPage("chat.html", tr("messages"), "#c=" + Uri.encode(open.substring(5)));
        else if (open.equals("chat")) showToolPage("chat.html", tr("messages"), "#list");
        else if (open.equals("matrix")) showToolPage("matrix.html", tr("feature_matrix"), "#list");
        else if (open.equals("visits")) showToolPage("visits.html", tr("market_visits"), "#list");
        else if (open.equals("hub")) showHub();
        else if (open.equals("disputes")) showToolPage("disputes.html", tr("disputes"), "#list");
        else if (open.equals("hygiene")) showToolPage("hygiene.html", tr("hygiene"), "#list");
        else if (open.equals("quiz")) showToolPage("engage.html", tr("quizzes"), "#quiz");
        else if (open.equals("polls")) showToolPage("engage.html", tr("polls"), "#polls");
        else if (open.equals("autoreports")) showToolPage("reports.html", tr("auto_reports"), "#auto");
        else if (open.equals("affordability")) showToolPage("affordability.html", tr("affordability"), "#list");
        else if (open.equals("knowledge")) showToolPage("knowledge.html", tr("knowledge"), "#list");
        else if (open.equals("security") && !STATE_APP) showToolPage("security.html", tr("account_security"), "#list");
        else if (open.equals("update")) checkForUpdate(true);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    // ---------- Web login by QR code ----------
    private ActivityResultLauncher<com.journeyapps.barcodescanner.ScanOptions> qrLauncher;

    private void initQr() {
        qrLauncher = registerForActivityResult(new com.journeyapps.barcodescanner.ScanContract(), r -> {
            if (r.getContents() != null) handleQrText(r.getContents());
        });
    }

    private void scanWebLogin() {
        com.journeyapps.barcodescanner.ScanOptions o = new com.journeyapps.barcodescanner.ScanOptions();
        o.setDesiredBarcodeFormats(com.journeyapps.barcodescanner.ScanOptions.QR_CODE);
        o.setPrompt(tr("qr_prompt"));
        o.setBeepEnabled(false);
        o.setOrientationLocked(true);
        o.setCaptureActivity(ScanActivity.class);
        try { qrLauncher.launch(o); } catch (Exception e) { Toast.makeText(this, e.getMessage(), Toast.LENGTH_LONG).show(); }
    }

    private void handleQrText(String text) {
        Uri u = Uri.parse(text.trim());
        String id = u != null && APP_HOST.equals(u.getHost()) && "/qr".equals(u.getPath()) ? u.getQueryParameter("c") : null;
        if (id == null || !id.matches("[a-f0-9]{8,40}")) { Toast.makeText(this, tr("qr_invalid"), Toast.LENGTH_LONG).show(); return; }
        if (sessionToken() == null) { Toast.makeText(this, tr("qr_login_first"), Toast.LENGTH_LONG).show(); return; }
        callAuth(sessionBody("action", "qr-approve", "qrId", id), (ok, res, err) -> {
            if (!ok) { if (res.optBoolean("loggedOut", false)) handleSessionError(res, err); else new AlertDialog.Builder(this).setMessage(err).setPositiveButton("OK", null).show(); return; }
            String who = profile().optString("fullName", sessionUser());
            new AlertDialog.Builder(this)
                    .setTitle("🔳 " + tr("qr_confirm_title"))
                    .setMessage(trf("qr_confirm_msg", res.optString("device", "Web browser"), who + " (@" + sessionUser() + ")",
                            STATE_APP ? tr("state_user") : tr("admin_user")))
                    .setPositiveButton(tr("qr_allow"), (d, w) -> callAuth(sessionBody("action", "qr-approve", "qrId", id, "confirm", true), (ok2, r2, e2) ->
                            Toast.makeText(this, ok2 ? tr("qr_done") : e2, Toast.LENGTH_LONG).show()))
                    .setNegativeButton(tr("qr_decline"), (d, w) -> callAuth(sessionBody("action", "qr-approve", "qrId", id, "decline", true), (a, b, c) -> { }))
                    .show();
        });
    }

    // ---------- App updates (version.json on the site is updated with every release) ----------
    private File pendingApk = null;

    private void checkForUpdate(boolean manual) {
        long now = System.currentTimeMillis();
        if (!manual && now - settings().getLong("upd_checked", 0) < 3 * 3600 * 1000L) return;
        settings().edit().putLong("upd_checked", now).apply();
        if (manual) Toast.makeText(this, tr("upd_checking"), Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            JSONObject v = Net.getJson(START_URL + "version.json?t=" + now);
            ui.post(() -> {
                if (isFinishing()) return;
                if (v == null) { if (manual) Toast.makeText(this, tr("no_internet"), Toast.LENGTH_LONG).show(); return; }
                int code = v.optInt("versionCode"), mine = BuildConfig.VERSION_CODE;
                if (code <= mine) { if (manual) Toast.makeText(this, trf("upd_latest", BuildConfig.VERSION_NAME), Toast.LENGTH_LONG).show(); return; }
                boolean force = v.optInt("minVersionCode", 0) > mine;
                if (!manual && !force && settings().getInt("upd_snooze_code", 0) == code && now < settings().getLong("upd_snooze_until", 0)) return;
                showUpdateDialog(v, force);
            });
        }).start();
    }

    private void showUpdateDialog(JSONObject v, boolean force) {
        StringBuilder notes = new StringBuilder();
        org.json.JSONArray arr = v.optJSONArray("notes");
        for (int i = 0; arr != null && i < arr.length() && i < 8; i++) notes.append("\n• ").append(arr.optString(i));
        JSONObject apk = v.optJSONObject("apk");
        String url = apk != null ? apk.optString(APP_ID, DOWNLOAD_URL) : DOWNLOAD_URL;
        int code = v.optInt("versionCode");
        AlertDialog.Builder b = new AlertDialog.Builder(this)
                .setTitle("⬆️ " + tr("upd_title"))
                .setMessage(trf("upd_msg", v.optString("versionName"), BuildConfig.VERSION_NAME) + (notes.length() > 0 ? "\n\n" + tr("upd_whats_new") + notes : ""))
                .setCancelable(!force)
                .setPositiveButton(tr("upd_now"), (d, w) -> downloadUpdate(url));
        if (!force) b.setNegativeButton(tr("later"), (d, w) -> settings().edit().putInt("upd_snooze_code", code)
                .putLong("upd_snooze_until", System.currentTimeMillis() + 24 * 3600 * 1000L).apply());
        b.show();
    }

    private void downloadUpdate(String url) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(22), dp(14), dp(22), dp(4));
        ProgressBar pb = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        pb.setMax(100);
        pb.setIndeterminate(true);
        pb.setProgressTintList(android.content.res.ColorStateList.valueOf(BRAND));
        TextView tv = infoLine(tr("upd_downloading"), 13, "#555555", false);
        box.addView(pb, new LinearLayout.LayoutParams(-1, dp(18)));
        box.addView(tv);
        final boolean[] cancelled = {false};
        AlertDialog dlg = new AlertDialog.Builder(this).setTitle("⬆️ " + tr("upd_title")).setView(box).setCancelable(false)
                .setNegativeButton(tr("cancel"), (d, w) -> cancelled[0] = true).show();
        new Thread(() -> {
            File dir = new File(getCacheDir(), "updates");
            File out = new File(dir, "vivo-bi-update.apk");
            HttpURLConnection c = null;
            try {
                dir.mkdirs();
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setInstanceFollowRedirects(true);
                c.setConnectTimeout(20000);
                c.setReadTimeout(30000);
                if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
                long total = c.getContentLengthLong(), got = 0;
                try (InputStream in = c.getInputStream(); FileOutputStream os = new FileOutputStream(out)) {
                    byte[] buf = new byte[32 * 1024];
                    int n, last = -1;
                    while ((n = in.read(buf)) > 0) {
                        if (cancelled[0]) throw new InterruptedException();
                        os.write(buf, 0, n);
                        got += n;
                        if (total > 0) {
                            int p = (int) (got * 100 / total);
                            if (p != last) {
                                last = p;
                                final long g = got;
                                ui.post(() -> { pb.setIndeterminate(false); pb.setProgress(p); tv.setText(trf("upd_progress", p, g / 1048576.0, total / 1048576.0)); });
                            }
                        }
                    }
                }
                ui.post(() -> { dlg.dismiss(); installApk(out); });
            } catch (InterruptedException e) {
                out.delete();
            } catch (Exception e) {
                out.delete();
                ui.post(() -> {
                    dlg.dismiss();
                    Toast.makeText(this, tr("upd_failed"), Toast.LENGTH_LONG).show();
                    openExternally(Uri.parse(url));
                });
            } finally {
                if (c != null) c.disconnect();
            }
        }).start();
    }

    private void installApk(File f) {
        if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
            pendingApk = f;
            new AlertDialog.Builder(this)
                    .setTitle(tr("upd_allow_title"))
                    .setMessage(tr("upd_allow_msg"))
                    .setPositiveButton(tr("upd_open_settings"), (d, w) -> {
                        try {
                            startActivity(new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName())));
                        } catch (ActivityNotFoundException e) { openExternally(Uri.parse(DOWNLOAD_URL)); }
                    })
                    .setNegativeButton(tr("cancel"), (d, w) -> pendingApk = null)
                    .show();
            return;
        }
        try {
            Uri uri = androidx.core.content.FileProvider.getUriForFile(this, getPackageName() + ".files", f);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (Exception e) {
            openExternally(Uri.parse(DOWNLOAD_URL));
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Back from "Install unknown apps" settings: continue the update.
        if (pendingApk != null && (Build.VERSION.SDK_INT < 26 || getPackageManager().canRequestPackageInstalls())) {
            File f = pendingApk;
            pendingApk = null;
            installApk(f);
        }
    }

    // ---------- Admin app: registered users and access log ----------
    private LinearLayout segmented(String[] labels, int selected, java.util.function.IntConsumer onPick) {
        LinearLayout seg = new LinearLayout(this);
        seg.setOrientation(LinearLayout.HORIZONTAL);
        seg.setPadding(dp(14), dp(4), dp(14), dp(8));
        for (int i = 0; i < labels.length; i++) {
            final int idx = i;
            TextView b = new TextView(this);
            b.setText(labels[i]);
            b.setGravity(Gravity.CENTER);
            b.setTextSize(TypedValue.COMPLEX_UNIT_SP, labels.length > 4 ? 12 : 14);
            b.setSingleLine(true);
            b.setPadding(dp(labels.length > 4 ? 4 : 8), dp(9), dp(labels.length > 4 ? 4 : 8), dp(9));
            GradientDrawable bg = new GradientDrawable();
            bg.setCornerRadius(dp(99));
            if (i == selected) { bg.setColor(BRAND); b.setTextColor(Color.WHITE); }
            else { bg.setColor(Color.WHITE); bg.setStroke(dp(1), Color.parseColor("#D8DAE5")); b.setTextColor(Color.parseColor("#333344")); }
            b.setBackground(bg);
            b.setOnClickListener(v -> onPick.accept(idx));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, -2, 1f);
            lp.setMargins(dp(3), 0, dp(3), 0);
            seg.addView(b, lp);
        }
        return seg;
    }

    private static String fmtTime(long t, String pattern) {
        if (t <= 0) return "—";
        java.text.SimpleDateFormat f = new java.text.SimpleDateFormat(pattern, java.util.Locale.ENGLISH);
        f.setTimeZone(java.util.TimeZone.getTimeZone("Asia/Kolkata"));
        return f.format(new java.util.Date(t));
    }

    private TextView infoLine(String text, int sp, String color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(Color.parseColor(color));
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private LinearLayout listCard() {
        LinearLayout c = new LinearLayout(this);
        c.setOrientation(LinearLayout.VERTICAL);
        c.setPadding(dp(16), dp(12), dp(16), dp(12));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.WHITE);
        bg.setCornerRadius(dp(12));
        bg.setStroke(dp(1), Color.parseColor("#E6E8F0"));
        c.setBackground(bg);
        return c;
    }

    private LinearLayout.LayoutParams listCardParams() {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.setMargins(dp(14), dp(5), dp(14), dp(5));
        return lp;
    }

    private void showUsers(String which, String filter) {
        inProfile = true;
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackgroundColor(Color.parseColor("#F4F5FA"));
        page.setPadding(0, 0, 0, dp(24));
        page.addView(profileHeaderBar(tr("registered_users"), this::showProfile));
        int sel = "admin".equals(which) ? 1 : 0;
        page.addView(segmented(new String[]{tr("state_app_users"), tr("admin_app_users")}, sel,
                i -> showUsers(i == 1 ? "admin" : "state", "")));
        EditText search = authField(tr("search_users"), TEXT_PLAIN, 40);
        search.setText(filter);
        LinearLayout.LayoutParams slp = new LinearLayout.LayoutParams(-1, -2);
        slp.setMargins(dp(14), 0, dp(14), dp(6));
        page.addView(search, slp);
        TextView count = infoLine(tr("loading"), 13, "#7A7F99", false);
        count.setPadding(dp(18), dp(4), dp(18), dp(4));
        page.addView(count);
        LinearLayout list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        page.addView(list);
        showScreen(page, null);

        callAuth(sessionBody("action", "admin-users", "which", which), (ok, res, err) -> {
            if (!ok) { count.setText(err); if (res.optBoolean("loggedOut", false)) handleSessionError(res, err); return; }
            org.json.JSONArray users = res.optJSONArray("users");
            Runnable render = () -> {
                list.removeAllViews();
                String q = search.getText().toString().trim().toLowerCase();
                int shown = 0;
                for (int i = 0; users != null && i < users.length(); i++) {
                    JSONObject u = users.optJSONObject(i);
                    String hay = (u.optString("fullName") + " " + u.optString("username") + " " + u.optString("phone") + " "
                            + u.optString("state") + " " + u.optString("designation")).toLowerCase();
                    if (!q.isEmpty() && !hay.contains(q)) continue;
                    shown++;
                    LinearLayout c = listCard();
                    boolean dis = u.optBoolean("disabled");
                    c.addView(infoLine(u.optString("fullName") + (dis ? "   🚫 " + tr("disabled") : ""), 16, dis ? "#B3402F" : "#1A1A2E", true));
                    if (dis) c.setAlpha(0.8f);
                    c.addView(infoLine("@" + u.optString("username") + "   📞 " + u.optString("phone"), 14, "#3D47C8", false));
                    String extra = (u.optString("designation") + (u.optString("state").isEmpty() ? "" : " · " + u.optString("state"))).trim();
                    if (extra.startsWith("·")) extra = extra.substring(1).trim();
                    if (!extra.isEmpty()) c.addView(infoLine(extra, 13, "#555566", false));
                    if (!u.optString("email").isEmpty()) c.addView(infoLine("✉ " + u.optString("email"), 13, "#555566", false));
                    c.addView(infoLine(tr("joined") + " " + fmtTime(u.optLong("createdAt"), "d MMM yyyy") + "   ·   "
                            + tr("last_seen") + " " + fmtTime(u.optLong("lastSeen"), "d MMM, h:mm a"), 12, "#7A7F99", false));
                    if (dis) c.addView(infoLine(trf("disabled_by", u.optString("disabledBy"), fmtTime(u.optLong("disabledAt"), "d MMM, h:mm a"))
                            + (u.optString("disabledReason").isEmpty() ? "" : " · " + u.optString("disabledReason")), 12, "#B3402F", false));
                    final String phone = u.optString("phone");
                    final String uname = u.optString("username");
                    final String ustate = u.optString("state");
                    c.setOnClickListener(v -> new AlertDialog.Builder(this)
                            .setTitle(u.optString("fullName") + " (@" + uname + ")")
                            .setItems("state".equals(which)
                                    ? new String[]{"📞 " + tr("call") + " " + phone, "📍 " + tr("change_state") + (ustate.isEmpty() ? "" : " (" + ustate + ")"),
                                        dis ? "✅ " + tr("enable_account") : "🚫 " + tr("disable_account")}
                                    : new String[]{"📞 " + tr("call") + " " + phone, "📍 " + tr("change_state") + (ustate.isEmpty() ? "" : " (" + ustate + ")")}, (d, w) -> {
                                if (w == 2) {
                                    confirmDisable(uname, u.optString("fullName"), !dis, () -> showUsers(which, search.getText().toString()));
                                } else if (w == 0) {
                                    try { startActivity(new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + phone))); } catch (Exception ignored) { }
                                } else {
                                    String[] items = dashboardStates();
                                    int curI = java.util.Arrays.asList(items).indexOf(ustate);
                                    new AlertDialog.Builder(this).setTitle(tr("change_state"))
                                            .setSingleChoiceItems(items, curI, (d2, which2) -> {
                                                d2.dismiss();
                                                callAuth(sessionBody("action", "admin-set-state", "which", which, "target", uname, "state", items[which2]), (ok2, r2, e2) -> {
                                                    Toast.makeText(this, ok2 ? tr("saved") : e2, Toast.LENGTH_SHORT).show();
                                                    if (ok2) showUsers(which, search.getText().toString());
                                                });
                                            }).setNegativeButton(tr("cancel"), null).show();
                                }
                            }).show());
                    list.addView(c, listCardParams());
                }
                count.setText(trf("users_count", shown, users == null ? 0 : users.length()));
            };
            render.run();
            search.addTextChangedListener(new android.text.TextWatcher() {
                @Override public void beforeTextChanged(CharSequence a, int b, int c2, int d) { }
                @Override public void onTextChanged(CharSequence a, int b, int c2, int d) { render.run(); }
                @Override public void afterTextChanged(android.text.Editable e) { }
            });
        });
    }

    // Admin: disable (logs the user out everywhere, blocks login) or re-enable a state user.
    private void confirmDisable(String uname, String fullName, boolean disable, Runnable after) {
        EditText reason = authField(tr("reason_optional"), TEXT_NAME, 120);
        FrameLayout wrap = new FrameLayout(this);
        wrap.setPadding(dp(20), dp(8), dp(20), 0);
        if (disable) wrap.addView(reason);
        new AlertDialog.Builder(this)
                .setTitle((disable ? tr("disable_account") : tr("enable_account")) + ": " + fullName)
                .setMessage(disable ? tr("disable_confirm") : tr("enable_confirm"))
                .setView(disable ? wrap : null)
                .setPositiveButton(disable ? tr("disable") : tr("enable"), (d, w) ->
                        callAuth(sessionBody("action", "admin-set-disabled", "target", uname, "disabled", disable, "reason", reason.getText().toString().trim()),
                                (ok, res, err) -> {
                                    Toast.makeText(this, ok ? tr(disable ? "account_disabled" : "account_enabled") : err, Toast.LENGTH_SHORT).show();
                                    if (ok) after.run();
                                }))
                .setNegativeButton(tr("cancel"), null)
                .show();
    }

    private static final java.util.Map<String, String> EVENT_ICONS = new java.util.HashMap<String, String>() {{
        put("open", "📲"); put("login", "🔑"); put("signup", "🆕"); put("logout", "🚪"); put("password-reset", "🔁"); put("disabled", "🚫"); put("enabled", "✅");
        put("reset-requested", "🔐"); put("truecaller-on", "🛡️"); put("truecaller-off", "⏸️"); put("qr-login", "🔳");
    }};

    private void showLogs(String date, String which) {
        inProfile = true;
        if (date == null) date = fmtTime(System.currentTimeMillis(), "yyyy-MM-dd");
        final String day = date;
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackgroundColor(Color.parseColor("#F4F5FA"));
        page.setPadding(0, 0, 0, dp(24));
        page.addView(profileHeaderBar(tr("access_logs"), this::showProfile));

        // Day picker: previous / date / next
        LinearLayout nav = new LinearLayout(this);
        nav.setOrientation(LinearLayout.HORIZONTAL);
        nav.setGravity(Gravity.CENTER_VERTICAL);
        nav.setPadding(dp(14), dp(2), dp(14), dp(6));
        java.util.Calendar cal = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("Asia/Kolkata"));
        try {
            java.text.SimpleDateFormat pf = new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.ENGLISH);
            pf.setTimeZone(java.util.TimeZone.getTimeZone("Asia/Kolkata"));
            cal.setTime(pf.parse(day));
        } catch (Exception ignored) { }
        long dayMs = cal.getTimeInMillis();
        TextView prev = infoLine("‹", 26, "#3D47C8", true);
        prev.setPadding(dp(14), 0, dp(14), 0);
        prev.setOnClickListener(v -> showLogs(fmtTime(dayMs - 86400000L, "yyyy-MM-dd"), which));
        TextView label = infoLine("📅 " + fmtTime(dayMs, "EEE, d MMM yyyy"), 16, "#1A1A2E", true);
        label.setGravity(Gravity.CENTER);
        label.setOnClickListener(v -> new android.app.DatePickerDialog(this, (dp2, y, m, d) ->
                showLogs(String.format(java.util.Locale.ENGLISH, "%04d-%02d-%02d", y, m + 1, d), which),
                cal.get(java.util.Calendar.YEAR), cal.get(java.util.Calendar.MONTH), cal.get(java.util.Calendar.DAY_OF_MONTH)).show());
        TextView next = infoLine("›", 26, "#3D47C8", true);
        next.setPadding(dp(14), 0, dp(14), 0);
        next.setOnClickListener(v -> showLogs(fmtTime(dayMs + 86400000L, "yyyy-MM-dd"), which));
        nav.addView(prev);
        nav.addView(label, new LinearLayout.LayoutParams(0, -2, 1f));
        nav.addView(next);
        page.addView(nav);

        String[] keys = {"all", "state", "admin"};
        int sel = java.util.Arrays.asList(keys).indexOf(which);
        page.addView(segmented(new String[]{tr("all_apps"), tr("state_app"), tr("admin_app")}, Math.max(0, sel),
                i -> showLogs(day, keys[i])));
        TextView count = infoLine(tr("loading"), 13, "#7A7F99", false);
        count.setPadding(dp(18), dp(4), dp(18), dp(4));
        page.addView(count);
        LinearLayout list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        page.addView(list);
        showScreen(page, null);

        callAuth(sessionBody("action", "admin-logs", "date", day, "which", which), (ok, res, err) -> {
            if (!ok) { count.setText(err); if (res.optBoolean("loggedOut", false)) handleSessionError(res, err); return; }
            org.json.JSONArray logs = res.optJSONArray("logs");
            int n = logs == null ? 0 : logs.length();
            java.util.Set<String> people = new java.util.HashSet<>();
            for (int i = 0; i < n; i++) {
                JSONObject e = logs.optJSONObject(i);
                people.add(e.optString("app") + ":" + e.optString("username"));
                LinearLayout c = listCard();
                LinearLayout top = new LinearLayout(this);
                top.setOrientation(LinearLayout.HORIZONTAL);
                top.setGravity(Gravity.CENTER_VERTICAL);
                String ev = e.optString("event");
                String icon = EVENT_ICONS.containsKey(ev) ? EVENT_ICONS.get(ev) : "•";
                top.addView(infoLine(icon + "  " + fmtTime(e.optLong("ts"), "h:mm:ss a"), 15, "#1A1A2E", true), new LinearLayout.LayoutParams(0, -2, 1f));
                TextView badge = infoLine(tr("state".equals(e.optString("app")) ? "state_app" : "admin_app"), 11, "#3D47C8", false);
                badge.setPadding(dp(8), dp(3), dp(8), dp(3));
                GradientDrawable bb = new GradientDrawable();
                bb.setColor(Color.parseColor("#EEF0FF"));
                bb.setCornerRadius(dp(99));
                badge.setBackground(bb);
                top.addView(badge);
                c.addView(top);
                String who = e.optString("fullName").isEmpty() ? "@" + e.optString("username")
                        : e.optString("fullName") + "  (@" + e.optString("username") + ")";
                c.addView(infoLine(tr("ev_" + ev.replace("-", "_")) + " · " + who, 14, "#333344", false));
                String meta = (e.optString("phone") + "   " + e.optString("device") + (e.optString("ver").isEmpty() ? "" : "   v" + e.optString("ver"))).trim();
                if (!meta.isEmpty()) c.addView(infoLine(meta, 12, "#7A7F99", false));
                list.addView(c, listCardParams());
            }
            count.setText(n == 0 ? tr("no_logs") : trf("logs_count", n, people.size()));
        });
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

    // States/regions exactly as in the dashboard (states.json, published with each dashboard update).
    private static final String[] FALLBACK_STATES = {"Bihar", "Chhattisgarh", "Delhi", "Gujarat", "Haryana", "Himachal Pradesh",
            "Jammu & Kashmir", "Jharkhand", "Karnataka", "Kerala", "MHA", "MHM", "MHN", "MHP", "Madhya Pradesh", "North East",
            "Odisha", "Punjab", "Rajasthan", "Tamil Nadu", "Telangana", "Uttar Pradesh", "Uttarakhand", "West Bengal"};

    private String[] dashboardStates() {
        try {
            org.json.JSONArray a = new JSONObject(settings().getString("states_json", "{}")).optJSONArray("states");
            if (a != null && a.length() > 0) {
                String[] out = new String[a.length()];
                for (int i = 0; i < a.length(); i++) out[i] = a.optString(i);
                return out;
            }
        } catch (Exception ignored) { }
        return FALLBACK_STATES;
    }

    private void fetchStates() {
        new Thread(() -> {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(START_URL + "states.json").openConnection();
                c.setConnectTimeout(10000);
                c.setReadTimeout(15000);
                if (c.getResponseCode() == 200) {
                    StringBuilder sb = new StringBuilder();
                    try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8))) {
                        String line;
                        while ((line = r.readLine()) != null) sb.append(line);
                    }
                    JSONObject j = new JSONObject(sb.toString());
                    if (j.optJSONArray("states") != null) settings().edit().putString("states_json", j.toString()).apply();
                }
            } catch (Exception ignored) {
            } finally {
                if (c != null) c.disconnect();
            }
        }).start();
    }

    private Spinner stateSpinner(String[] items, String current) {
        Spinner sp = new Spinner(this);
        sp.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, items));
        for (int i = 0; i < items.length; i++) if (items[i].equals(current)) sp.setSelection(i);
        GradientDrawable sbg = new GradientDrawable();
        sbg.setColor(Color.parseColor("#F5F6FA"));
        sbg.setCornerRadius(dp(10));
        sbg.setStroke(dp(1), Color.parseColor("#D8DAE5"));
        sp.setBackground(sbg);
        sp.setPadding(dp(8), dp(12), dp(8), dp(12));
        return sp;
    }

    private String[] withBlank(String first, String[] items, String last) {
        List<String> l = new ArrayList<>();
        l.add(first);
        for (String x : items) l.add(x);
        if (last != null) l.add(last);
        return l.toArray(new String[0]);
    }

    // Existing state-app users choose their state once (it decides which retailer IDs they can see).
    private void showPickState() {
        unlocked = false;
        inProfile = false;
        LinearLayout box = authHeader(tr("pick_state_sub"));
        String[] items = withBlank(tr("select_state"), dashboardStates(), null);
        Spinner sp = stateSpinner(items, "");
        addField(box, sp);
        tcStatus = authMsg(box);
        Button save = authButton(tr("save"));
        box.addView(save, buttonParams());
        save.setOnClickListener(v -> {
            if (sp.getSelectedItemPosition() == 0) { setStatus(tr("err_state"), true); return; }
            busy(save, tr("saving"));
            callAuth(sessionBody("action", "set-state-once", "state", (String) sp.getSelectedItem()), (ok, res, err) -> {
                busy(save, null);
                if (ok) {
                    saveProfile(res.optJSONObject("profile"));
                    if (webView != null) { detachWebView(); webView.destroy(); webView = null; }
                    openDashboard();
                } else handleSessionError(res, err);
            });
        });
        showScreen(box, null);
    }

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
        String cur = p.optString("state", "");
        Spinner state = null;
        if (STATE_APP) {
            // Locked: only an admin can change a state user's state.
            box.addView(fieldLabel(tr("your_state")));
            TextView st = infoLine(cur.isEmpty() ? "—" : cur + "   🔒", 16, "#1A1A2E", true);
            st.setPadding(dp(6), dp(4), 0, dp(4));
            box.addView(st);
            box.addView(infoLine(tr("state_locked_note"), 12, "#7A7F99", false));
        } else {
            box.addView(fieldLabel(tr("state_optional")));
            state = stateSpinner(withBlank("", dashboardStates(), "PAN India / HO"), cur);
            addField(box, state);
        }
        final Spinner stateSel = state;
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
                    "state", stateSel == null ? cur : (String) stateSel.getSelectedItem(), "designation", desig.getText().toString().trim());
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
        if (STATE_APP && res.optBoolean("needsLink", false)) { showLinkVchat(); return; }
        if (res.optBoolean("loggedOut", false)) {
            clearSession();
            if (res.optBoolean("disabled")) { showLoginScreen(null); setStatus(res.optString("error"), true); } else showLoginScreen(tr("logged_out_elsewhere"));
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
                        if (res.optBoolean("disabled")) { showLoginScreen(null); setStatus(res.optString("error"), true); } else showLoginScreen(tr("logged_out_elsewhere"));
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
                if (STATE_APP) view.evaluateJavascript(stateLockScript(), null);
                view.evaluateJavascript(DOWNLOAD_HOOK_JS, null);
            }

            @Override
            public void onPageCommitVisible(WebView view, String url) {
                super.onPageCommitVisible(view, url);
                if (STATE_APP) view.evaluateJavascript(stateLockScript(), null);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (STATE_APP) view.evaluateJavascript(stateLockScript(), null);
                view.evaluateJavascript(DOWNLOAD_HOOK_JS, null);
                view.evaluateJavascript(custLoaderJs(), null);
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
                String cur = view.getUrl() == null ? "" : view.getUrl();
                if (cur.contains("#tool-") || cur.contains("#smart-tools")) {   // smart tools: photo audit, beat list, reconciliation, Excel insight
                    if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                    filePathCallback = callback;
                    boolean image = false;
                    for (String t : params.getAcceptTypes()) if (t != null && t.startsWith("image")) image = true;
                    if (image && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                        pendingImageChooser = true;
                        requestPermissions(new String[]{Manifest.permission.CAMERA}, CAM_PERM_REQUEST);
                        return true;
                    }
                    return launchFileChooser(image);
                }
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
        // (state app: only the own-state Active retailers Excel export gets through, checked in the page)
        webView.addJavascriptInterface(new DownloadBridge(), "AndroidDL");
        webView.addJavascriptInterface(new AIBridge(), "BIAI");
        webView.addJavascriptInterface(new SpeechBridge(), "BISpeech");

        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            if (STATE_APP) {
                if (url.startsWith("blob:") || url.startsWith("data:")) {
                    String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
                    webView.evaluateJavascript("window.__biCanExport && window.__biCanExport() && window.__bidlSend && window.__bidlSend("
                            + JSONObject.quote(url) + "," + JSONObject.quote(name) + ")", null);
                } else {
                    Toast.makeText(this, "Download is not available in this app", Toast.LENGTH_SHORT).show();
                }
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

        // State app: hide import/export/admin items before the page draws (not after it finishes loading).
        if (STATE_APP) {
            try {
                if (androidx.webkit.WebViewFeature.isFeatureSupported(androidx.webkit.WebViewFeature.DOCUMENT_START_SCRIPT)) {
                    lockedState = profile().optString("state", "");
                    androidx.webkit.WebViewCompat.addDocumentStartJavaScript(webView, stateLockScript(),
                            java.util.Collections.singleton("https://" + APP_HOST));
                }
            } catch (Throwable ignored) { }
        }

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
        if (requestCode == ATTACH_REQUEST) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null) uploadAttachment(data.getData());
            return;
        }
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
            if (result == null && resultCode == RESULT_OK && cameraPhotoUri != null) result = new Uri[]{cameraPhotoUri};
            cameraPhotoUri = null;
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
            "if(window.__biStateApp&&!(window.__biCanExport&&window.__biCanExport()))return true;" +
            "window.__bidlSend(h,a.getAttribute('download')||a.download||'');return true}return false}" +
            "document.addEventListener('click',function(e){var t=e.target;var a=t&&t.closest?t.closest('a'):null;" +
            "if(a&&grab(a)){e.preventDefault();e.stopImmediatePropagation()}},true);" +
            "var oc=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){" +
            "if(!this.isConnected&&grab(this))return;return oc.apply(this,arguments)};" +
            "})();";

    // State app only: hides admin tools (import, edit leaders, export & share), the Active
    // retailers tab and every link to retailer IDs, and sends any retailers page back to overview.
    // State app only. window.BI_STATE (the user's state) is set before this runs.
    // - hides admin tools (import, edit leaders, export & share, PNG saves) everywhere
    // - Active retailers (IDs) and their Excel export: own state only; other states are switched to own
    // - without a state: all retailer IDs and Excel stay hidden
    private static final String STATE_LOCK_JS =
            "(function(){if(window.__bist)return;window.__bist=1;window.__biStateApp=1;var own=window.BI_STATE||'';" +
            "var retSel='[data-t=\"ret\"],[data-t=\"retv\"],[data-go=\"ret\"],[data-go=\"retv\"],a[href*=\"retailers=\"],';" +
            "var css='#data-tools,#unlock-b,#exmenu,#imodal,#umodal,#lmodal,#cmodal,#tmodal,'+(own?'':retSel)+'input[type=file]{display:none!important}';" +
            "function addCss(){if(document.getElementById('bist-css'))return;var r=document.head||document.documentElement;if(!r)return;var s=document.createElement('style');s.id='bist-css';s.textContent=css;r.appendChild(s)}" +
            "var bad=new RegExp('(import data|export & share|edit leaders|save updated file|shareable copy|blank template|common all-states|common file|unlock my state|save png'+(own?'':'|active retailers|retailer ids')+')','i');" +
            "var exl=/(excel|export)/i;" +
            "function hashTxt(){try{return decodeURIComponent(location.hash.slice(1))}catch(x){return ''}}" +
            "function retvOn(){var b=document.querySelector('#tabs [data-t=\"retv\"]');return !!(b&&b.getAttribute('aria-selected')==='true')}" +
            "function scopeVal(){var s=document.getElementById('scope-sel');return s&&s.selectedOptions[0]?s.selectedOptions[0].textContent.trim():''}" +
            "function inRet(){return /^retailers=/i.test(hashTxt())||retvOn()}" +
            "window.__biCanExport=function(){if(!own||!inRet())return false;var h=hashTxt();if(/^retailers=/i.test(h))return h.indexOf('retailers='+own+'~')===0;return scopeVal()===own};" +
            "function setScope(){var s=document.getElementById('scope-sel');if(!s)return;var o=[].find.call(s.options,function(x){return x.textContent.trim()===own});if(o&&s.value!==o.value){s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}))}}" +
            "function enforce(){if(!own)return;var h=hashTxt(),m=/^retailers=([^~]*)~?(.*)$/i.exec(h);" +
            "if(m&&m[1]!==own){location.replace('#retailers='+encodeURIComponent(own)+'~'+(m[2]||'all'));return}" +
            "if(retvOn()&&scopeVal()!==own)setScope()}" +
            "function check(e){if(e.__bis===1)return;var t=(e.textContent||'')+' '+(e.title||'');" +
            "if(bad.test(t)){e.style.setProperty('display','none','important');e.__bis=1;return}" +
            "if(exl.test(t)){if(window.__biCanExport()){if(e.__bis===2){e.style.removeProperty('display');e.__bis=0}}else{e.style.setProperty('display','none','important');e.__bis=2}}}" +
            "function scan(root){if(!root||root.nodeType!==1)return;if(root.matches('button,a'))check(root);var els=root.querySelectorAll('button,a');for(var i=0;i<els.length;i++)check(els[i])}" +
            "var pend=[],full=1;function scrub(){addCss();enforce();if(full){full=0;pend=[];scan(document.documentElement);return}var p=pend;pend=[];" +
            "for(var i=0;i<p.length;i++){var n=p[i];if(n.isConnected)scan(n)}}" +
            "function guard(){var h=hashTxt();if(!own&&/^(retailers|retv|ret)\\b/i.test(h)){location.hash=''}full=1;tick()}" +
            "var q=0;function tick(){if(q)return;q=1;setTimeout(function(){q=0;scrub()},80)}" +
            "addCss();tick();document.addEventListener('DOMContentLoaded',function(){full=1;tick()});" +
            "new MutationObserver(function(ms){for(var i=0;i<ms.length;i++){var m=ms[i],t=m.target;" +
            "if(t.nodeType===1){var b=t.closest&&t.closest('button,a');if(b)pend.push(b);if(t.id==='tabs'||t.closest&&t.closest('#tabs'))full=1}" +
            "for(var j=0;j<m.addedNodes.length;j++){if(m.addedNodes[j].nodeType===1)pend.push(m.addedNodes[j])}}" +
            "if(pend.length>400){pend=[];full=1}tick()}).observe(document,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-selected']});" +
            "window.addEventListener('hashchange',guard);" +
            "document.addEventListener('change',function(e){if(e.target&&e.target.id==='scope-sel'){full=1;tick()}},true);" +
            "document.addEventListener('click',function(e){var a=e.target&&e.target.closest?e.target.closest('a[href*=\"retailers=\"],[data-t=\"ret\"],[data-t=\"retv\"],[data-go=\"ret\"],[data-go=\"retv\"]'):null;if(!a)return;" +
            "if(!own){e.preventDefault();e.stopImmediatePropagation();return}" +
            "var href=a.getAttribute('href')||'';if(href.indexOf('retailers=')>=0){var h2='';try{h2=decodeURIComponent(href.split('#')[1]||'')}catch(x){}" +
            "if(h2.indexOf('retailers='+own+'~')!==0){e.preventDefault();e.stopImmediatePropagation();location.hash='retailers='+encodeURIComponent(own)+'~all'}}},true);" +
            "})();";

    // State-lock script with the signed-in user's state.
    private String stateLockScript() {
        String st = profile().optString("state", "");
        return "window.BI_STATE=" + JSONObject.quote(st) + ";" + STATE_LOCK_JS;
    }

    // Loads the BI Assistant (search + chatbot) from the dashboard site. A daily version keeps it fresh.
    private static final String ASSIST_LOADER_JS =
            "(function(){var need=2.0;if(window.BIAssist&&parseFloat(window.BIAssist.version||'0')>=need)return;" +
            "if(window.BIAssist){try{delete window.BIAssist}catch(e){window.BIAssist=undefined}var o=document.getElementById('bia-loader');if(o)o.remove()}" +
            "if(document.getElementById('bia-loader'))return;" +
            "window.BI_APP='" + (BuildConfig.STATE_APP ? "state" : "admin") + "';" +
            "var s=document.createElement('script');s.id='bia-loader';" +
            "s.src='/assistant.js?v='+Date.now();" +
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

    // Lets the assistant in the page ask the free AI through the accounts service (the session stays in the app).
    // ---------- Voice notes: Android speech recognition for the dashboard (the in-app browser has none of its own).
    // A small script in the page (added when the dashboard is published) turns this into window.webkitSpeechRecognition.
    private SpeechRecognizer speech;
    private String[] pendingSpeech;
    private void speechJs(String type, String a) {
        final String js = "window.__bisp&&window.__bisp(" + JSONObject.quote(type) + "," + JSONObject.quote(a == null ? "" : a) + ")";
        ui.post(() -> { if (webView != null) webView.evaluateJavascript(js, null); });
    }
    private void startSpeech(String lang, boolean partial) {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            pendingSpeech = new String[]{lang, partial ? "1" : "0"};
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, MIC_PERM_REQUEST);
            return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) { speechJs("error", "service-not-allowed"); speechJs("end", ""); return; }
        try {
            if (speech == null) {
                speech = SpeechRecognizer.createSpeechRecognizer(this);
                speech.setRecognitionListener(new RecognitionListener() {
                    @Override public void onReadyForSpeech(Bundle b) { speechJs("start", ""); }
                    @Override public void onBeginningOfSpeech() { }
                    @Override public void onRmsChanged(float v) { }
                    @Override public void onBufferReceived(byte[] bytes) { }
                    @Override public void onEndOfSpeech() { }
                    @Override public void onEvent(int i, Bundle b) { }
                    @Override public void onPartialResults(Bundle b) {
                        java.util.ArrayList<String> r = b == null ? null : b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                        if (r != null && !r.isEmpty() && r.get(0) != null && !r.get(0).isEmpty()) speechJs("partial", r.get(0));
                    }
                    @Override public void onResults(Bundle b) {
                        java.util.ArrayList<String> r = b == null ? null : b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                        if (r != null && !r.isEmpty() && r.get(0) != null && !r.get(0).isEmpty()) speechJs("final", r.get(0));
                        speechJs("end", "");
                    }
                    @Override public void onError(int e) {
                        String code = e == SpeechRecognizer.ERROR_NO_MATCH || e == SpeechRecognizer.ERROR_SPEECH_TIMEOUT ? "no-speech"
                                : e == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ? "not-allowed"
                                : e == SpeechRecognizer.ERROR_NETWORK || e == SpeechRecognizer.ERROR_NETWORK_TIMEOUT || e == SpeechRecognizer.ERROR_SERVER ? "network"
                                : e == SpeechRecognizer.ERROR_AUDIO ? "audio-capture" : e == SpeechRecognizer.ERROR_RECOGNIZER_BUSY ? "aborted" : "aborted";
                        speechJs("error", code); speechJs("end", "");
                    }
                });
            }
            Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang == null || lang.isEmpty() ? "en-IN" : lang);
            i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, partial);
            i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            speech.startListening(i);
        } catch (Throwable t) { speechJs("error", "aborted"); speechJs("end", ""); }
    }
    private class SpeechBridge {
        @JavascriptInterface public void start(String lang, boolean partial) { ui.post(() -> startSpeech(lang, partial)); }
        @JavascriptInterface public void stop() { ui.post(() -> { try { if (speech != null) speech.stopListening(); } catch (Throwable ignored) { } }); }
        @JavascriptInterface public void abort() { ui.post(() -> { try { if (speech != null) speech.cancel(); } catch (Throwable ignored) { } speechJs("end", ""); }); }
    }

    private class AIBridge {
        private void reply(String id, JSONObject res, boolean ok, String err) {
            try {
                if (!res.has("ok")) res.put("ok", ok);
                if (!ok && !res.has("error")) res.put("error", err);
            } catch (Exception ignored) { }
            final String js = "window.__biaiCb&&window.__biaiCb(" + JSONObject.quote(id) + "," + JSONObject.quote(res.toString()) + ")";
            ui.post(() -> { if (webView != null) webView.evaluateJavascript(js, null); });
        }

        @JavascriptInterface
        public void status(String id) {
            ui.post(() -> callAuth(sessionBody("action", "ai-status"), (ok, res, err) -> reply(id, res, ok, err)));
        }

        @JavascriptInterface
        public void ask(String id, String question, String context, String history) {
            org.json.JSONArray h;
            try { h = new org.json.JSONArray(history == null ? "[]" : history); } catch (Exception e) { h = new org.json.JSONArray(); }
            final org.json.JSONArray hist = h;
            ui.post(() -> callAuth(sessionBody("action", "ai-ask", "question", question, "context", context, "history", hist),
                    (ok, res, err) -> reply(id, res, ok, err)));
        }
    }

    private class DownloadBridge {
        // Theme "Auto": tells the page whether the phone is in dark mode (the in-app browser uses a light app theme).
        @JavascriptInterface
        public boolean isNight() {
            return (getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES;
        }

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
        if (inLink) { super.onBackPressed(); return; }
        if (inPortal) { portalBack(); return; }
        if (inSurveyPage) {
            surveyBack();
            return;
        }
        if (inAdminPage) {
            inAdminPage = false;
            showProfile();
            return;
        }
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
