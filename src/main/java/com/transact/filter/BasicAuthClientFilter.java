package com.transact.filter;

import jakarta.annotation.Priority;
import jakarta.ws.rs.client.ClientRequestContext;
import jakarta.ws.rs.client.ClientRequestFilter;
import jakarta.ws.rs.core.MultivaluedMap;
import jakarta.ws.rs.ext.Provider;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

/**
 * BasicAuthClientFilter - Ajoute l'authentification Basic aux requêtes REST Client
 * <p>
 * ✅ S'exécute automatiquement sur tous les appels REST Client
 * ✅ Lit les credentials depuis application.properties
 * ✅ Encode en Base64 et ajoute le header Authorization
 */
@Provider
@Priority(1000)
public class BasicAuthClientFilter implements ClientRequestFilter {

    private static final Logger LOG = Logger.getLogger(BasicAuthClientFilter.class);

    @ConfigProperty(name = "ft.api.user", defaultValue = "INPUTTER")
    String username;

    @ConfigProperty(name = "ft.api.pass", defaultValue = "123456")
    String password;

    @Override
    public void filter(ClientRequestContext requestContext) {
        // Créer le header Basic Auth
        String credentials = username + ":" + password;
        String base64Credentials = Base64.getEncoder()
                .encodeToString(credentials.getBytes(StandardCharsets.UTF_8));

        String authHeader = "Basic " + base64Credentials;

        // Ajouter le header Authorization
        MultivaluedMap<String, Object> headers = requestContext.getHeaders();
        headers.add("Authorization", authHeader);

        LOG.debugf("✅ Header Basic Auth ajouté pour l'utilisateur : %s", username);
        LOG.tracef("Authorization: Basic %s...", base64Credentials.substring(0, 10));
    }
}