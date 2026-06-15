package com.transact.processor.model;

import io.quarkus.mongodb.panache.PanacheMongoEntity;
import io.quarkus.mongodb.panache.common.MongoEntity;

import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;

/**
 * OperatingWindow — application-level service hours ("wind down").
 * <p>
 * When enabled, INPUTTER and AUTHORISER access is blocked outside
 * [openHour, closeHour). ADMIN access is never blocked, and an admin can
 * flip {@code adminKeepOpen} to override the schedule (e.g. month-end
 * processing running late) without changing the configured hours.
 */
@MongoEntity(collection = "app_settings")
public class OperatingWindow extends PanacheMongoEntity {

    public static final String SETTING_KEY = "OPERATING_WINDOW";

    public String settingKey = SETTING_KEY;

    /**
     * Master switch — false means the app is always open.
     */
    public boolean enabled = false;

    /** Service opens at this hour (0-23), inclusive. */
    public int openHour = 8;

    /** Service closes at this hour (0-23), exclusive. */
    public int closeHour = 18;

    /** IANA zone for evaluating the hours. */
    public String zone = "Africa/Abidjan";

    /** Admin override: keep the app open past closing until switched off. */
    public boolean adminKeepOpen = false;

    public String updatedBy;
    public Instant lastUpdated;

    /** Load the singleton settings document, creating defaults on first use. */
    public static OperatingWindow get() {
        OperatingWindow w = find("settingKey", SETTING_KEY).firstResult();
        if (w == null) {
            w = new OperatingWindow();
            w.lastUpdated = Instant.now();
            w.persist();
        }
        return w;
    }

    /** Is the service open right now for non-admin users? */
    public boolean isOpenNow() {
        if (!enabled) return true;
        if (adminKeepOpen) return true;

        ZoneId zoneId;
        try {
            zoneId = ZoneId.of(zone);
        } catch (Exception e) {
            zoneId = ZoneId.of("UTC");
        }

        int hour = ZonedDateTime.now(zoneId).getHour();

        if (openHour == closeHour) return true; // degenerate config: always open
        if (openHour < closeHour) {
            return hour >= openHour && hour < closeHour;       // e.g. 08h → 18h
        }
        return hour >= openHour || hour < closeHour;            // overnight, e.g. 20h → 06h
    }

    public boolean isValid() {
        return openHour >= 0 && openHour <= 23 && closeHour >= 0 && closeHour <= 23;
    }
}
