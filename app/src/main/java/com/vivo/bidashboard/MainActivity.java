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
    private static final long RELOCK_AFTER_MS = 5 * 60 * 1000; // ask to log in again after 5 min in background

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private boolean unlocked = false;
    private long backgroundedAt = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        initTruecaller();
        showLoginScreen(null);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        try { TcSdk.clear(); } catch (Exception ignored) { }
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
            showLoginScreen(null);
        }
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private String lastUsername() {
        return getSharedPreferences("auth", MODE_PRIVATE).getString("last_username", "");
    }

    private void rememberUsername(String u) {
        getSharedPreferences("auth", MODE_PRIVATE).edit().putString("last_username", u).apply();
    }

    // ---------- Accounts service (POST /api/auth) ----------
    private final Handler ui = new Handler(Looper.getMainLooper());

    private interface AuthResult { void done(boolean ok, JSONObject res, String error); }

    private void callAuth(JSONObject body, AuthResult cb) {
        new Thread(() -> {
            boolean ok = false;
            JSONObject res = new JSONObject();
            String err = "No internet connection. Please try again.";
            HttpURLConnection c = null;
            try {
                body.put("app", APP_ID);
                c = (HttpURLConnection) new URL(AUTH_URL).openConnection();
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
    // Truecaller gives a free missed call, or an OTP (by SMS or in the Truecaller app).
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
                manualVerification("Truecaller could not finish. Trying missed call / OTP…");
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

    // One-tap login for people with the Truecaller app; the server confirms the number.
    private final TcOAuthCallback tcOAuthCallback = new TcOAuthCallback() {
        @Override
        public void onSuccess(TcOAuthData data) {
            if (tcState != null && data.getState() != null && !tcState.equals(data.getState())) {
                setStatus("Truecaller login could not be confirmed. Please try again.", true);
                return;
            }
            setStatus("Confirming your number with Truecaller…", false);
            callAuth(obj("action", "tc-exchange", "code", data.getAuthorizationCode(), "codeVerifier", tcVerifier),
                    (ok, res, err) -> {
                        if (!ok) { setStatus(err, true); return; }
                        String tcPhone = res.optString("phone", "");
                        if (!tcPhone.equals(pendingPhone)) {
                            setStatus("Your Truecaller number is +91 " + tcPhone + ", not +91 " + pendingPhone
                                    + ". Enter +91 " + tcPhone + ", or tap again and choose 'Use another number' in Truecaller.", true);
                            return;
                        }
                        phoneVerified();
                    });
        }

        @Override
        public void onFailure(TcOAuthError error) {
            String m = error == null ? "" : error.getErrorMessage();
            manualVerification("Truecaller login didn't finish" + (m == null || m.isEmpty() ? "" : " (" + m + ")")
                    + ". Trying missed call / OTP…");
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
        if (!tcReady) {
            setStatus("Mobile verification is not available. Please update the app.", true);
            return;
        }
        pendingName = name;
        pendingPhone = phone;
        onPhoneVerified = onVerified;
        onVerifyBack = back;
        boolean oauth = false;
        try { oauth = TcSdk.getInstance().isOAuthFlowUsable(); } catch (Throwable ignored) { }
        if (oauth) {
            setStatus("Opening Truecaller…", false);
            try {
                tcState = Long.toHexString(new java.security.SecureRandom().nextLong());
                tcVerifier = com.truecaller.android.sdk.oAuth.CodeVerifierUtil.Companion.generateRandomCodeVerifier();
                TcSdk.getInstance().setOAuthState(tcState);
                TcSdk.getInstance().setOAuthScopes(new String[]{"openid", "profile", "phone"});
                String challenge = com.truecaller.android.sdk.oAuth.CodeVerifierUtil.Companion.getCodeChallenge(tcVerifier);
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
        setStatus(note != null ? note : "Asking for permissions to detect the missed call…", false);
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
        setStatus("Contacting Truecaller for a missed call / OTP…", false);
        startVerifyTimeout();
        try {
            TcSdk.getInstance().requestVerification("IN", pendingPhone, tcVerifyCallback, this);
        } catch (Throwable e) {
            stopVerifyTimeout();
            setStatus("Could not start verification: " + e.getMessage(), true);
        }
    }

    private void startVerifyTimeout() {
        stopVerifyTimeout();
        verifyTimeout = () -> setStatus("Truecaller did not respond. Check that your number is added as a test number "
                + "in the Truecaller console (until it's approved), your internet is on, then tap the button again.", true);
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
            TrueProfile profile = new TrueProfile.Builder(pendingName, "").build();
            switch (type) {
                case VerificationCallback.TYPE_MISSED_CALL_INITIATED:
                    showWaiting("You will get a missed call on +91 " + pendingPhone
                            + ". Don't answer it — it is verified automatically.");
                    break;
                case VerificationCallback.TYPE_MISSED_CALL_RECEIVED:
                    setStatus("Missed call received. Verifying…", false);
                    TcSdk.getInstance().verifyMissedCall(profile, tcVerifyCallback);
                    break;
                case VerificationCallback.TYPE_OTP_INITIATED:
                case VerificationCallback.TYPE_IM_OTP_INITIATED:
                    showTcOtpEntry(type == VerificationCallback.TYPE_IM_OTP_INITIATED);
                    break;
                case VerificationCallback.TYPE_OTP_RECEIVED:
                case VerificationCallback.TYPE_IM_OTP_RECEIVED: {
                    String otp = bundle == null ? null : bundle.getString(VerificationDataBundle.KEY_OTP);
                    if (otp != null && !otp.isEmpty()) {
                        setStatus("OTP received. Verifying…", false);
                        TcSdk.getInstance().verifyOtp(profile, otp, tcVerifyCallback);
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
            setStatus((m == null || m.isEmpty()) ? "Verification failed. Please try again." : m, true);
        }
    };

    private void showWaiting(String text) {
        LinearLayout box = authHeader(text);
        ProgressBar pb = new ProgressBar(this);
        box.addView(pb, new LinearLayout.LayoutParams(-2, -2));
        tcStatus = authMsg(box);
        box.addView(linkText("Cancel", v -> { if (onVerifyBack != null) onVerifyBack.run(); }));
        showScreen(box, null);
    }

    private void showTcOtpEntry(boolean inTruecaller) {
        LinearLayout box = authHeader(inTruecaller
                ? "Enter the OTP sent to your Truecaller app on +91 " + pendingPhone
                : "Enter the OTP sent to +91 " + pendingPhone);
        EditText otp = authField("OTP", InputType.TYPE_CLASS_NUMBER, 6);
        otp.setGravity(Gravity.CENTER);
        otp.setLetterSpacing(0.3f);
        box.addView(otp, new LinearLayout.LayoutParams(-1, -2));
        tcStatus = authMsg(box);
        Button verify = authButton("Verify OTP");
        box.addView(verify, buttonParams());
        box.addView(linkText("Cancel", v -> { if (onVerifyBack != null) onVerifyBack.run(); }));
        Runnable doVerify = () -> {
            String code = otp.getText().toString().trim();
            if (code.length() < 4) { setStatus("Enter the OTP.", true); return; }
            hideKeyboard(otp);
            setStatus("Verifying…", false);
            TcSdk.getInstance().verifyOtp(new TrueProfile.Builder(pendingName, "").build(), code, tcVerifyCallback);
        };
        verify.setOnClickListener(v -> doVerify.run());
        otp.setImeOptions(EditorInfo.IME_ACTION_DONE);
        otp.setOnEditorActionListener((v, a, e) -> { doVerify.run(); return true; });
        showScreen(box, otp);
    }

    // ---------- Screen building helpers ----------
    private LinearLayout authHeader(String subtitle) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER_HORIZONTAL);
        box.setPadding(dp(28), dp(48), dp(28), dp(28));
        box.setBackgroundColor(Color.WHITE);

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.mipmap.ic_launcher);
        box.addView(logo, new LinearLayout.LayoutParams(dp(84), dp(84)));

        TextView title = new TextView(this);
        title.setText(R.string.app_name);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setTextColor(Color.parseColor("#111111"));
        title.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(-1, -2);
        tp.topMargin = dp(12);
        box.addView(title, tp);

        TextView sub = new TextView(this);
        sub.setText(subtitle);
        sub.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        sub.setTextColor(Color.parseColor("#666666"));
        sub.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(-1, -2);
        sp.topMargin = dp(6);
        sp.bottomMargin = dp(20);
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
        show.setText("Show password");
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
        GradientDrawable bg = new GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
                new int[]{Color.parseColor("#4D5BF9"), Color.parseColor("#9152E0")});
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
        t.setTextColor(Color.parseColor("#4D5BF9"));
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

    private void busy(Button b, String text) {
        b.setEnabled(text == null);
        if (text != null) { b.setTag(b.getText()); b.setText(text); }
        else if (b.getTag() != null) b.setText((CharSequence) b.getTag());
    }

    // ---------- Login: user name + password (every time the app opens) ----------
    private void showLoginScreen(String info) {
        unlocked = false;
        LinearLayout box = authHeader("Log in with your user name and password");
        EditText user = authField("User name", TEXT_PLAIN, 30);
        user.setText(lastUsername());
        addField(box, user);
        EditText pass = authField("Password", TEXT_PASSWORD, 64);
        addField(box, pass);
        box.addView(showPasswordBox(pass));
        tcStatus = authMsg(box);
        if (info != null) setStatus(info, false);
        Button login = authButton("Log in");
        box.addView(login, buttonParams());
        box.addView(linkText("Forgot password?", v -> showForgot()));
        box.addView(linkText("New user? Sign up", v -> showSignup()));

        Runnable doLogin = () -> {
            String u = user.getText().toString().trim();
            String p = pass.getText().toString();
            if (u.isEmpty() || p.isEmpty()) { setStatus("Enter your user name and password.", true); return; }
            hideKeyboard(pass);
            busy(login, "Logging in…");
            callAuth(obj("action", "login", "username", u, "password", p), (ok, res, err) -> {
                busy(login, null);
                if (ok) {
                    rememberUsername(res.optString("username", u));
                    unlock();
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
        LinearLayout box = authHeader("Create your account. Your mobile number is verified once with Truecaller.");
        EditText full = authField("Full name", TEXT_NAME, 40);
        EditText user = authField("Choose a user name (for login)", TEXT_PLAIN, 30);
        EditText phone = authField("10-digit mobile number", InputType.TYPE_CLASS_PHONE, 10);
        EditText pass = authField("Create password (min 6 characters)", TEXT_PASSWORD, 64);
        EditText pass2 = authField("Confirm password", TEXT_PASSWORD, 64);
        EditText code = authField("Access code (from your BI admin)", TEXT_PASSWORD, 64);
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
        Button go = authButton("Verify mobile & create account");
        box.addView(go, buttonParams());
        box.addView(linkText("Already have an account? Log in", v -> {
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
            if (fn.length() < 2) { setStatus("Please enter your full name.", true); return; }
            if (un.length() < 3) { setStatus("User name must be at least 3 characters.", true); return; }
            if (!ph.matches("[6-9]\\d{9}")) { setStatus("Enter a valid 10-digit mobile number.", true); return; }
            if (pw.length() < 6) { setStatus("Password must be at least 6 characters.", true); return; }
            if (!pw.equals(pass2.getText().toString())) { setStatus("Passwords do not match.", true); return; }
            if (ac.isEmpty()) { setStatus("Enter the access code from your BI admin.", true); return; }
            hideKeyboard(code);
            busy(go, "Checking…");
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
        LinearLayout box = authHeader("Mobile verified. Creating your account…");
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
                rememberUsername(res.optString("username", d.optString("username")));
                Toast.makeText(this, "Account created. Welcome, " + res.optString("fullName", "") + "!", Toast.LENGTH_LONG).show();
                unlock();
            } else {
                setStatus(err, true);
                box.addView(linkText("Back to sign up", v -> showSignup()));
            }
        });
    }

    // ---------- Forgot password: re-verify mobile with Truecaller, then set a new password ----------
    private void showForgot() {
        unlocked = false;
        LinearLayout box = authHeader("Enter the mobile number of your account. We'll verify it with Truecaller, then you can set a new password.");
        EditText phone = authField("10-digit mobile number", InputType.TYPE_CLASS_PHONE, 10);
        addField(box, phoneRow(phone));
        tcStatus = authMsg(box);
        Button go = authButton("Verify mobile");
        box.addView(go, buttonParams());
        box.addView(linkText("Back to log in", v -> showLoginScreen(null)));
        go.setOnClickListener(v -> {
            String ph = phone.getText().toString().replaceAll("\\D", "");
            if (!ph.matches("[6-9]\\d{9}")) { setStatus("Enter a valid 10-digit mobile number.", true); return; }
            hideKeyboard(phone);
            busy(go, "Checking…");
            callAuth(obj("action", "reset-check", "phone", ph), (ok, res, err) -> {
                busy(go, null);
                if (!ok) { setStatus(err, true); return; }
                startPhoneVerification("vivo BI user", ph, () -> showNewPassword(ph), this::showForgot);
            });
        });
        showScreen(box, phone);
    }

    private void showNewPassword(String ph) {
        LinearLayout box = authHeader("Mobile verified. Set a new password.");
        EditText pass = authField("New password (min 6 characters)", TEXT_PASSWORD, 64);
        EditText pass2 = authField("Confirm new password", TEXT_PASSWORD, 64);
        addField(box, pass);
        addField(box, pass2);
        box.addView(showPasswordBox(pass, pass2));
        tcStatus = authMsg(box);
        Button save = authButton("Save new password");
        box.addView(save, buttonParams());
        box.addView(linkText("Cancel", v -> showLoginScreen(null)));
        save.setOnClickListener(v -> {
            String pw = pass.getText().toString();
            if (pw.length() < 6) { setStatus("Password must be at least 6 characters.", true); return; }
            if (!pw.equals(pass2.getText().toString())) { setStatus("Passwords do not match.", true); return; }
            hideKeyboard(pass2);
            busy(save, "Saving…");
            callAuth(obj("action", "reset", "phone", ph, "newPassword", pw, "phoneVerified", true), (ok, res, err) -> {
                busy(save, null);
                if (ok) {
                    String u = res.optString("username", "");
                    if (!u.isEmpty()) rememberUsername(u);
                    showLoginScreen("Password changed. Your user name is " + u + ". Please log in.");
                } else {
                    setStatus(err, true);
                }
            });
        });
        showScreen(box, pass);
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
