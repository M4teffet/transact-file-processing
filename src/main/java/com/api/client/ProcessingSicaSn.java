package com.api.client;

import com.transact.filter.BasicAuthClientFilter;
import com.transact.filter.T24LoggingFilter;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.rest.client.annotation.RegisterProvider;
import org.eclipse.microprofile.rest.client.inject.RegisterRestClient;

/**
 * ProcessingSicaSn - REST client for the <b>Senegal</b> SICA transfer endpoint.
 * <p>
 * Senegal uses a different gateway than the default SICA route: a distinct
 * base URL (config key {@code funds-transfer-uemoa-sn-api}, env
 * {@code FUNDS_TRANSFER_UEMOA_SN_URL}, resolving to {@code .../party/mobapi})
 * and a distinct path {@code /sicaTransferSn}.
 * <p>
 * Authentication and logging are the same as the default SICA / Funds Transfer
 * route ({@link BasicAuthClientFilter}, {@link T24LoggingFilter}).
 */
@RegisterProvider(BasicAuthClientFilter.class)
@RegisterProvider(T24LoggingFilter.class)
@RegisterRestClient(configKey = "funds-transfer-uemoa-sn-api")
public interface ProcessingSicaSn {

    /**
     * Submit a SICA interbank transfer for Senegal.
     *
     * @param request          the transfer payload (wrapped in a {@code body} object)
     * @param uniqueIdentifier per-row correlation id (used by the logging filter)
     * @param companyId        Temenos company id (e.g. {@code SN2210001})
     */
    @POST
    @Path("/sicaTransferSn")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    Response sicaTransferSn(
            SicaTransferRequest request,
            @HeaderParam("uniqueIdentifier") String uniqueIdentifier,
            @HeaderParam("companyId") String companyId
    );
}
