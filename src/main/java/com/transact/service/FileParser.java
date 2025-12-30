package com.transact.service;

import jakarta.enterprise.context.ApplicationScoped;
import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVParser;

import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@ApplicationScoped
public class FileParser {

    public List<Map<String, String>> parseCsv(InputStream inputStream) throws IOException {
        if (inputStream == null) return List.of();

        try (Reader reader = new InputStreamReader(inputStream, StandardCharsets.UTF_8);
             CSVParser parser = new CSVParser(reader, CSVFormat.DEFAULT.withFirstRecordAsHeader().withTrim())) {

            return parser.getRecords().stream()
                    .map(record -> {
                        Map<String, String> map = new LinkedHashMap<>();
                        parser.getHeaderMap().keySet().forEach(h ->
                                map.put(h, record.get(h)));
                        return map;
                    })
                    .toList();
        }
    }
}