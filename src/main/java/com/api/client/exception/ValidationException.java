package com.api.client.exception;

import java.util.List;

public class ValidationException extends RuntimeException {
    private final List<ValidationError> errors;

    public ValidationException(List<ValidationError> errors) {
        super("Validation failed with " + errors.size() + " error(s)");
        this.errors = List.copyOf(errors);
    }

    public List<ValidationError> getErrors() {
        return errors;
    }
}