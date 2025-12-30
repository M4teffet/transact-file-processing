package com.transact.filter;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.quarkus.logging.Log;
import jakarta.inject.Inject;
import jakarta.ws.rs.client.ClientRequestContext;
import jakarta.ws.rs.client.ClientRequestFilter;
import jakarta.ws.rs.client.ClientResponseContext;
import jakarta.ws.rs.client.ClientResponseFilter;
import jakarta.ws.rs.ext.Provider;

@Provider
public class T24LoggingFilter implements ClientRequestFilter, ClientResponseFilter {

    @Inject
    ObjectMapper objectMapper;

    @Override
    public void filter(ClientRequestContext requestContext) {
        // Use a header to track the specific row context
        Object correlationId = requestContext.getHeaderString("uniqueIdentifier");

        Log.infof("[%s] >>> T24 REQ: %s %s",
                correlationId != null ? correlationId : "SYSTEM",
                requestContext.getMethod(),
                requestContext.getUri());

        // Log payload only at DEBUG level to keep logs clean
        if (requestContext.hasEntity()) {
            try {
                // Convert the TransactionRequest object into a JSON string
                String jsonPayload = objectMapper.writeValueAsString(requestContext.getEntity());
                Log.debugf("[%s] Payload: %s", correlationId, jsonPayload);
            } catch (Exception e) {
                Log.warnf("[%s] Could not serialize payload for logging: %s", correlationId, e.getMessage());
            }
        }
    }

    @Override
    public void filter(ClientRequestContext requestContext, ClientResponseContext responseContext) {
        Object correlationId = requestContext.getHeaderString("uniqueIdentifier");
        Log.infof("[%s] <<< T24 RES: %d", correlationId, responseContext.getStatus());
    }
}