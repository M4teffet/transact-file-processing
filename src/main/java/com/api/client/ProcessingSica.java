package com.api.client;

import com.transact.filter.BasicAuthClientFilter;
import com.transact.filter.T24LoggingFilter;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.rest.client.annotation.RegisterProvider;
import org.eclipse.microprofile.rest.client.inject.RegisterRestClient;

/**
 * ProcessingSica - REST client for the SICA ("confrère" / interbank) transfer API
 * exposed by the OBA Mobile API gateway.
 * <p>
 * Base URL comes from the {@code funds-transfer-uemoa-api} config key
 * (env {@code FUNDS_TRANSFER_UEMOA_URL}), which already resolves to
 * {@code .../party/mobapi}; this client appends {@code /sicaTransfer}.
 * <p>
 * ✅ {@link BasicAuthClientFilter} adds the Basic-auth header — SICA uses the
 * same credentials as Funds Transfer ({@code ft.api.user} / {@code ft.api.pass}).<br>
 * ✅ {@link T24LoggingFilter} logs requests/responses.
 */
@RegisterProvider(BasicAuthClientFilter.class)
@RegisterProvider(T24LoggingFilter.class)
@RegisterRestClient(configKey = "funds-transfer-uemoa-api")
public interface ProcessingSica {

    /**
     * Submit a SICA interbank transfer.
     *
     * @param request          the transfer payload (wrapped in a {@code body} object)
     * @param uniqueIdentifier per-row correlation id (used by the logging filter)
     * @param companyId        Temenos company id (e.g. {@code SN2210001})
     */
    @POST
    @Path("/sicaTransfer")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    Response sicaTransfer(
            SicaTransferRequest request,
            @HeaderParam("uniqueIdentifier") String uniqueIdentifier,
            @HeaderParam("companyId") String companyId
    );
}
