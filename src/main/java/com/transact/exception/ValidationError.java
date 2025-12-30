package com.transact.exception;

public record ValidationError(int line, String field, String message) {
}