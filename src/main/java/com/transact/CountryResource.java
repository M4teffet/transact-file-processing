package com.transact;

import com.transact.processor.model.Country;
import jakarta.annotation.security.RolesAllowed;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

import java.util.List;

@Path("/api/country")
@RolesAllowed("ADMIN")
public class CountryResource {

    @POST
    @Produces(MediaType.APPLICATION_JSON)
    public Response createCountry(@Valid CountryRequest request) {

        // Check if country already exists
        if (Country.find("code", request.code).firstResult() != null) {
            return Response.status(Response.Status.CONFLICT)
                    .entity("Country already exists: " + request.code)
                    .build();
        }

        Country country = new Country();
        country.code = request.code.trim();
        country.companyId = request.companyId.trim();
        country.persist();

        return Response.status(Response.Status.CREATED)
                .entity(country)
                .build();
    }

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    @Path("/{code}")
    public Response getCountryByCode(@PathParam("code") String code) {

        Country country = Country.find("code", code).firstResult();

        if (country == null) {
            return Response.status(Response.Status.NOT_FOUND)
                    .entity("Country not found: " + code)
                    .build();
        }

        return Response.ok(country).build();
    }

    /**
     * NEW ENDPOINT: List all countries
     */
    @GET
    @Path("/list")
    @Produces(MediaType.APPLICATION_JSON)
    public List<Country> listCountries() {
        return Country.listAll();
    }

    public static class CountryRequest {
        @NotBlank
        public String code;

        @NotBlank
        public String companyId;
    }
}
