package com.transact;

import com.transact.processor.model.AppUser;
import io.quarkus.security.Authenticated;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.resteasy.reactive.RestForm;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Path("/api/users")
public class UserResource {

    @GET
    @Path("/list")
    @Produces(MediaType.APPLICATION_JSON)
    @Authenticated
// You might want to add @RolesAllowed("ADMIN") here if this is sensitive
    public Response findAll() {
        try {
            // Fetch all users and map to a list of simple maps (DTO)
            List<Map<String, String>> users = AppUser.<AppUser>listAll().stream()
                    .map(u -> Map.of(
                            "username", u.getUsername(),
                            "countryCode", u.countryCode,
                            "role", u.getRole().toString()
                    ))
                    .collect(Collectors.toList());

            return Response.ok(users).build();
        } catch (Exception e) {
            return Response.status(500).entity("Error: " + e.getMessage()).build();
        }
    }


    @POST
    @Produces(MediaType.TEXT_PLAIN)
    public Response addUser(@RestForm String username,
                            @RestForm String password,
                            @RestForm String role,
                            @RestForm String country) {
        try {
            // Basic input checks (null/empty)
            if (username == null || username.trim().isEmpty()
                    || password == null || password.trim().isEmpty()
                    || role == null || role.trim().isEmpty()
                    || country == null || country.trim().isEmpty()) {
                return Response.status(400).entity("Error: Username, password, role, country are required.").build();
            }

            final Set<String> VALID_ROLES = Set.of("INPUTTER", "ADMIN", "AUTHORISER");

            // Role validation
            String roleUpper = role.trim().toUpperCase();
            if (!VALID_ROLES.contains(roleUpper)) {
                return Response.status(400).entity("Error: Invalid role '" + role + "'. Must be Inputter, Admin, or Authoriser.").build();
            }

            AppUser.add(username, password, role, country);
            return Response.ok("User '" + username + "' created successfully.").build();
        } catch (Exception e) {
            return Response.status(400).entity("Error: " + e.getMessage()).build();
        }
    }

    public record UserViewDTO(
            String username,
            String countryCode,
            String role
    ) {
    }
}