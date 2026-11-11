package com.assetworkbench.task;

import com.assetworkbench.persistence.DatabaseAvailability;
import com.assetworkbench.task.TaskMapper.Progress;
import com.assetworkbench.task.TaskMapper.TaskRow;
import com.assetworkbench.task.TaskWorkflow.Stage;
import com.assetworkbench.task.TaskWorkflow.StageFailure;
import com.assetworkbench.task.TaskWorkflow.Status;
import com.assetworkbench.task.TaskWorkflow.Update;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.dao.DataAccessException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.awt.image.BufferedImage;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Objects;
import java.util.function.Supplier;

@Component
class TaskWorker {
    private final TaskMapper mapper;
    private final Path assetsDirectory;
    private final CollageResults collages;
    private final TaskWorkflow workflow = new TaskWorkflow();
    private volatile boolean ready;

    TaskWorker(TaskMapper mapper, @Value("${workbench.assets-directory}") Path assetsDirectory, CollageResults collages) {
        this.mapper = mapper;
        this.assetsDirectory = assetsDirectory.toAbsolutePath().normalize();
        this.collages = collages;
    }

    @EventListener(ApplicationReadyEvent.class)
    void start() {
        mapper.failInterruptedTasks();
        ready = true;
    }

    @Scheduled(fixedDelay = 100)
    void runNext() {
        if (!ready) {
            return;
        }
        TaskRow task = retryRead(mapper::firstPending);
        if (task != null) {
            try {
                var execution = new Execution(task);
                workflow.execute(execution::perform, update -> writeUpdate(task.id(), update));
            } catch (TaskEnded ended) {
                // The durable terminal state wins if the current execution has been superseded.
            }
        }
    }

    private final class Execution {
        private final TaskRow task;
        private List<Path> inputs;
        private BufferedImage collage;

        private Execution(TaskRow task) {
            this.task = task;
        }

        String perform(Stage stage) {
            pause(task.stageDelayMs());
            if (stage == task.failAtStage()) {
                throw new StageFailure("SIMULATED_FAILURE", "此制作阶段模拟失败");
            }
            if (stage == Stage.CHECK_ASSETS) {
                inputs = retryRead(() -> mapper.inputFiles(task.id())).stream()
                        .map(filename -> assetsDirectory.resolve(filename).normalize()).toList();
                for (Path image : inputs) {
                    if (!image.startsWith(assetsDirectory) || !Files.isRegularFile(image) || !Files.isReadable(image)) {
                        throw new StageFailure("ASSET_UNREADABLE", "制作素材不可用");
                    }
                }
            }
            if (stage == Stage.GENERATE && "collage".equals(task.templateId())) {
                collage = collages.compose(inputs);
            }
            if (stage == Stage.FINALIZE) {
                if (collage != null) {
                    return collages.publish(task.id(), collage);
                }
                if (DemoImageController.resource(task.resultImage()) != null) {
                    return "/api/demo-images/" + task.resultImage();
                }
            }
            return null;
        }
    }

    private void writeUpdate(long taskId, Update update) {
        Stage previousStage = update.stage();
        if (update.status() == Status.PROCESSING) {
            previousStage = switch (update.stage()) {
                case CHECK_ASSETS -> null;
                case GENERATE -> Stage.CHECK_ASSETS;
                case FINALIZE -> Stage.GENERATE;
            };
        }
        String previousStatus = previousStage == null ? "PENDING" : "PROCESSING";
        var failure = update.failure();
        var desired = new Progress(update.status().name(), update.stage(), update.resultUrl(),
                failure == null ? null : failure.code(), failure == null ? null : failure.message());

        while (true) {
            try {
                if (mapper.advance(taskId, previousStatus, previousStage, update,
                        desired.failureCode(), desired.failureMessage()) == 1) return;
            } catch (DataAccessException uncertain) {
                if (!DatabaseAvailability.isTemporary(uncertain)) throw uncertain;
                pause(200);
            }

            Progress durable = retryRead(() -> mapper.progress(taskId));
            if (desired.equals(durable)) return;
            if (durable == null || "SUCCEEDED".equals(durable.status()) || "FAILED".equals(durable.status())) {
                throw new TaskEnded();
            }
            if (!previousStatus.equals(durable.status()) || !Objects.equals(previousStage, durable.stage())) {
                throw new IllegalStateException("任务状态已变化，无法推进任务 " + taskId);
            }
        }
    }

    private <T> T retryRead(Supplier<T> read) {
        while (true) {
            try {
                return read.get();
            } catch (DataAccessException unavailable) {
                if (!DatabaseAvailability.isTemporary(unavailable)) throw unavailable;
                pause(200);
            }
        }
    }

    private void pause(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("制作执行已中断", interrupted);
        }
    }

    private static final class TaskEnded extends RuntimeException {
    }
}
