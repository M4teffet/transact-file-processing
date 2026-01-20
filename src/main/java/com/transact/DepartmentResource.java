package com.transact;

import com.transact.processor.model.Departments;
import io.smallrye.common.constraint.NotNull;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

import java.util.List;

@Path("/api/departments")
public class DepartmentResource {


    @POST
    @Produces(MediaType.APPLICATION_JSON)
    public Response createDepartment(@Valid departmentRequest request) {

        if (Departments.find("code", request) == null) {
            return Response.status(Response.Status.CONFLICT).entity("Department does not exist").build();
        }

        Departments departments = new Departments();

        departments.code = request.code;
        departments.description = request.description.trim();
        departments.persist();

        return Response.status(Response.Status.CREATED)
                .entity(departments)
                .build();
    }

    @GET
    @Path("/list")
    @Produces(MediaType.APPLICATION_JSON)
    public List<Departments> listDepartment() {
        return Departments.listAll();
    }

    public static class departmentRequest {
        @NotNull
        public Integer code;
        @NotBlank
        public String description;
    }
}
