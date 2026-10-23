package com.vivo.bidashboard;

import android.content.Context;

import java.util.HashMap;
import java.util.Map;

/** Texts for the app's own screens in English and Hindi. The dashboard itself comes from the website. */
final class L {
    private L() { }

    static final String[] LANG_CODES = {"en", "hi"};
    static final String[] LANG_NAMES = {"English", "हिन्दी (Hindi)"};

    private static final Map<String, String[]> T = new HashMap<>();

    private static void put(String key, String en, String hi) { T.put(key, new String[]{en, hi}); }

    static {
        // Login
        put("login_sub", "Log in with your user name and password", "अपने यूज़र नेम और पासवर्ड से लॉग इन करें");
        put("username", "User name", "यूज़र नेम");
        put("password", "Password", "पासवर्ड");
        put("show_password", "Show password", "पासवर्ड दिखाएँ");
        put("login", "Log in", "लॉग इन");
        put("logging_in", "Logging in…", "लॉग इन हो रहा है…");
        put("forgot", "Forgot password?", "पासवर्ड भूल गए?");
        put("new_user", "New user? Sign up", "नए यूज़र? साइन अप करें");
        put("enter_user_pass", "Enter your user name and password.", "अपना यूज़र नेम और पासवर्ड डालें।");
        put("language", "Language", "भाषा");
        // Sign up
        put("signup_sub", "Create your account. Your mobile number is verified once with Truecaller.",
                "अपना अकाउंट बनाएँ। आपका मोबाइल नंबर एक बार Truecaller से वेरिफ़ाई होगा।");
        put("full_name", "Full name", "पूरा नाम");
        put("choose_username", "Choose a user name (for login)", "यूज़र नेम चुनें (लॉग इन के लिए)");
        put("mobile", "10-digit mobile number", "10 अंकों का मोबाइल नंबर");
        put("create_password", "Create password (min 6 characters)", "पासवर्ड बनाएँ (कम से कम 6 अक्षर)");
        put("confirm_password", "Confirm password", "पासवर्ड दोबारा डालें");
        put("access_code", "Access code (from your BI admin)", "एक्सेस कोड (BI एडमिन से)");
        put("verify_create", "Verify mobile & create account", "मोबाइल वेरिफ़ाई करें और अकाउंट बनाएँ");
        put("have_account", "Already have an account? Log in", "पहले से अकाउंट है? लॉग इन करें");
        put("checking", "Checking…", "जाँच हो रही है…");
        put("err_name", "Please enter your full name.", "कृपया अपना पूरा नाम डालें।");
        put("err_username", "User name must be at least 3 characters.", "यूज़र नेम कम से कम 3 अक्षर का होना चाहिए।");
        put("err_mobile", "Enter a valid 10-digit mobile number.", "सही 10 अंकों का मोबाइल नंबर डालें।");
        put("err_pw_short", "Password must be at least 6 characters.", "पासवर्ड कम से कम 6 अक्षर का होना चाहिए।");
        put("err_pw_match", "Passwords do not match.", "पासवर्ड मेल नहीं खाते।");
        put("err_code", "Enter the access code from your BI admin.", "BI एडमिन से मिला एक्सेस कोड डालें।");
        put("creating", "Mobile verified. Creating your account…", "मोबाइल वेरिफ़ाई हुआ। अकाउंट बन रहा है…");
        put("back_signup", "Back to sign up", "साइन अप पर वापस जाएँ");
        put("welcome", "Account created. Welcome, %s!", "अकाउंट बन गया। स्वागत है, %s!");
        // Forgot password
        put("forgot_sub", "Enter the mobile number of your account. We'll verify it with Truecaller, then you can set a new password.",
                "अपने अकाउंट का मोबाइल नंबर डालें। Truecaller से वेरिफ़ाई करने के बाद आप नया पासवर्ड बना सकेंगे।");
        put("verify_mobile", "Verify mobile", "मोबाइल वेरिफ़ाई करें");
        put("back_login", "Back to log in", "लॉग इन पर वापस जाएँ");
        put("new_pw_sub", "Mobile verified. Set a new password.", "मोबाइल वेरिफ़ाई हुआ। नया पासवर्ड बनाएँ।");
        put("new_password", "New password (min 6 characters)", "नया पासवर्ड (कम से कम 6 अक्षर)");
        put("confirm_new_password", "Confirm new password", "नया पासवर्ड दोबारा डालें");
        put("save_new_password", "Save new password", "नया पासवर्ड सेव करें");
        put("saving", "Saving…", "सेव हो रहा है…");
        put("pw_changed_login", "Password changed. Your user name is %s. Please log in.",
                "पासवर्ड बदल गया। आपका यूज़र नेम %s है। कृपया लॉग इन करें।");
        put("cancel", "Cancel", "रद्द करें");
        // Truecaller verification
        put("opening_tc", "Opening Truecaller…", "Truecaller खुल रहा है…");
        put("confirming_tc", "Confirming your number with Truecaller…", "Truecaller से नंबर की पुष्टि हो रही है…");
        put("perm_missed_call", "Asking for permissions to detect the missed call…", "मिस्ड कॉल पहचानने के लिए अनुमति माँगी जा रही है…");
        put("contacting_tc", "Contacting Truecaller for a missed call / OTP…", "मिस्ड कॉल / OTP के लिए Truecaller से संपर्क हो रहा है…");
        put("missed_call_wait", "You will get a missed call on +91 %s. Don't answer it — it is verified automatically.",
                "आपको +91 %s पर एक मिस्ड कॉल आएगी। उसे न उठाएँ — वेरिफ़िकेशन अपने-आप होगा।");
        put("missed_call_got", "Missed call received. Verifying…", "मिस्ड कॉल मिल गई। वेरिफ़ाई हो रहा है…");
        put("otp_sent", "Enter the OTP sent to +91 %s", "+91 %s पर भेजा गया OTP डालें");
        put("otp_sent_tc", "Enter the OTP sent to your Truecaller app on +91 %s", "+91 %s के Truecaller ऐप पर भेजा गया OTP डालें");
        put("otp", "OTP", "OTP");
        put("verify_otp", "Verify OTP", "OTP वेरिफ़ाई करें");
        put("enter_otp", "Enter the OTP.", "OTP डालें।");
        put("otp_got", "OTP received. Verifying…", "OTP मिल गया। वेरिफ़ाई हो रहा है…");
        put("verifying", "Verifying…", "वेरिफ़ाई हो रहा है…");
        put("verify_failed", "Verification failed. Please try again.", "वेरिफ़िकेशन नहीं हुआ। फिर से कोशिश करें।");
        put("tc_no_reply", "Truecaller did not respond. Check that your number is a test number in the Truecaller console (until it's approved) and your internet is on, then try again.",
                "Truecaller से जवाब नहीं आया। जाँचें कि आपका नंबर Truecaller कंसोल में टेस्ट नंबर है (मंज़ूरी तक) और इंटरनेट चालू है, फिर कोशिश करें।");
        put("tc_mismatch", "Your Truecaller number is +91 %s, not +91 %s. Enter +91 %s, or tap again and choose 'Use another number' in Truecaller.",
                "आपका Truecaller नंबर +91 %s है, +91 %s नहीं। +91 %s डालें, या फिर से टैप करके Truecaller में 'दूसरा नंबर' चुनें।");
        put("tc_failed", "Truecaller login didn't finish. Trying missed call / OTP…", "Truecaller लॉग इन पूरा नहीं हुआ। मिस्ड कॉल / OTP से कोशिश हो रही है…");
        put("tc_unavailable", "Mobile verification is not available. Please update the app.", "मोबाइल वेरिफ़िकेशन उपलब्ध नहीं है। ऐप अपडेट करें।");
        // Top bar + profile
        put("profile", "Profile", "प्रोफ़ाइल");
        put("change_photo", "Change photo", "फ़ोटो बदलें");
        put("remove_photo", "Remove photo", "फ़ोटो हटाएँ");
        put("profile_photo", "Profile photo", "प्रोफ़ाइल फ़ोटो");
        put("uploading_photo", "Uploading photo…", "फ़ोटो अपलोड हो रही है…");
        put("photo_updated", "Profile photo updated", "प्रोफ़ाइल फ़ोटो अपडेट हो गई");
        put("photo_failed", "Couldn't use this photo. Please choose another.", "यह फ़ोटो इस्तेमाल नहीं हो सकी। दूसरी चुनें।");
        put("state_app", "State app", "स्टेट ऐप");
        put("admin_app", "Admin app", "एडमिन ऐप");
        put("sec_account", "Account", "अकाउंट");
        put("edit_profile", "Edit profile", "प्रोफ़ाइल बदलें");
        put("change_password", "Change password", "पासवर्ड बदलें");
        put("sec_settings", "Settings", "सेटिंग्स");
        put("text_size", "Dashboard text size", "डैशबोर्ड टेक्स्ट साइज़");
        put("keep_screen_on", "Keep screen on", "स्क्रीन चालू रखें");
        put("sec_data", "Dashboard data", "डैशबोर्ड डेटा");
        put("refresh", "Refresh dashboard", "डैशबोर्ड रीफ़्रेश करें");
        put("clear_cache", "Clear cache & reload", "कैश साफ़ करें और रीलोड करें");
        put("live_data", "Data loads live from the dashboard website", "डेटा सीधे डैशबोर्ड वेबसाइट से आता है");
        put("cache_cleared", "Cache cleared. Loading latest data…", "कैश साफ़ हो गया। नया डेटा लोड हो रहा है…");
        put("sec_support", "Help & support", "सहायता");
        put("share_app", "Share app", "ऐप शेयर करें");
        put("share_text", "Download the %s app: %s", "%s ऐप डाउनलोड करें: %s");
        put("privacy", "Privacy policy", "प्राइवेसी पॉलिसी");
        put("terms", "Terms of service", "सेवा की शर्तें");
        put("sec_about", "About", "जानकारी");
        put("app_version", "App version", "ऐप वर्ज़न");
        put("member_since", "Member since", "सदस्यता");
        put("logout", "Log out", "लॉग आउट");
        put("logout_confirm", "Log out from this phone? You'll need your user name and password to log in again.",
                "इस फ़ोन से लॉग आउट करें? दोबारा लॉग इन के लिए यूज़र नेम और पासवर्ड चाहिए होगा।");
        put("delete_account", "Delete my account", "मेरा अकाउंट डिलीट करें");
        put("delete_confirm", "This permanently deletes your account. Enter your password to confirm.",
                "इससे आपका अकाउंट हमेशा के लिए डिलीट हो जाएगा। पुष्टि के लिए पासवर्ड डालें।");
        put("delete", "Delete", "डिलीट करें");
        put("account_deleted", "Your account has been deleted.", "आपका अकाउंट डिलीट हो गया।");
        put("logged_out_elsewhere", "You were logged out (password changed or reset). Please log in again.",
                "आप लॉग आउट हो गए (पासवर्ड बदला या रीसेट हुआ)। कृपया फिर से लॉग इन करें।");
        // Edit profile / change password
        put("email_optional", "Email (optional)", "ईमेल (वैकल्पिक)");
        put("state_optional", "State / region (optional)", "राज्य / क्षेत्र (वैकल्पिक)");
        put("designation_optional", "Designation (optional)", "पद (वैकल्पिक)");
        put("save", "Save", "सेव करें");
        put("saved", "Saved", "सेव हो गया");
        put("current_password", "Current password", "मौजूदा पासवर्ड");
        put("pw_changed", "Password changed. Other phones have been logged out.", "पासवर्ड बदल गया। दूसरे फ़ोन लॉग आउट हो गए।");
        put("readonly_note", "User name and mobile number can't be changed.", "यूज़र नेम और मोबाइल नंबर नहीं बदले जा सकते।");
        put("ok", "OK", "ठीक है");
        put("size_small", "Small", "छोटा");
        put("size_normal", "Normal", "सामान्य");
        put("size_large", "Large", "बड़ा");
        put("size_xlarge", "Extra large", "बहुत बड़ा");
        put("search", "Search", "खोजें");
        put("assistant", "BI Assistant", "BI असिस्टेंट");
        put("assistant_loading", "Dashboard is still loading. Please try again in a moment.", "डैशबोर्ड लोड हो रहा है। थोड़ी देर में फिर कोशिश करें।");
        put("sec_admin", "Admin tools", "एडमिन टूल्स");
        put("registered_users", "Registered users", "रजिस्टर्ड यूज़र");
        put("access_logs", "Access logs", "एक्सेस लॉग");
        put("state_app_users", "State app users", "स्टेट ऐप यूज़र");
        put("admin_app_users", "Admin app users", "एडमिन ऐप यूज़र");
        put("search_users", "Search name, user name, mobile, state", "नाम, यूज़र नेम, मोबाइल, राज्य खोजें");
        put("loading", "Loading…", "लोड हो रहा है…");
        put("joined", "Joined", "जुड़े");
        put("last_seen", "Last seen", "आख़िरी बार");
        put("users_count", "Showing %d of %d users · tap a user to call or change state", "%2$d में से %1$d यूज़र · कॉल या राज्य बदलने के लिए टैप करें");
        put("all_apps", "All", "सभी");
        put("no_logs", "No activity on this day.", "इस दिन कोई गतिविधि नहीं।");
        put("logs_count", "%d events by %d users (newest first)", "%2$d यूज़र्स की %1$d गतिविधियाँ (नई पहले)");
        put("ev_open", "Opened the app", "ऐप खोला");
        put("ev_login", "Logged in", "लॉग इन किया");
        put("ev_signup", "Signed up", "साइन अप किया");
        put("ev_logout", "Logged out", "लॉग आउट किया");
        put("ev_password_reset", "Reset password", "पासवर्ड रीसेट किया");
        put("support_desk", "Support desk", "सपोर्ट डेस्क");
        put("support_intro_state", "Ask about the dashboard. BI admins reply here; you see your state's queries.",
                "डैशबोर्ड के बारे में पूछें। BI एडमिन यहीं जवाब देंगे; आपको अपने राज्य के सवाल दिखेंगे।");
        put("support_intro_admin", "Queries from state teams. Reply to answer; the requester can rate your reply.",
                "स्टेट टीमों के सवाल। जवाब दें; सवाल पूछने वाला आपके जवाब को रेटिंग दे सकता है।");
        put("raise_query", "Raise a query", "सवाल पूछें");
        put("f_all", "All", "सभी");
        put("f_mine", "My queries", "मेरे सवाल");
        put("st_open", "Open", "खुला");
        put("st_answered", "Answered", "जवाब मिला");
        put("st_closed", "Closed", "बंद");
        put("no_queries", "No queries here yet.", "यहाँ अभी कोई सवाल नहीं है।");
        put("queries_count", "%d queries · newest activity first", "%d सवाल · नई गतिविधि पहले");
        put("attach", "Attach file", "फ़ाइल जोड़ें");
        put("attach_note", "PDF, Excel, Word, PowerPoint, CSV, text or image/screenshot · up to 4 MB each, 5 files",
                "PDF, Excel, Word, PowerPoint, CSV, टेक्स्ट या इमेज/स्क्रीनशॉट · हर फ़ाइल 4 MB तक, 5 फ़ाइलें");
        put("q_topic", "Topic (dashboard section)", "विषय (डैशबोर्ड सेक्शन)");
        put("q_kpi", "KPI (optional)", "KPI (वैकल्पिक)");
        put("q_state", "State / region", "राज्य / क्षेत्र");
        put("q_subject", "Subject", "विषय पंक्ति");
        put("q_subject_hint", "e.g. Our rank looks wrong for October", "जैसे: अक्टूबर की रैंक गलत लग रही है");
        put("q_details", "Details", "विवरण");
        put("q_details_hint", "Describe the issue: which page, period and numbers", "समस्या बताएँ: कौन सा पेज, अवधि और आँकड़े");
        put("submit_query", "Submit query", "सवाल भेजें");
        put("err_subject", "Please enter a short subject.", "छोटी विषय पंक्ति डालें।");
        put("err_details", "Please describe your query.", "अपना सवाल बताएँ।");
        put("query_sent", "Query sent to BI admins", "सवाल BI एडमिन को भेज दिया गया");
        put("query", "Query", "सवाल");
        put("raised_by", "Raised by", "पूछने वाले");
        put("bi_admin", "BI Admin", "BI एडमिन");
        put("your_rating", "Your rating:", "आपकी रेटिंग:");
        put("rate_reply", "Rate this reply:", "इस जवाब को रेट करें:");
        put("thanks_rating", "Thanks for your rating!", "रेटिंग के लिए धन्यवाद!");
        put("rated", "Rated", "रेटिंग");
        put("add_comment", "Add a comment", "टिप्पणी लिखें");
        put("write_reply", "Write a reply", "जवाब लिखें");
        put("send", "Send", "भेजें");
        put("send_reply", "Send reply", "जवाब भेजें");
        put("err_reply", "Write a message or attach a file.", "संदेश लिखें या फ़ाइल जोड़ें।");
        put("reopen", "Reopen query", "सवाल फिर से खोलें");
        put("mark_closed", "Mark as closed", "बंद करें");
        put("max_files", "You can attach up to 5 files.", "अधिकतम 5 फ़ाइलें जोड़ सकते हैं।");
        put("uploading", "Uploading", "अपलोड हो रहा है");
        put("file_too_big", "File is larger than 4 MB.", "फ़ाइल 4 MB से बड़ी है।");
        put("downloading", "Downloading…", "डाउनलोड हो रहा है…");
        put("sec_tools", "Help & tools", "सहायता और टूल्स");
        put("payout_calc", "Payout calculator", "पेआउट कैलकुलेटर");
        put("pick_state_sub", "Select the state you belong to. You'll see Active retailer IDs for this state only.",
                "अपना राज्य चुनें। आप केवल इसी राज्य के एक्टिव रिटेलर ID देख पाएँगे।");
        put("select_state", "Select your state", "अपना राज्य चुनें");
        put("err_state", "Please select your state.", "कृपया अपना राज्य चुनें।");
        put("your_state", "Your state", "आपका राज्य");
        put("state_locked_note", "Your state decides which Active retailer IDs you can see. Ask a BI admin to change it.",
                "आपका राज्य तय करता है कि कौन से एक्टिव रिटेलर ID दिखेंगे। बदलने के लिए BI एडमिन से कहें।");
        put("call", "Call", "कॉल करें");
        put("change_state", "Change state", "राज्य बदलें");
        put("admin_insights", "Admin insights", "एडमिन इनसाइट्स");
        put("access_insights", "Access logs & insights", "एक्सेस लॉग और इनसाइट्स");
        put("support_report", "Support desk report", "सपोर्ट डेस्क रिपोर्ट");
        put("raise_sub", "Pick a topic, describe the issue and attach a screenshot if you can.", "विषय चुनें, समस्या बताएँ और हो सके तो स्क्रीनशॉट जोड़ें।");
        put("attachments_opt", "Attachments (optional)", "अटैचमेंट (वैकल्पिक)");
        put("err_topic", "Please choose a topic.", "कृपया विषय चुनें।");
        put("rate_question", "How helpful was this reply?", "यह जवाब कितना मददगार था?");
        put("you_rated", "You rated this reply %d/5 · tap to change", "आपने इस जवाब को %d/5 दिया · बदलने के लिए टैप करें");
        put("rate_hint", "4–5★ closes the query · 1–3★ keeps it open for another reply", "4–5★ पर सवाल बंद · 1–3★ पर दोबारा जवाब के लिए खुला रहेगा");
        put("rated_closed", "Thanks! Rating saved and query closed.", "धन्यवाद! रेटिंग सेव हुई और सवाल बंद हो गया।");
        put("rated_open", "Thanks! Query stays open so an admin can help further.", "धन्यवाद! सवाल खुला है ताकि एडमिन आगे मदद कर सकें।");
        put("disabled", "Disabled", "निष्क्रिय");
        put("disabled_by", "Disabled by %s · %s", "%s ने निष्क्रिय किया · %s");
        put("disable_account", "Disable account", "अकाउंट निष्क्रिय करें");
        put("enable_account", "Enable account", "अकाउंट फिर से चालू करें");
        put("disable", "Disable", "निष्क्रिय करें");
        put("enable", "Enable", "चालू करें");
        put("reason_optional", "Reason (optional)", "कारण (वैकल्पिक)");
        put("disable_confirm", "They'll be logged out of the app and web, and can't log in until you enable the account again.",
                "उन्हें ऐप और वेब से लॉग आउट कर दिया जाएगा, और जब तक आप अकाउंट चालू नहीं करते, वे लॉग इन नहीं कर पाएँगे।");
        put("enable_confirm", "They'll be able to log in again with their user name and password.", "वे अपने यूज़र नेम और पासवर्ड से फिर से लॉग इन कर पाएँगे।");
        put("account_disabled", "Account disabled", "अकाउंट निष्क्रिय किया गया");
        put("account_enabled", "Account enabled", "अकाउंट चालू किया गया");
        // v4.4: surveys, web QR login, updates, notifications
        put("surveys", "Surveys", "सर्वे");
        put("survey_manager", "Survey manager", "सर्वे मैनेजर");
        put("new_survey", "New survey from BI admin", "BI एडमिन का नया सर्वे");
        put("survey_by", "Please answer by %s", "कृपया %s तक जवाब दें");
        put("survey_quick", "It takes only a few minutes.", "इसमें बस कुछ मिनट लगेंगे।");
        put("surveys_waiting", "%d surveys are waiting for you", "%d सर्वे आपका इंतज़ार कर रहे हैं");
        put("answer_now", "Answer now", "अभी जवाब दें");
        put("later", "Later", "बाद में");
        put("choose_file", "Choose file", "फ़ाइल चुनें");
        put("scan_qr", "Scan web login QR", "वेब लॉग इन QR स्कैन करें");
        put("qr_prompt", "Scan the QR code on the dashboard login page", "डैशबोर्ड लॉग इन पेज पर दिख रहा QR कोड स्कैन करें");
        put("qr_invalid", "This is not a vivo BI web login code.", "यह vivo BI वेब लॉग इन कोड नहीं है।");
        put("qr_login_first", "Log in to the app first, then scan the code again.", "पहले ऐप में लॉग इन करें, फिर कोड दोबारा स्कैन करें।");
        put("qr_confirm_title", "Log in on the web?", "वेब पर लॉग इन करें?");
        put("qr_confirm_msg", "Device: %1$s\n\nThe web dashboard will open as %2$s (%3$s). Allow only if this is your own computer or screen.",
                "डिवाइस: %1$s\n\nवेब डैशबोर्ड %2$s (%3$s) के रूप में खुलेगा। तभी अनुमति दें जब यह आपका अपना कंप्यूटर या स्क्रीन हो।");
        put("qr_allow", "Allow", "अनुमति दें");
        put("qr_decline", "Decline", "मना करें");
        put("qr_done", "Done — the web dashboard is now logged in.", "हो गया — वेब डैशबोर्ड में लॉग इन हो गया।");
        put("state_user", "State user", "स्टेट यूज़र");
        put("admin_user", "Admin user", "एडमिन यूज़र");
        put("check_update", "Check for updates", "अपडेट देखें");
        put("upd_checking", "Checking for updates…", "अपडेट देख रहे हैं…");
        put("upd_latest", "You have the latest version (%s).", "आपके पास नया वर्ज़न (%s) है।");
        put("upd_title", "Update available", "अपडेट उपलब्ध है");
        put("upd_msg", "Version %1$s is ready (you have %2$s).", "वर्ज़न %1$s तैयार है (आपके पास %2$s है)।");
        put("upd_whats_new", "What's new:", "नया क्या है:");
        put("upd_now", "Update now", "अभी अपडेट करें");
        put("upd_downloading", "Downloading the update…", "अपडेट डाउनलोड हो रहा है…");
        put("upd_progress", "%1$d%% · %2$.1f of %3$.1f MB", "%1$d%% · %3$.1f में से %2$.1f MB");
        put("upd_failed", "Download didn't finish. Opening the download link instead.", "डाउनलोड पूरा नहीं हुआ। डाउनलोड लिंक खोल रहे हैं।");
        put("upd_allow_title", "Allow app updates", "ऐप अपडेट की अनुमति दें");
        put("upd_allow_msg", "To install the update, turn on \"Allow from this source\" for this app on the next screen, then come back.",
                "अपडेट इंस्टॉल करने के लिए अगली स्क्रीन पर इस ऐप के लिए \"इस सोर्स से अनुमति दें\" चालू करें, फिर वापस आएँ।");
        put("upd_open_settings", "Open settings", "सेटिंग्स खोलें");
        put("notif_channel", "BI updates", "BI अपडेट");
        put("notif_channel_desc", "New surveys, support replies and app updates", "नए सर्वे, सपोर्ट जवाब और ऐप अपडेट");
        put("notif_survey_title", "📋 New survey from BI admin", "📋 BI एडमिन का नया सर्वे");
        put("notif_resp_title", "📋 New survey answers", "📋 सर्वे के नए जवाब");
        put("notif_resp_msg", "%d survey(s) have new answers. Tap to see results.", "%d सर्वे में नए जवाब आए हैं। नतीजे देखने के लिए टैप करें।");
        put("notif_support_msg", "You have %d unread support desk update(s).", "सपोर्ट डेस्क में %d नए अपडेट हैं।");
        put("notif_update_title", "⬆️ App update available", "⬆️ ऐप अपडेट उपलब्ध");
        put("notif_update_msg", "Version %s is ready. Tap to update.", "वर्ज़न %s तैयार है। अपडेट करने के लिए टैप करें।");
        // v4.5: messages and feature usability matrix
        put("messages", "Messages", "मैसेज");
        put("feature_matrix", "Feature usability", "फ़ीचर उपयोग");
        put("matrix_popup", "Please tick the features your state uses and confirm your row.", "कृपया अपने राज्य में इस्तेमाल होने वाले फ़ीचर टिक करें और अपनी पंक्ति कन्फ़र्म करें।");
        put("matrix_update", "Update my state", "मेरा राज्य अपडेट करें");
        put("notif_chat_title", "New message from %s", "%s का नया मैसेज");
        // v4.6: Truecaller switch, admin-approved password reset
        put("signup_sub_plain", "Create your account with a user name and password.", "यूज़र नेम और पासवर्ड से अपना अकाउंट बनाएँ।");
        put("create_account", "Create account", "अकाउंट बनाएँ");
        put("reset_req_sub", "Choose a new password. A BI admin checks the request (usually by calling you) and approves it.",
                "नया पासवर्ड चुनें। BI एडमिन अनुरोध की जाँच करेंगे (आमतौर पर कॉल करके) और मंज़ूरी देंगे।");
        put("user_or_mobile", "User name or mobile number", "यूज़र नेम या मोबाइल नंबर");
        put("err_user_or_mobile", "Enter your user name or mobile number.", "अपना यूज़र नेम या मोबाइल नंबर डालें।");
        put("reset_note", "Message for the admin (optional)", "एडमिन के लिए संदेश (वैकल्पिक)");
        put("send_reset_request", "Send reset request", "रीसेट अनुरोध भेजें");
        put("reset_req_title", "Password reset request", "पासवर्ड रीसेट अनुरोध");
        put("check_status", "Check status", "स्थिति देखें");
        put("new_reset_request", "Send a new request", "नया अनुरोध भेजें");
        put("reset_waiting", "⏳ Waiting for a BI admin to approve the new password for %1$s (sent %2$s). The admin may call you to confirm.",
                "⏳ %1$s के नए पासवर्ड की मंज़ूरी का इंतज़ार है (भेजा %2$s)। एडमिन पुष्टि के लिए कॉल कर सकते हैं।");
        put("reset_approved", "✅ Approved. Log in as %s with the new password you chose.", "✅ मंज़ूर। %s के रूप में अपने नए पासवर्ड से लॉग इन करें।");
        put("reset_rejected", "✕ Not approved. Your password is unchanged. Contact your BI admin or send a new request.",
                "✕ मंज़ूर नहीं हुआ। आपका पासवर्ड नहीं बदला। BI एडमिन से संपर्क करें या नया अनुरोध भेजें।");
        put("reset_gone", "This request is no longer available. Send a new one if you still need it.", "यह अनुरोध अब उपलब्ध नहीं है। ज़रूरत हो तो नया भेजें।");
        put("reset_pending_login", "⏳ Password reset request sent — tap Forgot password? to check its status.", "⏳ पासवर्ड रीसेट अनुरोध भेजा गया — स्थिति देखने के लिए पासवर्ड भूल गए? पर टैप करें।");
        put("account_security", "Account security", "अकाउंट सुरक्षा");
        put("n_reset_requests", "%d password reset request(s) waiting", "%d पासवर्ड रीसेट अनुरोध बाकी");
        // v4.7: state users sign up / log in with vChat ID
        put("vchat_id", "vChat ID", "vChat ID");
        put("login_sub_vchat", "Log in with your vChat ID and password", "अपनी vChat ID और पासवर्ड से लॉग इन करें");
        put("enter_vchat_pass", "Enter your vChat ID and password.", "अपनी vChat ID और पासवर्ड डालें।");
        put("signup_sub_vchat", "Sign up with your vChat ID. Your state is filled in from vChat.", "अपनी vChat ID से साइन अप करें। आपका राज्य vChat से अपने आप भरेगा।");
        put("vchat_state_hint", "State: filled automatically from your vChat ID", "राज्य: आपकी vChat ID से अपने आप भरेगा");
        put("state", "State", "राज्य");
        put("vchat_mobile", "vChat registered mobile number", "vChat में रजिस्टर्ड मोबाइल नंबर");
        put("email_required", "Email", "ईमेल");
        put("access_code_vchat", "Access code (tap i for help)", "एक्सेस कोड (मदद के लिए i दबाएँ)");
        put("access_code_info_title", "How to make the access code", "एक्सेस कोड कैसे बनाएँ");
        put("access_code_info", "First 4 letters of your name as on vChat (small letters, no spaces) + last 4 digits of your vChat registered mobile number.\n\nExample: Ravi Kumar, mobile 98765 43210 → ravi3210",
                "vChat में आपके नाम के पहले 4 अक्षर (छोटे अक्षर, बिना स्पेस) + vChat में रजिस्टर्ड मोबाइल के आख़िरी 4 अंक।\n\nउदाहरण: Ravi Kumar, मोबाइल 98765 43210 → ravi3210");
        put("err_vchat", "Enter your vChat ID.", "अपनी vChat ID डालें।");
        put("err_vchat_lookup", "Enter a vChat ID from the allowed list — the state fills in automatically.", "अनुमति सूची वाली vChat ID डालें — राज्य अपने आप भरेगा।");
        put("err_vchat_mobile", "Enter your 10-digit vChat registered mobile number.", "vChat में रजिस्टर्ड 10 अंकों का मोबाइल नंबर डालें।");
        put("err_email", "Enter a valid email address.", "सही ईमेल पता डालें।");
        put("err_code_vchat", "Enter the access code (tap i to see how).", "एक्सेस कोड डालें (कैसे बनाएँ, देखने के लिए i दबाएँ)।");
        put("link_vchat_sub", "One-time step: link your vChat ID to keep using the app. Your state comes from vChat.", "एक बार का काम: ऐप इस्तेमाल करते रहने के लिए अपनी vChat ID जोड़ें। आपका राज्य vChat से आएगा।");
        put("link_vchat", "Link vChat ID", "vChat ID जोड़ें");
        put("vchat_linked", "vChat ID linked. Next time log in with your vChat ID.", "vChat ID जुड़ गई। अगली बार vChat ID से लॉग इन करें।");
        put("vchat_user_or_mobile", "vChat ID, user name or mobile number", "vChat ID, यूज़र नेम या मोबाइल नंबर");
        put("vchat_directory", "vChat directory", "vChat डायरेक्टरी");
        // v4.8: Verify on WhatsApp
        put("wa_preparing", "Preparing WhatsApp verification…", "WhatsApp वेरिफ़िकेशन तैयार हो रहा है…");
        put("wa_send_from_this", "Send this message on WhatsApp from the mobile number you entered:", "आपने जो मोबाइल नंबर डाला है, उसके WhatsApp से यह मैसेज भेजें:");
        put("wa_send_from_masked", "Send this message on WhatsApp from your registered mobile (%s):", "अपने रजिस्टर्ड मोबाइल (%s) के WhatsApp से यह मैसेज भेजें:");
        put("wa_open", "Open WhatsApp & send", "WhatsApp खोलें और भेजें");
        put("wa_waiting", "⏳ Waiting for your WhatsApp message… Send it as it is, then come back here.", "⏳ आपके WhatsApp मैसेज का इंतज़ार… मैसेज जैसा है वैसा भेजें, फिर यहाँ वापस आएँ।");
        put("wa_not_installed", "WhatsApp isn't installed on this phone.", "इस फ़ोन में WhatsApp इंस्टॉल नहीं है।");
        put("wa_verified", "✅ Mobile verified on WhatsApp", "✅ WhatsApp पर मोबाइल वेरिफ़ाई हुआ");
        put("wa_mismatch", "The message came from a different WhatsApp number (%s). Send it from the WhatsApp on the correct mobile.", "मैसेज किसी दूसरे WhatsApp नंबर (%s) से आया। सही मोबाइल के WhatsApp से भेजें।");
        put("wa_expired", "The code expired. Please try again.", "कोड की समय-सीमा खत्म हो गई। कृपया फिर से कोशिश करें।");
        put("forgot_wa_sub", "Verify on WhatsApp from your registered mobile, then your new password is saved.", "अपने रजिस्टर्ड मोबाइल के WhatsApp से वेरिफ़ाई करें, फिर नया पासवर्ड सेव हो जाएगा।");
        put("wa_verify_save", "Verify on WhatsApp & save", "WhatsApp पर वेरिफ़ाई करें और सेव करें");
        put("wa_no_whatsapp", "No WhatsApp on that mobile? Ask an admin instead", "उस मोबाइल पर WhatsApp नहीं है? एडमिन से अनुरोध करें");
        put("pw_changed_wa", "Password changed. Log in with your new password.", "पासवर्ड बदल गया। नए पासवर्ड से लॉग इन करें।");
        put("no_internet", "No internet connection. Please try again.", "इंटरनेट कनेक्शन नहीं है। फिर से कोशिश करें।");
    }

    static String lang(Context c) {
        return c.getSharedPreferences("settings", Context.MODE_PRIVATE).getString("lang", "en");
    }

    static void setLang(Context c, String code) {
        c.getSharedPreferences("settings", Context.MODE_PRIVATE).edit().putString("lang", code).apply();
    }

    static String t(Context c, String key) {
        String[] v = T.get(key);
        if (v == null) return key;
        return "hi".equals(lang(c)) ? v[1] : v[0];
    }

    static String f(Context c, String key, Object... args) {
        return String.format(t(c, key), args);
    }

    static String langName(Context c) {
        return "hi".equals(lang(c)) ? LANG_NAMES[1] : LANG_NAMES[0];
    }
}
