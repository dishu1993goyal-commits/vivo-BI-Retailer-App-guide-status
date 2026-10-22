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
import com.truecaller.android.sdk.oAuth.CodeVerifierUtil;
import com.truecaller.android.sdk.oAuth.TcOAuthCallback;
import com.truecaller.android.sdk.oAuth.TcOAuthData;
import com.truecaller.android.sdk.oAuth.TcOAuthError;
import com.truecaller.android.sdk.oAuth.TcSdk;
import com.truecaller.android.sdk.oAuth.TcSdkOptions;
import java.math.BigInteger;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;
import android.os.Handler;
import android.os.Looper;
import android.text.InputFilter;

public class MainActivity extends FragmentActivity {

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
        initTruecaller();
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

    // ---------- Mobile verification with Truecaller (once per phone) ----------
    // Truecaller users: one-tap consent. Others: Truecaller sends a free missed call or OTP.
    private final Handler ui = new Handler(Looper.getMainLooper());
    private ActivityResultLauncher<Intent> tcLauncher;
    private boolean tcReady = false;
    private String tcState;
    private TextView tcStatus;          // status line on the current verification screen
    private String pendingPhone, pendingName;
    private static final int PERM_REQUEST = 2001;

    private void initTruecaller() {
        tcLauncher = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), r -> {
            try {
                TcSdk.getInstance().onActivityResultObtained(this, r.getResultCode(), r.getData());
            } catch (Exception e) {
                showManualVerify("Truecaller could not finish. Verify with missed call / OTP instead.");
            }
        });
        try {
            TcSdkOptions options = new TcSdkOptions.Builder(this, tcOAuthCallback)
                    .sdkOptions(TcSdkOptions.OPTION_VERIFY_ALL_USERS)
                    .consentHeadingOption(TcSdkOptions.SDK_CONSENT_HEADING_LOG_IN_TO)
                    .loginTextPrefix(TcSdkOptions.LOGIN_TEXT_PREFIX_TO_GET_STARTED)
                    .footerType(TcSdkOptions.FOOTER_TYPE_ANOTHER_MOBILE_NO)
                    .ctaText(TcSdkOptions.CTA_TEXT_PROCEED)
                    .buttonShapeOptions(TcSdkOptions.BUTTON_SHAPE_ROUNDED)
                    .consentMode(TcSdkOptions.CONSENT_MODE_BOTTOMSHEET)
                    .build();
            TcSdk.init(options);
            tcReady = true;
        } catch (Exception e) {
            tcReady = false;
        }
    }

    private void markVerified(String phone) {
        getSharedPreferences("auth", MODE_PRIVATE).edit()
                .putString("verified_phone", phone == null || phone.isEmpty() ? "verified" : phone).apply();
        Toast.makeText(this, "Mobile number verified", Toast.LENGTH_SHORT).show();
        showLogin();
    }

    private void setStatus(String text, boolean error) {
        if (tcStatus == null) return;
        tcStatus.setTextColor(Color.parseColor(error ? "#C62828" : "#2E7D32"));
        tcStatus.setText(text);
    }

    private final TcOAuthCallback tcOAuthCallback = new TcOAuthCallback() {
        @Override
        public void onSuccess(TcOAuthData data) {
            if (tcState != null && data.getState() != null && !tcState.equals(data.getState())) {
                setStatus("Verification could not be confirmed. Please try again.", true);
                return;
            }
            markVerified("truecaller");
        }

        @Override
        public void onFailure(TcOAuthError error) {
            showManualVerify("Truecaller login was cancelled or failed. You can verify with a missed call / OTP.");
        }

        @Override
        public void onVerificationRequired(TcOAuthError error) {
            showManualVerify(null);
        }
    };

    private final VerificationCallback tcVerifyCallback = new VerificationCallback() {
        @Override
        public void onRequestSuccess(int type, VerificationDataBundle bundle) {
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
                    showTcOtpEntry();
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
                case VerificationCallback.TYPE_PROFILE_VERIFIED_BEFORE:
                    markVerified("+91" + pendingPhone);
                    break;
                default: // verification complete
                    markVerified("+91" + pendingPhone);
                    break;
            }
        }

        @Override
        public void onRequestFailure(int type, TrueException e) {
            String m = e == null ? null : e.getExceptionMessage();
            setStatus((m == null || m.isEmpty()) ? "Verification failed. Please try again." : m, true);
        }
    };

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
        if (!tcReady) {
            showManualVerify(null);
            return;
        }
        boolean oauth = false;
        try { oauth = TcSdk.getInstance().isOAuthFlowUsable(); } catch (Exception ignored) { }
        if (!oauth) {
            showManualVerify(null);
            return;
        }
        LinearLayout box = authHeader("Verify your mobile number to continue");
        Button tc = authButton("Verify with Truecaller");
        box.addView(tc, new LinearLayout.LayoutParams(-1, dp(52)));
        tcStatus = authMsg(box);
        TextView other = new TextView(this);
        other.setText("Use missed call / OTP instead");
        other.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        other.setTextColor(Color.parseColor("#4D5BF9"));
        other.setGravity(Gravity.CENTER);
        other.setPadding(0, dp(18), 0, dp(8));
        other.setOnClickListener(v -> showManualVerify(null));
        box.addView(other, new LinearLayout.LayoutParams(-1, -2));
        tc.setOnClickListener(v -> startTruecallerConsent());
        showScreen(box, null);
        startTruecallerConsent();
    }

    private void startTruecallerConsent() {
        try {
            tcState = new BigInteger(130, new SecureRandom()).toString(32);
            TcSdk.getInstance().setOAuthState(tcState);
            TcSdk.getInstance().setOAuthScopes(new String[]{"openid", "profile", "phone"});
            String verifier = CodeVerifierUtil.Companion.generateRandomCodeVerifier();
            String challenge = CodeVerifierUtil.Companion.getCodeChallenge(verifier);
            if (challenge != null) TcSdk.getInstance().setCodeChallenge(challenge);
            TcSdk.getInstance().getAuthorizationCode(this, tcLauncher);
        } catch (Exception e) {
            showManualVerify("Truecaller is not available. Verify with missed call / OTP.");
        }
    }

    private void showManualVerify(String note) {
        unlocked = false;
        LinearLayout box = authHeader("Enter your name and mobile number. You'll get a free missed call or OTP to verify.");

        EditText name = authField("Your name", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_WORDS, 40);
        box.addView(name, new LinearLayout.LayoutParams(-1, -2));

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
        LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(-1, -2);
        rp.topMargin = dp(12);
        box.addView(row, rp);

        tcStatus = authMsg(box);
        if (note != null) setStatus(note, true);
        Button go = authButton("Verify mobile number");
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(-1, dp(52));
        bp.topMargin = dp(12);
        box.addView(go, bp);

        go.setOnClickListener(v -> {
            String n = name.getText().toString().trim();
            String d = phone.getText().toString().replaceAll("\\D", "");
            if (n.length() < 2) { setStatus("Please enter your name.", true); return; }
            if (!d.matches("[6-9]\\d{9}")) { setStatus("Enter a valid 10-digit mobile number.", true); return; }
            if (!tcReady) { setStatus("Verification service is not available in this app build.", true); return; }
            hideKeyboard(phone);
            pendingName = n;
            pendingPhone = d;
            setStatus("Requesting verification…", false);
            requestPermsThenVerify();
        });
        showScreen(box, name);
    }

    // Missed-call verification needs call permissions; if refused, Truecaller sends an OTP instead.
    private void requestPermsThenVerify() {
        List<String> need = new ArrayList<>();
        need.add(Manifest.permission.READ_PHONE_STATE);
        need.add(Manifest.permission.READ_CALL_LOG);
        if (Build.VERSION.SDK_INT >= 26) need.add(Manifest.permission.ANSWER_PHONE_CALLS);
        else need.add(Manifest.permission.CALL_PHONE);
        List<String> missing = new ArrayList<>();
        for (String p : need) {
            if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) missing.add(p);
        }
        if (missing.isEmpty()) {
            doRequestVerification();
        } else {
            requestPermissions(missing.toArray(new String[0]), PERM_REQUEST);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == PERM_REQUEST) doRequestVerification();
    }

    private void doRequestVerification() {
        try {
            TcSdk.getInstance().requestVerification("IN", pendingPhone, tcVerifyCallback, this);
        } catch (Exception e) {
            setStatus("Could not start verification: " + e.getMessage(), true);
        }
    }

    private void showWaiting(String text) {
        LinearLayout box = authHeader(text);
        ProgressBar pb = new ProgressBar(this);
        box.addView(pb, new LinearLayout.LayoutParams(-2, -2));
        tcStatus = authMsg(box);
        TextView back = new TextView(this);
        back.setText("Change number");
        back.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        back.setTextColor(Color.parseColor("#4D5BF9"));
        back.setGravity(Gravity.CENTER);
        back.setPadding(0, dp(18), 0, dp(8));
        back.setOnClickListener(v -> showManualVerify(null));
        box.addView(back, new LinearLayout.LayoutParams(-1, -2));
        showScreen(box, null);
    }

    private void showTcOtpEntry() {
        LinearLayout box = authHeader("Enter the OTP sent to +91 " + pendingPhone);
        EditText otp = authField("OTP", InputType.TYPE_CLASS_NUMBER, 6);
        otp.setGravity(Gravity.CENTER);
        otp.setLetterSpacing(0.3f);
        box.addView(otp, new LinearLayout.LayoutParams(-1, -2));
        tcStatus = authMsg(box);
        Button verify = authButton("Verify OTP");
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(-1, dp(52));
        bp.topMargin = dp(12);
        box.addView(verify, bp);
        TextView back = new TextView(this);
        back.setText("Change number");
        back.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        back.setTextColor(Color.parseColor("#4D5BF9"));
        back.setGravity(Gravity.CENTER);
        back.setPadding(0, dp(18), 0, dp(8));
        back.setOnClickListener(v -> showManualVerify(null));
        box.addView(back, new LinearLayout.LayoutParams(-1, -2));
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
