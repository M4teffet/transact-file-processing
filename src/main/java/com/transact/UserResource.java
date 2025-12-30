package com.transact;

import com.transact.processor.model.AppUser;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.resteasy.reactive.RestForm;

import java.util.Set;

@Path("/users")
public class UserResource {

    @POST
    @Produces(MediaType.TEXT_PLAIN)
    public Response addUser(@RestForm String username, @RestForm String password, @RestForm String role) {
        try {
            // Basic input checks (null/empty)
            if (username == null || username.trim().isEmpty() || password == null || password.trim().isEmpty() || role == null || role.trim().isEmpty()) {
                return Response.status(400).entity("Error: Username, password, and role are required.").build();
            }

            final Set<String> VALID_ROLES = Set.of("INPUTTER", "ADMIN", "AUTHORISER");

            // Role validation
            String roleUpper = role.trim().toUpperCase();
            if (!VALID_ROLES.contains(roleUpper)) {
                return Response.status(400).entity("Error: Invalid role '" + role + "'. Must be Inputter, Admin, or Authoriser.").build();
            }

            AppUser.add(username, password, role);
            return Response.ok("User '" + username + "' created successfully.").build();
        } catch (Exception e) {
            return Response.status(400).entity("Error: " + e.getMessage()).build();
        }
    }
}