package com.api.client;

import com.transact.filter.T24LoggingFilter;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.rest.client.annotation.RegisterProvider;
import org.eclipse.microprofile.rest.client.inject.RegisterRestClient;

@RegisterProvider(T24LoggingFilter.class)
@RegisterRestClient(configKey = "funds-transfer-api")
@Path("/process")
public interface ProcessingFt {

    @POST
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    Response processTransaction(
            TransactionRequest request,
            @HeaderParam("uniqueIdentifier") String uniqueIdentifier
    );
}