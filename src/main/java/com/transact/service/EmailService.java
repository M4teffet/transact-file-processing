package com.transact.service;

import jakarta.enterprise.context.ApplicationScoped;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;
import java.io.DataOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.time.LocalDate;

/**
 * Sends HTML emails via the Orange Bank internal mail API.
 * Uses Netflix-inspired email template: dark header, clean body, bold CTA.
 */
@ApplicationScoped
public class EmailService {

    private static final Logger LOG = Logger.getLogger(EmailService.class);
    private static final String CRLF = "\r\n";
    private static final String BOUNDARY = "----OBAMailBoundary7MA4YWxkTrZu0gW";

    // Brand colours (Orange Bank / FLUX)
    private static final String COLOR_BG = "#141414";  // Netflix-dark header
    private static final String COLOR_CARD = "#ffffff";
    private static final String COLOR_BRAND = "#e86e00";  // FLUX orange
    private static final String COLOR_TEXT = "#333333";
    private static final String COLOR_TEXT_MUTED = "#666666";
    private static final String COLOR_BORDER = "#e5e7eb";
    private static final String COLOR_OTP_BG = "#f8f9fa";
    private static final String COLOR_OTP_BORDER = "#e86e00";

    @ConfigProperty(name = "app.mail.api-url",
            defaultValue = "https://appstest.oba/portail_app/Envoie_mail/api/send_mail_entite")
    String mailApiUrl;

    @ConfigProperty(name = "app.mail.app-name", defaultValue = "FLUX")
    String appName;

    @ConfigProperty(name = "app.mail.default-entite", defaultValue = "CI")
    String defaultEntite;

    @ConfigProperty(name = "app.otp.expiry-seconds", defaultValue = "300")
    int otpExpirySeconds;

    @ConfigProperty(name = "app.reset.expiry-seconds", defaultValue = "1800")
    int resetExpirySeconds;

    @ConfigProperty(name = "app.base-url", defaultValue = "http://localhost:8080")
    String baseUrl;

    // ── Public email methods ──────────────────────────────────────────────────

    /**
     * Escape HTML special characters
     */
    private static String esc(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;");
    }

    private static void disableSslVerification() {
        try {
            TrustManager[] trustAll = new TrustManager[]{
                    new X509TrustManager() {
                        public X509Certificate[] getAcceptedIssuers() {
                            return new X509Certificate[0];
                        }

                        public void checkClientTrusted(X509Certificate[] c, String a) {
                        }

                        public void checkServerTrusted(X509Certificate[] c, String a) {
                        }
                    }
            };
            SSLContext ctx = SSLContext.getInstance("TLS");
            ctx.init(null, trustAll, new SecureRandom());
            HttpsURLConnection.setDefaultSSLSocketFactory(ctx.getSocketFactory());
            HttpsURLConnection.setDefaultHostnameVerifier((hostname, session) -> true);
        } catch (Exception e) {
            LOG.errorf(e, "[Mail] Failed to disable SSL verification");
        }
    }

    public void sendOtp(String toEmail, String username, String otpCode) {
        int minutes = otpExpirySeconds / 60;
        String content =
                heading("Votre code de connexion") +
                        para("Bonjour <strong>" + esc(username) + "</strong>,") +
                        para("Utilisez le code ci-dessous pour finaliser votre connexion à <strong>FLUX</strong>.") +
                        otpBlock(otpCode) +
                        para("Ce code est valide pendant <strong>" + minutes + " minute" + (minutes > 1 ? "s" : "") + "</strong>. " +
                                "Ne le partagez jamais avec quiconque.") +
                        divider() +
                        para("<small>Si vous n'avez pas tenté de vous connecter, ignorez ce message et " +
                                "contactez immédiatement votre administrateur.</small>");

        send(toEmail, "[FLUX] Votre code de vérification", html(content), defaultEntite);
    }

    public void sendPasswordReset(String toEmail, String username, String resetToken) {
        int minutes = resetExpirySeconds / 60;
        String link = baseUrl + "/reset-password?token=" + resetToken;
        String content =
                heading("Réinitialisation du mot de passe") +
                        para("Bonjour <strong>" + esc(username) + "</strong>,") +
                        para("Nous avons reçu une demande de réinitialisation du mot de passe pour votre compte FLUX.") +
                        ctaButton("Réinitialiser mon mot de passe", link) +
                        para("Ce lien expire dans <strong>" + minutes + " minutes</strong>.") +
                        divider() +
                        para("<small>Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet e-mail. " +
                                "Votre mot de passe ne sera pas modifié.</small>");

        send(toEmail, "[FLUX] Réinitialisation de mot de passe", html(content), defaultEntite);
    }

    /**
     * Notifies the INPUTTER that their batch has finished processing.
     * <p>
     * Called by both FundsTransferProcessor and FundsTransferReversalProcessor
     * after finalizeBatch() successfully updates FileBatch.status.  The call
     * is fire-and-forget — failures are logged but never re-thrown so a broken
     * mail server cannot affect the processing pipeline.
     *
     * @param toEmail         uploader's email address
     * @param username        uploader's username (displayed in greeting)
     * @param filename        original uploaded filename
     * @param applicationName application label (e.g. "FUNDS_TRANSFER")
     * @param batchStatus     final FileBatch status constant
     * @param total           total rows in the batch
     * @param success         rows that completed successfully
     * @param failure         rows that failed permanently
     * @param batchesUrl      absolute URL to the /batches page
     */
    public void sendBatchCompletion(
            String toEmail,
            String username,
            String filename,
            String applicationName,
            String batchStatus,
            long total,
            long success,
            long failure,
            String batchesUrl) {

        String subject = buildCompletionSubject(filename, batchStatus);

        String content =
                heading("Traitement de lot terminé") +
                        para("Bonjour <strong>" + esc(username) + "</strong>,") +
                        para("Le traitement du lot <strong>" + esc(filename) + "</strong>" +
                                " (" + esc(applicationName) + ") est terminé.") +
                        statusPill(batchStatus) +
                        statsBlock(total, success, failure) +
                        ctaButton("Voir mes batches", batchesUrl) +
                        divider() +
                        para("<small>Ce lot a été traité automatiquement par <strong>FLUX</strong>. " +
                                "Pour toute question, contactez votre administrateur.</small>");

        send(toEmail, subject, html(content), defaultEntite);
    }

    // ── Batch completion template helpers ─────────────────────────────────────

    private String buildCompletionSubject(String filename, String status) {
        String label = switch (status) {
            case "PROCESSED" -> "Terminé avec succès";
            case "PROCESSED_WITH_ERROR" -> "Terminé avec erreurs";
            case "PROCESSED_FAILED" -> "Échec du traitement";
            default -> status.replace('_', ' ');
        };
        return "[FLUX] " + label + " — " + (filename != null ? filename : "lot");
    }

    /**
     * Coloured status pill — green / orange / red depending on outcome.
     */
    private String statusPill(String status) {
        String label, bg, border, color;
        switch (status) {
            case "PROCESSED" -> {
                label = "✓  Terminé avec succès";
                bg = "#f0fdf4";
                border = "#86efac";
                color = "#15803d";
            }
            case "PROCESSED_WITH_ERROR" -> {
                label = "⚠  Terminé avec erreurs";
                bg = "#fff7ed";
                border = "#fdba74";
                color = "#c2410c";
            }
            default -> {              // PROCESSED_FAILED
                label = "✗  Échec du traitement";
                bg = "#fef2f2";
                border = "#fca5a5";
                color = "#b91c1c";
            }
        }
        return "<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:20px 0;\">" +
                "<tr><td>" +
                "<div style=\"display:inline-block;background:" + bg + ";border:1.5px solid " + border + ";" +
                "border-radius:4px;padding:10px 20px;font-size:14px;font-weight:700;" +
                "letter-spacing:0.3px;color:" + color + ";\">" +
                label +
                "</div>" +
                "</td></tr></table>";
    }

    /**
     * Three-column stats block: total / success / failure.
     * Uses nested tables for maximum email client compatibility.
     */
    private String statsBlock(long total, long success, long failure) {
        return "<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" " +
                "style=\"margin:24px 0;border-collapse:separate;border-spacing:0;\">" +
                "<tr>" +
                statCell(String.valueOf(total), "Total lignes", "#f8f9fa", "#6b7280", "#111827") +
                "<td width=\"12\"></td>" +
                statCell(String.valueOf(success), "Succès", "#f0fdf4", "#15803d", "#14532d") +
                "<td width=\"12\"></td>" +
                statCell(String.valueOf(failure), "Échecs", "#fef2f2", "#b91c1c", "#7f1d1d") +
                "</tr></table>";
    }

    private String statCell(String value, String label, String bg, String labelColor, String valueColor) {
        return "<td style=\"background:" + bg + ";border-radius:4px;padding:18px 16px;" +
                "text-align:center;width:33%;\">" +
                "<div style=\"font-size:28px;font-weight:800;color:" + valueColor + ";line-height:1;\">" +
                esc(value) + "</div>" +
                "<div style=\"font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;" +
                "color:" + labelColor + ";margin-top:6px;\">" +
                esc(label) + "</div>" +
                "</td>";
    }

    // ── HTML template engine ──────────────────────────────────────────────────

    public void sendWelcome(String toEmail, String username, String tempPassword) {
        String content =
                heading("Bienvenue sur FLUX") +
                        para("Bonjour <strong>" + esc(username) + "</strong>,") +
                        para("Votre compte a été créé sur <strong>FLUX</strong> — la plateforme de traitement batch d'Orange Bank.") +
                        infoBox(
                                "Vos identifiants de connexion",
                                "<b>Identifiant :</b> " + esc(username) + "<br>" +
                                        "<b>Mot de passe temporaire :</b> " + esc(tempPassword)
                        ) +
                        para("Vous devrez <strong>changer votre mot de passe</strong> lors de votre première connexion.") +
                        ctaButton("Accéder à FLUX", baseUrl + "/login") +
                        divider() +
                        para("<small>Pour des raisons de sécurité, ne partagez jamais vos identifiants.</small>");

        send(toEmail, "Bienvenue sur FLUX — Orange Bank", html(content), defaultEntite);
    }

    public void sendMagicLink(String toEmail, String username, String token) {
        int minutes = resetExpirySeconds / 60;
        String link = baseUrl + "/magic-login?token=" + token;
        String content =
                heading("Votre lien de connexion") +
                        para("Bonjour <strong>" + esc(username) + "</strong>,") +
                        para("Cliquez sur le bouton ci-dessous pour vous connecter à FLUX sans mot de passe.") +
                        ctaButton("Se connecter à FLUX", link) +
                        para("Ce lien est valide <strong>" + minutes + " minutes</strong> et ne peut être utilisé qu'une seule fois.") +
                        divider() +
                        para("<small>Si vous n'avez pas demandé ce lien, ignorez ce message.</small>");

        send(toEmail, "[FLUX] Votre lien de connexion sécurisé", html(content), defaultEntite);
    }

    /**
     * Wraps content in the full Netflix-inspired email shell
     */
    private String html(String bodyContent) {
        int year = LocalDate.now().getYear();
        return "<!DOCTYPE html>" +
                "<html lang=\"fr\"><head>" +
                "<meta charset=\"UTF-8\">" +
                "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
                "<title>FLUX — Orange Bank</title>" +
                "</head>" +
                "<body style=\"margin:0;padding:0;background-color:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;\">" +

                // Outer wrapper
                "<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"background-color:#f4f4f4;\">" +
                "<tr><td align=\"center\" style=\"padding:40px 20px;\">" +

                // Email card
                "<table width=\"600\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"max-width:600px;width:100%;background:#ffffff;border-radius:4px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);\">" +

                // ── Header (Netflix-dark) ─────────────────────────────────────
                "<tr><td style=\"background-color:" + COLOR_BG + ";padding:28px 40px;text-align:center;\">" +
                "<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\"><tr>" +
                "<td style=\"text-align:left;\">" +
                // FLUX wordmark
                "<span style=\"font-size:28px;font-weight:800;letter-spacing:-1px;color:" + COLOR_BRAND + ";\">" +
                "FLUX" +
                "</span>" +
                "<span style=\"font-size:11px;color:#999999;margin-left:8px;letter-spacing:1px;text-transform:uppercase;vertical-align:middle;\">" +
                "Orange Bank" +
                "</span>" +
                "</td>" +
                "</tr></table>" +
                "</td></tr>" +

                // ── Body ─────────────────────────────────────────────────────
                "<tr><td style=\"padding:40px;color:" + COLOR_TEXT + ";\">" +
                bodyContent +
                "</td></tr>" +

                // ── Footer ────────────────────────────────────────────────────
                "<tr><td style=\"background-color:#f8f8f8;border-top:1px solid " + COLOR_BORDER + ";padding:24px 40px;text-align:center;\">" +
                "<p style=\"margin:0 0 8px;font-size:12px;color:" + COLOR_TEXT_MUTED + ";\">" +
                "© " + year + " Orange Bank — FLUX. Tous droits réservés." +
                "</p>" +
                "<p style=\"margin:0;font-size:11px;color:#999999;\">" +
                "Cet e-mail a été envoyé automatiquement. Merci de ne pas y répondre." +
                "</p>" +
                "</td></tr>" +

                "</table>" + // end email card

                "</td></tr></table>" + // end outer wrapper
                "</body></html>";
    }

    private String heading(String text) {
        return "<h1 style=\"margin:0 0 24px;font-size:24px;font-weight:700;color:#141414;line-height:1.3;\">" +
                esc(text) + "</h1>";
    }

    private String para(String html) {
        return "<p style=\"margin:0 0 16px;font-size:15px;line-height:1.6;color:" + COLOR_TEXT + ";\">" +
                html + "</p>";
    }

    /**
     * The large OTP code block — Netflix style: centered, monospaced, orange accent
     */
    private String otpBlock(String code) {
        return "<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:28px 0;\">" +
                "<tr><td align=\"center\">" +
                "<div style=\"display:inline-block;background:" + COLOR_OTP_BG + ";" +
                "border:2px solid " + COLOR_OTP_BORDER + ";" +
                "border-radius:8px;padding:20px 48px;text-align:center;\">" +
                "<div style=\"font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;" +
                "color:" + COLOR_TEXT_MUTED + ";margin-bottom:10px;\">CODE DE VÉRIFICATION</div>" +
                "<div style=\"font-size:40px;font-weight:800;letter-spacing:10px;" +
                "color:" + COLOR_BRAND + ";font-family:ui-monospace,'Courier New',monospace;" +
                "line-height:1;\">" + esc(code) + "</div>" +
                "</div>" +
                "</td></tr></table>";
    }

    /**
     * Orange CTA button — Netflix style: full-width, bold
     */
    private String ctaButton(String label, String url) {
        return "<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:28px 0;\">" +
                "<tr><td align=\"center\">" +
                "<a href=\"" + url + "\" " +
                "style=\"display:inline-block;background-color:" + COLOR_BRAND + ";" +
                "color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;" +
                "padding:14px 40px;border-radius:4px;letter-spacing:0.3px;" +
                "min-width:200px;text-align:center;\">" +
                esc(label) +
                "</a>" +
                "</td></tr></table>" +
                "<p style=\"margin:-16px 0 20px;font-size:12px;color:#999;text-align:center;\">ou copiez ce lien : " +
                "<a href=\"" + url + "\" style=\"color:" + COLOR_BRAND + ";word-break:break-all;\">" + url + "</a></p>";
    }

    /**
     * Info box — dark card for credentials etc.
     */
    private String infoBox(String title, String content) {
        return "<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:24px 0;\">" +
                "<tr><td style=\"background:#f8f9fa;border-left:4px solid " + COLOR_BRAND + ";" +
                "border-radius:0 4px 4px 0;padding:16px 20px;\">" +
                "<div style=\"font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;" +
                "color:" + COLOR_TEXT_MUTED + ";margin-bottom:10px;\">" + esc(title) + "</div>" +
                "<div style=\"font-size:15px;line-height:1.8;color:" + COLOR_TEXT + ";\">" + content + "</div>" +
                "</td></tr></table>";
    }

    // ── Core send via HttpURLConnection ───────────────────────────────────────

    private String divider() {
        return "<hr style=\"border:none;border-top:1px solid " + COLOR_BORDER + ";margin:24px 0;\">";
    }

    private void appendField(StringBuilder sb, String name, String value) {
        sb.append("--").append(BOUNDARY).append(CRLF)
                .append("Content-Disposition: form-data; name=\"").append(name).append("\"").append(CRLF)
                .append(CRLF)
                .append(value).append(CRLF);
    }

    public boolean send(String toEmail, String subject, String message, String entite) {
        try {
            disableSslVerification();
            URL url = new URL(mailApiUrl);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setConnectTimeout(10_000);
            conn.setReadTimeout(15_000);
            conn.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + BOUNDARY);

            StringBuilder sb = new StringBuilder();
            appendField(sb, "emailsTo", toEmail);
            appendField(sb, "messages", message);
            appendField(sb, "object",    subject);
            appendField(sb, "name_apps", appName);
            appendField(sb, "entite",    entite);
            sb.append("--").append(BOUNDARY).append("--").append(CRLF);

            byte[] body = sb.toString().getBytes(StandardCharsets.UTF_8);
            try (DataOutputStream out = new DataOutputStream(conn.getOutputStream())) {
                out.write(body);
                out.flush();
            }

            int status = conn.getResponseCode();
            try (InputStream is = status < 400 ? conn.getInputStream() : conn.getErrorStream()) {
                if (is != null) is.readAllBytes();
            }
            conn.disconnect();

            if (status >= 200 && status < 300) {
                LOG.infof("[Mail] Sent '%s' to %s — HTTP %d", subject, toEmail, status);
                return true;
            } else {
                LOG.warnf("[Mail] Failed '%s' to %s — HTTP %d", subject, toEmail, status);
                return false;
            }
        } catch (Exception e) {
            LOG.errorf(e, "[Mail] Error sending '%s' to %s", subject, toEmail);
            return false;
        }
    }
}