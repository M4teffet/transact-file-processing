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

/**
 * Sends emails via the Orange Bank internal mail API.
 * Uses HttpURLConnection with SSL bypass for the internal self-signed certificate.
 * <p>
 * API: POST multipart/form-data
 * Fields: emailsTo, messages, object, name_apps, entite
 */
@ApplicationScoped
public class EmailService {

    private static final Logger LOG = Logger.getLogger(EmailService.class);
    private static final String CRLF = "\r\n";
    private static final String BOUNDARY = "----OBAMailBoundary7MA4YWxkTrZu0gW";

    @ConfigProperty(name = "app.mail.api-url",
            defaultValue = "https://appstest.oba/portail_app/Envoie_mail/api/send_mail_entite")
    String mailApiUrl;

    @ConfigProperty(name = "app.mail.app-name", defaultValue = "Batch Manager")
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
     * Installs a trust-all SSL context globally via HttpsURLConnection defaults.
     * Safe for internal-only endpoints with self-signed / internal CA certificates.
     */
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

        String body = """
                <div style="font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <div style="background: #f8f9fa; padding: 30px; border-radius: 8px; border-left: 5px solid #e30613;">
                        <h2 style="color: #e30613; margin-top: 0;">Code de vérification</h2>
                        <p>Bonjour <strong>%s</strong>,</p>
                        <p>Votre code de vérification est :</p>
                        <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center;
                                    background: #fff; padding: 20px; border-radius: 6px; margin: 20px 0; border: 1px solid #ddd;">
                            %s
                        </div>
                        <p>Ce code expire dans <strong>%d minute(s)</strong>.</p>
                        <p><small>Ne partagez jamais ce code avec quiconque.</small></p>
                    </div>
                    <p style="text-align: center; color: #666; font-size: 14px; margin-top: 30px;">
                        Orange Bank • Batch Manager
                    </p>
                </div>
                """.formatted(username, otpCode, minutes);

        send(toEmail, "Votre code de vérification", body, defaultEntite);
    }

    public void sendPasswordReset(String toEmail, String username, String resetToken) {
        int minutes = resetExpirySeconds / 60;
        String link = baseUrl + "/reset-password?token=" + resetToken;

        String body = """
                <div style="font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <div style="background: #f8f9fa; padding: 30px; border-radius: 8px;">
                        <h2 style="color: #e30613;">Réinitialisation de mot de passe</h2>
                        <p>Bonjour <strong>%s</strong>,</p>
                        <p>Une demande de réinitialisation de votre mot de passe a été effectuée.</p>
                
                        <a href="%s" style="display: inline-block; background: #e30613; color: white; 
                                           padding: 14px 28px; text-decoration: none; border-radius: 6px; 
                                           font-weight: bold; margin: 20px 0;">
                            Réinitialiser mon mot de passe
                        </a>
                
                        <p>Ce lien expire dans <strong>%d minute(s)</strong>.</p>
                        <p style="color: #666; font-size: 14px;">
                            Si vous n'avez pas demandé cette réinitialisation, vous pouvez ignorer cet email.
                        </p>
                    </div>
                    <p style="text-align: center; color: #666; font-size: 14px; margin-top: 30px;">
                        Orange Bank • Batch Manager
                    </p>
                </div>
                """.formatted(username, link, minutes);

        send(toEmail, "Réinitialisation de mot de passe", body, defaultEntite);
    }

    public void sendWelcome(String toEmail, String username, String tempPassword) {
        String body = """
                <div style="font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <div style="background: #f8f9fa; padding: 30px; border-radius: 8px; text-align: center;">
                        <h1 style="color: #e30613;">Bienvenue chez Orange Bank</h1>
                        <p>Bonjour <strong>%s</strong>,</p>
                
                        <p>Votre compte <strong>Batch Manager</strong> a été créé avec succès.</p>
                
                        <div style="background: white; padding: 20px; border-radius: 6px; margin: 25px 0; text-align: left; border: 1px solid #eee;">
                            <strong>Identifiants :</strong><br><br>
                            Utilisateur : <strong>%s</strong><br>
                            Mot de passe temporaire : <strong>%s</strong>
                        </div>
                
                        <a href="%s/login" style="display: inline-block; background: #e30613; color: white; 
                                                 padding: 14px 28px; text-decoration: none; border-radius: 6px; 
                                                 font-weight: bold;">
                            Accéder à l'application
                        </a>
                
                        <p style="margin-top: 25px; font-size: 14px; color: #555;">
                            Vous devrez changer votre mot de passe lors de votre première connexion.
                        </p>
                    </div>
                    <p style="text-align: center; color: #666; font-size: 14px; margin-top: 30px;">
                        Orange Bank • Batch Manager
                    </p>
                </div>
                """.formatted(username, username, tempPassword, baseUrl);

        send(toEmail, "Bienvenue sur Orange Bank Batch Manager", body, defaultEntite);
    }

    // ── Core send via HttpURLConnection ───────────────────────────────────────

    public void sendMagicLink(String toEmail, String username, String token) {
        int minutes = resetExpirySeconds / 60;
        String link = baseUrl + "/magic-login?token=" + token;

        String body = """
                <div style="font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <div style="background: #f8f9fa; padding: 30px; border-radius: 8px;">
                        <h2 style="color: #e30613;">Connexion sécurisée</h2>
                        <p>Bonjour <strong>%s</strong>,</p>
                        <p>Cliquez sur le bouton ci-dessous pour vous connecter :</p>
                
                        <a href="%s" style="display: inline-block; background: #e30613; color: white; 
                                           padding: 14px 32px; text-decoration: none; border-radius: 6px; 
                                           font-weight: bold; margin: 20px 0;">
                            Se connecter
                        </a>
                
                        <p style="color: #666;">Ce lien est valable <strong>%d minute(s)</strong>.</p>
                    </div>
                    <p style="text-align: center; color: #666; font-size: 14px; margin-top: 30px;">
                        Orange Bank • Batch Manager
                    </p>
                </div>
                """.formatted(username, link, minutes);

        send(toEmail, "Lien de connexion sécurisé", body, defaultEntite);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    public boolean send(String toEmail, String subject, String message, String entite) {
        try {
            // Install trust-all SSL for this call
            disableSslVerification();

            URL url = new URL(mailApiUrl);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setConnectTimeout(10_000);
            conn.setReadTimeout(15_000);
            conn.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + BOUNDARY);

            // Build multipart body
            StringBuilder sb = new StringBuilder();
            appendField(sb, "emailsTo", toEmail);
            appendField(sb, "messages", message);
            appendField(sb, "object", subject);
            appendField(sb, "name_apps", appName);
            appendField(sb, "entite", entite);
            sb.append("--").append(BOUNDARY).append("--").append(CRLF);

            byte[] body = sb.toString().getBytes(StandardCharsets.UTF_8);

            try (DataOutputStream out = new DataOutputStream(conn.getOutputStream())) {
                out.write(body);
                out.flush();
            }

            int status = conn.getResponseCode();

            // Drain response
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

    private void appendField(StringBuilder sb, String name, String value) {
        sb.append("--").append(BOUNDARY).append(CRLF)
                .append("Content-Disposition: form-data; name=\"").append(name).append("\"").append(CRLF)
                .append(CRLF)
                .append(value).append(CRLF);
    }
}