package com.api.client;

import com.transact.filter.BasicAuthClientFilter;
import com.transact.filter.T24LoggingFilter;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.rest.client.annotation.RegisterProvider;
import org.eclipse.microprofile.rest.client.inject.RegisterRestClient;

/**
 * ProcessingFt - Client REST pour l'API Funds Transfer
 * <p>
 * ✅ BasicAuthClientFilter ajoute automatiquement l'authentification Basic
 * ✅ T24LoggingFilter log les requêtes/réponses
 */
@RegisterProvider(BasicAuthClientFilter.class)
@RegisterProvider(T24LoggingFilter.class)
@RegisterRestClient(configKey = "funds-transfer-api")
public interface ProcessingFt {

    /**
     * Traiter une transaction
     */
    @POST
    @Path("/process")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    Response processTransaction(
            TransactionRequest request,
            @HeaderParam("uniqueIdentifier") String uniqueIdentifier,
            @HeaderParam("companyId") String companyId
    );

    /**
     * Annuler/Inverser une transaction par référence T24
     *
     * @param t24Reference Référence T24 de la transaction (ex: FT25057DB3JL)
     * @param companyId    Company ID (ex: SN2210001)
     * @return Response de l'API
     */
    @DELETE
    @Path("/reverse/{t24Reference}")
    @Produces(MediaType.APPLICATION_JSON)
    Response reverseTransaction(
            @PathParam("t24Reference") String t24Reference,
            @HeaderParam("companyId") String companyId
    );
}