package com.transact.scheduler;

import com.transact.processor.model.BatchData;
import com.transact.processor.model.FileBatch;
import com.transact.processor.model.ProcessingLogEntry;
import io.quarkus.scheduler.Scheduled;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.transaction.Transactional;
import org.jboss.logging.Logger;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

@ApplicationScoped
public class BatchCleanupJob {

    private static final Logger LOG = Logger.getLogger(BatchCleanupJob.class);

    // Configurable : âge maximum des batches échoués avant suppression (30 jours par défaut)
    private static final long RETENTION_DAYS = 30;

    // Exécution tous les dimanches à 02:00 du matin (pour éviter les pics d'activité)
    @Scheduled(cron = "0 0 2 ? * SUN")
    @Transactional
    public void cleanupFailedBatches() {
        LOG.info("=== Starting weekly cleanup of failed batches ===");

        Instant cutoff = Instant.now().minus(Duration.ofDays(RETENTION_DAYS));

        LOG.infof("Deleting failed batches older than %d days (before %s)", RETENTION_DAYS, cutoff);

        // Récupère les batches en erreur upload ou de validation, anciens
        List<FileBatch> failedBatches = FileBatch.find(
                "status in ?1 and uploadTimestamp < ?2",
                List.of(FileBatch.STATUS_UPLOADED_FAILED, FileBatch.STATUS_VALIDATED_FAILED),
                cutoff
        ).list();

        if (failedBatches.isEmpty()) {
            LOG.info("No old failed batches found. Cleanup completed.");
            return;
        }

        LOG.infof("Found %d failed batches eligible for cleanup", failedBatches.size());

        int totalBatchesDeleted = 0;
        long totalRowsDeleted = 0;
        long totalLogsDeleted = 0;

        for (FileBatch batch : failedBatches) {
            var batchId = batch.id;

            try {
                // 1. Supprime les lignes CSV associées (BatchData)
                long rowsDeleted = BatchData.delete("batchId", batchId);
                totalRowsDeleted += rowsDeleted;
                LOG.infof("Deleted %d data rows for batch %s", rowsDeleted, batchId);

                // 2. (Optionnel) Supprime les logs de traitement associés
                // Décommente si tu veux nettoyer aussi les logs

                long logsDeleted = ProcessingLogEntry.delete("batchId", batchId);
                totalLogsDeleted += logsDeleted;
                LOG.infof("Deleted %d processing logs for batch %s", logsDeleted, batchId);

                // 3. Supprime le batch lui-même
                batch.delete();
                totalBatchesDeleted++;

                LOG.infof("Successfully deleted failed batch %s (uploaded on %s)", batchId, batch.uploadTimestamp);

            } catch (Exception e) {
                LOG.errorf(e, "Failed to delete batch %s during cleanup", batchId);
                // Continue avec les autres batches même si un échoue
            }
        }

        LOG.infof("=== Weekly cleanup completed ===");
        LOG.infof("Batches deleted: %d", totalBatchesDeleted);
        LOG.infof("Data rows deleted: %d", totalRowsDeleted);
        if (totalLogsDeleted > 0) {
            LOG.infof("Processing logs deleted: %d", totalLogsDeleted);
        }
    }
}