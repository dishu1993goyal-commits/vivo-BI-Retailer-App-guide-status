package com.vivo.bidashboard;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.concurrent.TimeUnit;

/**
 * Checks every ~30 minutes (while the phone allows background work) for new surveys,
 * new survey answers (admins), support desk replies and app updates, and shows phone notifications.
 */
public class NotifyWorker extends Worker {
    static final String CHANNEL = "bi_updates";
    private static final String WORK = "bi-notify";

    public NotifyWorker(@NonNull Context c, @NonNull WorkerParameters p) { super(c, p); }

    static void schedule(Context c) {
        Constraints cons = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(NotifyWorker.class, 30, TimeUnit.MINUTES)
                .setConstraints(cons).setInitialDelay(10, TimeUnit.MINUTES).build();
        WorkManager.getInstance(c).enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.KEEP, req);
    }

    static void cancel(Context c) {
        WorkManager.getInstance(c).cancelUniqueWork(WORK);
    }

    static void ensureChannel(Context c) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, L.t(c, "notif_channel"), NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription(L.t(c, "notif_channel_desc"));
            c.getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
    }

    static void post(Context c, int id, String title, String text, String open) {
        if (Build.VERSION.SDK_INT >= 33 && c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        ensureChannel(c);
        Intent i = new Intent(c, MainActivity.class).putExtra("open", open)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, id, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_bi)
                .setColor(0xFF4D5BF9)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setAutoCancel(true)
                .setContentIntent(pi)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT);
        try { NotificationManagerCompat.from(c).notify(id, b.build()); } catch (SecurityException ignored) { }
    }

    @NonNull
    @Override
    public Result doWork() {
        Context c = getApplicationContext();
        SharedPreferences auth = c.getSharedPreferences("auth", Context.MODE_PRIVATE);
        SharedPreferences n = c.getSharedPreferences("notify", Context.MODE_PRIVATE);
        String user = auth.getString("session_user", null), token = auth.getString("session_token", null);
        if (user != null && token != null) {
            try {
                JSONObject body = new JSONObject().put("action", "notify").put("app", BuildConfig.STATE_APP ? "state" : "admin")
                        .put("username", user).put("token", token).put("device", (Build.MANUFACTURER + " " + Build.MODEL).trim())
                        .put("ver", BuildConfig.VERSION_NAME);
                JSONObject res = Net.postAuth(body);
                if (res != null && res.optBoolean("ok")) handle(c, n, auth, res);
            } catch (Exception ignored) { }
        }
        checkUpdate(c, n);
        return Result.success();
    }

    private void handle(Context c, SharedPreferences n, SharedPreferences auth, JSONObject res) throws Exception {
        JSONObject sv = res.optJSONObject("surveys");
        if (sv == null) sv = new JSONObject();
        if (BuildConfig.STATE_APP) {
            JSONObject done = new JSONObject(n.getString("surveys", "{}"));
            JSONArray list = sv.optJSONArray("surveys");
            for (int i = 0; list != null && i < list.length(); i++) {
                JSONObject s = list.getJSONObject(i);
                String id = s.optString("id");
                long at = s.optLong("announcedAt");
                if (!s.optBoolean("isNew") || done.optLong(id) == at) continue;
                done.put(id, at);
                post(c, 2000 + (id.hashCode() & 0xfff), L.t(c, "notif_survey_title"), s.optString("title"), "survey:" + id);
            }
            n.edit().putString("surveys", done.toString()).apply();
            auth.edit().putInt("survey_badge", sv.optInt("pending")).apply();
        } else {
            int nr = sv.optInt("newResponses");
            if (nr > 0 && nr != n.getInt("resp", 0)) post(c, 1900, L.t(c, "notif_resp_title"), L.f(c, "notif_resp_msg", nr), "surveys");
            n.edit().putInt("resp", nr).apply();
            auth.edit().putInt("survey_badge", nr).apply();
        }
        JSONObject chat = res.optJSONObject("chat");
        if (chat != null) {
            auth.edit().putInt("chat_unread", chat.optInt("unread")).apply();
            JSONObject last = chat.optJSONObject("latest");
            if (last != null && last.optLong("ts") > n.getLong("chat_ts", 0)) {
                n.edit().putLong("chat_ts", last.optLong("ts")).apply();
                JSONObject peer = last.optJSONObject("peer");
                String who = peer == null ? "" : peer.optString("fullName");
                String topic = last.optString("topic", "");
                post(c, 1600, "✉️ " + L.f(c, "notif_chat_title", who), ("General".equals(topic) || topic.isEmpty() ? "" : topic + " · ") + last.optString("text"),
                        peer == null ? "chat" : "chat:" + peer.optString("id"));
            }
        }
        JSONObject mx = res.optJSONObject("matrix");
        if (mx != null && mx.optBoolean("pending") && n.getLong("mx_" + mx.optString("id"), 0) != mx.optLong("announcedAt")) {
            n.edit().putLong("mx_" + mx.optString("id"), mx.optLong("announcedAt")).apply();
            post(c, 1500, "🧩 " + L.t(c, "feature_matrix"), L.t(c, "matrix_popup"), "matrix");
        }
        if (!BuildConfig.STATE_APP) {
            int pr = res.optInt("pwreq");
            if (pr > n.getInt("pwreq", 0)) post(c, 1400, "🛡️ " + L.t(c, "account_security"), L.f(c, "n_reset_requests", pr), "security");
            n.edit().putInt("pwreq", pr).apply();
            auth.edit().putInt("pwreq_pending", pr).apply();
        }
        int su = res.optInt("supportUnread");
        if (su > n.getInt("support", 0)) post(c, 1800, L.t(c, "support_desk"), L.f(c, "notif_support_msg", su), "support");
        n.edit().putInt("support", su).apply();
        auth.edit().putInt("support_unread", su).apply();
    }

    private void checkUpdate(Context c, SharedPreferences n) {
        JSONObject v = Net.getJson(Net.SITE + "version.json?t=" + System.currentTimeMillis());
        if (v == null) return;
        int code = v.optInt("versionCode");
        if (code > BuildConfig.VERSION_CODE && n.getInt("update", 0) != code) {
            n.edit().putInt("update", code).apply();
            post(c, 1700, L.t(c, "notif_update_title"), L.f(c, "notif_update_msg", v.optString("versionName")), "update");
        }
    }
}
