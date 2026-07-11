package com.api.client.exception;

public record ValidationError(int line, String field, String message) {
}