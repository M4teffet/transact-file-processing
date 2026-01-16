package com.transact.service;

import com.transact.exception.ValidationError;
import com.transact.exception.ValidationException;
import com.transact.processor.model.Application;
import com.transact.processor.model.SchemaField;
import jakarta.enterprise.context.ApplicationScoped;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.*;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

@ApplicationScoped
public class FileValidator {

    private static final DateTimeFormatter DATE_FORMATTER = DateTimeFormatter.ofPattern("yyyyMMdd");
    private static final Pattern SUSPICIOUS_CHARS = Pattern.compile("['\";]|--");  // Basic SQLi guard
    private final Map<Application, Map<String, SchemaField>> schemaCache = new WeakHashMap<>();  // Cache per config
    @ConfigProperty(name = "app.validation.amount.max-scale", defaultValue = "2")
    int maxDecimalScale;
    @ConfigProperty(name = "app.validation.date.max-future-days", defaultValue = "0")  // No future dates
    int maxFutureDays;

    public List<Map<String, Object>> validateAndConvert(List<Map<String, String>> rawData, Application config) {
        Map<String, SchemaField> schemaMap = getOrCreateSchemaMap(config);
        List<ValidationError> errors = new ArrayList<>();
        List<Map<String, Object>> result = IntStream.range(0, rawData.size())
                .mapToObj(i -> {
                    try {
                        return processRecord(rawData.get(i), schemaMap, i + 2, config);
                    } catch (RuntimeException e) {
                        errors.add(new ValidationError(i + 2, null, e.getMessage()));  // Could enhance ValidationError with field
                        return null;
                    }
                })
                .filter(Objects::nonNull)
                .collect(Collectors.toList());  // Use collect for mutability if needed later

        // Batch validation for DATA_CAPTURE: Ensure sum of AMOUNT.LCY where SIGN='C' equals sum where SIGN='D'
        if ("DATA_CAPTURE".equals(config.name)) {  // Assuming getter; use config.code if direct field
            BigDecimal creditSum = BigDecimal.ZERO;
            BigDecimal debitSum = BigDecimal.ZERO;
            for (Map<String, Object> record : result) {
                String sign = (String) record.get("SIGN");
                BigDecimal amountLcy = (BigDecimal) record.get("AMOUNT.LCY");
                if (amountLcy != null) {
                    if ("C".equals(sign)) {
                        creditSum = creditSum.add(amountLcy);
                    } else if ("D".equals(sign)) {
                        debitSum = debitSum.add(amountLcy);
                    }
                }
            }
            if (!creditSum.equals(debitSum)) {
                String batchErrorMsg = String.format("Batch validation failed: Sum of AMOUNT.LCY for SIGN='C' (%s) does not equal sum for SIGN='D' (%s)", creditSum, debitSum);
                errors.add(new ValidationError(0, null, batchErrorMsg));  // Line 0 indicates batch-level error
            }
        }

        if (!errors.isEmpty()) {
            throw new ValidationException(errors);
        }
        return result;
    }

    private Map<String, SchemaField> getOrCreateSchemaMap(Application config) {
        return schemaCache.computeIfAbsent(config, c -> c.getSchema().stream()
                .collect(Collectors.toMap(SchemaField::getFieldName, f -> f, (a, b) -> a)));
    }

    private Map<String, Object> processRecord(Map<String, String> raw, Map<String, SchemaField> schema, int line, Application config) {
        Map<String, Object> record = new HashMap<>();

        // Convert and validate individual fields
        for (SchemaField field : schema.values()) {
            String name = field.getFieldName();
            String val = raw.get(name);
            if (field.isRequired() && !isAmountField(name, config)
                    && isBlank(val)) {
                throw new RuntimeException("Line " + line + ": Field '" + name + "' is required");
            }
            if (isBlank(val)) {
                record.put(name, null);
                continue;
            }
            String sanitized = sanitize(val.trim(), field.getDataType());
            if (sanitized == null) {
                throw new RuntimeException("Line " + line + ": Field '" + name + "' contains invalid characters");
            }
            try {
                Object converted = convert(sanitized, field.getDataType());
                record.put(name, converted);
            } catch (Exception e) {
                throw new RuntimeException("Line " + line + ": Field '" + name + "': " + e.getMessage());
            }
        }

        // Custom validations based on application type
        performCustomValidations(raw, line, config);

        return record;
    }

    private void performCustomValidations(Map<String, String> raw, int line, Application config) {
        String appType = config.name;  // Assuming Application has getName() returning "FUNDS_TRANSFER" or "DATA_CAPTURE"
        switch (appType) {
            case "FUNDS_TRANSFER" -> validateFundsTransfer(raw, line);
            case "DATA_CAPTURE" -> validateDataCapture(raw, line);
            default -> throw new RuntimeException("Line " + line + ": Unsupported application type: " + appType);
        }
    }

    private void validateFundsTransfer(Map<String, String> raw, int line) {
        validateAmountsAndCurrency(raw, line);
        validateAccounts(raw, line);
    }

    private void validateDataCapture(Map<String, String> raw, int line) {
        String sign = raw.get("SIGN");
        String amountLcyStr = raw.get("AMOUNT.LCY");

        // Ensure SIGN is 'C' or 'D' if provided
        if (!isBlank(sign) && !"C".equals(sign.trim()) && !"D".equals(sign.trim())) {
            throw new RuntimeException("Line " + line + ": SIGN must be 'C' or 'D'");
        }

        // If SIGN is provided, AMOUNT.LCY must be provided, non-blank, and positive
        if (!isBlank(sign) && (isBlank(amountLcyStr) || new BigDecimal(amountLcyStr.trim()).compareTo(BigDecimal.ZERO) <= 0)) {
            throw new RuntimeException("Line " + line + ": AMOUNT.LCY must be positive when SIGN is provided");
        }
    }

    private void validateAmountsAndCurrency(Map<String, String> raw, int line) {
        String debitAmountStr = raw.get("DEBIT.AMOUNT");
        String creditAmountStr = raw.get("CREDIT.AMOUNT");
        String debitCurrency = raw.get("DEBIT.CURRENCY");
        String creditCurrency = raw.get("CREDIT.CURRENCY");

        if (isBlank(debitAmountStr) && isBlank(creditAmountStr)) {
            throw new RuntimeException("Line " + line + ": Either DEBIT.AMOUNT or CREDIT.AMOUNT must be provided");
        }

        // Currency mandatory if amount provided
        if (!isBlank(debitAmountStr) && isBlank(debitCurrency)) {
            throw new RuntimeException("Line " + line + ": DEBIT.CURRENCY is required when DEBIT.AMOUNT is provided");
        }
        if (!isBlank(creditAmountStr) && isBlank(creditCurrency)) {
            throw new RuntimeException("Line " + line + ": CREDIT.CURRENCY is required when CREDIT.AMOUNT is provided");
        }

        // Consistency: If both amounts, currencies should match
        if (!isBlank(debitAmountStr) && !isBlank(creditAmountStr) && !Objects.equals(debitCurrency, creditCurrency)) {
            throw new RuntimeException("Line " + line + ": DEBIT.CURRENCY and CREDIT.CURRENCY must match when both amounts are provided");
        }

        // Post-conversion: Validate positivity and scale (assuming converted to BigDecimal)
        if (!isBlank(debitAmountStr)) {
            BigDecimal debitAmt = new BigDecimal(debitAmountStr.trim());
            if (debitAmt.compareTo(BigDecimal.ZERO) <= 0) {
                throw new RuntimeException("Line " + line + ": DEBIT.AMOUNT must be positive");
            }
            if (debitAmt.scale() > maxDecimalScale) {
                throw new RuntimeException("Line " + line + ": DEBIT.AMOUNT exceeds " + maxDecimalScale + " decimal places");
            }
        }
        if (!isBlank(creditAmountStr)) {
            BigDecimal creditAmt = new BigDecimal(creditAmountStr.trim());
            if (creditAmt.compareTo(BigDecimal.ZERO) <= 0) {
                throw new RuntimeException("Line " + line + ": CREDIT.AMOUNT must be positive");
            }
            if (creditAmt.scale() > maxDecimalScale) {
                throw new RuntimeException("Line " + line + ": CREDIT.AMOUNT exceeds " + maxDecimalScale + " decimal places");
            }
        }
    }

    private void validateAccounts(Map<String, String> raw, int line) {
        String debitAcct = raw.get("DEBIT.ACCT.NO");
        String creditAcct = raw.get("CREDIT.ACCT.NO");
        String orderingBank = raw.get("ORDERING.BANK");
        String orderingCust = raw.get("ORDERING.CUSTOMER");

        if ((startsWithLetter(debitAcct) || startsWithLetter(creditAcct))
                && isBlank(orderingBank) && isBlank(orderingCust)) {
            throw new RuntimeException("Line " + line + ": For internal/P&L accounts, either ORDERING.BANK or ORDERING.CUSTOMER is required.");
        }
    }

    private boolean isAmountField(String name, Application config) {
        // Generalize for different apps; for now, hardcoded per type
        String appType = config.name;
        return switch (appType) {
            case "FUNDS_TRANSFER" -> "DEBIT.AMOUNT".equals(name) || "CREDIT.AMOUNT".equals(name);
            case "DATA_CAPTURE" -> "VALUE".equals(name);  // Example for DATA_CAPTURE
            default -> false;
        };
    }

    private Object convert(String val, String type) {
        return switch (type.toUpperCase()) {
            case "STRING" -> val;
            case "DECIMAL" -> {
                BigDecimal bd = new BigDecimal(val);
                if (bd.scale() > maxDecimalScale) {
                    throw new RuntimeException("Value exceeds " + maxDecimalScale + " decimal places");
                }
                yield bd;
            }
            case "INTEGER" -> Long.parseLong(val);
            case "DATE" -> {
                LocalDate date;
                try {
                    date = LocalDate.parse(val, DATE_FORMATTER);
                } catch (DateTimeParseException e) {
                    // Fallback to ISO 8601 (e.g., "2025-12-09T00:00:00.000+00:00")
                    try {
                        OffsetDateTime odt = OffsetDateTime.parse(val);
                        date = odt.toLocalDate();
                    } catch (DateTimeParseException isoE) {
                        throw new RuntimeException("Invalid date format: must be yyyyMMdd");
                    }
                }
                LocalDate today = LocalDate.now();
                if (date.isAfter(today.plusDays(maxFutureDays))) {
                    throw new RuntimeException("Date cannot be more than " + maxFutureDays + " days in the future");
                }
                // Return as formatted string to "remain" in yyyyMMdd
                yield date.format(DATE_FORMATTER);
            }
            default -> throw new IllegalArgumentException("Unsupported type: " + type);
        };
    }

    private String sanitize(String val, String type) {
        if (SUSPICIOUS_CHARS.matcher(val).find()) {
            return null;  // Reject
        }
        // Type-specific: e.g., for STRING, limit length if needed
        if ("STRING".equalsIgnoreCase(type) && val.length() > 255) {
            return val.substring(0, 255);  // Truncate or reject
        }
        return val;
    }

    private boolean startsWithLetter(String s) {
        return !isBlank(s) && Character.isLetter(s.charAt(0));
    }

    private boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

}