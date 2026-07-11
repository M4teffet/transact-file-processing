package com.transact.filter;

import jakarta.annotation.Priority;
import jakarta.inject.Singleton;
import jakarta.ws.rs.client.ClientRequestContext;
import jakarta.ws.rs.client.ClientRequestFilter;
import jakarta.ws.rs.core.MultivaluedMap;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

/**
 * UemoaAuthClientFilter — sets the Basic-auth header for the OBA Mobile API
 * gateway used by SICA transfers.
 * <p>
 * This filter is intentionally <strong>not</strong> annotated {@code @Provider}:
 * it must apply <em>only</em> to the {@code funds-transfer-uemoa-api} client
 * (registered explicitly via {@code @RegisterProvider} on {@link com.api.client.ProcessingSica}),
 * never globally.
 * <p>
 * The global {@link BasicAuthClientFilter} ({@code @Priority(1000)}) runs first and
 * adds the Funds-Transfer credentials to <em>every</em> client. Running later
 * ({@code @Priority(2000)}) and using {@code putSingle} guarantees the outgoing
 * SICA request carries the gateway credentials and nothing else.
 */
@Singleton
@Priority(2000)
public class UemoaAuthClientFilter implements ClientRequestFilter {

    private static final Logger LOG = Logger.getLogger(UemoaAuthClientFilter.class);

    @ConfigProperty(name = "uemoa.api.user", defaultValue = "EBANKING")
    String username;

    @ConfigProperty(name = "uemoa.api.pass", defaultValue = "PASsword@123")
    String password;

    @Override
    public void filter(ClientRequestContext requestContext) {
        String credentials = username + ":" + password;
        String base64 = Base64.getEncoder()
                .encodeToString(credentials.getBytes(StandardCharsets.UTF_8));

        MultivaluedMap<String, Object> headers = requestContext.getHeaders();
        // putSingle overwrites any Authorization already added by the global filter
        headers.putSingle("Authorization", "Basic " + base64);

        LOG.debugf("✅ UEMOA Basic Auth header set for user: %s", username);
    }
}
