package com.transact;

import jakarta.ws.rs.core.MediaType;
import org.jboss.resteasy.reactive.PartType;
import org.jboss.resteasy.reactive.RestForm;

public class FileUploadForm {

    @RestForm("applicationName")
    public String applicationName;

    @RestForm("file")
    @PartType(MediaType.APPLICATION_OCTET_STREAM)
    public java.io.InputStream file;

    @RestForm("file")
    public String fileName;
}